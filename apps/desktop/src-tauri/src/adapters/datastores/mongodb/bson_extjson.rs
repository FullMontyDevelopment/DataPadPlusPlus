use mongodb::bson::{oid::ObjectId, Bson, DateTime, Decimal128, Document, Regex, Timestamp};
use serde_json::{Number, Value};
use std::str::FromStr;

use super::super::super::*;

pub(super) fn mongodb_json_to_document(
    value: &Value,
    label: &str,
    code: &str,
) -> Result<Document, CommandError> {
    match mongodb_json_to_bson(value, code)? {
        Bson::Document(document) => Ok(document),
        _ => Err(CommandError::new(
            code,
            format!("MongoDB `{label}` must be a JSON object that can be encoded as BSON."),
        )),
    }
}

pub(super) fn mongodb_json_to_array(
    value: &Value,
    label: &str,
    code: &str,
) -> Result<Vec<Bson>, CommandError> {
    match mongodb_json_to_bson(value, code)? {
        Bson::Array(items) => Ok(items),
        _ => Err(CommandError::new(
            code,
            format!("MongoDB `{label}` must be an array."),
        )),
    }
}

pub(super) fn mongodb_json_to_bson(value: &Value, code: &str) -> Result<Bson, CommandError> {
    match value {
        Value::Null => Ok(Bson::Null),
        Value::Bool(value) => Ok(Bson::Boolean(*value)),
        Value::Number(value) => json_number_to_bson(value, code),
        Value::String(value) => Ok(Bson::String(value.clone())),
        Value::Array(values) => values
            .iter()
            .map(|value| mongodb_json_to_bson(value, code))
            .collect::<Result<Vec<Bson>, _>>()
            .map(Bson::Array),
        Value::Object(object) => {
            if object.len() == 1 {
                if let Some(native) = native_extended_json_scalar(object, code)? {
                    return Ok(native);
                }
            }

            let mut document = Document::new();
            for (key, value) in object {
                document.insert(key, mongodb_json_to_bson(value, code)?);
            }
            Ok(Bson::Document(document))
        }
    }
}

fn native_extended_json_scalar(
    object: &serde_json::Map<String, Value>,
    code: &str,
) -> Result<Option<Bson>, CommandError> {
    if let Some(oid) = object.get("$oid").and_then(Value::as_str) {
        return ObjectId::parse_str(oid)
            .map(Bson::ObjectId)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(date) = object.get("$date") {
        return extended_json_date_to_bson(date, code).map(Some);
    }

    if let Some(number_long) = object.get("$numberLong").and_then(Value::as_str) {
        return number_long
            .parse::<i64>()
            .map(Bson::Int64)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(number_int) = object.get("$numberInt").and_then(Value::as_str) {
        return number_int
            .parse::<i32>()
            .map(Bson::Int32)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(number_double) = object.get("$numberDouble").and_then(Value::as_str) {
        return number_double
            .parse::<f64>()
            .map(Bson::Double)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(number_decimal) = object.get("$numberDecimal").and_then(Value::as_str) {
        return Decimal128::from_str(number_decimal)
            .map(Bson::Decimal128)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(regex) = object.get("$regularExpression").and_then(Value::as_object) {
        let pattern = regex
            .get("pattern")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let options = regex
            .get("options")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        return Ok(Some(Bson::RegularExpression(Regex { pattern, options })));
    }

    if let Some(timestamp) = object.get("$timestamp").and_then(Value::as_object) {
        let time = timestamp
            .get("t")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or_default();
        let increment = timestamp
            .get("i")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or_default();
        return Ok(Some(Bson::Timestamp(Timestamp { time, increment })));
    }

    if object.get("$minKey").and_then(Value::as_i64) == Some(1) {
        return Ok(Some(Bson::MinKey));
    }

    if object.get("$maxKey").and_then(Value::as_i64) == Some(1) {
        return Ok(Some(Bson::MaxKey));
    }

    Ok(None)
}

fn extended_json_date_to_bson(value: &Value, code: &str) -> Result<Bson, CommandError> {
    if let Some(date) = value.as_str() {
        return DateTime::parse_rfc3339_str(date)
            .map(Bson::DateTime)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(milliseconds) = value
        .as_object()
        .and_then(|object| object.get("$numberLong"))
        .and_then(Value::as_str)
    {
        return milliseconds
            .parse::<i64>()
            .map(DateTime::from_millis)
            .map(Bson::DateTime)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    Err(CommandError::new(
        code,
        "MongoDB `$date` values must be an ISO date string or `{ \"$numberLong\": \"...\" }`.",
    ))
}

fn json_number_to_bson(value: &Number, code: &str) -> Result<Bson, CommandError> {
    if let Some(value) = value.as_i64() {
        return Ok(Bson::Int64(value));
    }

    if let Some(value) = value.as_f64() {
        return Ok(Bson::Double(value));
    }

    Err(CommandError::new(
        code,
        "MongoDB number could not be represented as BSON.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_common_extended_json_scalars_to_native_bson() {
        assert!(matches!(
            mongodb_json_to_bson(&json!({ "$oid": "507f1f77bcf86cd799439011" }), "test")
                .expect("object id"),
            Bson::ObjectId(_)
        ));
        assert!(matches!(
            mongodb_json_to_bson(&json!({ "$date": "2026-05-16T10:02:21.369Z" }), "test")
                .expect("date"),
            Bson::DateTime(_)
        ));
        assert!(matches!(
            mongodb_json_to_bson(
                &json!({ "$date": { "$numberLong": "1778925741369" } }),
                "test"
            )
            .expect("date millis"),
            Bson::DateTime(_)
        ));
        assert_eq!(
            mongodb_json_to_bson(&json!({ "$numberLong": "42" }), "test").expect("long"),
            Bson::Int64(42)
        );
    }

    #[test]
    fn preserves_mongo_operators_while_converting_nested_native_scalars() {
        let document = mongodb_json_to_document(
            &json!({
                "createdAt": { "$gte": { "$date": "2026-05-16T10:02:21.369Z" } },
                "_id": { "$oid": "507f1f77bcf86cd799439011" }
            }),
            "filter",
            "test",
        )
        .expect("document");

        assert!(matches!(
            document
                .get_document("createdAt")
                .expect("operator")
                .get("$gte"),
            Some(Bson::DateTime(_))
        ));
        assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
    }
}
