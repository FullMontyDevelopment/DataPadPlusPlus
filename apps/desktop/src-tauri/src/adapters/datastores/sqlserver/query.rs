use chrono::NaiveDateTime;
use serde_json::{json, Value};
use tiberius::{time as tds_time, ColumnData};

use super::super::super::*;
use super::connection::sqlserver_client;
use super::SqlServerAdapter;

fn stringify_tiberius_cell(data: &ColumnData<'_>) -> String {
    match data {
        ColumnData::Bit(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::U8(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::I16(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::I32(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::I64(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::F32(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::F64(value) => stringify_sql_value(*value).unwrap_or_else(|| "null".into()),
        ColumnData::String(value) => value
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_else(|| "null".into()),
        ColumnData::Guid(value) => value
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_else(|| "null".into()),
        ColumnData::Binary(value) => value
            .as_ref()
            .map(|item| format!("<{} bytes>", item.len()))
            .unwrap_or_else(|| "null".into()),
        ColumnData::Numeric(value) => value
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_else(|| "null".into()),
        ColumnData::Xml(value) => value
            .as_ref()
            .map(|item| item.as_ref().to_string())
            .unwrap_or_else(|| "null".into()),
        ColumnData::DateTime(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_datetime(*item))
            .unwrap_or_else(|| "null".into()),
        ColumnData::SmallDateTime(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_small_datetime(*item))
            .unwrap_or_else(|| "null".into()),
        ColumnData::Time(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_time(*item))
            .unwrap_or_else(|| "null".into()),
        ColumnData::Date(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_date(*item))
            .unwrap_or_else(|| "null".into()),
        ColumnData::DateTime2(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_datetime2(*item))
            .unwrap_or_else(|| "null".into()),
        ColumnData::DateTimeOffset(value) => value
            .as_ref()
            .and_then(|item| format_sqlserver_datetime_offset(*item))
            .unwrap_or_else(|| "null".into()),
    }
}

fn format_sqlserver_date(value: tds_time::Date) -> Option<String> {
    date_from_days_since(i64::from(value.days()), 1).map(format_native_date)
}

fn format_sqlserver_time(value: tds_time::Time) -> Option<String> {
    time_from_scaled_increments(value.increments(), value.scale()).map(format_native_time)
}

fn format_sqlserver_datetime2(value: tds_time::DateTime2) -> Option<String> {
    let date = date_from_days_since(i64::from(value.date().days()), 1)?;
    let time = time_from_scaled_increments(value.time().increments(), value.time().scale())?;

    Some(format_native_date_time(NaiveDateTime::new(date, time)))
}

fn format_sqlserver_datetime_offset(value: tds_time::DateTimeOffset) -> Option<String> {
    Some(format!(
        "{} {}",
        format_sqlserver_datetime2(value.datetime2())?,
        format_sqlserver_offset(value.offset()),
    ))
}

fn format_sqlserver_datetime(value: tds_time::DateTime) -> Option<String> {
    let date = date_from_days_since(i64::from(value.days()), 1900)?;
    let nanos = i128::from(value.seconds_fragments()) * 1_000_000_000_i128 / 300_i128;
    let time = time_from_nanos_since_midnight(nanos)?;

    Some(format_native_date_time(NaiveDateTime::new(date, time)))
}

fn format_sqlserver_small_datetime(value: tds_time::SmallDateTime) -> Option<String> {
    let date = date_from_days_since(i64::from(value.days()), 1900)?;
    let seconds = u32::from(value.seconds_fragments()) * 60;
    let time = time_from_nanos_since_midnight(i128::from(seconds) * 1_000_000_000_i128)?;

    Some(format_native_date_time(NaiveDateTime::new(date, time)))
}

fn format_sqlserver_offset(offset_minutes: i16) -> String {
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let absolute = i32::from(offset_minutes).abs();
    let hours = absolute / 60;
    let minutes = absolute % 60;

    format!("{sign}{hours:02}:{minutes:02}")
}

pub(super) async fn execute_sqlserver_query(
    adapter: &SqlServerAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request);
    let explain_mode = execute_mode(request) == "explain";
    let profile_mode = execute_mode(request) == "profile";
    let plan_mode = explain_mode || profile_mode;
    let query = if explain_mode {
        format!("SET SHOWPLAN_TEXT ON; {statement}; SET SHOWPLAN_TEXT OFF;")
    } else if profile_mode {
        format!("SET SHOWPLAN_XML ON; {statement}; SET SHOWPLAN_XML OFF;")
    } else {
        statement.to_string()
    };
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let mut client = sqlserver_client(connection).await?;
    let batches = if plan_mode {
        single_statement_batch(&query)
    } else {
        split_sql_batch(&query, SqlBatchDialect::SqlServer)
    };
    let mut section_rows = Vec::new();
    let mut total_rows = 0usize;
    let mut truncated = false;

    for batch in &batches {
        let batch_started = Instant::now();
        let results = client
            .simple_query(batch.text.clone())
            .await?
            .into_results()
            .await?;
        let empty_result_sets = results.is_empty();

        for result in results {
            let section = sqlserver_result_section(
                section_rows.len() + 1,
                &batch.text,
                result,
                row_limit,
                duration_ms(batch_started),
            );
            total_rows += section.row_count;
            truncated |= section.truncated;
            section_rows.push(section);
        }

        if empty_result_sets {
            section_rows.push(SqlServerResultSection {
                payload: payload_raw("Statement executed successfully.".into()),
                columns: Vec::new(),
                row_count: 0,
                tabular_rows: Vec::new(),
                duration_ms: duration_ms(batch_started),
                truncated: false,
                statement: batch.text.clone(),
            });
        }
    }

    let first_section = section_rows.first();
    let explain_payload = if plan_mode {
        first_section.map(|section| {
            if profile_mode {
                sqlserver_profile_payload(statement, section)
            } else {
                sqlserver_explain_payload(statement, section)
            }
        })
    } else {
        None
    };
    let primary_payload = if let Some(plan) = explain_payload.clone() {
        plan
    } else {
        first_section
            .map(|section| section.payload.clone())
            .unwrap_or_else(|| payload_raw("Statement executed successfully.".into()))
    };
    let batch_payload = (!plan_mode && section_rows.len() > 1).then(|| {
        payload_batch(
            section_rows
                .iter()
                .enumerate()
                .map(|(index, section)| {
                    let default_renderer = section
                        .payload
                        .get("renderer")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("raw")
                        .to_string();

                    batch_section(BatchSectionPayload {
                        id: format!("sqlserver-result-{}", index + 1),
                        label: format!("Result {}", index + 1),
                        statement: Some(section.statement.clone()),
                        status: "success",
                        duration_ms: Some(section.duration_ms),
                        row_count: Some(section.row_count),
                        default_renderer: default_renderer.clone(),
                        renderer_modes: vec![default_renderer.clone()],
                        payloads: vec![section.payload.clone()],
                        notices: Vec::new(),
                    })
                })
                .collect(),
            format!(
                "{} SQL Server result section(s) returned from {}.",
                section_rows.len(),
                connection.name
            ),
        )
    });
    let mut payloads = Vec::new();
    if let Some(batch) = batch_payload.clone() {
        payloads.push(batch);
    } else {
        payloads.push(primary_payload);
    }
    if plan_mode {
        if let Some(section) = first_section {
            payloads.push(section.payload.clone());
        }
    }
    payloads.push(payload_json(json!({
        "engine": connection.engine,
        "rowCount": total_rows,
        "rowLimit": row_limit,
        "resultSetCount": section_rows.len(),
    })));
    payloads.push(if plan_mode {
        payload_raw(sqlserver_plan_raw(first_section, profile_mode))
    } else {
        payload_raw(statement.to_string())
    });

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if plan_mode {
            if profile_mode {
                format!("SQL Server XML Showplan returned {total_rows} row(s).")
            } else {
                format!("SQL Server execution plan returned {total_rows} row(s).")
            }
        } else {
            format!("{total_rows} row(s) returned from {}.", connection.name)
        },
        default_renderer: if batch_payload.is_some() {
            "batch"
        } else if plan_mode {
            "plan"
        } else {
            "table"
        },
        renderer_modes: if batch_payload.is_some() {
            vec!["batch", "json", "raw"]
        } else if plan_mode {
            vec!["plan", "table", "json", "raw"]
        } else {
            vec!["table", "json", "raw"]
        },
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload,
    }))
}

struct SqlServerResultSection {
    payload: serde_json::Value,
    columns: Vec<String>,
    row_count: usize,
    tabular_rows: Vec<Vec<String>>,
    duration_ms: u64,
    truncated: bool,
    statement: String,
}

fn sqlserver_result_section(
    _index: usize,
    statement: &str,
    result: Vec<tiberius::Row>,
    row_limit: u32,
    duration_ms: u64,
) -> SqlServerResultSection {
    let columns: Vec<String> = result
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let row_count = result.len();
    let tabular_rows = result
        .iter()
        .take(row_limit as usize)
        .map(|row| {
            row.cells()
                .map(|(_, value)| stringify_tiberius_cell(value))
                .collect()
        })
        .collect::<Vec<Vec<String>>>();
    let payload = if columns.is_empty() {
        payload_raw("Statement executed successfully.".into())
    } else {
        payload_table(columns.clone(), tabular_rows.clone())
    };

    SqlServerResultSection {
        payload,
        columns,
        row_count,
        tabular_rows,
        duration_ms,
        truncated: row_count > row_limit as usize,
        statement: statement.to_string(),
    }
}

fn sqlserver_explain_payload(
    statement: &str,
    section: &SqlServerResultSection,
) -> serde_json::Value {
    let lines = sqlserver_plan_lines(Some(section));

    payload_plan(
        "text",
        json!({
            "statement": statement,
            "format": "text",
            "plan": lines,
            "columns": &section.columns,
            "rows": &section.tabular_rows,
        }),
        "SQL Server SHOWPLAN_TEXT plan returned.",
    )
}

fn sqlserver_profile_payload(
    statement: &str,
    section: &SqlServerResultSection,
) -> serde_json::Value {
    payload_plan(
        "xml",
        sqlserver_showplan_xml_payload(statement, section),
        "SQL Server XML Showplan plan returned.",
    )
}

fn sqlserver_plan_raw(section: Option<&SqlServerResultSection>, xml: bool) -> String {
    if xml {
        return section
            .map(sqlserver_showplan_xml_documents)
            .unwrap_or_default()
            .join("\n\n");
    }

    sqlserver_plan_lines(section).join("\n")
}

fn sqlserver_plan_lines(section: Option<&SqlServerResultSection>) -> Vec<String> {
    section
        .map(|section| section.tabular_rows.as_slice())
        .unwrap_or_default()
        .iter()
        .flat_map(|row| row.iter())
        .flat_map(|value| value.lines())
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
struct SqlServerShowplanOperator {
    depth: usize,
    physical: String,
    logical: String,
    estimated_rows: String,
    estimated_cost: String,
    object: String,
    predicate: String,
}

impl SqlServerShowplanOperator {
    fn line(&self) -> String {
        let operation = if self.physical.is_empty() {
            self.logical.clone()
        } else if self.logical.is_empty() || self.logical == self.physical {
            self.physical.clone()
        } else {
            format!("{} ({})", self.physical, self.logical)
        };
        let target = if self.object.is_empty() {
            String::new()
        } else {
            format!(" on {}", self.object)
        };
        let estimates = match (
            self.estimated_rows.is_empty(),
            self.estimated_cost.is_empty(),
        ) {
            (true, true) => String::new(),
            (false, true) => format!(" [rows {}]", self.estimated_rows),
            (true, false) => format!(" [cost {}]", self.estimated_cost),
            (false, false) => format!(
                " [rows {}, cost {}]",
                self.estimated_rows, self.estimated_cost
            ),
        };

        format!(
            "{}{}{}{}",
            "  ".repeat(self.depth),
            operation,
            target,
            estimates
        )
    }

    fn row(&self) -> Vec<String> {
        vec![
            self.physical.clone(),
            self.logical.clone(),
            self.estimated_rows.clone(),
            self.estimated_cost.clone(),
            self.object.clone(),
            self.predicate.clone(),
        ]
    }

    fn value(&self) -> Value {
        json!({
            "depth": self.depth,
            "physicalOp": self.physical,
            "logicalOp": self.logical,
            "estimatedRows": self.estimated_rows,
            "estimatedCost": self.estimated_cost,
            "object": self.object,
            "predicate": self.predicate,
        })
    }
}

fn sqlserver_showplan_xml_payload(statement: &str, section: &SqlServerResultSection) -> Value {
    let documents = sqlserver_showplan_xml_documents(section);
    let operators = documents
        .iter()
        .flat_map(|document| sqlserver_showplan_operators(document))
        .collect::<Vec<_>>();
    let statements = documents
        .iter()
        .flat_map(|document| sqlserver_showplan_statements(document))
        .collect::<Vec<_>>();
    let plan = operators
        .iter()
        .map(SqlServerShowplanOperator::line)
        .collect::<Vec<_>>();
    let rows = operators
        .iter()
        .map(SqlServerShowplanOperator::row)
        .collect::<Vec<_>>();
    let raw_xml_bytes = documents.iter().map(String::len).sum::<usize>();
    let raw_xml_sample = documents
        .first()
        .map(|document| truncate_for_payload(document, 4_096))
        .unwrap_or_default();

    json!({
        "statement": statement,
        "format": "showplan_xml",
        "plan": plan,
        "columns": [
            "Physical Operation",
            "Logical Operation",
            "Estimated Rows",
            "Estimated Cost",
            "Object",
            "Predicate"
        ],
        "rows": rows,
        "statements": statements,
        "operators": operators.iter().map(SqlServerShowplanOperator::value).collect::<Vec<_>>(),
        "rawXmlBytes": raw_xml_bytes,
        "rawXmlSample": raw_xml_sample,
    })
}

fn sqlserver_showplan_xml_documents(section: &SqlServerResultSection) -> Vec<String> {
    section
        .tabular_rows
        .iter()
        .flat_map(|row| row.iter())
        .filter(|value| value.contains("<ShowPlanXML"))
        .cloned()
        .collect()
}

fn sqlserver_showplan_operators(xml: &str) -> Vec<SqlServerShowplanOperator> {
    let mut operators = Vec::new();
    let mut offset = 0usize;

    while let Some(relative_start) = xml[offset..].find("<RelOp") {
        let start = offset + relative_start;
        let Some(tag) = xml_tag_at(xml, start) else {
            break;
        };
        let segment = xml_operator_segment(xml, start);

        operators.push(SqlServerShowplanOperator {
            depth: relop_depth(xml, start),
            physical: xml_attribute(tag, "PhysicalOp").unwrap_or_default(),
            logical: xml_attribute(tag, "LogicalOp").unwrap_or_default(),
            estimated_rows: xml_attribute(tag, "EstimateRows").unwrap_or_default(),
            estimated_cost: xml_attribute(tag, "EstimatedTotalSubtreeCost")
                .or_else(|| xml_attribute(tag, "EstimateCPU"))
                .unwrap_or_default(),
            object: sqlserver_showplan_object(segment),
            predicate: sqlserver_showplan_predicate(segment),
        });

        offset = start + tag.len();
    }

    operators
}

fn sqlserver_showplan_statements(xml: &str) -> Vec<Value> {
    let mut statements = Vec::new();
    let mut offset = 0usize;

    while let Some(relative_start) = xml[offset..].find("<Stmt") {
        let start = offset + relative_start;
        let Some(tag) = xml_tag_at(xml, start) else {
            break;
        };
        let statement_text = xml_attribute(tag, "StatementText").unwrap_or_default();
        let statement_type = xml_attribute(tag, "StatementType").unwrap_or_default();
        let estimated_rows = xml_attribute(tag, "StatementEstRows").unwrap_or_default();
        let subtree_cost = xml_attribute(tag, "StatementSubTreeCost").unwrap_or_default();
        let optimization_level = xml_attribute(tag, "StatementOptmLevel").unwrap_or_default();

        if !statement_text.is_empty()
            || !statement_type.is_empty()
            || !estimated_rows.is_empty()
            || !subtree_cost.is_empty()
            || !optimization_level.is_empty()
        {
            statements.push(json!({
                "statementText": statement_text,
                "statementType": statement_type,
                "estimatedRows": estimated_rows,
                "subtreeCost": subtree_cost,
                "optimizationLevel": optimization_level,
            }));
        }

        offset = start + tag.len();
    }

    statements
}

fn xml_operator_segment(xml: &str, start: usize) -> &str {
    let rest = &xml[start..];
    let next_child = rest
        .get(6..)
        .and_then(|value| value.find("<RelOp"))
        .map(|index| index + 6);
    let close = rest.find("</RelOp>").map(|index| index + "</RelOp>".len());
    let end = next_child.or(close).unwrap_or(rest.len());

    &rest[..end]
}

fn sqlserver_showplan_object(segment: &str) -> String {
    let Some(start) = segment.find("<Object") else {
        return String::new();
    };
    let Some(tag) = xml_tag_at(segment, start) else {
        return String::new();
    };

    ["Database", "Schema", "Table", "Index"]
        .iter()
        .filter_map(|name| xml_attribute(tag, name))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn sqlserver_showplan_predicate(segment: &str) -> String {
    let Some(start) = segment.find("ScalarString=") else {
        return String::new();
    };
    let tag_start = segment[..start].rfind('<').unwrap_or(start);
    let Some(tag) = xml_tag_at(segment, tag_start) else {
        return String::new();
    };

    xml_attribute(tag, "ScalarString").unwrap_or_default()
}

fn relop_depth(xml: &str, start: usize) -> usize {
    let before = &xml[..start];
    before
        .match_indices("<RelOp")
        .count()
        .saturating_sub(before.match_indices("</RelOp>").count())
}

fn xml_tag_at(xml: &str, start: usize) -> Option<&str> {
    let end = xml[start..].find('>')?;
    Some(&xml[start..=start + end])
}

fn xml_attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let start = tag.find(&needle)? + needle.len();
    let quote = tag[start..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value_start = start + quote.len_utf8();
    let value_end = tag[value_start..].find(quote)?;

    Some(decode_xml_entities(
        &tag[value_start..value_start + value_end],
    ))
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn truncate_for_payload(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("\n<!-- truncated -->");
    }
    truncated
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/query_tests.rs"]
mod tests;
