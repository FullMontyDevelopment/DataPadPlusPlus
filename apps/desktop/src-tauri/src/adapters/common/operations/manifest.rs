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
        operations.extend([
            operation_manifest(
                manifest,
                "task.cancel",
                "Cancel Task",
                "query",
                "write",
                &["supports_query_profile"],
                &["diff", "raw"],
                "Preview canceling a running search cluster task.",
                true,
            ),
            operation_manifest(
                manifest,
                "diagnostics.slow-log",
                "Slow Log Plan",
                "cluster",
                "diagnostic",
                &["supports_query_profile"],
                &["metrics", "table", "json", "raw"],
                "Plan slow-log settings, search counters, and index-level query/indexing diagnostics.",
                false,
            ),
            operation_manifest(
                manifest,
                "diagnostics.allocation",
                "Allocation Explain",
                "cluster",
                "diagnostic",
                &["supports_query_profile"],
                &["table", "json", "raw"],
                "Plan shard allocation explain and cat-shards requests with cluster-health context.",
                false,
            ),
        ]);
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

        let mut mongo_management = vec![
            operation_manifest(
                manifest,
                "database.create",
                "Create Database",
                "database",
                "write",
                &["supports_admin_operations"],
                &["schema", "diff", "raw"],
                "Create a MongoDB database by creating its first collection.",
                true,
            ),
            operation_manifest(
                manifest,
                "database.drop",
                "Drop Database",
                "database",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Drop a MongoDB database after confirmation; system databases are blocked.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.create",
                "Create Collection",
                "collection",
                "write",
                &["supports_admin_operations"],
                &["schema", "diff", "raw"],
                "Create a MongoDB collection with optional native collection options.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.drop",
                "Drop Collection",
                "collection",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Drop a MongoDB collection after confirmation.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.rename",
                "Rename Collection",
                "collection",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Rename a MongoDB collection within a database or to another database.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.modify",
                "Modify Collection",
                "collection",
                "write",
                &["supports_admin_operations"],
                &["schema", "diff", "raw"],
                "Apply guarded MongoDB collMod collection options.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.convert-to-capped",
                "Convert To Capped",
                "collection",
                "destructive",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Convert a MongoDB collection to capped storage with a fixed byte size.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.clone-as-capped",
                "Clone As Capped",
                "collection",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Clone a MongoDB collection into a capped collection.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.compact",
                "Compact Collection",
                "collection",
                "write",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Run a guarded MongoDB compact command for a collection.",
                true,
            ),
            operation_manifest(
                manifest,
                "collection.validate",
                "Validate Collection",
                "collection",
                "costly",
                &["supports_admin_operations"],
                &["table", "json", "raw"],
                "Run a guarded MongoDB validate command for a collection.",
                true,
            ),
        ];

        for operation in &mut mongo_management {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
        }
        operations.extend(mongo_management);
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

        if manifest.engine == "litedb" {
            import_export.execution_support = "live".into();
            import_export.disabled_reason = None;
            import_export.preview_only = Some(false);
            import_export.description =
                "Run guarded LiteDB JSON/NDJSON collection export or insert-only import through the configured sidecar file workflow."
                    .into();
        }

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
