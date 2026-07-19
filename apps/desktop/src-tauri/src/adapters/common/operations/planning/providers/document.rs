use super::super::*;

pub(super) fn document_operation_request(
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let database = parameter("database")
        .and_then(Value::as_str)
        .unwrap_or("<database>");
    let collection = parameter("collection")
        .and_then(Value::as_str)
        .unwrap_or(object_name);
    let index_name = parameter("indexName")
        .and_then(Value::as_str)
        .unwrap_or("<index>");
    let principal_name = parameter("name")
        .and_then(Value::as_str)
        .unwrap_or(object_name);

    if operation_id.ends_with("index.create") {
        let mut index = serde_json::Map::new();
        index.insert(
            "key".into(),
            parameter("key")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "field": 1 })),
        );
        index.insert("name".into(), Value::String(index_name.into()));
        if let Some(Value::Object(options)) = parameter("options") {
            for (key, value) in options {
                if key != "key" && key != "name" {
                    index.insert(key.clone(), value.clone());
                }
            }
        }

        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "createIndexes": collection,
            "indexes": [Value::Object(index)]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "dropIndexes": collection,
            "index": index_name
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.hide") || operation_id.ends_with("index.unhide") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collMod": collection,
            "index": {
                "name": index_name,
                "hidden": operation_id.ends_with("index.hide")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("validation.update") || operation_id.ends_with("validator.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collMod": collection,
            "validator": parameter("validator").cloned().unwrap_or_else(|| serde_json::json!({}))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("database.create") || operation_id.ends_with("collection.create") {
        let target_database = parameter("database").and_then(Value::as_str).unwrap_or(
            if operation_id.ends_with("database.create") {
                object_name
            } else {
                database
            },
        );
        let target_collection = parameter("collection").and_then(Value::as_str).unwrap_or(
            if operation_id.ends_with("database.create") {
                "<first_collection>"
            } else {
                collection
            },
        );
        let mut command = serde_json::Map::new();
        command.insert("database".into(), serde_json::json!(target_database));
        command.insert("create".into(), serde_json::json!(target_collection));
        merge_json_options(&mut command, parameter("options"));

        return serde_json::to_string_pretty(&Value::Object(command))
            .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("database.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "dropDatabase": 1
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "drop": collection
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.rename") {
        let new_collection = parameter("newCollection")
            .or_else(|| parameter("newName"))
            .or_else(|| parameter("to"))
            .and_then(Value::as_str)
            .unwrap_or("<new_collection>");
        let target_database = parameter("targetDatabase")
            .and_then(Value::as_str)
            .unwrap_or(database);
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": "admin",
            "renameCollection": format!("{database}.{collection}"),
            "to": format!("{target_database}.{new_collection}"),
            "dropTarget": parameter("dropTarget").cloned().unwrap_or_else(|| serde_json::json!(false))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.modify") {
        let mut command = serde_json::Map::new();
        command.insert("database".into(), serde_json::json!(database));
        command.insert("collMod".into(), serde_json::json!(collection));
        merge_json_options(&mut command, parameter("modification"));
        merge_json_options(&mut command, parameter("options"));
        for key in [
            "validator",
            "validationLevel",
            "validationAction",
            "index",
            "changeStreamPreAndPostImages",
            "expireAfterSeconds",
        ] {
            if let Some(value) = parameter(key) {
                command.insert(key.into(), value.clone());
            }
        }

        return serde_json::to_string_pretty(&Value::Object(command))
            .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.convert-to-capped") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "convertToCapped": collection,
            "size": parameter("size").cloned().unwrap_or_else(|| serde_json::json!("<bytes>"))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.clone-as-capped") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "cloneCollectionAsCapped": collection,
            "toCollection": parameter("targetCollection")
                .or_else(|| parameter("toCollection"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!("<target_collection>")),
            "size": parameter("size").cloned().unwrap_or_else(|| serde_json::json!("<bytes>"))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.compact") {
        let mut command = serde_json::Map::new();
        command.insert("database".into(), serde_json::json!(database));
        command.insert("compact".into(), serde_json::json!(collection));
        if let Some(value) = parameter("force") {
            command.insert("force".into(), value.clone());
        }
        merge_json_options(&mut command, parameter("options"));

        return serde_json::to_string_pretty(&Value::Object(command))
            .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.validate") {
        let mut command = serde_json::Map::new();
        command.insert("database".into(), serde_json::json!(database));
        command.insert("validate".into(), serde_json::json!(collection));
        if let Some(value) = parameter("full") {
            command.insert("full".into(), value.clone());
        }
        merge_json_options(&mut command, parameter("options"));

        return serde_json::to_string_pretty(&Value::Object(command))
            .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.export") {
        let format = parameter("format")
            .and_then(Value::as_str)
            .unwrap_or("extended-json");
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collection": collection,
            "operation": "export",
            "workflow": "mongodb.collection.export",
            "format": format,
            "target": {
                "kind": "file",
                "path": parameter("targetPath")
                    .or_else(|| parameter("outputPath"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!(format!("<selected-file>.{}", mongo_file_extension(format))))
            },
            "filter": parameter("filter").cloned().unwrap_or_else(|| serde_json::json!({})),
            "projection": parameter("projection").cloned().unwrap_or_else(|| serde_json::json!({})),
            "sort": parameter("sort").cloned().unwrap_or_else(|| serde_json::json!({})),
            "limit": parameter("limit").cloned().unwrap_or(serde_json::Value::Null),
            "batchSize": parameter("batchSize").cloned().unwrap_or_else(|| serde_json::json!(1000)),
            "serializer": {
                "supportedFormats": ["json", "extended-json", "ndjson", "csv", "bson"],
                "extendedJsonMode": parameter("extendedJsonMode").cloned().unwrap_or_else(|| serde_json::json!("relaxed")),
                "includeMetadata": parameter("includeMetadata").cloned().unwrap_or_else(|| serde_json::json!(true))
            },
            "validation": {
                "dryRunFirst": true,
                "explainFilter": true,
                "requireReadableTarget": true
            },
            "executionGate": mongo_file_workflow_gate("read collection data and write the selected export file")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.import") {
        let format = parameter("format")
            .and_then(Value::as_str)
            .unwrap_or("json");
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collection": collection,
            "operation": "import",
            "workflow": "mongodb.collection.import",
            "format": format,
            "source": {
                "kind": "file",
                "path": parameter("sourcePath")
                    .or_else(|| parameter("inputPath"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!(format!("<selected-file>.{}", mongo_file_extension(format))))
            },
            "mode": parameter("mode").cloned().unwrap_or_else(|| serde_json::json!("insertMany")),
            "validation": parameter("validation").cloned().unwrap_or_else(|| serde_json::json!("validate-before-write")),
            "ordered": parameter("ordered").cloned().unwrap_or_else(|| serde_json::json!(false)),
            "batchSize": parameter("batchSize").cloned().unwrap_or_else(|| serde_json::json!(1000)),
            "createCollection": parameter("createCollection").cloned().unwrap_or_else(|| serde_json::json!(false)),
            "duplicateKeyPolicy": parameter("duplicateKeyPolicy").cloned().unwrap_or_else(|| serde_json::json!("stop")),
            "mapping": parameter("mapping").cloned().unwrap_or_else(|| serde_json::json!({})),
            "parser": {
                "supportedFormats": ["json", "extended-json", "ndjson", "csv", "bson"],
                "extendedJsonMode": parameter("extendedJsonMode").cloned().unwrap_or_else(|| serde_json::json!("relaxed")),
                "csvHeader": parameter("csvHeader").cloned().unwrap_or_else(|| serde_json::json!(true))
            },
            "checks": [
                "file-readable",
                "format-detected",
                "document-shape",
                "validator-compatible",
                "duplicate-key-policy"
            ],
            "executionGate": mongo_file_workflow_gate("read the selected import file and write documents only after validation")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("user.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "createUser": principal_name,
            "pwd": parameter("password").cloned().unwrap_or_else(|| serde_json::json!("<secret>")),
            "roles": parameter("roles").cloned().unwrap_or_else(|| serde_json::json!([]))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("user.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "dropUser": principal_name
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("role.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "createRole": principal_name,
            "privileges": parameter("privileges").cloned().unwrap_or_else(|| serde_json::json!([])),
            "roles": parameter("roles").cloned().unwrap_or_else(|| serde_json::json!([]))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("role.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "dropRole": principal_name
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "{\n  \"listCollections\": true\n}".into(),
        "execute" => format!("{{\n  \"collection\": \"{object_name}\",\n  \"filter\": {{}},\n  \"limit\": 100\n}}"),
        "explain" | "profile" => format!("{{\n  \"collection\": \"{object_name}\",\n  \"explain\": true,\n  \"filter\": {{}}\n}}"),
        "create" => format!("{{\n  \"createCollection\": \"{object_name}\"\n}}"),
        "drop" => format!("{{\n  \"dropCollection\": \"{object_name}\"\n}}"),
        _ => format!("{{\n  \"operation\": \"{operation_id}\",\n  \"parameters\": {parameter_json}\n}}"),
    }
}

fn mongo_file_extension(format: &str) -> &'static str {
    match format {
        "ndjson" => "ndjson",
        "csv" => "csv",
        "bson" => "bson",
        _ => "json",
    }
}

fn merge_json_options(command: &mut serde_json::Map<String, Value>, value: Option<&Value>) {
    if let Some(Value::Object(options)) = value {
        for (key, value) in options {
            command.insert(key.clone(), value.clone());
        }
    }
}

fn mongo_file_workflow_gate(permission: &str) -> Value {
    serde_json::json!({
        "owner": "mongodb-adapter",
        "defaultSupport": "live",
        "liveExecutor": "mongodb.collection-file-workflow",
        "requiredPermission": permission,
        "liveEvidence": [
            "confirmed file picker path",
            "serializer/parser fixture coverage for the selected format",
            "read-only profile check",
            "environment confirmation for write or costly work",
            "before/after summary for writes"
        ]
    })
}
