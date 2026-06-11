use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    Client, Database,
};
use serde_json::json;

use super::super::super::*;
use super::bson_extjson::mongodb_document_to_json;
use super::connection::{mongodb_client, mongodb_database_name};
use super::MongoDbAdapter;
use crate::domain::error::mongodb_error_summary;

pub(super) async fn collect_mongodb_diagnostics(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = MongoDbAdapter.manifest();
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let client = mongodb_client(connection).await?;
    let database_name = mongodb_database_name(connection);
    let mut metrics = Vec::new();
    let mut warnings = Vec::new();

    match client
        .database("admin")
        .run_command(doc! { "serverStatus": 1 })
        .await
    {
        Ok(status) => append_server_status_metrics(&mut metrics, &status),
        Err(error) => warnings.push(format!(
            "MongoDB serverStatus metrics are unavailable for this connection: {}",
            mongodb_error_summary(&error)
        )),
    }

    match client
        .database(&database_name)
        .run_command(doc! { "dbStats": 1, "scale": 1 })
        .await
    {
        Ok(stats) => append_db_stats_metrics(&mut metrics, &database_name, &stats),
        Err(error) => warnings.push(format!(
            "MongoDB dbStats metrics are unavailable for database `{database_name}`: {}",
            mongodb_error_summary(&error)
        )),
    }

    append_mongodb_deep_diagnostics(
        &mut diagnostics,
        &client,
        &database_name,
        scope,
        &mut metrics,
        &mut warnings,
    )
    .await;

    if metrics.is_empty() {
        warnings.push(
            "MongoDB connected, but no metrics could be collected with the current permissions."
                .into(),
        );
    } else {
        let timestamp = crate::app::runtime::timestamp_now();
        diagnostics.metrics.push(payload_metrics(json!(metrics)));
        diagnostics
            .metrics
            .push(payload_metric_series(&metrics, &timestamp));
        diagnostics.metrics.push(payload_metric_bar_chart(
            &metrics,
            "MongoDB activity and storage",
        ));
    }

    diagnostics.warnings.extend(warnings);
    Ok(diagnostics)
}

async fn append_mongodb_deep_diagnostics(
    diagnostics: &mut AdapterDiagnostics,
    client: &Client,
    database_name: &str,
    scope: Option<&str>,
    metrics: &mut Vec<serde_json::Value>,
    warnings: &mut Vec<String>,
) {
    let admin = client.database("admin");
    let database = client.database(database_name);

    append_profiler_status(diagnostics, &database, database_name, warnings).await;
    append_recent_profiler_entries(diagnostics, &database, database_name, metrics, warnings).await;
    append_admin_command_payload(
        diagnostics,
        metrics,
        warnings,
        &admin,
        "currentOp",
        doc! { "currentOp": 1, "$all": true },
    )
    .await;
    append_admin_command_payload(
        diagnostics,
        metrics,
        warnings,
        &admin,
        "replSetGetStatus",
        doc! { "replSetGetStatus": 1 },
    )
    .await;
    append_admin_command_payload(
        diagnostics,
        metrics,
        warnings,
        &admin,
        "shardingState",
        doc! { "shardingState": 1 },
    )
    .await;

    if let Some((database_name, collection_name)) =
        mongodb_diagnostic_collection_scope(scope, database_name)
    {
        append_index_stats(
            diagnostics,
            client,
            &database_name,
            &collection_name,
            metrics,
            warnings,
        )
        .await;
    }
}

async fn append_profiler_status(
    diagnostics: &mut AdapterDiagnostics,
    database: &Database,
    database_name: &str,
    warnings: &mut Vec<String>,
) {
    match database.run_command(doc! { "profile": -1 }).await {
        Ok(status) => diagnostics.profiles.push(payload_profile(
            "MongoDB profiler status",
            json!([{
                "name": "profiler-status",
                "database": database_name,
                "details": mongodb_document_to_json(&status),
            }]),
        )),
        Err(error) => warnings.push(format!(
            "MongoDB profiler status is unavailable for database `{database_name}`: {}",
            mongodb_error_summary(&error)
        )),
    }
}

async fn append_recent_profiler_entries(
    diagnostics: &mut AdapterDiagnostics,
    database: &Database,
    database_name: &str,
    metrics: &mut Vec<serde_json::Value>,
    warnings: &mut Vec<String>,
) {
    let collection = database.collection::<Document>("system.profile");
    match collection
        .find(doc! {})
        .sort(doc! { "ts": -1 })
        .limit(20)
        .await
    {
        Ok(cursor) => match cursor.try_collect::<Vec<Document>>().await {
            Ok(entries) => {
                metrics.push(metric(
                    "mongodb.profiler_recent_entries",
                    entries.len() as f64,
                    "entries",
                    json!({ "database": database_name, "source": "system.profile" }),
                ));
                diagnostics.profiles.push(payload_profile(
                    "Recent MongoDB profiler entries",
                    json!(entries
                        .into_iter()
                        .map(|entry| json!({
                            "name": entry
                                .get_str("op")
                                .unwrap_or("operation"),
                            "database": database_name,
                            "details": mongodb_document_to_json(&entry),
                        }))
                        .collect::<Vec<_>>()),
                ));
            }
            Err(error) => warnings.push(format!(
                "MongoDB profiler entries are unavailable for database `{database_name}`: {}",
                mongodb_error_summary(&error)
            )),
        },
        Err(error) => warnings.push(format!(
            "MongoDB profiler collection is unavailable for database `{database_name}`: {}",
            mongodb_error_summary(&error)
        )),
    }
}

async fn append_admin_command_payload(
    diagnostics: &mut AdapterDiagnostics,
    metrics: &mut Vec<serde_json::Value>,
    warnings: &mut Vec<String>,
    admin: &Database,
    name: &str,
    command: Document,
) {
    let command_preview = command.clone();
    match admin.run_command(command).await {
        Ok(result) => {
            append_admin_command_metrics(metrics, name, &result);
            diagnostics
                .profiles
                .push(mongodb_admin_command_profile(name, &result));
            diagnostics.query_history.push(payload_json(json!({
                "kind": name,
                "command": mongodb_document_to_json(&command_preview),
                "result": mongodb_document_to_json(&result),
            })));
        }
        Err(error) => warnings.push(format!(
            "MongoDB {name} diagnostics are unavailable: {}",
            mongodb_error_summary(&error)
        )),
    }
}

fn append_admin_command_metrics(
    metrics: &mut Vec<serde_json::Value>,
    command_name: &str,
    result: &Document,
) {
    if command_name == "currentOp" {
        if let Ok(operations) = result.get_array("inprog") {
            metrics.push(metric(
                "mongodb.current_operations",
                operations.len() as f64,
                "operations",
                json!({ "source": "currentOp" }),
            ));
        }
    }

    if command_name == "replSetGetStatus" {
        if let Some(value) = bson_number(result.get("myState")) {
            metrics.push(metric(
                "mongodb.replica_state",
                value,
                "state",
                json!({ "source": "replSetGetStatus" }),
            ));
        }
    }

    if command_name == "shardingState" {
        if let Ok(enabled) = result.get_bool("enabled") {
            metrics.push(metric(
                "mongodb.sharding_enabled",
                if enabled { 1.0 } else { 0.0 },
                "boolean",
                json!({ "source": "shardingState" }),
            ));
        }
    }
}

fn mongodb_admin_command_profile(command_name: &str, result: &Document) -> serde_json::Value {
    let summary = match command_name {
        "currentOp" => "MongoDB current operations",
        "replSetGetStatus" => "MongoDB replica set status",
        "shardingState" => "MongoDB sharding state",
        _ => "MongoDB admin command diagnostics",
    };

    payload_profile(
        summary,
        mongodb_admin_command_profile_stages(command_name, result),
    )
}

fn mongodb_admin_command_profile_stages(
    command_name: &str,
    result: &Document,
) -> serde_json::Value {
    if command_name == "currentOp" {
        if let Ok(operations) = result.get_array("inprog") {
            return json!(operations
                .iter()
                .take(50)
                .enumerate()
                .map(|(index, operation)| {
                    let details = operation.as_document().cloned().unwrap_or_default();
                    json!({
                        "name": details
                            .get_str("op")
                            .unwrap_or("operation"),
                        "rows": details
                            .get_i64("numYields")
                            .ok()
                            .or_else(|| details.get_i32("numYields").ok().map(i64::from)),
                        "details": {
                            "index": index,
                            "namespace": details.get_str("ns").unwrap_or(""),
                            "active": details.get_bool("active").unwrap_or(false),
                            "secsRunning": details
                                .get_i64("secs_running")
                                .ok()
                                .or_else(|| details.get_i32("secs_running").ok().map(i64::from)),
                            "raw": mongodb_document_to_json(&details)
                        }
                    })
                })
                .collect::<Vec<_>>());
        }
    }

    if command_name == "replSetGetStatus" {
        if let Ok(members) = result.get_array("members") {
            return json!(members
                .iter()
                .take(50)
                .enumerate()
                .map(|(index, member)| {
                    let details = member.as_document().cloned().unwrap_or_default();
                    json!({
                        "name": details
                            .get_str("name")
                            .unwrap_or("member"),
                        "rows": details
                            .get_i32("state")
                            .ok()
                            .map(i64::from),
                        "details": {
                            "index": index,
                            "state": details.get_str("stateStr").unwrap_or("unknown"),
                            "health": details.get_i32("health").unwrap_or_default(),
                            "raw": mongodb_document_to_json(&details)
                        }
                    })
                })
                .collect::<Vec<_>>());
        }
    }

    if command_name == "shardingState" {
        return json!([{
            "name": if result.get_bool("enabled").unwrap_or(false) {
                "sharding-enabled"
            } else {
                "sharding-disabled"
            },
            "rows": result
                .get_bool("enabled")
                .ok()
                .map(|enabled| if enabled { 1 } else { 0 }),
            "details": mongodb_document_to_json(result)
        }]);
    }

    json!([{
        "name": command_name,
        "details": mongodb_document_to_json(result),
    }])
}

async fn append_index_stats(
    diagnostics: &mut AdapterDiagnostics,
    client: &Client,
    database_name: &str,
    collection_name: &str,
    metrics: &mut Vec<serde_json::Value>,
    warnings: &mut Vec<String>,
) {
    let collection = client
        .database(database_name)
        .collection::<Document>(collection_name);
    match collection.aggregate(vec![doc! { "$indexStats": {} }]).await {
        Ok(cursor) => match cursor.try_collect::<Vec<Document>>().await {
            Ok(indexes) => {
                metrics.push(metric(
                    "mongodb.index_stats_count",
                    indexes.len() as f64,
                    "indexes",
                    json!({
                        "database": database_name,
                        "collection": collection_name,
                        "source": "$indexStats"
                    }),
                ));
                diagnostics.profiles.push(payload_profile(
                    "MongoDB index usage statistics",
                    json!(indexes
                        .into_iter()
                        .map(|index| json!({
                            "name": index
                                .get_str("name")
                                .unwrap_or("index"),
                            "database": database_name,
                            "collection": collection_name,
                            "details": mongodb_document_to_json(&index),
                        }))
                        .collect::<Vec<_>>()),
                ));
            }
            Err(error) => warnings.push(format!(
                "MongoDB index statistics are unavailable for `{database_name}.{collection_name}`: {}",
                mongodb_error_summary(&error)
            )),
        },
        Err(error) => warnings.push(format!(
            "MongoDB index statistics are unavailable for `{database_name}.{collection_name}`: {}",
            mongodb_error_summary(&error)
        )),
    }
}

fn mongodb_diagnostic_collection_scope(
    scope: Option<&str>,
    fallback_database: &str,
) -> Option<(String, String)> {
    let scope = scope?;
    for prefix in [
        "collection:",
        "documents:",
        "indexes:",
        "collection-statistics:",
    ] {
        if let Some(rest) = scope.strip_prefix(prefix) {
            return Some(split_database_collection_scope(rest, fallback_database));
        }
    }
    None
}

fn split_database_collection_scope(value: &str, fallback_database: &str) -> (String, String) {
    if let Some((database, collection)) = value.split_once('.') {
        if !database.trim().is_empty() && !collection.trim().is_empty() {
            return (database.trim().into(), collection.trim().into());
        }
    }

    (fallback_database.into(), value.trim().into())
}

fn append_server_status_metrics(metrics: &mut Vec<serde_json::Value>, status: &Document) {
    if let Ok(connections) = status.get_document("connections") {
        push_document_metric(
            metrics,
            "mongodb.connections_current",
            connections,
            "current",
            "connections",
            json!({ "source": "serverStatus.connections" }),
        );
        push_document_metric(
            metrics,
            "mongodb.connections_available",
            connections,
            "available",
            "connections",
            json!({ "source": "serverStatus.connections" }),
        );
    }

    if let Ok(opcounters) = status.get_document("opcounters") {
        for (field, name) in [
            ("query", "mongodb.opcounters_query"),
            ("insert", "mongodb.opcounters_insert"),
            ("update", "mongodb.opcounters_update"),
            ("delete", "mongodb.opcounters_delete"),
            ("command", "mongodb.opcounters_command"),
        ] {
            push_document_metric(
                metrics,
                name,
                opcounters,
                field,
                "ops",
                json!({ "source": "serverStatus.opcounters" }),
            );
        }
    }

    if let Ok(memory) = status.get_document("mem") {
        push_document_metric(
            metrics,
            "mongodb.memory_resident",
            memory,
            "resident",
            "MB",
            json!({ "source": "serverStatus.mem" }),
        );
        push_document_metric(
            metrics,
            "mongodb.memory_virtual",
            memory,
            "virtual",
            "MB",
            json!({ "source": "serverStatus.mem" }),
        );
    }

    if let Ok(network) = status.get_document("network") {
        push_document_metric(
            metrics,
            "mongodb.network_bytes_in",
            network,
            "bytesIn",
            "bytes",
            json!({ "source": "serverStatus.network" }),
        );
        push_document_metric(
            metrics,
            "mongodb.network_bytes_out",
            network,
            "bytesOut",
            "bytes",
            json!({ "source": "serverStatus.network" }),
        );
    }
}

fn append_db_stats_metrics(metrics: &mut Vec<serde_json::Value>, database: &str, stats: &Document) {
    for (field, name, unit) in [
        ("collections", "mongodb.collections", "collections"),
        ("objects", "mongodb.objects", "documents"),
        ("dataSize", "mongodb.data_size", "bytes"),
        ("storageSize", "mongodb.storage_size", "bytes"),
        ("indexes", "mongodb.index_count", "indexes"),
        ("indexSize", "mongodb.index_size", "bytes"),
        ("avgObjSize", "mongodb.average_document_size", "bytes"),
    ] {
        push_document_metric(
            metrics,
            name,
            stats,
            field,
            unit,
            json!({ "database": database, "source": "dbStats" }),
        );
    }
}

fn push_document_metric(
    metrics: &mut Vec<serde_json::Value>,
    name: &str,
    document: &Document,
    field: &str,
    unit: &str,
    labels: serde_json::Value,
) {
    if let Some(value) = bson_number(document.get(field)) {
        metrics.push(metric(name, value, unit, labels));
    }
}

fn bson_number(value: Option<&Bson>) -> Option<f64> {
    match value? {
        Bson::Int32(value) => Some(f64::from(*value)),
        Bson::Int64(value) => Some(*value as f64),
        Bson::Double(value) => Some(*value),
        Bson::Decimal128(value) => value.to_string().parse::<f64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/diagnostics_tests.rs"]
mod tests;
