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
#[path = "../../../tests/unit/app/runtime/profile_options_cloud_tests.rs"]
mod tests;
