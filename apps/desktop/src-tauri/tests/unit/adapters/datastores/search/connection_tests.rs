use super::{search_live_disabled_reason, SearchEndpoint};
use crate::domain::models::{ResolvedConnectionProfile, SearchConnectionOptions};

#[test]
fn search_endpoint_parses_prefixed_http_url() {
    let endpoint = SearchEndpoint::from_url("http://localhost:19200/es").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19200);
    assert_eq!(endpoint.path("/_cluster/health"), "/es/_cluster/health");
}

#[test]
fn search_endpoint_prefers_typed_endpoint_and_path_prefix() {
    let connection = search_connection(Some(SearchConnectionOptions {
        endpoint_url: Some("http://localhost:19200/reverse".into()),
        path_prefix: Some("/elastic".into()),
        ..SearchConnectionOptions::default()
    }));

    let endpoint = SearchEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19200);
    assert_eq!(
        endpoint.path("/_cluster/health"),
        "/elastic/_cluster/health"
    );
}

#[test]
fn search_live_disabled_reasons_cover_cloud_token_tls_and_https() {
    let elastic_cloud = search_connection(Some(SearchConnectionOptions {
        connect_mode: Some("elastic-cloud".into()),
        cloud_id: Some("deployment:encoded".into()),
        ..SearchConnectionOptions::default()
    }));
    assert!(search_live_disabled_reason(&elastic_cloud)
        .unwrap()
        .contains("Elastic Cloud"));

    let api_key = search_connection(Some(SearchConnectionOptions {
        auth_mode: Some("api-key".into()),
        endpoint_url: Some("http://localhost:9200".into()),
        ..SearchConnectionOptions::default()
    }));
    assert!(search_live_disabled_reason(&api_key)
        .unwrap()
        .contains("API key"));

    let sigv4 = search_connection(Some(SearchConnectionOptions {
        connect_mode: Some("aws-sigv4".into()),
        auth_mode: Some("aws-sigv4".into()),
        endpoint_url: Some("https://search.us-east-1.es.amazonaws.com".into()),
        ..SearchConnectionOptions::default()
    }));
    assert!(search_live_disabled_reason(&sigv4)
        .unwrap()
        .contains("AWS SigV4"));

    let tls = search_connection(Some(SearchConnectionOptions {
        use_tls: Some(true),
        ca_certificate_path: Some("/certs/ca.pem".into()),
        ..SearchConnectionOptions::default()
    }));
    assert!(search_live_disabled_reason(&tls).unwrap().contains("TLS"));

    let https = ResolvedConnectionProfile {
        connection_string: Some("https://search.example.com".into()),
        ..search_connection(None)
    };
    assert!(search_live_disabled_reason(&https)
        .unwrap()
        .contains("HTTPS"));

    assert!(
        search_live_disabled_reason(&search_connection(Some(SearchConnectionOptions {
            auth_mode: Some("basic".into()),
            endpoint_url: Some("http://localhost:9200".into()),
            ..SearchConnectionOptions::default()
        })))
        .is_none()
    );
}

fn search_connection(search_options: Option<SearchConnectionOptions>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-search".into(),
        name: "Search".into(),
        engine: "elasticsearch".into(),
        family: "search".into(),
        host: "localhost".into(),
        port: Some(9200),
        database: None,
        username: None,
        password: None,
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
        search_options,
        time_series_options: None,
        graph_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
