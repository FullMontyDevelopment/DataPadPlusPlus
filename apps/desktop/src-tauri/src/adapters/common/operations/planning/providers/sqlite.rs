use super::super::*;

pub(super) fn sqlite_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
    parameter_json: &str,
) -> String {
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| {
        sqlite_object_parts(object_name)
            .map(|(schema, _)| schema)
            .unwrap_or_else(|| "main".into())
    });
    let table = string_parameter(parameters, "table")
        .or_else(|| sqlite_object_parts(object_name).map(|(_, table)| table));

    if operation_id.ends_with("index.create") {
        return format!(
            "create index [idx_{}_column_name] on {object_name} ([column_name]);",
            safe_sqlite_name(object_name)
        );
    }

    if operation_id.ends_with("index.drop") {
        return "-- Review before running.\ndrop index [index_name];".into();
    }

    if operation_id.ends_with("trigger.create") {
        return format!(
            "create trigger [trg_{}_audit]\nafter insert on {object_name}\nfor each row\nbegin\n  select raise(ignore);\nend;",
            safe_sqlite_name(object_name)
        );
    }

    if operation_id.contains("integrity-check") {
        return "pragma quick_check;\n-- Full check can be slower on large files:\npragma integrity_check;".into();
    }

    if operation_id.ends_with("database.analyze") {
        return "analyze;".into();
    }

    if operation_id.ends_with("table.analyze") {
        return format!("analyze {object_name};");
    }

    if operation_id.ends_with("database.optimize") {
        return "pragma optimize;".into();
    }

    if operation_id.ends_with("index.reindex") {
        return format!("reindex {object_name};");
    }

    if operation_id.contains("vacuum") {
        let compact_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.sqlite".into());
        return format!(
            "-- Review file path and locks before running.\nvacuum;\n-- Or compact into a new file:\nvacuum {schema} into '{}';",
            compact_path.replace('\'', "''")
        );
    }

    if operation_id.ends_with("database.backup") {
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.sqlite".into());
        return format!(
            "vacuum {} into '{}';\n-- Guardrails: absolute target path, parent folder must exist, overwrite requires explicit opt-in.",
            sqlite_quoted_identifier(&schema),
            target_path.replace('\'', "''")
        );
    }

    if operation_id.ends_with("table.export") {
        let table = table.unwrap_or_else(|| "<table>".into());
        let target_path = string_parameter(parameters, "targetPath")
            .or_else(|| string_parameter(parameters, "outputPath"))
            .unwrap_or_else(|| "<selected-file>.csv".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        let limit = numeric_parameter(parameters, "limit").unwrap_or(10_000);
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlite.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path,
            "limit": limit,
            "overwrite": bool_parameter(parameters, "overwrite").unwrap_or(false),
            "guardrails": [
                "absolute target path",
                "parent folder exists",
                "bounded row export",
                "overwrite opt-in"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("table.import") {
        let table = table.unwrap_or_else(|| "<table>".into());
        let source_path = string_parameter(parameters, "sourcePath")
            .or_else(|| string_parameter(parameters, "inputPath"))
            .unwrap_or_else(|| "<selected-file>.csv".into());
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "append".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "workflow": "sqlite.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "sourcePath": source_path,
            "mode": mode,
            "guardrails": [
                "absolute source path",
                "existing target table",
                "CSV header or JSON object rows",
                "read-only connection blocked",
                "confirmation required before append"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.contains("backup") {
        return "-- SQLite backup/export plan.\n-- Use VACUUM INTO for a compact copy or the backup API for online snapshots.\nvacuum into 'backup.sqlite';".into();
    }

    if operation_id.ends_with("data.import-export") || operation_id.contains("import-export") {
        return format!(
            ".headers on\n.mode csv\n.output <selected-file>.csv\nselect * from {object_name};\n.output stdout"
        );
    }

    match operation_id.rsplit('.').next().unwrap_or(operation_id) {
        "refresh" => "pragma database_list;\nselect type, name, tbl_name from sqlite_schema order by type, name;".into(),
        "execute" => format!("select * from {object_name} limit 100;"),
        "explain" => format!("explain query plan select * from {object_name} limit 100;"),
        "profile" => format!("explain select * from {object_name} limit 100;"),
        "create" => format!("create table {object_name} (\n  id integer primary key,\n  created_at text not null default current_timestamp\n) strict;"),
        "drop" => format!("-- Review before running.\ndrop table {object_name};"),
        "inspect" => "pragma table_list;\npragma database_list;\npragma foreign_key_check;".into(),
        "metrics" => "pragma page_count;\npragma page_size;\npragma freelist_count;\npragma quick_check;".into(),
        _ => format!("-- SQLite {operation_id}\n-- parameters:\n{parameter_json}"),
    }
}

fn safe_sqlite_name(value: &str) -> String {
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
        .take(64)
        .collect::<String>()
}

fn sqlite_object_parts(object_name: &str) -> Option<(String, String)> {
    let object_name = object_name.trim();
    if object_name.is_empty() || object_name.contains('<') || object_name.contains('>') {
        return None;
    }
    let parts = object_name
        .split('.')
        .map(sqlite_unquoted_identifier)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => Some(("main".into(), table.clone())),
        [schema, table, ..] => Some((schema.clone(), table.clone())),
        _ => None,
    }
}

fn sqlite_unquoted_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .into()
}

fn sqlite_quoted_identifier(value: &str) -> String {
    format!(
        "\"{}\"",
        sqlite_unquoted_identifier(value).replace('"', "\"\"")
    )
}
