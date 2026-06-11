use super::*;
use crate::domain::models::SecretRef;

#[test]
fn interpolates_dynamodb_connection_options_without_materializing_secrets() {
    let options = DynamoDbConnectionOptions {
        connect_mode: Some("assume-role".into()),
        region: Some("{{AWS_REGION}}".into()),
        endpoint_url: Some("http://{{LOCALSTACK_HOST}}:4566".into()),
        profile_name: Some("{{AWS_PROFILE}}".into()),
        role_arn: Some("arn:aws:iam::{{AWS_ACCOUNT}}:role/DataPadReadOnly".into()),
        secret_access_key_ref: Some(SecretRef {
            id: "secret-aws".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-dynamo".into(),
            label: "AWS secret access key".into(),
        }),
        scan_page_size: Some(100),
        return_consumed_capacity: Some("indexes".into()),
        ..DynamoDbConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{AWS_REGION}}", "eu-west-1")
            .replace("{{LOCALSTACK_HOST}}", "localhost")
            .replace("{{AWS_PROFILE}}", "qa")
            .replace("{{AWS_ACCOUNT}}", "123456789012")
    };

    let resolved = interpolate_dynamodb_options(&options, &interpolate);

    assert_eq!(resolved.region.as_deref(), Some("eu-west-1"));
    assert_eq!(
        resolved.endpoint_url.as_deref(),
        Some("http://localhost:4566")
    );
    assert_eq!(resolved.profile_name.as_deref(), Some("qa"));
    assert_eq!(
        resolved.role_arn.as_deref(),
        Some("arn:aws:iam::123456789012:role/DataPadReadOnly")
    );
    assert_eq!(resolved.scan_page_size, Some(100));
    assert_eq!(
        resolved.return_consumed_capacity.as_deref(),
        Some("indexes")
    );
    assert_eq!(
        resolved
            .secret_access_key_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-aws")
    );
}

#[test]
fn interpolates_cassandra_contact_points_and_keyspace() {
    let options = CassandraConnectionOptions {
        contact_points: vec!["{{CASSANDRA_NODE_1}}:9042".into(), "node2:9042".into()],
        default_keyspace: Some("{{CASSANDRA_KEYSPACE}}".into()),
        local_datacenter: Some("{{CASSANDRA_DC}}".into()),
        secure_connect_bundle_path: Some("C:/bundles/{{CASSANDRA_BUNDLE}}.zip".into()),
        page_size: Some(500),
        ..CassandraConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{CASSANDRA_NODE_1}}", "node1")
            .replace("{{CASSANDRA_KEYSPACE}}", "catalog")
            .replace("{{CASSANDRA_DC}}", "dc1")
            .replace("{{CASSANDRA_BUNDLE}}", "qa")
    };

    let resolved = interpolate_cassandra_options(&options, &interpolate);

    assert_eq!(
        resolved.contact_points,
        vec!["node1:9042".to_string(), "node2:9042".to_string()]
    );
    assert_eq!(resolved.default_keyspace.as_deref(), Some("catalog"));
    assert_eq!(resolved.local_datacenter.as_deref(), Some("dc1"));
    assert_eq!(
        resolved.secure_connect_bundle_path.as_deref(),
        Some("C:/bundles/qa.zip")
    );
    assert_eq!(resolved.page_size, Some(500));
}

#[test]
fn interpolates_cosmosdb_options_without_secret_values() {
    let options = CosmosDbConnectionOptions {
        connect_mode: Some("account-endpoint".into()),
        api: Some("nosql".into()),
        account_endpoint: Some("https://{{COSMOS_ACCOUNT}}.documents.azure.com".into()),
        database_name: Some("{{COSMOS_DATABASE}}".into()),
        preferred_regions: vec!["{{COSMOS_REGION}}".into(), "West Europe".into()],
        account_key_secret_ref: Some(SecretRef {
            id: "secret-cosmos-key".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-cosmos".into(),
            label: "Cosmos account key".into(),
        }),
        max_item_count: Some(100),
        ..CosmosDbConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{COSMOS_ACCOUNT}}", "datapad")
            .replace("{{COSMOS_DATABASE}}", "catalog")
            .replace("{{COSMOS_REGION}}", "North Europe")
    };

    let resolved = interpolate_cosmosdb_options(&options, &interpolate);

    assert_eq!(
        resolved.account_endpoint.as_deref(),
        Some("https://datapad.documents.azure.com")
    );
    assert_eq!(resolved.database_name.as_deref(), Some("catalog"));
    assert_eq!(
        resolved.preferred_regions,
        vec!["North Europe".to_string(), "West Europe".to_string()]
    );
    assert_eq!(
        resolved
            .account_key_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-cosmos-key")
    );
}

#[test]
fn interpolates_search_options_without_secret_values() {
    let options = SearchConnectionOptions {
        connect_mode: Some("elastic-cloud".into()),
        endpoint_url: Some("https://{{SEARCH_CLUSTER}}.es.example.com".into()),
        default_index: Some("{{SEARCH_INDEX}}-*".into()),
        api_key_id: Some("{{SEARCH_KEY_ID}}".into()),
        api_key_secret_ref: Some(SecretRef {
            id: "secret-search-api-key".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-search".into(),
            label: "Search API key".into(),
        }),
        request_timeout_ms: Some(120_000),
        ..SearchConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{SEARCH_CLUSTER}}", "logs")
            .replace("{{SEARCH_INDEX}}", "orders")
            .replace("{{SEARCH_KEY_ID}}", "key-id")
    };

    let resolved = interpolate_search_options(&options, &interpolate);

    assert_eq!(
        resolved.endpoint_url.as_deref(),
        Some("https://logs.es.example.com")
    );
    assert_eq!(resolved.default_index.as_deref(), Some("orders-*"));
    assert_eq!(resolved.api_key_id.as_deref(), Some("key-id"));
    assert_eq!(resolved.request_timeout_ms, Some(120_000));
    assert_eq!(
        resolved
            .api_key_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-search-api-key")
    );
}
