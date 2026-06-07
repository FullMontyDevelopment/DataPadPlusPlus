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
                "index.put-mapping",
                "Update Mapping",
                "index",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Preview updating index mapping fields.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.update-settings",
                "Update Settings",
                "index",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Preview updating mutable index settings.",
                true,
            ),
            operation_manifest(
                manifest,
                "alias.put",
                "Add Alias",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview adding or updating an index alias.",
                true,
            ),
            operation_manifest(
                manifest,
                "alias.delete",
                "Remove Alias",
                "index",
                "destructive",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview removing an index alias.",
                true,
            ),
            operation_manifest(
                manifest,
                "lifecycle.explain",
                if manifest.engine == "opensearch" {
                    "Explain ISM"
                } else {
                    "Explain ILM"
                },
                "index",
                "diagnostic",
                &["supports_index_management"],
                &["json", "metrics", "raw"],
                "Preview index lifecycle or state-management status.",
                false,
            ),
            operation_manifest(
                manifest,
                "data-stream.rollover",
                "Rollover Data Stream",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview a guarded data-stream rollover request.",
                true,
            ),
            operation_manifest(
                manifest,
                "template.create",
                "Create Template",
                "index",
                "write",
                &["supports_index_management"],
                &["schema", "diff", "raw"],
                "Preview creating or replacing an index or component template.",
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
                "pipeline.simulate",
                "Simulate Pipeline",
                "schema",
                "diagnostic",
                &["supports_index_management"],
                &["document", "json", "raw"],
                "Preview an ingest pipeline simulation request.",
                false,
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

    if manifest.engine == "neptune"
        && manifest_has(manifest, "supports_cloud_iam")
        && !manifest_has(manifest, "supports_permission_inspection")
    {
        operations.push(operation_manifest(
            manifest,
            "security.inspect",
            "Inspect Permissions",
            "role",
            "read",
            &["supports_cloud_iam"],
            &["table", "json"],
            "Preview IAM and Neptune database action checks for this graph profile.",
            false,
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
        let mut collection_export = operation_manifest(
            manifest,
            "collection.export",
            "Export Collection",
            "collection",
            "costly",
            &["supports_import_export"],
            &["document", "json", "raw"],
            "Export a MongoDB collection or filtered result set through the guarded native file workflow.",
            true,
        );
        collection_export.execution_support = "live".into();
        collection_export.disabled_reason = None;

        let mut collection_import = operation_manifest(
            manifest,
            "collection.import",
            "Import Documents",
            "collection",
            "write",
            &["supports_import_export"],
            &["diff", "schema", "raw"],
            "Import JSON, Extended JSON, NDJSON, CSV, or BSON documents through the guarded native file workflow.",
            true,
        );
        collection_import.execution_support = "live".into();
        collection_import.disabled_reason = None;

        operations.extend([collection_export, collection_import]);
    }

    if matches!(manifest.engine.as_str(), "redis" | "valkey") {
        if manifest_has(manifest, "supports_import_export") {
            let mut key_export = operation_manifest(
                manifest,
                "key.export",
                "Export Key",
                "key",
                "costly",
                &["supports_import_export"],
                &["keyvalue", "json", "raw"],
                "Export one Redis-compatible key through the guarded native file workflow with type, TTL, and serialization metadata; Redis also supports RedisJSON documents, TimeSeries samples, vector-set elements, and Redis DUMP snapshots for opaque module values.",
                true,
            );

            let mut key_import = operation_manifest(
                manifest,
                "key.import",
                "Import Key",
                "key",
                "write",
                &["supports_import_export"],
                &["diff", "keyvalue", "raw"],
                "Import one Redis-compatible key through the guarded native file workflow with type validation, TTL handling, and before/after metadata; Redis also supports RedisJSON documents, TimeSeries samples, vector-set elements, and Redis RESTORE snapshots for opaque module values.",
                true,
            );

            if matches!(manifest.engine.as_str(), "redis" | "valkey") {
                key_export.execution_support = "live".into();
                key_export.disabled_reason = None;
                key_export.preview_only = Some(false);

                key_import.execution_support = "live".into();
                key_import.disabled_reason = None;
                key_import.preview_only = Some(false);
            }

            operations.extend([key_export, key_import]);
        }

        if manifest_has(manifest, "supports_admin_operations") {
            operations.extend([
                operation_manifest(
                    manifest,
                    "key.rename",
                    "Rename Key",
                    "key",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview renaming one key without scanning the keyspace.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "key.copy",
                    "Duplicate Key",
                    "key",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview copying one key to a new key name or database.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "key.move",
                    "Move Key",
                    "key",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview moving one key into another logical database.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "stream.ack",
                    "Acknowledge Stream Entries",
                    "key",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview acknowledging Redis stream entries for a consumer group.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "stream.delete-entry",
                    "Delete Stream Entry",
                    "key",
                    "destructive",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview deleting one or more Redis stream entries.",
                    true,
                ),
            ]);
        }

        if manifest_has(manifest, "supports_ttl_management") {
            operations.extend([
                operation_manifest(
                    manifest,
                    "key.expire",
                    "Set TTL",
                    "key",
                    "write",
                    &["supports_ttl_management"],
                    &["diff", "raw"],
                    "Preview setting or replacing the TTL for one key.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "key.persist",
                    "Remove TTL",
                    "key",
                    "write",
                    &["supports_ttl_management"],
                    &["diff", "raw"],
                    "Preview removing the TTL from one key.",
                    true,
                ),
            ]);
        }
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

    if manifest.engine == "cosmosdb" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "throughput.update",
                "Update Throughput",
                "database",
                "write",
                &["supports_admin_operations", "supports_cost_estimation"],
                &["diff", "metrics", "costEstimate", "raw"],
                "Preview a guarded Cosmos DB database or container throughput update.",
                true,
            ),
            operation_manifest(
                manifest,
                "consistency.update",
                "Update Consistency",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview an account-level Cosmos DB consistency policy change.",
                true,
            ),
            operation_manifest(
                manifest,
                "regions.failover",
                "Failover Regions",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "metrics", "raw"],
                "Preview Cosmos DB regional failover priority changes with application-impact checks.",
                true,
            ),
        ]);
    }

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
        ]);
    }

    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_result_snapshots") {
        operations.push(operation_manifest(
            manifest,
            "routine.execute",
            "Run Routine",
            "query",
            "write",
            &["supports_result_snapshots"],
            &["table", "json", "raw"],
            "Prepare a parameterized PostgreSQL function/procedure call with signature-aware bindings and confirmation guardrails.",
            true,
        ));
    }

    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_query_cancellation") {
        operations.extend([
            operation_manifest(
                manifest,
                "session.cancel",
                "Cancel Query",
                "query",
                "write",
                &["supports_query_cancellation"],
                &["metrics", "raw"],
                "Prepare a guarded pg_cancel_backend request for a selected PostgreSQL backend PID.",
                true,
            ),
            operation_manifest(
                manifest,
                "session.terminate",
                "Terminate Backend",
                "query",
                "destructive",
                &["supports_query_cancellation"],
                &["diff", "metrics", "raw"],
                "Prepare a guarded pg_terminate_backend request for a selected PostgreSQL backend PID.",
                true,
            ),
        ]);
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
            operation_manifest(
                manifest,
                "role.grant",
                "Grant Role",
                "role",
                "write",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview granting one PostgreSQL role to another role.",
                true,
            ),
            operation_manifest(
                manifest,
                "role.revoke",
                "Revoke Role",
                "role",
                "write",
                &["supports_user_role_browser"],
                &["diff", "raw"],
                "Preview revoking a PostgreSQL role membership.",
                true,
            ),
            operation_manifest(
                manifest,
                "extension.update",
                "Update Extension",
                "extension",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview ALTER EXTENSION UPDATE after version and dependency review.",
                true,
            ),
            operation_manifest(
                manifest,
                "extension.drop",
                "Drop Extension",
                "extension",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview dropping an installed PostgreSQL extension and dependent objects.",
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

    if manifest.engine == "dynamodb" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "capacity.update",
                "Update Capacity",
                "table",
                "write",
                &["supports_admin_operations", "supports_cost_estimation"],
                &["costEstimate", "metrics", "raw"],
                "Preview a guarded billing-mode or throughput update with cost checks.",
                true,
            ),
            operation_manifest(
                manifest,
                "ttl.update",
                "Update TTL",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview enabling or changing table TTL settings.",
                true,
            ),
            operation_manifest(
                manifest,
                "streams.update",
                "Update Streams",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview enabling or changing DynamoDB Streams settings.",
                true,
            ),
            operation_manifest(
                manifest,
                "backup.create",
                "Create Backup",
                "table",
                "costly",
                &["supports_backup_restore"],
                &["metrics", "raw"],
                "Preview creating an on-demand table backup.",
                true,
            ),
            operation_manifest(
                manifest,
                "backup.restore",
                "Restore Backup",
                "table",
                "destructive",
                &["supports_backup_restore"],
                &["diff", "raw"],
                "Preview restoring a table from a selected backup.",
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

    if manifest.engine == "memcached" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "stats.reset",
                "Reset Stats",
                "cluster",
                "write",
                &["supports_admin_operations", "supports_metrics_collection"],
                &["metrics", "raw"],
                "Preview resetting Memcached stats counters while leaving cached values intact.",
                true,
            ),
            operation_manifest(
                manifest,
                "cache.flush",
                "Flush Cache",
                "cluster",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a destructive Memcached flush_all request with optional delay.",
                true,
            ),
            operation_manifest(
                manifest,
                "key.get",
                "Get Key",
                "key",
                "read",
                &["supports_result_snapshots"],
                &["keyvalue", "raw"],
                "Preview a targeted Memcached get for an application-known key.",
                false,
            ),
            operation_manifest(
                manifest,
                "key.gets",
                "Get Key With CAS",
                "key",
                "read",
                &["supports_result_snapshots"],
                &["keyvalue", "raw"],
                "Preview a targeted Memcached gets request including the CAS token.",
                false,
            ),
            operation_manifest(
                manifest,
                "key.set",
                "Set Key",
                "key",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview setting an application-known Memcached key with flags and TTL.",
                true,
            ),
            operation_manifest(
                manifest,
                "key.touch",
                "Touch Key",
                "key",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview updating TTL for an application-known Memcached key.",
                true,
            ),
            operation_manifest(
                manifest,
                "key.increment",
                "Increment Key",
                "key",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview incrementing a numeric Memcached value.",
                true,
            ),
            operation_manifest(
                manifest,
                "key.decrement",
                "Decrement Key",
                "key",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview decrementing a numeric Memcached value.",
                true,
            ),
            operation_manifest(
                manifest,
                "key.delete",
                "Delete Key",
                "key",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview deleting an application-known Memcached key.",
                true,
            ),
        ]);
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
        for operation_id in ["mongodb.collection.export", "mongodb.collection.import"] {
            let operation = operations
                .iter()
                .find(|operation| operation.id == operation_id)
                .expect("MongoDB collection file operation");
            assert_eq!(operation.execution_support, "live");
            assert!(operation.disabled_reason.is_none());
            assert!(operation.requires_confirmation);
        }
    }

    #[test]
    fn redis_like_operation_manifest_exposes_key_management_previews() {
        for engine in ["redis", "valkey"] {
            let manifest = AdapterManifest {
                id: format!("adapter-{engine}"),
                engine: engine.into(),
                family: "keyvalue".into(),
                label: if engine == "valkey" {
                    "Valkey".into()
                } else {
                    "Redis".into()
                },
                maturity: if engine == "valkey" {
                    "beta".into()
                } else {
                    "stable".into()
                },
                capabilities: vec![
                    "supports_key_browser".into(),
                    "supports_ttl_management".into(),
                    "supports_result_snapshots".into(),
                    "supports_admin_operations".into(),
                    "supports_user_role_browser".into(),
                    "supports_permission_inspection".into(),
                    "supports_import_export".into(),
                ],
                default_language: "redis".into(),
                local_database: None,
                tree: None,
            };

            let operations = operation_manifests_for_manifest(&manifest);
            let operation_ids = operations
                .iter()
                .map(|operation| operation.id.as_str())
                .collect::<Vec<_>>();

            assert!(operation_ids.contains(&format!("{engine}.key.export").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.import").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.rename").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.copy").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.move").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.expire").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.key.persist").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.stream.ack").as_str()));
            assert!(operation_ids.contains(&format!("{engine}.stream.delete-entry").as_str()));
            assert_eq!(
                operations
                    .iter()
                    .find(|operation| operation.id == format!("{engine}.key.import"))
                    .map(|operation| operation.risk.as_str()),
                Some("write")
            );
            let key_import = operations
                .iter()
                .find(|operation| operation.id == format!("{engine}.key.import"))
                .expect("key import operation");
            assert_eq!(key_import.execution_support, "live");
            assert_eq!(key_import.preview_only, Some(false));
            assert!(key_import.disabled_reason.is_none());
            assert_eq!(
                operations
                    .iter()
                    .find(|operation| operation.id == format!("{engine}.stream.delete-entry"))
                    .map(|operation| operation.risk.as_str()),
                Some("destructive")
            );
        }
    }

    #[test]
    fn memcached_operation_manifest_exposes_known_key_previews() {
        let manifest = AdapterManifest {
            id: "adapter-memcached".into(),
            engine: "memcached".into(),
            family: "keyvalue".into(),
            label: "Memcached".into(),
            maturity: "stable".into(),
            capabilities: vec![
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_metrics_collection".into(),
            ],
            default_language: "text".into(),
            local_database: None,
            tree: None,
        };

        let operations = operation_manifests_for_manifest(&manifest);
        let operation_ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(operation_ids.contains(&"memcached.stats.reset"));
        assert!(operation_ids.contains(&"memcached.cache.flush"));
        assert!(operation_ids.contains(&"memcached.key.get"));
        assert!(operation_ids.contains(&"memcached.key.gets"));
        assert!(operation_ids.contains(&"memcached.key.set"));
        assert!(operation_ids.contains(&"memcached.key.touch"));
        assert!(operation_ids.contains(&"memcached.key.increment"));
        assert!(operation_ids.contains(&"memcached.key.decrement"));
        assert!(operation_ids.contains(&"memcached.key.delete"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "memcached.cache.flush")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "memcached.key.delete")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
    }

    #[test]
    fn wave_four_document_operation_manifests_expose_native_management_previews() {
        let cosmos_manifest = AdapterManifest {
            id: "adapter-cosmosdb".into(),
            engine: "cosmosdb".into(),
            family: "document".into(),
            label: "Cosmos DB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_result_snapshots".into(),
                "supports_schema_browser".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_cost_estimation".into(),
            ],
            default_language: "sql".into(),
            local_database: None,
            tree: None,
        };
        let litedb_manifest = AdapterManifest {
            id: "adapter-litedb".into(),
            engine: "litedb".into(),
            family: "document".into(),
            label: "LiteDB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_result_snapshots".into(),
                "supports_schema_browser".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_import_export".into(),
                "supports_backup_restore".into(),
            ],
            default_language: "json".into(),
            local_database: None,
            tree: None,
        };

        let cosmos_ids = operation_manifests_for_manifest(&cosmos_manifest)
            .iter()
            .map(|operation| operation.id.clone())
            .collect::<Vec<_>>();
        assert!(cosmos_ids.contains(&"cosmosdb.throughput.update".into()));
        assert!(cosmos_ids.contains(&"cosmosdb.consistency.update".into()));
        assert!(cosmos_ids.contains(&"cosmosdb.regions.failover".into()));

        let litedb_operations = operation_manifests_for_manifest(&litedb_manifest);
        let litedb_ids = litedb_operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();
        assert!(litedb_ids.contains(&"litedb.storage.checkpoint"));
        assert!(litedb_ids.contains(&"litedb.storage.compact"));
        assert!(litedb_ids.contains(&"litedb.storage.rebuild-indexes"));
        assert!(litedb_ids.contains(&"litedb.data.backup-restore"));
        assert_eq!(
            litedb_operations
                .iter()
                .find(|operation| operation.id == "litedb.storage.compact")
                .map(|operation| operation.risk.as_str()),
            Some("costly")
        );
    }

    #[test]
    fn operation_manifests_keep_risky_and_plan_only_states_explicit() {
        for maturity in ["stable", "beta"] {
            let manifest = AdapterManifest {
                id: format!("adapter-{maturity}"),
                engine: format!("engine-{maturity}"),
                family: "sql".into(),
                label: format!("Engine {maturity}"),
                maturity: maturity.into(),
                capabilities: vec![
                    "supports_schema_browser".into(),
                    "supports_result_snapshots".into(),
                    "supports_explain_plan".into(),
                    "supports_plan_visualization".into(),
                    "supports_query_profile".into(),
                    "supports_admin_operations".into(),
                    "supports_index_management".into(),
                    "supports_permission_inspection".into(),
                    "supports_import_export".into(),
                    "supports_backup_restore".into(),
                    "supports_metrics_collection".into(),
                ],
                default_language: "sql".into(),
                local_database: None,
                tree: None,
            };

            for operation in operation_manifests_for_manifest(&manifest) {
                if matches!(operation.risk.as_str(), "write" | "destructive" | "costly") {
                    assert!(
                        operation.requires_confirmation,
                        "{} must require confirmation",
                        operation.id
                    );
                }

                if operation.execution_support != "live" {
                    assert!(
                        operation
                            .disabled_reason
                            .as_deref()
                            .is_some_and(|reason| !reason.trim().is_empty()),
                        "{} must explain why it is not live",
                        operation.id
                    );
                }
            }
        }
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
                "supports_query_cancellation".into(),
                "supports_user_role_browser".into(),
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

        assert!(operation_ids.contains(&"postgresql.routine.execute"));
        assert!(operation_ids.contains(&"postgresql.session.cancel"));
        assert!(operation_ids.contains(&"postgresql.session.terminate"));
        assert!(operation_ids.contains(&"postgresql.table.analyze"));
        assert!(operation_ids.contains(&"postgresql.table.vacuum"));
        assert!(operation_ids.contains(&"postgresql.database.analyze"));
        assert!(operation_ids.contains(&"postgresql.database.vacuum"));
        assert!(operation_ids.contains(&"postgresql.index.reindex"));
        assert!(operation_ids.contains(&"postgresql.role.grant"));
        assert!(operation_ids.contains(&"postgresql.role.revoke"));
        assert!(operation_ids.contains(&"postgresql.extension.update"));
        assert!(operation_ids.contains(&"postgresql.extension.drop"));
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "postgresql.routine.execute")
                .map(|operation| operation.risk.as_str()),
            Some("write")
        );
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "postgresql.session.terminate")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
        );
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "postgresql.index.reindex")
                .map(|operation| operation.risk.as_str()),
            Some("costly")
        );
        assert_eq!(
            operations
                .iter()
                .find(|operation| operation.id == "postgresql.extension.drop")
                .map(|operation| operation.risk.as_str()),
            Some("destructive")
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
                "supports_import_export".into(),
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
        assert!(operation_ids.contains(&"elasticsearch.index.put-mapping"));
        assert!(operation_ids.contains(&"elasticsearch.index.update-settings"));
        assert!(operation_ids.contains(&"elasticsearch.alias.put"));
        assert!(operation_ids.contains(&"elasticsearch.alias.delete"));
        assert!(operation_ids.contains(&"elasticsearch.lifecycle.explain"));
        assert!(operation_ids.contains(&"elasticsearch.data-stream.rollover"));
        assert!(operation_ids.contains(&"elasticsearch.template.create"));
        assert!(operation_ids.contains(&"elasticsearch.lifecycle.put"));
        assert!(operation_ids.contains(&"elasticsearch.pipeline.put"));
        assert!(operation_ids.contains(&"elasticsearch.pipeline.simulate"));
        assert!(operation_ids.contains(&"elasticsearch.task.cancel"));
        assert!(operation_ids.contains(&"elasticsearch.data.import-export"));
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
    fn wave_five_operation_manifest_exposes_timeseries_and_graph_previews() {
        let prometheus_manifest = AdapterManifest {
            id: "adapter-prometheus".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            label: "Prometheus".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_query_profile".into(),
                "supports_metrics_collection".into(),
            ],
            default_language: "promql".into(),
            local_database: None,
            tree: None,
        };
        let influx_manifest = AdapterManifest {
            id: "adapter-influxdb".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            label: "InfluxDB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_permission_inspection".into(),
                "supports_query_profile".into(),
                "supports_metrics_collection".into(),
                "supports_import_export".into(),
            ],
            default_language: "influxql".into(),
            local_database: None,
            tree: None,
        };
        let opentsdb_manifest = AdapterManifest {
            id: "adapter-opentsdb".into(),
            engine: "opentsdb".into(),
            family: "timeseries".into(),
            label: "OpenTSDB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_metrics_collection".into(),
                "supports_import_export".into(),
            ],
            default_language: "opentsdb".into(),
            local_database: None,
            tree: None,
        };
        let neptune_manifest = AdapterManifest {
            id: "adapter-neptune".into(),
            engine: "neptune".into(),
            family: "graph".into(),
            label: "Amazon Neptune".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_graph_view".into(),
                "supports_result_snapshots".into(),
                "supports_explain_plan".into(),
                "supports_plan_visualization".into(),
                "supports_query_profile".into(),
                "supports_cloud_iam".into(),
                "supports_metrics_collection".into(),
                "supports_import_export".into(),
            ],
            default_language: "gremlin".into(),
            local_database: None,
            tree: None,
        };

        let prometheus_ids = operation_manifests_for_manifest(&prometheus_manifest)
            .iter()
            .map(|operation| operation.id.clone())
            .collect::<Vec<_>>();
        assert!(prometheus_ids.contains(&"prometheus.cardinality.analyze".into()));

        let influx_ids = operation_manifests_for_manifest(&influx_manifest)
            .iter()
            .map(|operation| operation.id.clone())
            .collect::<Vec<_>>();
        assert!(influx_ids.contains(&"influxdb.retention.update".into()));
        assert!(influx_ids.contains(&"influxdb.security.inspect".into()));

        let opentsdb_ids = operation_manifests_for_manifest(&opentsdb_manifest)
            .iter()
            .map(|operation| operation.id.clone())
            .collect::<Vec<_>>();
        assert!(opentsdb_ids.contains(&"opentsdb.uid.repair".into()));

        let neptune_operations = operation_manifests_for_manifest(&neptune_manifest);
        let neptune_ids = neptune_operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();
        assert!(neptune_ids.contains(&"neptune.security.inspect"));
        assert!(neptune_ids.contains(&"neptune.data.import-export"));
        assert_eq!(
            neptune_operations
                .iter()
                .find(|operation| operation.id == "neptune.security.inspect")
                .map(|operation| operation.required_capabilities.as_slice()),
            Some(&["supports_cloud_iam".to_string()][..])
        );
    }

    #[test]
    fn wave_three_widecolumn_operation_manifest_exposes_import_backup_and_capacity_previews() {
        let dynamodb_manifest = AdapterManifest {
            id: "adapter-dynamodb".into(),
            engine: "dynamodb".into(),
            family: "widecolumn".into(),
            label: "DynamoDB".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_permission_inspection".into(),
                "supports_metrics_collection".into(),
                "supports_cost_estimation".into(),
                "supports_import_export".into(),
                "supports_backup_restore".into(),
            ],
            default_language: "json".into(),
            local_database: None,
            tree: None,
        };
        let cassandra_manifest = AdapterManifest {
            id: "adapter-cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            label: "Cassandra".into(),
            maturity: "beta".into(),
            capabilities: vec![
                "supports_schema_browser".into(),
                "supports_result_snapshots".into(),
                "supports_admin_operations".into(),
                "supports_index_management".into(),
                "supports_permission_inspection".into(),
                "supports_query_profile".into(),
                "supports_metrics_collection".into(),
                "supports_import_export".into(),
                "supports_backup_restore".into(),
            ],
            default_language: "cql".into(),
            local_database: None,
            tree: None,
        };

        let dynamodb_operations = operation_manifests_for_manifest(&dynamodb_manifest);
        let dynamodb_ids = dynamodb_operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();
        assert!(dynamodb_ids.contains(&"dynamodb.capacity.update"));
        assert!(dynamodb_ids.contains(&"dynamodb.ttl.update"));
        assert!(dynamodb_ids.contains(&"dynamodb.streams.update"));
        assert!(dynamodb_ids.contains(&"dynamodb.backup.create"));
        assert!(dynamodb_ids.contains(&"dynamodb.backup.restore"));
        assert!(dynamodb_ids.contains(&"dynamodb.data.import-export"));
        assert!(dynamodb_ids.contains(&"dynamodb.data.backup-restore"));

        let cassandra_operations = operation_manifests_for_manifest(&cassandra_manifest);
        let cassandra_ids = cassandra_operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();
        assert!(cassandra_ids.contains(&"cassandra.query.profile"));
        assert!(cassandra_ids.contains(&"cassandra.index.create"));
        assert!(cassandra_ids.contains(&"cassandra.data.import-export"));
        assert!(cassandra_ids.contains(&"cassandra.data.backup-restore"));
        assert_eq!(
            cassandra_operations
                .iter()
                .find(|operation| operation.id == "cassandra.data.backup-restore")
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
