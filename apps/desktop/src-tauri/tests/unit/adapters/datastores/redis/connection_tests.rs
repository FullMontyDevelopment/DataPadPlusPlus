use super::{redis_uri_from_endpoint, redis_uri_from_parts};
use crate::domain::models::{RedisConnectionOptions, ResolvedConnectionProfile};

#[test]
fn builds_standalone_acl_uri_with_database_and_resp_version() {
    let connection = connection(Some(RedisConnectionOptions {
        database_index: Some(2),
        resp_version: Some("resp3".into()),
        ..RedisConnectionOptions::default()
    }));

    assert_eq!(
        redis_uri_from_endpoint(&connection, "localhost:6379", "standalone"),
        "redis://user:p%40ss@localhost:6379/2?protocol=3"
    );
}

#[test]
fn builds_tls_and_unix_redis_uris() {
    let tls = connection(Some(RedisConnectionOptions {
        use_tls: Some(true),
        allow_invalid_certificates: Some(true),
        ..RedisConnectionOptions::default()
    }));
    assert_eq!(
        redis_uri_from_endpoint(&tls, "cache.example.com:6380", "tls"),
        "rediss://user:p%40ss@cache.example.com:6380/0#insecure"
    );

    assert_eq!(
        redis_uri_from_parts(
            "redis+unix",
            "/var/run/redis.sock",
            Some(1),
            Some("user"),
            Some("p@ss"),
            false,
            Some("resp2"),
        ),
        "redis+unix:///var/run/redis.sock?db=1&user=user&pass=p%40ss&protocol=2"
    );
}

fn connection(redis_options: Option<RedisConnectionOptions>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "redis".into(),
        name: "Redis".into(),
        engine: "redis".into(),
        family: "keyvalue".into(),
        host: "localhost".into(),
        port: Some(6379),
        database: Some("0".into()),
        username: Some("user".into()),
        password: Some("p@ss".into()),
        connection_string: None,
        redis_options,
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
