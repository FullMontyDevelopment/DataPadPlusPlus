use super::{
    bigquery_auth_header, bigquery_dataset_id, bigquery_location, bigquery_project_id,
    bigquery_query_body, BigQueryEndpoint,
};

fn connection() -> crate::domain::models::ResolvedConnectionProfile {
    crate::domain::models::ResolvedConnectionProfile {
        id: "conn-bigquery".into(),
        name: "BigQuery".into(),
        engine: "bigquery".into(),
        family: "warehouse".into(),
        host: "ignored".into(),
        port: None,
        database: Some("fallback".into()),
        username: Some("fallback-project".into()),
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
        search_options: None,
        time_series_options: None,
        graph_options: None,
        warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
            endpoint_url: Some("http://localhost:19050/reverse".into()),
            path_prefix: Some("/bq".into()),
            project_id: Some("project-qa".into()),
            dataset_id: Some("mart".into()),
            location: Some("EU".into()),
            ..crate::domain::models::WarehouseConnectionOptions::default()
        }),
        read_only: true,
    }
}

#[test]
fn bigquery_endpoint_parses_prefixed_http_url() {
    let endpoint = BigQueryEndpoint::from_url("http://localhost:19050/bq").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19050);
    assert_eq!(
        endpoint.path("/bigquery/v2/projects/p/datasets"),
        "/bq/bigquery/v2/projects/p/datasets"
    );
}

#[test]
fn bigquery_query_body_uses_google_sql_and_dry_run() {
    let body = bigquery_query_body("select 1", 25, true);
    assert_eq!(body["query"], "select 1");
    assert_eq!(body["useLegacySql"], false);
    assert_eq!(body["dryRun"], true);
    assert_eq!(body["maxResults"], 25);
}

#[test]
fn bigquery_endpoint_and_scope_prefer_warehouse_options() {
    let connection = connection();

    let endpoint = BigQueryEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19050);
    assert_eq!(
        endpoint.path("/bigquery/v2/projects/p/datasets"),
        "/bq/bigquery/v2/projects/p/datasets"
    );
    assert_eq!(bigquery_project_id(&connection), "project-qa");
    assert_eq!(bigquery_dataset_id(&connection), "mart");
    assert_eq!(bigquery_location(&connection), "EU");
}

#[test]
fn bigquery_auth_header_rejects_newline_in_token() {
    let mut connection = connection();
    connection.password = Some("token\r\nX-Bad: injected".into());

    let error = bigquery_auth_header(&connection).unwrap_err();

    assert_eq!(error.code, "bigquery-invalid-token");
}

#[test]
fn bigquery_endpoint_rejects_invalid_http_parts() {
    let host_error = BigQueryEndpoint::from_url("http://local\r\nhost:19050/bq").unwrap_err();
    assert_eq!(host_error.code, "bigquery-endpoint-invalid");

    let authority_error = BigQueryEndpoint::from_url("http://localhost:19050?x=1").unwrap_err();
    assert_eq!(authority_error.code, "bigquery-endpoint-invalid");

    let prefix_error =
        BigQueryEndpoint::from_url_with_prefix("http://localhost:19050/bq?x=1", None).unwrap_err();
    assert_eq!(prefix_error.code, "bigquery-endpoint-invalid");

    let override_error =
        BigQueryEndpoint::from_url_with_prefix("http://localhost:19050/bq", Some("bad#x"))
            .unwrap_err();
    assert_eq!(override_error.code, "bigquery-endpoint-invalid");
}
