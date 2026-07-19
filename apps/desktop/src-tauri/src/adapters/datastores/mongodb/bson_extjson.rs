use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use mongodb::bson::{
    oid::ObjectId, spec::BinarySubtype, Binary, Bson, DateTime, Decimal128, Document, Regex,
    Timestamp, Uuid,
};
use serde_json::{json, Map, Number, Value};
use std::str::FromStr;

use super::super::super::*;

const MAX_BSON_JSON_DEPTH: usize = 32;

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

pub(super) fn mongodb_document_to_json(document: &Document) -> Value {
    document_to_json_at_depth(document, 0)
}

pub(super) fn mongodb_documents_to_json<'a>(
    documents: impl IntoIterator<Item = &'a Document>,
) -> Value {
    Value::Array(
        documents
            .into_iter()
            .map(mongodb_document_to_json)
            .collect(),
    )
}

pub(super) fn mongodb_bson_to_json(value: &Bson) -> Value {
    bson_to_json_at_depth(value, 0)
}

fn bson_to_json_at_depth(value: &Bson, depth: usize) -> Value {
    if depth >= MAX_BSON_JSON_DEPTH {
        return bson_depth_marker(value);
    }

    match value {
        Bson::Double(value) => Number::from_f64(*value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        Bson::String(value) => Value::String(value.clone()),
        Bson::Array(values) => Value::Array(
            values
                .iter()
                .map(|value| bson_to_json_at_depth(value, depth + 1))
                .collect(),
        ),
        Bson::Document(document) => document_to_json_at_depth(document, depth + 1),
        Bson::Boolean(value) => Value::Bool(*value),
        Bson::Null => Value::Null,
        Bson::RegularExpression(regex) => json!({
            "$regularExpression": {
                "pattern": regex.pattern,
                "options": regex.options,
            }
        }),
        Bson::JavaScriptCode(code) => Value::String(code.clone()),
        Bson::JavaScriptCodeWithScope(code) => json!({
            "$code": code.code,
            "$scope": document_to_json_at_depth(&code.scope, depth + 1),
        }),
        Bson::Int32(value) => Value::Number((*value).into()),
        Bson::Int64(value) => Value::Number((*value).into()),
        Bson::Timestamp(Timestamp { time, increment }) => json!({
            "$timestamp": {
                "t": time,
                "i": increment,
            }
        }),
        Bson::Binary(binary) => match standard_uuid_string(binary) {
            Some(uuid) => json!({ "$uuid": uuid }),
            None => json!({
                "$binary": {
                    "byteLength": binary.bytes.len(),
                    "subType": format!("{:?}", binary.subtype),
                }
            }),
        },
        Bson::ObjectId(object_id) => json!({ "$oid": object_id.to_hex() }),
        Bson::DateTime(date_time) => {
            json!({ "$date": { "$numberLong": date_time.timestamp_millis().to_string() } })
        }
        Bson::Symbol(value) => json!({ "$symbol": value }),
        Bson::Decimal128(value) => json!({ "$numberDecimal": value.to_string() }),
        Bson::Undefined => json!({ "$undefined": true }),
        Bson::MaxKey => json!({ "$maxKey": 1 }),
        Bson::MinKey => json!({ "$minKey": 1 }),
        Bson::DbPointer(_) => json!({
            "$dbPointer": {
                "__datapadUnsupported": true,
            }
        }),
    }
}

fn document_to_json_at_depth(document: &Document, depth: usize) -> Value {
    if depth >= MAX_BSON_JSON_DEPTH {
        return json!({
            "__datapadTruncated": true,
            "reason": "max-depth",
            "bsonType": "document",
            "fieldCount": document.len(),
        });
    }

    let mut object = Map::new();
    for (key, value) in document {
        object.insert(key.clone(), bson_to_json_at_depth(value, depth + 1));
    }
    Value::Object(object)
}

fn bson_depth_marker(value: &Bson) -> Value {
    json!({
        "__datapadTruncated": true,
        "reason": "max-depth",
        "bsonType": bson_type_label(value),
    })
}

fn bson_type_label(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "document",
        Bson::Boolean(_) => "boolean",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regularExpression",
        Bson::JavaScriptCode(_) => "javascript",
        Bson::JavaScriptCodeWithScope(_) => "javascriptWithScope",
        Bson::Int32(_) => "int32",
        Bson::Int64(_) => "int64",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(binary) if standard_uuid_string(binary).is_some() => "uuid",
        Bson::Binary(_) => "binary",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "dateTime",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal128",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
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

    if let Some(uuid) = object.get("$uuid").and_then(Value::as_str) {
        return Uuid::parse_str(uuid)
            .map(Bson::from)
            .map(Some)
            .map_err(|error| CommandError::new(code, error.to_string()));
    }

    if let Some(binary) = object.get("$binary").and_then(Value::as_object) {
        let bytes = binary
            .get("base64")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CommandError::new(code, "MongoDB `$binary.base64` must be a Base64 string.")
            })
            .and_then(|value| {
                BASE64.decode(value).map_err(|error| {
                    CommandError::new(code, format!("MongoDB binary Base64 is invalid: {error}"))
                })
            })?;
        let subtype = binary
            .get("subType")
            .and_then(Value::as_str)
            .unwrap_or("00");
        let subtype = u8::from_str_radix(subtype, 16).map_err(|error| {
            CommandError::new(code, format!("MongoDB binary subtype is invalid: {error}"))
        })?;
        return Ok(Some(Bson::Binary(Binary {
            subtype: BinarySubtype::from(subtype),
            bytes,
        })));
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

fn standard_uuid_string(binary: &Binary) -> Option<String> {
    if binary.subtype != BinarySubtype::Uuid {
        return None;
    }

    let bytes = <[u8; 16]>::try_from(binary.bytes.as_slice()).ok()?;
    Some(Uuid::from_bytes(bytes).to_string())
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
#[path = "../../../../tests/unit/adapters/datastores/mongodb/bson_extjson_tests.rs"]
mod tests;
