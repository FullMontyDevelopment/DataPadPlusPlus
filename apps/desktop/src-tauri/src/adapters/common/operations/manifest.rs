use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(crate) fn manifest_has(manifest: &AdapterManifest, capability: &str) -> bool {
    manifest.capabilities.iter().any(|item| item == capability)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn operation_manifest(
    manifest: &AdapterManifest,
    suffix: &str,
    label: &str,
    scope: &str,
    risk: &str,
    required_capabilities: &[&str],
    supported_renderers: &[&str],
    description: &str,
    requires_confirmation: bool,
) -> DatastoreOperationManifest {
    let preview_only = manifest.maturity == "beta";
    let live_safe = matches!(risk, "read" | "diagnostic") && !preview_only;
    let execution_support = if live_safe { "live" } else { "plan-only" };
    let disabled_reason = if preview_only {
        Some("Beta adapters expose generated operation plans before live execution.".into())
    } else if live_safe {
        None
    } else {
        Some(
            "This operation needs an adapter-specific live executor before it can run safely."
                .into(),
        )
    };

    DatastoreOperationManifest {
        id: format!("{}.{}", manifest.engine, suffix),
        engine: manifest.engine.clone(),
        family: manifest.family.clone(),
        label: label.into(),
        scope: scope.into(),
        risk: risk.into(),
        required_capabilities: required_capabilities
            .iter()
            .map(|item| (*item).to_string())
            .collect(),
        supported_renderers: supported_renderers
            .iter()
            .map(|item| (*item).to_string())
            .collect(),
        description: description.into(),
        requires_confirmation,
        execution_support: execution_support.into(),
        disabled_reason,
        preview_only: Some(preview_only),
    }
}

pub(crate) fn operation_manifests_for_manifest(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = vec![
        operation_manifest(
            manifest,
            "metadata.refresh",
            "Refresh Metadata",
            "connection",
            "read",
            &["supports_schema_browser"],
            &["schema", "table", "json"],
            "Load databases, schemas, collections, keys, or engine-specific object metadata.",
            false,
        ),
        operation_manifest(
            manifest,
            "query.execute",
            "Execute Query",
            "query",
            "read",
            &["supports_result_snapshots"],
            &[
                "table",
                "json",
                "document",
                "keyvalue",
                "graph",
                "series",
                "searchHits",
                "raw",
            ],
            "Run a read-oriented query through the native adapter and normalize the returned payloads.",
            false,
        ),
    ];

    if manifest_has(manifest, "supports_explain_plan") {
        operations.push(operation_manifest(
            manifest,
            "query.explain",
            "View Execution Plan",
            "query",
            "diagnostic",
            &["supports_explain_plan", "supports_plan_visualization"],
            &["plan", "table", "json", "raw"],
            "Generate a query plan without changing data where the engine supports non-executing explain.",
            false,
        ));
    }

    if manifest_has(manifest, "supports_query_profile") {
        operations.push(operation_manifest(
            manifest,
            "query.profile",
            "Profile Query",
            "query",
            "costly",
            &["supports_query_profile"],
            &["profile", "plan", "metrics", "table"],
            "Collect profiling details; engines that execute the query require confirmation first.",
            true,
        ));
    }

    if manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "object.create",
                "Create Object",
                "schema",
                "write",
                &["supports_admin_operations"],
                &["schema", "diff", "raw"],
                "Create a table, collection, bucket, indexable object, or engine-native container.",
                true,
            ),
            operation_manifest(
                manifest,
                "object.drop",
                "Drop Object",
                "schema",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Drop or delete an object after permission checks and explicit confirmation.",
                true,
            ),
        ]);
    }

    if manifest_has(manifest, "supports_index_management") {
        operations.extend([
            operation_manifest(
                manifest,
                "index.create",
                "Create Index",
                "index",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Create an engine-native index, search mapping, graph index, or secondary access path.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.drop",
                "Drop Index",
                "index",
                "destructive",
                &["supports_index_management"],
                &["diff", "raw"],
                "Drop an index or access path after previewing the exact generated request.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.hide",
                "Hide Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Hide an index from the query planner without dropping it.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.unhide",
                "Unhide Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Make a hidden index visible to the query planner again.",
                true,
            ),
        ]);
    }

    if manifest.family == "search" && manifest_has(manifest, "supports_index_management") {
        operations.extend([
            operation_manifest(
                manifest,
                "index.force-merge",
                "Force Merge",
                "index",
                "costly",
                &["supports_index_management"],
                &["profile", "metrics", "raw"],
                "Preview a guarded Lucene segment force-merge request.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.clear-cache",
                "Clear Cache",
                "index",
                "diagnostic",
                &["supports_index_management"],
                &["metrics", "raw"],
                "Preview clearing index-level query/request caches.",
                false,
            ),
            operation_manifest(
                manifest,
                "index.reindex",
                "Reindex",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview copying documents into a destination index.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.close",
                "Close Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview closing an index.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.open",
                "Open Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview opening a closed index.",
                true,
            ),
            operation_manifest(
                manifest,
                "template.delete",
                "Delete Template",
                "index",
                "destructive",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview deleting an index or component template.",
                true,
            ),
            operation_manifest(
                manifest,
                "pipeline.put",
                "Update Pipeline",
                "schema",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Preview creating or updating an ingest pipeline.",
                true,
            ),
            operation_manifest(
                manifest,
                "lifecycle.put",
                if manifest.engine == "opensearch" {
                    "Update ISM Policy"
                } else {
                    "Update ILM Policy"
                },
                "schema",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Preview updating index lifecycle or state-management policy.",
                true,
            ),
        ]);
    }

    if manifest.family == "search" && manifest_has(manifest, "supports_query_profile") {
        operations.push(operation_manifest(
            manifest,
            "task.cancel",
            "Cancel Task",
            "query",
            "write",
            &["supports_query_profile"],
            &["diff", "raw"],
            "Preview canceling a running search cluster task.",
            true,
        ));
    }

    if manifest.family == "search" && manifest_has(manifest, "supports_backup_restore") {
        operations.push(operation_manifest(
            manifest,
            "snapshot.restore",
            "Restore Snapshot",
            "connection",
            "destructive",
            &["supports_backup_restore"],
            &["diff", "raw"],
            "Preview restoring a snapshot into the cluster.",
            true,
        ));
    }

    if manifest.engine == "mongodb" && manifest_has(manifest, "supports_admin_operations") {
        operations.push(operation_manifest(
            manifest,
            "validation.update",
            "Update Validation Rules",
            "schema",
            "write",
            &["supports_admin_operations"],
            &["schema", "diff", "raw"],
            "Preview a guarded MongoDB collection validator update.",
            true,
        ));
    }

    if manifest.engine == "mongodb" && manifest_has(manifest, "supports_user_role_browser") {
        operations.extend([
            operation_manifest(
                manifest,
                "user.create",
                "Create User",
                "user",
                "write",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview creating a MongoDB database user with assigned roles.",
                true,
            ),
            operation_manifest(
                manifest,
                "user.drop",
                "Drop User",
                "user",
                "destructive",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview dropping a MongoDB database user.",
                true,
            ),
            operation_manifest(
                manifest,
                "role.create",
                "Create Role",
                "role",
                "write",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview creating a MongoDB role with privileges and inherited roles.",
                true,
            ),
            operation_manifest(
                manifest,
                "role.drop",
                "Drop Role",
                "role",
                "destructive",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview dropping a MongoDB database role.",
                true,
            ),
        ]);
    }

    if manifest.engine == "mongodb" && manifest_has(manifest, "supports_import_export") {
        operations.extend([
            operation_manifest(
                manifest,
                "collection.export",
                "Export Collection",
                "collection",
                "costly",
                &["supports_import_export"],
                &["document", "json", "raw"],
                "Preview exporting a MongoDB collection or filtered result set.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.import",
                "Import Documents",
                "collection",
                "write",
                &["supports_import_export"],
                &["diff", "schema", "raw"],
                "Preview importing documents into a MongoDB collection with validation.",
                true,
            ),
        ]);
    }

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

    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.analyze",
                "Analyze Table",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview refreshing PostgreSQL planner statistics for a table or materialized view.",
                true,
            ),
            operation_manifest(
                manifest,
                "table.vacuum",
                "Vacuum Table",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview PostgreSQL VACUUM maintenance for a table.",
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
                "Preview database-wide PostgreSQL ANALYZE.",
                true,
            ),
            operation_manifest(
                manifest,
                "database.vacuum",
                "Vacuum Database",
                "database",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview database-wide PostgreSQL VACUUM maintenance.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.reindex",
                "Reindex",
                "index",
                "costly",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded PostgreSQL REINDEX request.",
                true,
            ),
        ]);
    }

    if manifest.engine == "sqlserver" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "statistics.update",
                "Update Statistics",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview refreshing SQL Server optimizer statistics for a table or indexed view.",
                true,
            ),
            operation_manifest(
                manifest,
                "query-store.top-queries",
                "Query Store Top Queries",
                "query",
                "diagnostic",
                &["supports_admin_operations", "supports_query_profile"],
                &["table", "profile", "metrics"],
                "Preview a Query Store top workload review.",
                false,
            ),
        ]);
    }

    if manifest.engine == "sqlserver" && manifest_has(manifest, "supports_index_management") {
        operations.extend([
            operation_manifest(
                manifest,
                "index.reorganize",
                "Reorganize Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview online-friendly SQL Server index reorganization.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.rebuild",
                "Rebuild Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview guarded SQL Server index rebuild.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.disable",
                "Disable Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview disabling a SQL Server index.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.enable",
                "Enable Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview rebuilding a disabled SQL Server index.",
                true,
            ),
        ]);
    }

    if manifest.engine == "clickhouse" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.optimize",
                "Optimize Table",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded OPTIMIZE TABLE FINAL request.",
                true,
            ),
            operation_manifest(
                manifest,
                "table.materialize-ttl",
                "Materialize TTL",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded ALTER TABLE MATERIALIZE TTL request.",
                true,
            ),
            operation_manifest(
                manifest,
                "table.freeze",
                "Freeze Table",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded table freeze snapshot request.",
                true,
            ),
        ]);
    }

    if manifest.engine == "snowflake" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.clone",
                "Clone Table",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded Snowflake zero-copy table clone request.",
                true,
            ),
            operation_manifest(
                manifest,
                "warehouse.suspend",
                "Suspend Warehouse",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded Snowflake warehouse suspend request.",
                true,
            ),
            operation_manifest(
                manifest,
                "warehouse.resume",
                "Resume Warehouse",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded Snowflake warehouse resume request.",
                true,
            ),
        ]);
    }

    if manifest.engine == "bigquery" && manifest_has(manifest, "supports_admin_operations") {
        operations.push(operation_manifest(
            manifest,
            "table.copy",
            "Copy Table",
            "table",
            "write",
            &["supports_admin_operations"],
            &["diff", "profile", "raw"],
            "Preview a guarded BigQuery table copy job.",
            true,
        ));
    }

    if manifest_has(manifest, "supports_permission_inspection") {
        operations.push(operation_manifest(
            manifest,
            "security.inspect",
            "Inspect Permissions",
            "role",
            "read",
            &["supports_permission_inspection"],
            &["table", "json"],
            "Read effective roles, grants, IAM hints, and unavailable actions for this profile.",
            false,
        ));
    }

    if manifest_has(manifest, "supports_metrics_collection") {
        operations.push(operation_manifest(
            manifest,
            "diagnostics.metrics",
            "Collect Metrics",
            "cluster",
            "diagnostic",
            &["supports_metrics_collection"],
            &["metrics", "series", "chart", "json"],
            "Collect normalized metrics that dashboards can render as charts.",
            false,
        ));
    }

    if manifest_has(manifest, "supports_import_export") {
        operations.push(operation_manifest(
            manifest,
            "data.import-export",
            "Import Or Export",
            "database",
            "costly",
            &["supports_import_export"],
            &["raw", "metrics", "costEstimate"],
            "Plan bulk import/export requests with scan, cost, and permission warnings.",
            true,
        ));
    }

    if manifest_has(manifest, "supports_backup_restore") {
        operations.push(operation_manifest(
            manifest,
            "data.backup-restore",
            "Backup Or Restore",
            "database",
            "destructive",
            &["supports_backup_restore"],
            &["raw", "metrics", "costEstimate"],
            "Plan backup and restore workflows with environment and permission guardrails.",
            true,
        ));
    }

    operations
        .into_iter()
        .filter(|operation| {
            operation
                .required_capabilities
                .iter()
                .all(|capability| manifest_has(manifest, capability))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::operation_manifests_for_manifest;
    use crate::domain::models::AdapterManifest;

    #[test]
    fn mongodb_operation_manifest_exposes_native_management_previews() {
        let manifest = AdapterManifest {
            id: "adapter-mongodb".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            label: "MongoDB".into(),
            maturity: "stable".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_user_role_browser".into(),
                "supports_import_export".into(),
            ],
            default_language: "mongodb".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"mongodb.index.hide"));
        assert!(operation_ids.contains(&"mongodb.validation.update"));
        assert!(operation_ids.contains(&"mongodb.user.create"));
        assert!(operation_ids.contains(&"mongodb.user.drop"));
        assert!(operation_ids.contains(&"mongodb.role.create"));
        assert!(operation_ids.contains(&"mongodb.role.drop"));
        assert!(operation_ids.contains(&"mongodb.collection.export"));
        assert!(operation_ids.contains(&"mongodb.collection.import"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "mongodb.user.drop")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
    }

    #[test]
    fn duckdb_operation_manifest_exposes_local_analytics_previews() {
        let manifest = AdapterManifest {
            id: "adapter-duckdb".into(),
            engine: "duckdb".into(),
            family: "embedded-olap".into(),
            label: "DuckDB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_import_export".into(),
            ],
            default_language: "sql".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"duckdb.table.analyze"));
        assert!(operation_ids.contains(&"duckdb.database.analyze"));
        assert!(operation_ids.contains(&"duckdb.database.checkpoint"));
        assert!(operation_ids.contains(&"duckdb.extension.install"));
        assert!(operation_ids.contains(&"duckdb.extension.load"));
        assert!(operation_ids.contains(&"duckdb.file.import"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "duckdb.table.analyze")
                .map(|operation| operation.risk.as_str()),
            Some("costly")
        );
    }

    #[test]
    fn postgresql_operation_manifest_exposes_native_maintenance_previews() {
        let manifest = AdapterManifest {
            id: "adapter-postgresql".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            label: "PostgreSQL".into(),
            maturity: "stable".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_query_profile".into(),
            ],
            default_language: "sql".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"postgresql.table.analyze"));
        assert!(operation_ids.contains(&"postgresql.table.vacuum"));
        assert!(operation_ids.contains(&"postgresql.database.analyze"));
        assert!(operation_ids.contains(&"postgresql.database.vacuum"));
        assert!(operation_ids.contains(&"postgresql.index.reindex"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "postgresql.index.reindex")
                .map(|operation| operation.risk.as_str()),
            Some("costly")
        );
    }

    #[test]
    fn sqlserver_operation_manifest_exposes_native_maintenance_previews() {
        let manifest = AdapterManifest {
            id: "adapter-sqlserver".into(),
            engine: "sqlserver".into(),
            family: "sql".into(),
            label: "SQL Server".into(),
            maturity: "stable".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_query_profile".into(),
            ],
            default_language: "sql".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"sqlserver.statistics.update"));
        assert!(operation_ids.contains(&"sqlserver.index.reorganize"));
        assert!(operation_ids.contains(&"sqlserver.index.rebuild"));
        assert!(operation_ids.contains(&"sqlserver.index.disable"));
        assert!(operation_ids.contains(&"sqlserver.index.enable"));
        assert!(operation_ids.contains(&"sqlserver.query-store.top-queries"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "sqlserver.index.disable")
                .map(|operation| operation.risk.as_str()),
            Some("write")
        );
    }

    #[test]
    fn search_operation_manifest_exposes_native_admin_previews() {
        let manifest = AdapterManifest {
            id: "adapter-elasticsearch".into(),
            engine: "elasticsearch".into(),
            family: "search".into(),
            label: "Elasticsearch".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_index_management".into(),
                "supports_query_profile".into(),
                "supports_backup_restore".into(),
            ],
            default_language: "query-dsl".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"elasticsearch.index.force-merge"));
        assert!(operation_ids.contains(&"elasticsearch.index.reindex"));
        assert!(operation_ids.contains(&"elasticsearch.lifecycle.put"));
        assert!(operation_ids.contains(&"elasticsearch.pipeline.put"));
        assert!(operation_ids.contains(&"elasticsearch.task.cancel"));
        assert!(operation_ids.contains(&"elasticsearch.snapshot.restore"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "elasticsearch.snapshot.restore")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
    }

    #[test]
    fn clickhouse_operation_manifest_exposes_native_table_maintenance_previews() {
        let manifest = AdapterManifest {
            id: "adapter-clickhouse".into(),
            engine: "clickhouse".into(),
            family: "warehouse".into(),
            label: "ClickHouse".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
            ],
            default_language: "clickhouse-sql".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"clickhouse.table.optimize"));
        assert!(operation_ids.contains(&"clickhouse.table.materialize-ttl"));
        assert!(operation_ids.contains(&"clickhouse.table.freeze"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "clickhouse.table.materialize-ttl")
                .map(|operation| operation.risk.as_str()),
            Some("costly")
        );
    }

    #[test]
    fn cloud_warehouse_manifest_exposes_native_admin_previews() {
        let snowflake_manifest = AdapterManifest {
            id: "adapter-snowflake".into(),
            engine: "snowflake".into(),
            family: "warehouse".into(),
            label: "Snowflake".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
            ],
            default_language: "snowflake-sql".into(),
            local_database: None,
            tree: None,
        };
        let bigquery_manifest = AdapterManifest {
            id: "adapter-bigquery".into(),
            engine: "bigquery".into(),
            family: "warehouse".into(),
            label: "BigQuery".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
            ],
            default_language: "google-sql".into(),
            local_database: None,
            tree: None,
        };

        let snowflake_operations = operation_manifests_for_manifest(&snowflake_manifest);
        let snowflake_ids = snowflake_operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();
        assert!(snowflake_ids.contains(&"snowflake.table.clone"));
        assert!(snowflake_ids.contains(&"snowflake.warehouse.suspend"));
        assert!(snowflake_ids.contains(&"snowflake.warehouse.resume"));
        assert_eq!(
            snowflake_operations
                .iter()
                .find(|operation| operation.id == "snowflake.table.clone")
                .map(|operation| operation.scope.as_str()),
            Some("table")
        );

        let bigquery_operations = operation_manifests_for_manifest(&bigquery_manifest);
        assert!(bigquery_operations
            .iter()
            .any(|operation| operation.id == "bigquery.table.copy" && operation.risk == "write"));
    }
}
