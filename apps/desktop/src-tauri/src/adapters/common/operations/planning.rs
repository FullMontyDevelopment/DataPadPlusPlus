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
                return sqlite_operation_request(operation_id, object_name, &parameter_json);
            }

            if manifest.engine == "duckdb" {
                return duckdb_operation_request(operation_id, object_name, parameters);
            }

            if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
                if let Some(request) = mysql_operation_request(manifest, operation_id, object_name)
                {
                    return request;
                }
            }

            if manifest.engine == "postgresql" {
                if let Some(request) = postgres_operation_request(operation_id, object_name) {
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
        "search" => search_operation_request(operation_id, object_name, &parameter_json),
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

    if operation_id.ends_with("collection.export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collection": collection,
            "operation": "export",
            "format": parameter("format").cloned().unwrap_or_else(|| serde_json::json!("extended-json")),
            "filter": parameter("filter").cloned().unwrap_or_else(|| serde_json::json!({})),
            "projection": parameter("projection").cloned().unwrap_or_else(|| serde_json::json!({})),
            "sort": parameter("sort").cloned().unwrap_or_else(|| serde_json::json!({})),
            "batchSize": parameter("batchSize").cloned().unwrap_or_else(|| serde_json::json!(1000))
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("collection.import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "collection": collection,
            "operation": "import",
            "format": parameter("format").cloned().unwrap_or_else(|| serde_json::json!("json")),
            "mode": parameter("mode").cloned().unwrap_or_else(|| serde_json::json!("insertMany")),
            "validation": parameter("validation").cloned().unwrap_or_else(|| serde_json::json!("validate-before-write")),
            "mapping": parameter("mapping").cloned().unwrap_or_else(|| serde_json::json!({}))
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
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "LiteDB.Checkpoint",
            "databaseFile": database_file,
            "preflight": ["verify-file-lock", "flush-dirty-pages"],
            "effect": "persist pending pages without changing collection data"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("storage.compact") {
        let output_file = string_parameter(parameters, "outputFile")
            .unwrap_or_else(|| "<selected-folder>/compacted.db".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "LiteDB.Compact",
            "databaseFile": database_file,
            "outputFile": output_file,
            "preflight": ["checkpoint", "verify-exclusive-or-online-copy-support", "preserve-encryption-settings"],
            "validation": ["open-compacted-copy", "compare-collection-counts", "compare-index-counts"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("storage.rebuild-indexes") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "LiteDB.RebuildIndexes",
            "databaseFile": database_file,
            "collection": collection,
            "preflight": ["checkpoint", "verify-file-lock", "list-indexes"],
            "validation": ["compare-index-counts", "sample-indexed-queries"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return format!(
            "db.GetCollection(\"{}\").EnsureIndex(\"{}\", \"{}\", {unique});",
            escape_double_quoted(&collection),
            escape_double_quoted(&index_name),
            escape_double_quoted(&field)
        );
    }

    if operation_id.ends_with("index.drop") {
        return format!(
            "db.GetCollection(\"{}\").DropIndex(\"{}\");",
            escape_double_quoted(&collection),
            escape_double_quoted(&index_name)
        );
    }

    if operation_id.ends_with("data.import-export") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "export".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": if mode == "import" { "LiteDB.ImportCollection" } else { "LiteDB.ExportCollection" },
            "databaseFile": database_file,
            "collection": collection,
            "format": format,
            "file": if format == "ndjson" { "<selected-file>.ndjson" } else { "<selected-file>.json" },
            "validation": if mode == "import" { "parse-bson-and-validate-indexes" } else { "stream-with-bounded-memory" }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.backup-restore") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "LiteDB.Backup",
            "databaseFile": database_file,
            "outputFile": "<selected-folder>/backup.db",
            "preflight": ["checkpoint", "verify-file-lock", "preserve-encryption-settings"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review before running.\ndb.DropCollection(\"{}\");",
            escape_double_quoted(&collection)
        );
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "operation": operation_id,
        "databaseFile": database_file,
        "collection": collection
    }))
    .unwrap_or_else(|_| "{}".into())
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

fn search_operation_request(operation_id: &str, object_name: &str, parameter_json: &str) -> String {
    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_name),
            "body": {
                "explain": true,
                "query": { "match_all": {} },
                "size": 20
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_name),
            "body": {
                "profile": true,
                "query": { "match_all": {} },
                "size": 20
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_name}"),
            "body": {
                "settings": { "number_of_shards": 1, "number_of_replicas": 1 },
                "mappings": { "properties": {} }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.refresh") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_refresh")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.force-merge") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_forcemerge"),
            "body": {
                "max_num_segments": 1,
                "only_expunge_deletes": false
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.clear-cache") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_cache/clear"),
            "body": {
                "query": true,
                "request": true,
                "fielddata": false
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
                    "index": format!("{object_name}-reindexed")
                },
                "conflicts": "proceed"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.close") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_close")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.open") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_open")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.put-mapping") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_name}/_mapping"),
            "body": {
                "properties": {
                    "new_field": { "type": "keyword" }
                }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.update-settings") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/{object_name}/_settings"),
            "body": {
                "index": {
                    "refresh_interval": "1s"
                }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/{object_name}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.put") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "add": { "index": object_name, "alias": format!("{object_name}-read") } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("alias.delete") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_aliases",
            "body": {
                "actions": [
                    { "remove": { "index": "*", "alias": object_name } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.explain") {
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/explain/{object_name}")
        } else {
            format!("/{object_name}/_ilm/explain")
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": path
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data-stream.rollover") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{object_name}/_rollover"),
            "body": {
                "conditions": {
                    "max_age": "30d",
                    "max_primary_shard_size": "50gb"
                }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/_index_template/{object_name}"),
            "body": {
                "index_patterns": [format!("{object_name}-*")],
                "template": {
                    "settings": { "number_of_shards": 1 },
                    "mappings": { "properties": {} }
                },
                "priority": 100
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("template.delete") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/_index_template/{object_name}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.put") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": format!("/_ingest/pipeline/{object_name}"),
            "body": {
                "description": "DataPad++ pipeline preview",
                "processors": [
                    { "set": { "field": "processed_at", "value": "{{_ingest.timestamp}}" } }
                ],
                "on_failure": []
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("pipeline.simulate") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_ingest/pipeline/{object_name}/_simulate"),
            "body": {
                "docs": [
                    { "_source": { "message": "sample" } }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("lifecycle.put") {
        let path = if operation_id.starts_with("opensearch.") {
            format!("/_plugins/_ism/policies/{object_name}")
        } else {
            format!("/_ilm/policy/{object_name}")
        };
        let body = if operation_id.starts_with("opensearch.") {
            serde_json::json!({
                "policy": {
                    "description": "DataPad++ preview policy",
                    "states": []
                }
            })
        } else {
            serde_json::json!({
                "policy": {
                    "phases": {
                        "hot": { "actions": {} }
                    }
                }
            })
        };
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": path,
            "body": body
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("task.cancel") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_tasks/{object_name}/_cancel")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("snapshot.restore") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_snapshot/<repository>/{object_name}/_restore"),
            "body": {
                "indices": "*",
                "include_global_state": false
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/_security/role"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/{}/_search", object_name),
            "body": {
                "query": { "match_all": {} },
                "size": 1000,
                "sort": ["_doc"],
                "format": "ndjson"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.backup-restore") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PUT",
            "path": "/_snapshot/<repository>/<snapshot>",
            "body": {
                "indices": object_name,
                "include_global_state": false
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!(
        "{{\n  \"index\": \"{object_name}\",\n  \"body\": {{\n    \"query\": {{ \"match_all\": {{}} }},\n    \"size\": 100\n  }},\n  \"operation\": \"{operation_id}\",\n  \"parameters\": {parameter_json}\n}}"
    )
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
            "region": region,
            "tableName": table_name,
            "metrics": [
                "ConsumedReadCapacityUnits",
                "ConsumedWriteCapacityUnits",
                "ReadThrottleEvents",
                "WriteThrottleEvents",
                "SuccessfulRequestLatency"
            ],
            "period": "5m"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "IAM.SimulatePrincipalPolicy",
            "tableName": table_name,
            "resourceArn": format!("arn:aws:dynamodb:<region>:<account>:table/{table_name}"),
            "actions": [
                "dynamodb:DescribeTable",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem"
            ]
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
            "preflight": ["DescribeTable", "CheckAutoScalingPolicies", "EstimateCost"]
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
            "preflight": ["DescribeTable", "ListBackups"]
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
            "validation": "restore-preview"
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
            "validation": if mode == "import" { "validate-before-write" } else { "point-in-time-export" }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.DeleteTable",
            "tableName": table_name,
            "preflight": ["DescribeTable", "ListBackups", "CheckDeletionProtection"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{{\n  \"TableName\": \"{table_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\"\n}}")
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

fn sqlite_operation_request(operation_id: &str, object_name: &str, parameter_json: &str) -> String {
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
        return "-- Review file path and locks before running.\nvacuum;\n-- Or compact into a new file:\n-- vacuum into 'compact.sqlite';".into();
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

fn duckdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    if operation_id.ends_with("table.analyze") {
        return format!("analyze {object_name};");
    }

    if operation_id.ends_with("database.analyze") {
        return "analyze;".into();
    }

    if operation_id.ends_with("database.checkpoint") {
        return "checkpoint;".into();
    }

    if operation_id.ends_with("extension.install") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return format!("install {};", safe_duckdb_extension_name(&extension));
    }

    if operation_id.ends_with("extension.load") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return format!("load {};", safe_duckdb_extension_name(&extension));
    }

    if operation_id.ends_with("file.import") {
        let table = string_parameter(parameters, "tableName").unwrap_or_else(|| object_name.into());
        let format = string_parameter(parameters, "sourceFormat")
            .or_else(|| string_parameter(parameters, "format"))
            .unwrap_or_else(|| "parquet".into());
        return duckdb_import_file_request(&table, &format);
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "export".into());
        if mode == "import" {
            let format = string_parameter(parameters, "sourceFormat")
                .or_else(|| string_parameter(parameters, "format"))
                .unwrap_or_else(|| "parquet".into());
            return duckdb_import_file_request(object_name, &format);
        }
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "parquet".into());
        let extension = if format == "parquet" {
            "parquet"
        } else {
            "csv"
        };
        return format!(
            "copy (select * from {object_name}) to '<selected-file>.{extension}' (format {format});"
        );
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return "export database '<selected-folder>' (format parquet);".into();
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select table_schema, table_name, table_type from information_schema.tables order by table_schema, table_name;".into(),
        "execute" => format!("select * from {object_name} limit 100;"),
        "explain" => format!("explain select * from {object_name} limit 100;"),
        "profile" => format!("explain analyze select * from {object_name} limit 100;"),
        "create" => format!("create table {object_name} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
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
) -> Option<String> {
    if operation_id.ends_with("table.analyze") {
        return Some(format!("analyze table {object_name};"));
    }

    if operation_id.ends_with("table.optimize") {
        return Some(format!("optimize table {object_name};"));
    }

    if operation_id.ends_with("table.check") {
        return Some(format!("check table {object_name};"));
    }

    if operation_id.ends_with("table.repair") {
        return Some(format!("repair table {object_name};"));
    }

    if operation_id.ends_with("event.enable") {
        return Some(format!("alter event {object_name} enable;"));
    }

    if operation_id.ends_with("event.disable") {
        return Some(format!("alter event {object_name} disable;"));
    }

    if operation_id.ends_with("security.inspect") {
        return Some(
            "show grants;\nselect user, host, plugin, account_locked from mysql.user order by user, host;"
                .into(),
        );
    }

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some("show global status;\nshow full processlist;".into());
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

fn postgres_operation_request(operation_id: &str, object_name: &str) -> Option<String> {
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

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some(
            "select * from pg_stat_activity order by query_start desc nulls last limit 100;\nselect * from pg_stat_database where datname = current_database();"
                .into(),
        );
    }

    None
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
        return format!("-- Export with bcp/sqlcmd or the DataPad++ file workflow.\nselect top 1000 * from {object_name};");
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return "backup database [database_name]\nto disk = '<selected-folder>\\database_name.bak'\nwith compression, checksum;".into();
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
        "profile" => format!("set statistics io on;\nset statistics time on;\nselect top 100 * from {object_name};\nset statistics io off;\nset statistics time off;"),
        "create" => format!("create table {object_name} (\n  [id] int identity(1, 1) not null primary key,\n  [created_at] datetime2 not null default sysutcdatetime()\n);"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
        "inspect" => "select * from sys.database_permissions;\nselect * from sys.database_principals;".into(),
        "metrics" => "select * from sys.dm_exec_sessions;\nselect * from sys.dm_exec_requests;\nselect * from sys.dm_os_wait_stats;".into(),
        _ => format!("-- SQL Server {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn oracle_operation_request(operation_id: &str, object_name: &str, parameter_json: &str) -> String {
    if operation_id.ends_with("index.create") {
        return format!("create index idx_{object_name}_id on {object_name} (id);");
    }

    if operation_id.ends_with("index.drop") {
        return "-- Review before running.\ndrop index index_name;".into();
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
        || operation_id.contains("backup-restore")
        || operation_id.contains(".backup.restore")
        || operation_id.contains(".key.delete")
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
        || operation_id.contains(".key.set")
        || operation_id.contains(".key.touch")
        || operation_id.contains(".key.increment")
        || operation_id.contains(".extension.")
        || operation_id.contains(".file.import")
        || operation_id.contains(".collection.import")
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
mod tests {
    use super::{default_operation_plan, generated_operation_request};
    use crate::domain::models::{AdapterManifest, ResolvedConnectionProfile};
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn mongodb_collection_import_export_requests_are_database_scoped() {
        let connection = connection();
        let manifest = manifest();
        let parameters = BTreeMap::from([
            ("database".into(), json!("catalog")),
            ("collection".into(), json!("products")),
            ("format".into(), json!("ndjson")),
            ("filter".into(), json!({ "active": true })),
            ("batchSize".into(), json!(500)),
        ]);

        let export_request = generated_operation_request(
            &connection,
            &manifest,
            "mongodb.collection.export",
            "products",
            Some(&parameters),
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&export_request).unwrap()["database"],
            "catalog"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&export_request).unwrap()["operation"],
            "export"
        );
        assert!(export_request.contains("\"active\": true"));

        let import_plan = default_operation_plan(
            &connection,
            &manifest,
            "mongodb.collection.import",
            Some("products"),
            Some(&parameters),
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&import_plan.generated_request).unwrap()
                ["operation"],
            "import"
        );
        assert_eq!(
            import_plan.required_permissions,
            vec!["write/admin privilege for the target object"]
        );
        assert!(import_plan.confirmation_text.is_some());
    }

    #[test]
    fn mongodb_user_create_can_use_secret_variable_password_source() {
        let connection = connection();
        let manifest = manifest();
        let parameters = BTreeMap::from([
            ("database".into(), json!("catalog")),
            ("name".into(), json!("reporting")),
            ("password".into(), json!("{{MONGO_USER_PASSWORD}}")),
            ("roles".into(), json!([{ "role": "read", "db": "catalog" }])),
        ]);

        let request = generated_operation_request(
            &connection,
            &manifest,
            "mongodb.user.create",
            "reporting",
            Some(&parameters),
        );
        let value = serde_json::from_str::<serde_json::Value>(&request).unwrap();

        assert_eq!(value["database"], "catalog");
        assert_eq!(value["createUser"], "reporting");
        assert_eq!(value["pwd"], "{{MONGO_USER_PASSWORD}}");
        assert_eq!(value["roles"][0]["role"], "read");
    }

    #[test]
    fn unscoped_operation_plans_use_honest_placeholders_not_fake_samples() {
        let connection = connection();
        let cases = [
            ("mongodb", "document", "mongodb", "mongodb.query.execute"),
            ("redis", "keyvalue", "redis", "redis.query.execute"),
            ("neo4j", "graph", "cypher", "neo4j.query.execute"),
            (
                "prometheus",
                "timeseries",
                "promql",
                "prometheus.query.execute",
            ),
            ("cassandra", "widecolumn", "cql", "cassandra.query.execute"),
            (
                "elasticsearch",
                "search",
                "json",
                "elasticsearch.query.execute",
            ),
            ("postgresql", "sql", "sql", "postgresql.query.execute"),
            ("snowflake", "warehouse", "sql", "snowflake.query.execute"),
        ];

        for (engine, family, language, operation_id) in cases {
            let manifest = manifest_for(engine, family, language);
            let plan = default_operation_plan(&connection, &manifest, operation_id, None, None);
            let preview_text =
                format!("{}\n{}", plan.summary, plan.generated_request).to_ascii_lowercase();

            assert!(
                !preview_text.contains("sample"),
                "{engine} plan should not invent sample objects: {preview_text}"
            );
        }
    }

    #[test]
    fn sql_family_operation_plans_are_dialect_aware() {
        let connection = connection();
        let sqlserver_manifest = manifest_for("sqlserver", "sql", "sql");
        let postgres_manifest = manifest_for("postgresql", "sql", "sql");
        let sqlite_manifest = manifest_for("sqlite", "sql", "sql");
        let duckdb_manifest = manifest_for("duckdb", "embedded-olap", "sql");
        let mysql_manifest = manifest_for("mysql", "sql", "sql");
        let mariadb_manifest = manifest_for("mariadb", "sql", "sql");

        let sqlserver_explain = generated_operation_request(
            &connection,
            &sqlserver_manifest,
            "sqlserver.query.explain",
            "[dbo].[Accounts]",
            None,
        );
        assert!(sqlserver_explain.contains("set showplan_text on"));
        assert!(sqlserver_explain.contains("select top 100 * from [dbo].[Accounts];"));

        let sqlserver_parameters = BTreeMap::from([
            ("schema".into(), json!("dbo")),
            ("table".into(), json!("Accounts")),
            ("indexName".into(), json!("IX_Accounts_status")),
        ]);
        let sqlserver_stats = generated_operation_request(
            &connection,
            &sqlserver_manifest,
            "sqlserver.statistics.update",
            "[dbo].[Accounts]",
            Some(&sqlserver_parameters),
        );
        assert_eq!(
            sqlserver_stats,
            "update statistics [dbo].[Accounts] with fullscan;"
        );

        let sqlserver_rebuild = generated_operation_request(
            &connection,
            &sqlserver_manifest,
            "sqlserver.index.rebuild",
            "[dbo].[Accounts]",
            Some(&sqlserver_parameters),
        );
        assert!(sqlserver_rebuild
            .contains("alter index [IX_Accounts_status] on [dbo].[Accounts] rebuild"));

        let sqlserver_query_store = generated_operation_request(
            &connection,
            &sqlserver_manifest,
            "sqlserver.query-store.top-queries",
            "Query Store",
            None,
        );
        assert!(sqlserver_query_store.contains("from sys.query_store_query"));

        let postgres_export = generated_operation_request(
            &connection,
            &postgres_manifest,
            "postgresql.data.import-export",
            "\"public\".\"accounts\"",
            None,
        );
        assert!(postgres_export.contains("copy (select * from \"public\".\"accounts\")"));

        let postgres_analyze = generated_operation_request(
            &connection,
            &postgres_manifest,
            "postgresql.table.analyze",
            "\"public\".\"accounts\"",
            None,
        );
        assert_eq!(postgres_analyze, "analyze verbose \"public\".\"accounts\";");

        let postgres_vacuum = generated_operation_request(
            &connection,
            &postgres_manifest,
            "postgresql.table.vacuum",
            "\"public\".\"accounts\"",
            None,
        );
        assert_eq!(
            postgres_vacuum,
            "vacuum (verbose, analyze) \"public\".\"accounts\";"
        );

        let postgres_reindex = generated_operation_request(
            &connection,
            &postgres_manifest,
            "postgresql.index.reindex",
            "\"public\".\"accounts_name_idx\"",
            None,
        );
        assert!(postgres_reindex
            .contains("reindex index concurrently \"public\".\"accounts_name_idx\";"));

        let sqlite_export = generated_operation_request(
            &connection,
            &sqlite_manifest,
            "sqlite.data.import-export",
            "[accounts]",
            None,
        );
        assert!(sqlite_export.contains(".mode csv"));
        assert!(sqlite_export.contains("select * from [accounts];"));

        let sqlite_integrity = generated_operation_request(
            &connection,
            &sqlite_manifest,
            "sqlite.database.integrity-check",
            "[main]",
            None,
        );
        assert!(sqlite_integrity.contains("pragma quick_check"));
        assert!(sqlite_integrity.contains("pragma integrity_check"));

        let sqlite_analyze = generated_operation_request(
            &connection,
            &sqlite_manifest,
            "sqlite.table.analyze",
            "[accounts]",
            None,
        );
        assert_eq!(sqlite_analyze, "analyze [accounts];");

        let sqlite_reindex = generated_operation_request(
            &connection,
            &sqlite_manifest,
            "sqlite.index.reindex",
            "[accounts_name_idx]",
            None,
        );
        assert_eq!(sqlite_reindex, "reindex [accounts_name_idx];");

        let duckdb_analyze = generated_operation_request(
            &connection,
            &duckdb_manifest,
            "duckdb.table.analyze",
            "\"main\".\"orders\"",
            None,
        );
        assert_eq!(duckdb_analyze, "analyze \"main\".\"orders\";");

        let duckdb_load = generated_operation_request(
            &connection,
            &duckdb_manifest,
            "duckdb.extension.load",
            "httpfs",
            Some(&BTreeMap::from([("extensionName".into(), json!("httpfs"))])),
        );
        assert_eq!(duckdb_load, "load httpfs;");

        let duckdb_import = generated_operation_request(
            &connection,
            &duckdb_manifest,
            "duckdb.file.import",
            "\"main\".\"orders_import\"",
            Some(&BTreeMap::from([
                ("sourceFormat".into(), json!("csv")),
                ("tableName".into(), json!("\"main\".\"orders_import\"")),
            ])),
        );
        assert!(duckdb_import.contains("read_csv_auto"));
        assert!(duckdb_import.contains("create or replace table \"main\".\"orders_import\""));

        let mysql_check = generated_operation_request(
            &connection,
            &mysql_manifest,
            "mysql.table.check",
            "`shop`.`orders`",
            None,
        );
        assert_eq!(mysql_check, "check table `shop`.`orders`;");

        let mysql_repair = generated_operation_request(
            &connection,
            &mysql_manifest,
            "mysql.table.repair",
            "`shop`.`orders`",
            None,
        );
        assert_eq!(mysql_repair, "repair table `shop`.`orders`;");

        let mysql_event = generated_operation_request(
            &connection,
            &mysql_manifest,
            "mysql.event.disable",
            "`shop`.`refresh_rollups`",
            None,
        );
        assert_eq!(mysql_event, "alter event `shop`.`refresh_rollups` disable;");

        let mariadb_profile = generated_operation_request(
            &connection,
            &mariadb_manifest,
            "mariadb.query.profile",
            "`shop`.`orders`",
            None,
        );
        assert_eq!(
            mariadb_profile,
            "analyze format=json select * from `shop`.`orders` limit 100;"
        );
    }

    #[test]
    fn search_operation_plans_use_http_request_shapes() {
        let connection = connection();
        let manifest = manifest_for("elasticsearch", "search", "query-dsl");

        let profile_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.query.profile",
            "products-v1",
            None,
        );
        let profile_value = serde_json::from_str::<serde_json::Value>(&profile_request).unwrap();
        assert_eq!(profile_value["method"], "POST");
        assert_eq!(profile_value["path"], "/products-v1/_search");
        assert_eq!(profile_value["body"]["profile"], true);

        let drop_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.index.drop",
            "products-v1",
            None,
        );
        let drop_value = serde_json::from_str::<serde_json::Value>(&drop_request).unwrap();
        assert_eq!(drop_value["method"], "DELETE");
        assert_eq!(drop_value["path"], "/products-v1");

        let mapping_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.index.put-mapping",
            "products-v1",
            None,
        );
        let mapping_value = serde_json::from_str::<serde_json::Value>(&mapping_request).unwrap();
        assert_eq!(mapping_value["method"], "PUT");
        assert_eq!(mapping_value["path"], "/products-v1/_mapping");
        assert_eq!(
            mapping_value["body"]["properties"]["new_field"]["type"],
            "keyword"
        );

        let alias_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.alias.put",
            "products-v1",
            None,
        );
        let alias_value = serde_json::from_str::<serde_json::Value>(&alias_request).unwrap();
        assert_eq!(alias_value["method"], "POST");
        assert_eq!(alias_value["path"], "/_aliases");
        assert_eq!(
            alias_value["body"]["actions"][0]["add"]["alias"],
            "products-v1-read"
        );

        let lifecycle_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.lifecycle.explain",
            "products-v1",
            None,
        );
        let lifecycle_value =
            serde_json::from_str::<serde_json::Value>(&lifecycle_request).unwrap();
        assert_eq!(lifecycle_value["method"], "GET");
        assert_eq!(lifecycle_value["path"], "/products-v1/_ilm/explain");

        let merge_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.index.force-merge",
            "products-v1",
            None,
        );
        let merge_value = serde_json::from_str::<serde_json::Value>(&merge_request).unwrap();
        assert_eq!(merge_value["method"], "POST");
        assert_eq!(merge_value["path"], "/products-v1/_forcemerge");
        assert_eq!(merge_value["body"]["max_num_segments"], 1);

        let reindex_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.index.reindex",
            "products-v1",
            None,
        );
        let reindex_value = serde_json::from_str::<serde_json::Value>(&reindex_request).unwrap();
        assert_eq!(reindex_value["method"], "POST");
        assert_eq!(reindex_value["path"], "/_reindex");
        assert_eq!(
            reindex_value["body"]["dest"]["index"],
            "products-v1-reindexed"
        );

        let pipeline_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.pipeline.put",
            "normalize-products",
            None,
        );
        let pipeline_value = serde_json::from_str::<serde_json::Value>(&pipeline_request).unwrap();
        assert_eq!(pipeline_value["method"], "PUT");
        assert_eq!(
            pipeline_value["path"],
            "/_ingest/pipeline/normalize-products"
        );

        let task_request = generated_operation_request(
            &connection,
            &manifest,
            "elasticsearch.task.cancel",
            "node-a:123",
            None,
        );
        let task_value = serde_json::from_str::<serde_json::Value>(&task_request).unwrap();
        assert_eq!(task_value["method"], "POST");
        assert_eq!(task_value["path"], "/_tasks/node-a:123/_cancel");
    }

    #[test]
    fn widecolumn_operation_plans_use_native_request_shapes() {
        let connection = connection();
        let dynamo_manifest = manifest_for("dynamodb", "widecolumn", "json");
        let cassandra_manifest = manifest_for("cassandra", "widecolumn", "cql");
        let dynamo_parameters = BTreeMap::from([
            ("tableName".into(), json!("Orders")),
            ("indexName".into(), json!("customer-status-index")),
            ("partitionKey".into(), json!("customerId")),
        ]);
        let cassandra_parameters = BTreeMap::from([
            ("keyspace".into(), json!("app")),
            ("tableName".into(), json!("orders_by_customer")),
            ("indexName".into(), json!("orders_status_sai")),
            ("columnName".into(), json!("status")),
        ]);

        let dynamo_request = generated_operation_request(
            &connection,
            &dynamo_manifest,
            "dynamodb.index.create",
            "Orders",
            Some(&dynamo_parameters),
        );
        let dynamo_value = serde_json::from_str::<serde_json::Value>(&dynamo_request).unwrap();
        assert_eq!(dynamo_value["operation"], "DynamoDB.UpdateTable");
        assert_eq!(dynamo_value["tableName"], "Orders");
        assert_eq!(
            dynamo_value["globalSecondaryIndexUpdates"][0]["create"]["indexName"],
            "customer-status-index"
        );

        let ttl_parameters = BTreeMap::from([
            ("tableName".into(), json!("Orders")),
            ("ttlAttribute".into(), json!("expiresAt")),
            ("enabled".into(), json!(true)),
        ]);
        let ttl_request = generated_operation_request(
            &connection,
            &dynamo_manifest,
            "dynamodb.ttl.update",
            "Orders",
            Some(&ttl_parameters),
        );
        let ttl_value = serde_json::from_str::<serde_json::Value>(&ttl_request).unwrap();
        assert_eq!(ttl_value["operation"], "DynamoDB.UpdateTimeToLive");
        assert_eq!(
            ttl_value["timeToLiveSpecification"]["attributeName"],
            "expiresAt"
        );

        let stream_parameters = BTreeMap::from([
            ("tableName".into(), json!("Orders")),
            ("streamViewType".into(), json!("NEW_AND_OLD_IMAGES")),
        ]);
        let stream_request = generated_operation_request(
            &connection,
            &dynamo_manifest,
            "dynamodb.streams.update",
            "Orders",
            Some(&stream_parameters),
        );
        let stream_value = serde_json::from_str::<serde_json::Value>(&stream_request).unwrap();
        assert_eq!(stream_value["operation"], "DynamoDB.UpdateTable");
        assert_eq!(
            stream_value["streamSpecification"]["streamViewType"],
            "NEW_AND_OLD_IMAGES"
        );

        let backup_parameters = BTreeMap::from([
            ("tableName".into(), json!("Orders")),
            ("backupName".into(), json!("Orders-manual")),
        ]);
        let backup_request = generated_operation_request(
            &connection,
            &dynamo_manifest,
            "dynamodb.backup.create",
            "Orders",
            Some(&backup_parameters),
        );
        let backup_value = serde_json::from_str::<serde_json::Value>(&backup_request).unwrap();
        assert_eq!(backup_value["operation"], "DynamoDB.CreateBackup");
        assert_eq!(backup_value["backupName"], "Orders-manual");

        let cassandra_trace = generated_operation_request(
            &connection,
            &cassandra_manifest,
            "cassandra.query.profile",
            "\"app\".\"orders_by_customer\"",
            Some(&cassandra_parameters),
        );
        assert!(cassandra_trace.contains("tracing on;"));
        assert!(cassandra_trace.contains("system_traces.events"));

        let cassandra_index = generated_operation_request(
            &connection,
            &cassandra_manifest,
            "cassandra.index.create",
            "\"app\".\"orders_by_customer\"",
            Some(&cassandra_parameters),
        );
        assert!(cassandra_index.contains("create custom index if not exists \"orders_status_sai\""));
        assert!(cassandra_index.contains("using 'StorageAttachedIndex'"));
    }

    #[test]
    fn timeseries_operation_plans_use_native_request_shapes() {
        let connection = connection();
        let prometheus_manifest = manifest_for("prometheus", "timeseries", "promql");
        let influx_manifest = manifest_for("influxdb", "timeseries", "influxql");
        let opentsdb_manifest = manifest_for("opentsdb", "timeseries", "opentsdb");
        let prometheus_parameters = BTreeMap::from([
            ("query".into(), json!("sum(rate(http_requests_total[5m]))")),
            ("objectKind".into(), json!("metric")),
        ]);
        let influx_parameters = BTreeMap::from([
            ("bucket".into(), json!("telemetry")),
            ("measurement".into(), json!("cpu")),
            ("mode".into(), json!("export")),
        ]);
        let opentsdb_parameters = BTreeMap::from([
            ("metric".into(), json!("http.requests")),
            ("objectKind".into(), json!("metric")),
        ]);

        let prometheus_request = generated_operation_request(
            &connection,
            &prometheus_manifest,
            "prometheus.query.profile",
            "http_requests_total",
            Some(&prometheus_parameters),
        );
        let prometheus_value =
            serde_json::from_str::<serde_json::Value>(&prometheus_request).unwrap();
        assert_eq!(prometheus_value["method"], "GET");
        assert_eq!(prometheus_value["path"], "/api/v1/query");
        assert_eq!(
            prometheus_value["query"]["query"],
            "sum(rate(http_requests_total[5m]))"
        );

        let prometheus_cardinality_request = generated_operation_request(
            &connection,
            &prometheus_manifest,
            "prometheus.cardinality.analyze",
            "http_requests_total",
            Some(&BTreeMap::from([(
                "match".into(),
                json!("http_requests_total"),
            )])),
        );
        let prometheus_cardinality_value =
            serde_json::from_str::<serde_json::Value>(&prometheus_cardinality_request).unwrap();
        assert_eq!(prometheus_cardinality_value["path"], "/api/v1/series");
        assert_eq!(
            prometheus_cardinality_value["analysis"]["checks"][2],
            "high-cardinality-labels"
        );

        let influx_request = generated_operation_request(
            &connection,
            &influx_manifest,
            "influxdb.data.import-export",
            "cpu",
            Some(&influx_parameters),
        );
        let influx_value = serde_json::from_str::<serde_json::Value>(&influx_request).unwrap();
        assert_eq!(influx_value["operation"], "line-protocol.export");
        assert_eq!(influx_value["bucket"], "telemetry");
        assert_eq!(influx_value["measurement"], "cpu");

        let influx_retention_request = generated_operation_request(
            &connection,
            &influx_manifest,
            "influxdb.retention.update",
            "telemetry",
            Some(&BTreeMap::from([
                ("bucket".into(), json!("telemetry")),
                ("retentionPeriod".into(), json!("7d")),
            ])),
        );
        let influx_retention_value =
            serde_json::from_str::<serde_json::Value>(&influx_retention_request).unwrap();
        assert_eq!(influx_retention_value["method"], "PATCH");
        assert_eq!(
            influx_retention_value["body"]["retentionRules"][0]["everySeconds"],
            604800
        );

        let opentsdb_request = generated_operation_request(
            &connection,
            &opentsdb_manifest,
            "opentsdb.diagnostics.metrics",
            "http.requests",
            Some(&opentsdb_parameters),
        );
        let opentsdb_value = serde_json::from_str::<serde_json::Value>(&opentsdb_request).unwrap();
        assert_eq!(opentsdb_value["method"], "GET");
        assert_eq!(opentsdb_value["path"], "/api/stats");
        assert_eq!(opentsdb_value["query"]["metric"], "http.requests");

        let opentsdb_repair_request = generated_operation_request(
            &connection,
            &opentsdb_manifest,
            "opentsdb.uid.repair",
            "http.requests",
            Some(&BTreeMap::from([
                ("metric".into(), json!("http.requests")),
                ("displayName".into(), json!("HTTP Requests")),
            ])),
        );
        let opentsdb_repair_value =
            serde_json::from_str::<serde_json::Value>(&opentsdb_repair_request).unwrap();
        assert_eq!(opentsdb_repair_value["operation"], "opentsdb.uid.repair");
        assert_eq!(
            opentsdb_repair_value["update"]["displayName"],
            "HTTP Requests"
        );
    }

    #[test]
    fn graph_operation_plans_use_native_request_shapes() {
        let connection = connection();
        let neo4j_manifest = manifest_for("neo4j", "graph", "cypher");
        let neptune_manifest = manifest_for("neptune", "graph", "gremlin");
        let neo4j_parameters = BTreeMap::from([
            ("label".into(), json!("Account")),
            ("propertyName".into(), json!("email")),
            ("indexName".into(), json!("account_email_lookup")),
            (
                "query".into(),
                json!("MATCH (n:`Account`) RETURN n LIMIT 25"),
            ),
        ]);

        let profile_request = generated_operation_request(
            &connection,
            &neo4j_manifest,
            "neo4j.query.profile",
            "Account",
            Some(&neo4j_parameters),
        );
        assert!(profile_request.starts_with("PROFILE MATCH (n:`Account`)"));

        let index_request = generated_operation_request(
            &connection,
            &neo4j_manifest,
            "neo4j.index.create",
            "Account",
            Some(&neo4j_parameters),
        );
        assert!(index_request.contains("CREATE INDEX account_email_lookup IF NOT EXISTS"));
        assert!(index_request.contains("FOR (n:Account) ON (n.email)"));

        let metrics_request = generated_operation_request(
            &connection,
            &neptune_manifest,
            "neptune.diagnostics.metrics",
            "analytics",
            None,
        );
        let metrics_value = serde_json::from_str::<serde_json::Value>(&metrics_request).unwrap();
        assert_eq!(metrics_value["operation"], "CloudWatch.GetMetricData");
        assert_eq!(metrics_value["namespace"], "AWS/Neptune");
    }

    #[test]
    fn warehouse_operation_plans_use_native_request_shapes() {
        let connection = connection();
        let snowflake_manifest = manifest_for("snowflake", "warehouse", "snowflake-sql");
        let bigquery_manifest = manifest_for("bigquery", "warehouse", "google-sql");
        let clickhouse_manifest = manifest_for("clickhouse", "warehouse", "clickhouse-sql");
        let query_parameters = BTreeMap::from([
            (
                "query".into(),
                json!("select * from \"ANALYTICS\".\"orders\" limit 100;"),
            ),
            ("schema".into(), json!("ANALYTICS")),
        ]);

        let snowflake_request = generated_operation_request(
            &connection,
            &snowflake_manifest,
            "snowflake.query.profile",
            "orders",
            Some(&query_parameters),
        );
        assert!(snowflake_request.contains("information_schema.query_history"));
        assert!(snowflake_request.contains("select * from \"ANALYTICS\".\"orders\" limit 100;"));

        let snowflake_clone_request = generated_operation_request(
            &connection,
            &snowflake_manifest,
            "snowflake.table.clone",
            "orders",
            Some(&BTreeMap::from([(
                "cloneName".into(),
                json!("orders_clone"),
            )])),
        );
        assert!(snowflake_clone_request.contains("CREATE TABLE"));
        assert!(snowflake_clone_request.contains("CLONE"));

        let bigquery_request = generated_operation_request(
            &connection,
            &bigquery_manifest,
            "bigquery.query.profile",
            "orders",
            Some(&BTreeMap::from([
                ("schema".into(), json!("analytics")),
                (
                    "query".into(),
                    json!("select * from `analytics.orders` limit 100;"),
                ),
            ])),
        );
        let bigquery_value = serde_json::from_str::<serde_json::Value>(&bigquery_request).unwrap();
        assert_eq!(bigquery_value["operation"], "BigQuery.Jobs.QueryDryRun");
        assert_eq!(bigquery_value["dryRun"], true);

        let bigquery_copy_request = generated_operation_request(
            &connection,
            &bigquery_manifest,
            "bigquery.table.copy",
            "orders",
            Some(&BTreeMap::from([(
                "destinationTable".into(),
                json!("orders_copy"),
            )])),
        );
        let bigquery_copy_value =
            serde_json::from_str::<serde_json::Value>(&bigquery_copy_request).unwrap();
        assert_eq!(bigquery_copy_value["operation"], "BigQuery.Tables.Copy");
        assert_eq!(bigquery_copy_value["destinationTable"], "orders_copy");

        let clickhouse_request = generated_operation_request(
            &connection,
            &clickhouse_manifest,
            "clickhouse.data.import-export",
            "orders",
            Some(&BTreeMap::from([("format".into(), json!("parquet"))])),
        );
        assert!(clickhouse_request.contains("INTO OUTFILE"));
        assert!(clickhouse_request.contains("FORMAT PARQUET"));

        let clickhouse_optimize_request = generated_operation_request(
            &connection,
            &clickhouse_manifest,
            "clickhouse.table.optimize",
            "orders",
            None,
        );
        assert!(clickhouse_optimize_request.contains("OPTIMIZE TABLE"));
        assert!(clickhouse_optimize_request.contains("FINAL"));

        let clickhouse_ttl_request = generated_operation_request(
            &connection,
            &clickhouse_manifest,
            "clickhouse.table.materialize-ttl",
            "orders",
            None,
        );
        assert!(clickhouse_ttl_request.contains("MATERIALIZE TTL"));

        let clickhouse_freeze_request = generated_operation_request(
            &connection,
            &clickhouse_manifest,
            "clickhouse.table.freeze",
            "orders",
            Some(&BTreeMap::from([(
                "snapshotName".into(),
                json!("orders'backup"),
            )])),
        );
        assert!(clickhouse_freeze_request.contains("FREEZE WITH NAME"));
        assert!(clickhouse_freeze_request.contains("orders\\'backup"));
    }

    #[test]
    fn document_and_cache_operation_plans_use_native_request_shapes() {
        let connection = connection();
        let cosmos_manifest = manifest_for("cosmosdb", "document", "json");
        let litedb_manifest = manifest_for("litedb", "document", "json");
        let memcached_manifest = manifest_for("memcached", "keyvalue", "text");
        let cosmos_parameters = BTreeMap::from([
            ("database".into(), json!("catalog")),
            ("container".into(), json!("products")),
            ("path".into(), json!("/*")),
        ]);
        let litedb_parameters = BTreeMap::from([
            ("databaseFile".into(), json!("catalog.db")),
            ("collection".into(), json!("products")),
            ("indexName".into(), json!("idx_products_sku")),
            ("field".into(), json!("sku")),
        ]);
        let memcached_parameters = BTreeMap::from([("classId".into(), json!("2"))]);

        let cosmos_request = generated_operation_request(
            &connection,
            &cosmos_manifest,
            "cosmosdb.index.create",
            "catalog/products",
            Some(&cosmos_parameters),
        );
        let cosmos_value = serde_json::from_str::<serde_json::Value>(&cosmos_request).unwrap();
        assert_eq!(cosmos_value["method"], "PATCH");
        assert_eq!(cosmos_value["path"], "/dbs/catalog/colls/products");
        assert_eq!(
            cosmos_value["body"]["indexingPolicy"]["includedPaths"][0]["path"],
            "/*"
        );

        let cosmos_throughput_request = generated_operation_request(
            &connection,
            &cosmos_manifest,
            "cosmosdb.throughput.update",
            "catalog/products",
            Some(&BTreeMap::from([
                ("database".into(), json!("catalog")),
                ("container".into(), json!("products")),
                ("mode".into(), json!("autoscale")),
                ("maxRuPerSecond".into(), json!(4000)),
            ])),
        );
        let cosmos_throughput_value =
            serde_json::from_str::<serde_json::Value>(&cosmos_throughput_request).unwrap();
        assert_eq!(
            cosmos_throughput_value["operation"],
            "CosmosDB.ReplaceOffer"
        );
        assert_eq!(
            cosmos_throughput_value["throughputParameters"]["autoscaleSettings"]["maxThroughput"],
            4000
        );

        let cosmos_consistency_request = generated_operation_request(
            &connection,
            &cosmos_manifest,
            "cosmosdb.consistency.update",
            "catalog-account",
            Some(&BTreeMap::from([
                ("account".into(), json!("catalog-account")),
                ("consistencyLevel".into(), json!("Session")),
            ])),
        );
        let cosmos_consistency_value =
            serde_json::from_str::<serde_json::Value>(&cosmos_consistency_request).unwrap();
        assert_eq!(
            cosmos_consistency_value["operation"],
            "CosmosDB.UpdateAccountConsistency"
        );
        assert_eq!(
            cosmos_consistency_value["consistencyPolicy"]["defaultConsistencyLevel"],
            "Session"
        );

        let litedb_request = generated_operation_request(
            &connection,
            &litedb_manifest,
            "litedb.index.create",
            "products",
            Some(&litedb_parameters),
        );
        assert!(litedb_request.contains("EnsureIndex"));
        assert!(litedb_request.contains("idx_products_sku"));

        let litedb_compact_request = generated_operation_request(
            &connection,
            &litedb_manifest,
            "litedb.storage.compact",
            "catalog.db",
            Some(&BTreeMap::from([(
                "databaseFile".into(),
                json!("catalog.db"),
            )])),
        );
        let litedb_compact_value =
            serde_json::from_str::<serde_json::Value>(&litedb_compact_request).unwrap();
        assert_eq!(litedb_compact_value["operation"], "LiteDB.Compact");
        assert_eq!(litedb_compact_value["databaseFile"], "catalog.db");

        let litedb_rebuild_request = generated_operation_request(
            &connection,
            &litedb_manifest,
            "litedb.storage.rebuild-indexes",
            "products",
            Some(&litedb_parameters),
        );
        let litedb_rebuild_value =
            serde_json::from_str::<serde_json::Value>(&litedb_rebuild_request).unwrap();
        assert_eq!(litedb_rebuild_value["operation"], "LiteDB.RebuildIndexes");
        assert_eq!(litedb_rebuild_value["collection"], "products");

        let memcached_request = generated_operation_request(
            &connection,
            &memcached_manifest,
            "memcached.data.import-export",
            "class:2",
            Some(&memcached_parameters),
        );
        assert!(memcached_request.contains("lru_crawler metadump 2"));

        let memcached_flush_request = generated_operation_request(
            &connection,
            &memcached_manifest,
            "memcached.cache.flush",
            "server",
            Some(&BTreeMap::from([("delaySeconds".into(), json!(5))])),
        );
        assert!(memcached_flush_request.contains("flush_all 5"));

        let memcached_set_request = generated_operation_request(
            &connection,
            &memcached_manifest,
            "memcached.key.set",
            "session:1",
            Some(&BTreeMap::from([
                ("key".into(), json!("session:1")),
                ("value".into(), json!("cached-user")),
                ("ttlSeconds".into(), json!(60)),
            ])),
        );
        assert!(memcached_set_request.contains("set session:1 0 60 11"));
        assert!(memcached_set_request.contains("cached-user"));

        let memcached_delete_request = generated_operation_request(
            &connection,
            &memcached_manifest,
            "memcached.key.delete",
            "session:1",
            Some(&BTreeMap::from([("key".into(), json!("session:1"))])),
        );
        assert_eq!(memcached_delete_request, "delete session:1");
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-mongo".into(),
            name: "MongoDB".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            host: "localhost".into(),
            port: Some(27017),
            database: Some("catalog".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }

    fn manifest() -> AdapterManifest {
        manifest_for("mongodb", "document", "mongodb")
    }

    fn manifest_for(engine: &str, family: &str, default_language: &str) -> AdapterManifest {
        AdapterManifest {
            id: format!("adapter-{engine}"),
            engine: engine.into(),
            family: family.into(),
            label: engine.into(),
            maturity: "stable".into(),
            capabilities: vec!["supports_import_export".into()],
            default_language: default_language.into(),
            local_database: None,
            tree: None,
        }
    }
}
