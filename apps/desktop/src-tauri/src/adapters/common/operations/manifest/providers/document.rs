use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend_mongodb(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
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
}

pub(super) fn extend_cosmos(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
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
}
