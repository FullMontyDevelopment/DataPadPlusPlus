use serde_json::{json, Value};

use super::*;

const SECRET_REPLACEMENT: &str = "********";

pub(super) fn generated_edit_request(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> String {
    match connection.engine.as_str() {
        "mongodb" => mongo_edit_request(request),
        "redis" | "valkey" => keyvalue_edit_request(request),
        "dynamodb" => dynamodb_edit_request(request),
        "cassandra" => cassandra_edit_request(request),
        "elasticsearch" | "opensearch" => search_edit_request(request),
        "postgresql" | "cockroachdb" | "timescaledb" => sql_edit_request(request, "\"", "\"", "$"),
        "sqlserver" => sql_edit_request(request, "[", "]", "@p"),
        "mysql" | "mariadb" => sql_edit_request(request, "`", "`", "?"),
        _ => sql_edit_request(request, "\"", "\"", "?"),
    }
}

fn sql_edit_request(
    request: &DataEditPlanRequest,
    quote_start: &str,
    quote_end: &str,
    parameter_prefix: &str,
) -> String {
    let table = sql_table_name(request, quote_start, quote_end);
    let where_clause = primary_key_predicate(request, quote_start, quote_end, parameter_prefix);

    match request.edit_kind.as_str() {
        "insert-row" => {
            let fields = request
                .changes
                .iter()
                .filter_map(|change| change.field.as_deref())
                .map(|field| quote_identifier(field, quote_start, quote_end))
                .collect::<Vec<_>>();
            let values = (1..=fields.len())
                .map(|index| parameter(parameter_prefix, index))
                .collect::<Vec<_>>();

            format!(
                "insert into {table} ({}) values ({});",
                fields.join(", "),
                values.join(", ")
            )
        }
        "delete-row" => format!("delete from {table}{where_clause};"),
        _ => {
            let assignments = request
                .changes
                .iter()
                .enumerate()
                .filter_map(|(index, change)| {
                    change.field.as_deref().map(|field| {
                        format!(
                            "{} = {}",
                            quote_identifier(field, quote_start, quote_end),
                            parameter(parameter_prefix, index + 1)
                        )
                    })
                })
                .collect::<Vec<_>>();

            format!(
                "update {table} set {}{where_clause};",
                assignments.join(", ")
            )
        }
    }
}

fn sql_table_name(request: &DataEditPlanRequest, quote_start: &str, quote_end: &str) -> String {
    let table = request.target.table.as_deref().unwrap_or("<table>");
    let table = quote_identifier(table, quote_start, quote_end);

    request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| {
            format!(
                "{}.{}",
                quote_identifier(schema, quote_start, quote_end),
                table
            )
        })
        .unwrap_or(table)
}

fn primary_key_predicate(
    request: &DataEditPlanRequest,
    quote_start: &str,
    quote_end: &str,
    parameter_prefix: &str,
) -> String {
    let Some(primary_key) = &request.target.primary_key else {
        return " where <primary-key> = <value>".into();
    };
    let offset = request.changes.len();
    let parts = primary_key
        .keys()
        .enumerate()
        .map(|(index, key)| {
            format!(
                "{} = {}",
                quote_identifier(key, quote_start, quote_end),
                parameter(parameter_prefix, offset + index + 1)
            )
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        " where <primary-key> = <value>".into()
    } else {
        format!(" where {}", parts.join(" and "))
    }
}

fn mongo_edit_request(request: &DataEditPlanRequest) -> String {
    let database = request.target.database.as_deref().unwrap_or("<database>");
    let collection = request
        .target
        .collection
        .as_deref()
        .unwrap_or("<collection>");

    if request.edit_kind == "insert-document" {
        return serde_json::to_string_pretty(&json!({
            "database": database,
            "collection": collection,
            "operation": "insertOne",
            "document": request
                .changes
                .first()
                .and_then(|change| change.value.clone())
                .unwrap_or(Value::Object(Default::default()))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    let filter = json!({
        "_id": request
            .target
            .document_id
            .clone()
            .unwrap_or(Value::String("<_id>".into()))
    });
    let update = match request.edit_kind.as_str() {
        "unset-field" => json!({ "$unset": document_path_object(request, "") }),
        "rename-field" => json!({ "$rename": document_rename_object(request) }),
        "change-field-type" | "set-field" => json!({ "$set": document_value_object(request) }),
        _ => json!({ "$set": document_value_object(request) }),
    };

    serde_json::to_string_pretty(&json!({
        "database": database,
        "collection": collection,
        "filter": filter,
        "update": update,
        "multi": false
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn document_value_object(request: &DataEditPlanRequest) -> Value {
    let entries = request
        .changes
        .iter()
        .filter_map(|change| {
            let path = change
                .path
                .clone()
                .filter(|path| !path.is_empty())
                .map(|path| path.join("."))
                .or_else(|| change.field.clone())?;
            Some((path, change.value.clone().unwrap_or(Value::Null)))
        })
        .collect::<serde_json::Map<_, _>>();

    Value::Object(entries)
}

fn document_path_object(request: &DataEditPlanRequest, value: &str) -> Value {
    let entries = request
        .changes
        .iter()
        .filter_map(|change| {
            let path = change
                .path
                .clone()
                .filter(|path| !path.is_empty())
                .map(|path| path.join("."))
                .or_else(|| change.field.clone())?;
            Some((path, Value::String(value.into())))
        })
        .collect::<serde_json::Map<_, _>>();

    Value::Object(entries)
}

fn document_rename_object(request: &DataEditPlanRequest) -> Value {
    let entries = request
        .changes
        .iter()
        .filter_map(|change| {
            let path = change
                .path
                .clone()
                .filter(|path| !path.is_empty())
                .map(|path| path.join("."))
                .or_else(|| change.field.clone())?;
            let new_name = change.new_name.clone().unwrap_or_else(|| path.clone());
            Some((path, Value::String(new_name)))
        })
        .collect::<serde_json::Map<_, _>>();

    Value::Object(entries)
}

fn keyvalue_edit_request(request: &DataEditPlanRequest) -> String {
    let key = request.target.key.as_deref().unwrap_or("<key>");

    match request.edit_kind.as_str() {
        "set-ttl" => format!(
            "EXPIRE {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .map(value_to_command_arg)
                .unwrap_or_else(|| "<seconds>".into())
        ),
        "delete-key" => format!("DEL {key}"),
        "rename-key" => format!(
            "RENAME {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.new_name.clone())
                .unwrap_or_else(|| "<new-key>".into())
        ),
        "persist-ttl" => format!("PERSIST {key}"),
        "hash-set-field" => format!(
            "HSET {key} {} {}",
            request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .or_else(|| request
                    .changes
                    .first()
                    .and_then(|change| change.path.as_ref().and_then(|path| path.first().cloned())))
                .unwrap_or_else(|| "<field>".into()),
            request
                .changes
                .first()
                .map(|change| {
                    secret_aware_command_value(
                        change
                            .field
                            .as_deref()
                            .or_else(|| {
                                change
                                    .path
                                    .as_ref()
                                    .and_then(|path| path.first().map(String::as_str))
                            })
                            .unwrap_or("<field>"),
                        change.value.as_ref(),
                    )
                })
                .unwrap_or_else(|| "<value>".into())
        ),
        "hash-delete-field" => format!(
            "HDEL {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .unwrap_or_else(|| "<field>".into())
        ),
        "list-set-index" => format!(
            "LSET {key} {} {}",
            request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .unwrap_or_else(|| "<index>".into()),
            request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .map(value_to_command_arg)
                .unwrap_or_else(|| "<value>".into())
        ),
        "set-add-member" => format!(
            "SADD {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .map(value_to_command_arg)
                .unwrap_or_else(|| "<member>".into())
        ),
        "set-remove-member" => format!(
            "SREM {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .map(value_to_command_arg)
                .unwrap_or_else(|| "<member>".into())
        ),
        "zset-add-member" => format!("ZADD {key} <score> <member>"),
        "zset-remove-member" => format!(
            "ZREM {key} {}",
            request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .unwrap_or_else(|| "<member>".into())
        ),
        _ => format!(
            "SET {key} {}",
            request
                .changes
                .first()
                .map(|change| secret_aware_command_value(key, change.value.as_ref()))
                .unwrap_or_else(|| "<value>".into())
        ),
    }
}

fn dynamodb_edit_request(request: &DataEditPlanRequest) -> String {
    let table = request.target.table.as_deref().unwrap_or("<table>");
    serde_json::to_string_pretty(&json!({
        "TableName": table,
        "Key": request.target.item_key.clone().unwrap_or_default(),
        "UpdateExpression": "SET #field = :value",
        "ExpressionAttributeNames": {
            "#field": request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .unwrap_or_else(|| "<field>".into())
        },
        "ExpressionAttributeValues": {
            ":value": request
                .changes
                .first()
                .map(|change| {
                    secret_aware_json_value(
                        change.field.as_deref().unwrap_or("<field>"),
                        change.value.clone().unwrap_or(Value::String("<value>".into())),
                    )
                })
                .unwrap_or(Value::String("<value>".into()))
        },
        "ReturnValues": "ALL_NEW"
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn search_edit_request(request: &DataEditPlanRequest) -> String {
    let index = request
        .target
        .table
        .as_deref()
        .or(request.target.collection.as_deref())
        .unwrap_or("<index>");
    let document_id = request
        .target
        .document_id
        .as_ref()
        .map(value_to_command_arg)
        .or_else(|| request.target.key.clone())
        .unwrap_or_else(|| "<document_id>".into());
    let document = request
        .changes
        .iter()
        .filter_map(|change| {
            let field = change
                .field
                .clone()
                .or_else(|| change.path.as_ref().map(|path| path.join(".")))?;
            Some((field, change.value.clone().unwrap_or(Value::Null)))
        })
        .collect::<serde_json::Map<_, _>>();
    let body = match request.edit_kind.as_str() {
        "update-document" => json!({ "doc": document }),
        "delete-document" => Value::Null,
        _ => Value::Object(document),
    };
    let method = match request.edit_kind.as_str() {
        "update-document" => "POST",
        "delete-document" => "DELETE",
        _ => "PUT",
    };
    let path = match request.edit_kind.as_str() {
        "update-document" => format!("/{index}/_update/{document_id}?refresh=true"),
        _ => format!("/{index}/_doc/{document_id}?refresh=true"),
    };

    if body.is_null() {
        format!("{method} {path}")
    } else {
        format!(
            "{method} {path}\n{}",
            serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into())
        )
    }
}

fn cassandra_edit_request(request: &DataEditPlanRequest) -> String {
    let keyspace = request.target.schema.as_deref().unwrap_or("<keyspace>");
    let table = request.target.table.as_deref().unwrap_or("<table>");
    let fields = request
        .changes
        .iter()
        .filter_map(|change| change.field.as_deref())
        .map(|field| format!("{field} = ?"))
        .collect::<Vec<_>>()
        .join(", ");
    let predicates = request
        .target
        .primary_key
        .as_ref()
        .map(|keys| {
            keys.keys()
                .map(|key| format!("{key} = ?"))
                .collect::<Vec<_>>()
                .join(" and ")
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "<complete_primary_key> = ?".into());

    format!("update {keyspace}.{table} set {fields} where {predicates};")
}

fn quote_identifier(identifier: &str, quote_start: &str, quote_end: &str) -> String {
    let escaped = identifier.replace(quote_end, &format!("{quote_end}{quote_end}"));
    format!("{quote_start}{escaped}{quote_end}")
}

fn parameter(prefix: &str, index: usize) -> String {
    if prefix == "?" {
        "?".into()
    } else {
        format!("{prefix}{index}")
    }
}

fn value_to_command_arg(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn secret_aware_command_value(name: &str, value: Option<&Value>) -> String {
    if is_secret_like_name(name) {
        SECRET_REPLACEMENT.into()
    } else {
        value
            .map(value_to_command_arg)
            .unwrap_or_else(|| "<value>".into())
    }
}

fn secret_aware_json_value(name: &str, value: Value) -> Value {
    if is_secret_like_name(name) {
        Value::String(SECRET_REPLACEMENT.into())
    } else {
        value
    }
}

fn is_secret_like_name(value: &str) -> bool {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();

    normalized.split('_').any(|part| {
        matches!(
            part,
            "password"
                | "pwd"
                | "pass"
                | "token"
                | "secret"
                | "secretkey"
                | "apikey"
                | "authtoken"
                | "accesstoken"
        )
    }) || normalized.contains("api_key")
        || normalized.contains("auth_token")
        || normalized.contains("access_token")
}
