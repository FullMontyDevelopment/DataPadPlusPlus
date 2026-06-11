use super::timescale_connection_warnings;
use crate::domain::models::{PostgresConnectionOptions, ResolvedConnectionProfile};

#[test]
fn timescale_connection_warnings_compare_profile_metadata() {
    let connection = ResolvedConnectionProfile {
        id: "conn-timescale".into(),
        name: "TimescaleDB".into(),
        engine: "timescaledb".into(),
        family: "timeseries".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("datapadplusplus".into()),
        username: Some("app".into()),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: Some(PostgresConnectionOptions {
            timescale_extension_schema: Some("timescaledb".into()),
            timescale_extension_version: Some("2.15.0".into()),
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
        warehouse_options: None,
        read_only: false,
    };

    let warnings = timescale_connection_warnings(
        &connection,
        Some(&("2.14.2".to_string(), "public".to_string())),
    );

    assert_eq!(warnings.len(), 2);
    assert!(warnings[0].contains("schema timescaledb"));
    assert!(warnings[1].contains("version 2.15.0"));
}
