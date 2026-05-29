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
    let query = if execute_mode(request) == "explain" {
        format!("SET SHOWPLAN_TEXT ON; {statement}; SET SHOWPLAN_TEXT OFF;")
    } else {
        statement.to_string()
    };
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let mut client = sqlserver_client(connection).await?;
    let results = client.simple_query(query).await?.into_results().await?;
    let first_result = results.into_iter().next().unwrap_or_default();
    let columns = first_result
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_else(Vec::new);
    let total_rows = first_result.len();
    let tabular_rows = first_result
        .iter()
        .take(row_limit as usize)
        .map(|row| {
            row.cells()
                .map(|(_, value)| stringify_tiberius_cell(value))
                .collect()
        })
        .collect::<Vec<Vec<String>>>();

    let primary_payload = if execute_mode(request) == "explain" {
        payload_raw(
            tabular_rows
                .iter()
                .flat_map(|row| row.iter().cloned())
                .collect::<Vec<String>>()
                .join("\n"),
        )
    } else if columns.is_empty() {
        payload_raw("Statement executed successfully.".into())
    } else {
        payload_table(columns.clone(), tabular_rows)
    };
    let explain_payload = if execute_mode(request) == "explain" {
        Some(primary_payload.clone())
    } else {
        None
    };

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("{total_rows} row(s) returned from {}.", connection.name),
        default_renderer: if execute_mode(request) == "explain" {
            "raw"
        } else {
            "table"
        },
        renderer_modes: if execute_mode(request) == "explain" {
            vec!["raw", "table", "json"]
        } else {
            vec!["table", "json", "raw"]
        },
        payloads: vec![
            primary_payload,
            payload_json(json!({
                "engine": connection.engine,
                "rowCount": total_rows,
                "rowLimit": row_limit,
            })),
            payload_raw(statement.to_string()),
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: total_rows > row_limit as usize,
        explain_payload,
    }))
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use chrono::NaiveDate;
    use tiberius::{
        time::{Date, DateTime2, DateTimeOffset, Time},
        xml::XmlData,
        ColumnData,
    };

    use super::stringify_tiberius_cell;

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
