use serde_json::{json, Value};

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

pub(super) fn oracle_request_payload(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
    explain: bool,
) -> Value {
    json!({
        "driver": "oracle-oci-or-thin",
        "connectDescriptor": oracle_connect_descriptor(connection),
        "schema": connection.username.clone().unwrap_or_else(|| "CURRENT_SCHEMA".into()),
        "connectionOptions": oracle_driver_options(connection),
        "statement": if explain {
            format!("EXPLAIN PLAN FOR {}", strip_sql_semicolon(statement))
        } else {
            statement.to_string()
        },
        "rowLimit": row_limit,
        "guardrails": {
            "mutationPreviewOnly": true,
            "dictionaryViewPermissionsRequired": true
        }
    })
}

fn oracle_driver_options(connection: &ResolvedConnectionProfile) -> Value {
    let Some(options) = connection.oracle_options.as_ref() else {
        return json!({
            "connectMode": "service-name",
            "serviceName": oracle_service_name(connection)
        });
    };

    json!({
        "connectMode": options.connect_mode.as_deref().unwrap_or("service-name"),
        "serviceName": options.service_name,
        "sid": options.sid,
        "tnsAlias": options.tns_alias,
        "connectionRole": options.connection_role,
        "proxyUser": options.proxy_user,
        "clientIdentifier": options.client_identifier,
        "applicationName": options.application_name,
        "edition": options.edition,
        "nlsLanguage": options.nls_language,
        "nlsTerritory": options.nls_territory,
        "statementCacheSize": options.statement_cache_size,
        "fetchSize": options.fetch_size,
        "connectionTimeoutMs": options.connection_timeout_ms,
        "requestTimeoutMs": options.request_timeout_ms,
        "poolMin": options.pool_min,
        "poolMax": options.pool_max,
        "validateConnection": options.validate_connection,
        "highAvailabilityEvents": options.high_availability_events,
        "loadBalancing": options.load_balancing,
        "failover": options.failover,
        "useTls": options.use_tls,
        "walletPath": options.wallet_path,
        "caCertificatePath": options.ca_certificate_path,
        "clientCertificatePath": options.client_certificate_path,
        "clientKeyPath": options.client_key_path,
        "traceDirectory": options.trace_directory
    })
}

#[cfg(test)]
mod tests {
    use super::{oracle_connect_descriptor, oracle_request_payload, oracle_service_name};
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
    fn oracle_request_payload_wraps_explain_plan() {
        let payload = oracle_request_payload(&connection(), "select * from dual", 25, true);

        assert_eq!(payload["schema"], "APP");
        assert_eq!(payload["rowLimit"], 25);
        assert_eq!(payload["statement"], "EXPLAIN PLAN FOR select * from dual");
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
    fn oracle_request_payload_includes_non_secret_driver_options() {
        let mut connection = connection();
        connection.oracle_options = Some(OracleConnectionOptions {
            connect_mode: Some("cloud-wallet".into()),
            service_name: Some("sales_high".into()),
            wallet_path: Some("C:/wallets/sales".into()),
            application_name: Some("DataPad++".into()),
            fetch_size: Some(250),
            ..Default::default()
        });
        let payload = oracle_request_payload(&connection, "select * from dual", 10, false);

        assert_eq!(
            payload["connectDescriptor"],
            "tcps://dbhost:1521/sales_high"
        );
        assert_eq!(
            payload["connectionOptions"]["walletPath"],
            "C:/wallets/sales"
        );
        assert_eq!(payload["connectionOptions"]["applicationName"], "DataPad++");
        assert_eq!(payload["connectionOptions"]["fetchSize"], 250);
    }
}
