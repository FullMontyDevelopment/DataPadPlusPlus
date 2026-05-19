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
            format!(
                "SQL Server {auth_mode} authentication is represented in the profile, but live connections require a configured token/runtime path. Use SQL Server authentication or a connection string for now."
            ),
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

#[cfg(test)]
mod tests {
    use crate::domain::models::SqlServerConnectionOptions;

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
            sqlite_options: None,
            sqlserver_options,
            oracle_options: None,
            read_only: false,
        }
    }
}
