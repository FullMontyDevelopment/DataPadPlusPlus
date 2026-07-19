use super::*;

#[test]
fn mysql_dsn_percent_encodes_credentials_and_database() {
    let connection = ResolvedConnectionProfile {
        id: "conn".into(),
        name: "MySQL".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(3306),
        database: Some("qa data".into()),
        username: Some("user@example.com".into()),
        password: Some("p@ss:word/1".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    };

    assert_eq!(
        mysql_dsn(&connection),
        "mysql://user%40example.com:p%40ss%3Aword%2F1@localhost:3306/qa%20data"
    );
}

#[test]
fn explicit_mysql_connection_string_is_preserved() {
    let mut connection = ResolvedConnectionProfile {
        id: "conn".into(),
        name: "MySQL".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(3306),
        database: Some("app".into()),
        username: Some("root".into()),
        password: Some("secret".into()),
        connection_string: Some("mysql://custom".into()),
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    };

    assert_eq!(mysql_dsn(&connection), "mysql://custom");
    connection.connection_string = None;
    assert!(mysql_dsn(&connection).starts_with("mysql://root:secret@"));
}

#[test]
fn mysql_dsn_applies_native_profile_options() {
    let connection = ResolvedConnectionProfile {
        id: "conn".into(),
        name: "MySQL".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        host: "db.internal".into(),
        port: Some(3306),
        database: Some("analytics".into()),
        username: Some("analyst".into()),
        password: Some("secret".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: Some(MySqlConnectionOptions {
            connect_mode: Some("cloud-sql-proxy".into()),
            ssl_mode: Some("verify-identity".into()),
            charset: Some("utf8mb4".into()),
            collation: Some("utf8mb4_0900_ai_ci".into()),
            time_zone: Some("+00:00".into()),
            statement_cache_capacity: Some(250),
            ca_certificate_path: Some("C:/certs/root.pem".into()),
            client_certificate_path: Some("C:/certs/client.pem".into()),
            client_key_path: Some("C:/certs/client.key".into()),
            cloud_sql_instance: Some("project:region:instance".into()),
            connect_timeout_ms: Some(2_500),
            ..MySqlConnectionOptions::default()
        }),
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    };

    let dsn = mysql_dsn(&connection);

    assert!(dsn.starts_with("mysql://analyst:secret@db.internal:3306/analytics?"));
    assert!(dsn.contains("ssl-mode=VERIFY_IDENTITY"));
    assert!(dsn.contains("charset=utf8mb4"));
    assert!(dsn.contains("collation=utf8mb4_0900_ai_ci"));
    assert!(dsn.contains("timezone=%2B00%3A00"));
    assert!(dsn.contains("statement-cache-capacity=250"));
    assert!(dsn.contains("ssl-ca=C%3A%2Fcerts%2Froot.pem"));
    assert!(dsn.contains("ssl-cert=C%3A%2Fcerts%2Fclient.pem"));
    assert!(dsn.contains("ssl-key=C%3A%2Fcerts%2Fclient.key"));
    assert!(dsn.contains("socket=%2Fcloudsql%2Fproject%3Aregion%3Ainstance"));
    assert_eq!(mysql_timeout_ms(&connection), Some(2_500));
}
