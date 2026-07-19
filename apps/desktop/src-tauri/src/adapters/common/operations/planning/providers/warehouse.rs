use super::super::*;

pub(super) fn warehouse_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "bigquery" => bigquery_operation_request(operation_id, object_name, parameters),
        "clickhouse" => clickhouse_operation_request(operation_id, object_name, parameters),
        _ => snowflake_operation_request(operation_id, object_name, parameters),
    }
}

fn snowflake_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "select * from {} limit 100;",
            snowflake_identifier(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN USING TEXT\n{};", strip_trailing_semicolon(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!(
            "{};\nselect * from table(information_schema.query_history()) order by start_time desc limit 20;",
            strip_trailing_semicolon(&query)
        );
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select * from table(information_schema.warehouse_load_history()) order by start_time desc limit 100;\nselect * from table(information_schema.query_history()) order by start_time desc limit 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "show grants to role <active_role>;\nshow grants on schema <database>.<schema>;"
            .into();
    }

    if operation_id.ends_with("data.import-export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "csv".into());
        return format!(
            "COPY INTO @<stage>/{object_name}.{format}\nFROM {}\nFILE_FORMAT = (TYPE = {} HEADER = TRUE);",
            snowflake_identifier(object_name),
            format.to_uppercase()
        );
    }

    if operation_id.ends_with("table.clone") {
        let clone_name = string_parameter(parameters, "cloneName")
            .unwrap_or_else(|| format!("{object_name}_clone"));
        return format!(
            "CREATE TABLE {} CLONE {};",
            snowflake_identifier(&clone_name),
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("warehouse.suspend") {
        return format!(
            "ALTER WAREHOUSE {} SUSPEND;",
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("warehouse.resume") {
        return format!(
            "ALTER WAREHOUSE {} RESUME;",
            snowflake_identifier(object_name)
        );
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\nDROP TABLE IF EXISTS {};",
            snowflake_identifier(object_name)
        );
    }

    query
}

fn bigquery_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let schema = string_parameter(parameters, "schema").unwrap_or_else(|| "<dataset>".into());
    let query = string_parameter(parameters, "query")
        .unwrap_or_else(|| format!("select * from `{schema}.{object_name}` limit 100;"));

    if operation_id.ends_with("query.explain") || operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.Jobs.QueryDryRun",
            "dryRun": true,
            "useQueryCache": false,
            "query": query,
            "estimate": ["bytesProcessed", "slotMs", "referencedTables"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select creation_time, job_id, state, total_bytes_processed, total_slot_ms\nfrom `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT\norder by creation_time desc limit 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.TestIamPermissions",
            "resource": format!("projects/<project>/datasets/{schema}"),
            "permissions": ["bigquery.tables.get", "bigquery.tables.getData", "bigquery.tables.update", "bigquery.jobs.create"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.ExtractJob",
            "table": object_name,
            "destination": "gs://<selected-bucket>/<path>",
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "avro".into()),
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("table.copy") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "BigQuery.Tables.Copy",
            "sourceTable": object_name,
            "destinationTable": string_parameter(parameters, "destinationTable").unwrap_or_else(|| format!("{object_name}_copy")),
            "writeDisposition": "WRITE_EMPTY",
            "preflight": ["getTable", "testIamPermissions", "dryRunReferenceQuery"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn clickhouse_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "select * from {} limit 100;",
            clickhouse_identifier(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN PIPELINE\n{};", strip_trailing_semicolon(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!(
            "{} settings log_queries = 1;\nselect query_id, read_rows, read_bytes, memory_usage, query_duration_ms\nfrom system.query_log\nwhere type = 'QueryFinish'\norder by event_time desc limit 20;",
            strip_trailing_semicolon(&query)
        );
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "select event_time, query_id, read_rows, read_bytes, memory_usage, query_duration_ms\nfrom system.query_log\norder by event_time desc limit 100;\nselect * from system.metrics;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "show grants;\nselect * from system.users;\nselect * from system.roles;".into();
    }

    if operation_id.ends_with("data.import-export") {
        let format = string_parameter(parameters, "format").unwrap_or_else(|| "parquet".into());
        return format!(
            "SELECT * FROM {} INTO OUTFILE '<selected-file>' FORMAT {};",
            clickhouse_identifier(object_name),
            format.to_uppercase()
        );
    }

    if operation_id.ends_with("table.optimize") {
        return format!(
            "OPTIMIZE TABLE {} FINAL;",
            clickhouse_identifier(object_name)
        );
    }

    if operation_id.ends_with("table.materialize-ttl") {
        return format!(
            "ALTER TABLE {} MATERIALIZE TTL;",
            clickhouse_identifier(object_name)
        );
    }

    if operation_id.ends_with("table.freeze") {
        let snapshot_name = string_parameter(parameters, "snapshotName")
            .unwrap_or_else(|| format!("{object_name}_snapshot"));
        return format!(
            "ALTER TABLE {} FREEZE WITH NAME '{}';",
            clickhouse_identifier(object_name),
            escape_single_quoted(&snapshot_name)
        );
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\nDROP TABLE IF EXISTS {};",
            clickhouse_identifier(object_name)
        );
    }

    query
}

fn snowflake_identifier(value: &str) -> String {
    value
        .split('.')
        .map(|part| {
            format!(
                "\"{}\"",
                strip_identifier_wrapper(part).replace('"', "\"\"")
            )
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn clickhouse_identifier(value: &str) -> String {
    value
        .split('.')
        .map(|part| format!("`{}`", strip_identifier_wrapper(part).replace('`', "``")))
        .collect::<Vec<_>>()
        .join(".")
}
