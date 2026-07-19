use super::super::*;

pub(super) fn duckdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    if operation_id.ends_with("table.analyze") {
        return duckdb_admin_operation_request(
            "duckdb.table.analyze-preview",
            "analyze-table",
            "table",
            object_name,
            &format!("analyze {object_name};"),
            false,
            true,
        );
    }

    if operation_id.ends_with("database.analyze") {
        return duckdb_admin_operation_request(
            "duckdb.database.analyze-preview",
            "analyze-database",
            "database",
            "database",
            "analyze;",
            false,
            true,
        );
    }

    if operation_id.ends_with("database.checkpoint") {
        return duckdb_admin_operation_request(
            "duckdb.database.checkpoint-preview",
            "checkpoint",
            "database",
            "database",
            "checkpoint;",
            false,
            true,
        );
    }

    if operation_id.ends_with("object.create") {
        let statement = format!(
            "create table {object_name} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);"
        );
        return duckdb_admin_operation_request(
            "duckdb.object.create-preview",
            "create-object",
            "schema",
            object_name,
            &statement,
            true,
            true,
        );
    }

    if operation_id.ends_with("object.drop") {
        let statement = format!("drop table {object_name};");
        return duckdb_admin_operation_request(
            "duckdb.object.drop-preview",
            "drop-object",
            "schema",
            object_name,
            &statement,
            true,
            true,
        );
    }

    if operation_id.ends_with("extension.install") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return duckdb_extension_operation_request("install", &extension);
    }

    if operation_id.ends_with("extension.load") {
        let extension = string_parameter(parameters, "extensionName")
            .unwrap_or_else(|| safe_duckdb_extension_name(object_name));
        return duckdb_extension_operation_request("load", &extension);
    }

    if operation_id.ends_with("file.import") {
        let table = string_parameter(parameters, "tableName").unwrap_or_else(|| object_name.into());
        let format = string_parameter(parameters, "sourceFormat")
            .or_else(|| string_parameter(parameters, "format"))
            .unwrap_or_else(|| "parquet".into());
        return duckdb_import_file_request(&table, &format);
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return duckdb_import_export_request(object_name, parameters);
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return duckdb_backup_restore_request(parameters);
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select table_schema, table_name, table_type from information_schema.tables order by table_schema, table_name;".into(),
        "execute" => format!("select * from {object_name} limit 100;"),
        "explain" => format!("explain select * from {object_name} limit 100;"),
        "profile" => format!("explain analyze select * from {object_name} limit 100;"),
        "create" => duckdb_admin_operation_request(
            "duckdb.object.create-preview",
            "create-object",
            "schema",
            object_name,
            &format!(
                "create table {object_name} (\n  id text primary key,\n  created_at timestamp default current_timestamp\n);"
            ),
            true,
            true,
        ),
        "drop" => duckdb_admin_operation_request(
            "duckdb.object.drop-preview",
            "drop-object",
            "schema",
            object_name,
            &format!("drop table {object_name};"),
            true,
            true,
        ),
        "inspect" => "select * from duckdb_extensions();\npragma database_list;\nselect name, value from duckdb_settings();".into(),
        "metrics" => "select version();\nselect name, value from duckdb_settings() where name in ('memory_limit', 'threads');".into(),
        _ => format!("-- DuckDB {operation_id}\n-- object: {object_name}"),
    }
}

fn duckdb_import_file_request(object_name: &str, format: &str) -> String {
    let reader = match format.to_ascii_lowercase().as_str() {
        "csv" => "read_csv_auto('<selected-file>.csv')",
        "json" | "jsonl" | "ndjson" => "read_json_auto('<selected-file>.json')",
        _ => "read_parquet('<selected-file>.parquet')",
    };

    format!("create or replace table {object_name} as\nselect * from {reader};")
}

fn duckdb_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "replace" | "create" | "validate" | "validate-only"
    );
    let format = if import_like {
        string_parameter(parameters, "sourceFormat")
            .or_else(|| string_parameter(parameters, "format"))
            .unwrap_or_else(|| "csv".into())
            .to_ascii_lowercase()
    } else {
        string_parameter(parameters, "format")
            .unwrap_or_else(|| "csv".into())
            .to_ascii_lowercase()
    };
    let (schema, table) = duckdb_plan_table_parts(object_name, parameters);
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "duckdb.table.import",
            "mode": mode,
            "schema": schema,
            "table": table,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| format!("<selected-file>.{}", duckdb_file_extension(&format)))
            },
            "rowLimit": row_limit,
            "databaseLockBoundary": duckdb_database_lock_boundary_contract(
                "duckdb.table.import",
                !matches!(mode.as_str(), "validate" | "validate-only")
            ),
            "formatPreflight": duckdb_format_preflight_contract(&format, "import"),
            "executionGate": {
                "owner": "duckdb-adapter",
                "defaultSupport": "live",
                "requiresConfirmation": true,
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "CSV/JSON/Parquet format allowlist",
                    "bounded row import",
                    "read-only connection blocked",
                    "database file access/read-only preflight",
                    "format capability preflight",
                    "JSON/Parquet extension catalog probe",
                    "replace/append mode review"
                ],
                "residualRisk": "extension installation, arbitrary DDL, restore execution, and broader local OLAP mutations remain preview-first"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "duckdb.table.export",
        "schema": schema,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{}", duckdb_file_extension(&format))),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "statement": format!(
            "copy (select * from {} limit {row_limit}) to '<selected-file>.{}' (format {});",
            duckdb_qualified_identifier(&schema, &table),
            duckdb_file_extension(&format),
            safe_duckdb_format_keyword(&format)
        ),
        "databaseLockBoundary": duckdb_database_lock_boundary_contract("duckdb.table.export", false),
        "formatPreflight": duckdb_format_preflight_contract(&format, "export"),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export",
                "database file read/open preflight",
                "format capability preflight",
                "JSON/Parquet extension catalog probe"
            ],
            "residualRisk": "remote filesystem, encrypted files, restore execution, and arbitrary extension management remain optional validation paths"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_backup_restore_request(parameters: Option<&BTreeMap<String, Value>>) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format")
        .unwrap_or_else(|| "csv".into())
        .to_ascii_lowercase();

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "duckdb.database.restore-preview",
            "mode": mode,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .or_else(|| string_parameter(parameters, "sourceFolder"))
                    .or_else(|| string_parameter(parameters, "inputFolder"))
                    .unwrap_or_else(|| "<selected-folder>".into())
            },
            "restorePreflight": duckdb_restore_preflight_contract(&format),
            "databaseLockBoundary": duckdb_database_lock_boundary_contract(
                "duckdb.database.restore-preview",
                true
            ),
            "restoreExecutionBoundary": duckdb_restore_execution_boundary_contract(&mode),
            "executionGate": {
                "owner": "duckdb-adapter",
                "defaultSupport": "plan-only",
                "requiresConfirmation": true,
                "guards": [
                    "absolute restore source folder",
                    "source folder readability preflight",
                    "schema.sql/load.sql package marker check",
                    "target database write/open preflight",
                    "target snapshot or rollback artifact required before live promotion",
                    "exclusive DuckDB writer lock evidence required before live promotion",
                    "restore execution explicitly scoped out of native claim",
                    "manual IMPORT DATABASE run outside the scoped claim"
                ],
                "residualRisk": "IMPORT DATABASE can replace local schemas; execution is explicitly scoped out until rollback/snapshot, exclusive writer-lock, post-restore validation, and confirmation semantics are native"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "duckdb.database.backup",
        "mode": mode,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .or_else(|| string_parameter(parameters, "targetFolder"))
                .or_else(|| string_parameter(parameters, "outputFolder"))
                .unwrap_or_else(|| "<selected-folder>".into())
        },
        "statement": format!("export database '<selected-folder>' (format {});", safe_duckdb_format_keyword(&format)),
        "databaseLockBoundary": duckdb_database_lock_boundary_contract("duckdb.database.backup", false),
        "formatPreflight": duckdb_format_preflight_contract(&format, "backup"),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "desktop adapter execution only",
                "absolute backup folder",
                "empty target folder",
                "parquet/csv backup format allowlist",
                "database file read/open preflight",
                "format capability preflight"
            ],
            "residualRisk": "IMPORT DATABASE restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    if let Some(table) = string_parameter(parameters, "targetTable")
        .or_else(|| string_parameter(parameters, "tableName"))
        .or_else(|| string_parameter(parameters, "table"))
    {
        let explicit_schema = string_parameter(parameters, "schema");
        let parts = table
            .split('.')
            .map(clean_duckdb_identifier)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        return match parts.as_slice() {
            [table] => (
                explicit_schema.unwrap_or_else(|| "main".into()),
                table.clone(),
            ),
            [schema, table, ..] => (
                explicit_schema.unwrap_or_else(|| schema.clone()),
                table.clone(),
            ),
            _ => (
                explicit_schema.unwrap_or_else(|| "main".into()),
                "<table>".into(),
            ),
        };
    }

    let parts = object_name
        .split('.')
        .map(clean_duckdb_identifier)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => ("main".into(), table.clone()),
        [schema, table, ..] => (schema.clone(), table.clone()),
        _ => ("main".into(), "<table>".into()),
    }
}

fn clean_duckdb_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .to_string()
}

fn duckdb_qualified_identifier(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        duckdb_quoted_identifier(schema),
        duckdb_quoted_identifier(table)
    )
}

fn duckdb_quoted_identifier(value: &str) -> String {
    format!(
        "\"{}\"",
        clean_duckdb_identifier(value).replace('"', "\"\"")
    )
}

fn duckdb_file_extension(format: &str) -> &'static str {
    match format {
        "csv" => "csv",
        "json" | "jsonl" | "ndjson" => "json",
        _ => "parquet",
    }
}

fn duckdb_format_preflight_contract(format: &str, workflow: &str) -> Value {
    let required_extension = match format {
        "json" | "jsonl" | "ndjson" => Some("json"),
        "parquet" => Some("parquet"),
        _ => None,
    };

    serde_json::json!({
        "format": format,
        "workflow": workflow,
        "extensionBacked": required_extension.is_some(),
        "requiredExtension": required_extension,
        "extensionExecutionBoundary": duckdb_format_extension_execution_boundary(
            format,
            workflow,
            required_extension
        ),
        "checks": if required_extension.is_some() {
            vec!["duckdb_extensions catalog probe", "operation-level read/write validation"]
        } else {
            vec!["bundled DuckDB CSV reader/writer"]
        }
    })
}

fn duckdb_format_extension_execution_boundary(
    format: &str,
    workflow: &str,
    required_extension: Option<&str>,
) -> Value {
    let Some(required_extension) = required_extension else {
        return serde_json::json!({
            "executionPolicy": "bundled-native",
            "nativeClaim": "bundled-csv-reader-writer",
            "format": format,
            "workflow": workflow,
            "extensionBacked": false,
            "operationValidated": "desktop-runtime-required",
            "networkAutoloadAllowed": false,
            "extensionInstallExecutionIncluded": false,
            "blockedReasons": Vec::<String>::new()
        });
    };

    serde_json::json!({
        "executionPolicy": "preloaded-extension-required",
        "nativeClaim": "preloaded-extension-only",
        "format": format,
        "workflow": workflow,
        "extensionBacked": true,
        "requiredExtension": required_extension,
        "installedValidated": "desktop-runtime-required",
        "loadedValidated": "desktop-runtime-required",
        "operationValidated": "desktop-runtime-required",
        "networkAutoloadAllowed": false,
        "extensionInstallExecutionIncluded": false,
        "manualInstallLoadOutsideScopedClaim": true,
        "promotionRequires": [
            "preloaded DuckDB extension evidence",
            "offline extension source provenance",
            "controlled extension_directory evidence",
            "extension-backed operation fixture",
            "no network autoload or install during file workflow"
        ],
        "blockedReasons": [
            "extension-backed-format-requires-runtime-preflight",
            "extension-install-load-scoped-out"
        ]
    })
}

fn duckdb_database_lock_boundary_contract(workflow: &str, requires_write_access: bool) -> Value {
    let mut checks = vec![
        "parent folder exists",
        "database file exists",
        "filesystem read-open probe",
    ];
    if requires_write_access {
        checks.push("filesystem write-open probe");
    }
    checks.extend(["DuckDB adapter open probe", "read-only disk guard"]);

    serde_json::json!({
        "policy": "desktop-preflight-required",
        "workflow": workflow,
        "scope": "local-duckdb-file",
        "requiresWriteAccess": requires_write_access,
        "checks": checks,
        "crossProcessContentionValidated": "desktop-fixture-required",
        "exclusiveWriterLockValidated": false,
        "promotionRequires": [
            "external-process contention fixture",
            "exclusive DuckDB writer lock acquisition evidence",
            "operation-scoped transaction or rollback artifact",
            "post-operation catalog validation",
            "read-only connection promotion block"
        ],
        "scopedResiduals": [
            "external process contention is not part of the default fixture claim",
            "exclusive writer-lock evidence is required before admin or restore execution promotion"
        ]
    })
}

fn duckdb_restore_preflight_contract(format: &str) -> Value {
    serde_json::json!({
        "format": format,
        "sourcePackageValidated": "desktop-preflight-required",
        "operationValidated": false,
        "checks": [
            "absolute source folder",
            "folder readable",
            "schema.sql marker",
            "load.sql marker",
            "backup file count and byte summary",
            "target database write/open preflight"
        ],
        "expectedFormats": ["csv", "parquet"]
    })
}

fn duckdb_restore_execution_boundary_contract(mode: &str) -> Value {
    serde_json::json!({
        "executionPolicy": "scoped-out",
        "mode": mode,
        "nativeClaim": "restore-preflight-only",
        "destructive": true,
        "targetMayReplaceCatalog": true,
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "sourcePackageValidated": "desktop-preflight-required",
        "targetWriteOpenValidated": "desktop-preflight-required",
        "previewValidated": "desktop-preflight-required",
        "promotionRequires": [
            "exclusive DuckDB writer lock evidence",
            "target snapshot or rollback artifact before IMPORT DATABASE",
            "post-restore catalog diff and validation",
            "explicit destructive restore confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": ["restore-execution-scoped-out"]
    })
}

fn duckdb_extension_operation_request(operation: &str, extension: &str) -> String {
    let extension = safe_duckdb_extension_name(extension);
    let workflow = format!("duckdb.extension.{operation}-preview");
    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": workflow,
        "operation": operation,
        "extensionName": extension,
        "statement": format!("{operation} {extension};"),
        "extensionPreflight": {
            "extensionName": extension,
            "catalogProbe": "duckdb_extensions()",
            "installedState": "desktop-preflight-required",
            "loadedState": "desktop-preflight-required",
            "extensionDirectory": "controlled by connection tempDirectory or database parent",
            "networkAccess": if operation == "install" { "blocked-by-default" } else { "not-required-when-already-installed" },
            "nativeCodeExecution": "blocked-until-explicit-live-gate"
        },
        "extensionExecutionBoundary": duckdb_extension_execution_boundary(operation, &extension),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "plan-only",
            "requiresConfirmation": true,
            "guards": [
                "sanitized extension name",
                "duckdb_extensions catalog probe",
                "controlled extension_directory",
                "no network auto-install in default workflows",
                "installed-before-load check",
                "native extension code execution review",
                "read-only connection blocked for executable promotion"
            ],
            "residualRisk": "DuckDB extensions can download or execute native code; install/load execution remains scoped out until offline source and native-code trust gates are live"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_admin_operation_request(
    workflow: &str,
    operation: &str,
    target_kind: &str,
    target_name: &str,
    statement: &str,
    data_or_catalog_mutation: bool,
    requires_write: bool,
) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": workflow,
        "operation": operation,
        "target": {
            "kind": target_kind,
            "name": target_name
        },
        "statement": statement,
        "adminScope": {
            "executionPolicy": "plan-only",
            "dataOrCatalogMutation": data_or_catalog_mutation,
            "requiresWriteAccess": requires_write,
            "rollbackRequiredBeforePromotion": data_or_catalog_mutation,
            "scopedClaim": "excluded-until-live-admin-guard"
        },
        "adminExecutionBoundary": duckdb_admin_execution_boundary(
            operation,
            target_kind,
            target_name,
            data_or_catalog_mutation,
            requires_write
        ),
        "executionGate": {
            "owner": "duckdb-adapter",
            "defaultSupport": "plan-only",
            "requiresConfirmation": true,
            "guards": [
                "database file write/open preflight",
                "cross-process lock probe",
                "object identity and diff preview",
                "rollback or backup boundary review",
                "read-only connection blocked for executable promotion",
                "confirmation required before live admin promotion"
            ],
            "residualRisk": "DuckDB admin and DDL execution can mutate local analytics files; execution remains scoped out until lock, rollback, and identity boundaries are live"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn duckdb_admin_execution_boundary(
    operation: &str,
    target_kind: &str,
    target_name: &str,
    data_or_catalog_mutation: bool,
    requires_write: bool,
) -> Value {
    let mut blocked_reasons = vec!["duckdb-admin-execution-scoped-out"];
    if data_or_catalog_mutation {
        blocked_reasons.push("data-or-catalog-mutation-scoped-out");
    }
    if requires_write {
        blocked_reasons.push("requires-write-access");
    }

    serde_json::json!({
        "executionPolicy": "scoped-out",
        "nativeClaim": "admin-preview-only",
        "operation": operation,
        "target": {
            "kind": target_kind,
            "name": target_name
        },
        "dataOrCatalogMutation": data_or_catalog_mutation,
        "requiresWriteAccess": requires_write,
        "localDatabaseMayChange": requires_write,
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "previewValidated": "contract-only",
        "promotionRequires": [
            "exclusive DuckDB writer lock evidence",
            "target snapshot or rollback artifact before data/catalog mutation",
            "object identity and before/after diff preview",
            "post-operation catalog or statistics validation",
            "explicit admin confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": blocked_reasons
    })
}

fn duckdb_extension_execution_boundary(operation: &str, extension: &str) -> Value {
    serde_json::json!({
        "executionPolicy": "scoped-out",
        "nativeClaim": "extension-preflight-only",
        "operation": operation,
        "extensionName": extension,
        "nativeCodeExecution": true,
        "networkAccess": if operation == "install" { "blocked-by-default" } else { "not-required-when-already-installed" },
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "previewValidated": "contract-only",
        "promotionRequires": [
            "offline extension source provenance",
            "controlled extension_directory evidence",
            "installed-state evidence before load",
            "native-code trust review",
            "explicit extension execution confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": [
            "duckdb-extension-execution-scoped-out",
            "native-code-trust-gate-missing",
            if operation == "install" {
                "network-install-scoped-out"
            } else {
                "installed-state-live-check-required"
            }
        ]
    })
}

fn safe_duckdb_format_keyword(format: &str) -> &'static str {
    match format {
        "csv" => "csv",
        "json" | "jsonl" | "ndjson" => "json",
        _ => "parquet",
    }
}

fn safe_duckdb_extension_name(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || item == '_' {
                item.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(80)
        .collect::<String>();

    if cleaned.is_empty() {
        "parquet".into()
    } else {
        cleaned
    }
}
