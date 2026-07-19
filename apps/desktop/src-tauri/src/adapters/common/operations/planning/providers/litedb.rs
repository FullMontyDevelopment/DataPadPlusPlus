use super::super::*;

pub(super) fn litedb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database_file =
        string_parameter(parameters, "databaseFile").unwrap_or_else(|| "<selected-file>.db".into());
    let collection =
        string_parameter(parameters, "collection").unwrap_or_else(|| object_name.into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("idx_{}_id", safe_identifier(&collection)));
    let field = string_parameter(parameters, "field").unwrap_or_else(|| "id".into());
    let unique = parameters
        .and_then(|values| values.get("unique"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if operation_id.ends_with("diagnostics.metrics") {
        return format!(
            "open \"{}\"\ndb.Engine.UserVersion\ndb.Checkpoint()\ninspect pages, freelist, collections, indexes",
            escape_double_quoted(&database_file)
        );
    }

    if operation_id.ends_with("storage.checkpoint") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Checkpoint",
                "databaseFile": database_file.clone(),
                "preflight": ["verify-file-lock", "flush-dirty-pages"],
                "effect": "persist pending pages without changing collection data"
            }),
            &database_file,
            "storage-checkpoint",
            true,
        );
    }

    if operation_id.ends_with("storage.compact") {
        let output_file = string_parameter(parameters, "outputFile")
            .unwrap_or_else(|| "<selected-folder>/compacted.db".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Compact",
                "databaseFile": database_file.clone(),
                "outputFile": output_file,
                "preflight": ["checkpoint", "verify-exclusive-or-online-copy-support", "preserve-encryption-settings"],
                "validation": ["open-compacted-copy", "compare-collection-counts", "compare-index-counts"]
            }),
            &database_file,
            "storage-compact",
            true,
        );
    }

    if operation_id.ends_with("storage.rebuild-indexes") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.RebuildIndexes",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "preflight": ["checkpoint", "verify-file-lock", "list-indexes"],
                "validation": ["compare-index-counts", "sample-indexed-queries"]
            }),
            &database_file,
            "storage-rebuild-indexes",
            true,
        );
    }

    if operation_id.ends_with("index.create") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.EnsureIndex",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "indexName": index_name.clone(),
                "field": field.clone(),
                "unique": unique,
                "statement": format!(
                    "db.GetCollection(\"{}\").EnsureIndex(\"{}\", \"{}\", {unique});",
                    escape_double_quoted(&collection),
                    escape_double_quoted(&index_name),
                    escape_double_quoted(&field)
                )
            }),
            &database_file,
            "index-create",
            true,
        );
    }

    if operation_id.ends_with("index.drop") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DropIndex",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "indexName": index_name.clone(),
                "statement": format!(
                    "db.GetCollection(\"{}\").DropIndex(\"{}\");",
                    escape_double_quoted(&collection),
                    escape_double_quoted(&index_name)
                )
            }),
            &database_file,
            "index-drop",
            true,
        );
    }

    if operation_id.ends_with("file-storage.import") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        let source_path = string_parameter(parameters, "sourcePath")
            .or_else(|| string_parameter(parameters, "inputPath"))
            .unwrap_or_else(|| "<selected-file>".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.ImportFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "sourcePath": source_path,
                "filename": string_parameter(parameters, "filename").unwrap_or_else(|| "<source filename>".into()),
                "overwrite": parameters.and_then(|values| values.get("overwrite")).and_then(Value::as_bool).unwrap_or(false),
                "preflight": ["verify-source-file", "check-existing-file-id", "confirm-overwrite-policy"],
                "validation": ["find-file-after-upload", "compare-byte-count"]
            }),
            &database_file,
            "file-storage-import",
            true,
        );
    }

    if operation_id.ends_with("file-storage.export") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.ExportFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "targetPath": target_path,
                "overwrite": parameters.and_then(|values| values.get("overwrite")).and_then(Value::as_bool).unwrap_or(false),
                "preflight": ["find-file", "verify-target-parent", "confirm-overwrite-policy"],
                "validation": ["compare-byte-count", "verify-target-file"]
            }),
            &database_file,
            "file-storage-export",
            false,
        );
    }

    if operation_id.ends_with("file-storage.delete") {
        let file_id = string_parameter(parameters, "fileId").unwrap_or_else(|| object_name.into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DeleteFile",
                "databaseFile": database_file.clone(),
                "fileId": file_id,
                "preflight": ["find-file", "confirm-file-id"],
                "validation": ["find-file-after-delete"]
            }),
            &database_file,
            "file-storage-delete",
            true,
        );
    }

    if operation_id.ends_with("data.import-export") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "export".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        return litedb_operation_plan(
            serde_json::json!({
                "operation": if mode == "import" { "LiteDB.ImportCollection" } else { "LiteDB.ExportCollection" },
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "format": format.clone(),
                "file": if format == "ndjson" { "<selected-file>.ndjson" } else { "<selected-file>.json" },
                "validation": if mode == "import" { "parse-bson-and-validate-indexes" } else { "stream-with-bounded-memory" }
            }),
            &database_file,
            &format!("data-{mode}"),
            mode == "import",
        );
    }

    if operation_id.ends_with("data.backup-restore") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.Backup",
                "databaseFile": database_file.clone(),
                "outputFile": "<selected-folder>/backup.db",
                "preflight": ["checkpoint", "verify-file-lock", "preserve-encryption-settings"]
            }),
            &database_file,
            "data-backup",
            false,
        );
    }

    if operation_id.ends_with("object.drop") {
        return litedb_operation_plan(
            serde_json::json!({
                "operation": "LiteDB.DropCollection",
                "databaseFile": database_file.clone(),
                "collection": collection.clone(),
                "statement": format!(
                    "db.DropCollection(\"{}\");",
                    escape_double_quoted(&collection)
                )
            }),
            &database_file,
            "object-drop",
            true,
        );
    }

    litedb_operation_plan(
        serde_json::json!({
            "operation": operation_id,
            "databaseFile": database_file.clone(),
            "collection": collection.clone()
        }),
        &database_file,
        "operation-preview",
        false,
    )
}

fn litedb_operation_plan(
    mut plan: Value,
    database_file: &str,
    intent: &str,
    write_intent: bool,
) -> String {
    let preflight = litedb_local_file_preflight_plan(database_file, intent, write_intent);
    if let Some(object) = plan.as_object_mut() {
        object.insert("localFilePreflight".into(), preflight.clone());
        object.insert(
            "sidecarExecutionBoundary".into(),
            preflight["sidecarExecutionBoundary"].clone(),
        );
    }
    serde_json::to_string_pretty(&plan).unwrap_or_else(|_| "{}".into())
}

fn litedb_local_file_preflight_plan(
    database_file: &str,
    intent: &str,
    write_intent: bool,
) -> Value {
    serde_json::json!({
        "databaseFile": database_file,
        "intent": intent,
        "pathResolution": {
            "source": "operation-parameters",
            "normalizedPath": database_file,
            "requiresConcreteLocalPathBeforeExecution": true
        },
        "probes": ["filesystem-read-open", "filesystem-write-open-if-writable"],
        "encryptionBoundary": {
            "passwordSource": "connection-profile-secret",
            "status": "sidecar-required",
            "requiredForEncryptedFiles": [
                "redacted password resolution",
                "sidecar LiteDB open probe",
                "request validation against the encrypted file"
            ]
        },
        "lockBoundary": {
            "scope": "local-file-preflight",
            "writeIntent": write_intent,
            "crossProcessContentionValidated": false,
            "exclusiveWriterLockValidated": false,
            "sidecarLockProbe": "required-before-live-execution",
            "residualRisks": [
                "Plain filesystem probes do not prove LiteDB engine shared/exclusive lock behavior.",
                "External-process contention and dirty-page checkpoint state require the .NET sidecar."
            ]
        },
        "sidecarExecutionBoundary": {
            "runtime": "dotnet-litedb-sidecar",
            "status": "plan-only-until-sidecar",
            "intent": intent,
            "writeIntent": write_intent,
            "requestShapeValidated": true,
            "liveExecutionValidated": false,
            "blockedReasons": [
                "sidecar-dispatch-not-implemented",
                if write_intent { "exclusive-writer-lock-not-validated" } else { "litedb-engine-open-probe-not-validated" },
                "encrypted-file-open-not-validated"
            ],
            "promotionRequirements": [
                "bundled or configured LiteDB sidecar executable",
                "sidecar read/open probe with bounded response",
                "exclusive writer-lock evidence for mutations and maintenance",
                "encrypted-file open failure/success evidence without leaking secrets",
                "before/after validation for document edits and file workflows"
            ]
        }
    })
}
