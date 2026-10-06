use tiberius::{AuthMethod, Client as SqlServerClient, Config, EncryptionLevel, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

use super::super::super::*;
use super::authentication::{authentication, Authentication};

pub(super) fn sqlserver_config(
    connection: &ResolvedConnectionProfile,
) -> Result<Config, CommandError> {
    let authentication = authentication(connection)?;
    let mut config = if let Some(connection_string) = &connection.connection_string {
        Config::from_ado_string(connection_string).map_err(|_| {
            CommandError::new(
                "sqlserver-connection-string-invalid",
                "The SQL Server connection string is invalid. Check the supported ADO.NET options.",
            )
        })?
    } else {
        config_from_fields(connection)?
    };

    if let Some(database) = connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        config.database(database);
    }

    apply_sqlserver_options(&mut config, connection)?;
    if authentication == Authentication::Windows {
        #[cfg(windows)]
        config.authentication(AuthMethod::Integrated);
    }
    if authentication == Authentication::Entra {
        config.encryption(EncryptionLevel::Required);
        // A placeholder prevents SQL credentials from ever being used; the shared session
        // path replaces this with a silently acquired token before making a TCP connection.
        config.authentication(AuthMethod::aad_token(String::new()));
    }
    Ok(config)
}

pub(super) async fn sqlserver_client(
    connection: &ResolvedConnectionProfile,
) -> Result<SqlServerClient<tokio_util::compat::Compat<TcpStream>>, CommandError> {
    let mut config = sqlserver_config(connection)?;
    if authentication(connection)? == Authentication::Entra {
        let token = crate::app::runtime::sqlserver_auth::access_token(
            connection
                .sqlserver_options
                .as_ref()
                .and_then(|o| o.authentication_context.as_ref()),
        )
        .await?;
        config.authentication(AuthMethod::aad_token(token.as_str()));
    }
    let routing_config = config.clone();
    let original_host = config
        .get_addr()
        .rsplit_once(':')
        .map(|(host, _)| host.to_ascii_lowercase())
        .unwrap_or_default();
    let tcp = if connection.connection_string.is_some() || connection.port.is_none() {
        // Also resolves named instances supplied only inside an opaque ADO string.
        // Without an instance the driver's helper makes a normal TCP connection.
        TcpStream::connect_named(&config).await?
    } else {
        TcpStream::connect(config.get_addr()).await?
    };

    tcp.set_nodelay(true)?;
    let client = match SqlServerClient::connect(config, tcp.compat_write()).await {
        // Only a TLS-validated public Azure SQL gateway may redirect login. This is
        // before any query is submitted, never a replay of a query or mutation.
        Err(tiberius::error::Error::Routing { host, port })
            if authentication(connection)? == Authentication::Entra
                && original_host.ends_with(".database.windows.net")
                && host.to_ascii_lowercase().ends_with(".database.windows.net")
                && port > 0 =>
        {
            let mut config = routing_config;
            config.host(host);
            config.port(port);
            let tcp = TcpStream::connect(config.get_addr()).await?;
            tcp.set_nodelay(true)?;
            SqlServerClient::connect(config, tcp.compat_write()).await?
        }
        result => result?,
    };
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
                "SQL Server {connect_mode} profiles are stored, but this build can only connect live through TCP, named instances, Azure SQL, or connection strings."
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
    let entra = authentication(connection)? == Authentication::Entra;
    let Some(options) = connection.sqlserver_options.as_ref() else {
        if !entra && connection.connection_string.is_none() {
            config.trust_cert();
        }
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
    } else if !entra
        && options
            .trust_server_certificate
            .unwrap_or(connection.connection_string.is_none())
    {
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
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/connection_tests.rs"]
mod tests;
