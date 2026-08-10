use super::*;
use crate::domain::models::SqlQueryScope;

pub(crate) fn apply_sql_query_scope(
    connection: &mut ResolvedConnectionProfile,
    scope: Option<&SqlQueryScope>,
) -> Result<(), CommandError> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let catalog = scope
        .catalog
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let database = scope
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let schema = scope
        .schema
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match connection.engine.as_str() {
        "sqlserver" | "mysql" | "mariadb" => {
            if catalog.is_some() || schema.is_some() {
                return Err(unsupported_sql_scope(connection, "catalog or schema"));
            }
            if let Some(database) = database {
                connection.database = Some(database.to_string());
            }
        }
        "postgresql" | "cockroachdb" | "timescaledb" => {
            if catalog.is_some() {
                return Err(unsupported_sql_scope(connection, "catalog"));
            }
            if let Some(database) = database {
                connection.database = Some(database.to_string());
            }
            if let Some(schema) = schema {
                let options = connection
                    .postgres_options
                    .get_or_insert_with(Default::default);
                options.search_path = Some(schema.to_string());
            }
        }
        "oracle" | "duckdb" => {
            if catalog.is_some() || database.is_some() {
                return Err(unsupported_sql_scope(connection, "catalog or database"));
            }
        }
        "clickhouse" => {
            if catalog.is_some() || schema.is_some() {
                return Err(unsupported_sql_scope(connection, "catalog or schema"));
            }
            if let Some(database) = database {
                connection.database = Some(database.to_string());
                let options = connection
                    .warehouse_options
                    .get_or_insert_with(Default::default);
                options.database_name = Some(database.to_string());
            }
        }
        "snowflake" => {
            if catalog.is_some() {
                return Err(unsupported_sql_scope(connection, "catalog"));
            }
            let options = connection
                .warehouse_options
                .get_or_insert_with(Default::default);
            if let Some(database) = database {
                connection.database = Some(database.to_string());
                options.database_name = Some(database.to_string());
                options.catalog_name = Some(database.to_string());
            }
            if let Some(schema) = schema {
                options.schema_name = Some(schema.to_string());
            }
        }
        "bigquery" => {
            if database.is_some() {
                return Err(unsupported_sql_scope(connection, "database"));
            }
            let options = connection
                .warehouse_options
                .get_or_insert_with(Default::default);
            if let Some(project) = catalog {
                options.project_id = Some(project.to_string());
            }
            if let Some(dataset) = schema {
                options.dataset_id = Some(dataset.to_string());
            }
        }
        _ => return Err(unsupported_sql_scope(connection, "SQL")),
    }
    Ok(())
}

fn unsupported_sql_scope(connection: &ResolvedConnectionProfile, level: &str) -> CommandError {
    CommandError::new(
        "sql-scope-unsupported",
        format!(
            "{} does not support automatic {level} scope for this connection.",
            connection.engine
        ),
    )
}
