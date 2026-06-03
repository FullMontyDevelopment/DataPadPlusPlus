use super::super::super::*;

pub(super) async fn test_litedb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let path = litedb_file_path(connection);
    let mut warnings = vec![
        "LiteDB is a .NET embedded document database; live file access is routed through a sidecar bridge in a later execution pass."
            .into(),
        "This adapter builds bridge requests, metadata, diagnostics, and guarded mutation plans without requiring ORM credentials."
            .into(),
    ];
    if !path.is_empty() && !std::path::Path::new(&path).exists() {
        warnings.push(format!(
            "LiteDB file `{path}` does not exist yet; create/open is operation-plan preview only in this phase."
        ));
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "LiteDB adapter accepted {} as a bridge-contract profile.",
            connection.name
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: Some(path),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn litedb_file_path(connection: &ResolvedConnectionProfile) -> String {
    connection
        .connection_string
        .as_deref()
        .and_then(|value| {
            value
                .strip_prefix("litedb://")
                .or_else(|| value.strip_prefix("file://"))
                .or(Some(value))
        })
        .or(connection.database.as_deref())
        .or_else(|| {
            let host = connection.host.trim();
            (!host.is_empty() && host != "127.0.0.1" && host != "localhost").then_some(host)
        })
        .unwrap_or("datapadplusplus.db")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::litedb_file_path;
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-litedb".into(),
            name: "LiteDB".into(),
            engine: "litedb".into(),
            family: "document".into(),
            host: "catalog.db".into(),
            port: None,
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn litedb_file_path_prefers_connection_string() {
        let mut connection = connection();
        connection.connection_string = Some("litedb://C:/data/app.db".into());

        assert_eq!(litedb_file_path(&connection), "C:/data/app.db");
    }
}
