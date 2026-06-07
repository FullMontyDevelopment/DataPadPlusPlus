use tiberius::{AuthMethod, Client as SqlServerClient, Config, EncryptionLevel, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

use super::super::super::*;

pub(super) fn sqlserver_config(
    connection: &ResolvedConnectionProfile,
) -> Result<Config, CommandError> {
    let mut config = if let Some(connection_string) = &connection.connection_string {
        Config::from_ado_string(connection_string)?
    } else {
        config_from_fields(connection)?
    };

    apply_sqlserver_options(&mut config, connection)?;
    Ok(config)
}

pub(super) async fn sqlserver_client(
    connection: &ResolvedConnectionProfile,
) -> Result<SqlServerClient<tokio_util::compat::Compat<TcpStream>>, CommandError> {
    let config = sqlserver_config(connection)?;
    let tcp = if connection
        .sqlserver_options
        .as_ref()
        .and_then(|options| options.instance_name.as_deref())
        .filter(|value| !value.trim().is_empty())
        .is_some()
        && connection.port.is_none()
    {
        TcpStream::connect_named(&config).await?
    } else {
        TcpStream::connect(config.get_addr()).await?
    };

    tcp.set_nodelay(true)?;
    let client = SqlServerClient::connect(config, tcp.compat_write()).await?;
    Ok(client)
}

fn config_from_fields(connection: &ResolvedConnectionProfile) -> Result<Config, CommandError> {
    let options = connection.sqlserver_options.as_ref();
    let connect_mode = options
        .and_then(|item| item.connect_mode.as_deref())
        .unwrap_or("tcp");

    if matches!(connect_mode, "localdb" | "shared-memory" | "named-pipes") {
        return Err(CommandError::new(
            "sqlserver-unsupported-connection-mode",
            format!(
                "SQL Server {connect_mode} profiles are stored, but this build can only connect live through TCP, named instances, Azure SQL SQL-auth, or connection strings."
            ),
        ));
    }

    let auth_mode = options
        .and_then(|item| item.authentication_mode.as_deref())
        .unwrap_or("sql-server");
    if !matches!(auth_mode, "sql-server") {
        return Err(CommandError::new(
            "sqlserver-auth-mode-unavailable",
            sqlserver_auth_disabled_reason(auth_mode, options),
        ));
    }

    let mut config = Config::new();
    config.host(connection.host.clone());

    if let Some(instance_name) = options
        .and_then(|item| item.instance_name.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        config.instance_name(instance_name);
    }

    if let Some(port) = connection.port {
        config.port(port);
    }

    if let Some(database) = &connection.database {
        config.database(database);
    }

    if let Some(username) = &connection.username {
        config.authentication(AuthMethod::sql_server(
            username.clone(),
            connection.password.clone().unwrap_or_default(),
        ));
    }

    Ok(config)
}

fn apply_sqlserver_options(
    config: &mut Config,
    connection: &ResolvedConnectionProfile,
) -> Result<(), CommandError> {
    let Some(options) = connection.sqlserver_options.as_ref() else {
        config.trust_cert();
        return Ok(());
    };

    if let Some(application_name) = options
        .application_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        config.application_name(application_name);
    } else {
        config.application_name("DataPad++");
    }

    if options.encrypt_connection == Some(false) {
        config.encryption(EncryptionLevel::Off);
    } else if options.connect_mode.as_deref() == Some("azure-sql")
        || options.encrypt_connection == Some(true)
    {
        config.encryption(EncryptionLevel::Required);
    }

    if let Some(ca_path) = options
        .trust_server_certificate_ca_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        config.trust_cert_ca(ca_path);
    } else if options.trust_server_certificate.unwrap_or(true) {
        config.trust_cert();
    }

    if options.read_only_intent == Some(true)
        || options.application_intent.as_deref() == Some("readonly")
    {
        config.readonly(true);
    }

    if options.multiple_active_result_sets == Some(true) {
        return Err(CommandError::new(
            "sqlserver-mars-unavailable",
            "Multiple Active Result Sets is stored in the profile, but the current driver path does not expose a MARS switch.",
        ));
    }

    if options.pooling == Some(true)
        || options.min_pool_size.is_some()
        || options.max_pool_size.is_some()
    {
        return Err(CommandError::new(
            "sqlserver-pooling-unavailable",
            "SQL Server pooling settings are stored in the profile, but DataPad++ currently opens explicit short-lived diagnostic/query connections.",
        ));
    }

    Ok(())
}

fn sqlserver_auth_disabled_reason(
    auth_mode: &str,
    options: Option<&crate::domain::models::SqlServerConnectionOptions>,
) -> String {
    let Some(options) = options else {
        return format!(
            "SQL Server {auth_mode} authentication is represented in the profile, but live connections require an adapter-specific runtime path. Use SQL Server authentication or a connection string for now."
        );
    };

    match auth_mode {
        "windows" => "Windows Integrated authentication is saved in the profile, but the current TDS runtime does not expose SSPI/Kerberos credential delegation. Use SQL Server authentication or a connection string for now.".into(),
        "azure-ad-password" => {
            if options.aad_access_token_secret_ref.is_some() {
                "Microsoft Entra password mode has a stored token reference, but live token exchange is not wired to the SQL Server driver yet. Use SQL Server authentication or a connection string for now.".into()
            } else {
                "Microsoft Entra password mode needs a token-acquisition runtime before live execution. Store tenant/client metadata for planning, then use SQL Server authentication or a connection string for now.".into()
            }
        }
        "azure-ad-integrated" => "Microsoft Entra integrated authentication needs OS account token broker support that is not wired to the SQL Server driver yet. Use SQL Server authentication or a connection string for now.".into(),
        "azure-ad-interactive" => "Microsoft Entra interactive authentication needs browser/device-code token acquisition that is not wired to the SQL Server driver yet. Use SQL Server authentication or a connection string for now.".into(),
        "azure-ad-managed-identity" => {
            if has_text(options.azure_managed_identity_client_id.as_deref()) {
                "Managed identity client id is saved, but DataPad++ has not wired the Azure managed identity token endpoint into SQL Server live connections yet.".into()
            } else {
                "Managed identity authentication needs an Azure managed identity token endpoint and optional client id before SQL Server live connections can use it.".into()
            }
        }
        "azure-ad-service-principal" => {
            if !has_text(options.azure_tenant_id.as_deref())
                || !has_text(options.azure_client_id.as_deref())
                || options.service_principal_secret_ref.is_none()
            {
                "Service principal authentication needs tenant id, client id, and a stored client-secret reference before it can be promoted from plan-only.".into()
            } else {
                "Service principal metadata is complete, but token exchange is not wired to the SQL Server driver yet. Use SQL Server authentication or a connection string for now.".into()
            }
        }
        "certificate" => {
            if !has_text(options.client_certificate_path.as_deref())
                && !has_text(options.certificate_store.as_deref())
                && !has_text(options.certificate_thumbprint.as_deref())
            {
                "Certificate authentication needs a client certificate path or certificate store/thumbprint before it can be promoted from plan-only.".into()
            } else {
                "Certificate metadata is saved, but certificate-based SQL Server authentication is not wired to the current TDS runtime yet.".into()
            }
        }
        _ => format!(
            "SQL Server {auth_mode} authentication is represented in the profile, but live connections require an adapter-specific runtime path. Use SQL Server authentication or a connection string for now."
        ),
    }
}

fn has_text(value: Option<&str>) -> bool {
    matches!(value, Some(item) if !item.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use crate::domain::models::{SecretRef, SqlServerConnectionOptions};

    use super::*;

    #[test]
    fn sqlserver_config_supports_named_instance_without_port() {
        let connection = resolved_connection(Some(sqlserver_options("named-instance")));

        let config = sqlserver_config(&connection).expect("config");

        assert_eq!(config.get_addr(), "localhost:1434");
    }

    #[test]
    fn sqlserver_config_rejects_localdb_live_path() {
        let mut options = sqlserver_options("localdb");
        options.local_db_instance = Some("MSSQLLocalDB".into());
        let connection = resolved_connection(Some(options));

        let error = sqlserver_config(&connection).expect_err("localdb should be gated");

        assert_eq!(error.code, "sqlserver-unsupported-connection-mode");
    }

    #[test]
    fn sqlserver_config_rejects_unavailable_auth_modes() {
        let mut options = sqlserver_options("tcp");
        options.authentication_mode = Some("azure-ad-integrated".into());
        let connection = resolved_connection(Some(options));

        let error = sqlserver_config(&connection).expect_err("AAD should be gated");

        assert_eq!(error.code, "sqlserver-auth-mode-unavailable");
        assert!(error.message.contains("OS account token broker"));
    }

    #[test]
    fn sqlserver_auth_disabled_reasons_are_mode_specific() {
        let mut service_principal = sqlserver_options("azure-sql");
        service_principal.authentication_mode = Some("azure-ad-service-principal".into());
        service_principal.azure_tenant_id = Some("tenant".into());
        service_principal.azure_client_id = Some("client".into());
        service_principal.service_principal_secret_ref = Some(secret_ref("sp-secret"));
        let service_principal_error =
            sqlserver_config(&resolved_connection(Some(service_principal))).expect_err("SP gated");
        assert!(service_principal_error
            .message
            .contains("token exchange is not wired"));

        let mut managed_identity = sqlserver_options("azure-sql");
        managed_identity.authentication_mode = Some("azure-ad-managed-identity".into());
        let managed_identity_error = sqlserver_config(&resolved_connection(Some(managed_identity)))
            .expect_err("managed identity gated");
        assert!(managed_identity_error
            .message
            .contains("managed identity token endpoint"));

        let mut certificate = sqlserver_options("tcp");
        certificate.authentication_mode = Some("certificate".into());
        let certificate_error =
            sqlserver_config(&resolved_connection(Some(certificate))).expect_err("cert gated");
        assert!(certificate_error
            .message
            .contains("client certificate path or certificate store/thumbprint"));
    }

    fn sqlserver_options(connect_mode: &str) -> SqlServerConnectionOptions {
        SqlServerConnectionOptions {
            connect_mode: Some(connect_mode.into()),
            instance_name: Some("SQLEXPRESS".into()),
            authentication_mode: Some("sql-server".into()),
            application_name: Some("DataPad++ Tests".into()),
            ..SqlServerConnectionOptions::default()
        }
    }

    fn secret_ref(id: &str) -> SecretRef {
        SecretRef {
            id: id.into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn".into(),
            label: "SQL Server secret".into(),
        }
    }

    fn resolved_connection(
        sqlserver_options: Option<SqlServerConnectionOptions>,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn".into(),
            name: "SQL Server".into(),
            engine: "sqlserver".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: None,
            database: Some("master".into()),
            username: Some("sa".into()),
            password: Some("secret".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}
