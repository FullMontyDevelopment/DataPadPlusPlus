use duckdb::types::{TimeUnit, ValueRef};

use super::{
    duckdb_database_path, duckdb_quote_identifier, duckdb_value_to_string,
    validate_duckdb_database_path,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn duckdb_database_path_uses_connection_string() {
    let connection = ResolvedConnectionProfile {
        id: "conn-duckdb".into(),
        name: "DuckDB".into(),
        engine: "duckdb".into(),
        family: "embedded-olap".into(),
        host: String::new(),
        port: None,
        database: Some("ignored.duckdb".into()),
        username: None,
        password: None,
        connection_string: Some("duckdb://:memory:".into()),
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
        read_only: true,
    };

    assert_eq!(duckdb_database_path(&connection), ":memory:");
}

#[test]
fn duckdb_database_path_prefers_warehouse_file_path() {
    let connection = ResolvedConnectionProfile {
        id: "conn-duckdb".into(),
        name: "DuckDB".into(),
        engine: "duckdb".into(),
        family: "embedded-olap".into(),
        host: String::new(),
        port: None,
        database: Some("ignored.duckdb".into()),
        username: None,
        password: None,
        connection_string: Some("duckdb://other.duckdb".into()),
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
        warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
            file_path: Some("duckdb://C:/data/analytics.duckdb".into()),
            extensions: vec!["httpfs".into(), "parquet".into()],
            ..crate::domain::models::WarehouseConnectionOptions::default()
        }),
        read_only: true,
    };

    assert_eq!(
        duckdb_database_path(&connection),
        "C:/data/analytics.duckdb"
    );
    assert_eq!(
        super::duckdb_extensions(&connection),
        vec!["httpfs", "parquet"]
    );
}

#[test]
fn duckdb_database_path_validation_blocks_remote_and_control_paths() {
    let remote = validate_duckdb_database_path("s3://bucket/analytics.duckdb").unwrap_err();
    assert_eq!(remote.code, "duckdb-path-unsupported");

    let control = validate_duckdb_database_path("C:/data/bad\r\npath.duckdb").unwrap_err();
    assert_eq!(control.code, "duckdb-path-invalid");

    validate_duckdb_database_path(":memory:").unwrap();
    validate_duckdb_database_path("C:/data/analytics.duckdb").unwrap();
}

#[test]
fn duckdb_quote_identifier_escapes_quotes() {
    assert_eq!(duckdb_quote_identifier("odd\"table"), "\"odd\"\"table\"");
}

#[test]
fn duckdb_temporal_values_render_as_native_values() {
    assert_eq!(
        duckdb_value_to_string(ValueRef::Date32(20_859)),
        "2027-02-10"
    );
    assert_eq!(
        duckdb_value_to_string(ValueRef::Time64(TimeUnit::Microsecond, 41_348_356_405)),
        "11:29:08.356405",
    );
    assert_eq!(
        duckdb_value_to_string(ValueRef::Timestamp(
            TimeUnit::Microsecond,
            1_778_930_948_356_405,
        )),
        "2026-05-16 11:29:08.356405",
    );
}
