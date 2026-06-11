use super::*;
use crate::domain::models::SecretRef;

#[test]
fn interpolates_mysql_options_without_secret_values() {
    let options = MySqlConnectionOptions {
        connect_mode: Some("{{MYSQL_MODE}}".into()),
        auth_mode: Some("password".into()),
        ssl_mode: Some("verify-identity".into()),
        server_flavor: Some("{{MYSQL_FLAVOR}}".into()),
        application_name: Some("{{APP_NAME}}".into()),
        charset: Some("{{MYSQL_CHARSET}}".into()),
        collation: Some("{{MYSQL_COLLATION}}".into()),
        time_zone: Some("{{MYSQL_TIMEZONE}}".into()),
        sql_mode: Some("{{MYSQL_SQL_MODE}}".into()),
        default_storage_engine: Some("{{MYSQL_ENGINE}}".into()),
        allow_local_infile: Some(true),
        statement_cache_capacity: Some(250),
        connect_timeout_ms: Some(2_500),
        command_timeout_ms: Some(5_000),
        ca_certificate_path: Some("{{MYSQL_CERT_DIR}}/root.pem".into()),
        certificate_password_secret_ref: Some(SecretRef {
            id: "secret-mysql-cert".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-mysql".into(),
            label: "MySQL certificate password".into(),
        }),
        cloud_sql_instance: Some("{{MYSQL_INSTANCE}}".into()),
        ..MySqlConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{MYSQL_MODE}}", "cloud-sql-proxy")
            .replace("{{MYSQL_FLAVOR}}", "mariadb")
            .replace("{{APP_NAME}}", "DataPad++ QA")
            .replace("{{MYSQL_CHARSET}}", "utf8mb4")
            .replace("{{MYSQL_COLLATION}}", "utf8mb4_0900_ai_ci")
            .replace("{{MYSQL_TIMEZONE}}", "+00:00")
            .replace("{{MYSQL_SQL_MODE}}", "STRICT_TRANS_TABLES")
            .replace("{{MYSQL_ENGINE}}", "InnoDB")
            .replace("{{MYSQL_CERT_DIR}}", "C:/certs")
            .replace("{{MYSQL_INSTANCE}}", "project:region:instance")
    };

    let resolved = interpolate_mysql_options(&options, &interpolate);

    assert_eq!(resolved.connect_mode.as_deref(), Some("cloud-sql-proxy"));
    assert_eq!(resolved.server_flavor.as_deref(), Some("mariadb"));
    assert_eq!(resolved.application_name.as_deref(), Some("DataPad++ QA"));
    assert_eq!(resolved.charset.as_deref(), Some("utf8mb4"));
    assert_eq!(resolved.collation.as_deref(), Some("utf8mb4_0900_ai_ci"));
    assert_eq!(resolved.time_zone.as_deref(), Some("+00:00"));
    assert_eq!(resolved.sql_mode.as_deref(), Some("STRICT_TRANS_TABLES"));
    assert_eq!(resolved.default_storage_engine.as_deref(), Some("InnoDB"));
    assert_eq!(resolved.allow_local_infile, Some(true));
    assert_eq!(resolved.connect_timeout_ms, Some(2_500));
    assert_eq!(resolved.command_timeout_ms, Some(5_000));
    assert_eq!(
        resolved.ca_certificate_path.as_deref(),
        Some("C:/certs/root.pem")
    );
    assert_eq!(
        resolved.cloud_sql_instance.as_deref(),
        Some("project:region:instance")
    );
    assert_eq!(
        resolved
            .certificate_password_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-mysql-cert")
    );
}
