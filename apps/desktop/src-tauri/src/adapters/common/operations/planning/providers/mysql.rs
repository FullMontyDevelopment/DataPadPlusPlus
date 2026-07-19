use super::super::*;

pub(super) fn mysql_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> Option<String> {
    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return Some(mysql_import_export_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return Some(mysql_backup_restore_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if mysql_table_maintenance_operation(operation_id).is_some() {
        return Some(mysql_table_maintenance_request(
            manifest,
            operation_id,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("routine.execute") {
        return Some(mysql_routine_execute_request(
            manifest,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("event.enable") || operation_id.ends_with("event.disable") {
        return Some(mysql_event_state_request(
            manifest,
            operation_id,
            object_name,
            parameters,
        ));
    }

    if operation_id.ends_with("user.lock") || operation_id.ends_with("user.unlock") {
        return Some(mysql_user_account_request(
            manifest,
            operation_id,
            parameters,
        ));
    }

    if operation_id.ends_with("security.inspect") {
        return Some(mysql_security_inspect_request(manifest, parameters));
    }

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some(mysql_diagnostics_metrics_request());
    }

    if operation_id.ends_with("query.profile") {
        if manifest.engine == "mariadb" {
            return Some(format!(
                "analyze format=json select * from {object_name} limit 100;"
            ));
        }
        return Some(format!(
            "explain analyze select * from {object_name} limit 100;"
        ));
    }

    None
}

fn mysql_table_maintenance_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let operation = mysql_table_maintenance_operation(operation_id).unwrap_or("check");
    let (database, table) = mysql_plan_table_parts(object_name, parameters);
    let statement = format!("{operation} table {object_name};");
    let mut guards = vec![
        "verify target table exists and belongs to the selected database",
        "inspect storage engine support before running",
        "review lock and replication impact",
        "block execution on read-only connections",
    ];
    if operation == "repair" {
        guards.push("require owner/admin confirmation and a recent backup before repair");
    } else {
        guards.push("require explicit confirmation before costly maintenance");
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.table.maintenance", manifest.engine),
        "operation": operation,
        "database": database,
        "table": table,
        "statement": statement,
        "lockImpact": mysql_maintenance_lock_impact(operation),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": format!(
                "{} TABLE remains preview-first until the desktop adapter verifies table engine support, privileges, lock impact, and rollback boundaries.",
                operation.to_ascii_uppercase()
            ),
            "requiredPrivileges": mysql_maintenance_privileges(operation),
            "guards": guards,
            "residualRisk": "MyISAM and InnoDB differ in CHECK/REPAIR/OPTIMIZE behavior; live execution stays out of scope until fixture-backed."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_routine_execute_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (database, routine) = mysql_routine_parts(object_name, parameters);
    let routine_kind = string_parameter(parameters, "routineKind")
        .unwrap_or_else(|| "procedure".into())
        .to_ascii_lowercase();
    let routine_kind = if routine_kind.contains("function") {
        "function"
    } else {
        "procedure"
    };
    let arguments = string_parameter(parameters, "arguments")
        .or_else(|| string_parameter(parameters, "routineArguments"))
        .unwrap_or_default();
    let routine_arguments = mysql_routine_arguments(&arguments);
    let placeholders = routine_arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| {
            if argument.name.is_empty() {
                format!("? /* arg{} */", index + 1)
            } else {
                format!("{} => ?", argument.name)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let statement = if routine_kind == "function" {
        format!("select {object_name}({placeholders});")
    } else {
        format!("call {object_name}({placeholders});")
    };
    let bindings = routine_arguments
        .iter()
        .map(|argument| {
            serde_json::json!({
                "position": argument.position,
                "direction": argument.direction,
                "name": argument.name,
                "type": argument.type_name,
                "placeholder": "?"
            })
        })
        .collect::<Vec<_>>();

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.routine.execute", manifest.engine),
        "database": database,
        "routine": routine,
        "routineKind": routine_kind,
        "statement": statement,
        "bindings": bindings,
        "returns": string_parameter(parameters, "returns"),
        "language": string_parameter(parameters, "language").unwrap_or_else(|| "SQL".into()),
        "securityMode": string_parameter(parameters, "security").unwrap_or_else(|| "review definer/invoker metadata".into()),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL routine execution remains preview-first until parameter binding, OUT/INOUT capture, SQL SECURITY mode, and EXECUTE privilege checks are live-validated.",
            "requiredPrivileges": [
                "EXECUTE privilege on the routine",
                "read/write privileges required by the routine body"
            ],
            "guards": [
                "bind every IN parameter explicitly",
                "review OUT and INOUT parameters before running",
                "review SQL SECURITY DEFINER versus INVOKER semantics",
                "block mutating routines on read-only connections",
                "show the generated CALL/SELECT statement before execution"
            ],
            "residualRisk": "Stored routines can perform writes, dynamic SQL, or privileged work through definers; this preview does not claim live side-effect containment."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_event_state_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let action = if operation_id.ends_with("event.enable") {
        "enable"
    } else {
        "disable"
    };
    let (database, event_name) = mysql_event_parts(object_name, parameters);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.event.toggle", manifest.engine),
        "operation": action,
        "database": database,
        "event": event_name,
        "statement": format!("alter event {object_name} {action};"),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL event state changes remain preview-first until EVENT privilege, event scheduler state, definer, and schedule metadata are verified live.",
            "requiredPrivileges": [
                "EVENT privilege on the schema",
                "ALTER privilege for the selected event where required"
            ],
            "guards": [
                "verify event exists in the selected schema",
                "review event_scheduler global state",
                "review definer account and SQL SECURITY behavior",
                "review schedule, starts/ends, and time zone before toggling",
                "block execution on read-only connections"
            ],
            "residualRisk": "Toggling events can start background writes or stop maintenance jobs; live execution needs fixture-backed scheduler evidence."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_user_account_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let action = if operation_id.ends_with("user.lock") {
        "lock"
    } else {
        "unlock"
    };
    let user_name = string_parameter(parameters, "userName")
        .or_else(|| string_parameter(parameters, "roleName"))
        .unwrap_or_else(|| "<user>".into());
    let user_host = string_parameter(parameters, "userHost")
        .or_else(|| string_parameter(parameters, "host"))
        .unwrap_or_else(|| "%".into());
    let account = mysql_account_literal(&user_name, &user_host);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.user.account-state", manifest.engine),
        "operation": action,
        "user": user_name,
        "host": user_host,
        "statement": format!("alter user {account} account {action};"),
        "executionGate": {
            "defaultSupport": "plan-only",
            "disabledReason": "MySQL account lock/unlock remains preview-first until CREATE USER/ACCOUNT MANAGEMENT privilege checks and active-session impact are live-validated.",
            "requiredPrivileges": [
                "CREATE USER or SYSTEM_USER-compatible account management privilege"
            ],
            "guards": [
                "verify user@host identity before generating ALTER USER",
                "review current account_locked and password_expired state",
                "warn about active sessions and application connection pools",
                "block execution on read-only connections",
                "require explicit confirmation before changing account state"
            ],
            "residualRisk": "Host wildcards and role-like accounts can affect more clients than expected; live execution needs principal selection UI."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_security_inspect_request(
    manifest: &AdapterManifest,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "schema"))
        .unwrap_or_else(|| "<database>".into());
    let database_literal = mysql_string_literal(&database);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{}.security.inspect", manifest.engine),
        "database": database,
        "statements": [
            "show grants;",
            "select current_user() as currentUser, user() as sessionUser;",
            "select user, host, plugin, account_locked, password_expired from mysql.user order by user, host;",
            "select grantee, privilege_type, is_grantable from information_schema.user_privileges order by grantee, privilege_type;",
            format!("select grantee, table_schema, privilege_type, is_grantable from information_schema.schema_privileges where table_schema = {database_literal} order by grantee, privilege_type;"),
            format!("select grantee, table_schema, table_name, privilege_type, is_grantable from information_schema.table_privileges where table_schema = {database_literal} order by table_name, grantee, privilege_type;")
        ],
        "executionGate": {
            "defaultSupport": "live",
            "requiredPrivileges": [
                "SHOW GRANTS visibility",
                "mysql.user or INFORMATION_SCHEMA privilege visibility"
            ],
            "guards": [
                "redact principal names from exported diagnostics where configured",
                "tolerate hidden mysql.* tables when the login lacks catalog privileges",
                "separate global, schema, table, and routine grants",
                "never infer write privilege from missing grant rows"
            ],
            "residualRisk": "Managed MySQL services can hide mysql.user or role_edges; unavailable surfaces must render disabled reasons instead of empty success."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_import_export_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let (database, table) = mysql_plan_table_parts(object_name, parameters);
    let row_limit = numeric_parameter(parameters, "rowLimit")
        .or_else(|| numeric_parameter(parameters, "limit"))
        .unwrap_or(10_000);
    let import_like = matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    );
    let default_support = if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
        "live"
    } else {
        "plan-only"
    };
    let workflow_prefix = manifest.engine.as_str();
    let bulk_export_tools = if manifest.engine == "mariadb" {
        "mariadb-dump/mysql"
    } else {
        "mysqlpump/mysqldump"
    };

    if import_like {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": format!("{workflow_prefix}.table.import"),
            "database": database,
            "schema": database,
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
                "defaultSupport": default_support,
                "guards": [
                    "desktop adapter execution only",
                    "absolute source path",
                    "existing target table",
                    "insertable target-column validation",
                    "bounded row import",
                    "read-only connection blocked",
                    "explicit confirmation required before append"
                ],
                "residualRisk": "LOAD DATA INFILE, generated column mapping, and full dump import workflows remain manual preview paths"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{workflow_prefix}.table.export"),
        "database": database,
        "schema": database,
        "table": table,
        "format": format,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "rowLimit": row_limit,
        "serialization": "SELECT rows through the desktop adapter, then local CSV/JSON/NDJSON writer",
        "executionGate": {
            "defaultSupport": default_support,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded row export"
            ],
            "residualRisk": format!("server-side INTO OUTFILE and {bulk_export_tools} bulk workflows remain manual preview paths")
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn mysql_backup_restore_request(
    manifest: &AdapterManifest,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let database = string_parameter(parameters, "database")
        .or_else(|| string_parameter(parameters, "schema"))
        .or_else(|| mysql_plan_database_name(object_name))
        .unwrap_or_else(|| "database".into());
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
    let default_support = if matches!(manifest.engine.as_str(), "mysql" | "mariadb") {
        "live"
    } else {
        "plan-only"
    };
    let workflow_prefix = manifest.engine.as_str();
    let restore_tools = if manifest.engine == "mariadb" {
        "mariadb-dump/mysql"
    } else {
        "mysqldump/mysql"
    };

    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": format!("{workflow_prefix}.database.restore"),
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
                    "review schema DDL, triggers, routines, events, privileges, generated columns, and target database state"
                ],
                "residualRisk": format!("full {restore_tools} restore and generated insert replay remain manual reviewed workflows")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("{workflow_prefix}.database.backup"),
        "database": database,
        "target": {
            "path": string_parameter(parameters, "targetPath")
                .or_else(|| string_parameter(parameters, "outputPath"))
                .unwrap_or_else(|| format!("<selected-file>.{format}")),
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false)
        },
        "schema": string_parameter(parameters, "schema"),
        "format": format,
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(1_000),
        "tableLimit": numeric_parameter(parameters, "tableLimit").unwrap_or(25),
        "executionGate": {
            "defaultSupport": default_support,
            "guards": [
                "desktop adapter execution only",
                "absolute target path",
                "parent folder exists",
                "overwrite opt-in",
                "bounded table list",
                "bounded rows per table",
                "logical package restore validation"
            ],
            "residualRisk": format!("bounded logical DataPad++ backup package; full {restore_tools} restore execution remains preview-first")
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

struct MysqlRoutineArgument {
    position: usize,
    direction: String,
    name: String,
    type_name: String,
}

fn mysql_table_maintenance_operation(operation_id: &str) -> Option<&'static str> {
    if operation_id.ends_with("table.analyze") {
        return Some("analyze");
    }
    if operation_id.ends_with("table.optimize") {
        return Some("optimize");
    }
    if operation_id.ends_with("table.check") {
        return Some("check");
    }
    if operation_id.ends_with("table.repair") {
        return Some("repair");
    }
    None
}

fn mysql_maintenance_lock_impact(operation: &str) -> &'static str {
    match operation {
        "check" => "metadata and engine-dependent read locks",
        "analyze" => "statistics refresh can sample or scan index pages",
        "optimize" => "may rebuild or copy table data depending on engine",
        _ => "engine-dependent repair can rebuild indexes or modify table files",
    }
}

fn mysql_maintenance_privileges(operation: &str) -> Vec<&'static str> {
    match operation {
        "check" => vec!["SELECT privilege on the target table"],
        "analyze" => vec![
            "INSERT or UPDATE privilege on the target table in MySQL 8.0.31+, or table ownership/admin equivalent",
        ],
        "optimize" => vec![
            "INSERT and SELECT privilege on the target table, or table ownership/admin equivalent",
        ],
        _ => vec!["REPAIR privilege on the target table, or table ownership/admin equivalent"],
    }
}

fn mysql_routine_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_routine = string_parameter(parameters, "routineName")
        .or_else(|| string_parameter(parameters, "routine"));
    if let Some(routine) = explicit_routine {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            routine,
        );
    }
    mysql_plan_table_parts(object_name, parameters)
}

fn mysql_event_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_event =
        string_parameter(parameters, "eventName").or_else(|| string_parameter(parameters, "event"));
    if let Some(event) = explicit_event {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            event,
        );
    }
    mysql_plan_table_parts(object_name, parameters)
}

fn mysql_routine_arguments(arguments: &str) -> Vec<MysqlRoutineArgument> {
    split_mysql_routine_arguments(arguments)
        .into_iter()
        .enumerate()
        .map(|(index, argument)| {
            let mut parts = argument
                .split_whitespace()
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            let direction = if parts.first().is_some_and(|part| {
                matches!(part.to_ascii_lowercase().as_str(), "in" | "out" | "inout")
            }) {
                parts.remove(0).to_ascii_uppercase()
            } else {
                "IN".into()
            };
            let name = parts
                .first()
                .map(|part| {
                    clean_mysql_identifier(part)
                        .trim_start_matches('@')
                        .to_string()
                })
                .filter(|part| !part.is_empty())
                .unwrap_or_else(|| format!("arg{}", index + 1));
            if !parts.is_empty() {
                parts.remove(0);
            }
            let type_name = if parts.is_empty() {
                "unknown".into()
            } else {
                parts.join(" ")
            };
            MysqlRoutineArgument {
                position: index + 1,
                direction,
                name,
                type_name,
            }
        })
        .collect()
}

fn split_mysql_routine_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for item in arguments.chars() {
        match item {
            '(' => {
                depth += 1;
                current.push(item);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(item);
            }
            ',' if depth == 0 => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => current.push(item),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn mysql_account_literal(user: &str, host: &str) -> String {
    format!(
        "'{}'@'{}'",
        user.replace('\'', "''"),
        host.replace('\'', "''")
    )
}

fn mysql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn mysql_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let explicit_database =
        string_parameter(parameters, "database").or_else(|| string_parameter(parameters, "schema"));
    let explicit_table =
        string_parameter(parameters, "table").or_else(|| string_parameter(parameters, "tableName"));
    if let Some(table) = explicit_table {
        return (
            explicit_database.unwrap_or_else(|| "database".into()),
            table,
        );
    }

    let parts = split_mysql_name(object_name)
        .into_iter()
        .map(|part| clean_mysql_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => (
            explicit_database.unwrap_or_else(|| "database".into()),
            table.clone(),
        ),
        [database, table, ..] => (
            explicit_database.unwrap_or_else(|| database.clone()),
            table.clone(),
        ),
        _ => (
            explicit_database.unwrap_or_else(|| "database".into()),
            "<table>".into(),
        ),
    }
}

fn mysql_plan_database_name(object_name: &str) -> Option<String> {
    let parts = split_mysql_name(object_name)
        .into_iter()
        .map(|part| clean_mysql_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    (parts.len() == 1).then(|| parts[0].clone())
}

fn split_mysql_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut quote = None::<char>;
    let mut bracket_depth = 0u8;

    while let Some(ch) = chars.next() {
        match ch {
            '`' if quote == Some('`') && chars.peek() == Some(&'`') => {
                current.push('`');
                chars.next();
            }
            '"' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '`' | '"' if bracket_depth == 0 => {
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

fn clean_mysql_identifier(value: &str) -> String {
    let trimmed = value.trim();
    let unwrapped = trimmed
        .strip_prefix('`')
        .and_then(|item| item.strip_suffix('`'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('[')
                .and_then(|item| item.strip_suffix(']'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("``", "`")
        .replace("\"\"", "\"")
        .replace("]]", "]")
}

fn mysql_diagnostics_metrics_request() -> String {
    [
        "show global status;",
        "select id, user, db, command, state, time from information_schema.processlist order by time desc limit 100;",
        "select digest_text, count_star, sum_timer_wait, avg_timer_wait, max_timer_wait, sum_rows_examined, sum_rows_sent from performance_schema.events_statements_summary_by_digest order by sum_timer_wait desc limit 50;",
        "select object_schema, object_name, index_name, count_star, count_read, count_write, sum_timer_wait from performance_schema.table_io_waits_summary_by_index_usage order by sum_timer_wait desc limit 100;",
        "select object_schema, object_name, object_type, lock_type, lock_duration, lock_status, owner_thread_id from performance_schema.metadata_locks order by lock_status, object_schema, object_name limit 100;",
        "select @@optimizer_trace, @@optimizer_trace_limit, @@optimizer_trace_max_mem_size;",
        "select query, trace, missing_bytes_beyond_max_mem_size, insufficient_privileges from information_schema.optimizer_trace limit 5;",
    ]
    .join("\n")
}
