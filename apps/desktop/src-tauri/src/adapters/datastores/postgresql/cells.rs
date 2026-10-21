use sqlx::types::{
    chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc},
    BigDecimal, Uuid,
};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::super::super::*;

pub(crate) fn stringify_pg_cell(row: &sqlx::postgres::PgRow, index: usize) -> String {
    if row.try_get_raw(index).is_ok_and(|value| value.is_null()) {
        return "null".into();
    }
    stringify_sqlx_common(
        [
            row.try_get::<Option<String>, _>(index).ok().flatten(),
            row.try_get::<Option<DateTime<Utc>>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_rfc3339()),
            row.try_get::<Option<NaiveDateTime>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<NaiveDate>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<NaiveTime>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<BigDecimal>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<Uuid>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<bool>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i32>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<f64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<serde_json::Value>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|item| crate::adapters::result_stream::binary_hex(&item)),
        ],
        format!("<{}>", row.columns()[index].type_info().name()),
    )
}

pub(crate) fn export_pg_cell(
    row: &sqlx::postgres::PgRow,
    index: usize,
) -> Result<Value, CommandError> {
    if row.try_get_raw(index)?.is_null() {
        return Ok(Value::Null);
    }
    macro_rules! scalar {
        ($($ty:ty),+) => { $(if let Ok(value) = row.try_get::<$ty, _>(index) { return Ok(serde_json::json!(value)); })+ };
    }
    scalar!(bool, i64, i32, i16, serde_json::Value, String);
    macro_rules! formatted {
        ($($ty:ty),+) => { $(if let Ok(value) = row.try_get::<$ty, _>(index) { return Ok(Value::String(value.to_string())); })+ };
    }
    formatted!(
        BigDecimal,
        Uuid,
        DateTime<Utc>,
        NaiveDateTime,
        NaiveDate,
        NaiveTime
    );
    if let Ok(value) = row.try_get::<f64, _>(index) {
        return Ok(if value.is_finite() {
            serde_json::json!(value)
        } else {
            Value::String(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<f32, _>(index) {
        return Ok(if value.is_finite() {
            serde_json::json!(value)
        } else {
            Value::String(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
        return Ok(Value::String(crate::adapters::result_stream::binary_hex(
            &value,
        )));
    }
    scalar!(
        Vec<Option<String>>,
        Vec<Option<bool>>,
        Vec<Option<i64>>,
        Vec<Option<i32>>,
        Vec<Option<i16>>,
        Vec<Option<serde_json::Value>>
    );
    Err(CommandError::new("result-export-type", "A PostgreSQL column has a type this export codec cannot preserve. Cast it explicitly in the query before exporting."))
}
