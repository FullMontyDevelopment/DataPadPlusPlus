use super::super::*;

pub(super) fn postgres_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> Option<String> {
    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return Some(postgres_import_export_request(object_name, parameters));
    }

    if operation_id.ends_with("data.backup-restore") || operation_id.contains("backup-restore") {
        return Some(postgres_backup_restore_request(object_name, parameters));
    }

    if operation_id.ends_with("query.profile") {
        let statement = string_parameter(parameters, "query")
            .or_else(|| string_parameter(parameters, "sql"))
            .unwrap_or_else(|| format!("select * from {object_name} limit 100"));
        let analyze = bool_parameter(parameters, "analyze").unwrap_or(true);
        let buffers = bool_parameter(parameters, "buffers").unwrap_or(true);
        let wal = bool_parameter(parameters, "wal").unwrap_or(false);
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
        let mut options = vec![if analyze {
            "analyze true"
        } else {
            "analyze false"
        }
        .to_string()];
        if buffers {
            options.push("buffers true".into());
        }
        if wal {
            options.push("wal true".into());
        }
        options.push("verbose true".into());
        options.push(format!("format {}", format.to_ascii_lowercase()));
        return Some(format!(
            "-- PostgreSQL query profile executes the statement; review row limits and production load first.\nexplain ({})\n{};",
            options.join(", "),
            statement.trim().trim_end_matches(';')
        ));
    }

    if operation_id.ends_with("routine.execute") {
        return Some(postgres_routine_execute_request(object_name, parameters));
    }

    if operation_id.ends_with("session.cancel") || operation_id.ends_with("session.terminate") {
        return Some(postgres_session_action_request(operation_id, parameters));
    }

    if operation_id.ends_with("table.analyze") {
        return Some(format!("analyze verbose {object_name};"));
    }

    if operation_id.ends_with("table.vacuum") {
        return Some(format!("vacuum (verbose, analyze) {object_name};"));
    }

    if operation_id.ends_with("database.analyze") {
        return Some("analyze verbose;".into());
    }

    if operation_id.ends_with("database.vacuum") {
        return Some("vacuum (verbose, analyze);".into());
    }

    if operation_id.ends_with("index.reindex") {
        return Some(format!(
            "-- REINDEX may take stronger locks; review before running.\nreindex index concurrently {object_name};"
        ));
    }

    if operation_id.ends_with("security.inspect") {
        return Some([
            "select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls from pg_roles order by rolname;",
            "select member.rolname as role, parent.rolname as member_of, m.admin_option from pg_auth_members m join pg_roles member on member.oid = m.member join pg_roles parent on parent.oid = m.roleid order by role, member_of;",
            "select grantee, privilege_type, table_schema, table_name, is_grantable from information_schema.role_table_grants order by table_schema, table_name, grantee;",
            "select * from pg_default_acl order by defaclnamespace, defaclrole;",
        ].join("\n"));
    }

    if operation_id.ends_with("role.grant") {
        let role_name =
            string_parameter(parameters, "memberOf").unwrap_or_else(|| "<member_role>".into());
        let member = string_parameter(parameters, "roleName").unwrap_or_else(|| "<role>".into());
        return Some(format!(
            "-- Review role inheritance and admin option before running.\ngrant {} to {};",
            quote_postgres_identifier(&role_name),
            quote_postgres_identifier(&member)
        ));
    }

    if operation_id.ends_with("role.revoke") {
        let role_name =
            string_parameter(parameters, "memberOf").unwrap_or_else(|| "<member_role>".into());
        let member = string_parameter(parameters, "roleName").unwrap_or_else(|| "<role>".into());
        return Some(format!(
            "-- Review dependent privileges before revoking membership.\nrevoke {} from {};",
            quote_postgres_identifier(&role_name),
            quote_postgres_identifier(&member)
        ));
    }

    if operation_id.ends_with("extension.update") {
        let extension = postgres_extension_name(parameters, object_name);
        return Some(format!(
            "-- Review extension release notes, dependency objects, and required privileges before running.\nalter extension {} update;",
            quote_postgres_identifier(&extension)
        ));
    }

    if operation_id.ends_with("extension.drop") {
        let extension = postgres_extension_name(parameters, object_name);
        return Some(format!(
            "-- Dropping extensions can drop dependent functions, types, operators, or views.\ndrop extension {};",
            quote_postgres_identifier(&extension)
        ));
    }

    if operation_id.ends_with("diagnostics.metrics") || operation_id.ends_with("metrics") {
        return Some(
            "select * from pg_stat_activity order by query_start desc nulls last limit 100;\nselect * from pg_stat_database where datname = current_database();"
                .into(),
        );
    }

    None
}

fn postgres_extension_name(
    parameters: Option<&BTreeMap<String, Value>>,
    object_name: &str,
) -> String {
    let value = string_parameter(parameters, "extensionName").unwrap_or_else(|| object_name.into());
    let candidate = value
        .split('.')
        .next_back()
        .unwrap_or(value.as_str())
        .trim()
        .trim_matches(|character| matches!(character, '"' | '`' | '[' | ']'));
    let cleaned = candidate
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if cleaned.is_empty() {
        "<extension>".into()
    } else {
        cleaned
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PostgresRoutineArgument {
    name: String,
    data_type: String,
    named: bool,
}

fn postgres_routine_execute_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (fallback_schema, fallback_routine) = postgres_plan_table_parts(object_name, parameters);
    let routine_name = string_parameter(parameters, "routineName")
        .or_else(|| string_parameter(parameters, "functionName"))
        .or_else(|| string_parameter(parameters, "procedureName"))
        .or_else(|| {
            string_parameter(parameters, "objectName").and_then(|value| {
                value
                    .split('.')
                    .next_back()
                    .map(clean_postgres_identifier)
                    .filter(|value| !value.is_empty())
            })
        })
        .unwrap_or(fallback_routine);
    let schema = string_parameter(parameters, "schema").unwrap_or(fallback_schema);
    let routine_kind = string_parameter(parameters, "routineKind")
        .or_else(|| string_parameter(parameters, "objectKind"))
        .unwrap_or_else(|| "function".into())
        .to_ascii_lowercase();
    let arguments = string_parameter(parameters, "arguments")
        .or_else(|| string_parameter(parameters, "routineArguments"))
        .unwrap_or_default();
    let returns = string_parameter(parameters, "returns")
        .or_else(|| string_parameter(parameters, "returnType"));
    let routine_arguments = postgres_routine_arguments(&arguments);
    let target = format!(
        "{}.{}",
        quote_postgres_identifier(&schema),
        quote_postgres_identifier(&routine_name)
    );
    let call_arguments = postgres_routine_call_arguments(&routine_arguments);
    let statement = if routine_kind.contains("procedure") {
        format!("call {target}({call_arguments});")
    } else {
        format!("select {target}({call_arguments}) as result;")
    };
    let mut lines = vec![
        "-- PostgreSQL routine execution preview.".to_string(),
        "-- Bind parameter values explicitly and review volatility, permissions, defaults, and result cardinality before running.".to_string(),
    ];

    if !arguments.trim().is_empty() {
        lines.push(format!("-- Signature: {}", arguments.trim()));
    }
    if let Some(returns) = returns.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("-- Returns: {}", returns.trim()));
    }
    if routine_arguments.is_empty() {
        lines.push("-- Input parameters: none detected.".into());
    } else {
        lines.push("-- Bindings:".into());
        for (index, argument) in routine_arguments.iter().enumerate() {
            lines.push(format!(
                "-- ${} {} {} = <{}>",
                index + 1,
                argument.name,
                argument.data_type,
                argument.name
            ));
        }
    }
    lines.push(statement);
    lines.join("\n")
}

fn postgres_session_action_request(
    operation_id: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let terminate = operation_id.ends_with("session.terminate");
    let pid = postgres_backend_pid(parameters);
    let pid_token = pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<backend_pid>".into());
    let function_name = if terminate {
        "pg_terminate_backend"
    } else {
        "pg_cancel_backend"
    };
    let result_name = if terminate {
        "terminate_requested"
    } else {
        "cancel_requested"
    };
    let action = if terminate {
        "terminate backend"
    } else {
        "cancel query"
    };
    let statement = if let Some(pid) = pid {
        format!(
            "select case\n  when pg_backend_pid() = {pid} then false\n  else {function_name}({pid})\nend as {result_name};"
        )
    } else {
        format!(
            "-- Provide a concrete backend PID before execution.\nselect {function_name}(<backend_pid>) as {result_name};"
        )
    };
    let impact = if terminate {
        "-- Terminating a backend disconnects the client and rolls back its active transaction."
    } else {
        "-- Canceling asks PostgreSQL to interrupt the active query while keeping the connection alive."
    };

    [
        "-- PostgreSQL backend action preview.".to_string(),
        format!("-- Action: {action}."),
        "-- Requires pg_signal_backend, matching ownership, or superuser privileges.".into(),
        "-- Verify PID, user, database, application, state, and current query before running."
            .into(),
        impact.into(),
        format!(
            "-- Target: {}",
            postgres_session_target(parameters, &pid_token)
        ),
        statement,
    ]
    .join("\n")
}

fn postgres_backend_pid(parameters: Option<&BTreeMap<String, Value>>) -> Option<u64> {
    numeric_parameter(parameters, "pid")
        .or_else(|| numeric_parameter(parameters, "backendPid"))
        .or_else(|| numeric_parameter(parameters, "sessionPid"))
        .filter(|value| *value > 0)
}

fn postgres_session_target(
    parameters: Option<&BTreeMap<String, Value>>,
    pid_token: &str,
) -> String {
    let mut parts = vec![format!("pid {pid_token}")];
    if let Some(user) = string_parameter(parameters, "sessionUser") {
        parts.push(format!("user {user}"));
    }
    if let Some(database) = string_parameter(parameters, "sessionDatabase") {
        parts.push(format!("database {database}"));
    }
    if let Some(application) = string_parameter(parameters, "application") {
        parts.push(format!("application {application}"));
    }
    if let Some(state) = string_parameter(parameters, "sessionState") {
        parts.push(format!("state {state}"));
    }
    parts.join(", ")
}

fn postgres_routine_call_arguments(arguments: &[PostgresRoutineArgument]) -> String {
    if arguments.is_empty() {
        return String::new();
    }

    let placeholders = arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| {
            let placeholder = format!("${}", index + 1);
            if argument.named {
                format!(
                    "{} => {placeholder}",
                    postgres_argument_reference(&argument.name)
                )
            } else {
                placeholder
            }
        })
        .collect::<Vec<_>>();
    format!("\n  {}\n", placeholders.join(",\n  "))
}

fn postgres_routine_arguments(arguments: &str) -> Vec<PostgresRoutineArgument> {
    let mut parsed = Vec::new();

    for part in split_postgres_arguments(arguments) {
        let cleaned = strip_postgres_argument_default(&part);
        if cleaned.is_empty() {
            continue;
        }

        let tokens = cleaned.split_whitespace().collect::<Vec<_>>();
        if tokens.is_empty() {
            continue;
        }

        let mode = tokens[0].trim_matches('"').to_ascii_lowercase();
        let has_mode = matches!(mode.as_str(), "in" | "out" | "inout" | "variadic");
        if mode == "out" {
            continue;
        }

        let offset = if has_mode { 1 } else { 0 };
        let remainder = &tokens[offset..];
        if remainder.is_empty() {
            continue;
        }

        let has_named_argument =
            remainder.len() >= 2 && !postgres_type_starts_argument(remainder[0]);
        let name = if has_named_argument {
            clean_postgres_identifier(remainder[0])
        } else {
            format!("arg{}", parsed.len() + 1)
        };
        let data_type = if has_named_argument {
            remainder[1..].join(" ")
        } else {
            remainder.join(" ")
        };

        parsed.push(PostgresRoutineArgument {
            name: if name.is_empty() {
                format!("arg{}", parsed.len() + 1)
            } else {
                name
            },
            data_type: if data_type.is_empty() {
                "<unknown>".into()
            } else {
                data_type
            },
            named: has_named_argument,
        });
    }

    parsed
}

fn split_postgres_arguments(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut previous = '\0';

    for (index, character) in value.char_indices() {
        if character == '\'' && !in_double_quote && previous != '\\' {
            in_single_quote = !in_single_quote;
        } else if character == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote && character == '(' {
            depth += 1;
        } else if !in_single_quote && !in_double_quote && character == ')' && depth > 0 {
            depth -= 1;
        } else if !in_single_quote && !in_double_quote && depth == 0 && character == ',' {
            let part = value[start..index].trim();
            if !part.is_empty() {
                parts.push(part.into());
            }
            start = index + character.len_utf8();
        }
        previous = character;
    }

    let tail = value[start..].trim();
    if !tail.is_empty() {
        parts.push(tail.into());
    }
    parts
}

fn strip_postgres_argument_default(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let cut_index = [" default ", " = "]
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min();

    cut_index
        .map(|index| value[..index].trim().to_string())
        .unwrap_or_else(|| value.trim().to_string())
}

fn postgres_type_starts_argument(token: &str) -> bool {
    let normalized = clean_postgres_identifier(token).to_ascii_lowercase();
    normalized.ends_with("[]")
        || matches!(
            normalized.as_str(),
            "bigint"
                | "bigserial"
                | "bool"
                | "boolean"
                | "box"
                | "bytea"
                | "character"
                | "cidr"
                | "circle"
                | "date"
                | "decimal"
                | "double"
                | "inet"
                | "int"
                | "int2"
                | "int4"
                | "int8"
                | "integer"
                | "interval"
                | "json"
                | "jsonb"
                | "line"
                | "lseg"
                | "macaddr"
                | "money"
                | "numeric"
                | "path"
                | "point"
                | "polygon"
                | "real"
                | "serial"
                | "smallint"
                | "text"
                | "time"
                | "timestamp"
                | "tsquery"
                | "tsvector"
                | "uuid"
                | "varchar"
                | "xml"
        )
}

fn postgres_argument_reference(name: &str) -> String {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return quote_postgres_identifier(name);
    };
    if (first.is_ascii_lowercase() || first == '_')
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
    {
        name.into()
    } else {
        quote_postgres_identifier(name)
    }
}

fn postgres_import_export_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
    let (schema, table) = postgres_plan_table_parts(object_name, parameters);
    let workflow = if matches!(
        mode.as_str(),
        "import" | "append" | "insert" | "validate" | "validate-only"
    ) {
        "postgresql.table.import"
    } else {
        "postgresql.table.export"
    };
    let path_key = if workflow.ends_with(".import") {
        "source"
    } else {
        "target"
    };
    let path_value = format!("<selected-file>.{format}");

    let mut request = serde_json::json!({
        "workflow": workflow,
        "mode": mode,
        "schema": schema,
        "table": table,
        "format": format,
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(10_000),
        "executionGate": {
            "owner": "postgresql-adapter",
            "defaultSupport": "live",
            "requiresConfirmation": true,
            "guards": [
                "concrete absolute file path",
                "read-only connection check for import",
                "row limit",
                "type-aware target column validation"
            ]
        }
    });
    if let Some(object) = request.as_object_mut() {
        object.insert(
            path_key.into(),
            serde_json::json!({
                "path": path_value,
                "overwrite": false
            }),
        );
    }

    serde_json::to_string_pretty(&request).unwrap_or_else(|_| "{}".into())
}

fn postgres_backup_restore_request(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| "backup".into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format").unwrap_or_else(|| "json".into());
    let schema = string_parameter(parameters, "schema")
        .unwrap_or_else(|| postgres_plan_table_parts(object_name, parameters).0);

    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": if mode == "restore" {
            "postgresql.database.restore-preview"
        } else {
            "postgresql.database.backup"
        },
        "mode": mode,
        "format": format,
        "schema": schema,
        "target": {
            "path": format!("<selected-file>.{format}"),
            "overwrite": false
        },
        "rowLimit": numeric_parameter(parameters, "rowLimit").unwrap_or(1_000),
        "tableLimit": numeric_parameter(parameters, "tableLimit").unwrap_or(25),
        "includeData": bool_parameter(parameters, "includeData").unwrap_or(true),
        "executionGate": {
            "owner": "postgresql-adapter",
            "defaultSupport": if mode == "restore" { "plan-only" } else { "live" },
            "requiresConfirmation": true,
            "residualRisk": "bounded logical DataPad++ backup package; full pg_dump/pg_restore restore execution remains preview-first"
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn postgres_plan_table_parts(
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let table = string_parameter(parameters, "table")
        .or_else(|| string_parameter(parameters, "tableName"))
        .unwrap_or_else(|| {
            object_name
                .split('.')
                .next_back()
                .map(clean_postgres_identifier)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "<table>".into())
        });
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| {
        object_name
            .split('.')
            .next()
            .map(clean_postgres_identifier)
            .filter(|value| !value.is_empty() && value != &table)
            .unwrap_or_else(|| "public".into())
    });

    (schema, table)
}

fn clean_postgres_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .replace("\"\"", "\"")
}

fn quote_postgres_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
