use super::super::super::*;

pub(super) async fn test_oracle_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let sqlplus_path = oracle_sqlplus_path(connection);
    let mut warnings = vec![
        "Dictionary views and DBMS_XPLAN/profile access depend on user grants; unavailable actions should remain permission-aware."
            .into(),
    ];
    if sqlplus_path.is_none() {
        warnings.push(
            "Oracle live execution requires an Oracle SQLPlus client path; this profile will use guarded contract previews until one is configured."
                .into(),
        );
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: if let Some(path) = sqlplus_path {
            format!(
                "Oracle adapter accepted {} with SQLPlus live execution configured at {}.",
                connection.name, path
            )
        } else {
            format!(
                "Oracle adapter accepted {} as a SQL/PLSQL contract profile.",
                connection.name
            )
        },
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: Some(oracle_service_name(connection)),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn oracle_service_name(connection: &ResolvedConnectionProfile) -> String {
    if let Some(service_name) = connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.service_name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return service_name.to_string();
    }

    connection
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("ORCLPDB1")
        .to_string()
}

pub(super) fn oracle_connect_descriptor(connection: &ResolvedConnectionProfile) -> String {
    if let Some(connection_string) = connection.connection_string.as_deref() {
        return connection_string.to_string();
    }

    let options = connection.oracle_options.as_ref();
    if let Some(easy_connect) = options
        .and_then(|options| options.easy_connect_string.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return easy_connect.to_string();
    }

    if let Some(tns_alias) = options
        .and_then(|options| options.tns_alias.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return tns_alias.to_string();
    }

    let host = if connection.host.trim().is_empty() {
        "127.0.0.1"
    } else {
        connection.host.trim()
    };
    let port = connection.port.unwrap_or(1521);
    let connect_mode = options
        .and_then(|options| options.connect_mode.as_deref())
        .unwrap_or("service-name");

    if connect_mode == "sid" {
        let sid = options
            .and_then(|options| options.sid.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ORCL");
        return format!("{host}:{port}:{sid}");
    }

    if connect_mode == "tcps"
        || connect_mode == "cloud-wallet"
        || options.and_then(|options| options.use_tls).unwrap_or(false)
    {
        return format!("tcps://{host}:{port}/{}", oracle_service_name(connection));
    }

    format!("{host}:{port}/{}", oracle_service_name(connection))
}

pub(super) fn oracle_sqlplus_path(connection: &ResolvedConnectionProfile) -> Option<String> {
    let options = connection.oracle_options.as_ref()?;
    let configured_path = options
        .sql_plus_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(path) = configured_path {
        return Some(path.to_string());
    }

    let runtime_is_sqlplus = options
        .execution_runtime
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("sqlplus"))
        .unwrap_or(false);
    if runtime_is_sqlplus {
        Some("sqlplus".into())
    } else {
        None
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/connection_tests.rs"]
mod tests;
