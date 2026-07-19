use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

mod providers;

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

    providers::extend_search(manifest, &mut operations);
    providers::extend_timeseries(manifest, &mut operations);
    providers::extend_graph(manifest, &mut operations);
    providers::extend_mongodb(manifest, &mut operations);
    providers::extend_redis(manifest, &mut operations);
    providers::extend_duckdb(manifest, &mut operations);
    providers::extend_cosmos(manifest, &mut operations);
    providers::extend_litedb(manifest, &mut operations);
    providers::extend_postgres(manifest, &mut operations);
    providers::extend_sqlserver(manifest, &mut operations);
    providers::extend_warehouse(manifest, &mut operations);
    providers::extend_dynamodb(manifest, &mut operations);
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

    providers::extend_memcached(manifest, &mut operations);
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
        let mut import_export = operation_manifest(
            manifest,
            "data.import-export",
            "Import Or Export",
            "database",
            "costly",
            &["supports_import_export"],
            &["raw", "metrics", "costEstimate"],
            "Plan bulk import/export requests with scan, cost, and permission warnings.",
            true,
        );

        providers::customize_import_export(manifest, &mut import_export);

        operations.push(import_export);
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

    providers::finalize_litedb(manifest, &mut operations);
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
#[path = "../../../../tests/unit/adapters/common/operations/manifest_tests.rs"]
mod tests;
