use super::super::*;

pub(super) fn sqlserver_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
    parameter_json: &str,
) -> String {
    if operation_id.ends_with("index.create") {
        return format!(
            "create index [IX_{}_id] on {object_name} ([id]);",
            safe_sqlserver_name(object_name)
        );
    }

    if operation_id.ends_with("index.drop") {
        let index_name = safe_sqlserver_index_name(parameters);
        let target = sqlserver_target_object(object_name, parameters);
        return format!("-- Review before running.\ndrop index {index_name} on {target};");
    }

    if operation_id.ends_with("statistics.update") {
        return format!(
            "update statistics {} with fullscan;",
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return sqlserver_import_export_request(object_name, parameters);
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return sqlserver_backup_restore_request(object_name, parameters);
    }

    if operation_id.ends_with("index.rebuild") {
        return format!(
            "alter index {} on {} rebuild with (online = on);",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.reorganize") {
        return format!(
            "alter index {} on {} reorganize;",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.disable") {
        return format!(
            "-- Review carefully before disabling an index.\nalter index {} on {} disable;",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("index.enable") {
        return format!(
            "alter index {} on {} rebuild with (online = on);",
            safe_sqlserver_index_name(parameters),
            sqlserver_target_object(object_name, parameters)
        );
    }

    if operation_id.ends_with("query-store.top-queries")
        || operation_id.ends_with("query-store")
        || operation_id.contains("query-store")
    {
        return "select top (50)\n  qsq.query_id,\n  qsp.plan_id,\n  rs.avg_duration,\n  rs.count_executions\nfrom sys.query_store_query qsq\njoin sys.query_store_plan qsp on qsq.query_id = qsp.query_id\njoin sys.query_store_runtime_stats rs on qsp.plan_id = rs.plan_id\norder by rs.avg_duration desc;".into();
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "select name, state_desc from sys.databases order by name;".into(),
        "execute" => format!("select top 100 * from {object_name};"),
        "explain" => format!("set showplan_text on;\nselect top 100 * from {object_name};\nset showplan_text off;"),
        "profile" => format!("-- SQL Server XML Showplan does not execute the statement, but it reveals estimated optimizer shape.\nset showplan_xml on;\nselect top 100 * from {object_name};\nset showplan_xml off;"),
        "create" => format!("create table {object_name} (\n  [id] int identity(1, 1) not null primary key,\n  [created_at] datetime2 not null default sysutcdatetime()\n);"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
        "inspect" => "select * from sys.database_permissions;\nselect * from sys.database_principals;".into(),
        "metrics" => "select top 50 * from sys.dm_exec_query_stats order by total_elapsed_time desc;\nselect * from sys.dm_exec_requests;\nselect * from sys.dm_os_wait_stats;\nselect * from sys.dm_io_virtual_file_stats(db_id(), null);\nselect * from sys.dm_exec_query_memory_grants;".into(),
        _ => format!("-- SQL Server {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn sqlserver_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (schema, table) = sqlserver_workflow_table_parts(object_name, parameters);
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    );

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlserver.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| format!("<selected-file>.{format}"))
            },
            "mode": mode,
            "rowLimit": row_limit,
            "emptyStringAsNull": bool_parameter(parameters, "emptyStringAsNull").unwrap_or(false),
            "executionGate": {
                "defaultSupport": "live",
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "existing target table",
                    "insertable target-column validation",
                    "bounded row import",
                    "read-only connection blocked",
                    "explicit confirmation required before append"
                ],
                "residualRisk": "bulk load and identity-insert workflows remain manual preview paths"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "sqlserver.table.export",
        "schema": schema,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "serialization": "FOR JSON PATH, INCLUDE_NULL_VALUES, then local CSV/JSON/NDJSON writer",
        "executionGate": {
            "defaultSupport": "live",
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export"
            ],
            "residualRisk": "server-side bcp/sqlcmd bulk workflows remain manual preview paths"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn sqlserver_backup_restore_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let database = string_parameter(parameters, "database")
        .or_else(|| sqlserver_workflow_database_name(object_name))
        .unwrap_or_else(|| "database".into());
    let row_limit = numeric_parameter(parameters, "rowLimit").unwrap_or(1_000);
    let table_limit = numeric_parameter(parameters, "tableLimit").unwrap_or(25);

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlserver.database.restore",
            "database": database,
            "source": {
                "path": string_parameter(parameters, "sourcePath")
                    .or_else(|| string_parameter(parameters, "inputPath"))
                    .unwrap_or_else(|| "<selected-file>.json".into())
            },
            "mode": mode,
            "executionGate": {
                "defaultSupport": "plan-only",
                "guards": [
                    "restore execution remains preview-first",
                    "validate package before manual restore",
                    "review schema DDL, identity columns, triggers, constraints, and target database state"
                ],
                "residualRisk": "native .bak restore and generated insert replay remain manual reviewed workflows"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": "sqlserver.database.backup",
        "database": database,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| "<selected-file>.json".into()),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "schema": string_parameter(parameters, "schema"),
        "format": string_parameter(parameters, "format").unwrap_or_else(|| "json".into()),
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "rowLimit": row_limit,
        "tableLimit": table_limit,
        "executionGate": {
            "defaultSupport": "live",
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded table list",
                "bounded rows per table"
            ],
            "residualRisk": "bounded logical DataPad++ backup package; native .bak backup/restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn sqlserver_workflow_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_schema = string_parameter(parameters, "schema");
    let explicit_table =
        string_parameter(parameters, "table").or_else(|| string_parameter(parameters, "tableName"));
    if let Some(table) = explicit_table {
        return (explicit_schema.unwrap_or_else(|| "dbo".into()), table);
    }

    let parts = split_sqlserver_name(object_name)
        .into_iter()
        .map(|part| clean_sqlserver_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => (
            explicit_schema.unwrap_or_else(|| "dbo".into()),
            table.clone(),
        ),
        [schema, table, ..] => (
            explicit_schema.unwrap_or_else(|| schema.clone()),
            table.clone(),
        ),
        _ => (
            explicit_schema.unwrap_or_else(|| "dbo".into()),
            "<table>".into(),
        ),
    }
}

fn sqlserver_workflow_database_name(object_name: &str) -> Option<String> {
    let parts = split_sqlserver_name(object_name)
        .into_iter()
        .map(|part| clean_sqlserver_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    (parts.len() == 1).then(|| parts[0].clone())
}

fn split_sqlserver_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut bracket_depth = 0u8;
    let mut quote = None::<char>;

    for ch in value.chars() {
        match ch {
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '"' | '`' if bracket_depth == 0 => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                }
                current.push(ch);
            }
            '.' if bracket_depth == 0 && quote.is_none() => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn clean_sqlserver_identifier(value: &str) -> String {
    let trimmed = value.trim();
    let unwrapped = trimmed
        .strip_prefix('[')
        .and_then(|item| item.strip_suffix(']'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('`')
                .and_then(|item| item.strip_suffix('`'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("]]", "]")
        .replace("\"\"", "\"")
        .replace("``", "`")
}

fn safe_sqlserver_name(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(80)
        .collect::<String>()
}

fn safe_sqlserver_index_name(parameters: Option<&BTreeMap<String, Value>>) -> String {
    string_parameter(parameters, "indexName")
        .map(|value| sqlserver_quoted_identifier(&value))
        .unwrap_or_else(|| "[IX_name]".into())
}

fn sqlserver_target_object(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let table = string_parameter(parameters, "table");
    if let Some(table) = table {
        if let Some(schema) = string_parameter(parameters, "schema") {
            return format!(
                "{}.{}",
                sqlserver_quoted_identifier(&schema),
                sqlserver_quoted_identifier(&table)
            );
        }
        return sqlserver_quoted_identifier(&table);
    }

    object_name.into()
}

fn sqlserver_quoted_identifier(value: &str) -> String {
    let cleaned = strip_identifier_wrapper(value);
    format!("[{}]", cleaned.replace(']', "]]"))
}
