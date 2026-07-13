use super::{oracle_execution_runtime, oracle_sidecar_candidates, oracle_target_triple};
use crate::domain::models::ResolvedConnectionProfile;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "oracle-sidecar-test".into(),
        name: "Oracle sidecar test".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(1521),
        database: Some("FREEPDB1".into()),
        username: Some("datapad".into()),
        password: Some("secret".into()),
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

#[test]
fn missing_oracle_runtime_defaults_to_managed() {
    assert_eq!(oracle_execution_runtime(&connection()), "managed");
}

#[test]
fn development_sidecar_candidates_include_current_target() {
    let expected = format!(
        "datapadplusplus-oracle-runtime-{}{}",
        oracle_target_triple(),
        std::env::consts::EXE_SUFFIX
    );
    assert!(oracle_sidecar_candidates().iter().any(|candidate| {
        candidate
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == expected)
            .unwrap_or(false)
    }));
}
