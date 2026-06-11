use crate::domain::models::{DynamoDbConnectionOptions, ResolvedConnectionProfile};

use super::{
    dynamodb_auth_disabled_reasons, dynamodb_auth_evidence_payload, dynamodb_authorization_header,
    DynamoDbEndpoint,
};

#[test]
fn dynamodb_endpoint_parses_prefixed_http_url() {
    let endpoint = DynamoDbEndpoint::from_url("http://localhost:18000/dynamo").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18000);
    assert_eq!(endpoint.path("/"), "/dynamo/");
}

#[test]
fn dynamodb_endpoint_prefers_typed_endpoint_url() {
    let connection = test_connection(Some(DynamoDbConnectionOptions {
        endpoint_url: Some("http://127.0.0.1:8001/aws".into()),
        ..DynamoDbConnectionOptions::default()
    }));

    let endpoint = DynamoDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "127.0.0.1");
    assert_eq!(endpoint.port, 8001);
    assert_eq!(endpoint.path("/"), "/aws/");
}

#[test]
fn dynamodb_authorization_header_is_sigv4_shaped_without_secret_material() {
    let connection = test_connection(Some(DynamoDbConnectionOptions {
        connect_mode: Some("access-keys".into()),
        region: Some("eu-west-1".into()),
        access_key_id: Some("AKIA1234567890ABCD".into()),
        ..DynamoDbConnectionOptions::default()
    }));
    let endpoint = DynamoDbEndpoint::from_connection(&connection).unwrap();

    let header = dynamodb_authorization_header(&connection, &endpoint);
    let evidence = dynamodb_auth_evidence_payload(&connection);

    assert!(header.starts_with("AWS4-HMAC-SHA256 Credential=AKIA1234567890ABCD/"));
    assert!(header.contains("/eu-west-1/dynamodb/aws4_request"));
    assert!(header.contains("SignedHeaders=content-type;host;x-amz-date;x-amz-target"));
    assert_eq!(evidence["accessKeyId"], "AKIA...ABCD");
    assert_eq!(evidence["signedHeaders"][2], "x-amz-date");
}

#[test]
fn dynamodb_auth_evidence_reports_cloud_disabled_reasons() {
    let connection = test_connection(Some(DynamoDbConnectionOptions {
        connect_mode: Some("assume-role".into()),
        region: Some("us-east-2".into()),
        role_arn: Some("arn:aws:iam::123456789012:role/DataPad".into()),
        ..DynamoDbConnectionOptions::default()
    }));

    let evidence = dynamodb_auth_evidence_payload(&connection);
    let reasons = dynamodb_auth_disabled_reasons(&connection).join(" ");

    assert_eq!(evidence["connectMode"], "assume-role");
    assert_eq!(evidence["endpointMode"], "aws-cloud-contract");
    assert_eq!(evidence["liveCloudRuntime"], false);
    assert!(reasons.contains("STS AssumeRole"));
    assert!(reasons.contains("CloudWatch"));
}

fn test_connection(
    dynamo_db_options: Option<DynamoDbConnectionOptions>,
) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "dynamo".into(),
        name: "DynamoDB".into(),
        engine: "dynamodb".into(),
        family: "widecolumn".into(),
        host: "dynamodb.us-east-1.amazonaws.com".into(),
        port: Some(443),
        database: Some("local".into()),
        username: Some("local".into()),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
