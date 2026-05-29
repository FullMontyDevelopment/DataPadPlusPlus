use crate::domain::models::{
    CassandraConnectionOptions, CosmosDbConnectionOptions, DynamoDbConnectionOptions,
    SearchConnectionOptions,
};

pub(super) fn interpolate_dynamodb_options(
    options: &DynamoDbConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> DynamoDbConnectionOptions {
    DynamoDbConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        region: options.region.as_deref().map(interpolate),
        endpoint_url: options.endpoint_url.as_deref().map(interpolate),
        table_prefix: options.table_prefix.as_deref().map(interpolate),
        account_id: options.account_id.as_deref().map(interpolate),
        profile_name: options.profile_name.as_deref().map(interpolate),
        credentials_provider: options.credentials_provider.as_deref().map(interpolate),
        access_key_id: options.access_key_id.as_deref().map(interpolate),
        secret_access_key_ref: options.secret_access_key_ref.clone(),
        session_token_ref: options.session_token_ref.clone(),
        role_arn: options.role_arn.as_deref().map(interpolate),
        external_id: options.external_id.as_deref().map(interpolate),
        role_session_name: options.role_session_name.as_deref().map(interpolate),
        web_identity_token_file: options.web_identity_token_file.as_deref().map(interpolate),
        use_dual_stack_endpoint: options.use_dual_stack_endpoint,
        use_fips_endpoint: options.use_fips_endpoint,
        force_path_style: options.force_path_style,
        signer_region: options.signer_region.as_deref().map(interpolate),
        retry_mode: options.retry_mode.as_deref().map(interpolate),
        max_attempts: options.max_attempts,
        connect_timeout_ms: options.connect_timeout_ms,
        request_timeout_ms: options.request_timeout_ms,
        read_timeout_ms: options.read_timeout_ms,
        tcp_keep_alive: options.tcp_keep_alive,
        api_version: options.api_version.as_deref().map(interpolate),
        scan_page_size: options.scan_page_size,
        consistent_read_default: options.consistent_read_default,
        return_consumed_capacity: options.return_consumed_capacity.as_deref().map(interpolate),
    }
}

pub(super) fn interpolate_cassandra_options(
    options: &CassandraConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> CassandraConnectionOptions {
    CassandraConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        contact_points: options
            .contact_points
            .iter()
            .map(|point| interpolate(point))
            .collect(),
        default_keyspace: options.default_keyspace.as_deref().map(interpolate),
        local_datacenter: options.local_datacenter.as_deref().map(interpolate),
        protocol_version: options.protocol_version.as_deref().map(interpolate),
        auth_provider: options.auth_provider.as_deref().map(interpolate),
        secure_connect_bundle_path: options
            .secure_connect_bundle_path
            .as_deref()
            .map(interpolate),
        use_tls: options.use_tls,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        compression: options.compression.as_deref().map(interpolate),
        consistency_level: options.consistency_level.as_deref().map(interpolate),
        serial_consistency_level: options.serial_consistency_level.as_deref().map(interpolate),
        load_balancing_policy: options.load_balancing_policy.as_deref().map(interpolate),
        retry_policy: options.retry_policy.as_deref().map(interpolate),
        page_size: options.page_size,
        connect_timeout_ms: options.connect_timeout_ms,
        request_timeout_ms: options.request_timeout_ms,
        read_timeout_ms: options.read_timeout_ms,
        heartbeat_interval_ms: options.heartbeat_interval_ms,
        application_name: options.application_name.as_deref().map(interpolate),
        client_id: options.client_id.as_deref().map(interpolate),
        enable_tracing_default: options.enable_tracing_default,
        allow_beta_protocol: options.allow_beta_protocol,
    }
}

pub(super) fn interpolate_cosmosdb_options(
    options: &CosmosDbConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> CosmosDbConnectionOptions {
    CosmosDbConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        api: options.api.as_deref().map(interpolate),
        account_endpoint: options.account_endpoint.as_deref().map(interpolate),
        account_name: options.account_name.as_deref().map(interpolate),
        database_name: options.database_name.as_deref().map(interpolate),
        container_prefix: options.container_prefix.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        account_key_secret_ref: options.account_key_secret_ref.clone(),
        resource_token_secret_ref: options.resource_token_secret_ref.clone(),
        tenant_id: options.tenant_id.as_deref().map(interpolate),
        client_id: options.client_id.as_deref().map(interpolate),
        managed_identity_client_id: options
            .managed_identity_client_id
            .as_deref()
            .map(interpolate),
        subscription_id: options.subscription_id.as_deref().map(interpolate),
        resource_group: options.resource_group.as_deref().map(interpolate),
        preferred_regions: options
            .preferred_regions
            .iter()
            .map(|region| interpolate(region))
            .collect(),
        write_region: options.write_region.as_deref().map(interpolate),
        consistency_level: options.consistency_level.as_deref().map(interpolate),
        enable_cross_partition_queries: options.enable_cross_partition_queries,
        max_item_count: options.max_item_count,
        return_request_charge: options.return_request_charge,
        gateway_mode: options.gateway_mode.as_deref().map(interpolate),
        use_tls: options.use_tls,
        allow_self_signed_emulator_certificate: options.allow_self_signed_emulator_certificate,
        retry_mode: options.retry_mode.as_deref().map(interpolate),
        max_retry_attempts: options.max_retry_attempts,
        request_timeout_ms: options.request_timeout_ms,
        connection_timeout_ms: options.connection_timeout_ms,
        application_name: options.application_name.as_deref().map(interpolate),
    }
}

pub(super) fn interpolate_search_options(
    options: &SearchConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> SearchConnectionOptions {
    SearchConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        endpoint_url: options.endpoint_url.as_deref().map(interpolate),
        cloud_id: options.cloud_id.as_deref().map(interpolate),
        default_index: options.default_index.as_deref().map(interpolate),
        path_prefix: options.path_prefix.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        username: options.username.as_deref().map(interpolate),
        api_key_id: options.api_key_id.as_deref().map(interpolate),
        api_key_secret_ref: options.api_key_secret_ref.clone(),
        bearer_token_secret_ref: options.bearer_token_secret_ref.clone(),
        service_token_secret_ref: options.service_token_secret_ref.clone(),
        aws_region: options.aws_region.as_deref().map(interpolate),
        aws_service: options.aws_service.as_deref().map(interpolate),
        aws_profile_name: options.aws_profile_name.as_deref().map(interpolate),
        aws_role_arn: options.aws_role_arn.as_deref().map(interpolate),
        verify_certificates: options.verify_certificates,
        use_tls: options.use_tls,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        compression: options.compression,
        request_timeout_ms: options.request_timeout_ms,
        connection_timeout_ms: options.connection_timeout_ms,
        max_retries: options.max_retries,
        sniff_on_start: options.sniff_on_start,
        opaque_id: options.opaque_id.as_deref().map(interpolate),
    }
}

#[cfg(test)]
mod tests {
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
}
