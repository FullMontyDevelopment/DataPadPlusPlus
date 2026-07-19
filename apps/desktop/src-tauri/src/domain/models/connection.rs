use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppHealth {
    pub runtime: String,
    pub adapter_host: String,
    pub secret_storage: String,
    pub platform: String,
    pub telemetry: String,
}

impl AppHealth {
    pub fn desktop(secret_storage: impl Into<String>) -> Self {
        Self {
            runtime: "tauri".into(),
            adapter_host: "connected".into(),
            secret_storage: secret_storage.into(),
            platform: std::env::consts::OS.into(),
            telemetry: "opt-in".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub id: String,
    pub provider: String,
    pub service: String,
    pub account: String,
    pub label: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionAuth {
    pub username: Option<String>,
    pub auth_mechanism: Option<String>,
    pub ssl_mode: Option<String>,
    pub cloud_provider: Option<String>,
    pub principal: Option<String>,
    pub secret_ref: Option<SecretRef>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectionOptions {
    pub deployment_mode: Option<String>,
    pub database_index: Option<u32>,
    pub use_tls: Option<bool>,
    pub client_name: Option<String>,
    pub resp_version: Option<String>,
    pub connection_timeout_ms: Option<u64>,
    pub command_timeout_ms: Option<u64>,
    pub retry_count: Option<u32>,
    pub retry_delay_ms: Option<u64>,
    pub keep_alive: Option<bool>,
    pub auto_reconnect: Option<bool>,
    pub read_only_mode: Option<bool>,
    pub pipeline_mode: Option<bool>,
    pub compression: Option<String>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub certificate_password_secret_ref: Option<SecretRef>,
    pub verify_server_certificate: Option<bool>,
    pub allow_invalid_certificates: Option<bool>,
    pub allow_invalid_hostnames: Option<bool>,
    pub sentinel_master_name: Option<String>,
    #[serde(default)]
    pub sentinel_hosts: Vec<String>,
    pub sentinel_username: Option<String>,
    pub sentinel_password_secret_ref: Option<SecretRef>,
    pub use_sentinel_tls: Option<bool>,
    #[serde(default)]
    pub cluster_nodes: Vec<String>,
    pub auto_discover_cluster_nodes: Option<bool>,
    pub read_from_replicas: Option<bool>,
    pub cluster_refresh_interval_ms: Option<u64>,
    pub unix_socket_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemcachedConnectionOptions {
    #[serde(default)]
    pub servers: Vec<String>,
    pub protocol: Option<String>,
    pub auth_mode: Option<String>,
    pub username: Option<String>,
    pub sasl_password_secret_ref: Option<SecretRef>,
    pub namespace_prefix: Option<String>,
    pub default_ttl_seconds: Option<u64>,
    pub connect_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub tcp_no_delay: Option<bool>,
    pub keep_alive: Option<bool>,
    pub enable_compression: Option<bool>,
    pub lru_crawler_enabled: Option<bool>,
    pub flush_delay_seconds: Option<u64>,
    pub read_only_mode: Option<bool>,
    pub max_value_bytes: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlServerConnectionOptions {
    pub connect_mode: Option<String>,
    pub instance_name: Option<String>,
    pub local_db_instance: Option<String>,
    pub named_pipe_path: Option<String>,
    pub shared_memory_server: Option<String>,
    pub authentication_mode: Option<String>,
    pub azure_tenant_id: Option<String>,
    pub azure_client_id: Option<String>,
    pub azure_managed_identity_client_id: Option<String>,
    pub service_principal_secret_ref: Option<SecretRef>,
    pub aad_access_token_secret_ref: Option<SecretRef>,
    pub client_certificate_path: Option<String>,
    pub certificate_store: Option<String>,
    pub certificate_thumbprint: Option<String>,
    pub certificate_password_secret_ref: Option<SecretRef>,
    pub encrypt_connection: Option<bool>,
    pub trust_server_certificate: Option<bool>,
    pub trust_server_certificate_ca_path: Option<String>,
    pub host_name_in_certificate: Option<String>,
    pub tls_version: Option<String>,
    pub certificate_validation: Option<String>,
    pub connection_timeout_ms: Option<u64>,
    pub command_timeout_ms: Option<u64>,
    pub application_name: Option<String>,
    pub multiple_active_result_sets: Option<bool>,
    pub pooling: Option<bool>,
    pub min_pool_size: Option<u32>,
    pub max_pool_size: Option<u32>,
    pub packet_size: Option<u32>,
    pub persist_security_info: Option<bool>,
    pub failover_partner: Option<String>,
    pub multi_subnet_failover: Option<bool>,
    pub read_only_intent: Option<bool>,
    pub application_intent: Option<String>,
    pub workstation_id: Option<String>,
    pub language: Option<String>,
    pub network_library: Option<String>,
    pub transparent_network_ip_resolution: Option<bool>,
    pub connect_retry_count: Option<u32>,
    pub connect_retry_interval_seconds: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqliteConnectionOptions {
    pub open_mode: Option<String>,
    pub use_uri_filename: Option<bool>,
    pub create_if_missing: Option<bool>,
    pub immutable: Option<bool>,
    pub shared_cache: Option<bool>,
    pub private_cache: Option<bool>,
    pub busy_timeout_ms: Option<u64>,
    pub default_timeout_ms: Option<u64>,
    pub journal_mode: Option<String>,
    pub synchronous_mode: Option<String>,
    pub cache_mode: Option<String>,
    pub cache_size: Option<i64>,
    pub page_size: Option<u32>,
    pub foreign_keys: Option<bool>,
    pub recursive_triggers: Option<bool>,
    pub case_sensitive_like: Option<bool>,
    pub temp_store_mode: Option<String>,
    pub locking_mode: Option<String>,
    pub auto_vacuum: Option<String>,
    pub mmap_size: Option<u64>,
    pub application_id: Option<i64>,
    pub user_version: Option<i64>,
    pub encoding: Option<String>,
    pub encryption_provider: Option<String>,
    pub encryption_key_secret_ref: Option<SecretRef>,
    pub cipher_compatibility: Option<String>,
    pub kdf_iterations: Option<u32>,
    pub cipher_page_size: Option<u32>,
    pub hmac_enabled: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CockroachConnectionCapabilities {
    pub inspect_jobs: Option<bool>,
    pub inspect_ranges: Option<bool>,
    pub inspect_regions: Option<bool>,
    pub inspect_cluster_status: Option<bool>,
    pub inspect_cluster_settings: Option<bool>,
    pub inspect_sessions: Option<bool>,
    pub inspect_contention: Option<bool>,
    pub inspect_roles_and_grants: Option<bool>,
    pub inspect_certificates: Option<bool>,
    pub inspect_zone_configurations: Option<bool>,
    pub explain_analyze: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimescaleConnectionCapabilities {
    pub inspect_hypertables: Option<bool>,
    pub inspect_chunks: Option<bool>,
    pub inspect_compression: Option<bool>,
    pub inspect_retention: Option<bool>,
    pub inspect_continuous_aggregates: Option<bool>,
    pub inspect_jobs: Option<bool>,
    pub inspect_toolkit: Option<bool>,
    pub explain_analyze: Option<bool>,
    pub live_policy_execution: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PostgresConnectionOptions {
    pub connect_mode: Option<String>,
    pub application_name: Option<String>,
    pub search_path: Option<String>,
    pub target_session_attrs: Option<String>,
    pub connect_timeout_ms: Option<u64>,
    pub statement_timeout_ms: Option<u64>,
    pub lock_timeout_ms: Option<u64>,
    pub idle_in_transaction_session_timeout_ms: Option<u64>,
    pub use_tls: Option<bool>,
    pub verify_server_certificate: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub certificate_password_secret_ref: Option<SecretRef>,
    pub unix_socket_path: Option<String>,
    pub cloud_sql_instance: Option<String>,
    pub cockroach_deployment_mode: Option<String>,
    pub cockroach_organization: Option<String>,
    pub cockroach_cluster_name: Option<String>,
    pub cockroach_cluster_id: Option<String>,
    pub cockroach_cloud_region: Option<String>,
    pub cockroach_default_region: Option<String>,
    pub cockroach_locality: Option<String>,
    pub cockroach_server_version: Option<String>,
    pub cockroach_build_tag: Option<String>,
    pub cockroach_auth_disabled_reason: Option<String>,
    pub cockroach_tls_disabled_reason: Option<String>,
    pub cockroach_capabilities: Option<CockroachConnectionCapabilities>,
    pub timescale_deployment_mode: Option<String>,
    pub timescale_project: Option<String>,
    pub timescale_service_id: Option<String>,
    pub timescale_region: Option<String>,
    pub timescale_extension_schema: Option<String>,
    pub timescale_extension_version: Option<String>,
    pub timescale_server_version: Option<String>,
    pub timescale_license: Option<String>,
    pub timescale_policy_execution_disabled_reason: Option<String>,
    pub timescale_compression_disabled_reason: Option<String>,
    pub timescale_retention_disabled_reason: Option<String>,
    pub timescale_continuous_aggregate_disabled_reason: Option<String>,
    pub timescale_capabilities: Option<TimescaleConnectionCapabilities>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MySqlConnectionOptions {
    pub connect_mode: Option<String>,
    pub auth_mode: Option<String>,
    pub ssl_mode: Option<String>,
    pub server_flavor: Option<String>,
    pub application_name: Option<String>,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub time_zone: Option<String>,
    pub sql_mode: Option<String>,
    pub default_storage_engine: Option<String>,
    pub allow_local_infile: Option<bool>,
    pub statement_cache_capacity: Option<u32>,
    pub connect_timeout_ms: Option<u64>,
    pub command_timeout_ms: Option<u64>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub certificate_password_secret_ref: Option<SecretRef>,
    pub unix_socket_path: Option<String>,
    pub cloud_sql_instance: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OracleConnectionOptions {
    pub connect_mode: Option<String>,
    pub execution_runtime: Option<String>,
    pub sql_plus_path: Option<String>,
    pub service_name: Option<String>,
    pub sid: Option<String>,
    pub tns_alias: Option<String>,
    pub easy_connect_string: Option<String>,
    pub connection_role: Option<String>,
    pub proxy_user: Option<String>,
    pub client_identifier: Option<String>,
    pub application_name: Option<String>,
    pub edition: Option<String>,
    pub nls_language: Option<String>,
    pub nls_territory: Option<String>,
    pub statement_cache_size: Option<u32>,
    pub fetch_size: Option<u32>,
    pub connection_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub pool_min: Option<u32>,
    pub pool_max: Option<u32>,
    pub validate_connection: Option<bool>,
    pub high_availability_events: Option<bool>,
    pub load_balancing: Option<bool>,
    pub failover: Option<bool>,
    pub use_tls: Option<bool>,
    pub wallet_path: Option<String>,
    pub wallet_password_secret_ref: Option<SecretRef>,
    pub tns_admin_path: Option<String>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub trace_directory: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DynamoDbConnectionOptions {
    pub connect_mode: Option<String>,
    pub region: Option<String>,
    pub endpoint_url: Option<String>,
    pub table_prefix: Option<String>,
    pub account_id: Option<String>,
    pub profile_name: Option<String>,
    pub credentials_provider: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key_ref: Option<SecretRef>,
    pub session_token_ref: Option<SecretRef>,
    pub role_arn: Option<String>,
    pub external_id: Option<String>,
    pub role_session_name: Option<String>,
    pub web_identity_token_file: Option<String>,
    pub use_dual_stack_endpoint: Option<bool>,
    pub use_fips_endpoint: Option<bool>,
    pub force_path_style: Option<bool>,
    pub signer_region: Option<String>,
    pub retry_mode: Option<String>,
    pub max_attempts: Option<u32>,
    pub connect_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub read_timeout_ms: Option<u64>,
    pub tcp_keep_alive: Option<bool>,
    pub api_version: Option<String>,
    pub scan_page_size: Option<u32>,
    pub consistent_read_default: Option<bool>,
    pub return_consumed_capacity: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CassandraConnectionOptions {
    pub connect_mode: Option<String>,
    #[serde(default)]
    pub contact_points: Vec<String>,
    pub default_keyspace: Option<String>,
    pub local_datacenter: Option<String>,
    pub protocol_version: Option<String>,
    pub auth_provider: Option<String>,
    pub secure_connect_bundle_path: Option<String>,
    pub use_tls: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub certificate_password_secret_ref: Option<SecretRef>,
    pub compression: Option<String>,
    pub consistency_level: Option<String>,
    pub serial_consistency_level: Option<String>,
    pub load_balancing_policy: Option<String>,
    pub retry_policy: Option<String>,
    pub page_size: Option<u32>,
    pub connect_timeout_ms: Option<u64>,
    pub request_timeout_ms: Option<u64>,
    pub read_timeout_ms: Option<u64>,
    pub heartbeat_interval_ms: Option<u64>,
    pub application_name: Option<String>,
    pub client_id: Option<String>,
    pub enable_tracing_default: Option<bool>,
    pub allow_beta_protocol: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CosmosDbConnectionOptions {
    pub connect_mode: Option<String>,
    pub api: Option<String>,
    pub account_endpoint: Option<String>,
    pub account_name: Option<String>,
    pub database_name: Option<String>,
    pub container_prefix: Option<String>,
    pub graph_name: Option<String>,
    pub gremlin_endpoint: Option<String>,
    pub traversal_source: Option<String>,
    pub auth_mode: Option<String>,
    pub account_key_secret_ref: Option<SecretRef>,
    pub resource_token_secret_ref: Option<SecretRef>,
    pub tenant_id: Option<String>,
    pub client_id: Option<String>,
    pub managed_identity_client_id: Option<String>,
    pub subscription_id: Option<String>,
    pub resource_group: Option<String>,
    #[serde(default)]
    pub preferred_regions: Vec<String>,
    pub write_region: Option<String>,
    pub consistency_level: Option<String>,
    pub enable_cross_partition_queries: Option<bool>,
    pub max_item_count: Option<u32>,
    pub return_request_charge: Option<bool>,
    pub gateway_mode: Option<String>,
    pub use_tls: Option<bool>,
    pub allow_self_signed_emulator_certificate: Option<bool>,
    pub retry_mode: Option<String>,
    pub max_retry_attempts: Option<u32>,
    pub request_timeout_ms: Option<u64>,
    pub connection_timeout_ms: Option<u64>,
    pub application_name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchConnectionOptions {
    pub connect_mode: Option<String>,
    pub endpoint_url: Option<String>,
    pub cloud_id: Option<String>,
    pub default_index: Option<String>,
    pub path_prefix: Option<String>,
    pub auth_mode: Option<String>,
    pub username: Option<String>,
    pub api_key_id: Option<String>,
    pub api_key_secret_ref: Option<SecretRef>,
    pub bearer_token_secret_ref: Option<SecretRef>,
    pub service_token_secret_ref: Option<SecretRef>,
    pub aws_region: Option<String>,
    pub aws_service: Option<String>,
    pub aws_profile_name: Option<String>,
    pub aws_role_arn: Option<String>,
    pub verify_certificates: Option<bool>,
    pub use_tls: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub compression: Option<bool>,
    pub request_timeout_ms: Option<u64>,
    pub connection_timeout_ms: Option<u64>,
    pub max_retries: Option<u32>,
    pub sniff_on_start: Option<bool>,
    pub opaque_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimeSeriesConnectionOptions {
    pub connect_mode: Option<String>,
    pub endpoint_url: Option<String>,
    pub path_prefix: Option<String>,
    pub organization: Option<String>,
    pub bucket: Option<String>,
    pub database_name: Option<String>,
    pub retention_policy: Option<String>,
    pub default_metric: Option<String>,
    pub default_range: Option<String>,
    pub default_step: Option<String>,
    pub default_query_language: Option<String>,
    pub auth_mode: Option<String>,
    pub username: Option<String>,
    pub token_secret_ref: Option<SecretRef>,
    pub custom_header_name: Option<String>,
    pub custom_header_secret_ref: Option<SecretRef>,
    pub tenant_header_name: Option<String>,
    pub tenant_id: Option<String>,
    pub verify_certificates: Option<bool>,
    pub use_tls: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub connection_timeout_ms: Option<u64>,
    pub query_timeout_ms: Option<u64>,
    pub max_series: Option<u32>,
    pub max_data_points: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphConnectionOptions {
    pub connect_mode: Option<String>,
    pub endpoint_url: Option<String>,
    pub path_prefix: Option<String>,
    pub database_name: Option<String>,
    pub traversal_source: Option<String>,
    pub graph_name: Option<String>,
    pub default_query_language: Option<String>,
    pub auth_mode: Option<String>,
    pub username: Option<String>,
    pub token_secret_ref: Option<SecretRef>,
    pub aws_region: Option<String>,
    pub aws_profile_name: Option<String>,
    pub aws_role_arn: Option<String>,
    pub use_iam_auth: Option<bool>,
    pub verify_certificates: Option<bool>,
    pub use_tls: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub connection_timeout_ms: Option<u64>,
    pub query_timeout_ms: Option<u64>,
    pub fetch_size: Option<u32>,
    pub explain_by_default: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseConnectionOptions {
    pub connect_mode: Option<String>,
    pub endpoint_url: Option<String>,
    pub path_prefix: Option<String>,
    pub account_name: Option<String>,
    pub project_id: Option<String>,
    pub dataset_id: Option<String>,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub warehouse_name: Option<String>,
    pub role_name: Option<String>,
    pub catalog_name: Option<String>,
    pub region: Option<String>,
    pub location: Option<String>,
    pub file_path: Option<String>,
    pub temp_directory: Option<String>,
    pub memory_limit: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    pub default_query_language: Option<String>,
    pub auth_mode: Option<String>,
    pub username: Option<String>,
    pub token_secret_ref: Option<SecretRef>,
    pub service_account_key_secret_ref: Option<SecretRef>,
    pub client_id: Option<String>,
    pub client_secret_ref: Option<SecretRef>,
    pub profile_name: Option<String>,
    pub use_tls: Option<bool>,
    pub verify_certificates: Option<bool>,
    pub ca_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub connection_timeout_ms: Option<u64>,
    pub query_timeout_ms: Option<u64>,
    pub max_rows: Option<u32>,
    pub threads: Option<u32>,
    pub dry_run_by_default: Option<bool>,
    pub explain_by_default: Option<bool>,
    pub cost_limit_usd: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MongoDbConnectionOptions {
    pub connection_scheme: Option<String>,
    pub auth_source: Option<String>,
    pub app_name: Option<String>,
    pub tls: Option<bool>,
    pub replica_set: Option<String>,
    pub query_timeout_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub family: String,
    pub host: String,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub connection_string: Option<String>,
    pub connection_mode: Option<String>,
    #[serde(default)]
    pub environment_ids: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub favorite: bool,
    pub read_only: bool,
    pub icon: String,
    pub color: Option<String>,
    pub group: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub auth: ConnectionAuth,
    #[serde(default)]
    pub redis_options: Option<RedisConnectionOptions>,
    #[serde(default)]
    pub memcached_options: Option<MemcachedConnectionOptions>,
    #[serde(default)]
    pub sqlite_options: Option<SqliteConnectionOptions>,
    #[serde(default)]
    pub postgres_options: Option<PostgresConnectionOptions>,
    #[serde(default)]
    pub mysql_options: Option<MySqlConnectionOptions>,
    #[serde(default)]
    pub sqlserver_options: Option<SqlServerConnectionOptions>,
    #[serde(default)]
    pub oracle_options: Option<OracleConnectionOptions>,
    #[serde(default)]
    pub dynamo_db_options: Option<DynamoDbConnectionOptions>,
    #[serde(default)]
    pub cassandra_options: Option<CassandraConnectionOptions>,
    #[serde(default)]
    pub cosmos_db_options: Option<CosmosDbConnectionOptions>,
    #[serde(default)]
    pub search_options: Option<SearchConnectionOptions>,
    #[serde(default)]
    pub time_series_options: Option<TimeSeriesConnectionOptions>,
    #[serde(default)]
    pub graph_options: Option<GraphConnectionOptions>,
    #[serde(default)]
    pub mongodb_options: Option<MongoDbConnectionOptions>,
    #[serde(default)]
    pub warehouse_options: Option<WarehouseConnectionOptions>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct ResolvedConnectionProfile {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub family: String,
    pub host: String,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub connection_string: Option<String>,
    pub redis_options: Option<RedisConnectionOptions>,
    pub memcached_options: Option<MemcachedConnectionOptions>,
    pub sqlite_options: Option<SqliteConnectionOptions>,
    pub postgres_options: Option<PostgresConnectionOptions>,
    pub mysql_options: Option<MySqlConnectionOptions>,
    pub sqlserver_options: Option<SqlServerConnectionOptions>,
    pub oracle_options: Option<OracleConnectionOptions>,
    pub dynamo_db_options: Option<DynamoDbConnectionOptions>,
    pub cassandra_options: Option<CassandraConnectionOptions>,
    pub cosmos_db_options: Option<CosmosDbConnectionOptions>,
    pub search_options: Option<SearchConnectionOptions>,
    pub time_series_options: Option<TimeSeriesConnectionOptions>,
    pub graph_options: Option<GraphConnectionOptions>,
    pub mongodb_options: Option<MongoDbConnectionOptions>,
    pub warehouse_options: Option<WarehouseConnectionOptions>,
    pub read_only: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentProfile {
    pub id: String,
    pub label: String,
    pub color: String,
    pub risk: String,
    pub inherits_from: Option<String>,
    #[serde(default)]
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub sensitive_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variable_definitions: Vec<EnvironmentVariableDefinition>,
    pub requires_confirmation: bool,
    pub safe_mode: bool,
    pub exportable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentVariableDefinition {
    pub key: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<SecretRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnvironment {
    pub environment_id: String,
    pub label: String,
    pub risk: String,
    pub variables: HashMap<String, String>,
    pub unresolved_keys: Vec<String>,
    pub inherited_chain: Vec<String>,
    pub sensitive_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variable_definitions: Vec<EnvironmentVariableDefinition>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestRequest {
    pub profile: ConnectionProfile,
    pub environment_id: String,
    #[serde(default)]
    pub secret: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub engine: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub resolved_host: String,
    pub resolved_database: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabasePickRequest {
    pub engine: String,
    pub purpose: String,
    pub current_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabasePickResult {
    pub canceled: bool,
    pub path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabaseCreateRequest {
    pub engine: String,
    pub path: String,
    pub mode: String,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabaseCreateResult {
    pub engine: String,
    pub path: String,
    pub message: String,
    pub warnings: Vec<String>,
}
