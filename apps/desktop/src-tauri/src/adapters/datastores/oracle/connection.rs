use super::super::super::*;

pub(super) async fn test_oracle_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Oracle adapter accepted {} as a SQL/PLSQL contract profile; native OCI execution is isolated for the Oracle driver pass.",
            connection.name
        ),
        warnings: vec![
            "Oracle live execution requires Oracle client/runtime prerequisites or a thin driver path; this adapter currently builds guarded SQL/PLSQL request, metadata, and diagnostics payloads."
                .into(),
            "Dictionary views and DBMS_XPLAN/profile access depend on user grants; unavailable actions should remain permission-aware."
                .into(),
        ],
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

#[cfg(test)]
mod tests {
    use super::{oracle_connect_descriptor, oracle_service_name};
    use crate::domain::models::{OracleConnectionOptions, ResolvedConnectionProfile};

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-oracle".into(),
            name: "Oracle".into(),
            engine: "oracle".into(),
            family: "sql".into(),
            host: "dbhost".into(),
            port: None,
            database: Some("FREEPDB1".into()),
            username: Some("APP".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        }
    }

    #[test]
    fn oracle_descriptor_uses_default_port_and_service() {
        assert_eq!(oracle_service_name(&connection()), "FREEPDB1");
        assert_eq!(
            oracle_connect_descriptor(&connection()),
            "dbhost:1521/FREEPDB1"
        );
    }

    #[test]
    fn oracle_descriptor_supports_sid_and_tns_modes() {
        let mut sid = connection();
        sid.oracle_options = Some(OracleConnectionOptions {
            connect_mode: Some("sid".into()),
            sid: Some("FREE".into()),
            ..Default::default()
        });
        assert_eq!(oracle_connect_descriptor(&sid), "dbhost:1521:FREE");

        let mut tns = connection();
        tns.oracle_options = Some(OracleConnectionOptions {
            connect_mode: Some("tns-alias".into()),
            tns_alias: Some("SALES_PDB".into()),
            ..Default::default()
        });
        assert_eq!(oracle_connect_descriptor(&tns), "SALES_PDB");
    }

    #[test]
    fn oracle_descriptor_supports_cloud_wallet_service() {
        let mut connection = connection();
        connection.oracle_options = Some(OracleConnectionOptions {
            connect_mode: Some("cloud-wallet".into()),
            service_name: Some("sales_high".into()),
            wallet_path: Some("C:/wallets/sales".into()),
            application_name: Some("DataPad++".into()),
            fetch_size: Some(250),
            ..Default::default()
        });

        assert_eq!(
            oracle_connect_descriptor(&connection),
            "tcps://dbhost:1521/sales_high"
        );
    }
}
