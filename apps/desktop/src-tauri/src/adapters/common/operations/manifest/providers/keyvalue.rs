use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend_redis(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
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
}

pub(super) fn extend_memcached(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
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
}
