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
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "mongodb.user.drop")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
    }
}
