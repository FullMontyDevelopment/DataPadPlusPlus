use super::profiles::{connection_test_timeout_ms, fixture_connection_warnings};
use crate::domain::models::{
    CosmosDbConnectionOptions, MemcachedConnectionOptions, MySqlConnectionOptions,
    RedisConnectionOptions, ResolvedConnectionProfile, SqlServerConnectionOptions,
};

#[test]
fn fixture_connection_warnings_help_with_mongodb_fixture_ports() {
    let connection = resolved_connection("mongodb", 27017, Some("admin"), Some("root"), None);

    let warnings = fixture_connection_warnings(&connection);

    assert_eq!(
        warnings,
        vec![
            "DataPad++ Docker fixtures expose MongoDB on localhost:27018.",
            "Fixture database is \"catalog\".",
            "Fixture user is \"datapadplusplus\".",
            "This fixture connection needs a password before it can be tested.",
        ]
    );
}

#[test]
fn fixture_connection_warnings_respect_inline_test_secret() {
    let connection = resolved_connection(
        "mongodb",
        27017,
        Some("catalog"),
        Some("datapadplusplus"),
        Some("provided-secret"),
    );

    assert_eq!(
        fixture_connection_warnings(&connection),
        vec!["DataPad++ Docker fixtures expose MongoDB on localhost:27018."]
    );
}

#[test]
fn fixture_connection_warnings_help_with_cosmosdb_emulator_urls() {
    let mut connection = resolved_connection("cosmosdb", 8081, Some("catalog"), None, None);
    connection.host = "http://localhost:8081".into();
    connection.cosmos_db_options = Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some("http://localhost:8081".into()),
        database_name: Some("catalog".into()),
        auth_mode: Some("emulator".into()),
        ..CosmosDbConnectionOptions::default()
    });

    let warnings = fixture_connection_warnings(&connection);

    assert_eq!(
        warnings,
        vec![
            "DataPad++ Docker fixtures expose Cosmos DB emulator on localhost:8082.",
            "Fixture database is \"datapadplusplus\".",
            "For Microsoft Cosmos DB emulator use http://localhost:8081. For DataPad++ fixtures run npm run fixtures:up:profile -- cosmosdb and use http://localhost:8082.",
        ]
    );
}

#[test]
fn connection_test_timeout_uses_configured_values_with_bounds() {
    let mut connection = resolved_connection("redis", 6379, Some("0"), None, None);

    assert_eq!(connection_test_timeout_ms(&connection), 20_000);

    connection.redis_options = Some(RedisConnectionOptions {
        connection_timeout_ms: Some(2_500),
        command_timeout_ms: Some(5_000),
        ..RedisConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 2_500);

    connection.redis_options = Some(RedisConnectionOptions {
        connection_timeout_ms: Some(250),
        ..RedisConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 1_000);

    connection.redis_options = Some(RedisConnectionOptions {
        connection_timeout_ms: Some(180_000),
        ..RedisConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 120_000);

    connection.redis_options = None;
    connection.memcached_options = Some(MemcachedConnectionOptions {
        request_timeout_ms: Some(12_000),
        ..MemcachedConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 12_000);

    connection.memcached_options = None;
    connection.mysql_options = Some(MySqlConnectionOptions {
        command_timeout_ms: Some(18_000),
        ..MySqlConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 18_000);

    connection.mysql_options = None;
    connection.sqlserver_options = Some(SqlServerConnectionOptions {
        command_timeout_ms: Some(42_000),
        ..SqlServerConnectionOptions::default()
    });
    assert_eq!(connection_test_timeout_ms(&connection), 42_000);
}

fn resolved_connection(
    engine: &str,
    port: u16,
    database: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-test".into(),
        name: "Test connection".into(),
        engine: engine.into(),
        family: "document".into(),
        host: "localhost".into(),
        port: Some(port),
        database: database.map(str::to_string),
        username: username.map(str::to_string),
        password: password.map(str::to_string),
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
        warehouse_options: None,
        read_only: false,
    }
}
