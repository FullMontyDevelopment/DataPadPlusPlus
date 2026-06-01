use std::time::Instant;

use serde_json::json;

use super::super::super::*;
use super::connection::clickhouse_query;
use super::payloads::clickhouse_json_payloads_bounded;
use super::ClickHouseAdapter;

pub(super) async fn execute_clickhouse_query(
    adapter: &ClickHouseAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "clickhouse-query-missing",
            "No ClickHouse SQL was provided.",
        ));
    }
    if connection.read_only && is_mutating_clickhouse(statement) {
        return Err(CommandError::new(
            "clickhouse-read-only",
            "This ClickHouse profile is read-only; write, DDL, administrative, and system statements are blocked before execution.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query = clickhouse_statement_for_mode(statement, execute_mode(request), row_limit);
    let raw = clickhouse_query(connection, &query).await?;
    let (payloads, row_count, truncated) = if execute_mode(request) == "explain" {
        (
            vec![
                clickhouse_plan_payload(&query, &raw),
                payload_raw(raw.trim().to_string()),
            ],
            raw.lines().count() as u32,
            false,
        )
    } else {
        let result = clickhouse_json_payloads_bounded(&raw, Some(row_limit));
        (result.payloads, result.row_count, result.truncated)
    };
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("ClickHouse query loaded the first {row_count} row(s).")
        } else {
            format!("ClickHouse query returned {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

pub(crate) fn clickhouse_statement_for_mode(statement: &str, mode: &str, row_limit: u32) -> String {
    let trimmed = statement.trim().trim_end_matches(';');
    let lower = trimmed.to_ascii_lowercase();
    match mode {
        "explain" if lower.starts_with("explain") => trimmed.to_string(),
        "explain" => format!("EXPLAIN PIPELINE {trimmed}"),
        _ if lower.contains(" format ") => trimmed.to_string(),
        _ if is_wrappable_select(trimmed) => {
            format!(
                "SELECT * FROM ({trimmed}) AS datapad_limited_result LIMIT {} FORMAT JSON",
                row_limit.saturating_add(1)
            )
        }
        _ => format!("{trimmed} FORMAT JSON"),
    }
}

pub(crate) fn is_mutating_clickhouse(statement: &str) -> bool {
    let first = statement
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '(')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    matches!(
        first.as_str(),
        "alter"
            | "attach"
            | "check"
            | "create"
            | "delete"
            | "detach"
            | "drop"
            | "exchange"
            | "grant"
            | "insert"
            | "kill"
            | "optimize"
            | "rename"
            | "replace"
            | "revoke"
            | "set"
            | "system"
            | "truncate"
            | "update"
            | "use"
            | "watch"
    )
}

fn is_wrappable_select(statement: &str) -> bool {
    let lower = statement.trim_start().to_ascii_lowercase();
    lower.starts_with("select ") || lower.starts_with("with ")
}

fn clickhouse_plan_payload(query: &str, raw: &str) -> serde_json::Value {
    let plan = raw
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<&str>>();

    payload_plan(
        "pipeline",
        json!({
            "statement": query,
            "plan": plan,
        }),
        "ClickHouse EXPLAIN PIPELINE returned successfully.",
    )
}

#[cfg(test)]
mod tests {
    use super::{clickhouse_statement_for_mode, is_mutating_clickhouse};

    #[test]
    fn clickhouse_statement_wraps_select_with_row_limit_and_json_format() {
        assert_eq!(
            clickhouse_statement_for_mode("select id from events;", "full", 100),
            "SELECT * FROM (select id from events) AS datapad_limited_result LIMIT 101 FORMAT JSON"
        );
    }

    #[test]
    fn clickhouse_statement_preserves_explicit_format() {
        assert_eq!(
            clickhouse_statement_for_mode("SELECT 1 FORMAT TSV", "full", 100),
            "SELECT 1 FORMAT TSV"
        );
    }

    #[test]
    fn clickhouse_statement_uses_native_pipeline_explain() {
        assert_eq!(
            clickhouse_statement_for_mode("select id from events", "explain", 100),
            "EXPLAIN PIPELINE select id from events"
        );
        assert_eq!(
            clickhouse_statement_for_mode("EXPLAIN SELECT 1", "explain", 100),
            "EXPLAIN SELECT 1"
        );
    }

    #[test]
    fn clickhouse_read_only_guard_detects_mutations() {
        assert!(is_mutating_clickhouse(
            "ALTER TABLE events DELETE WHERE id = 1"
        ));
        assert!(is_mutating_clickhouse("SYSTEM FLUSH LOGS"));
        assert!(is_mutating_clickhouse("INSERT INTO events VALUES (1)"));
        assert!(!is_mutating_clickhouse("select * from events"));
        assert!(!is_mutating_clickhouse(
            "with events as (select 1) select * from events"
        ));
    }
}
