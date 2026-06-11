use futures_util::TryStreamExt;
use serde_json::{json, Map, Value};
use sqlx::{postgres::PgPool, Column, Row};

use super::super::*;

#[derive(Debug, Clone)]
pub(super) struct PostgresQueryRows {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) total_rows: u32,
    pub(super) truncated: bool,
}

pub(super) async fn query_postgres_rows(
    pool: &PgPool,
    sql: &str,
    row_limit: u32,
) -> Result<PostgresQueryRows, CommandError> {
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0_u32;
    let mut truncated = false;

    while let Some(row) = stream.try_next().await? {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect();
        }
        total_rows = total_rows.saturating_add(1);
        if rows.len() == row_limit as usize {
            truncated = true;
            break;
        }
        rows.push(
            (0..row.columns().len())
                .map(|index| stringify_pg_cell(&row, index))
                .collect(),
        );
    }
    drop(stream);

    Ok(PostgresQueryRows {
        columns,
        rows,
        total_rows,
        truncated,
    })
}

pub(super) fn postgres_explain_text(columns: &[String], rows: &[Vec<String>]) -> String {
    if columns.is_empty() || rows.is_empty() {
        return "Explain plan returned no rows.".to_string();
    }
    let plan_column = columns
        .iter()
        .position(|column| {
            matches!(
                column.to_ascii_lowercase().as_str(),
                "query plan" | "query_plan" | "plan"
            ) || column.to_ascii_lowercase().contains("plan")
        })
        .unwrap_or_else(|| columns.len().saturating_sub(1));

    rows.iter()
        .filter_map(|row| row.get(plan_column))
        .flat_map(|value| value.lines().map(str::to_string).collect::<Vec<_>>())
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn postgres_explain_payload(
    statement: &str,
    columns: &[String],
    rows: &[Vec<String>],
) -> serde_json::Value {
    let lines = postgres_explain_lines(columns, rows);
    let format = if columns.len() == 1 { "text" } else { "table" };

    payload_plan(
        format,
        json!({
            "statement": statement,
            "format": format,
            "plan": lines,
            "columns": columns,
            "rows": rows,
        }),
        "PostgreSQL EXPLAIN plan returned.",
    )
}

pub(super) fn postgres_profile_payload(
    columns: &[String],
    rows: &[Vec<String>],
) -> serde_json::Value {
    let stages = postgres_profile_stages(columns, rows);
    let summary = if stages.is_empty() {
        "PostgreSQL EXPLAIN ANALYZE profile returned no stages."
    } else {
        "PostgreSQL EXPLAIN ANALYZE profile returned."
    };

    payload_profile(summary, json!(stages))
}

pub(super) fn postgres_profile_plan_payload(
    statement: &str,
    columns: &[String],
    rows: &[Vec<String>],
) -> serde_json::Value {
    let profile = postgres_profile_json(columns, rows);
    let lines = profile
        .as_ref()
        .map(postgres_profile_plan_lines)
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| postgres_explain_lines(columns, rows));
    let table_rows = profile
        .as_ref()
        .map(postgres_profile_table_rows)
        .unwrap_or_default();

    payload_plan(
        "json",
        json!({
            "statement": statement,
            "format": "json",
            "plan": lines,
            "columns": postgres_profile_table_columns(),
            "rows": table_rows,
            "profile": profile,
            "rawColumns": columns,
            "rawRows": rows,
        }),
        "PostgreSQL EXPLAIN ANALYZE JSON plan returned.",
    )
}

fn postgres_explain_lines(columns: &[String], rows: &[Vec<String>]) -> Vec<String> {
    let text = postgres_explain_text(columns, rows);
    if text == "Explain plan returned no rows." {
        return Vec::new();
    }

    text.lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect()
}

fn postgres_profile_stages(columns: &[String], rows: &[Vec<String>]) -> Vec<Value> {
    let Some(profile) = postgres_profile_json(columns, rows) else {
        return postgres_explain_lines(columns, rows)
            .into_iter()
            .enumerate()
            .map(|(index, line)| {
                json!({
                    "name": format!("profile-line-{}", index + 1),
                    "details": { "plan": line }
                })
            })
            .collect();
    };

    let Some(document) = postgres_profile_document(&profile) else {
        return Vec::new();
    };

    let mut stages = Vec::new();
    if let Some(plan) = document.get("Plan") {
        collect_profile_stage(plan, 0, &mut stages);
    }
    let node_count = stages.len();
    let warnings = postgres_profile_warnings(&stages);
    if let Some(root) = stages.first_mut().and_then(Value::as_object_mut) {
        let details = root
            .entry("details")
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(details) = details.as_object_mut() {
            insert_number_field(details, "planningMs", document, "Planning Time");
            insert_number_field(details, "executionMs", document, "Execution Time");
            insert_nested_number_field(
                details,
                "jitGenerationMs",
                document,
                "JIT",
                "Generation Time",
            );
            insert_nested_number_field(details, "jitInliningMs", document, "JIT", "Inlining Time");
            insert_nested_number_field(
                details,
                "jitOptimizationMs",
                document,
                "JIT",
                "Optimization Time",
            );
            insert_nested_number_field(details, "jitEmissionMs", document, "JIT", "Emission Time");
            details.insert("nodeCount".into(), json!(node_count));
            if !warnings.is_empty() {
                details.insert("warnings".into(), json!(warnings));
            }
        }
    }

    stages
}

fn postgres_profile_json(columns: &[String], rows: &[Vec<String>]) -> Option<Value> {
    let text = postgres_explain_text(columns, rows);
    if text == "Explain plan returned no rows." {
        return None;
    }
    serde_json::from_str::<Value>(&text).ok()
}

fn postgres_profile_document(profile: &Value) -> Option<&Value> {
    match profile {
        Value::Array(items) => items.first(),
        Value::Object(_) => Some(profile),
        _ => None,
    }
}

fn collect_profile_stage(node: &Value, depth: usize, stages: &mut Vec<Value>) {
    let mut stage = Map::new();
    stage.insert("name".into(), json!(postgres_profile_node_label(node)));
    if let Some(duration_ms) = number_field(node, "Actual Total Time") {
        stage.insert("durationMs".into(), json!(duration_ms));
    }
    if let Some(rows) =
        number_field(node, "Actual Rows").or_else(|| number_field(node, "Plan Rows"))
    {
        stage.insert("rows".into(), json!(rows));
    }

    let mut details = Map::new();
    details.insert("depth".into(), json!(depth));
    for (key, field) in [
        ("nodeType", "Node Type"),
        ("schema", "Schema"),
        ("relation", "Relation Name"),
        ("alias", "Alias"),
        ("index", "Index Name"),
        ("joinType", "Join Type"),
        ("strategy", "Strategy"),
        ("parentRelationship", "Parent Relationship"),
        ("filter", "Filter"),
        ("indexCondition", "Index Cond"),
        ("hashCondition", "Hash Cond"),
        ("joinFilter", "Join Filter"),
        ("recheckCondition", "Recheck Cond"),
    ] {
        insert_value_field(&mut details, key, node, field);
    }
    for (key, field) in [
        ("startupCost", "Startup Cost"),
        ("totalCost", "Total Cost"),
        ("planRows", "Plan Rows"),
        ("planWidth", "Plan Width"),
        ("actualStartupMs", "Actual Startup Time"),
        ("actualTotalMs", "Actual Total Time"),
        ("actualRows", "Actual Rows"),
        ("actualLoops", "Actual Loops"),
        ("sharedHitBlocks", "Shared Hit Blocks"),
        ("sharedReadBlocks", "Shared Read Blocks"),
        ("sharedDirtiedBlocks", "Shared Dirtied Blocks"),
        ("sharedWrittenBlocks", "Shared Written Blocks"),
        ("localHitBlocks", "Local Hit Blocks"),
        ("localReadBlocks", "Local Read Blocks"),
        ("tempReadBlocks", "Temp Read Blocks"),
        ("tempWrittenBlocks", "Temp Written Blocks"),
        ("walRecords", "WAL Records"),
        ("walFpi", "WAL FPI"),
        ("walBytes", "WAL Bytes"),
        ("sortSpaceUsed", "Sort Space Used"),
        ("peakMemoryKb", "Peak Memory Usage"),
    ] {
        insert_number_field(&mut details, key, node, field);
    }
    for (key, field) in [
        ("sortKey", "Sort Key"),
        ("groupKey", "Group Key"),
        ("hashBuckets", "Hash Buckets"),
        ("hashBatches", "Hash Batches"),
    ] {
        insert_value_field(&mut details, key, node, field);
    }

    stage.insert("details".into(), Value::Object(details));
    stages.push(Value::Object(stage));

    for child in node
        .get("Plans")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_profile_stage(child, depth + 1, stages);
    }
}

fn postgres_profile_plan_lines(profile: &Value) -> Vec<String> {
    let Some(document) = postgres_profile_document(profile) else {
        return Vec::new();
    };
    let Some(plan) = document.get("Plan") else {
        return Vec::new();
    };

    let mut lines = Vec::new();
    collect_profile_plan_line(plan, 0, &mut lines);
    if let Some(planning_ms) = number_field(document, "Planning Time") {
        lines.push(format!("Planning Time: {planning_ms:.3} ms"));
    }
    if let Some(execution_ms) = number_field(document, "Execution Time") {
        lines.push(format!("Execution Time: {execution_ms:.3} ms"));
    }
    lines
}

fn collect_profile_plan_line(node: &Value, depth: usize, lines: &mut Vec<String>) {
    let indent = "  ".repeat(depth);
    let prefix = if depth == 0 { "" } else { "-> " };
    let mut line = format!("{indent}{prefix}{}", postgres_profile_node_label(node));
    if let Some(actual_rows) = number_field(node, "Actual Rows") {
        line.push_str(&format!("  actual rows={actual_rows:.0}"));
    }
    if let Some(plan_rows) = number_field(node, "Plan Rows") {
        line.push_str(&format!("  plan rows={plan_rows:.0}"));
    }
    if let Some(loops) = number_field(node, "Actual Loops") {
        line.push_str(&format!("  loops={loops:.0}"));
    }
    if let Some(duration_ms) = number_field(node, "Actual Total Time") {
        line.push_str(&format!("  time={duration_ms:.3} ms"));
    }
    lines.push(line);

    for child in node
        .get("Plans")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_profile_plan_line(child, depth + 1, lines);
    }
}

fn postgres_profile_table_columns() -> Vec<&'static str> {
    vec![
        "Depth",
        "Node",
        "Relation",
        "Actual Rows",
        "Plan Rows",
        "Loops",
        "Actual Total ms",
        "Shared Hit",
        "Shared Read",
        "Temp Read",
        "WAL Bytes",
    ]
}

fn postgres_profile_table_rows(profile: &Value) -> Vec<Vec<String>> {
    let Some(document) = postgres_profile_document(profile) else {
        return Vec::new();
    };
    let Some(plan) = document.get("Plan") else {
        return Vec::new();
    };

    let mut rows = Vec::new();
    collect_profile_table_row(plan, 0, &mut rows);
    rows
}

fn collect_profile_table_row(node: &Value, depth: usize, rows: &mut Vec<Vec<String>>) {
    rows.push(vec![
        depth.to_string(),
        postgres_profile_node_label(node),
        relation_label(node),
        number_string(node, "Actual Rows"),
        number_string(node, "Plan Rows"),
        number_string(node, "Actual Loops"),
        number_string(node, "Actual Total Time"),
        number_string(node, "Shared Hit Blocks"),
        number_string(node, "Shared Read Blocks"),
        number_string(node, "Temp Read Blocks"),
        number_string(node, "WAL Bytes"),
    ]);

    for child in node
        .get("Plans")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_profile_table_row(child, depth + 1, rows);
    }
}

fn postgres_profile_node_label(node: &Value) -> String {
    let node_type = string_field(node, "Node Type").unwrap_or("Plan Node");
    let relation = relation_label(node);
    if !relation.is_empty() {
        return format!("{node_type} on {relation}");
    }
    if let Some(index_name) = string_field(node, "Index Name") {
        return format!("{node_type} using {index_name}");
    }
    if let Some(subquery) = string_field(node, "Subplan Name") {
        return format!("{node_type} {subquery}");
    }
    node_type.to_string()
}

fn relation_label(node: &Value) -> String {
    let relation = string_field(node, "Relation Name").unwrap_or_default();
    if relation.is_empty() {
        return String::new();
    }
    let schema = string_field(node, "Schema").unwrap_or_default();
    if schema.is_empty() {
        relation.to_string()
    } else {
        format!("{schema}.{relation}")
    }
}

fn postgres_profile_warnings(stages: &[Value]) -> Vec<String> {
    let mut warnings = Vec::new();
    for stage in stages {
        let details = stage.get("details").and_then(Value::as_object);
        let node_type = details
            .and_then(|items| items.get("nodeType"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        let plan_rows = details
            .and_then(|items| items.get("planRows"))
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let actual_rows = details
            .and_then(|items| items.get("actualRows"))
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let temp_read = details
            .and_then(|items| items.get("tempReadBlocks"))
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let temp_written = details
            .and_then(|items| items.get("tempWrittenBlocks"))
            .and_then(Value::as_f64)
            .unwrap_or_default();

        if node_type.contains("seq scan") {
            push_unique_warning(&mut warnings, "Plan includes a sequential scan.");
        }
        if plan_rows > 0.0 && actual_rows > plan_rows * 10.0 {
            push_unique_warning(
                &mut warnings,
                "Actual row count is more than 10x the planner estimate.",
            );
        }
        if temp_read > 0.0 || temp_written > 0.0 {
            push_unique_warning(&mut warnings, "Plan spilled to temporary blocks.");
        }
    }
    warnings
}

fn push_unique_warning(warnings: &mut Vec<String>, warning: &str) {
    if !warnings.iter().any(|item| item == warning) {
        warnings.push(warning.to_string());
    }
}

fn insert_value_field(details: &mut Map<String, Value>, key: &str, source: &Value, field: &str) {
    if let Some(value) = source.get(field) {
        if !value.is_null() {
            details.insert(key.into(), value.clone());
        }
    }
}

fn insert_number_field(details: &mut Map<String, Value>, key: &str, source: &Value, field: &str) {
    if let Some(value) = number_field(source, field) {
        details.insert(key.into(), json!(value));
    }
}

fn insert_nested_number_field(
    details: &mut Map<String, Value>,
    key: &str,
    source: &Value,
    parent: &str,
    field: &str,
) {
    if let Some(value) = source
        .get(parent)
        .and_then(|child| number_field(child, field))
    {
        details.insert(key.into(), json!(value));
    }
}

fn number_string(source: &Value, field: &str) -> String {
    number_field(source, field)
        .map(|value| {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                format!("{value:.3}")
            }
        })
        .unwrap_or_default()
}

fn number_field(source: &Value, field: &str) -> Option<f64> {
    source.get(field).and_then(Value::as_f64)
}

fn string_field<'a>(source: &'a Value, field: &str) -> Option<&'a str> {
    source.get(field).and_then(Value::as_str)
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/postgres/query_results_tests.rs"]
mod tests;
