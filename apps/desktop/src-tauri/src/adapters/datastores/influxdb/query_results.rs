use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedInfluxDbResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) series: Value,
    pub(super) statement_count: usize,
    pub(super) total_rows: usize,
    pub(super) truncated: bool,
}

#[derive(Clone)]
struct InfluxDbSeries {
    name: String,
    tags: Value,
    columns: Vec<String>,
    values: Vec<Value>,
}

pub(super) fn validate_influxdb_response(value: &Value) -> Result<(), CommandError> {
    if let Some(error) = first_influxdb_error(value) {
        return Err(CommandError::new(
            "influxdb-query-error",
            format!("InfluxDB query failed: {error}"),
        ));
    }
    Ok(())
}

pub(super) fn normalize_influxdb_query_result(
    value: &Value,
    row_limit: u32,
) -> NormalizedInfluxDbResult {
    let series_items = influxdb_series_items(value);
    let sample_columns = sample_columns(&series_items);
    let mut rows = Vec::<Vec<String>>::new();
    let mut normalized_series = Vec::<Value>::new();
    let mut total_rows = 0usize;

    for series in &series_items {
        total_rows += series.values.len();
        let mut bounded_values = Vec::new();
        for value_row in &series.values {
            if rows.len() >= row_limit as usize {
                break;
            }
            let values = value_row.as_array().cloned().unwrap_or_default();
            let mut row = vec![series.name.clone(), series.tags.to_string()];
            for column in &sample_columns {
                let value = series
                    .columns
                    .iter()
                    .position(|item| item == column)
                    .and_then(|index| values.get(index))
                    .map(influxdb_value_to_string)
                    .unwrap_or_default();
                row.push(value);
            }
            rows.push(row);
            bounded_values.push(value_row.clone());
        }

        if !bounded_values.is_empty() {
            normalized_series.push(json!({
                "name": series.name,
                "tags": series.tags,
                "columns": series.columns,
                "values": bounded_values,
            }));
        }
    }

    let mut table_columns = vec!["measurement".into(), "tags".into()];
    table_columns.extend(sample_columns);
    NormalizedInfluxDbResult {
        columns: table_columns,
        rows,
        series: Value::Array(normalized_series),
        statement_count: value
            .get("results")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or_default(),
        total_rows,
        truncated: total_rows > row_limit as usize,
    }
}

fn first_influxdb_error(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find_map(|result| {
                    result
                        .get("error")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        })
}

fn influxdb_series_items(value: &Value) -> Vec<InfluxDbSeries> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|result| {
            result
                .get("series")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .map(|series| InfluxDbSeries {
            name: series
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("series")
                .to_string(),
            tags: series.get("tags").cloned().unwrap_or_else(|| json!({})),
            columns: series
                .get("columns")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
            values: series
                .get("values")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        })
        .collect()
}

fn sample_columns(series_items: &[InfluxDbSeries]) -> Vec<String> {
    let mut columns = Vec::<String>::new();
    for series in series_items {
        for column in &series.columns {
            if !columns.contains(column) {
                columns.push(column.clone());
            }
        }
    }
    columns
}

fn influxdb_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{normalize_influxdb_query_result, validate_influxdb_response};

    #[test]
    fn influxdb_result_normalizes_series_to_table_rows() {
        let value = json!({
            "results": [{
                "series": [{
                    "name": "cpu",
                    "tags": { "host": "app-1" },
                    "columns": ["time", "usage_user"],
                    "values": [["2026-04-25T10:00:00Z", 42.5]]
                }]
            }]
        });
        let normalized = normalize_influxdb_query_result(&value, 100);

        assert_eq!(
            normalized.columns,
            vec!["measurement", "tags", "time", "usage_user"]
        );
        assert_eq!(normalized.rows.len(), 1);
        assert_eq!(normalized.rows[0][0], "cpu");
        assert_eq!(normalized.rows[0][3], "42.5");
        assert_eq!(normalized.series.as_array().unwrap().len(), 1);
        assert!(!normalized.truncated);
    }

    #[test]
    fn influxdb_result_respects_row_limit_and_series_payload_bound() {
        let value = json!({
            "results": [{
                "series": [{
                    "name": "cpu",
                    "columns": ["time", "value"],
                    "values": [[1, 2], [3, 4]]
                }]
            }]
        });
        let normalized = normalize_influxdb_query_result(&value, 1);

        assert_eq!(normalized.rows.len(), 1);
        assert_eq!(normalized.total_rows, 2);
        assert!(normalized.truncated);
        assert_eq!(normalized.series[0]["values"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn influxdb_result_rows_keep_column_width_when_later_series_add_columns() {
        let value = json!({
            "results": [{
                "series": [
                    {
                        "name": "cpu",
                        "columns": ["time", "usage_user"],
                        "values": [[1, 2]]
                    },
                    {
                        "name": "mem",
                        "columns": ["time", "used", "free"],
                        "values": [[1, 90, 10]]
                    }
                ]
            }]
        });
        let normalized = normalize_influxdb_query_result(&value, 100);

        assert_eq!(
            normalized.columns,
            vec!["measurement", "tags", "time", "usage_user", "used", "free"]
        );
        assert_eq!(normalized.rows[0].len(), normalized.columns.len());
        assert_eq!(normalized.rows[1].len(), normalized.columns.len());
        assert_eq!(normalized.rows[0][4], "");
        assert_eq!(normalized.rows[1][4], "90");
    }

    #[test]
    fn influxdb_response_errors_become_command_errors() {
        let value = json!({
            "results": [{
                "statement_id": 0,
                "error": "measurement not found"
            }]
        });

        let error = validate_influxdb_response(&value).unwrap_err();

        assert_eq!(error.code, "influxdb-query-error");
        assert!(error.message.contains("measurement not found"));
    }
}
