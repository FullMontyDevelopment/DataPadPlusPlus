use chrono::NaiveDateTime;
use serde_json::json;
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
    let query = if explain_mode {
        format!("SET SHOWPLAN_TEXT ON; {statement}; SET SHOWPLAN_TEXT OFF;")
    } else {
        statement.to_string()
    };
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let mut client = sqlserver_client(connection).await?;
    let batches = if explain_mode {
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
    let explain_payload = if explain_mode {
        first_section.map(|section| sqlserver_explain_payload(statement, section))
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
    let batch_payload = (!explain_mode && section_rows.len() > 1).then(|| {
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
    if explain_mode {
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
    payloads.push(if explain_mode {
        payload_raw(sqlserver_plan_text(first_section))
    } else {
        payload_raw(statement.to_string())
    });

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if explain_mode {
            format!("SQL Server execution plan returned {total_rows} row(s).")
        } else {
            format!("{total_rows} row(s) returned from {}.", connection.name)
        },
        default_renderer: if batch_payload.is_some() {
            "batch"
        } else if explain_mode {
            "plan"
        } else {
            "table"
        },
        renderer_modes: if batch_payload.is_some() {
            vec!["batch", "json", "raw"]
        } else if explain_mode {
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

fn sqlserver_plan_text(section: Option<&SqlServerResultSection>) -> String {
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

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use chrono::NaiveDate;
    use serde_json::Value;
    use tiberius::{
        time::{Date, DateTime2, DateTimeOffset, Time},
        xml::XmlData,
        ColumnData,
    };

    use super::{
        payload_table, sqlserver_explain_payload, stringify_tiberius_cell, SqlServerResultSection,
    };

    #[test]
    fn sqlserver_temporal_cells_render_as_native_values() {
        let date = sqlserver_date(2026, 5, 16);
        let time = sqlserver_time(11, 29, 8, 356_405_000);
        let datetime = DateTime2::new(date, time);

        assert_eq!(
            stringify_tiberius_cell(&ColumnData::DateTime2(Some(datetime))),
            "2026-05-16 11:29:08.356405",
        );
        assert_eq!(
            stringify_tiberius_cell(&ColumnData::Date(Some(date))),
            "2026-05-16",
        );
        assert_eq!(
            stringify_tiberius_cell(&ColumnData::Time(Some(time))),
            "11:29:08.356405",
        );
        assert_eq!(
            stringify_tiberius_cell(&ColumnData::DateTimeOffset(Some(DateTimeOffset::new(
                datetime, 120,
            )))),
            "2026-05-16 11:29:08.356405 +02:00",
        );
    }

    #[test]
    fn sqlserver_decimal_and_xml_cells_do_not_leak_debug_wrappers() {
        assert_eq!(
            stringify_tiberius_cell(&ColumnData::Numeric(Some(
                tiberius::numeric::Numeric::new_with_scale(12_345, 2)
            ))),
            "123.45",
        );
        assert_eq!(
            stringify_tiberius_cell(&ColumnData::Xml(Some(Cow::Owned(XmlData::new(
                "<a>value</a>",
            ))))),
            "<a>value</a>",
        );
    }

    #[test]
    fn sqlserver_showplan_payload_uses_plan_renderer_shape() {
        let section = SqlServerResultSection {
            payload: payload_table(
                vec!["StmtText".into()],
                vec![vec![
                    "Clustered Index Scan\n  Predicate: [active]=(1)".into()
                ]],
            ),
            columns: vec!["StmtText".into()],
            row_count: 1,
            tabular_rows: vec![vec![
                "Clustered Index Scan\n  Predicate: [active]=(1)".into()
            ]],
            duration_ms: 3,
            truncated: false,
            statement: "SET SHOWPLAN_TEXT ON; select * from accounts; SET SHOWPLAN_TEXT OFF;"
                .into(),
        };

        let payload = sqlserver_explain_payload("select * from accounts", &section);

        assert_eq!(payload["renderer"], "plan");
        assert_eq!(payload["format"], "text");
        assert_eq!(payload["value"]["format"], "text");
        assert_eq!(payload["value"]["plan"][0], "Clustered Index Scan");
        assert_eq!(payload["value"]["plan"][1], "  Predicate: [active]=(1)");
        assert_eq!(payload["value"]["columns"][0], "StmtText");
        assert_eq!(
            payload["value"]["rows"][0][0],
            Value::String("Clustered Index Scan\n  Predicate: [active]=(1)".into())
        );
    }

    fn sqlserver_date(year: i32, month: u32, day: u32) -> Date {
        let start = NaiveDate::from_ymd_opt(1, 1, 1).expect("valid start date");
        let date = NaiveDate::from_ymd_opt(year, month, day).expect("valid test date");

        Date::new(date.signed_duration_since(start).num_days() as u32)
    }

    fn sqlserver_time(hour: u64, minute: u64, second: u64, nanos: u64) -> Time {
        let increments = ((hour * 3_600 + minute * 60 + second) * 1_000_000_000 + nanos) / 100;

        Time::new(increments, 7)
    }
}
