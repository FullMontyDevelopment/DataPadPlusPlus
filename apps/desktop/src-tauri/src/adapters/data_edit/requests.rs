use serde_json::{json, Map, Value};

use super::*;

const SECRET_REPLACEMENT: &str = "********";

pub(super) fn generated_edit_request(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> String {
    match connection.engine.as_str() {
        "mongodb" => mongo_edit_request(request),
        "litedb" => litedb_edit_request(request),
        "redis" | "valkey" => keyvalue_edit_request(request),
        "dynamodb" => dynamodb_edit_request(request),
        "cassandra" => cassandra_edit_request(request),
        "elasticsearch" | "opensearch" => search_edit_request(request),
        "oracle" => oracle_sql_edit_request(request),
        "postgresql" | "cockroachdb" => sql_edit_request(request, "\"", "\"", "$"),
        "timescaledb" => timescale_sql_edit_request(request),
        "sqlserver" => sql_edit_request(request, "[", "]", "@p"),
        "mysql" | "mariadb" => sql_edit_request(request, "`", "`", "?"),
        _ => sql_edit_request(request, "\"", "\"", "?"),
    }
}

fn litedb_edit_request(request: &DataEditPlanRequest) -> String {
    let collection = request
        .target
        .collection
        .as_deref()
        .unwrap_or("<collection>");
    let id = request
        .target
        .document_id
        .clone()
        .or_else(|| {
            request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .and_then(|value| value.get("_id").cloned())
        })
        .unwrap_or(Value::String("<_id>".into()));

    let request_value = match request.edit_kind.as_str() {
        "insert-document" => json!({
            "operation": "InsertDocument",
            "collection": collection,
            "id": id,
            "document": request
                .changes
                .first()
                .and_then(|change| change.value.clone())
                .unwrap_or(Value::Object(Default::default())),
            "evidenceRequests": {
                "before": null,
                "after": { "operation": "FindById", "collection": collection, "id": id }
            }
        }),
        "update-document" => json!({
            "operation": "UpdateDocument",
            "collection": collection,
            "id": id,
            "document": request
                .changes
                .first()
                .and_then(|change| change.value.clone())
                .unwrap_or(Value::Object(Default::default())),
            "evidenceRequests": {
                "before": { "operation": "FindById", "collection": collection, "id": id },
                "after": { "operation": "FindById", "collection": collection, "id": id }
            }
        }),
        "delete-document" => json!({
            "operation": "DeleteDocument",
            "collection": collection,
            "id": id,
            "evidenceRequests": {
                "before": { "operation": "FindById", "collection": collection, "id": id },
                "after": { "operation": "FindById", "collection": collection, "id": id }
            }
        }),
        _ => json!({
            "operation": "UnsupportedDocumentEdit",
            "collection": collection,
            "requestedEditKind": request.edit_kind,
            "disabledReason": "LiteDB live document editing is currently scoped to insert-document, update-document, and delete-document."
        }),
    };

    serde_json::to_string_pretty(&request_value).unwrap_or_else(|_| "{}".into())
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
    primary_key_predicate_with_offset(
        request,
        quote_start,
        quote_end,
        parameter_prefix,
        request.changes.len(),
    )
}

fn primary_key_predicate_with_offset(
    request: &DataEditPlanRequest,
    quote_start: &str,
    quote_end: &str,
    parameter_prefix: &str,
    offset: usize,
) -> String {
    let Some(primary_key) = &request.target.primary_key else {
        return " where <primary-key> = <value>".into();
    };
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

fn timescale_sql_edit_request(request: &DataEditPlanRequest) -> String {
    let table = sql_table_name(request, "\"", "\"");

    match request.edit_kind.as_str() {
        "insert-row" => {
            let mut fields = request
                .changes
                .iter()
                .filter_map(|change| change.field.as_deref())
                .map(|field| quote_identifier(field, "\"", "\""))
                .collect::<Vec<_>>();
            if fields.is_empty() {
                fields.push(quote_identifier("<field>", "\"", "\""));
            }
            let values = (1..=fields.len())
                .map(|index| parameter("$", index))
                .collect::<Vec<_>>();

            format!(
                "-- Mutation and after evidence (RETURNING *)\ninsert into {table} ({}) values ({}) returning *;",
                fields.join(", "),
                values.join(", ")
            )
        }
        "delete-row" => {
            let predicate = primary_key_predicate_with_offset(request, "\"", "\"", "$", 0);

            format!(
                "-- Before evidence (bounded primary-key prefetch)\nselect * from {table}{predicate} limit 2;\n\n-- Mutation and after evidence (RETURNING *)\ndelete from {table}{predicate} returning *;"
            )
        }
        _ => {
            let assignments = request
                .changes
                .iter()
                .enumerate()
                .filter_map(|(index, change)| {
                    change.field.as_deref().map(|field| {
                        format!(
                            "{} = {}",
                            quote_identifier(field, "\"", "\""),
                            parameter("$", index + 1)
                        )
                    })
                })
                .collect::<Vec<_>>();
            let assignment_text = if assignments.is_empty() {
                format!("{} = $1", quote_identifier("<field>", "\"", "\""))
            } else {
                assignments.join(", ")
            };
            let before_predicate = primary_key_predicate_with_offset(request, "\"", "\"", "$", 0);
            let mutation_predicate = primary_key_predicate(request, "\"", "\"", "$");

            format!(
                "-- Before evidence (bounded primary-key prefetch)\nselect * from {table}{before_predicate} limit 2;\n\n-- Mutation and after evidence (RETURNING *)\nupdate {table} set {assignment_text}{mutation_predicate} returning *;"
            )
        }
    }
}

fn oracle_sql_edit_request(request: &DataEditPlanRequest) -> String {
    let table = sql_table_name(request, "\"", "\"");

    match request.edit_kind.as_str() {
        "insert-row" => {
            let mut fields = request
                .changes
                .iter()
                .filter_map(|change| change.field.as_deref())
                .map(|field| quote_identifier(field, "\"", "\""))
                .collect::<Vec<_>>();
            if fields.is_empty() {
                fields.push(quote_identifier("<field>", "\"", "\""));
            }
            let values = (1..=fields.len())
                .map(|index| parameter(":p", index))
                .collect::<Vec<_>>();
            if request
                .target
                .primary_key
                .as_ref()
                .is_some_and(|primary_key| !primary_key.is_empty())
            {
                let predicate = oracle_primary_key_predicate(request);
                return format!(
                    "-- Mutation\ninsert into {table} ({}) values ({});\n\n-- After evidence (bounded primary-key fetch)\nselect * from {table}{predicate} fetch first 2 rows only;",
                    fields.join(", "),
                    values.join(", ")
                );
            }

            format!(
                "-- Mutation and ROWID evidence\nvariable datapad_rowid varchar2(32)\ninsert into {table} ({}) values ({}) returning rowid into :datapad_rowid;\n\n-- After evidence (bounded ROWID fetch)\nselect * from {table} where rowid = chartorowid(:datapad_rowid) fetch first 2 rows only;",
                fields.join(", "),
                values.join(", ")
            )
        }
        "delete-row" => {
            let predicate = oracle_primary_key_predicate(request);

            format!(
                "-- Before evidence (bounded primary-key or ROWID prefetch)\nselect * from {table}{predicate} fetch first 2 rows only;\n\n-- Mutation\ndelete from {table}{predicate};\n\n-- After evidence (bounded primary-key or ROWID fetch)\nselect * from {table}{predicate} fetch first 2 rows only;"
            )
        }
        _ => {
            let assignments = request
                .changes
                .iter()
                .enumerate()
                .filter_map(|(index, change)| {
                    change.field.as_deref().map(|field| {
                        format!(
                            "{} = {}",
                            quote_identifier(field, "\"", "\""),
                            parameter(":p", index + 1)
                        )
                    })
                })
                .collect::<Vec<_>>();
            let assignment_text = if assignments.is_empty() {
                format!("{} = :p1", quote_identifier("<field>", "\"", "\""))
            } else {
                assignments.join(", ")
            };
            let predicate =
                oracle_primary_key_predicate_with_offset(request, request.changes.len());
            let before_predicate = oracle_primary_key_predicate_with_offset(request, 0);

            format!(
                "-- Before evidence (bounded primary-key or ROWID prefetch)\nselect * from {table}{before_predicate} fetch first 2 rows only;\n\n-- Mutation\nupdate {table} set {assignment_text}{predicate};\n\n-- After evidence (bounded primary-key or ROWID fetch)\nselect * from {table}{before_predicate} fetch first 2 rows only;"
            )
        }
    }
}

fn oracle_primary_key_predicate(request: &DataEditPlanRequest) -> String {
    oracle_primary_key_predicate_with_offset(request, 0)
}

fn oracle_primary_key_predicate_with_offset(
    request: &DataEditPlanRequest,
    offset: usize,
) -> String {
    let Some(primary_key) = &request.target.primary_key else {
        return " where <primary-key-or-rowid> = <value>".into();
    };
    let mut entries = primary_key.keys().collect::<Vec<_>>();
    entries.sort();
    let parts = entries
        .into_iter()
        .enumerate()
        .map(|(index, key)| {
            if key.eq_ignore_ascii_case("rowid") {
                format!(
                    "rowid = chartorowid({})",
                    parameter(":p", offset + index + 1)
                )
            } else {
                format!(
                    "{} = {}",
                    quote_identifier(key, "\"", "\""),
                    parameter(":p", offset + index + 1)
                )
            }
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        " where <primary-key-or-rowid> = <value>".into()
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
    if request.edit_kind == "delete-document" {
        return serde_json::to_string_pretty(&json!({
            "database": database,
            "collection": collection,
            "operation": "deleteOne",
            "filter": filter
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if request.edit_kind == "update-document" {
        return serde_json::to_string_pretty(&json!({
            "database": database,
            "collection": collection,
            "operation": "replaceOne",
            "filter": filter,
            "replacement": request
                .changes
                .first()
                .and_then(|change| change.value.clone())
                .unwrap_or(Value::Object(Default::default()))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

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
        "json-set-path" => {
            let change = request.changes.first();
            let path = redis_json_path(change);
            let value = change
                .and_then(|change| secret_aware_json_command_value(&path, change.value.as_ref()))
                .unwrap_or_else(|| "<json>".into());

            format!("JSON.SET {key} {path} {value}")
        }
        "json-delete-path" => {
            let path = redis_json_path(request.changes.first());

            format!("JSON.DEL {key} {path}")
        }
        "stream-add-entry" => {
            let entry_id = stream_add_entry_id(request);
            let fields = stream_entry_fields(request)
                .into_iter()
                .map(|(field, value)| format!("{field} {value}"))
                .collect::<Vec<_>>()
                .join(" ");
            let fields = if fields.is_empty() {
                "<field> <value>".into()
            } else {
                fields
            };

            format!("XADD {key} {entry_id} {fields}")
        }
        "stream-delete-entry" => {
            let entry_ids = stream_delete_entry_ids(request);
            let entry_ids = if entry_ids.is_empty() {
                "<entry-id>".into()
            } else {
                entry_ids.join(" ")
            };

            format!("XDEL {key} {entry_ids}")
        }
        "timeseries-add-sample" => format!(
            "TS.ADD {key} {} {}",
            timeseries_sample_timestamp(request),
            timeseries_sample_value(request).unwrap_or_else(|| "<value>".into())
        ),
        "timeseries-delete-sample" => {
            let (from_timestamp, to_timestamp) = timeseries_delete_range(request);

            format!("TS.DEL {key} {from_timestamp} {to_timestamp}")
        }
        "vector-add-member" => {
            let member = vector_member_name(request).unwrap_or_else(|| "<element>".into());
            let values = vector_values(request)
                .map(|values| {
                    values
                        .iter()
                        .map(vector_number_arg)
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_else(|| "<vector>".into());
            let dimension = vector_values(request)
                .map(|values| values.len().to_string())
                .unwrap_or_else(|| "<dim>".into());
            let attributes = vector_add_attributes(request)
                .map(|attributes| format!(" SETATTR {attributes}"))
                .unwrap_or_default();

            format!("VADD {key} VALUES {dimension} {values} {member}{attributes}")
        }
        "vector-remove-member" => format!(
            "VREM {key} {}",
            vector_member_name(request).unwrap_or_else(|| "<element>".into())
        ),
        "vector-set-attributes" => format!(
            "VSETATTR {key} {} {}",
            vector_member_name(request).unwrap_or_else(|| "<element>".into()),
            vector_attributes(request).unwrap_or_else(|| r#""""#.into())
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
    let key = dynamodb_key_value(request);
    let mutation = match request.edit_kind.as_str() {
        "delete-item" => {
            let mut names = Map::new();
            let condition_expression =
                dynamodb_key_condition_expression(&key, "attribute_exists", &mut names);
            let mut mutation = Map::new();
            mutation.insert("Operation".into(), Value::String("DeleteItem".into()));
            mutation.insert("TableName".into(), Value::String(table.into()));
            mutation.insert("Key".into(), key.clone());
            dynamodb_apply_condition_fields(&mut mutation, condition_expression, names);
            mutation.insert("ReturnValues".into(), Value::String("ALL_OLD".into()));
            mutation.insert(
                "ReturnConsumedCapacity".into(),
                Value::String("TOTAL".into()),
            );
            mutation.insert(
                "EvidenceRequests".into(),
                dynamodb_evidence_requests(table, &key),
            );
            Value::Object(mutation)
        }
        "put-item" => {
            let mut names = Map::new();
            let condition_expression =
                dynamodb_key_condition_expression(&key, "attribute_not_exists", &mut names);
            let mut mutation = Map::new();
            mutation.insert("Operation".into(), Value::String("PutItem".into()));
            mutation.insert("TableName".into(), Value::String(table.into()));
            mutation.insert("Item".into(), dynamodb_put_item_value(request));
            dynamodb_apply_condition_fields(&mut mutation, condition_expression, names);
            mutation.insert("ReturnValues".into(), Value::String("ALL_OLD".into()));
            mutation.insert(
                "ReturnConsumedCapacity".into(),
                Value::String("TOTAL".into()),
            );
            mutation.insert(
                "EvidenceRequests".into(),
                dynamodb_evidence_requests(table, &key),
            );
            Value::Object(mutation)
        }
        _ => {
            let field = request
                .changes
                .first()
                .and_then(|change| change.field.clone())
                .unwrap_or_else(|| "<field>".into());
            let mut names = Map::from_iter([("#field".into(), Value::String(field.clone()))]);
            let condition_expression =
                dynamodb_key_condition_expression(&key, "attribute_exists", &mut names);
            let mut mutation = Map::new();
            mutation.insert("Operation".into(), Value::String("UpdateItem".into()));
            mutation.insert("TableName".into(), Value::String(table.into()));
            mutation.insert("Key".into(), key.clone());
            mutation.insert(
                "UpdateExpression".into(),
                Value::String("SET #field = :value".into()),
            );
            mutation.insert("ExpressionAttributeNames".into(), Value::Object(names));
            mutation.insert(
                "ExpressionAttributeValues".into(),
                json!({
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
                }),
            );
            if let Some(condition_expression) = condition_expression {
                mutation.insert(
                    "ConditionExpression".into(),
                    Value::String(condition_expression),
                );
            }
            mutation.insert("ReturnValues".into(), Value::String("ALL_NEW".into()));
            mutation.insert(
                "ReturnConsumedCapacity".into(),
                Value::String("TOTAL".into()),
            );
            mutation.insert(
                "EvidenceRequests".into(),
                dynamodb_evidence_requests(table, &key),
            );
            Value::Object(mutation)
        }
    };

    serde_json::to_string_pretty(&mutation).unwrap_or_else(|_| "{}".into())
}

fn dynamodb_key_value(request: &DataEditPlanRequest) -> Value {
    request
        .target
        .item_key
        .clone()
        .or_else(|| request.target.primary_key.clone())
        .map(|key| json!(key))
        .unwrap_or_else(|| json!({}))
}

fn dynamodb_evidence_requests(table: &str, key: &Value) -> Value {
    if key.as_object().is_none_or(Map::is_empty) {
        return json!({
            "UnavailableReason": "Complete item key required for before/after GetItem evidence."
        });
    }

    json!({
        "Before": {
            "Operation": "GetItem",
            "TableName": table,
            "Key": key,
            "ConsistentRead": true,
            "ReturnConsumedCapacity": "TOTAL",
        },
        "After": {
            "Operation": "GetItem",
            "TableName": table,
            "Key": key,
            "ConsistentRead": true,
            "ReturnConsumedCapacity": "TOTAL",
        },
    })
}

fn dynamodb_apply_condition_fields(
    mutation: &mut Map<String, Value>,
    condition_expression: Option<String>,
    expression_attribute_names: Map<String, Value>,
) {
    let Some(condition_expression) = condition_expression else {
        return;
    };

    mutation.insert(
        "ConditionExpression".into(),
        Value::String(condition_expression),
    );
    mutation.insert(
        "ExpressionAttributeNames".into(),
        Value::Object(expression_attribute_names),
    );
}

fn dynamodb_key_condition_expression(
    key: &Value,
    function_name: &str,
    expression_attribute_names: &mut Map<String, Value>,
) -> Option<String> {
    let key = key.as_object().filter(|key| !key.is_empty())?;
    let expressions = key
        .keys()
        .enumerate()
        .map(|(index, field)| {
            let token = dynamodb_name_token(expression_attribute_names, field, index);
            format!("{function_name}({token})")
        })
        .collect::<Vec<_>>();

    Some(expressions.join(" AND "))
}

fn dynamodb_name_token(
    expression_attribute_names: &mut Map<String, Value>,
    field: &str,
    index: usize,
) -> String {
    if let Some((token, _)) = expression_attribute_names
        .iter()
        .find(|(_, value)| value.as_str() == Some(field))
    {
        return token.clone();
    }

    let mut token_index = index;
    loop {
        let token = format!("#key{token_index}");
        if !expression_attribute_names.contains_key(&token) {
            expression_attribute_names.insert(token.clone(), Value::String(field.into()));
            return token;
        }
        token_index += 1;
    }
}

fn dynamodb_put_item_value(request: &DataEditPlanRequest) -> Value {
    let mut item = request
        .target
        .item_key
        .clone()
        .or_else(|| request.target.primary_key.clone())
        .map(|key| key.into_iter().collect::<Map<_, _>>())
        .unwrap_or_default();

    for change in &request.changes {
        if let Some(field) = change.field.as_deref().filter(|value| !value.is_empty()) {
            item.insert(
                field.into(),
                secret_aware_json_value(
                    field,
                    change
                        .value
                        .clone()
                        .unwrap_or(Value::String("<value>".into())),
                ),
            );
        } else if let Some(Value::Object(document)) = change.value.clone() {
            item.extend(document);
        }
    }

    if item.is_empty() {
        item.insert("<field>".into(), Value::String("<value>".into()));
    }

    Value::Object(item)
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
    let evidence_path = format!("/{index}/_doc/{document_id}?realtime=true");
    let mutation = if body.is_null() {
        format!("{method} {path}")
    } else {
        format!(
            "{method} {path}\n{}",
            serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into())
        )
    };

    format!(
        "GET {evidence_path}\n-- before document evidence\n{mutation}\nGET {evidence_path}\n-- after document evidence"
    )
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

fn stream_add_entry_id(request: &DataEditPlanRequest) -> String {
    request
        .target
        .document_id
        .as_ref()
        .map(value_to_command_arg)
        .or_else(|| {
            request
                .changes
                .first()
                .and_then(|change| change.new_name.clone())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "*".into())
}

fn stream_delete_entry_ids(request: &DataEditPlanRequest) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(document_id) = request.target.document_id.as_ref() {
        let id = value_to_command_arg(document_id);
        if !id.trim().is_empty() {
            ids.push(id);
        }
    }

    ids.extend(
        request
            .changes
            .iter()
            .filter_map(stream_entry_id_from_change),
    );
    ids
}

fn stream_entry_id_from_change(change: &DataEditChange) -> Option<String> {
    change
        .field
        .clone()
        .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
        .filter(|value| !value.trim().is_empty())
}

fn stream_entry_fields(request: &DataEditPlanRequest) -> Vec<(String, String)> {
    if let Some(Value::Object(fields)) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
        .filter(|_| request.changes.len() == 1)
    {
        return fields
            .iter()
            .map(|(field, value)| {
                (
                    field.clone(),
                    secret_aware_command_value(field, Some(value)),
                )
            })
            .collect();
    }

    request
        .changes
        .iter()
        .filter_map(|change| {
            let field = change
                .field
                .clone()
                .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))?;
            Some((
                field.clone(),
                secret_aware_command_value(&field, change.value.as_ref()),
            ))
        })
        .collect()
}

fn timeseries_sample_timestamp(request: &DataEditPlanRequest) -> String {
    request
        .target
        .document_id
        .as_ref()
        .map(value_to_command_arg)
        .or_else(|| {
            request.changes.first().and_then(|change| {
                change
                    .field
                    .clone()
                    .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
                    .or_else(|| change.new_name.clone())
            })
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "*".into())
}

fn timeseries_sample_value(request: &DataEditPlanRequest) -> Option<String> {
    let value = request.changes.first()?.value.as_ref()?;
    let value = value
        .as_object()
        .and_then(|record| record.get("value"))
        .unwrap_or(value);
    Some(value_to_command_arg(value))
}

fn timeseries_delete_range(request: &DataEditPlanRequest) -> (String, String) {
    let change = request.changes.first();
    if let Some(range) = change
        .and_then(|change| change.value.as_ref())
        .and_then(timeseries_range_from_value)
    {
        return range;
    }

    let from_timestamp = request
        .target
        .document_id
        .as_ref()
        .map(value_to_command_arg)
        .or_else(|| change.and_then(timeseries_from_change))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "<from-timestamp>".into());
    let to_timestamp = change
        .and_then(|change| {
            change
                .new_name
                .clone()
                .or_else(|| change.path.as_ref().and_then(|path| path.get(1).cloned()))
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| from_timestamp.clone());

    (from_timestamp, to_timestamp)
}

fn timeseries_from_change(change: &DataEditChange) -> Option<String> {
    change
        .field
        .clone()
        .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
}

fn timeseries_range_from_value(value: &Value) -> Option<(String, String)> {
    let record = value.as_object()?;
    let from = record
        .get("from")
        .or_else(|| record.get("start"))
        .or_else(|| record.get("timestamp"))
        .map(value_to_command_arg)?;
    let to = record
        .get("to")
        .or_else(|| record.get("end"))
        .map(value_to_command_arg)
        .unwrap_or_else(|| from.clone());
    Some((from, to))
}

fn vector_member_name(request: &DataEditPlanRequest) -> Option<String> {
    request
        .target
        .document_id
        .as_ref()
        .map(value_to_command_arg)
        .or_else(|| {
            request.changes.first().and_then(|change| {
                change
                    .field
                    .clone()
                    .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
                    .or_else(|| change.new_name.clone())
                    .or_else(|| change.value.as_ref().and_then(vector_member_from_value))
            })
        })
        .filter(|value| !value.trim().is_empty())
}

fn vector_member_from_value(value: &Value) -> Option<String> {
    let record = value.as_object()?;
    record
        .get("element")
        .or_else(|| record.get("member"))
        .or_else(|| record.get("id"))
        .map(value_to_command_arg)
}

fn vector_values(request: &DataEditPlanRequest) -> Option<Vec<f64>> {
    let first_value = request.changes.first()?.value.as_ref()?;
    if let Some(values) = vector_values_from_value(first_value) {
        return Some(values);
    }

    let values = request
        .changes
        .iter()
        .filter_map(|change| change.value.as_ref().and_then(vector_number_value))
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn vector_values_from_value(value: &Value) -> Option<Vec<f64>> {
    if let Some(items) = value.as_array() {
        return vector_numbers_from_array(items);
    }

    let record = value.as_object()?;
    for key in ["vector", "values", "embedding"] {
        if let Some(items) = record.get(key).and_then(Value::as_array) {
            return vector_numbers_from_array(items);
        }
    }

    None
}

fn vector_numbers_from_array(items: &[Value]) -> Option<Vec<f64>> {
    let values = items
        .iter()
        .map(vector_number_value)
        .collect::<Option<Vec<_>>>()?;
    (!values.is_empty()).then_some(values)
}

fn vector_number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

fn vector_number_arg(value: &f64) -> String {
    let mut text = value.to_string();
    if text == "-0" {
        text = "0".into();
    }
    text
}

fn vector_attributes(request: &DataEditPlanRequest) -> Option<String> {
    let value = request.changes.first()?.value.as_ref()?;
    vector_attributes_from_value(value)
}

fn vector_add_attributes(request: &DataEditPlanRequest) -> Option<String> {
    let value = request.changes.first()?.value.as_ref()?;
    let record = value.as_object()?;
    let attributes = record
        .get("attributes")
        .or_else(|| record.get("attrs"))
        .or_else(|| record.get("metadata"))?;
    vector_attributes_from_value(attributes)
}

fn vector_attributes_from_value(value: &Value) -> Option<String> {
    let attributes = value
        .as_object()
        .and_then(|record| {
            record
                .get("attributes")
                .or_else(|| record.get("attrs"))
                .or_else(|| record.get("metadata"))
        })
        .unwrap_or(value);

    match attributes {
        Value::Null => Some(r#""""#.into()),
        Value::String(value) if value.is_empty() => Some(r#""""#.into()),
        Value::String(value) => Some(value.clone()),
        other => serde_json::to_string(other).ok(),
    }
}

fn redis_json_path(change: Option<&DataEditChange>) -> String {
    change
        .and_then(|change| {
            if let Some(field) = change.field.as_deref().filter(|value| !value.is_empty()) {
                return Some(if is_redis_json_path(field) {
                    field.to_string()
                } else {
                    redis_json_path_from_segments(&[field.to_string()])
                });
            }

            change
                .path
                .as_ref()
                .map(|path| redis_json_path_from_segments(path))
        })
        .unwrap_or_else(|| "$".into())
}

fn redis_json_path_from_segments(path: &[String]) -> String {
    if path.is_empty() {
        return "$".into();
    }
    if path.len() == 1 && is_redis_json_path(&path[0]) {
        return path[0].clone();
    }

    let mut json_path = "$".to_string();
    for segment in path {
        if let Ok(index) = segment.parse::<usize>() {
            json_path.push_str(&format!("[{index}]"));
        } else if is_simple_json_path_segment(segment) {
            json_path.push('.');
            json_path.push_str(segment);
        } else {
            json_path.push('[');
            json_path
                .push_str(&serde_json::to_string(segment).unwrap_or_else(|_| "\"<field>\"".into()));
            json_path.push(']');
        }
    }

    json_path
}

fn is_redis_json_path(value: &str) -> bool {
    value == "$" || value.starts_with("$.") || value.starts_with("$[")
}

fn is_simple_json_path_segment(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn secret_aware_json_command_value(path: &str, value: Option<&Value>) -> Option<String> {
    if is_secret_like_name(path) {
        return Some(
            serde_json::to_string(SECRET_REPLACEMENT).unwrap_or_else(|_| "\"********\"".into()),
        );
    }

    value.map(|value| serde_json::to_string(value).unwrap_or_else(|_| "<json>".into()))
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
