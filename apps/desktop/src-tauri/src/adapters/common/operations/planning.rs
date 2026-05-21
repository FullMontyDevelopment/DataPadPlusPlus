use std::collections::BTreeMap;

use serde_json::Value;

use crate::domain::models::{AdapterManifest, OperationPlan, ResolvedConnectionProfile};

pub(crate) fn default_object_name(manifest: &AdapterManifest, provided: Option<&str>) -> String {
    provided
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| match manifest.family.as_str() {
            "document" => "sample_collection".into(),
            "keyvalue" => "sample:key".into(),
            "graph" => "SampleLabel".into(),
            "timeseries" => "sample_measurement".into(),
            "widecolumn" => "sample_table".into(),
            "search" => "sample-index".into(),
            "warehouse" | "embedded-olap" | "sql" => "public.sample_table".into(),
            _ => "sample_object".into(),
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
            if manifest.engine == "oracle" {
                return oracle_operation_request(operation_id, object_name, &parameter_json);
            }

            if manifest.engine == "sqlserver" {
                return sqlserver_operation_request(operation_id, object_name, &parameter_json);
            }

            if manifest.engine == "sqlite" {
                return sqlite_operation_request(operation_id, object_name, &parameter_json);
            }

            if operation_id.ends_with("index.create") {
                return format!("create index idx_sample on {object_name} (id);");
            }

            if operation_id.ends_with("index.drop") {
                return "drop index idx_sample;".into();
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
        "document" => document_operation_request(operation_id, object_name, &parameter_json, parameters),
        "keyvalue" => match operation_id.rsplit('.').next().unwrap_or(operation_id) {
            "refresh" | "execute" => format!("SCAN 0 MATCH {object_name}* COUNT 100"),
            "metrics" => "INFO\nSLOWLOG GET 20".into(),
            _ => format!("# {operation_id}\n# parameters:\n{parameter_json}"),
        },
        "graph" => match manifest.default_language.as_str() {
            "cypher" => format!("MATCH (n) RETURN n LIMIT 100\n// {operation_id} {object_name}"),
            "aql" => format!("FOR doc IN {object_name} LIMIT 100 RETURN doc"),
            _ => format!("g.V().limit(100) // {operation_id} {object_name}"),
        },
        "search" => format!(
            "{{\n  \"index\": \"{object_name}\",\n  \"body\": {{\n    \"query\": {{ \"match_all\": {{}} }},\n    \"size\": 100\n  }},\n  \"operation\": \"{operation_id}\"\n}}"
        ),
        "widecolumn" => match manifest.default_language.as_str() {
            "cql" => format!("select * from {object_name} limit 100;"),
            _ => format!("{{\n  \"TableName\": \"{object_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\"\n}}"),
        },
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

    if operation_id.ends_with("user.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "database": database,
            "createUser": principal_name,
            "pwd": "<secret>",
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

    if operation_id.contains("vacuum") {
        return "-- Review file path and locks before running.\nvacuum;\n-- Or compact into a new file:\n-- vacuum into 'compact.sqlite';".into();
    }

    if operation_id.contains("backup") {
        return "-- SQLite backup/export plan.\n-- Use VACUUM INTO for a compact copy or the backup API for online snapshots.\nvacuum into 'backup.sqlite';".into();
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

fn sqlserver_operation_request(
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
) -> String {
    if operation_id.ends_with("index.create") {
        return format!(
            "create index [IX_{}_id] on {object_name} ([id]);",
            safe_sqlserver_name(object_name)
        );
    }

    if operation_id.ends_with("index.drop") {
        return "-- Review before running.\ndrop index [IX_name] on [schema].[table];".into();
    }

    if operation_id.ends_with("index.rebuild") {
        return "alter index [IX_name] on [schema].[table] rebuild with (online = on);".into();
    }

    if operation_id.ends_with("index.reorganize") {
        return "alter index [IX_name] on [schema].[table] reorganize;".into();
    }

    if operation_id.ends_with("index.disable") {
        return "-- Review carefully before disabling an index.\nalter index [IX_name] on [schema].[table] disable;".into();
    }

    if operation_id.ends_with("query-store") || operation_id.contains("query-store") {
        return "select top 50\n  qsq.query_id,\n  qsp.plan_id,\n  rs.avg_duration,\n  rs.count_executions\nfrom sys.query_store_query qsq\njoin sys.query_store_plan qsp on qsq.query_id = qsp.query_id\njoin sys.query_store_runtime_stats rs on qsp.plan_id = rs.plan_id\norder by rs.avg_duration desc;".into();
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

pub(crate) fn default_operation_plan(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let object_name = default_object_name(manifest, object_name);
    let destructive = operation_id.contains(".drop") || operation_id.contains("backup-restore");
    let admin_write = operation_id.contains(".create")
        || operation_id.contains(".update")
        || operation_id.contains(".hide")
        || operation_id.contains(".unhide")
        || operation_id.contains(".user.")
        || operation_id.contains(".role.")
        || (operation_id.contains(".security.") && !operation_id.ends_with("security.inspect"))
        || operation_id.contains("validation")
        || operation_id.contains("validator")
        || operation_id.contains("import-export")
        || operation_id.contains("backup-restore");
    let costly = destructive
        || admin_write
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
