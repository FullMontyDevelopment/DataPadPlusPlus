use super::*;

#[test]
fn postgres_dsn_applies_native_profile_options() {
    let dsn = postgres_dsn(&ResolvedConnectionProfile {
        id: "conn-postgres".into(),
        name: "PostgreSQL".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        host: "db.internal".into(),
        port: Some(5432),
        database: Some("analytics".into()),
        username: Some("analyst".into()),
        password: Some("secret".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: Some(PostgresConnectionOptions {
            application_name: Some("DataPad++ QA".into()),
            search_path: Some("analytics, public".into()),
            target_session_attrs: Some("read-write".into()),
            connect_timeout_ms: Some(2_500),
            statement_timeout_ms: Some(5_000),
            lock_timeout_ms: Some(1_000),
            idle_in_transaction_session_timeout_ms: Some(30_000),
            use_tls: Some(true),
            verify_server_certificate: Some(true),
            ca_certificate_path: Some("C:/certs/root.pem".into()),
            client_certificate_path: Some("C:/certs/client.pem".into()),
            client_key_path: Some("C:/certs/client.key".into()),
            ..PostgresConnectionOptions::default()
        }),
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
    });

    assert!(dsn.starts_with("postgres://analyst:secret@db.internal:5432/analytics?"));
    assert!(dsn.contains("application_name=DataPad%2B%2B%20QA"));
    assert!(dsn.contains("target_session_attrs=read-write"));
    assert!(dsn.contains("connect_timeout=3"));
    assert!(dsn.contains("sslmode=verify-full"));
    assert!(dsn.contains("sslrootcert=C%3A%2Fcerts%2Froot.pem"));
    assert!(dsn.contains("sslcert=C%3A%2Fcerts%2Fclient.pem"));
    assert!(dsn.contains("sslkey=C%3A%2Fcerts%2Fclient.key"));
    assert!(dsn.contains(
        "options=-csearch_path%3Danalytics%2C%20public%20-cstatement_timeout%3D5000%20-clock_timeout%3D1000%20-cidle_in_transaction_session_timeout%3D30000"
    ));
}

#[test]
fn postgres_dsn_uses_cloud_sql_socket_host() {
    let query = postgres_dsn_query(&ResolvedConnectionProfile {
        id: "conn-postgres".into(),
        name: "PostgreSQL".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("postgres".into()),
        username: Some("postgres".into()),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: Some(PostgresConnectionOptions {
            connect_mode: Some("cloud-sql-proxy".into()),
            cloud_sql_instance: Some("project:region:instance".into()),
            ..PostgresConnectionOptions::default()
        }),
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
    });

    assert_eq!(query, "?host=%2Fcloudsql%2Fproject%3Aregion%3Ainstance");
}
