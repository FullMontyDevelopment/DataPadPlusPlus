use crate::domain::models::{
    MemcachedConnectionOptions, OracleConnectionOptions, PostgresConnectionOptions,
    RedisConnectionOptions, SqlServerConnectionOptions, SqliteConnectionOptions,
};

pub(super) fn interpolate_redis_options(
    options: &RedisConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> RedisConnectionOptions {
    RedisConnectionOptions {
        deployment_mode: options.deployment_mode.as_deref().map(interpolate),
        database_index: options.database_index,
        use_tls: options.use_tls,
        client_name: options.client_name.as_deref().map(interpolate),
        resp_version: options.resp_version.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        command_timeout_ms: options.command_timeout_ms,
        retry_count: options.retry_count,
        retry_delay_ms: options.retry_delay_ms,
        keep_alive: options.keep_alive,
        auto_reconnect: options.auto_reconnect,
        read_only_mode: options.read_only_mode,
        pipeline_mode: options.pipeline_mode,
        compression: options.compression.as_deref().map(interpolate),
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        verify_server_certificate: options.verify_server_certificate,
        allow_invalid_certificates: options.allow_invalid_certificates,
        allow_invalid_hostnames: options.allow_invalid_hostnames,
        sentinel_master_name: options.sentinel_master_name.as_deref().map(interpolate),
        sentinel_hosts: options
            .sentinel_hosts
            .iter()
            .map(|host| interpolate(host))
            .collect(),
        sentinel_username: options.sentinel_username.as_deref().map(interpolate),
        sentinel_password_secret_ref: options.sentinel_password_secret_ref.clone(),
        use_sentinel_tls: options.use_sentinel_tls,
        cluster_nodes: options
            .cluster_nodes
            .iter()
            .map(|node| interpolate(node))
            .collect(),
        auto_discover_cluster_nodes: options.auto_discover_cluster_nodes,
        read_from_replicas: options.read_from_replicas,
        cluster_refresh_interval_ms: options.cluster_refresh_interval_ms,
        unix_socket_path: options.unix_socket_path.as_deref().map(interpolate),
    }
}

pub(super) fn interpolate_memcached_options(
    options: &MemcachedConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> MemcachedConnectionOptions {
    MemcachedConnectionOptions {
        servers: options
            .servers
            .iter()
            .map(|server| interpolate(server))
            .collect(),
        protocol: options.protocol.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        username: options.username.as_deref().map(interpolate),
        sasl_password_secret_ref: options.sasl_password_secret_ref.clone(),
        namespace_prefix: options.namespace_prefix.as_deref().map(interpolate),
        default_ttl_seconds: options.default_ttl_seconds,
        connect_timeout_ms: options.connect_timeout_ms,
        request_timeout_ms: options.request_timeout_ms,
        tcp_no_delay: options.tcp_no_delay,
        keep_alive: options.keep_alive,
        enable_compression: options.enable_compression,
        lru_crawler_enabled: options.lru_crawler_enabled,
        flush_delay_seconds: options.flush_delay_seconds,
        read_only_mode: options.read_only_mode,
        max_value_bytes: options.max_value_bytes,
    }
}

pub(super) fn interpolate_sqlite_options(
    options: &SqliteConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> SqliteConnectionOptions {
    SqliteConnectionOptions {
        open_mode: options.open_mode.as_deref().map(interpolate),
        use_uri_filename: options.use_uri_filename,
        create_if_missing: options.create_if_missing,
        immutable: options.immutable,
        shared_cache: options.shared_cache,
        private_cache: options.private_cache,
        busy_timeout_ms: options.busy_timeout_ms,
        default_timeout_ms: options.default_timeout_ms,
        journal_mode: options.journal_mode.as_deref().map(interpolate),
        synchronous_mode: options.synchronous_mode.as_deref().map(interpolate),
        cache_mode: options.cache_mode.as_deref().map(interpolate),
        cache_size: options.cache_size,
        page_size: options.page_size,
        foreign_keys: options.foreign_keys,
        recursive_triggers: options.recursive_triggers,
        case_sensitive_like: options.case_sensitive_like,
        temp_store_mode: options.temp_store_mode.as_deref().map(interpolate),
        locking_mode: options.locking_mode.as_deref().map(interpolate),
        auto_vacuum: options.auto_vacuum.as_deref().map(interpolate),
        mmap_size: options.mmap_size,
        application_id: options.application_id,
        user_version: options.user_version,
        encoding: options.encoding.as_deref().map(interpolate),
        encryption_provider: options.encryption_provider.as_deref().map(interpolate),
        encryption_key_secret_ref: options.encryption_key_secret_ref.clone(),
        cipher_compatibility: options.cipher_compatibility.as_deref().map(interpolate),
        kdf_iterations: options.kdf_iterations,
        cipher_page_size: options.cipher_page_size,
        hmac_enabled: options.hmac_enabled,
    }
}

pub(super) fn interpolate_postgres_options(
    options: &PostgresConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> PostgresConnectionOptions {
    PostgresConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        application_name: options.application_name.as_deref().map(interpolate),
        search_path: options.search_path.as_deref().map(interpolate),
        target_session_attrs: options.target_session_attrs.as_deref().map(interpolate),
        connect_timeout_ms: options.connect_timeout_ms,
        statement_timeout_ms: options.statement_timeout_ms,
        lock_timeout_ms: options.lock_timeout_ms,
        idle_in_transaction_session_timeout_ms: options.idle_in_transaction_session_timeout_ms,
        use_tls: options.use_tls,
        verify_server_certificate: options.verify_server_certificate,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        unix_socket_path: options.unix_socket_path.as_deref().map(interpolate),
        cloud_sql_instance: options.cloud_sql_instance.as_deref().map(interpolate),
        cockroach_deployment_mode: options
            .cockroach_deployment_mode
            .as_deref()
            .map(interpolate),
        cockroach_organization: options.cockroach_organization.as_deref().map(interpolate),
        cockroach_cluster_name: options.cockroach_cluster_name.as_deref().map(interpolate),
        cockroach_cluster_id: options.cockroach_cluster_id.as_deref().map(interpolate),
        cockroach_cloud_region: options.cockroach_cloud_region.as_deref().map(interpolate),
        cockroach_default_region: options.cockroach_default_region.as_deref().map(interpolate),
        cockroach_locality: options.cockroach_locality.as_deref().map(interpolate),
        cockroach_server_version: options.cockroach_server_version.as_deref().map(interpolate),
        cockroach_build_tag: options.cockroach_build_tag.as_deref().map(interpolate),
        cockroach_auth_disabled_reason: options
            .cockroach_auth_disabled_reason
            .as_deref()
            .map(interpolate),
        cockroach_tls_disabled_reason: options
            .cockroach_tls_disabled_reason
            .as_deref()
            .map(interpolate),
        cockroach_capabilities: options.cockroach_capabilities.clone(),
        timescale_deployment_mode: options
            .timescale_deployment_mode
            .as_deref()
            .map(interpolate),
        timescale_project: options.timescale_project.as_deref().map(interpolate),
        timescale_service_id: options.timescale_service_id.as_deref().map(interpolate),
        timescale_region: options.timescale_region.as_deref().map(interpolate),
        timescale_extension_schema: options
            .timescale_extension_schema
            .as_deref()
            .map(interpolate),
        timescale_extension_version: options
            .timescale_extension_version
            .as_deref()
            .map(interpolate),
        timescale_server_version: options.timescale_server_version.as_deref().map(interpolate),
        timescale_license: options.timescale_license.as_deref().map(interpolate),
        timescale_policy_execution_disabled_reason: options
            .timescale_policy_execution_disabled_reason
            .as_deref()
            .map(interpolate),
        timescale_compression_disabled_reason: options
            .timescale_compression_disabled_reason
            .as_deref()
            .map(interpolate),
        timescale_retention_disabled_reason: options
            .timescale_retention_disabled_reason
            .as_deref()
            .map(interpolate),
        timescale_continuous_aggregate_disabled_reason: options
            .timescale_continuous_aggregate_disabled_reason
            .as_deref()
            .map(interpolate),
        timescale_capabilities: options.timescale_capabilities.clone(),
    }
}

pub(super) fn interpolate_sqlserver_options(
    options: &SqlServerConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> SqlServerConnectionOptions {
    SqlServerConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        instance_name: options.instance_name.as_deref().map(interpolate),
        local_db_instance: options.local_db_instance.as_deref().map(interpolate),
        named_pipe_path: options.named_pipe_path.as_deref().map(interpolate),
        shared_memory_server: options.shared_memory_server.as_deref().map(interpolate),
        authentication_mode: options.authentication_mode.as_deref().map(interpolate),
        azure_tenant_id: options.azure_tenant_id.as_deref().map(interpolate),
        azure_client_id: options.azure_client_id.as_deref().map(interpolate),
        azure_managed_identity_client_id: options
            .azure_managed_identity_client_id
            .as_deref()
            .map(interpolate),
        service_principal_secret_ref: options.service_principal_secret_ref.clone(),
        aad_access_token_secret_ref: options.aad_access_token_secret_ref.clone(),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        certificate_store: options.certificate_store.as_deref().map(interpolate),
        certificate_thumbprint: options.certificate_thumbprint.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        encrypt_connection: options.encrypt_connection,
        trust_server_certificate: options.trust_server_certificate,
        trust_server_certificate_ca_path: options
            .trust_server_certificate_ca_path
            .as_deref()
            .map(interpolate),
        host_name_in_certificate: options.host_name_in_certificate.as_deref().map(interpolate),
        tls_version: options.tls_version.as_deref().map(interpolate),
        certificate_validation: options.certificate_validation.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        command_timeout_ms: options.command_timeout_ms,
        application_name: options.application_name.as_deref().map(interpolate),
        multiple_active_result_sets: options.multiple_active_result_sets,
        pooling: options.pooling,
        min_pool_size: options.min_pool_size,
        max_pool_size: options.max_pool_size,
        packet_size: options.packet_size,
        persist_security_info: options.persist_security_info,
        failover_partner: options.failover_partner.as_deref().map(interpolate),
        multi_subnet_failover: options.multi_subnet_failover,
        read_only_intent: options.read_only_intent,
        application_intent: options.application_intent.as_deref().map(interpolate),
        workstation_id: options.workstation_id.as_deref().map(interpolate),
        language: options.language.as_deref().map(interpolate),
        network_library: options.network_library.as_deref().map(interpolate),
        transparent_network_ip_resolution: options.transparent_network_ip_resolution,
        connect_retry_count: options.connect_retry_count,
        connect_retry_interval_seconds: options.connect_retry_interval_seconds,
    }
}

pub(super) fn interpolate_oracle_options(
    options: &OracleConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> OracleConnectionOptions {
    OracleConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        execution_runtime: options.execution_runtime.as_deref().map(interpolate),
        sql_plus_path: options.sql_plus_path.as_deref().map(interpolate),
        service_name: options.service_name.as_deref().map(interpolate),
        sid: options.sid.as_deref().map(interpolate),
        tns_alias: options.tns_alias.as_deref().map(interpolate),
        easy_connect_string: options.easy_connect_string.as_deref().map(interpolate),
        connection_role: options.connection_role.as_deref().map(interpolate),
        proxy_user: options.proxy_user.as_deref().map(interpolate),
        client_identifier: options.client_identifier.as_deref().map(interpolate),
        application_name: options.application_name.as_deref().map(interpolate),
        edition: options.edition.as_deref().map(interpolate),
        nls_language: options.nls_language.as_deref().map(interpolate),
        nls_territory: options.nls_territory.as_deref().map(interpolate),
        statement_cache_size: options.statement_cache_size,
        fetch_size: options.fetch_size,
        connection_timeout_ms: options.connection_timeout_ms,
        request_timeout_ms: options.request_timeout_ms,
        pool_min: options.pool_min,
        pool_max: options.pool_max,
        validate_connection: options.validate_connection,
        high_availability_events: options.high_availability_events,
        load_balancing: options.load_balancing,
        failover: options.failover,
        use_tls: options.use_tls,
        wallet_path: options.wallet_path.as_deref().map(interpolate),
        wallet_password_secret_ref: options.wallet_password_secret_ref.clone(),
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        trace_directory: options.trace_directory.as_deref().map(interpolate),
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/profile_options_tests.rs"]
mod tests;
