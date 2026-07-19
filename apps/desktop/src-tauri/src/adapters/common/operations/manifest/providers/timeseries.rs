use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend(manifest: &AdapterManifest, operations: &mut Vec<DatastoreOperationManifest>) {
    if manifest.engine == "prometheus" && manifest_has(manifest, "supports_metrics_collection") {
        operations.push(operation_manifest(
            manifest,
            "cardinality.analyze",
            "Analyze Cardinality",
            "query",
            "costly",
            &["supports_metrics_collection"],
            &["metrics", "series", "table", "json"],
            "Preview a bounded Prometheus series-cardinality analysis request.",
            true,
        ));
    }

    if manifest.engine == "influxdb" && manifest_has(manifest, "supports_admin_operations") {
        operations.push(operation_manifest(
            manifest,
            "retention.update",
            "Update Retention",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "metrics", "raw"],
            "Preview a guarded InfluxDB bucket retention-policy update.",
            true,
        ));
    }

    if manifest.engine == "opentsdb" && manifest_has(manifest, "supports_admin_operations") {
        operations.push(operation_manifest(
            manifest,
            "uid.repair",
            "Repair UID Metadata",
            "schema",
            "write",
            &["supports_admin_operations"],
            &["diff", "metrics", "raw"],
            "Preview a guarded OpenTSDB UID metadata repair workflow.",
            true,
        ));
    }
}
