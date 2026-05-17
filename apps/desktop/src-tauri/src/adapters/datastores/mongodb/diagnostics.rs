use mongodb::bson::{doc, Bson, Document};
use serde_json::json;

use super::super::super::*;
use super::connection::{mongodb_client, mongodb_database_name};
use super::MongoDbAdapter;

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
            "MongoDB serverStatus metrics are unavailable for this connection: {error}"
        )),
    }

    match client
        .database(&database_name)
        .run_command(doc! { "dbStats": 1, "scale": 1 })
        .await
    {
        Ok(stats) => append_db_stats_metrics(&mut metrics, &database_name, &stats),
        Err(error) => warnings.push(format!(
            "MongoDB dbStats metrics are unavailable for database `{database_name}`: {error}"
        )),
    }

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
mod tests {
    use mongodb::bson::doc;

    use super::{append_db_stats_metrics, bson_number};

    #[test]
    fn extracts_numeric_mongodb_stats() {
        let stats = doc! {
            "collections": 2,
            "objects": 12_i64,
            "dataSize": 128.0,
            "storageSize": 256_i64,
        };
        let mut metrics = Vec::new();

        append_db_stats_metrics(&mut metrics, "catalog", &stats);

        assert!(metrics
            .iter()
            .any(|item| item["name"] == "mongodb.collections"));
        assert!(metrics
            .iter()
            .any(|item| item["name"] == "mongodb.data_size"));
        assert_eq!(bson_number(stats.get("objects")), Some(12.0));
    }
}
