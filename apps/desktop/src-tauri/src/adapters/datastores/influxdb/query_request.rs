use serde_json::Value;

use super::super::super::*;
use super::connection::{influxdb_query_path, percent_encode_query};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InfluxDbQueryRequest {
    pub(super) database: String,
    pub(super) path: String,
    pub(super) query: String,
    pub(super) kind: &'static str,
}

pub(super) fn influxdb_query_request(
    query_text: &str,
    default_database: &str,
) -> Result<InfluxDbQueryRequest, CommandError> {
    let spec = parse_influxdb_query_spec(query_text)?;
    let (query, database, epoch) = match spec {
        Some(value) => {
            let query = value
                .get("query")
                .or_else(|| value.get("q"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|query| !query.is_empty())
                .ok_or_else(|| {
                    CommandError::new(
                        "influxdb-query-spec-invalid",
                        "InfluxDB structured query JSON must include a non-empty query string.",
                    )
                })?;
            if value.get("chunked").and_then(Value::as_bool) == Some(true) {
                return Err(CommandError::new(
                    "influxdb-query-spec-invalid",
                    "InfluxDB chunked query responses are not supported in the workbench view yet.",
                ));
            }
            let database = value
                .get("database")
                .or_else(|| value.get("db"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|database| !database.is_empty())
                .unwrap_or(default_database);
            let epoch = value
                .get("epoch")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|epoch| !epoch.is_empty())
                .map(str::to_string);
            (query.to_string(), database.to_string(), epoch)
        }
        None => (query_text.to_string(), default_database.to_string(), None),
    };

    if !is_read_only_influxql(&query) {
        return Err(CommandError::new(
            "influxdb-write-preview-only",
            "InfluxDB writes, retention changes, user changes, and SELECT INTO are operation-plan preview only in this adapter phase.",
        ));
    }

    let kind = influxdb_query_kind(&query);
    let mut path = influxdb_query_path(&database, &query);
    if let Some(epoch) = epoch {
        path.push_str("&epoch=");
        path.push_str(&percent_encode_query(&epoch));
    }

    Ok(InfluxDbQueryRequest {
        database,
        path,
        query,
        kind,
    })
}

fn parse_influxdb_query_spec(query_text: &str) -> Result<Option<Value>, CommandError> {
    let trimmed = query_text.trim_start();
    if !trimmed.starts_with('{') {
        return Ok(None);
    }
    let value = serde_json::from_str::<Value>(query_text).map_err(|error| {
        CommandError::new(
            "influxdb-query-spec-invalid",
            format!("InfluxDB structured query JSON is invalid: {error}"),
        )
    })?;
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if !object.contains_key("query") && !object.contains_key("q") {
        return Err(CommandError::new(
            "influxdb-query-spec-invalid",
            "InfluxDB structured query JSON must include query.",
        ));
    }
    Ok(Some(value))
}

pub(super) fn is_read_only_influxql(query: &str) -> bool {
    let normalized = normalized_influxql(query);
    if normalized.is_empty() {
        return false;
    }

    if normalized.starts_with("select ") || normalized == "select" {
        return !normalized.contains(" into ");
    }

    normalized.starts_with("show ")
        || normalized == "show"
        || normalized.starts_with("explain ")
        || normalized == "explain"
}

fn influxdb_query_kind(query: &str) -> &'static str {
    let normalized = normalized_influxql(query);
    if normalized.starts_with("show ") || normalized == "show" {
        "metadata"
    } else if normalized.starts_with("explain ") || normalized == "explain" {
        "explain"
    } else {
        "select"
    }
}

fn normalized_influxql(query: &str) -> String {
    query
        .lines()
        .map(|line| line.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{influxdb_query_request, is_read_only_influxql};

    #[test]
    fn influxdb_raw_select_builds_query_path() {
        let request = influxdb_query_request("SELECT mean(value) FROM cpu", "telegraf").unwrap();

        assert_eq!(request.database, "telegraf");
        assert_eq!(request.kind, "select");
        assert!(request.path.starts_with("/query?db=telegraf&q=SELECT+mean"));
    }

    #[test]
    fn influxdb_structured_query_can_override_database_and_epoch() {
        let request = influxdb_query_request(
            r#"{ "database": "ops", "query": "SHOW MEASUREMENTS", "epoch": "ns" }"#,
            "telegraf",
        )
        .unwrap();

        assert_eq!(request.database, "ops");
        assert_eq!(request.kind, "metadata");
        assert!(request.path.contains("db=ops"));
        assert!(request.path.contains("epoch=ns"));
    }

    #[test]
    fn influxdb_structured_query_rejects_chunked_responses() {
        let error = influxdb_query_request(
            r#"{ "query": "SELECT * FROM cpu", "chunked": true }"#,
            "telegraf",
        )
        .unwrap_err();

        assert_eq!(error.code, "influxdb-query-spec-invalid");
    }

    #[test]
    fn influxdb_read_only_guard_blocks_mutating_queries() {
        assert!(is_read_only_influxql("SHOW MEASUREMENTS"));
        assert!(is_read_only_influxql("EXPLAIN ANALYZE SELECT * FROM cpu"));
        assert!(is_read_only_influxql("SELECT * FROM cpu"));

        assert!(!is_read_only_influxql("SELECT * INTO backup FROM cpu"));
        assert!(!is_read_only_influxql("DROP MEASUREMENT cpu"));
        assert!(!is_read_only_influxql(
            "CREATE RETENTION POLICY rp ON db DURATION 1d REPLICATION 1"
        ));
    }
}
