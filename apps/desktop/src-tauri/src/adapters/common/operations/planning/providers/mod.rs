mod cosmos;
mod document;
mod duckdb;
mod graph;
mod keyvalue;
mod litedb;
mod memcached;
mod mysql;
mod oracle;
mod postgres;
mod search;
mod sqlite;
mod sqlserver;
mod timeseries;
mod warehouse;
mod widecolumn;

use super::*;
use cosmos::*;
use document::*;
use duckdb::*;
use graph::*;
use keyvalue::*;
use litedb::*;
use memcached::*;
use mysql::*;
use oracle::*;
use postgres::*;
use search::*;
use sqlite::*;
use sqlserver::*;
use timeseries::*;
use warehouse::*;
use widecolumn::*;

pub(super) fn generated_operation_request(
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
