use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend_duckdb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    if manifest.engine == "duckdb" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.analyze",
                "Analyze Table",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview refreshing DuckDB statistics for a table or view.",
                true,
            ),
            operation_manifest(
                manifest,
                "database.analyze",
                "Analyze Database",
                "database",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview refreshing DuckDB planner statistics for the local database.",
                true,
            ),
            operation_manifest(
                manifest,
                "database.checkpoint",
                "Checkpoint",
                "database",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview checkpointing the local DuckDB database file.",
                true,
            ),
            operation_manifest(
                manifest,
                "extension.install",
                "Install Extension",
                "extension",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview installing a DuckDB extension.",
                true,
            ),
            operation_manifest(
                manifest,
                "extension.load",
                "Load Extension",
                "extension",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview loading a DuckDB extension into the current session.",
                true,
            ),
        ]);
    }

    if manifest.engine == "duckdb" && manifest_has(manifest, "supports_import_export") {
        operations.push(operation_manifest(
            manifest,
            "file.import",
            "Import File",
            "table",
            "write",
            &["supports_import_export"],
            &["diff", "table", "raw"],
            "Preview creating a DuckDB table from a selected CSV, JSON, or Parquet file.",
            true,
        ));
    }
}

pub(super) fn extend_litedb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    if manifest.engine == "litedb" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
                operation_manifest(
                    manifest,
                    "storage.checkpoint",
                    "Checkpoint",
                    "database",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview persisting pending LiteDB pages before local-file maintenance.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "storage.compact",
                    "Compact File",
                    "database",
                    "costly",
                    &["supports_admin_operations"],
                    &["diff", "metrics", "raw"],
                    "Preview a guarded LiteDB compaction workflow that validates the compacted copy.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "storage.rebuild-indexes",
                    "Rebuild Indexes",
                    "collection",
                    "costly",
                    &["supports_admin_operations", "supports_index_management"],
                    &["diff", "metrics", "raw"],
                    "Preview rebuilding LiteDB collection indexes after file and lock checks.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "file-storage.import",
                    "Import Stored File",
                    "file",
                    "write",
                    &["supports_admin_operations", "supports_import_export"],
                    &["diff", "json", "raw"],
                    "Run a guarded LiteDB file-storage upload from a concrete local file through the configured sidecar.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "file-storage.export",
                    "Export Stored File",
                    "file",
                    "costly",
                    &["supports_import_export"],
                    &["json", "raw"],
                    "Run a guarded LiteDB file-storage download to a concrete local target through the configured sidecar.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "file-storage.delete",
                    "Delete Stored File",
                    "file",
                    "destructive",
                    &["supports_admin_operations"],
                    &["diff", "json", "raw"],
                    "Run a guarded LiteDB file-storage delete through the configured sidecar with before/after evidence.",
                    true,
                ),
            ]);
    }
}

pub(super) fn finalize_litedb(
    manifest: &AdapterManifest,
    operations: &mut [DatastoreOperationManifest],
) {
    if manifest.engine == "litedb" {
        for operation in operations.iter_mut() {
            if matches!(
                operation.id.as_str(),
                "litedb.index.create"
                    | "litedb.index.drop"
                    | "litedb.object.drop"
                    | "litedb.file-storage.import"
                    | "litedb.file-storage.export"
                    | "litedb.file-storage.delete"
            ) {
                operation.execution_support = "live".into();
                operation.disabled_reason = None;
                operation.preview_only =
                    Some(matches!(operation.risk.as_str(), "write" | "destructive"));
                if operation.id.contains("file-storage") {
                    operation.description =
                            "Run guarded LiteDB file-storage import, export, or delete through the configured sidecar with before/after evidence."
                                .into();
                } else {
                    operation.description =
                            "Run guarded LiteDB index or collection management through the configured sidecar with before/after evidence."
                                .into();
                }
            }
        }
    }
}

pub(super) fn customize_import_export(
    manifest: &AdapterManifest,
    operation: &mut DatastoreOperationManifest,
) {
    if manifest.engine == "litedb" {
        operation.execution_support = "live".into();
        operation.disabled_reason = None;
        operation.preview_only = Some(false);
        operation.description =
            "Run guarded LiteDB JSON/NDJSON collection export or insert-only import through the configured sidecar file workflow."
                .into();
    }
}
