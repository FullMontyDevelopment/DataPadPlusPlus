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
