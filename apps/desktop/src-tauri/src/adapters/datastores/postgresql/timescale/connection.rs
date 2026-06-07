use super::super::*;

pub(super) async fn test_timescale_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let extension: Option<(String, String)> = sqlx::query_as(
        "select e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'timescaledb'",
    )
    .fetch_optional(&pool)
    .await?;
    let _: i64 = sqlx::query_scalar("select 1::bigint")
        .fetch_one(&pool)
        .await?;
    pool.close().await;

    let warnings = timescale_connection_warnings(connection, extension.as_ref());
    let extension_detail = extension
        .as_ref()
        .map(|(version, schema)| {
            format!(" TimescaleDB extension {version} is installed in schema {schema}.")
        })
        .unwrap_or_default();

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "TimescaleDB connection test succeeded for {}.{}",
            connection.name, extension_detail
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

fn timescale_connection_warnings(
    connection: &ResolvedConnectionProfile,
    extension: Option<&(String, String)>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    let Some((actual_version, actual_schema)) = extension else {
        warnings.push("Connected through PostgreSQL wire protocol, but the timescaledb extension was not visible in pg_extension.".into());
        return warnings;
    };

    let Some(options) = &connection.postgres_options else {
        return warnings;
    };

    if let Some(expected_schema) = options
        .timescale_extension_schema
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if expected_schema != actual_schema {
            warnings.push(format!(
                "Profile expected TimescaleDB extension schema {expected_schema}, but pg_extension reported {actual_schema}."
            ));
        }
    }

    if let Some(expected_version) = options
        .timescale_extension_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if expected_version != actual_version {
            warnings.push(format!(
                "Profile expected TimescaleDB extension version {expected_version}, but pg_extension reported {actual_version}."
            ));
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::timescale_connection_warnings;
    use crate::domain::models::{PostgresConnectionOptions, ResolvedConnectionProfile};

    #[test]
    fn timescale_connection_warnings_compare_profile_metadata() {
        let connection = ResolvedConnectionProfile {
            id: "conn-timescale".into(),
            name: "TimescaleDB".into(),
            engine: "timescaledb".into(),
            family: "timeseries".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("datapadplusplus".into()),
            username: Some("app".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: Some(PostgresConnectionOptions {
                timescale_extension_schema: Some("timescaledb".into()),
                timescale_extension_version: Some("2.15.0".into()),
                ..PostgresConnectionOptions::default()
            }),
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        };

        let warnings = timescale_connection_warnings(
            &connection,
            Some(&("2.14.2".to_string(), "public".to_string())),
        );

        assert_eq!(warnings.len(), 2);
        assert!(warnings[0].contains("schema timescaledb"));
        assert!(warnings[1].contains("version 2.15.0"));
    }
}
