use std::collections::BTreeMap;

use serde_json::Value;

use crate::domain::models::{AdapterManifest, OperationPlan, ResolvedConnectionProfile};

pub(crate) fn default_object_name(manifest: &AdapterManifest, provided: Option<&str>) -> String {
    provided
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| match manifest.family.as_str() {
            "document" => "<collection>".into(),
            "keyvalue" => "<key>".into(),
            "graph" => "<label>".into(),
            "timeseries" => "<measurement>".into(),
            "widecolumn" => "<table>".into(),
            "search" => "<index>".into(),
            "warehouse" | "embedded-olap" | "sql" => "<schema>.<table>".into(),
            _ => "<object>".into(),
        })
}

pub(crate) fn generated_operation_request(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter_json = parameters
        .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into()))
        .unwrap_or_else(|| "{}".into());

    match manifest.family.as_str() {
        "sql" | "warehouse" | "embedded-olap" | "timeseries"
            if manifest.default_language.ends_with("sql") || manifest.default_language == "sql" =>
        {
            if manifest.family == "warehouse" {
                return warehouse_operation_request(
                    manifest,
                    operation_id,
                    object_name,
                    parameters,
                );
            }

            if manifest.engine == "oracle" {
                return oracle_operation_request(operation_id, object_name, &parameter_json);
            }

            if manifest.engine == "sqlserver" {
                return sqlserver_operation_request(
                    operation_id,
                    object_name,
                    parameters,
                    &parameter_json,
                );
            }

            if manifest.engine == "sqlite" {
                return sqlite_operation_request(
                    operation_id,
                    object_name,
                    parameters,
                    &parameter_json,
                );
            }

            if manifest.engine == "duckdb" {
                return duckdb_operation_request(operation_id, object_name, parameters);
            }

            if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
                if let Some(request) =
                    mysql_operation_request(manifest, operation_id, object_name, parameters)
                {
                    return request;
                }
            }

            if manifest.engine == "postgresql" {
                if let Some(request) =
                    postgres_operation_request(operation_id, object_name, parameters)
                {
                    return request;
                }
            }

            if operation_id.ends_with("index.create") {
                return format!("create index idx_selected_object_id on {object_name} (id);");
            }

            if operation_id.ends_with("index.drop") {
                return "drop index <index_name>;".into();
            }

            if operation_id.ends_with("data.import-export")
                || operation_id.contains("import-export")
            {
                return format!(
                    "copy (select * from {object_name}) to '<selected-file>.csv' with (format csv, header true);"
                );
            }

            if operation_id.ends_with("data.backup-restore")
                || operation_id.contains("backup-restore")
            {
                return format!("-- Prepare an engine-native backup workflow for {object_name}.");
            }

            match operation_id.rsplit('.').next().unwrap_or(operation_id) {
                "refresh" => "select table_schema, table_name from information_schema.tables order by table_schema, table_name;".into(),
                "execute" => format!("select * from {object_name} limit 100;"),
                "explain" => format!("explain select * from {object_name} limit 100;"),
                "profile" if manifest.engine == "cockroachdb" => {
                    format!("explain analyze (distsql) select * from {object_name} limit 100;")
                }
                "profile" => format!("explain analyze select * from {object_name} limit 100;"),
                "create" => format!("create table {object_name} (\n  id text primary key,\n  created_at timestamp\n);"),
                "drop" => format!("drop table {object_name};"),
                "inspect" if manifest.engine == "cockroachdb" => "show grants; show roles;".into(),
                "inspect" => "select * from information_schema.role_table_grants;".into(),
                "metrics" if manifest.engine == "cockroachdb" => {
                    "show jobs; show sessions; select * from crdb_internal.cluster_locks limit 100;".into()
                }
                "metrics" => "select current_timestamp as sampled_at;".into(),
                _ => format!("-- {operation_id}\n-- connection: {}\n-- parameters:\n{parameter_json}", connection.name),
            }
        }
        "document" => {
            if manifest.engine == "cosmosdb" {
                return cosmosdb_operation_request(operation_id, object_name, parameters);
            }

            if manifest.engine == "litedb" {
                return litedb_operation_request(operation_id, object_name, parameters);
            }

            document_operation_request(operation_id, object_name, &parameter_json, parameters)
        }
        "keyvalue" => {
            if matches!(manifest.engine.as_str(), "redis" | "valkey") {
                return redis_operation_request(operation_id, object_name, parameters);
            }

            if manifest.engine == "memcached" {
                return memcached_operation_request(operation_id, object_name, parameters);
            }

            match operation_id.rsplit('.').next().unwrap_or(operation_id) {
                "refresh" | "execute" => format!("SCAN 0 MATCH {object_name}* COUNT 100"),
                "metrics" => "INFO\nSLOWLOG GET 20".into(),
                _ => format!("# {operation_id}\n# parameters:\n{parameter_json}"),
            }
        }
        "graph" => graph_operation_request(manifest, operation_id, object_name, parameters),
        "search" => {
            search_operation_request(operation_id, object_name, &parameter_json, parameters)
        }
        "timeseries" => timeseries_operation_request(
            manifest,
            operation_id,
            object_name,
            &parameter_json,
            parameters,
        ),
        "widecolumn" => widecolumn_operation_request(
            manifest,
            operation_id,
            object_name,
            &parameter_json,
            parameters,
        ),
        _ => format!("{operation_id}\n{parameter_json}"),
    }
}

fn document_operation_request(
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

fn redis_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let key = string_parameter(parameters, "key").unwrap_or_else(|| object_name.into());
    let key_token = redis_cli_token(&key);
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "db"))
        .unwrap_or_else(|| "0".into());
    let redis_type = string_parameter(parameters, "redisType").unwrap_or_else(|| "string".into());

    if operation_id.ends_with("key.export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        return format!(
            "# Export Redis {redis_type} key {key_token} as {format}\nSELECT {database}\nTYPE {key_token}\nTTL {key_token}\nMEMORY USAGE {key_token}\n{}",
            redis_export_read_command(&redis_type, &key_token)
        );
    }

    if operation_id.ends_with("key.import") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        let mode =
            string_parameter(parameters, "mode").unwrap_or_else(|| "create-or-replace".into());
        let ttl = string_parameter(parameters, "ttl").unwrap_or_else(|| "preserve".into());
        let validation = string_parameter(parameters, "validation")
            .unwrap_or_else(|| "validate-before-write".into());
        return format!(
            "# Import Redis {redis_type} key {key_token} from {format}\nSELECT {database}\n# mode: {mode}; ttl: {ttl}; validation: {validation}\n{}",
            redis_import_write_command(&redis_type, &key_token)
        );
    }

    if operation_id.ends_with("key.rename") {
        let new_key = string_parameter(parameters, "newKey")
            .or_else(|| string_parameter(parameters, "destinationKey"))
            .unwrap_or_else(|| "<new-key>".into());
        return format!(
            "SELECT {database}\nRENAMENX {key_token} {}",
            redis_cli_token(&new_key)
        );
    }

    if operation_id.ends_with("key.copy") {
        let destination_key = string_parameter(parameters, "destinationKey")
            .or_else(|| string_parameter(parameters, "newKey"))
            .unwrap_or_else(|| "<copy-key>".into());
        let destination_database = string_parameter(parameters, "destinationDatabase")
            .or_else(|| string_parameter(parameters, "targetDatabase"))
            .unwrap_or_else(|| database.clone());
        let replace = string_parameter(parameters, "mode")
            .map(|value| value.eq_ignore_ascii_case("replace"))
            .unwrap_or(false);
        return format!(
            "SELECT {database}\nCOPY {key_token} {} DB {destination_database}{}",
            redis_cli_token(&destination_key),
            if replace { " REPLACE" } else { "" }
        );
    }

    if operation_id.ends_with("key.move") {
        let destination_database = string_parameter(parameters, "destinationDatabase")
            .or_else(|| string_parameter(parameters, "targetDatabase"))
            .unwrap_or_else(|| "1".into());
        return format!("SELECT {database}\nMOVE {key_token} {destination_database}");
    }

    if operation_id.ends_with("key.expire") {
        let seconds = numeric_parameter(parameters, "ttlSeconds")
            .or_else(|| numeric_parameter(parameters, "seconds"))
            .unwrap_or(3600);
        return format!("SELECT {database}\nEXPIRE {key_token} {seconds}");
    }

    if operation_id.ends_with("key.persist") {
        return format!("SELECT {database}\nPERSIST {key_token}");
    }

    if operation_id.ends_with("stream.ack") {
        let group = string_parameter(parameters, "group").unwrap_or_else(|| "<group>".into());
        let entry_ids = redis_string_list_parameter(parameters, "entryIds", "<entry-id>");
        return format!(
            "SELECT {database}\nXACK {key_token} {} {}",
            redis_cli_token(&group),
            entry_ids
                .iter()
                .map(|entry| redis_cli_token(entry))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    if operation_id.ends_with("stream.delete-entry") {
        let entry_ids = redis_string_list_parameter(parameters, "entryIds", "<entry-id>");
        return format!(
            "SELECT {database}\nXDEL {key_token} {}",
            entry_ids
                .iter()
                .map(|entry| redis_cli_token(entry))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" | "execute" => format!("SCAN 0 MATCH {key_token}* COUNT 100"),
        "metrics" => "INFO\nSLOWLOG GET 20".into(),
        _ => format!("# {operation_id}\n# key: {key_token}"),
    }
}

fn redis_export_read_command(redis_type: &str, key_token: &str) -> String {
    match redis_type {
        "hash" => format!("HGETALL {key_token}"),
        "list" => format!("LRANGE {key_token} 0 -1"),
        "set" => format!("SMEMBERS {key_token}"),
        "zset" => format!("ZRANGE {key_token} 0 -1 WITHSCORES"),
        "stream" => format!("XRANGE {key_token} - +"),
        "json" => format!("JSON.GET {key_token} $"),
        "timeseries" => format!("TS.RANGE {key_token} - +"),
        _ => format!("GET {key_token}"),
    }
}

fn redis_import_write_command(redis_type: &str, key_token: &str) -> String {
    match redis_type {
        "hash" => format!("HSET {key_token} <field> <value>"),
        "list" => format!("RPUSH {key_token} <value>"),
        "set" => format!("SADD {key_token} <member>"),
        "zset" => format!("ZADD {key_token} <score> <member>"),
        "stream" => format!("XADD {key_token} * <field> <value>"),
        "json" => format!("JSON.SET {key_token} $ <json>"),
        "timeseries" => format!("TS.ADD {key_token} <timestamp> <value>"),
        _ => format!("SET {key_token} <value>"),
    }
}

fn redis_string_list_parameter(
    parameters: Option<&BTreeMap<String, Value>>,
    key: &str,
    fallback: &str,
) -> Vec<String> {
    let Some(value) = parameters.and_then(|values| values.get(key)) else {
        return vec![fallback.into()];
    };

    match value {
        Value::Array(items) => {
            let values = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if values.is_empty() {
                vec![fallback.into()]
            } else {
                values
            }
        }
        Value::String(raw) => {
            let values = raw
                .split([',', ' '])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if values.is_empty() {
                vec![fallback.into()]
            } else {
                values
            }
        }
        _ => vec![fallback.into()],
    }
}

fn redis_cli_token(value: &str) -> String {
    if value.chars().all(|item| {
        item.is_ascii_alphanumeric() || matches!(item, ':' | '_' | '-' | '.' | '/' | '{' | '}')
    }) {
        value.into()
    } else {
        format!("\"{}\"", escape_double_quoted(value))
    }
}

fn cosmosdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database = string_parameter(parameters, "database").unwrap_or_else(|| "<database>".into());
    let container = string_parameter(parameters, "container")
        .or_else(|| string_parameter(parameters, "collection"))
        .unwrap_or_else(|| "<container>".into());
    let object_kind =
        string_parameter(parameters, "objectKind").unwrap_or_else(|| "container".into());

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/dbs/{database}/colls/{container}/docs"),
            "headers": {
                "x-ms-documentdb-isquery": true,
                "x-ms-documentdb-populatequerymetrics": true
            },
            "body": {
                "query": string_parameter(parameters, "query").unwrap_or_else(|| "select * from c where c.id != null".into()),
                "parameters": []
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "AzureMonitor.ListMetrics",
            "scope": object_name,
            "metrics": [
                "TotalRequestUnits",
                "NormalizedRUConsumption",
                "ThrottledRequests",
                "ServerSideLatency",
                "DataUsage"
            ],
            "granularity": "PT5M"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ReadAccessModel",
            "scope": object_name,
            "checks": [
                "sqlRoleDefinitions",
                "sqlRoleAssignments",
                "networkAclBypass",
                "publicNetworkAccess"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PATCH",
            "path": format!("/dbs/{database}/colls/{container}"),
            "body": {
                "indexingPolicy": {
                    "indexingMode": "consistent",
                    "automatic": true,
                    "includedPaths": [{ "path": string_parameter(parameters, "path").unwrap_or_else(|| "/*".into()) }],
                    "excludedPaths": [{ "path": "/\"_etag\"/?" }]
                },
                "validation": "replace-policy-after-diff-preview"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("throughput.update") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "autoscale".into());
        let scope = if object_kind == "database" {
            format!("/dbs/{database}")
        } else {
            format!("/dbs/{database}/colls/{container}")
        };
        let throughput_parameters = if mode == "autoscale" {
            serde_json::json!({
                "autoscaleSettings": {
                    "maxThroughput": numeric_parameter(parameters, "maxRuPerSecond").unwrap_or(4000)
                }
            })
        } else {
            serde_json::json!({
                "throughput": numeric_parameter(parameters, "ruPerSecond").unwrap_or(1000)
            })
        };

        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ReplaceOffer",
            "scope": scope,
            "throughputParameters": throughput_parameters,
            "preflight": ["ReadOffer", "EstimateMonthlyCost", "CheckThrottledRequests"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("consistency.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.UpdateAccountConsistency",
            "account": string_parameter(parameters, "account").unwrap_or_else(|| "<account>".into()),
            "consistencyPolicy": {
                "defaultConsistencyLevel": string_parameter(parameters, "consistencyLevel").unwrap_or_else(|| "Session".into())
            },
            "preflight": ["ReadAccount", "CheckMultiRegionWrites"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("regions.failover") {
        let write_region =
            string_parameter(parameters, "writeRegion").unwrap_or_else(|| "<write-region>".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.FailoverPriorityChange",
            "account": string_parameter(parameters, "account").unwrap_or_else(|| "<account>".into()),
            "writeRegion": write_region,
            "failoverPolicies": [{
                "locationName": write_region,
                "failoverPriority": 0
            }],
            "preflight": ["ReadAccount", "CheckRegionalAvailability", "ConfirmApplicationImpact"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ExportItems",
            "database": database,
            "container": container,
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "json".into()),
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "partitionKey": string_parameter(parameters, "partitionKey").unwrap_or_else(|| "<all-partitions>".into()),
            "consistency": "session"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": cosmosdb_drop_path(&object_kind, &database, &container),
            "preflight": ["read-throughput", "check-change-feed-lag", "verify-rbac-scope"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "operation": operation_id,
        "database": database,
        "container": container
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn litedb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database_file =
        string_parameter(parameters, "databaseFile").unwrap_or_else(|| "<selected-file>.db".into());
    let collection =
        string_parameter(parameters, "collection").unwrap_or_else(|| object_name.into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("idx_{}_id", safe_identifier(&collection)));
    let field = string_parameter(parameters, "field").unwrap_or_else(|| "id".into());
    let unique = parameters
        .and_then(|values| values.get("unique"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if operation_id.ends_with("diagnostics.metrics") {
        return format!(
            "open \"{}\"\ndb.Engine.UserVersion\ndb.Checkpoint()\ninspect pages, freelist, collections, indexes",
            escape_double_quoted(&database_file)
        );
    }

    if operation_id.ends_with("storage.checkpoint") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Checkpoint",
                "databaseFile": database_file.clone(),
                "preflight": ["verify-file-lock", "flush-dirty-pages"],
                "effect": "persist pending pages without changing collection data"
            }),
            &database_file,
            "storage-checkpoint",
            true,
        );
    }

    if operation_id.ends_with("storage.compact") {
        let output_file = string_parameter(parameters, "outputFile")
            .unwrap_or_else(|| "<selected-folder>/compacted.db".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Compact",
                "databaseFile": database_file.clone(),
                "outputFile": output_file,
                "preflight": ["checkpoint", "verify-exclusive-or-online-copy-support", "preserve-encryption-settings"],
                "validation": ["open-compacted-copy", "compare-collection-counts", "compare-index-counts"]
            }),
            &database_file,
            "storage-compact",
            true,
        );
    }

    if operation_id.ends_with("storage.rebuild-indexes") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.RebuildIndexes",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "preflight": ["checkpoint", "verify-file-lock", "list-indexes"],
                "validation": ["compare-index-counts", "sample-indexed-queries"]
            }),
            &database_file,
            "storage-rebuild-indexes",
            true,
        );
    }

    if operation_id.ends_with("index.create") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.EnsureIndex",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "indexName": index_name.clone(),
                "field": field.clone(),
                "unique": unique,
                "statement": format!(
                    "db.GetCollection(\"{}\").EnsureIndex(\"{}\", \"{}\", {unique});",
                    escape_double_quoted(&collection),
                    escape_double_quoted(&index_name),
                    escape_double_quoted(&field)
                )
            }),
            &database_file,
            "index-create",
            true,
        );
    }

    if operation_id.ends_with("index.drop") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DropIndex",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "indexName": index_name.clone(),
                "statement": format!(
                    "db.GetCollection(\"{}\").DropIndex(\"{}\");",
                    escape_double_quoted(&collection),
                    escape_double_quoted(&index_name)
                )
            }),
            &database_file,
            "index-drop",
            true,
        );
    }

    if operation_id.ends_with("file-storage.import") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        let source_path = string_parameter(parameters, "sourcePath")
            .or_else(|| string_parameter(parameters, "inputPath"))
            .unwrap_or_else(|| "<selected-file>".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.ImportFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "sourcePath": source_path,
                "filename": string_parameter(parameters, "filename").unwrap_or_else(|| "<source filename>".into()),
                "overwrite": parameters.and_then(|values| values.get("overwrite")).and_then(Value::as_bool).unwrap_or(false),
                "preflight": ["verify-source-file", "check-existing-file-id", "confirm-overwrite-policy"],
                "validation": ["find-file-after-upload", "compare-byte-count"]
            }),
            &database_file,
            "file-storage-import",
            true,
        );
    }

    if operation_id.ends_with("file-storage.export") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.ExportFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "targetPath": target_path,
                "overwrite": parameters.and_then(|values| values.get("overwrite")).and_then(Value::as_bool).unwrap_or(false),
                "preflight": ["find-file", "verify-target-parent", "confirm-overwrite-policy"],
                "validation": ["compare-byte-count", "verify-target-file"]
            }),
            &database_file,
            "file-storage-export",
            false,
        );
    }

    if operation_id.ends_with("file-storage.delete") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DeleteFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "preflight": ["find-file", "confirm-file-id"],
                "validation": ["find-file-after-delete"]
            }),
            &database_file,
            "file-storage-delete",
            true,
        );
    }

    if operation_id.ends_with("data.import-export") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "export".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": if mode == "import" { "LiteDB.ImportCollection" } else { "LiteDB.ExportCollection" },
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "format": format.clone(),
                "file": if format == "ndjson" { "<selected-file>.ndjson" } else { "<selected-file>.json" },
                "validation": if mode == "import" { "parse-bson-and-validate-indexes" } else { "stream-with-bounded-memory" }
            }),
            &database_file,
            &format!("data-{mode}"),
            mode == "import",
        );
    }

    if operation_id.ends_with("data.backup-restore") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Backup",
                "databaseFile": database_file.clone(),
                "outputFile": "<selected-folder>/backup.db",
                "preflight": ["checkpoint", "verify-file-lock", "preserve-encryption-settings"]
            }),
            &database_file,
            "data-backup",
            false,
        );
    }

    if operation_id.ends_with("object.drop") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DropCollection",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "statement": format!(
                    "db.DropCollection(\"{}\");",
                    escape_double_quoted(&collection)
                )
            }),
            &database_file,
            "object-drop",
            true,
        );
    }

    litedb_operation_plan(
        serde_json::json!({
            "operation": operation_id,
            "databaseFile": database_file.clone(),
            "collection": collection.clone()
        }),
        &database_file,
        "operation-preview",
        false,
    )
}

fn litedb_operation_plan(
    mut plan: Value,
    database_file: &str,
    intent: &str,
    write_intent: bool,
) -> String {
    let preflight = litedb_local_file_preflight_plan(database_file, intent, write_intent);
    if let Some(object) = plan.as_object_mut() {
        object.insert("localFilePreflight".into(), preflight.clone());
        object.insert(
            "sidecarExecutionBoundary".into(),
            preflight["sidecarExecutionBoundary"].clone(),
        );
    }
    serde_json::to_string_pretty(&plan).unwrap_or_else(|_| "{}".into())
}

fn litedb_local_file_preflight_plan(
    database_file: &str,
    intent: &str,
    write_intent: bool,
) -> Value {
    serde_json::json!({
        "databaseFile": database_file,
        "intent": intent,
        "pathResolution": {
            "source": "operation-parameters",
            "normalizedPath": database_file,
            "requiresConcreteLocalPathBeforeExecution": true
        },
        "probes": ["filesystem-read-open", "filesystem-write-open-if-writable"],
        "encryptionBoundary": {
            "passwordSource": "connection-profile-secret",
            "status": "sidecar-required",
            "requiredForEncryptedFiles": [
                "redacted password resolution",
                "sidecar LiteDB open probe",
                "request validation against the encrypted file"
            ]
        },
        "lockBoundary": {
            "scope": "local-file-preflight",
            "writeIntent": write_intent,
            "crossProcessContentionValidated": false,
            "exclusiveWriterLockValidated": false,
            "sidecarLockProbe": "required-before-live-execution",
            "residualRisks": [
                "Plain filesystem probes do not prove LiteDB engine shared/exclusive lock behavior.",
                "External-process contention and dirty-page checkpoint state require the .NET sidecar."
            ]
        },
        "sidecarExecutionBoundary": {
            "runtime": "dotnet-litedb-sidecar",
            "status": "plan-only-until-sidecar",
            "intent": intent,
            "writeIntent": write_intent,
            "requestShapeValidated": true,
            "liveExecutionValidated": false,
            "blockedReasons": [
                "sidecar-dispatch-not-implemented",
                if write_intent { "exclusive-writer-lock-not-validated" } else { "litedb-engine-open-probe-not-validated" },
                "encrypted-file-open-not-validated"
            ],
            "promotionRequirements": [
                "bundled or configured LiteDB sidecar executable",
                "sidecar read/open probe with bounded response",
                "exclusive writer-lock evidence for mutations and maintenance",
                "encrypted-file open failure/success evidence without leaking secrets",
                "before/after validation for document edits and file workflows"
            ]
        }
    })
}

fn memcached_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let class_id = string_parameter(parameters, "classId");
    let key = string_parameter(parameters, "key")
        .filter(|value| memcached_key_is_single_token(value))
        .unwrap_or_else(|| object_name.into());
    let key = if memcached_key_is_single_token(&key) {
        key
    } else {
        "<key>".into()
    };

    if operation_id.ends_with("diagnostics.metrics") {
        return "stats\nstats settings\nstats slabs\nstats items\nstats conns".into();
    }

    if operation_id.ends_with("metadata.refresh") {
        return string_parameter(parameters, "command").unwrap_or_else(|| "stats".into());
    }

    if operation_id.ends_with("stats.reset") {
        return "stats\nstats reset\n# Resets server counters only; cached values remain in place."
            .into();
    }

    if operation_id.ends_with("cache.flush") {
        let delay_seconds = numeric_parameter(parameters, "delaySeconds").unwrap_or(0);
        return if delay_seconds > 0 {
            format!(
                "stats\nflush_all {delay_seconds}\n# Destructive: expires every cached item on this Memcached server."
            )
        } else {
            "stats\nflush_all\n# Destructive: expires every cached item on this Memcached server."
                .into()
        };
    }

    if operation_id.ends_with("data.import-export") {
        return format!(
            "lru_crawler enable\n{}\n# Values are not exported unless keys are explicitly selected.",
            class_id
                .map(|value| format!("lru_crawler metadump {value}"))
                .unwrap_or_else(|| "lru_crawler metadump all".into())
        );
    }

    if operation_id.ends_with("key.get") {
        return format!("get {key}");
    }

    if operation_id.ends_with("key.gets") {
        return format!("gets {key}");
    }

    if operation_id.ends_with("key.set") {
        let value = string_parameter(parameters, "value").unwrap_or_else(|| "<value>".into());
        let flags = numeric_parameter(parameters, "flags").unwrap_or(0);
        let ttl_seconds = numeric_parameter(parameters, "ttlSeconds").unwrap_or(300);
        return format!("set {key} {flags} {ttl_seconds} {}\n{value}", value.len());
    }

    if operation_id.ends_with("key.delete") {
        return format!("delete {key}");
    }

    if operation_id.ends_with("key.touch") {
        let ttl_seconds = numeric_parameter(parameters, "ttlSeconds").unwrap_or(300);
        return format!("touch {key} {ttl_seconds}");
    }

    if operation_id.ends_with("key.increment") {
        let delta = numeric_parameter(parameters, "delta").unwrap_or(1);
        return format!("incr {key} {delta}");
    }

    if operation_id.ends_with("key.decrement") {
        let delta = numeric_parameter(parameters, "delta").unwrap_or(1);
        return format!("decr {key} {delta}");
    }

    format!("stats\n# {operation_id}\n# scope: {object_name}")
}

fn memcached_key_is_single_token(key: &str) -> bool {
    let trimmed = key.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 250
        && trimmed
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

fn search_operation_request(
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let object_path = search_path_segment(object_name);

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "explain": true,
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": numeric_parameter(parameters, "size").unwrap_or(20)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "profile": true,
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": numeric_parameter(parameters, "size").unwrap_or(20)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}"),
            "body": {
                "settings": parameters
                    .and_then(|values| values.get("settings"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "number_of_shards": 1, "number_of_replicas": 1 })),
                "mappings": parameters
                    .and_then(|values| values.get("mappings"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "properties": {} }))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.refresh") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_refresh")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.force-merge") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_forcemerge"),
            "body": {
                "max_num_segments": numeric_parameter(parameters, "maxNumSegments").unwrap_or(1),
                "only_expunge_deletes": bool_parameter(parameters, "onlyExpungeDeletes").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.clear-cache") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_cache/clear"),
            "body": {
                "query": bool_parameter(parameters, "queryCache").unwrap_or(true),
                "request": bool_parameter(parameters, "requestCache").unwrap_or(true),
                "fielddata": bool_parameter(parameters, "fielddataCache").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.reindex") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_reindex",
            "body": {
                "source": {
                    "index": object_name,
                    "query": { "match_all": {} }
                },
                "dest": {
                    "index": string_parameter(parameters, "destinationIndex")
                        .unwrap_or_else(|| format!("{object_name}-reindexed"))
                },
                "conflicts": string_parameter(parameters, "conflicts").unwrap_or_else(|| "proceed".into())
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.close") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_close")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.open") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_open")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.put-mapping") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}/_mapping"),
            "body": parameters
                .and_then(|values| values.get("mappings"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({
                    "properties": {
                        "new_field": { "type": "keyword" }
                    }
                }))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.update-settings") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_path}/_settings"),
            "body": parameters
                .and_then(|values| values.get("settings"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({
                    "index": {
                        "refresh_interval": "1s"
                    }
                }))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/{object_path}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.put") {
        let alias =
            string_parameter(parameters, "alias").unwrap_or_else(|| format!("{object_name}-read"));
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "add": { "index": object_name, "alias": alias } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.delete") {
        let alias = string_parameter(parameters, "alias").unwrap_or_else(|| object_name.into());
        let index = string_parameter(parameters, "index").unwrap_or_else(|| "*".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "remove": { "index": index, "alias": alias } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.explain") {
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/explain/{object_path}")
        } else {
            format!("/{object_path}/_ilm/explain")
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data-stream.rollover") {
        let conditions = parameters
            .and_then(|values| values.get("conditions"))
            .cloned()
            .unwrap_or_else(|| {
                serde_json::json!({
                    "max_age": "30d",
                    "max_primary_shard_size": "50gb"
                })
            });
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_path}/_rollover"),
            "body": {
                "conditions": conditions
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.create") {
        let template_name =
            string_parameter(parameters, "templateName").unwrap_or_else(|| object_name.into());
        let template_path = search_template_path(&template_name, parameters);
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": template_path,
            "body": {
                "index_patterns": parameters
                    .and_then(|values| values.get("indexPatterns"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([format!("{template_name}-*")])),
                "template": parameters
                    .and_then(|values| values.get("template"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({
                        "settings": { "number_of_shards": 1 },
                        "mappings": { "properties": {} }
                    })),
                "priority": numeric_parameter(parameters, "priority").unwrap_or(100)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.delete") {
        let template_name =
            string_parameter(parameters, "templateName").unwrap_or_else(|| object_name.into());
        let template_path = search_template_path(&template_name, parameters);
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": template_path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.put") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/_ingest/pipeline/{object_path}"),
            "body": {
                "description": string_parameter(parameters, "description")
                    .unwrap_or_else(|| "DataPad++ pipeline preview".into()),
                "processors": parameters
                    .and_then(|values| values.get("processors"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([
                        { "set": { "field": "processed_at", "value": "{{_ingest.timestamp}}" } }
                    ])),
                "on_failure": parameters
                    .and_then(|values| values.get("onFailure"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.simulate") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_ingest/pipeline/{object_path}/_simulate"),
            "body": {
                "docs": parameters
                    .and_then(|values| values.get("documents"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.put") {
        let policy_name =
            string_parameter(parameters, "policyName").unwrap_or_else(|| object_name.into());
        let policy_path = search_path_segment(&policy_name);
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/policies/{policy_path}")
        } else {
            format!("/_ilm/policy/{policy_path}")
        };
        let body = if let Some(policy) = parameters.and_then(|values| values.get("policy")) {
            policy.clone()
        } else if operation_id.starts_with("opensearch.") {
            serde_json::json!({ "policy": { "description": "DataPad++ preview policy", "states": [] } })
        } else {
            serde_json::json!({ "policy": { "phases": { "hot": { "actions": {} } } } })
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": path,
            "body": body
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("task.cancel") {
        let task_id = string_parameter(parameters, "taskId").unwrap_or_else(|| object_name.into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_tasks/{}/_cancel", search_path_segment(&task_id))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("snapshot.restore") {
        let repository =
            string_parameter(parameters, "repository").unwrap_or_else(|| "<repository>".into());
        let snapshot =
            string_parameter(parameters, "snapshot").unwrap_or_else(|| object_name.into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!(
                "/_snapshot/{}/{}/_restore",
                search_path_segment(&repository),
                search_path_segment(&snapshot)
            ),
            "body": {
                "indices": parameters
                    .and_then(|values| values.get("indices"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!("*")),
                "include_global_state": bool_parameter(parameters, "includeGlobalState").unwrap_or(false)
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        let path = if operation_id.starts_with("opensearch.") {
            "/_plugins/_security/api/roles"
        } else {
            "/_security/role"
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.slow-log") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Search.SlowLogDashboardPlan",
            "requests": [
                { "method": "GET", "path": "/_settings?filter_path=**.search.slowlog*" },
                { "method": "GET", "path": "/_nodes/stats/indices/search,indexing" },
                { "method": "GET", "path": format!("/{object_path}/_stats/search,indexing") }
            ],
            "executionGate": search_execution_gate("diagnostics.slow-log")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.allocation") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Search.AllocationExplainPlan",
            "requests": [
                { "method": "GET", "path": "/_cluster/allocation/explain" },
                { "method": "GET", "path": "/_cat/shards?format=json&bytes=b" },
                { "method": "GET", "path": "/_cluster/health?level=shards" }
            ],
            "executionGate": search_execution_gate("diagnostics.allocation")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_path),
            "body": {
                "query": parameters
                    .and_then(|values| values.get("query"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "match_all": {} })),
                "size": 1000,
                "sort": ["_doc"],
                "format": string_parameter(parameters, "format").unwrap_or_else(|| "ndjson".into())
            },
            "executionGate": search_execution_gate("import-export")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.backup-restore") {
        let repository =
            string_parameter(parameters, "repository").unwrap_or_else(|| "<repository>".into());
        let snapshot =
            string_parameter(parameters, "snapshot").unwrap_or_else(|| "<snapshot>".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!(
                "/_snapshot/{}/{}",
                search_path_segment(&repository),
                search_path_segment(&snapshot)
            ),
            "body": {
                "indices": object_name,
                "include_global_state": bool_parameter(parameters, "includeGlobalState").unwrap_or(false)
            },
            "executionGate": search_execution_gate("snapshot")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!(
        "{{\n  \"index\": \"{object_name}\",\n  \"body\": {{\n    \"query\": {{ \"match_all\": {{}} }},\n    \"size\": 100\n  }},\n  \"operation\": \"{operation_id}\",\n  \"parameters\": {parameter_json}\n}}"
    )
}

fn search_execution_gate(boundary: &str) -> Value {
    serde_json::json!({
        "defaultSupport": "plan-only",
        "evidence": "plan-only",
        "boundary": boundary,
        "runtimeEvidence": "contract",
        "disabledReasons": [
            "Search admin/import/export execution remains preview-first until permission, shard-impact, snapshot repository, and rollback boundaries are live-validated.",
            "Live search runtime currently supports plain HTTP endpoints with none/basic auth; HTTPS, cloud, token, API-key, and SigV4 profiles stay plan-only unless separately validated."
        ]
    })
}

fn search_template_path(
    template_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let object_kind = string_parameter(parameters, "objectKind").unwrap_or_default();
    let template_type = string_parameter(parameters, "templateType").unwrap_or_default();
    let prefix = if object_kind == "component-template" || template_type == "component" {
        "/_component_template"
    } else {
        "/_index_template"
    };
    let suffix = search_path_segment(template_name);

    format!("{prefix}/{suffix}")
}

fn search_path_segment(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with('<') && trimmed.ends_with('>') {
        return trimmed.into();
    }

    trimmed
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'*') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

fn graph_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "arango" => arango_graph_operation_request(operation_id, object_name, parameters),
        "neptune" => neptune_graph_operation_request(operation_id, object_name, parameters),
        "janusgraph" => janusgraph_operation_request(operation_id, object_name, parameters),
        _ => neo4j_operation_request(operation_id, object_name, parameters),
    }
}

fn neo4j_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "MATCH (n:{}) RETURN n LIMIT 100",
            cypher_identifier(object_name)
        )
    });
    let label = string_parameter(parameters, "label").unwrap_or_else(|| object_name.into());
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName").unwrap_or_else(|| {
        format!(
            "{}_{}_lookup",
            safe_identifier(&label),
            safe_identifier(&property)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN {}", strip_plan_prefix(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!("PROFILE {}", strip_plan_prefix(&query));
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "CALL dbms.queryJmx(\"org.neo4j:*\") YIELD name, attributes RETURN name, attributes LIMIT 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "SHOW USERS;\nSHOW ROLES;\nSHOW PRIVILEGES;".into();
    }

    if operation_id.ends_with("index.create") {
        return format!(
            "CREATE INDEX {} IF NOT EXISTS FOR (n:{}) ON (n.{});",
            cypher_identifier(&index_name),
            cypher_identifier(&label),
            cypher_identifier(&property)
        );
    }

    if operation_id.ends_with("index.drop") {
        return format!("DROP INDEX {} IF EXISTS;", cypher_identifier(&index_name));
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "neo4j.export",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "graph-json".into()),
            "query": query,
            "scope": object_name,
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        let constraint_name =
            string_parameter(parameters, "constraintName").unwrap_or_else(|| object_name.into());
        return format!(
            "DROP CONSTRAINT {} IF EXISTS;",
            cypher_identifier(&constraint_name)
        );
    }

    query
}

fn arango_graph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query")
        .unwrap_or_else(|| format!("FOR doc IN {object_name} LIMIT 100 RETURN doc"));
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("{object_name}_{property}_idx"));

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/explain",
            "body": {
                "query": query,
                "options": { "allPlans": true }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/explain",
            "body": {
                "query": query,
                "options": { "allPlans": true, "profile": true }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/_admin/statistics"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/_api/user"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_api/index?collection={object_name}"),
            "body": {
                "name": index_name,
                "type": "persistent",
                "fields": [property]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/_api/index/{index_name}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/export",
            "body": {
                "collection": object_name,
                "format": string_parameter(parameters, "format").unwrap_or_else(|| "jsonl".into()),
                "query": query
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn neptune_graph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "g.V().hasLabel('{}').limit(100)",
            escape_single_quoted(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/gremlin/explain",
            "body": { "gremlin": query }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/gremlin/profile",
            "body": { "gremlin": query }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CloudWatch.GetMetricData",
            "namespace": "AWS/Neptune",
            "cluster": object_name,
            "metrics": ["CPUUtilization", "GremlinRequestsPerSec", "SparqlRequestsPerSec", "BufferCacheHitRatio"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "IAM.SimulatePrincipalPolicy",
            "resource": object_name,
            "actions": ["neptune-db:ReadDataViaQuery", "neptune-db:WriteDataViaQuery", "neptune-db:GetQueryStatus"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Neptune.StartLoaderJob",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "source": string_parameter(parameters, "source").unwrap_or_else(|| "<selected-s3-location>".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "neptune-bulk".into()),
            "scope": object_name,
            "validation": "validate-before-write"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn janusgraph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "g.V().hasLabel('{}').limit(100)",
            escape_single_quoted(object_name)
        )
    });
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("{object_name}_{property}_idx"));

    if operation_id.ends_with("query.explain") {
        return format!("{query}.explain()");
    }

    if operation_id.ends_with("query.profile") {
        return format!("{query}.profile()");
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return [
            "mgmt = graph.openManagement()",
            "mgmt.getRelationTypes(VertexLabel).collect { it.name() }",
            "mgmt.getGraphIndexes(Vertex).collect { it.name() }",
            "mgmt.rollback()",
        ]
        .join("\n");
    }

    if operation_id.ends_with("index.create") {
        return [
            "mgmt = graph.openManagement()".into(),
            format!(
                "key = mgmt.getPropertyKey('{}')",
                escape_single_quoted(&property)
            ),
            format!(
                "mgmt.buildIndex('{}', Vertex.class).addKey(key).buildCompositeIndex()",
                escape_single_quoted(&index_name)
            ),
            "mgmt.commit()".into(),
        ]
        .join("\n");
    }

    if operation_id.ends_with("index.drop") {
        return [
            "mgmt = graph.openManagement()".into(),
            format!(
                "index = mgmt.getGraphIndex('{}')",
                escape_single_quoted(&index_name)
            ),
            "mgmt.updateIndex(index, SchemaAction.DISABLE_INDEX).get()".into(),
            "mgmt.commit()".into(),
        ]
        .join("\n");
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "janusgraph.export",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "graph-json".into()),
            "query": query,
            "scope": object_name,
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn warehouse_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "bigquery" => bigquery_operation_request(operation_id, object_name, parameters),
        "clickhouse" => clickhouse_operation_request(operation_id, object_name, parameters),
        _ => snowflake_operation_request(operation_id, object_name, parameters),
    }
}

fn snowflake_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "select * from {} limit 100;",
            snowflake_identifier(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN USING TEXT\n{};", strip_trailing_semicolon(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!(
            "{};\nselect * from table(information_schema.query_history()) order by start_time desc limit 20;",
            strip_trailing_semicolon(&query)
        );
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select * from table(information_schema.warehouse_load_history()) order by start_time desc limit 100;\nselect * from table(information_schema.query_history()) order by start_time desc limit 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "show grants to role <active_role>;\nshow grants on schema <database>.<schema>;"
            .into();
    }

    if operation_id.ends_with("data.import-export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        return format!(
            "COPY INTO @<stage>/{object_name}.{format}\nFROM {}\nFILE_FORMAT = (TYPE = {} HEADER = TRUE);",
            snowflake_identifier(object_name),
            format.to_uppercase()
        );
    }

    if operation_id.ends_with("table.clone") {
        let clone_name = string_parameter(parameters, "cloneName")
            .unwrap_or_else(|| format!("{object_name}_clone"));
        return format!(
            "CREATE TABLE {} CLONE {};",
            snowflake_identifier(&clone_name),
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("warehouse.suspend") {
        return format!(
            "ALTER WAREHOUSE {} SUSPEND;",
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("warehouse.resume") {
        return format!(
            "ALTER WAREHOUSE {} RESUME;",
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\nDROP TABLE IF EXISTS {};",
            snowflake_identifier(object_name)
        );
    }

    query
}

fn bigquery_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| "<dataset>".into());
    let query = string_parameter(parameters, "query")
        .unwrap_or_else(|| format!("select * from `{schema}.{object_name}` limit 100;"));

    if operation_id.ends_with("query.explain") || operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.Jobs.QueryDryRun",
            "dryRun": true,
            "useQueryCache": false,
            "query": query,
            "estimate": ["bytesProcessed", "slotMs", "referencedTables"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select creation_time, job_id, state, total_bytes_processed, total_slot_ms\nfrom `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT\norder by creation_time desc limit 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.TestIamPermissions",
            "resource": format!("projects/<project>/datasets/{schema}"),
            "permissions": ["bigquery.tables.get", "bigquery.tables.getData", "bigquery.tables.update", "bigquery.jobs.create"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.ExtractJob",
            "table": object_name,
            "destination": "gs://<selected-bucket>/<path>",
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "avro".into()),
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("table.copy") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.Tables.Copy",
            "sourceTable": object_name,
            "destinationTable": string_parameter(parameters, "destinationTable").unwrap_or_else(|| format!("{object_name}_copy")),
            "writeDisposition": "WRITE_EMPTY",
            "preflight": ["getTable", "testIamPermissions", "dryRunReferenceQuery"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn clickhouse_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "select * from {} limit 100;",
            clickhouse_identifier(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN PIPELINE\n{};", strip_trailing_semicolon(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!(
            "{} settings log_queries = 1;\nselect query_id, read_rows, read_bytes, memory_usage, query_duration_ms\nfrom system.query_log\nwhere type = 'QueryFinish'\norder by event_time desc limit 20;",
            strip_trailing_semicolon(&query)
        );
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select event_time, query_id, read_rows, read_bytes, memory_usage, query_duration_ms\nfrom system.query_log\norder by event_time desc limit 100;\nselect * from system.metrics;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "show grants;\nselect * from system.users;\nselect * from system.roles;".into();
    }

    if operation_id.ends_with("data.import-export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "parquet".into());
        return format!(
            "SELECT * FROM {} INTO OUTFILE '<selected-file>' FORMAT {};",
            clickhouse_identifier(object_name),
            format.to_uppercase()
        );
    }

    if operation_id.ends_with("table.optimize") {
        return format!(
            "OPTIMIZE TABLE {} FINAL;",
            clickhouse_identifier(object_name)
        );
    }

    if operation_id.ends_with("table.materialize-ttl") {
        return format!(
            "ALTER TABLE {} MATERIALIZE TTL;",
            clickhouse_identifier(object_name)
        );
    }

    if operation_id.ends_with("table.freeze") {
        let snapshot_name = string_parameter(parameters, "snapshotName")
            .unwrap_or_else(|| format!("{object_name}_snapshot"));
        return format!(
            "ALTER TABLE {} FREEZE WITH NAME '{}';",
            clickhouse_identifier(object_name),
            escape_single_quoted(&snapshot_name)
        );
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\nDROP TABLE IF EXISTS {};",
            clickhouse_identifier(object_name)
        );
    }

    query
}

fn timeseries_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "prometheus" => prometheus_operation_request(operation_id, object_name, parameters),
        "influxdb" => influx_operation_request(operation_id, object_name, parameters),
        "opentsdb" => opentsdb_operation_request(operation_id, object_name, parameters),
        _ => format!(
            "{{\n  \"operation\": \"{operation_id}\",\n  \"object\": \"{object_name}\",\n  \"parameters\": {parameter_json}\n}}"
        ),
    }
}

fn prometheus_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let query = parameter("query")
        .and_then(Value::as_str)
        .unwrap_or(object_name);

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v1/query",
            "query": {
                "query": query,
                "time": "now"
            },
            "profile": {
                "range": parameter("range").and_then(Value::as_str).unwrap_or("5m"),
                "checks": ["cardinality", "sample-count", "step-width"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": prometheus_diagnostics_path(parameter("objectKind").and_then(Value::as_str)),
            "query": {
                "scope": parameter("objectKind").and_then(Value::as_str).unwrap_or("diagnostics")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("cardinality.analyze") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v1/series",
            "query": {
                "match": [parameter("match").and_then(Value::as_str).unwrap_or(query)],
                "start": parameter("start").and_then(Value::as_str).unwrap_or("now-1h"),
                "end": parameter("end").and_then(Value::as_str).unwrap_or("now")
            },
            "analysis": {
                "groupBy": ["__name__", "job", "instance"],
                "checks": ["label-value-count", "series-count", "high-cardinality-labels"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "prometheus.range-export",
            "method": "GET",
            "path": "/api/v1/query_range",
            "query": {
                "query": query,
                "start": parameter("start").and_then(Value::as_str).unwrap_or("now-1h"),
                "end": parameter("end").and_then(Value::as_str).unwrap_or("now"),
                "step": parameter("step").and_then(Value::as_str).unwrap_or("30s")
            },
            "format": parameter("format").and_then(Value::as_str).unwrap_or("json"),
            "validation": ["bounded-range", "cardinality-check", "result-snapshot-only"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{}\n# {operation_id}", query)
}

fn influx_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let bucket = parameter("bucket")
        .and_then(Value::as_str)
        .unwrap_or("<bucket>");
    let measurement = parameter("measurement")
        .and_then(Value::as_str)
        .unwrap_or(object_name);
    let query = parameter("query")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "from(bucket: \"{bucket}\")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == \"{measurement}\")"
            )
        });

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/api/v2/query",
            "query": {
                "org": parameter("org").and_then(Value::as_str).unwrap_or("<org>")
            },
            "body": {
                "query": query,
                "type": "flux",
                "profilers": ["query", "operator"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/metrics",
            "query": {
                "bucket": bucket,
                "measurement": measurement
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v2/authorizations",
            "query": {
                "org": parameter("org").and_then(Value::as_str).unwrap_or("<org>"),
                "bucket": bucket
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("retention.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PATCH",
            "path": format!("/api/v2/buckets/{object_name}"),
            "body": {
                "name": bucket,
                "retentionRules": [{
                    "type": "expire",
                    "everySeconds": retention_seconds(parameter("retentionPeriod").and_then(Value::as_str))
                }]
            },
            "validation": ["read-current-bucket", "estimate-affected-series", "confirm-retention-window"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": if mode == "import" { "line-protocol.import" } else { "line-protocol.export" },
            "bucket": bucket,
            "measurement": measurement,
            "format": parameter("format").and_then(Value::as_str).unwrap_or("line-protocol"),
            "query": query,
            "validation": if mode == "import" { "validate-before-write" } else { "bounded-export" }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": influx_delete_path(parameter("objectKind").and_then(Value::as_str), object_name),
            "body": {
                "bucket": bucket,
                "measurement": measurement,
                "predicate": parameter("predicate")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("_measurement=\"{measurement}\"")),
                "window": parameter("window").and_then(Value::as_str).unwrap_or("1970-01-01T00:00:00Z..now")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn opentsdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let metric = parameter("metric")
        .and_then(Value::as_str)
        .unwrap_or(object_name);

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/stats",
            "query": {
                "scope": parameter("objectKind").and_then(Value::as_str).unwrap_or("stats"),
                "metric": metric
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/api/query",
            "body": {
                "start": parameter("start").and_then(Value::as_str).unwrap_or("1h-ago"),
                "queries": [{
                    "metric": metric,
                    "aggregator": parameter("aggregator").and_then(Value::as_str).unwrap_or("avg"),
                    "downsample": parameter("downsample").and_then(Value::as_str).unwrap_or("1m-avg"),
                    "tags": parameter("tags").cloned().unwrap_or_else(|| serde_json::json!({}))
                }],
                "format": parameter("format").and_then(Value::as_str).unwrap_or("json")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("uid.repair") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "opentsdb.uid.repair",
            "metric": metric,
            "objectKind": parameter("objectKind").and_then(Value::as_str).unwrap_or("metric"),
            "preflight": ["lookup-uid", "load-meta", "validate-tree-rules", "dry-run-meta-update"],
            "update": {
                "displayName": parameter("displayName").and_then(Value::as_str).unwrap_or(metric),
                "notes": parameter("notes").and_then(Value::as_str).unwrap_or("Prepared by DataPad++ guarded UID repair.")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "opentsdb.metadata.delete",
            "object": metric,
            "objectKind": parameter("objectKind").and_then(Value::as_str).unwrap_or("metric"),
            "preflight": ["lookup-uid", "check-tree-rules", "scan-recent-series"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{{\n  \"metric\": \"{metric}\",\n  \"operation\": \"{operation_id}\"\n}}")
}

fn prometheus_diagnostics_path(kind: Option<&str>) -> &'static str {
    match kind.unwrap_or_default() {
        "targets" | "target" => "/api/v1/targets",
        "rules" | "rule" | "alerts" | "alert" => "/api/v1/rules",
        _ => "/api/v1/status/tsdb",
    }
}

fn retention_seconds(value: Option<&str>) -> i64 {
    let text = value.unwrap_or("30d").trim();
    if text.is_empty() {
        return 30 * 24 * 60 * 60;
    }
    let (amount_text, multiplier) = match text.chars().last().unwrap_or('d') {
        'h' | 'H' => (&text[..text.len().saturating_sub(1)], 60 * 60),
        'm' | 'M' => (&text[..text.len().saturating_sub(1)], 60),
        'd' | 'D' => (&text[..text.len().saturating_sub(1)], 24 * 60 * 60),
        _ => (text, 24 * 60 * 60),
    };
    amount_text
        .trim()
        .parse::<i64>()
        .map(|amount| amount * multiplier)
        .unwrap_or(30 * 24 * 60 * 60)
}

fn influx_delete_path(kind: Option<&str>, object_name: &str) -> String {
    let normalized = kind.unwrap_or_default().replace('_', "-");

    if normalized.contains("bucket") {
        return format!("/api/v2/buckets/{object_name}");
    }

    if normalized.contains("task") {
        return format!("/api/v2/tasks/{object_name}");
    }

    "/api/v2/delete".into()
}

fn widecolumn_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    if manifest.engine == "dynamodb" {
        return dynamodb_operation_request(operation_id, object_name, parameters);
    }

    if manifest.engine == "cassandra" {
        return cassandra_operation_request(operation_id, object_name, parameters);
    }

    match manifest.default_language.as_str() {
        "cql" => format!("select * from {object_name} limit 100;"),
        _ => format!("{{\n  \"TableName\": \"{object_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\",\n  \"Parameters\": {parameter_json}\n}}"),
    }
}

fn dynamodb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let table_name = parameter("tableName")
        .and_then(Value::as_str)
        .unwrap_or(object_name);
    let index_name = parameter("indexName")
        .and_then(Value::as_str)
        .unwrap_or("<index>");
    let region = parameter("region")
        .and_then(Value::as_str)
        .unwrap_or("local");

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CloudWatch.GetMetricData",
            "namespace": "AWS/DynamoDB",
            "region": region,
            "tableName": table_name,
            "metrics": [
                "ConsumedReadCapacityUnits",
                "ConsumedWriteCapacityUnits",
                "ReadThrottleEvents",
                "WriteThrottleEvents",
                "SuccessfulRequestLatency"
            ],
            "period": "5m",
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "requests": [
                { "operation": "DynamoDB.ListTables" },
                { "operation": "DynamoDB.DescribeLimits" },
                { "operation": "DynamoDB.DescribeTable", "tableName": table_name },
                { "operation": "DynamoDB.DescribeTimeToLive", "tableName": table_name },
                { "operation": "DynamoDB.DescribeContinuousBackups", "tableName": table_name },
                { "operation": "CloudWatch.GetMetricData", "namespace": "AWS/DynamoDB" }
            ],
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "IAM.SimulatePrincipalPolicy",
            "tableName": table_name,
            "resourceArn": format!("arn:aws:dynamodb:<region>:<account>:table/{table_name}"),
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "evaluation": "plan-only-with-disabled-reason",
            "actions": [
                "dynamodb:DescribeTable",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem"
            ],
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        let partition_key = parameter("partitionKey")
            .and_then(Value::as_str)
            .unwrap_or("pk");
        let sort_key = parameter("sortKey").and_then(Value::as_str);
        let mut key_schema = vec![serde_json::json!({
            "attributeName": partition_key,
            "keyType": "HASH"
        })];
        if let Some(sort_key) = sort_key.filter(|value| !value.trim().is_empty()) {
            key_schema.push(serde_json::json!({
                "attributeName": sort_key,
                "keyType": "RANGE"
            }));
        }

        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "globalSecondaryIndexUpdates": [{
                "create": {
                    "indexName": index_name,
                    "keySchema": key_schema,
                    "projection": {
                        "projectionType": parameter("projection")
                            .and_then(Value::as_str)
                            .unwrap_or("ALL")
                    },
                    "billingMode": "matches-table"
                }
            }]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "globalSecondaryIndexUpdates": [{
                "delete": {
                    "indexName": index_name
                }
            }]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("capacity.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "billingMode": parameter("billingMode")
                .and_then(Value::as_str)
                .unwrap_or("PAY_PER_REQUEST"),
            "provisionedThroughput": {
                "readCapacityUnits": parameter("readCapacityUnits")
                    .and_then(Value::as_u64)
                    .unwrap_or(100),
                "writeCapacityUnits": parameter("writeCapacityUnits")
                    .and_then(Value::as_u64)
                    .unwrap_or(50)
            },
            "preflight": ["DescribeTable", "CheckAutoScalingPolicies", "EstimateCost"],
            "authEvidence": dynamodb_contract_auth_evidence(region)
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("ttl.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTimeToLive",
            "tableName": table_name,
            "timeToLiveSpecification": {
                "enabled": parameter("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                "attributeName": parameter("ttlAttribute")
                    .and_then(Value::as_str)
                    .unwrap_or("expiresAt")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("streams.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "streamSpecification": {
                "streamEnabled": parameter("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                "streamViewType": parameter("streamViewType")
                    .and_then(Value::as_str)
                    .unwrap_or("NEW_AND_OLD_IMAGES")
            },
            "preflight": ["DescribeTable", "CheckLambdaEventSourceMappings"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("backup.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.CreateBackup",
            "tableName": table_name,
            "backupName": parameter("backupName")
                .and_then(Value::as_str)
                .unwrap_or("manual-backup"),
            "preflight": ["DescribeTable", "ListBackups"],
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("backup.restore") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.RestoreTableFromBackup",
            "sourceBackupArn": parameter("sourceBackupArn")
                .and_then(Value::as_str)
                .unwrap_or("<selected-backup-arn>"),
            "targetTableName": parameter("targetTableName")
                .and_then(Value::as_str)
                .unwrap_or("<restored-table>"),
            "validation": "restore-preview",
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": if mode == "import" { "DynamoDB.ImportTable" } else { "DynamoDB.ExportTableToPointInTime" },
            "tableName": table_name,
            "format": parameter("format")
                .and_then(Value::as_str)
                .unwrap_or("dynamodb-json"),
            "s3Bucket": parameter("s3Bucket")
                .and_then(Value::as_str)
                .unwrap_or("<selected-bucket>"),
            "s3Prefix": parameter("s3Prefix")
                .and_then(Value::as_str)
                .unwrap_or(table_name),
            "validation": if mode == "import" { "validate-before-write" } else { "point-in-time-export" },
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.DeleteTable",
            "tableName": table_name,
            "preflight": ["DescribeTable", "ListBackups", "CheckDeletionProtection"],
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{{\n  \"TableName\": \"{table_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\"\n}}")
}

fn dynamodb_contract_auth_evidence(region: &str) -> Value {
    let signing_region = if region.trim().is_empty() || region == "local" {
        "us-east-1"
    } else {
        region
    };

    serde_json::json!({
        "scheme": "AWS4-HMAC-SHA256",
        "service": "dynamodb",
        "connectMode": "connection-profile",
        "credentialsProvider": "connection-profile",
        "signingRegion": signing_region,
        "endpointMode": "local-http-or-aws-cloud-contract",
        "signedJsonHttp": true,
        "liveCloudRuntime": false,
        "signedHeaders": ["content-type", "host", "x-amz-date", "x-amz-target"],
        "credentialScope": format!("20260101/{signing_region}/dynamodb/aws4_request"),
        "credentialMaterial": "Secret values stay in the desktop secret/profile resolver."
    })
}

fn dynamodb_cloud_disabled_reasons() -> Vec<&'static str> {
    vec![
        "AWS profile, STS AssumeRole, web identity, ECS task, EC2 metadata, and static secret-key resolution are contract-mode in default CI.",
        "CloudWatch account/table metrics, IAM policy simulation, S3 export/import, and cloud backup validation stay preview-first without optional AWS credentials.",
    ]
}

fn cassandra_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let keyspace = parameter("keyspace")
        .and_then(Value::as_str)
        .or_else(|| cassandra_keyspace_from_object_name(object_name))
        .unwrap_or("app");
    let table_name = parameter("tableName")
        .and_then(Value::as_str)
        .or_else(|| cassandra_table_from_object_name(object_name))
        .unwrap_or("<table>");
    let index_name = parameter("indexName")
        .and_then(Value::as_str)
        .unwrap_or("<index>");
    let column_name = parameter("columnName")
        .and_then(Value::as_str)
        .unwrap_or("column_name");

    if operation_id.ends_with("query.profile") {
        return format!(
            "tracing on;\nselect * from \"{keyspace}\".\"{table_name}\" limit 100;\ntracing off;\nselect * from system_traces.sessions limit 20;\nselect * from system_traces.events limit 100;"
        );
    }

    if operation_id.ends_with("security.inspect") {
        return format!("list all permissions on keyspace \"{keyspace}\";\nlist roles;");
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return format!(
            "select * from system.local;\nselect * from system.peers;\nselect * from system_schema.tables where keyspace_name = '{}';\n-- Add nodetool/JMX-backed compaction, repair, and latency metrics when the adapter has live access.",
            keyspace.replace('\'', "''")
        );
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        let format = parameter("format").and_then(Value::as_str).unwrap_or("csv");
        let direction = if mode == "import" { "from" } else { "to" };
        let with_clause = if format.eq_ignore_ascii_case("json") {
            "with header = true and null = '<null>'"
        } else {
            "with header = true"
        };
        return format!(
            "-- Cassandra {mode} plan for {keyspace}.{table_name}.\n-- cqlsh COPY is contract-only here; use live execution only after driver/tooling validation.\ncopy \"{}\".\"{}\" {direction} '<selected-file>.{format}' {with_clause};",
            escape_double_quoted(keyspace),
            escape_double_quoted(table_name)
        );
    }

    if operation_id.ends_with("data.backup-restore") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("backup");
        let snapshot_name = parameter("snapshotName")
            .and_then(Value::as_str)
            .unwrap_or("datapad_snapshot");
        if mode == "restore" {
            return format!(
                "-- Cassandra restore plan for {keyspace}.{table_name}.\n-- Stop writes, clear target SSTables only after backup verification, then stream validated SSTables.\nsstableloader -d <contact-points> '<snapshot-dir>/{}.{}/{}';",
                escape_double_quoted(keyspace),
                escape_double_quoted(table_name),
                escape_single_quoted(snapshot_name)
            );
        }

        return format!(
            "-- Cassandra backup plan for {keyspace}.{table_name}.\nnodetool snapshot --tag {} --table \"{}\" \"{}\";\n-- Record schema with: describe table \"{}\".\"{}\";",
            escape_single_quoted(snapshot_name),
            escape_double_quoted(table_name),
            escape_double_quoted(keyspace),
            escape_double_quoted(keyspace),
            escape_double_quoted(table_name)
        );
    }

    if operation_id.ends_with("index.create") {
        return format!(
            "create custom index if not exists \"{index_name}\" on \"{keyspace}\".\"{table_name}\" (\"{column_name}\") using 'StorageAttachedIndex';"
        );
    }

    if operation_id.ends_with("index.drop") {
        return format!("drop index if exists \"{keyspace}\".\"{index_name}\";");
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\ndrop {} if exists {object_name};",
            cassandra_object_kind(parameter("objectKind").and_then(Value::as_str))
        );
    }

    format!("select * from \"{keyspace}\".\"{table_name}\" limit 100;")
}

fn cassandra_keyspace_from_object_name(object_name: &str) -> Option<&str> {
    let mut parts = object_name.trim_matches('"').split("\".\"");
    let keyspace = parts.next()?;
    parts.next().map(|_| keyspace)
}

fn cassandra_table_from_object_name(object_name: &str) -> Option<&str> {
    object_name.trim_matches('"').split("\".\"").nth(1)
}

fn cassandra_object_kind(kind: Option<&str>) -> &'static str {
    match kind.unwrap_or_default().replace('-', " ").as_str() {
        "materialized view" => "materialized view",
        "type" => "type",
        "function" => "function",
        "aggregate" => "aggregate",
        _ => "table",
    }
}

fn sqlite_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
    parameter_json: &str,
) -> String {
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| {
        sqlite_object_parts(object_name)
            .map(|(schema, _)| schema)
            .unwrap_or_else(|| "main".into())
    });
    let table = string_parameter(parameters, "table")
        .or_else(|| sqlite_object_parts(object_name).map(|(_, table)| table));

    if operation_id.ends_with("index.create") {
        return format!(
            "create index [idx_{}_column_name] on {object_name} ([column_name]);",
            safe_sqlite_name(object_name)
        );
    }

    if operation_id.ends_with("index.drop") {
        return "-- Review before running.\ndrop index [index_name];".into();
    }

    if operation_id.ends_with("trigger.create") {
        return format!(
            "create trigger [trg_{}_audit]\nafter insert on {object_name}\nfor each row\nbegin\n  select raise(ignore);\nend;",
            safe_sqlite_name(object_name)
        );
    }

    if operation_id.contains("integrity-check") {
        return "pragma quick_check;\n-- Full check can be slower on large files:\npragma integrity_check;".into();
    }

    if operation_id.ends_with("database.analyze") {
        return "analyze;".into();
    }

    if operation_id.ends_with("table.analyze") {
        return format!("analyze {object_name};");
    }

    if operation_id.ends_with("database.optimize") {
        return "pragma optimize;".into();
    }

    if operation_id.ends_with("index.reindex") {
        return format!("reindex {object_name};");
    }

    if operation_id.contains("vacuum") {
        let compact_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.sqlite".into());
        return format!(
            "-- Review file path and locks before running.\nvacuum;\n-- Or compact into a new file:\nvacuum {schema} into '{}';",
            compact_path.replace('\'', "''")
        );
    }

    if operation_id.ends_with("database.backup") {
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.sqlite".into());
        return format!(
            "vacuum {} into '{}';\n-- Guardrails: absolute target path, parent folder must exist, overwrite requires explicit opt-in.",
            sqlite_quoted_identifier(&schema),
            target_path.replace('\'', "''")
        );
    }

    if operation_id.ends_with("table.export") {
        let table = table.unwrap_or_else(|| "<table>".into());
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.csv".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        let limit = numeric_parameter(parameters, "limit").unwrap_or(10_000);
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlite.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path,
            "limit": limit,
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false),
            "guardrails": [
                "absolute target path",
                "parent folder exists",
                "bounded row export",
                "overwrite opt-in"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("table.import") {
        let table = table.unwrap_or_else(|| "<table>".into());
        let source_path = string_parameter(parameters, "sourcePath")
            .or_else(|| string_parameter(parameters, "inputPath"))
            .unwrap_or_else(|| "<selected-file>.csv".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "append".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlite.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "sourcePath": source_path,
            "mode": mode,
            "guardrails": [
                "absolute source path",
                "existing target table",
                "CSV header or JSON object rows",
                "read-only connection blocked",
                "confirmation required before append"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.contains("backup") {
        return "-- SQLite backup/export plan.\n-- Use VACUUM INTO for a compact copy or the backup API for online snapshots.\nvacuum into 'backup.sqlite';".into();
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return format!(
            ".headers on\n.mode csv\n.output <selected-file>.csv\nselect * from {object_name};\n.output stdout"
        );
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "pragma database_list;\nselect type, name, tbl_name from sqlite_schema order by type, name;".into(),
        "execute" => format!("select * from {object_name} limit 100;"),
        "explain" => format!("explain query plan select * from {object_name} limit 100;"),
        "profile" => format!("explain select * from {object_name} limit 100;"),
        "create" => format!("create table {object_name} (\n  id integer primary key,\n  created_at text not null default current_timestamp\n) strict;"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
        "inspect" => "pragma table_list;\npragma database_list;\npragma foreign_key_check;".into(),
        "metrics" => "pragma page_count;\npragma page_size;\npragma freelist_count;\npragma quick_check;".into(),
        _ => format!("-- SQLite {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn safe_sqlite_name(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(64)
        .collect::<String>()
}

fn sqlite_object_parts(object_name: &str) -> Option<(String, String)> {
    let object_name = object_name.trim();
    if object_name.is_empty() || object_name.contains('<') || object_name.contains('>') {
        return None;
    }
    let parts = object_name
        .split('.')
        .map(sqlite_unquoted_identifier)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => Some(("main".into(), table.clone())),
        [schema, table, ..] => Some((schema.clone(), table.clone())),
        _ => None,
    }
}

fn sqlite_unquoted_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .into()
}

fn sqlite_quoted_identifier(value: &str) -> String {
    format!(
        "\"{}\"",
        sqlite_unquoted_identifier(value).replace('"', "\"\"")
    )
}

fn duckdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    if operation_id.ends_with("table.analyze") {
        return duckdb_admin_operation_request(
            "duckdb.table.analyze-preview",
            "analyze-table",
            "table",
            object_name,
            &format!("analyze {object_name};"),
            false,
            true,
        );
    }

    if operation_id.ends_with("database.analyze") {
        return duckdb_admin_operation_request(
            "duckdb.database.analyze-preview",
            "analyze-database",
            "database",
            "database",
            "analyze;",
            false,
            true,
        );
    }

    if operation_id.ends_with("database.checkpoint") {
        return duckdb_admin_operation_request(
            "duckdb.database.checkpoint-preview",
            "checkpoint",
            "database",
            "database",
            "checkpoint;",
            false,
            true,
        );
    }

    if operation_id.ends_with("object.create") {
        let statement = format!(
            "create table {object_name} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);"
        );
        return duckdb_admin_operation_request(
            "duckdb.object.create-preview",
            "create-object",
            "schema",
            object_name,
            &statement,
            true,
            true,
        );
    }

    if operation_id.ends_with("object.drop") {
        let statement = format!("drop table {object_name};");
        return duckdb_admin_operation_request(
            "duckdb.object.drop-preview",
            "drop-object",
            "schema",
            object_name,
            &statement,
            true,
            true,
        );
    }

    if operation_id.ends_with("extension.install") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return duckdb_extension_operation_request("install", &extension);
    }

    if operation_id.ends_with("extension.load") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return duckdb_extension_operation_request("load", &extension);
    }

    if operation_id.ends_with("file.import") {
        let table = string_parameter(parameters, "tableName").unwrap_or_else(|| object_name.into());
        let format = string_parameter(parameters, "sourceFormat")
            .or_else(|| string_parameter(parameters, "format"))
            .unwrap_or_else(|| "parquet".into());
        return duckdb_import_file_request(&table, &format);
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return duckdb_import_export_request(object_name, parameters);
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return duckdb_backup_restore_request(parameters);
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select table_schema, table_name, table_type from information_schema.tables order by table_schema, table_name;".into(),
        "execute" => format!("select * from {object_name} limit 100;"),
        "explain" => format!("explain select * from {object_name} limit 100;"),
        "profile" => format!("explain analyze select * from {object_name} limit 100;"),
        "create" => duckdb_admin_operation_request(
            "duckdb.object.create-preview",
            "create-object",
            "schema",
            object_name,
            &format!(
                "create table {object_name} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);"
            ),
            true,
            true,
        ),
        "drop" => duckdb_admin_operation_request(
            "duckdb.object.drop-preview",
            "drop-object",
            "schema",
            object_name,
            &format!("drop table {object_name};"),
            true,
            true,
        ),
        "inspect" => "select * from duckdb_extensions();\npragma database_list;\nselect name, value from duckdb_settings();".into(),
        "metrics" => "select version();\nselect name, value from duckdb_settings() where name in ('memory_limit', 'threads');".into(),
        _ => format!("-- DuckDB {operation_id}\n-- object: {object_name}"),
    }
}

fn duckdb_import_file_request(object_name: &str, format: &str) -> String {
    let reader = match format.to_ascii_lowercase().as_str() {
        "csv" => "read_csv_auto('<selected-file>.csv')",
        "json" | "jsonl" | "ndjson" => "read_json_auto('<selected-file>.json')",
        _ => "read_parquet('<selected-file>.parquet')",
    };

    format!("create or replace table {object_name} as\nselect * from {reader};")
}

fn duckdb_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "replace" | "create" | "validate" | "validate-only"
    );
    let format = if import_like {
        string_parameter(parameters, "sourceFormat")
            .or_else(|| string_parameter(parameters, "format"))
            .unwrap_or_else(|| "csv".into())
            .to_ascii_lowercase()
    } else {
        string_parameter(parameters, "format")
            .unwrap_or_else(|| "csv".into())
            .to_ascii_lowercase()
    };
    let (schema, table) = duckdb_plan_table_parts(object_name, parameters);
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "duckdb.table.import",
            "mode": mode,
            "schema": schema,
            "table": table,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| format!("<selected-file>.{}", duckdb_file_extension(&format)))
            },
            "rowLimit": row_limit,
            "databaseLockBoundary": duckdb_database_lock_boundary_contract(
                "duckdb.table.import",
                !matches!(mode.as_str(), "validate" | "validate-only")
            ),
            "formatPreflight": duckdb_format_preflight_contract(&format, "import"),
            "executionGate": {
                "owner": "duckdb-adapter",
                "defaultSupport": "live",
                "requiresConfirmation": true,
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "CSV/JSON/Parquet format allowlist",
                    "bounded row import",
                    "read-only connection blocked",
                    "database file access/read-only preflight",
                    "format capability preflight",
                    "JSON/Parquet extension catalog probe",
                    "replace/append mode review"
                ],
                "residualRisk": "extension installation, arbitrary DDL, restore execution, and broader local OLAP mutations remain preview-first"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "duckdb.table.export",
        "schema": schema,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{}", duckdb_file_extension(&format))),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "statement": format!(
            "copy (select * from {} limit {row_limit}) to '<selected-file>.{}' (format {});",
            duckdb_qualified_identifier(&schema, &table),
            duckdb_file_extension(&format),
            safe_duckdb_format_keyword(&format)
        ),
        "databaseLockBoundary": duckdb_database_lock_boundary_contract("duckdb.table.export", false),
        "formatPreflight": duckdb_format_preflight_contract(&format, "export"),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export",
                "database file read/open preflight",
                "format capability preflight",
                "JSON/Parquet extension catalog probe"
            ],
            "residualRisk": "remote filesystem, encrypted files, restore execution, and arbitrary extension management remain optional validation paths"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_backup_restore_request(parameters: Option<&BTreeMap<String, Value>>) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format")
        .unwrap_or_else(|| "csv".into())
        .to_ascii_lowercase();

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "duckdb.database.restore-preview",
            "mode": mode,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .or_else(|| string_parameter(parameters, "sourceFolder"))
                    .or_else(|| string_parameter(parameters, "inputFolder"))
                    .unwrap_or_else(|| "<selected-folder>".into())
            },
            "restorePreflight": duckdb_restore_preflight_contract(&format),
            "databaseLockBoundary": duckdb_database_lock_boundary_contract(
                "duckdb.database.restore-preview",
                true
            ),
            "restoreExecutionBoundary": duckdb_restore_execution_boundary_contract(&mode),
            "executionGate": {
                "owner": "duckdb-adapter",
                "defaultSupport": "plan-only",
                "requiresConfirmation": true,
                "guards": [
                    "absolute restore source folder",
                    "source folder readability preflight",
                    "schema.sql/load.sql package marker check",
                    "target database write/open preflight",
                    "target snapshot or rollback artifact required before live promotion",
                    "exclusive DuckDB writer lock evidence required before live promotion",
                    "restore execution explicitly scoped out of native claim",
                    "manual IMPORT DATABASE run outside the scoped claim"
                ],
                "residualRisk": "IMPORT DATABASE can replace local schemas; execution is explicitly scoped out until rollback/snapshot, exclusive writer-lock, post-restore validation, and confirmation semantics are native"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "duckdb.database.backup",
        "mode": mode,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .or_else(|| string_parameter(parameters, "targetFolder"))
                .or_else(|| string_parameter(parameters, "outputFolder"))
                .unwrap_or_else(|| "<selected-folder>".into())
        },
        "statement": format!("export database '<selected-folder>' (format {});", safe_duckdb_format_keyword(&format)),
        "databaseLockBoundary": duckdb_database_lock_boundary_contract("duckdb.database.backup", false),
        "formatPreflight": duckdb_format_preflight_contract(&format, "backup"),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "desktop adapter execution only",
                "absolute backup folder",
                "empty target folder",
                "parquet/csv backup format allowlist",
                "database file read/open preflight",
                "format capability preflight"
            ],
            "residualRisk": "IMPORT DATABASE restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    if let Some(table) = string_parameter(parameters, "targetTable")
        .or_else(|| string_parameter(parameters, "tableName"))
        .or_else(|| string_parameter(parameters, "table"))
    {
        let explicit_schema = string_parameter(parameters, "schema");
        let parts = table
            .split('.')
            .map(clean_duckdb_identifier)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        return match parts.as_slice() {
            [table] => (
                explicit_schema.unwrap_or_else(|| "main".into()),
                table.clone(),
            ),
            [schema, table, ..] => (
                explicit_schema.unwrap_or_else(|| schema.clone()),
                table.clone(),
            ),
            _ => (
                explicit_schema.unwrap_or_else(|| "main".into()),
                "<table>".into(),
            ),
        };
    }

    let parts = object_name
        .split('.')
        .map(clean_duckdb_identifier)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => ("main".into(), table.clone()),
        [schema, table, ..] => (schema.clone(), table.clone()),
        _ => ("main".into(), "<table>".into()),
    }
}

fn clean_duckdb_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .to_string()
}

fn duckdb_qualified_identifier(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        duckdb_quoted_identifier(schema),
        duckdb_quoted_identifier(table)
    )
}

fn duckdb_quoted_identifier(value: &str) -> String {
    format!(
        "\"{}\"",
        clean_duckdb_identifier(value).replace('"', "\"\"")
    )
}

fn duckdb_file_extension(format: &str) -> &'static str {
    match format {
        "csv" => "csv",
        "json" | "jsonl" | "ndjson" => "json",
        _ => "parquet",
    }
}

fn duckdb_format_preflight_contract(format: &str, workflow: &str) -> Value {
    let required_extension = match format {
        "json" | "jsonl" | "ndjson" => Some("json"),
        "parquet" => Some("parquet"),
        _ => None,
    };

    serde_json::json!({
        "format": format,
        "workflow": workflow,
        "extensionBacked": required_extension.is_some(),
        "requiredExtension": required_extension,
        "extensionExecutionBoundary": duckdb_format_extension_execution_boundary(
            format,
            workflow,
            required_extension
        ),
        "checks": if required_extension.is_some() {
            vec!["duckdb_extensions catalog probe", "operation-level read/write validation"]
        } else {
            vec!["bundled DuckDB CSV reader/writer"]
        }
    })
}

fn duckdb_format_extension_execution_boundary(
    format: &str,
    workflow: &str,
    required_extension: Option<&str>,
) -> Value {
    let Some(required_extension) = required_extension else {
        return serde_json::json!({
            "executionPolicy": "bundled-native",
            "nativeClaim": "bundled-csv-reader-writer",
            "format": format,
            "workflow": workflow,
            "extensionBacked": false,
            "operationValidated": "desktop-runtime-required",
            "networkAutoloadAllowed": false,
            "extensionInstallExecutionIncluded": false,
            "blockedReasons": Vec::<String>::new()
        });
    };

    serde_json::json!({
        "executionPolicy": "preloaded-extension-required",
        "nativeClaim": "preloaded-extension-only",
        "format": format,
        "workflow": workflow,
        "extensionBacked": true,
        "requiredExtension": required_extension,
        "installedValidated": "desktop-runtime-required",
        "loadedValidated": "desktop-runtime-required",
        "operationValidated": "desktop-runtime-required",
        "networkAutoloadAllowed": false,
        "extensionInstallExecutionIncluded": false,
        "manualInstallLoadOutsideScopedClaim": true,
        "promotionRequires": [
            "preloaded DuckDB extension evidence",
            "offline extension source provenance",
            "controlled extension_directory evidence",
            "extension-backed operation fixture",
            "no network autoload or install during file workflow"
        ],
        "blockedReasons": [
            "extension-backed-format-requires-runtime-preflight",
            "extension-install-load-scoped-out"
        ]
    })
}

fn duckdb_database_lock_boundary_contract(workflow: &str, requires_write_access: bool) -> Value {
    let mut checks = vec![
        "parent folder exists",
        "database file exists",
        "filesystem read-open probe",
    ];
    if requires_write_access {
        checks.push("filesystem write-open probe");
    }
    checks.extend(["DuckDB adapter open probe", "read-only disk guard"]);

    serde_json::json!({
        "policy": "desktop-preflight-required",
        "workflow": workflow,
        "scope": "local-duckdb-file",
        "requiresWriteAccess": requires_write_access,
        "checks": checks,
        "crossProcessContentionValidated": "desktop-fixture-required",
        "exclusiveWriterLockValidated": false,
        "promotionRequires": [
            "external-process contention fixture",
            "exclusive DuckDB writer lock acquisition evidence",
            "operation-scoped transaction or rollback artifact",
            "post-operation catalog validation",
            "read-only connection promotion block"
        ],
        "scopedResiduals": [
            "external process contention is not part of the default fixture claim",
            "exclusive writer-lock evidence is required before admin or restore execution promotion"
        ]
    })
}

fn duckdb_restore_preflight_contract(format: &str) -> Value {
    serde_json::json!({
        "format": format,
        "sourcePackageValidated": "desktop-preflight-required",
        "operationValidated": false,
        "checks": [
            "absolute source folder",
            "folder readable",
            "schema.sql marker",
            "load.sql marker",
            "backup file count and byte summary",
            "target database write/open preflight"
        ],
        "expectedFormats": ["csv", "parquet"]
    })
}

fn duckdb_restore_execution_boundary_contract(mode: &str) -> Value {
    serde_json::json!({
        "executionPolicy": "scoped-out",
        "mode": mode,
        "nativeClaim": "restore-preflight-only",
        "destructive": true,
        "targetMayReplaceCatalog": true,
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "sourcePackageValidated": "desktop-preflight-required",
        "targetWriteOpenValidated": "desktop-preflight-required",
        "previewValidated": "desktop-preflight-required",
        "promotionRequires": [
            "exclusive DuckDB writer lock evidence",
            "target snapshot or rollback artifact before IMPORT DATABASE",
            "post-restore catalog diff and validation",
            "explicit destructive restore confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": ["restore-execution-scoped-out"]
    })
}

fn duckdb_extension_operation_request(operation: &str, extension: &str) -> String {
    let extension = safe_duckdb_extension_name(extension);
    let workflow = format!("duckdb.extension.{operation}-preview");
    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": workflow,
        "operation": operation,
        "extensionName": extension,
        "statement": format!("{operation} {extension};"),
        "extensionPreflight": {
            "extensionName": extension,
            "catalogProbe": "duckdb_extensions()",
            "installedState": "desktop-preflight-required",
            "loadedState": "desktop-preflight-required",
            "extensionDirectory": "controlled by connection tempDirectory or database parent",
            "networkAccess": if operation == "install" { "blocked-by-default" } else { "not-required-when-already-installed" },
            "nativeCodeExecution": "blocked-until-explicit-live-gate"
        },
        "extensionExecutionBoundary": duckdb_extension_execution_boundary(operation, &extension),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "plan-only",
            "requiresConfirmation": true,
            "guards": [
                "sanitized extension name",
                "duckdb_extensions catalog probe",
                "controlled extension_directory",
                "no network auto-install in default workflows",
                "installed-before-load check",
                "native extension code execution review",
                "read-only connection blocked for executable promotion"
            ],
            "residualRisk": "DuckDB extensions can download or execute native code; install/load execution remains scoped out until offline source and native-code trust gates are live"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_admin_operation_request(
    workflow: &str,
    operation: &str,
    target_kind: &str,
    target_name: &str,
    statement: &str,
    data_or_catalog_mutation: bool,
    requires_write: bool,
) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": workflow,
        "operation": operation,
        "target": {
            "kind": target_kind,
            "name": target_name
        },
        "statement": statement,
        "adminScope": {
            "executionPolicy": "plan-only",
            "dataOrCatalogMutation": data_or_catalog_mutation,
            "requiresWriteAccess": requires_write,
            "rollbackRequiredBeforePromotion": data_or_catalog_mutation,
            "scopedClaim": "excluded-until-live-admin-guard"
        },
        "adminExecutionBoundary": duckdb_admin_execution_boundary(
            operation,
            target_kind,
            target_name,
            data_or_catalog_mutation,
            requires_write
        ),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "plan-only",
            "requiresConfirmation": true,
            "guards": [
                "database file write/open preflight",
                "cross-process lock probe",
                "object identity and diff preview",
                "rollback or backup boundary review",
                "read-only connection blocked for executable promotion",
                "confirmation required before live admin promotion"
            ],
            "residualRisk": "DuckDB admin and DDL execution can mutate local analytics files; execution remains scoped out until lock, rollback, and identity boundaries are live"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_admin_execution_boundary(
    operation: &str,
    target_kind: &str,
    target_name: &str,
    data_or_catalog_mutation: bool,
    requires_write: bool,
) -> Value {
    let mut blocked_reasons = vec!["duckdb-admin-execution-scoped-out"];
    if data_or_catalog_mutation {
        blocked_reasons.push("data-or-catalog-mutation-scoped-out");
    }
    if requires_write {
        blocked_reasons.push("requires-write-access");
    }

    serde_json::json!({
        "executionPolicy": "scoped-out",
        "nativeClaim": "admin-preview-only",
        "operation": operation,
        "target": {
            "kind": target_kind,
            "name": target_name
        },
        "dataOrCatalogMutation": data_or_catalog_mutation,
        "requiresWriteAccess": requires_write,
        "localDatabaseMayChange": requires_write,
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "previewValidated": "contract-only",
        "promotionRequires": [
            "exclusive DuckDB writer lock evidence",
            "target snapshot or rollback artifact before data/catalog mutation",
            "object identity and before/after diff preview",
            "post-operation catalog or statistics validation",
            "explicit admin confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": blocked_reasons
    })
}

fn duckdb_extension_execution_boundary(operation: &str, extension: &str) -> Value {
    serde_json::json!({
        "executionPolicy": "scoped-out",
        "nativeClaim": "extension-preflight-only",
        "operation": operation,
        "extensionName": extension,
        "nativeCodeExecution": true,
        "networkAccess": if operation == "install" { "blocked-by-default" } else { "not-required-when-already-installed" },
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "previewValidated": "contract-only",
        "promotionRequires": [
            "offline extension source provenance",
            "controlled extension_directory evidence",
            "installed-state evidence before load",
            "native-code trust review",
            "explicit extension execution confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": [
            "duckdb-extension-execution-scoped-out",
            "native-code-trust-gate-missing",
            if operation == "install" {
                "network-install-scoped-out"
            } else {
                "installed-state-live-check-required"
            }
        ]
    })
}

fn safe_duckdb_format_keyword(format: &str) -> &'static str {
    match format {
        "csv" => "csv",
        "json" | "jsonl" | "ndjson" => "json",
        _ => "parquet",
    }
}

fn safe_duckdb_extension_name(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || item == '_' {
                item.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(80)
        .collect::<String>();

    if cleaned.is_empty() {
        "parquet".into()
    } else {
        cleaned
    }
}

fn mysql_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> Option<String> {
    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return Some(mysql_import_export_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return Some(mysql_backup_restore_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if mysql_table_maintenance_operation(operation_id).is_some() {
        return Some(mysql_table_maintenance_request(
            manifest,
            operation_id,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("routine.execute") {
        return Some(mysql_routine_execute_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("event.enable") || operation_id.ends_with("event.disable") {
        return Some(mysql_event_state_request(
            manifest,
            operation_id,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("user.lock") || operation_id.ends_with("user.unlock") {
        return Some(mysql_user_account_request(
            manifest,
            operation_id,
            parameters,
        ));
    }

    if operation_id.ends_with("security.inspect") {
        return Some(mysql_security_inspect_request(manifest, parameters));
    }

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some(mysql_diagnostics_metrics_request());
    }

    if operation_id.ends_with("query.profile") {
        if manifest.engine == "mariadb" {
            return Some(format!(
                "analyze format=json select * from {object_name} limit 100;"
            ));
        }
        return Some(format!(
            "explain analyze select * from {object_name} limit 100;"
        ));
    }

    None
}

fn mysql_table_maintenance_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let operation = mysql_table_maintenance_operation(operation_id).unwrap_or("check");
    let (database, table) = mysql_plan_table_parts(object_name, parameters);
    let statement = format!("{operation} table {object_name};");
    let mut guards = vec![
        "verify target table exists and belongs to the selected database",
        "inspect storage engine support before running",
        "review lock and replication impact",
        "block execution on read-only connections",
    ];
    if operation == "repair" {
        guards.push("require owner/admin confirmation and a recent backup before repair");
    } else {
        guards.push("require explicit confirmation before costly maintenance");
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.table.maintenance", manifest.engine),
        "operation": operation,
        "database": database,
        "table": table,
        "statement": statement,
        "lockImpact": mysql_maintenance_lock_impact(operation),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": format!(
                "{} TABLE remains preview-first until the desktop adapter verifies table engine support, privileges, lock impact, and rollback boundaries.",
                operation.to_ascii_uppercase()
            ),
            "requiredPrivileges": mysql_maintenance_privileges(operation),
            "guards": guards,
            "residualRisk": "MyISAM and InnoDB differ in CHECK/REPAIR/OPTIMIZE behavior; live execution stays out of scope until fixture-backed."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_routine_execute_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (database, routine) = mysql_routine_parts(object_name, parameters);
    let routine_kind = string_parameter(parameters, "routineKind")
        .unwrap_or_else(|| "procedure".into())
        .to_ascii_lowercase();
    let routine_kind = if routine_kind.contains("function") {
        "function"
    } else {
        "procedure"
    };
    let arguments = string_parameter(parameters, "arguments")
        .or_else(|| string_parameter(parameters, "routineArguments"))
        .unwrap_or_default();
    let routine_arguments = mysql_routine_arguments(&arguments);
    let placeholders = routine_arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| {
            if argument.name.is_empty() {
                format!("? /* arg{} */", index + 1)
            } else {
                format!("{} => ?", argument.name)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let statement = if routine_kind == "function" {
        format!("select {object_name}({placeholders});")
    } else {
        format!("call {object_name}({placeholders});")
    };
    let bindings = routine_arguments
        .iter()
        .map(|argument| {
            serde_json::json!({
                "position": argument.position,
                "direction": argument.direction,
                "name": argument.name,
                "type": argument.type_name,
                "placeholder": "?"
            })
        })
        .collect::<Vec<_>>();

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.routine.execute", manifest.engine),
        "database": database,
        "routine": routine,
        "routineKind": routine_kind,
        "statement": statement,
        "bindings": bindings,
        "returns": string_parameter(parameters, "returns"),
        "language": string_parameter(parameters, "language").unwrap_or_else(|| "SQL".into()),
        "securityMode": string_parameter(parameters, "security").unwrap_or_else(|| "review definer/invoker metadata".into()),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL routine execution remains preview-first until parameter binding, OUT/INOUT capture, SQL SECURITY mode, and EXECUTE privilege checks are live-validated.",
            "requiredPrivileges": [
                "EXECUTE privilege on the routine",
                "read/write privileges required by the routine body"
            ],
            "guards": [
                "bind every IN parameter explicitly",
                "review OUT and INOUT parameters before running",
                "review SQL SECURITY DEFINER versus INVOKER semantics",
                "block mutating routines on read-only connections",
                "show the generated CALL/SELECT statement before execution"
            ],
            "residualRisk": "Stored routines can perform writes, dynamic SQL, or privileged work through definers; this preview does not claim live side-effect containment."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_event_state_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let action = if operation_id.ends_with("event.enable") {
        "enable"
    } else {
        "disable"
    };
    let (database, event_name) = mysql_event_parts(object_name, parameters);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.event.toggle", manifest.engine),
        "operation": action,
        "database": database,
        "event": event_name,
        "statement": format!("alter event {object_name} {action};"),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL event state changes remain preview-first until EVENT privilege, event scheduler state, definer, and schedule metadata are verified live.",
            "requiredPrivileges": [
                "EVENT privilege on the schema",
                "ALTER privilege for the selected event where required"
            ],
            "guards": [
                "verify event exists in the selected schema",
                "review event_scheduler global state",
                "review definer account and SQL SECURITY behavior",
                "review schedule, starts/ends, and time zone before toggling",
                "block execution on read-only connections"
            ],
            "residualRisk": "Toggling events can start background writes or stop maintenance jobs; live execution needs fixture-backed scheduler evidence."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_user_account_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let action = if operation_id.ends_with("user.lock") {
        "lock"
    } else {
        "unlock"
    };
    let user_name = string_parameter(parameters, "userName")
        .or_else(|| string_parameter(parameters, "roleName"))
        .unwrap_or_else(|| "<user>".into());
    let user_host = string_parameter(parameters, "userHost")
        .or_else(|| string_parameter(parameters, "host"))
        .unwrap_or_else(|| "%".into());
    let account = mysql_account_literal(&user_name, &user_host);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.user.account-state", manifest.engine),
        "operation": action,
        "user": user_name,
        "host": user_host,
        "statement": format!("alter user {account} account {action};"),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL account lock/unlock remains preview-first until CREATE USER/ACCOUNT MANAGEMENT privilege checks and active-session impact are live-validated.",
            "requiredPrivileges": [
                "CREATE USER or SYSTEM_USER-compatible account management privilege"
            ],
            "guards": [
                "verify user@host identity before generating ALTER USER",
                "review current account_locked and password_expired state",
                "warn about active sessions and application connection pools",
                "block execution on read-only connections",
                "require explicit confirmation before changing account state"
            ],
            "residualRisk": "Host wildcards and role-like accounts can affect more clients than expected; live execution needs principal selection UI."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_security_inspect_request(
    manifest: &AdapterManifest,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "schema"))
        .unwrap_or_else(|| "<database>".into());
    let database_literal = mysql_string_literal(&database);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.security.inspect", manifest.engine),
        "database": database,
        "statements": [
            "show grants;",
            "select current_user() as currentUser, user() as sessionUser;",
            "select user, host, plugin, account_locked, password_expired from mysql.user order by user, host;",
            "select grantee, privilege_type, is_grantable from information_schema.user_privileges order by grantee, privilege_type;",
            format!("select grantee, table_schema, privilege_type, is_grantable from information_schema.schema_privileges where table_schema = {database_literal} order by grantee, privilege_type;"),
            format!("select grantee, table_schema, table_name, privilege_type, is_grantable from information_schema.table_privileges where table_schema = {database_literal} order by table_name, grantee, privilege_type;")
        ],
        "executionGate": {
            "defaultSupport": "live",
            "requiredPrivileges": [
                "SHOW GRANTS visibility",
                "mysql.user or INFORMATION_SCHEMA privilege visibility"
            ],
            "guards": [
                "redact principal names from exported diagnostics where configured",
                "tolerate hidden mysql.* tables when the login lacks catalog privileges",
                "separate global, schema, table, and routine grants",
                "never infer write privilege from missing grant rows"
            ],
            "residualRisk": "Managed MySQL services can hide mysql.user or role_edges; unavailable surfaces must render disabled reasons instead of empty success."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_import_export_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let (database, table) = mysql_plan_table_parts(object_name, parameters);
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    );
    let default_support = if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
        "live"
    } else {
        "plan-only"
    };
    let workflow_prefix = manifest.engine.as_str();
    let bulk_export_tools = if manifest.engine == "mariadb" {
        "mariadb-dump/mysql"
    } else {
        "mysqlpump/mysqldump"
    };

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": format!("{workflow_prefix}.table.import"),
            "database": database,
            "schema": database,
            "table": table,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| format!("<selected-file>.{format}"))
            },
            "mode": mode,
            "rowLimit": row_limit,
            "emptyStringAsNull": bool_parameter(parameters, "emptyStringAsNull").unwrap_or(false),
            "executionGate": {
                "defaultSupport": default_support,
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "existing target table",
                    "insertable target-column validation",
                    "bounded row import",
                    "read-only connection blocked",
                    "explicit confirmation required before append"
                ],
                "residualRisk": "LOAD DATA INFILE, generated column mapping, and full dump import workflows remain manual preview paths"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{workflow_prefix}.table.export"),
        "database": database,
        "schema": database,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "serialization": "SELECT rows through the desktop adapter, then local CSV/JSON/NDJSON writer",
        "executionGate": {
            "defaultSupport": default_support,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export"
            ],
            "residualRisk": format!("server-side INTO OUTFILE and {bulk_export_tools} bulk workflows remain manual preview paths")
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_backup_restore_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "schema"))
        .or_else(|| mysql_plan_database_name(object_name))
        .unwrap_or_else(|| "database".into());
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
    let default_support = if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
        "live"
    } else {
        "plan-only"
    };
    let workflow_prefix = manifest.engine.as_str();
    let restore_tools = if manifest.engine == "mariadb" {
        "mariadb-dump/mysql"
    } else {
        "mysqldump/mysql"
    };

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": format!("{workflow_prefix}.database.restore"),
            "database": database,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| "<selected-file>.json".into())
            },
            "mode": mode,
            "executionGate": {
                "defaultSupport": "plan-only",
                "guards": [
                    "restore execution remains preview-first",
                    "validate package before manual restore",
                    "review schema DDL, triggers, routines, events, privileges, generated columns, and target database state"
                ],
                "residualRisk": format!("full {restore_tools} restore and generated insert replay remain manual reviewed workflows")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{workflow_prefix}.database.backup"),
        "database": database,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "schema": string_parameter(parameters, "schema"),
        "format": format,
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(1_000),
        "tableLimit": numeric_parameter(parameters, "tableLimit").unwrap_or(25),
        "executionGate": {
            "defaultSupport": default_support,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded table list",
                "bounded rows per table",
                "logical package restore validation"
            ],
            "residualRisk": format!("bounded logical DataPad++ backup package; full {restore_tools} restore execution remains preview-first")
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

struct MysqlRoutineArgument {
    position: usize,
    direction: String,
    name: String,
    type_name: String,
}

fn mysql_table_maintenance_operation(operation_id: &str) -> Option<&'static str> {
    if operation_id.ends_with("table.analyze") {
        return Some("analyze");
    }
    if operation_id.ends_with("table.optimize") {
        return Some("optimize");
    }
    if operation_id.ends_with("table.check") {
        return Some("check");
    }
    if operation_id.ends_with("table.repair") {
        return Some("repair");
    }
    None
}

fn mysql_maintenance_lock_impact(operation: &str) -> &'static str {
    match operation {
        "check" => "metadata and engine-dependent read locks",
        "analyze" => "statistics refresh can sample or scan index pages",
        "optimize" => "may rebuild or copy table data depending on engine",
        _ => "engine-dependent repair can rebuild indexes or modify table files",
    }
}

fn mysql_maintenance_privileges(operation: &str) -> Vec<&'static str> {
    match operation {
        "check" => vec!["SELECT privilege on the target table"],
        "analyze" => vec![
            "INSERT or UPDATE privilege on the target table in MySQL 8.0.31+, or table ownership/admin equivalent",
        ],
        "optimize" => vec![
            "INSERT and SELECT privilege on the target table, or table ownership/admin equivalent",
        ],
        _ => vec!["REPAIR privilege on the target table, or table ownership/admin equivalent"],
    }
}

fn mysql_routine_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_routine = string_parameter(parameters, "routineName")
        .or_else(|| string_parameter(parameters, "routine"));
    if let Some(routine) = explicit_routine {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            routine,
        );
    }
    mysql_plan_table_parts(object_name, parameters)
}

fn mysql_event_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_event =
        string_parameter(parameters, "eventName").or_else(|| string_parameter(parameters, "event"));
    if let Some(event) = explicit_event {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            event,
        );
    }
    mysql_plan_table_parts(object_name, parameters)
}

fn mysql_routine_arguments(arguments: &str) -> Vec<MysqlRoutineArgument> {
    split_mysql_routine_arguments(arguments)
        .into_iter()
        .enumerate()
        .map(|(index, argument)| {
            let mut parts = argument
                .split_whitespace()
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            let direction = if parts.first().is_some_and(|part| {
                matches!(part.to_ascii_lowercase().as_str(), "in" | "out" | "inout")
            }) {
                parts.remove(0).to_ascii_uppercase()
            } else {
                "IN".into()
            };
            let name = parts
                .first()
                .map(|part| {
                    clean_mysql_identifier(part)
                        .trim_start_matches('@')
                        .to_string()
                })
                .filter(|part| !part.is_empty())
                .unwrap_or_else(|| format!("arg{}", index + 1));
            if !parts.is_empty() {
                parts.remove(0);
            }
            let type_name = if parts.is_empty() {
                "unknown".into()
            } else {
                parts.join(" ")
            };
            MysqlRoutineArgument {
                position: index + 1,
                direction,
                name,
                type_name,
            }
        })
        .collect()
}

fn split_mysql_routine_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for item in arguments.chars() {
        match item {
            '(' => {
                depth += 1;
                current.push(item);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(item);
            }
            ',' if depth == 0 => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => current.push(item),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn mysql_account_literal(user: &str, host: &str) -> String {
    format!(
        "'{}'@'{}'",
        user.replace('\'', "''"),
        host.replace('\'', "''")
    )
}

fn mysql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn mysql_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_table =
        string_parameter(parameters, "table").or_else(|| string_parameter(parameters, "tableName"));
    if let Some(table) = explicit_table {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            table,
        );
    }

    let parts = split_mysql_name(object_name)
        .into_iter()
        .map(|part| clean_mysql_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => (
            explicit_database.unwrap_or_else(|| "database".into()),
            table.clone(),
        ),
        [database, table, ..] => (
            explicit_database.unwrap_or_else(|| database.clone()),
            table.clone(),
        ),
        _ => (
            explicit_database.unwrap_or_else(|| "database".into()),
            "<table>".into(),
        ),
    }
}

fn mysql_plan_database_name(object_name: &str) -> Option<String> {
    let parts = split_mysql_name(object_name)
        .into_iter()
        .map(|part| clean_mysql_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    (parts.len() == 1).then(|| parts[0].clone())
}

fn split_mysql_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut quote = None::<char>;
    let mut bracket_depth = 0u8;

    while let Some(ch) = chars.next() {
        match ch {
            '`' if quote == Some('`') && chars.peek() == Some(&'`') => {
                current.push('`');
                chars.next();
            }
            '"' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '`' | '"' if bracket_depth == 0 => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                }
                current.push(ch);
            }
            '.' if bracket_depth == 0 && quote.is_none() => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn clean_mysql_identifier(value: &str) -> String {
    let trimmed = value.trim();
    let unwrapped = trimmed
        .strip_prefix('`')
        .and_then(|item| item.strip_suffix('`'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('[')
                .and_then(|item| item.strip_suffix(']'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("``", "`")
        .replace("\"\"", "\"")
        .replace("]]", "]")
}

fn mysql_diagnostics_metrics_request() -> String {
    [
        "show global status;",
        "select id, user, db, command, state, time from information_schema.processlist order by time desc limit 100;",
        "select digest_text, count_star, sum_timer_wait, avg_timer_wait, max_timer_wait, sum_rows_examined, sum_rows_sent from performance_schema.events_statements_summary_by_digest order by sum_timer_wait desc limit 50;",
        "select object_schema, object_name, index_name, count_star, count_read, count_write, sum_timer_wait from performance_schema.table_io_waits_summary_by_index_usage order by sum_timer_wait desc limit 100;",
        "select object_schema, object_name, object_type, lock_type, lock_duration, lock_status, owner_thread_id from performance_schema.metadata_locks order by lock_status, object_schema, object_name limit 100;",
        "select @@optimizer_trace, @@optimizer_trace_limit, @@optimizer_trace_max_mem_size;",
        "select query, trace, missing_bytes_beyond_max_mem_size, insufficient_privileges from information_schema.optimizer_trace limit 5;",
    ]
    .join("\n")
}

fn postgres_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> Option<String> {
    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return Some(postgres_import_export_request(object_name, parameters));
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return Some(postgres_backup_restore_request(object_name, parameters));
    }

    if operation_id.ends_with("query.profile") {
        let statement = string_parameter(parameters, "query")
            .or_else(|| string_parameter(parameters, "sql"))
            .unwrap_or_else(|| format!("select * from {object_name} limit 100"));
        let analyze = bool_parameter(parameters, "analyze").unwrap_or(true);
        let buffers = bool_parameter(parameters, "buffers").unwrap_or(true);
        let wal = bool_parameter(parameters, "wal").unwrap_or(false);
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        let mut options = vec![if analyze {
            "analyze true"
        } else {
            "analyze false"
        }
        .to_string()];
        if buffers {
            options.push("buffers true".into());
        }
        if wal {
            options.push("wal true".into());
        }
        options.push("verbose true".into());
        options.push(format!("format {}", format.to_ascii_lowercase()));
        return Some(format!(
            "-- PostgreSQL query profile executes the statement; review row limits and production load first.\nexplain ({})\n{};",
            options.join(", "),
            statement.trim().trim_end_matches(';')
        ));
    }

    if operation_id.ends_with("routine.execute") {
        return Some(postgres_routine_execute_request(object_name, parameters));
    }

    if operation_id.ends_with("session.cancel") || operation_id.ends_with("session.terminate") {
        return Some(postgres_session_action_request(operation_id, parameters));
    }

    if operation_id.ends_with("table.analyze") {
        return Some(format!("analyze verbose {object_name};"));
    }

    if operation_id.ends_with("table.vacuum") {
        return Some(format!("vacuum (verbose, analyze) {object_name};"));
    }

    if operation_id.ends_with("database.analyze") {
        return Some("analyze verbose;".into());
    }

    if operation_id.ends_with("database.vacuum") {
        return Some("vacuum (verbose, analyze);".into());
    }

    if operation_id.ends_with("index.reindex") {
        return Some(format!(
            "-- REINDEX may take stronger locks; review before running.\nreindex index concurrently {object_name};"
        ));
    }

    if operation_id.ends_with("security.inspect") {
        return Some([
            "select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls from pg_roles order by rolname;",
            "select member.rolname as role, parent.rolname as member_of, m.admin_option from pg_auth_members m join pg_roles member on member.oid = m.member join pg_roles parent on parent.oid = m.roleid order by role, member_of;",
            "select grantee, privilege_type, table_schema, table_name, is_grantable from information_schema.role_table_grants order by table_schema, table_name, grantee;",
            "select * from pg_default_acl order by defaclnamespace, defaclrole;",
        ].join("\n"));
    }

    if operation_id.ends_with("role.grant") {
        let role_name =
            string_parameter(parameters, "memberOf").unwrap_or_else(|| "<member_role>".into());
        let member = string_parameter(parameters, "roleName").unwrap_or_else(|| "<role>".into());
        return Some(format!(
            "-- Review role inheritance and admin option before running.\ngrant {} to {};",
            quote_postgres_identifier(&role_name),
            quote_postgres_identifier(&member)
        ));
    }

    if operation_id.ends_with("role.revoke") {
        let role_name =
            string_parameter(parameters, "memberOf").unwrap_or_else(|| "<member_role>".into());
        let member = string_parameter(parameters, "roleName").unwrap_or_else(|| "<role>".into());
        return Some(format!(
            "-- Review dependent privileges before revoking membership.\nrevoke {} from {};",
            quote_postgres_identifier(&role_name),
            quote_postgres_identifier(&member)
        ));
    }

    if operation_id.ends_with("extension.update") {
        let extension = postgres_extension_name(parameters, object_name);
        return Some(format!(
            "-- Review extension release notes, dependency objects, and required privileges before running.\nalter extension {} update;",
            quote_postgres_identifier(&extension)
        ));
    }

    if operation_id.ends_with("extension.drop") {
        let extension = postgres_extension_name(parameters, object_name);
        return Some(format!(
            "-- Dropping extensions can drop dependent functions, types, operators, or views.\ndrop extension {};",
            quote_postgres_identifier(&extension)
        ));
    }

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some(
            "select * from pg_stat_activity order by query_start desc nulls last limit 100;\nselect * from pg_stat_database where datname = current_database();"
                .into(),
        );
    }

    None
}

fn postgres_extension_name(
    parameters: Option<&BTreeMap<String, Value>>,
    object_name: &str,
) -> String {
    let value = string_parameter(parameters, "extensionName").unwrap_or_else(|| object_name.into());
    let candidate = value
        .split('.')
        .next_back()
        .unwrap_or(value.as_str())
        .trim()
        .trim_matches(|character| matches!(character, '"' | '`' | '[' | ']'));
    let cleaned = candidate
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if cleaned.is_empty() {
        "<extension>".into()
    } else {
        cleaned
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PostgresRoutineArgument {
    name: String,
    data_type: String,
    named: bool,
}

fn postgres_routine_execute_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (fallback_schema, fallback_routine) = postgres_plan_table_parts(object_name, parameters);
    let routine_name = string_parameter(parameters, "routineName")
        .or_else(|| string_parameter(parameters, "functionName"))
        .or_else(|| string_parameter(parameters, "procedureName"))
        .or_else(|| {
            string_parameter(parameters, "objectName").and_then(|value| {
                value
                    .split('.')
                    .next_back()
                    .map(clean_postgres_identifier)
                    .filter(|value| !value.is_empty())
            })
        })
        .unwrap_or(fallback_routine);
    let schema = string_parameter(parameters, "schema").unwrap_or(fallback_schema);
    let routine_kind = string_parameter(parameters, "routineKind")
        .or_else(|| string_parameter(parameters, "objectKind"))
        .unwrap_or_else(|| "function".into())
        .to_ascii_lowercase();
    let arguments = string_parameter(parameters, "arguments")
        .or_else(|| string_parameter(parameters, "routineArguments"))
        .unwrap_or_default();
    let returns = string_parameter(parameters, "returns")
        .or_else(|| string_parameter(parameters, "returnType"));
    let routine_arguments = postgres_routine_arguments(&arguments);
    let target = format!(
        "{}.{}",
        quote_postgres_identifier(&schema),
        quote_postgres_identifier(&routine_name)
    );
    let call_arguments = postgres_routine_call_arguments(&routine_arguments);
    let statement = if routine_kind.contains("procedure") {
        format!("call {target}({call_arguments});")
    } else {
        format!("select {target}({call_arguments}) as result;")
    };
    let mut lines = vec![
        "-- PostgreSQL routine execution preview.".to_string(),
        "-- Bind parameter values explicitly and review volatility, permissions, defaults, and result cardinality before running.".to_string(),
    ];

    if !arguments.trim().is_empty() {
        lines.push(format!("-- Signature: {}", arguments.trim()));
    }
    if let Some(returns) = returns.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("-- Returns: {}", returns.trim()));
    }
    if routine_arguments.is_empty() {
        lines.push("-- Input parameters: none detected.".into());
    } else {
        lines.push("-- Bindings:".into());
        for (index, argument) in routine_arguments.iter().enumerate() {
            lines.push(format!(
                "-- ${} {} {} = <{}>",
                index + 1,
                argument.name,
                argument.data_type,
                argument.name
            ));
        }
    }
    lines.push(statement);
    lines.join("\n")
}

fn postgres_session_action_request(
    operation_id: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let terminate = operation_id.ends_with("session.terminate");
    let pid = postgres_backend_pid(parameters);
    let pid_token = pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<backend_pid>".into());
    let function_name = if terminate {
        "pg_terminate_backend"
    } else {
        "pg_cancel_backend"
    };
    let result_name = if terminate {
        "terminate_requested"
    } else {
        "cancel_requested"
    };
    let action = if terminate {
        "terminate backend"
    } else {
        "cancel query"
    };
    let statement = if let Some(pid) = pid {
        format!(
            "select case\n  when pg_backend_pid() = {pid} then false\n  else {function_name}({pid})\nend as {result_name};"
        )
    } else {
        format!(
            "-- Provide a concrete backend PID before execution.\nselect {function_name}(<backend_pid>) as {result_name};"
        )
    };
    let impact = if terminate {
        "-- Terminating a backend disconnects the client and rolls back its active transaction."
    } else {
        "-- Canceling asks PostgreSQL to interrupt the active query while keeping the connection alive."
    };

    [
        "-- PostgreSQL backend action preview.".to_string(),
        format!("-- Action: {action}."),
        "-- Requires pg_signal_backend, matching ownership, or superuser privileges.".into(),
        "-- Verify PID, user, database, application, state, and current query before running."
            .into(),
        impact.into(),
        format!(
            "-- Target: {}",
            postgres_session_target(parameters, &pid_token)
        ),
        statement,
    ]
    .join("\n")
}

fn postgres_backend_pid(parameters: Option<&BTreeMap<String, Value>>) -> Option<u64> {
    numeric_parameter(parameters, "pid")
        .or_else(|| numeric_parameter(parameters, "backendPid"))
        .or_else(|| numeric_parameter(parameters, "sessionPid"))
        .filter(|value| *value > 0)
}

fn postgres_session_target(
    parameters: Option<&BTreeMap<String, Value>>,
    pid_token: &str,
) -> String {
    let mut parts = vec![format!("pid {pid_token}")];
    if let Some(user) = string_parameter(parameters, "sessionUser") {
        parts.push(format!("user {user}"));
    }
    if let Some(database) = string_parameter(parameters, "sessionDatabase") {
        parts.push(format!("database {database}"));
    }
    if let Some(application) = string_parameter(parameters, "application") {
        parts.push(format!("application {application}"));
    }
    if let Some(state) = string_parameter(parameters, "sessionState") {
        parts.push(format!("state {state}"));
    }
    parts.join(", ")
}

fn postgres_routine_call_arguments(arguments: &[PostgresRoutineArgument]) -> String {
    if arguments.is_empty() {
        return String::new();
    }

    let placeholders = arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| {
            let placeholder = format!("${}", index + 1);
            if argument.named {
                format!(
                    "{} => {placeholder}",
                    postgres_argument_reference(&argument.name)
                )
            } else {
                placeholder
            }
        })
        .collect::<Vec<_>>();
    format!("\n  {}\n", placeholders.join(",\n  "))
}

fn postgres_routine_arguments(arguments: &str) -> Vec<PostgresRoutineArgument> {
    let mut parsed = Vec::new();

    for part in split_postgres_arguments(arguments) {
        let cleaned = strip_postgres_argument_default(&part);
        if cleaned.is_empty() {
            continue;
        }

        let tokens = cleaned.split_whitespace().collect::<Vec<_>>();
        if tokens.is_empty() {
            continue;
        }

        let mode = tokens[0].trim_matches('"').to_ascii_lowercase();
        let has_mode = matches!(mode.as_str(), "in" | "out" | "inout" | "variadic");
        if mode == "out" {
            continue;
        }

        let offset = if has_mode { 1 } else { 0 };
        let remainder = &tokens[offset..];
        if remainder.is_empty() {
            continue;
        }

        let has_named_argument =
            remainder.len() >= 2 && !postgres_type_starts_argument(remainder[0]);
        let name = if has_named_argument {
            clean_postgres_identifier(remainder[0])
        } else {
            format!("arg{}", parsed.len() + 1)
        };
        let data_type = if has_named_argument {
            remainder[1..].join(" ")
        } else {
            remainder.join(" ")
        };

        parsed.push(PostgresRoutineArgument {
            name: if name.is_empty() {
                format!("arg{}", parsed.len() + 1)
            } else {
                name
            },
            data_type: if data_type.is_empty() {
                "<unknown>".into()
            } else {
                data_type
            },
            named: has_named_argument,
        });
    }

    parsed
}

fn split_postgres_arguments(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut previous = '\0';

    for (index, character) in value.char_indices() {
        if character == '\'' && !in_double_quote && previous != '\\' {
            in_single_quote = !in_single_quote;
        } else if character == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote && character == '(' {
            depth += 1;
        } else if !in_single_quote && !in_double_quote && character == ')' && depth > 0 {
            depth -= 1;
        } else if !in_single_quote && !in_double_quote && depth == 0 && character == ',' {
            let part = value[start..index].trim();
            if !part.is_empty() {
                parts.push(part.into());
            }
            start = index + character.len_utf8();
        }
        previous = character;
    }

    let tail = value[start..].trim();
    if !tail.is_empty() {
        parts.push(tail.into());
    }
    parts
}

fn strip_postgres_argument_default(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let cut_index = [" default ", " = "]
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min();

    cut_index
        .map(|index| value[..index].trim().to_string())
        .unwrap_or_else(|| value.trim().to_string())
}

fn postgres_type_starts_argument(token: &str) -> bool {
    let normalized = clean_postgres_identifier(token).to_ascii_lowercase();
    normalized.ends_with("[]")
        || matches!(
            normalized.as_str(),
            "bigint"
                | "bigserial"
                | "bool"
                | "boolean"
                | "box"
                | "bytea"
                | "character"
                | "cidr"
                | "circle"
                | "date"
                | "decimal"
                | "double"
                | "inet"
                | "int"
                | "int2"
                | "int4"
                | "int8"
                | "integer"
                | "interval"
                | "json"
                | "jsonb"
                | "line"
                | "lseg"
                | "macaddr"
                | "money"
                | "numeric"
                | "path"
                | "point"
                | "polygon"
                | "real"
                | "serial"
                | "smallint"
                | "text"
                | "time"
                | "timestamp"
                | "tsquery"
                | "tsvector"
                | "uuid"
                | "varchar"
                | "xml"
        )
}

fn postgres_argument_reference(name: &str) -> String {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return quote_postgres_identifier(name);
    };
    if (first.is_ascii_lowercase() || first == '_')
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
    {
        name.into()
    } else {
        quote_postgres_identifier(name)
    }
}

fn postgres_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let (schema, table) = postgres_plan_table_parts(object_name, parameters);
    let workflow = if matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    ) {
        "postgresql.table.import"
    } else {
        "postgresql.table.export"
    };
    let path_key = if workflow.ends_with(".import") {
        "source"
    } else {
        "target"
    };
    let path_value = format!("<selected-file>.{format}");

    let mut request = serde_json::json!({
        "workflow": workflow,
        "mode": mode,
        "schema": schema,
        "table": table,
        "format": format,
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(10_000),
        "executionGate": {
            "owner": "postgresql-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "concrete absolute file path",
                "read-only connection check for import",
                "row limit",
                "type-aware target column validation"
            ]
        }
    });
    if let Some(object) = request.as_object_mut() {
        object.insert(
            path_key.into(),
            serde_json::json!({
                "path": path_value,
                "overwrite": false
            }),
        );
    }

    serde_json::to_string_pretty(&request).unwrap_or_else(|_| "{}".into())
}

fn postgres_backup_restore_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
    let schema = string_parameter(parameters, "schema")
        .unwrap_or_else(|| postgres_plan_table_parts(object_name, parameters).0);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": if mode == "restore" {
            "postgresql.database.restore-preview"
        } else {
            "postgresql.database.backup"
        },
        "mode": mode,
        "format": format,
        "schema": schema,
        "target": {
            "path": format!("<selected-file>.{format}"),
            "overwrite": false
        },
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(1_000),
        "tableLimit": numeric_parameter(parameters, "tableLimit").unwrap_or(25),
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "executionGate": {
            "owner": "postgresql-adapter",
            "defaultSupport": if mode == "restore" { "plan-only" } else { "live" },
            "requiresConfirmation": true,
            "residualRisk": "bounded logical DataPad++ backup package; full pg_dump/pg_restore restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn postgres_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let table = string_parameter(parameters, "table")
        .or_else(|| string_parameter(parameters, "tableName"))
        .unwrap_or_else(|| {
            object_name
                .split('.')
                .next_back()
                .map(clean_postgres_identifier)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "<table>".into())
        });
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| {
        object_name
            .split('.')
            .next()
            .map(clean_postgres_identifier)
            .filter(|value| !value.is_empty() && value != &table)
            .unwrap_or_else(|| "public".into())
    });

    (schema, table)
}

fn clean_postgres_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .replace("\"\"", "\"")
}

fn quote_postgres_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn sqlserver_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
    parameter_json: &str,
) -> String {
    if operation_id.ends_with("index.create") {
        return format!(
            "create index [IX_{}_id] on {object_name} ([id]);",
            safe_sqlserver_name(object_name)
        );
    }

    if operation_id.ends_with("index.drop") {
        let index_name = safe_sqlserver_index_name(parameters);
        let target = sqlserver_target_object(object_name, parameters);
        return format!("-- Review before running.\ndrop index {index_name} on {target};");
    }

    if operation_id.ends_with("statistics.update") {
        return format!(
            "update statistics {} with fullscan;",
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return sqlserver_import_export_request(object_name, parameters);
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return sqlserver_backup_restore_request(object_name, parameters);
    }

    if operation_id.ends_with("index.rebuild") {
        return format!(
            "alter index {} on {} rebuild with (online = on);",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.reorganize") {
        return format!(
            "alter index {} on {} reorganize;",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.disable") {
        return format!(
            "-- Review carefully before disabling an index.\nalter index {} on {} disable;",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.enable") {
        return format!(
            "alter index {} on {} rebuild with (online = on);",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("query-store.top-queries")
        || operation_id.ends_with("query-store")
        || operation_id.contains("query-store")
    {
        return "select top (50)\n  qsq.query_id,\n  qsp.plan_id,\n  rs.avg_duration,\n  rs.count_executions\nfrom sys.query_store_query qsq\njoin sys.query_store_plan qsp on qsq.query_id = qsp.query_id\njoin sys.query_store_runtime_stats rs on qsp.plan_id = rs.plan_id\norder by rs.avg_duration desc;".into();
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select name, state_desc from sys.databases order by name;".into(),
        "execute" => format!("select top 100 * from {object_name};"),
        "explain" => format!("set showplan_text on;\nselect top 100 * from {object_name};\nset showplan_text off;"),
        "profile" => format!("-- SQL Server XML Showplan does not execute the statement, but it reveals estimated optimizer shape.\nset showplan_xml on;\nselect top 100 * from {object_name};\nset showplan_xml off;"),
        "create" => format!("create table {object_name} (\n  [id] int identity(1, 1) not null primary key,\n  [created_at] datetime2 not null default sysutcdatetime()\n);"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
        "inspect" => "select * from sys.database_permissions;\nselect * from sys.database_principals;".into(),
        "metrics" => "select top 50 * from sys.dm_exec_query_stats order by total_elapsed_time desc;\nselect * from sys.dm_exec_requests;\nselect * from sys.dm_os_wait_stats;\nselect * from sys.dm_io_virtual_file_stats(db_id(), null);\nselect * from sys.dm_exec_query_memory_grants;".into(),
        _ => format!("-- SQL Server {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn sqlserver_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (schema, table) = sqlserver_workflow_table_parts(object_name, parameters);
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    );

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlserver.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| format!("<selected-file>.{format}"))
            },
            "mode": mode,
            "rowLimit": row_limit,
            "emptyStringAsNull": bool_parameter(parameters, "emptyStringAsNull").unwrap_or(false),
            "executionGate": {
                "defaultSupport": "live",
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "existing target table",
                    "insertable target-column validation",
                    "bounded row import",
                    "read-only connection blocked",
                    "explicit confirmation required before append"
                ],
                "residualRisk": "bulk load and identity-insert workflows remain manual preview paths"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "sqlserver.table.export",
        "schema": schema,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "serialization": "FOR JSON PATH, INCLUDE_NULL_VALUES, then local CSV/JSON/NDJSON writer",
        "executionGate": {
            "defaultSupport": "live",
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export"
            ],
            "residualRisk": "server-side bcp/sqlcmd bulk workflows remain manual preview paths"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn sqlserver_backup_restore_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let database = string_parameter(parameters, "database")
        .or_else(|| sqlserver_workflow_database_name(object_name))
        .unwrap_or_else(|| "database".into());
    let row_limit = numeric_parameter(parameters, "rowLimit").unwrap_or(1_000);
    let table_limit = numeric_parameter(parameters, "tableLimit").unwrap_or(25);

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlserver.database.restore",
            "database": database,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| "<selected-file>.json".into())
            },
            "mode": mode,
            "executionGate": {
                "defaultSupport": "plan-only",
                "guards": [
                    "restore execution remains preview-first",
                    "validate package before manual restore",
                    "review schema DDL, identity columns, triggers, constraints, and target database state"
                ],
                "residualRisk": "native .bak restore and generated insert replay remain manual reviewed workflows"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "sqlserver.database.backup",
        "database": database,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| "<selected-file>.json".into()),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "schema": string_parameter(parameters, "schema"),
        "format": string_parameter(parameters, "format").unwrap_or_else(|| "json".into()),
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "rowLimit": row_limit,
        "tableLimit": table_limit,
        "executionGate": {
            "defaultSupport": "live",
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded table list",
                "bounded rows per table"
            ],
            "residualRisk": "bounded logical DataPad++ backup package; native .bak backup/restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn sqlserver_workflow_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_schema = string_parameter(parameters, "schema");
    let explicit_table =
        string_parameter(parameters, "table").or_else(|| string_parameter(parameters, "tableName"));
    if let Some(table) = explicit_table {
        return (explicit_schema.unwrap_or_else(|| "dbo".into()), table);
    }

    let parts = split_sqlserver_name(object_name)
        .into_iter()
        .map(|part| clean_sqlserver_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => (
            explicit_schema.unwrap_or_else(|| "dbo".into()),
            table.clone(),
        ),
        [schema, table, ..] => (
            explicit_schema.unwrap_or_else(|| schema.clone()),
            table.clone(),
        ),
        _ => (
            explicit_schema.unwrap_or_else(|| "dbo".into()),
            "<table>".into(),
        ),
    }
}

fn sqlserver_workflow_database_name(object_name: &str) -> Option<String> {
    let parts = split_sqlserver_name(object_name)
        .into_iter()
        .map(|part| clean_sqlserver_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    (parts.len() == 1).then(|| parts[0].clone())
}

fn split_sqlserver_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut bracket_depth = 0u8;
    let mut quote = None::<char>;

    for ch in value.chars() {
        match ch {
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '"' | '`' if bracket_depth == 0 => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                }
                current.push(ch);
            }
            '.' if bracket_depth == 0 && quote.is_none() => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn clean_sqlserver_identifier(value: &str) -> String {
    let trimmed = value.trim();
    let unwrapped = trimmed
        .strip_prefix('[')
        .and_then(|item| item.strip_suffix(']'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('`')
                .and_then(|item| item.strip_suffix('`'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("]]", "]")
        .replace("\"\"", "\"")
        .replace("``", "`")
}

fn oracle_operation_request(operation_id: &str, object_name: &str, parameter_json: &str) -> String {
    if operation_id.ends_with("index.create") {
        return format!("create index idx_{object_name}_id on {object_name} (id);");
    }

    if operation_id.ends_with("index.drop") {
        return "-- Review before running.\ndrop index index_name;".into();
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return format!(
            "-- Oracle SQLcl/SQL*Plus CSV export plan.\nset markup csv on\nspool <selected-file>.csv\nselect * from {object_name} fetch first 1000 rows only;\nspool off\n-- Data Pump import/export should be reviewed with DIRECTORY grants, schemas, remap rules, and table filters before execution."
        );
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return "-- Oracle RMAN backup/restore plan.\n-- Review retention policy, archivelog mode, wallet/TDE state, and recovery target before execution.\nrman target /\nbackup database plus archivelog;\n-- restore database preview requires explicit target time/SCN and mount state validation.".into();
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select owner, object_name, object_type, status from all_objects where rownum <= 500 order by owner, object_type, object_name;".into(),
        "execute" => format!("select * from {object_name} where rownum <= 100;"),
        "explain" => format!("explain plan for select * from {object_name} where rownum <= 100;\nselect * from table(dbms_xplan.display);"),
        "profile" => "select * from table(dbms_xplan.display_cursor(null, null, 'ALLSTATS LAST'));\n-- SQL Monitor when granted:\nselect * from v$sql_monitor where rownum <= 100;".to_string(),
        "create" => format!("create table {object_name} (\n  id number generated by default as identity primary key,\n  created_at timestamp default systimestamp not null\n);"),
        "drop" => format!("-- Review before running.\ndrop table {object_name} purge;"),
        "inspect" => "select * from session_privs;\nselect * from session_roles;\nselect * from user_tab_privs;".into(),
        "metrics" => "select * from v$session where rownum <= 100;\nselect tablespace_name, status from user_tablespaces;\nselect * from table(dbms_xplan.display);".into(),
        _ => format!("-- Oracle {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn string_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<String> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn numeric_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<u64> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_u64().or_else(|| {
                value.as_str().and_then(|raw| {
                    raw.chars()
                        .filter(|character| character.is_ascii_digit())
                        .collect::<String>()
                        .parse()
                        .ok()
                })
            })
        })
}

fn bool_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<bool> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "enabled" | "1" => Some(true),
                        "false" | "no" | "disabled" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

fn cypher_identifier(value: &str) -> String {
    if is_simple_identifier(value) {
        value.into()
    } else {
        format!("`{}`", value.replace('`', "``"))
    }
}

fn snowflake_identifier(value: &str) -> String {
    value
        .split('.')
        .map(|part| {
            format!(
                "\"{}\"",
                strip_identifier_wrapper(part).replace('"', "\"\"")
            )
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn clickhouse_identifier(value: &str) -> String {
    value
        .split('.')
        .map(|part| format!("`{}`", strip_identifier_wrapper(part).replace('`', "``")))
        .collect::<Vec<_>>()
        .join(".")
}

fn strip_identifier_wrapper(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('`') && trimmed.ends_with('`'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']')))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

fn strip_plan_prefix(query: &str) -> String {
    let trimmed = query.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("profile ") || lower.starts_with("explain ") {
        trimmed[8..].trim().into()
    } else {
        trimmed.into()
    }
}

fn strip_trailing_semicolon(query: &str) -> String {
    query.trim().trim_end_matches(';').trim().into()
}

fn safe_identifier(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if cleaned.is_empty() {
        "object".into()
    } else {
        cleaned
    }
}

fn escape_single_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn escape_double_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn cosmosdb_drop_path(object_kind: &str, database: &str, container: &str) -> String {
    if object_kind == "database" {
        return format!("/dbs/{database}");
    }

    if matches!(object_kind, "stored-procedures" | "triggers" | "udfs") {
        return format!("/dbs/{database}/colls/{container}/{object_kind}/<script-id>");
    }

    format!("/dbs/{database}/colls/{container}")
}

fn is_simple_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && chars.all(|item| item.is_ascii_alphanumeric() || item == '_')
}

fn safe_sqlserver_name(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(80)
        .collect::<String>()
}

fn safe_sqlserver_index_name(parameters: Option<&BTreeMap<String, Value>>) -> String {
    string_parameter(parameters, "indexName")
        .map(|value| sqlserver_quoted_identifier(&value))
        .unwrap_or_else(|| "[IX_name]".into())
}

fn sqlserver_target_object(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let table = string_parameter(parameters, "table");
    if let Some(table) = table {
        if let Some(schema) = string_parameter(parameters, "schema") {
            return format!(
                "{}.{}",
                sqlserver_quoted_identifier(&schema),
                sqlserver_quoted_identifier(&table)
            );
        }
        return sqlserver_quoted_identifier(&table);
    }

    object_name.into()
}

fn sqlserver_quoted_identifier(value: &str) -> String {
    let cleaned = strip_identifier_wrapper(value);
    format!("[{}]", cleaned.replace(']', "]]"))
}

pub(crate) fn default_operation_plan(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let object_name = default_object_name(manifest, object_name);
    let destructive = operation_id.contains(".drop")
        || operation_id.contains(".convert-to-capped")
        || operation_id.contains(".session.terminate")
        || operation_id.contains("backup-restore")
        || operation_id.contains(".backup.restore")
        || operation_id.contains(".key.delete")
        || operation_id.contains(".stream.delete")
        || operation_id.contains(".repair")
        || operation_id.contains(".flush");
    let admin_write = operation_id.contains(".create")
        || operation_id.contains(".update")
        || operation_id.contains(".hide")
        || operation_id.contains(".unhide")
        || operation_id.contains(".put-mapping")
        || operation_id.contains(".alias.")
        || operation_id.contains(".data-stream.rollover")
        || operation_id.contains(".pipeline.simulate")
        || operation_id.contains(".user.")
        || operation_id.contains(".role.")
        || operation_id.contains(".routine.execute")
        || operation_id.contains(".session.cancel")
        || operation_id.contains(".key.set")
        || operation_id.contains(".key.touch")
        || operation_id.contains(".key.increment")
        || operation_id.contains(".key.import")
        || operation_id.contains(".table.import")
        || operation_id.contains(".key.rename")
        || operation_id.contains(".key.copy")
        || operation_id.contains(".key.move")
        || operation_id.contains(".key.expire")
        || operation_id.contains(".key.persist")
        || operation_id.contains(".stream.ack")
        || operation_id.contains(".extension.")
        || operation_id.contains(".file.import")
        || operation_id.contains(".collection.import")
        || operation_id.contains(".collection.modify")
        || operation_id.contains(".collection.rename")
        || operation_id.contains(".event.")
        || (operation_id.contains(".security.") && !operation_id.ends_with("security.inspect"))
        || operation_id.contains("validation")
        || operation_id.contains("validator")
        || operation_id.contains("import-export")
        || operation_id.contains("backup-restore")
        || operation_id.contains(".backup.create")
        || operation_id.contains(".failover")
        || operation_id.contains(".checkpoint")
        || operation_id.contains(".vacuum")
        || operation_id.contains(".reindex")
        || operation_id.contains(".rebuild")
        || operation_id.contains(".reorganize")
        || operation_id.contains(".disable")
        || operation_id.contains(".enable")
        || operation_id.contains(".compact")
        || operation_id.contains(".reset")
        || operation_id.contains(".clone")
        || operation_id.contains(".copy")
        || operation_id.contains(".optimize")
        || operation_id.contains(".materialize")
        || operation_id.contains(".freeze")
        || operation_id.contains(".suspend")
        || operation_id.contains(".resume")
        || operation_id.contains(".repair")
        || operation_id.contains(".analyze");
    let costly = destructive
        || admin_write
        || operation_id.contains(".collection.export")
        || operation_id.contains(".collection.validate")
        || operation_id.contains(".key.export")
        || operation_id.contains(".table.export")
        || operation_id.contains(".database.backup")
        || operation_id.contains(".cardinality.")
        || operation_id.contains(".profile")
        || operation_id.contains("metrics");
    let generated_request =
        generated_operation_request(connection, manifest, operation_id, &object_name, parameters);
    let required_permissions = if destructive {
        vec!["owner/admin role or equivalent destructive privilege".into()]
    } else if admin_write {
        vec!["write/admin privilege for the target object".into()]
    } else {
        vec!["read metadata/query privilege".into()]
    };
    let mut warnings = Vec::new();

    if manifest.maturity == "beta" {
        warnings.push("This beta adapter returns a guarded operation plan before live mutation support is enabled.".into());
    }
    if connection.read_only {
        warnings.push("The selected connection profile is read-only; write, admin, and destructive execution will be blocked.".into());
    }
    if costly {
        warnings.push("This operation can execute workload, scan data, consume cloud resources, or affect cluster state.".into());
    }

    OperationPlan {
        operation_id: operation_id.into(),
        engine: manifest.engine.clone(),
        summary: format!("Prepared {} operation for {object_name}.", manifest.label),
        generated_request,
        request_language: manifest.default_language.clone(),
        destructive,
        estimated_cost: if costly {
            Some("Unknown until the live adapter runs an engine-specific dry run/profile.".into())
        } else {
            Some("No material cost expected for metadata/read preview.".into())
        },
        estimated_scan_impact: if operation_id.contains(".execute")
            || operation_id.contains(".profile")
            || operation_id.contains("metrics")
        {
            Some("Bound by the generated limit where possible; profile/analyze variants may execute the query.".into())
        } else {
            Some("Metadata-only or object-scoped.".into())
        },
        required_permissions,
        confirmation_text: if destructive || costly || admin_write || connection.read_only {
            Some(format!("CONFIRM {}", manifest.engine.to_uppercase()))
        } else {
            None
        },
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/common/operations/planning_tests.rs"]
mod tests;
