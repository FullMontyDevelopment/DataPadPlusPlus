use std::collections::HashMap;

use serde::{de, Deserialize, Serialize};
use serde_json::Value;

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

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MongoDbConnectionOptions {
    pub connection_scheme: Option<String>,
    pub auth_source: Option<String>,
    pub app_name: Option<String>,
    pub tls: Option<bool>,
    pub replica_set: Option<String>,
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
pub struct QueryExecutionNotice {
    pub code: String,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResultEnvelope {
    pub id: String,
    pub engine: String,
    pub summary: String,
    pub default_renderer: String,
    pub renderer_modes: Vec<String>,
    pub payloads: Vec<Value>,
    pub notices: Vec<QueryExecutionNotice>,
    pub executed_at: String,
    pub duration_ms: u64,
    pub truncated: Option<bool>,
    pub row_limit: Option<u32>,
    pub continuation_token: Option<String>,
    pub page_info: Option<ResultPageInfo>,
    pub explain_payload: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultPageInfo {
    pub page_size: u32,
    pub page_index: u32,
    pub buffered_rows: u32,
    pub has_more: bool,
    pub next_cursor: Option<String>,
    pub total_rows_known: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub query_text: String,
    pub executed_at: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuerySaveTarget {
    pub kind: String,
    pub library_item_id: Option<String>,
    pub path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFacingError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTabActiveExecution {
    pub execution_id: String,
    pub phase: String,
    pub started_at: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryTabState {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub tab_kind: Option<String>,
    pub connection_id: String,
    pub environment_id: String,
    pub family: String,
    pub language: String,
    pub pinned: Option<bool>,
    #[serde(default)]
    pub save_target: Option<QuerySaveTarget>,
    pub saved_query_id: Option<String>,
    pub editor_label: String,
    pub query_text: String,
    #[serde(default)]
    pub query_view_mode: Option<String>,
    #[serde(default)]
    pub script_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_efficiency_mode: Option<bool>,
    #[serde(default)]
    pub scoped_target: Option<ScopedQueryTarget>,
    #[serde(default)]
    pub builder_state: Option<Value>,
    #[serde(default)]
    pub metrics_state: Option<Value>,
    #[serde(default)]
    pub object_view_state: Option<Value>,
    #[serde(default)]
    pub test_suite: Option<Value>,
    #[serde(default)]
    pub test_run: Option<Value>,
    pub status: String,
    #[serde(default)]
    pub active_execution: Option<QueryTabActiveExecution>,
    pub dirty: bool,
    pub last_run_at: Option<String>,
    pub result: Option<ExecutionResultEnvelope>,
    #[serde(default)]
    pub history: Vec<QueryHistoryEntry>,
    pub error: Option<UserFacingError>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateObjectViewTabRequest {
    pub connection_id: String,
    #[serde(default)]
    pub environment_id: Option<String>,
    pub node_id: String,
    pub label: String,
    pub kind: String,
    #[serde(default)]
    pub path: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedQueryTabSnapshot {
    #[serde(flatten)]
    pub tab: QueryTabState,
    pub closed_at: String,
    pub close_reason: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedWorkItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub updated_at: String,
    pub folder: Option<String>,
    pub favorite: Option<bool>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub language: Option<String>,
    pub query_text: Option<String>,
    pub snapshot_result_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryNode {
    pub id: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub favorite: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub language: Option<String>,
    pub query_text: Option<String>,
    #[serde(default)]
    pub query_view_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_efficiency_mode: Option<bool>,
    #[serde(default)]
    pub builder_state: Option<Value>,
    pub script_text: Option<String>,
    #[serde(default)]
    pub test_suite: Option<Value>,
    pub snapshot_result_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCreateFolderRequest {
    pub parent_id: Option<String>,
    pub name: String,
    pub environment_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRenameNodeRequest {
    pub node_id: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDeleteNodeRequest {
    pub node_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMoveNodeRequest {
    pub node_id: String,
    pub parent_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySetEnvironmentRequest {
    pub node_id: String,
    pub environment_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryTabToLibraryRequest {
    pub tab_id: String,
    pub item_id: Option<String>,
    pub folder_id: Option<String>,
    pub name: String,
    pub kind: Option<String>,
    pub environment_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryTabToLocalFileRequest {
    pub tab_id: String,
    pub path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultFileRequest {
    pub suggested_file_name: String,
    pub extension: String,
    pub mime_type: String,
    pub contents: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultFileResponse {
    pub saved: bool,
    pub path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBundleFileExportRequest {
    pub passphrase: String,
    #[serde(default)]
    pub include_secrets: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBundleFileExportResponse {
    pub saved: bool,
    pub path: Option<String>,
    #[serde(default)]
    pub includes_secrets: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_count: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBundleFileImportRequest {
    pub passphrase: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupSettingsRequest {
    pub enabled: bool,
    pub passphrase: Option<String>,
    pub interval_minutes: Option<u32>,
    pub max_backups: Option<u32>,
    #[serde(default)]
    pub include_secrets: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupRunRequest {
    #[serde(default)]
    pub automatic: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupSummary {
    pub id: String,
    pub file_name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub includes_secrets: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupRunResponse {
    pub created: bool,
    pub backup: Option<WorkspaceBackupSummary>,
    pub backups: Vec<WorkspaceBackupSummary>,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupRestoreRequest {
    pub backup_id: String,
    pub passphrase: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupDeleteRequest {
    pub backup_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateTestSuiteTabRequest {
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub template_id: Option<String>,
    pub suite: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTestSuiteTabRequest {
    pub tab_id: String,
    pub suite: Option<Value>,
    pub raw_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTestSuiteRequest {
    pub tab_id: String,
    pub case_id: Option<String>,
    pub confirmed_guardrail_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTestSuiteResponse {
    pub tab: QueryTabState,
    pub run: Value,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CancelTestRunRequest {
    pub run_id: String,
    pub tab_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenTestSuiteTemplateRequest {
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub template_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerNode {
    pub id: String,
    pub family: String,
    pub label: String,
    pub kind: String,
    pub detail: String,
    pub scope: Option<String>,
    pub path: Option<Vec<String>>,
    pub query_template: Option<String>,
    pub expandable: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureMetric {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureField {
    pub name: String,
    pub data_type: String,
    pub detail: Option<String>,
    pub nullable: Option<bool>,
    pub primary: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ordinal: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureGroup {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
    pub color: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureNode {
    pub id: String,
    pub family: String,
    pub label: String,
    pub kind: String,
    pub group_id: Option<String>,
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualified_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_count_estimate: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_system: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_view: Option<bool>,
    pub metrics: Vec<StructureMetric>,
    pub fields: Vec<StructureField>,
    pub sample: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub label: String,
    pub kind: String,
    pub inferred: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cardinality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delete_rule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_rule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterManifest {
    pub id: String,
    pub engine: String,
    pub family: String,
    pub label: String,
    pub maturity: String,
    pub capabilities: Vec<String>,
    pub default_language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_database: Option<LocalDatabaseManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<DatastoreTreeManifest>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabaseManifest {
    pub default_extension: String,
    pub extensions: Vec<String>,
    pub can_create_empty: bool,
    pub can_create_starter: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreTreeManifest {
    pub version: u8,
    pub empty_state: String,
    pub roots: Vec<DatastoreTreeNodeManifest>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreTreeNodeManifest {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<DatastoreTreeNodeManifest>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub requires_database: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden_when_database_selected: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub optional_when_live_metadata: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_database: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionCapabilities {
    pub can_cancel: bool,
    pub can_explain: bool,
    pub supports_live_metadata: bool,
    pub editor_language: String,
    pub default_row_limit: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreOperationManifest {
    pub id: String,
    pub engine: String,
    pub family: String,
    pub label: String,
    pub scope: String,
    pub risk: String,
    pub required_capabilities: Vec<String>,
    pub supported_renderers: Vec<String>,
    pub description: String,
    pub requires_confirmation: bool,
    pub execution_support: String,
    pub disabled_reason: Option<String>,
    pub preview_only: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPlan {
    pub operation_id: String,
    pub engine: String,
    pub summary: String,
    pub generated_request: String,
    pub request_language: String,
    pub destructive: bool,
    pub estimated_cost: Option<String>,
    pub estimated_scan_impact: Option<String>,
    pub required_permissions: Vec<String>,
    pub confirmation_text: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionUnavailableAction {
    pub operation_id: String,
    pub reason: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInspection {
    pub engine: String,
    pub principal: Option<String>,
    pub effective_roles: Vec<String>,
    pub effective_privileges: Vec<String>,
    pub iam_signals: Vec<String>,
    pub unavailable_actions: Vec<PermissionUnavailableAction>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDiagnostics {
    pub engine: String,
    pub plans: Vec<Value>,
    pub profiles: Vec<Value>,
    pub metrics: Vec<Value>,
    pub query_history: Vec<Value>,
    pub cost_estimates: Vec<Value>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreExperienceObjectKind {
    pub kind: String,
    pub label: String,
    pub description: String,
    pub child_kinds: Vec<String>,
    pub queryable: bool,
    pub supports_context_menu: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreExperienceAction {
    pub id: String,
    pub label: String,
    pub scope: String,
    pub risk: String,
    pub operation_id: Option<String>,
    pub requires_selection: bool,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreExperienceBuilder {
    pub kind: String,
    pub label: String,
    pub scope: String,
    pub default_mode: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreEditableScope {
    pub scope: String,
    pub label: String,
    pub edit_kinds: Vec<String>,
    pub requires_primary_key: bool,
    pub live_execution: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreDiagnosticsTab {
    pub id: String,
    pub label: String,
    pub description: String,
    pub default_renderer: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreExperienceManifest {
    pub engine: String,
    pub family: String,
    pub label: String,
    pub maturity: String,
    pub object_kinds: Vec<DatastoreExperienceObjectKind>,
    pub context_actions: Vec<DatastoreExperienceAction>,
    pub query_builders: Vec<DatastoreExperienceBuilder>,
    pub editable_scopes: Vec<DatastoreEditableScope>,
    pub diagnostics_tabs: Vec<DatastoreDiagnosticsTab>,
    pub result_renderers: Vec<String>,
    pub safety_rules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<DatastoreTreeManifest>,
    #[serde(default)]
    pub test_templates: Vec<Value>,
    #[serde(default)]
    pub test_assertions: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreExperienceResponse {
    pub experiences: Vec<DatastoreExperienceManifest>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerSettingsRequest {
    pub enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub server_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub base_path: Option<String>,
    pub resources: Option<Vec<DatastoreApiServerResourceConfig>>,
    pub custom_endpoints: Option<Vec<DatastoreApiServerCustomEndpointConfig>>,
    pub active_server_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerCreateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub base_path: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    #[serde(default)]
    pub resources: Vec<DatastoreApiServerResourceConfig>,
    #[serde(default)]
    pub custom_endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerUpdateRequest {
    pub server_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub base_path: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub resources: Option<Vec<DatastoreApiServerResourceConfig>>,
    pub custom_endpoints: Option<Vec<DatastoreApiServerCustomEndpointConfig>>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerResourceDiscoveryRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub scope: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerResourceDiscoveryResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub scope: Option<String>,
    pub resources: Vec<DatastoreApiServerResourceConfig>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerAddResourcesRequest {
    pub server_id: String,
    #[serde(default)]
    pub resources: Vec<DatastoreApiServerResourceConfig>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerRemoveResourceRequest {
    pub server_id: String,
    pub resource_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerQuerySource {
    pub id: String,
    pub name: String,
    pub summary: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub language: Option<String>,
    pub query_view_mode: Option<String>,
    pub query_text: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerQuerySourceDiscoveryRequest {
    pub server_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerQuerySourceDiscoveryResponse {
    pub server_id: String,
    pub sources: Vec<DatastoreApiServerQuerySource>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerAddCustomEndpointRequest {
    pub server_id: String,
    pub endpoint: DatastoreApiServerCustomEndpointConfig,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerUpdateCustomEndpointRequest {
    pub server_id: String,
    pub endpoint_id: String,
    pub endpoint: DatastoreApiServerCustomEndpointConfig,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerRemoveCustomEndpointRequest {
    pub server_id: String,
    pub endpoint_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerProjectExportRequest {
    pub server_id: String,
    pub framework: String,
    pub project_name: String,
    pub namespace: Option<String>,
    pub package_name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerProjectExportResponse {
    pub saved: bool,
    pub path: Option<String>,
    pub framework: String,
    pub project_name: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerStartRequest {
    pub server_id: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub port: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerStopRequest {
    pub server_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerDeleteRequest {
    pub server_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerInstanceStatus {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub base_path: String,
    pub base_url: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub started_at: Option<String>,
    pub message: String,
    pub warnings: Vec<String>,
    pub resources: Vec<DatastoreApiServerResourceConfig>,
    pub custom_endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub base_url: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub server_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub base_path: Option<String>,
    pub active_server_id: Option<String>,
    pub started_at: Option<String>,
    pub message: String,
    pub warnings: Vec<String>,
    pub servers: Vec<DatastoreApiServerInstanceStatus>,
    pub resources: Vec<DatastoreApiServerResourceConfig>,
    pub custom_endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerRouteMetric {
    pub route_id: String,
    pub method: String,
    pub route: String,
    pub requests: u64,
    pub successes: u64,
    pub errors: u64,
    pub status_counts: HashMap<String, u64>,
    pub average_duration_ms: f64,
    pub p50_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub last_duration_ms: Option<f64>,
    pub last_status: Option<u16>,
    pub last_seen_at: Option<String>,
    pub request_bytes: u64,
    pub response_bytes: u64,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerTelemetryRetention {
    pub route_samples: usize,
    pub logs: usize,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerMetrics {
    pub running: bool,
    pub generated_at: String,
    pub server_id: Option<String>,
    pub started_at: Option<String>,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub total_requests: u64,
    pub total_errors: u64,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub routes: Vec<DatastoreApiServerRouteMetric>,
    pub retention: DatastoreApiServerTelemetryRetention,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerLogEntry {
    pub id: u64,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub route: String,
    pub status: u16,
    pub duration_ms: f64,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerLogsRequest {
    pub server_id: Option<String>,
    pub limit: Option<usize>,
    pub method: Option<String>,
    pub route: Option<String>,
    pub status: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreApiServerLogs {
    pub running: bool,
    pub generated_at: String,
    pub total_retained: usize,
    pub entries: Vec<DatastoreApiServerLogEntry>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerSettingsRequest {
    pub enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub server_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub allowed_origins: Option<Vec<String>>,
    #[serde(default)]
    pub connection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub environment_ids: Option<Vec<String>>,
    pub active_server_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerCreateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub environment_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerUpdateRequest {
    pub server_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub allowed_origins: Option<Vec<String>>,
    pub connection_ids: Option<Vec<String>>,
    pub environment_ids: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerStartRequest {
    pub server_id: Option<String>,
    pub port: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerStopRequest {
    pub server_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerDeleteRequest {
    pub server_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerTokenCreateRequest {
    pub server_id: String,
    pub label: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerTokenCreateResponse {
    pub server_id: String,
    pub token_id: String,
    pub token: String,
    pub config: DatastoreMcpServerTokenConfig,
    pub status: DatastoreMcpServerStatus,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerTokenDeleteRequest {
    pub server_id: String,
    pub token_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpClientSetupRequest {
    pub client_id: String,
    pub scope: String,
    pub endpoint: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpClientSetupPreview {
    pub client_id: String,
    pub scope: String,
    pub endpoint: String,
    pub target_path: String,
    pub target_exists: bool,
    pub can_apply: bool,
    pub preview_id: String,
    pub change_summary: String,
    pub proposed_snippet: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpClientSetupApplyRequest {
    pub client_id: String,
    pub scope: String,
    pub endpoint: String,
    pub preview_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpClientSetupApplyResponse {
    pub client_id: String,
    pub scope: String,
    pub endpoint: String,
    pub target_path: String,
    pub target_exists: bool,
    pub can_apply: bool,
    pub preview_id: String,
    pub change_summary: String,
    pub proposed_snippet: String,
    pub warnings: Vec<String>,
    pub applied: bool,
    pub backup_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerInstanceStatus {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub endpoint: Option<String>,
    pub started_at: Option<String>,
    pub message: String,
    pub warnings: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub connection_ids: Vec<String>,
    pub environment_ids: Vec<String>,
    pub token_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub endpoint: Option<String>,
    pub server_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub active_server_id: Option<String>,
    pub started_at: Option<String>,
    pub message: String,
    pub warnings: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub connection_ids: Vec<String>,
    pub environment_ids: Vec<String>,
    pub token_count: usize,
    pub servers: Vec<DatastoreMcpServerInstanceStatus>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerRouteMetric {
    pub route_id: String,
    pub method: String,
    pub route: String,
    pub requests: u64,
    pub successes: u64,
    pub errors: u64,
    pub status_counts: HashMap<String, u64>,
    pub average_duration_ms: f64,
    pub p50_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub last_duration_ms: Option<f64>,
    pub last_status: Option<u16>,
    pub last_seen_at: Option<String>,
    pub request_bytes: u64,
    pub response_bytes: u64,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerTelemetryRetention {
    pub route_samples: usize,
    pub logs: usize,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerMetrics {
    pub running: bool,
    pub generated_at: String,
    pub server_id: Option<String>,
    pub started_at: Option<String>,
    pub total_requests: u64,
    pub total_errors: u64,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub routes: Vec<DatastoreMcpServerRouteMetric>,
    pub retention: DatastoreMcpServerTelemetryRetention,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerLogEntry {
    pub id: u64,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub route: String,
    pub status: u16,
    pub duration_ms: f64,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub token_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerLogsRequest {
    pub server_id: Option<String>,
    pub limit: Option<usize>,
    pub method: Option<String>,
    pub route: Option<String>,
    pub status: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreMcpServerLogs {
    pub running: bool,
    pub generated_at: String,
    pub total_retained: usize,
    pub entries: Vec<DatastoreMcpServerLogEntry>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrudMutationBody {
    #[serde(default)]
    pub identity: Option<Value>,
    #[serde(default)]
    pub values: Option<HashMap<String, Value>>,
    #[serde(default)]
    pub changes: Option<Vec<DataEditChange>>,
    #[serde(default)]
    pub confirmation_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DataEditTarget {
    pub object_kind: String,
    #[serde(default)]
    pub path: Vec<String>,
    #[serde(default)]
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub collection: Option<String>,
    pub key: Option<String>,
    pub document_id: Option<Value>,
    pub item_key: Option<HashMap<String, Value>>,
    pub primary_key: Option<HashMap<String, Value>>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DataEditChange {
    pub field: Option<String>,
    pub path: Option<Vec<String>>,
    pub value: Option<Value>,
    pub value_type: Option<String>,
    pub new_name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataEditPlanRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub edit_kind: String,
    pub target: DataEditTarget,
    pub changes: Vec<DataEditChange>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataEditPlanResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub edit_kind: String,
    pub execution_support: String,
    pub plan: OperationPlan,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataEditExecutionRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub edit_kind: String,
    pub target: DataEditTarget,
    pub changes: Vec<DataEditChange>,
    pub confirmation_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataEditExecutionResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub edit_kind: String,
    pub execution_support: String,
    pub executed: bool,
    pub plan: OperationPlan,
    pub messages: Vec<String>,
    pub warnings: Vec<String>,
    pub result: Option<ExecutionResultEnvelope>,
    pub metadata: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardrailDecision {
    pub id: Option<String>,
    pub status: String,
    pub reasons: Vec<String>,
    pub safe_mode_applied: bool,
    pub required_confirmation_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockState {
    pub is_locked: bool,
    pub locked_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct WorkspaceBackupPreferences {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub max_backups: u32,
    pub include_secrets: bool,
    pub passphrase_secret_ref: Option<SecretRef>,
    pub last_backup_at: Option<String>,
    pub last_workspace_updated_at: Option<String>,
}

impl Default for WorkspaceBackupPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 30,
            max_backups: 20,
            include_secrets: false,
            passphrase_secret_ref: None,
            last_backup_at: None,
            last_workspace_updated_at: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreApiServerResourceConfig {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub node_id: String,
    #[serde(default)]
    pub path: Vec<String>,
    pub scope: Option<String>,
    pub endpoint_slug: String,
    pub enabled: bool,
    pub detail: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

impl Default for DatastoreApiServerResourceConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: "table".into(),
            label: String::new(),
            node_id: String::new(),
            path: Vec::new(),
            scope: None,
            endpoint_slug: String::new(),
            enabled: true,
            detail: None,
            metadata: HashMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreApiServerCustomEndpointParameterConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub parameter_type: String,
    pub required: bool,
    pub default_value: Option<Value>,
    pub description: Option<String>,
    pub serialization: String,
}

impl Default for DatastoreApiServerCustomEndpointParameterConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            parameter_type: "string".into(),
            required: false,
            default_value: None,
            description: None,
            serialization: "auto".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreApiServerCustomEndpointConfig {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub endpoint_slug: String,
    pub enabled: bool,
    pub method: String,
    pub source_library_node_id: String,
    pub source_name: String,
    pub query_text: String,
    pub language: String,
    pub query_view_mode: Option<String>,
    pub row_limit: Option<u32>,
    pub parameters: Vec<DatastoreApiServerCustomEndpointParameterConfig>,
}

impl Default for DatastoreApiServerCustomEndpointConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            description: None,
            endpoint_slug: String::new(),
            enabled: true,
            method: "GET".into(),
            source_library_node_id: String::new(),
            source_name: String::new(),
            query_text: String::new(),
            language: "sql".into(),
            query_view_mode: Some("raw".into()),
            row_limit: Some(100),
            parameters: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreApiServerConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
    pub protocol: String,
    pub base_path: String,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub resources: Vec<DatastoreApiServerResourceConfig>,
    pub custom_endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
}

impl Default for DatastoreApiServerConfig {
    fn default() -> Self {
        Self {
            id: "api-server-default".into(),
            name: "Local API Server".into(),
            description: None,
            host: "127.0.0.1".into(),
            port: 17640,
            auto_start: false,
            protocol: "rest".into(),
            base_path: String::new(),
            connection_id: None,
            environment_id: None,
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreApiServerPreferences {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
    pub connection_id: Option<String>,
    pub environment_id: Option<String>,
    pub active_server_id: Option<String>,
    pub servers: Vec<DatastoreApiServerConfig>,
}

impl Default for DatastoreApiServerPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".into(),
            port: 17640,
            auto_start: false,
            connection_id: None,
            environment_id: None,
            active_server_id: None,
            servers: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreMcpServerTokenConfig {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub scopes: Vec<String>,
    pub verifier_secret_ref: SecretRef,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

impl Default for DatastoreMcpServerTokenConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            enabled: true,
            scopes: Vec::new(),
            verifier_secret_ref: SecretRef {
                id: String::new(),
                provider: "os-keyring".into(),
                service: String::new(),
                account: String::new(),
                label: String::new(),
            },
            created_at: String::new(),
            last_used_at: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreMcpServerConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
    pub allowed_origins: Vec<String>,
    pub connection_ids: Vec<String>,
    pub environment_ids: Vec<String>,
    pub tokens: Vec<DatastoreMcpServerTokenConfig>,
}

impl Default for DatastoreMcpServerConfig {
    fn default() -> Self {
        Self {
            id: "mcp-server-default".into(),
            name: "Local MCP Server".into(),
            description: None,
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: false,
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            tokens: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreMcpServerPreferences {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
    pub active_server_id: Option<String>,
    pub servers: Vec<DatastoreMcpServerConfig>,
}

impl Default for DatastoreMcpServerPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: false,
            active_server_id: None,
            servers: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct WorkspaceSearchPreferences {
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchSettingsRequest {
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme: String,
    pub telemetry: String,
    pub lock_after_minutes: u32,
    pub safe_mode_enabled: bool,
    #[serde(default)]
    pub keyboard_shortcuts: HashMap<String, String>,
    #[serde(default)]
    pub workspace_backups: WorkspaceBackupPreferences,
    #[serde(default)]
    pub datastore_api_server: DatastoreApiServerPreferences,
    #[serde(default)]
    pub datastore_mcp_server: DatastoreMcpServerPreferences,
    #[serde(default)]
    pub workspace_search: WorkspaceSearchPreferences,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct UiState {
    pub active_connection_id: String,
    pub active_environment_id: String,
    pub active_tab_id: String,
    pub explorer_filter: String,
    pub explorer_view: String,
    #[serde(default = "default_connection_group_mode")]
    pub connection_group_mode: String,
    #[serde(default)]
    pub sidebar_section_states: HashMap<String, bool>,
    pub active_activity: String,
    pub sidebar_collapsed: bool,
    pub active_sidebar_pane: String,
    pub sidebar_width: u32,
    pub bottom_panel_visible: bool,
    pub active_bottom_panel_tab: String,
    pub bottom_panel_height: u32,
    pub results_dock: String,
    pub results_side_width: u32,
    pub right_drawer: String,
    pub right_drawer_width: u32,
}

fn default_connection_group_mode() -> String {
    "none".into()
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            active_connection_id: String::new(),
            active_environment_id: String::new(),
            active_tab_id: String::new(),
            explorer_filter: String::new(),
            explorer_view: "structure".into(),
            connection_group_mode: default_connection_group_mode(),
            sidebar_section_states: HashMap::new(),
            active_activity: "connections".into(),
            sidebar_collapsed: false,
            active_sidebar_pane: "connections".into(),
            sidebar_width: 280,
            bottom_panel_visible: false,
            active_bottom_panel_tab: "results".into(),
            bottom_panel_height: 260,
            results_dock: "bottom".into(),
            results_side_width: 420,
            right_drawer: "none".into(),
            right_drawer_width: 360,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCounts {
    pub connections: usize,
    pub environments: usize,
    pub tabs: usize,
    pub saved_work: usize,
    pub library: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub created_at: String,
    pub runtime: String,
    pub platform: String,
    pub app_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breadcrumb_path: Option<String>,
    pub counts: DiagnosticsCounts,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub schema_version: u32,
    pub connections: Vec<ConnectionProfile>,
    pub environments: Vec<EnvironmentProfile>,
    pub tabs: Vec<QueryTabState>,
    #[serde(default)]
    pub closed_tabs: Vec<ClosedQueryTabSnapshot>,
    #[serde(default)]
    pub library_nodes: Vec<LibraryNode>,
    #[serde(default)]
    pub saved_work: Vec<SavedWorkItem>,
    pub explorer_nodes: Vec<ExplorerNode>,
    pub adapter_manifests: Vec<AdapterManifest>,
    pub preferences: AppPreferences,
    pub guardrails: Vec<GuardrailDecision>,
    pub lock_state: LockState,
    pub ui: UiState,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub health: AppHealth,
    pub snapshot: WorkspaceSnapshot,
    pub resolved_environment: ResolvedEnvironment,
    pub diagnostics: DiagnosticsReport,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub format: String,
    pub version: u32,
    pub encrypted_payload: String,
    #[serde(default)]
    pub includes_secrets: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_count: Option<usize>,
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
pub struct ExplorerRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub limit: Option<u32>,
    pub scope: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub scope: Option<String>,
    pub summary: String,
    pub capabilities: ExecutionCapabilities,
    pub nodes: Vec<ExplorerNode>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerInspectRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub node_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerInspectResponse {
    pub node_id: String,
    pub summary: String,
    pub query_template: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus_node_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_system_objects: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_inferred_relationships: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_nodes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_edges: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub engine: String,
    pub summary: String,
    pub groups: Vec<StructureGroup>,
    pub nodes: Vec<StructureNode>,
    pub edges: Vec<StructureEdge>,
    pub metrics: Vec<StructureMetric>,
    pub truncated: Option<bool>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub execution_id: Option<String>,
    pub tab_id: String,
    pub connection_id: String,
    pub environment_id: String,
    pub language: String,
    pub query_text: String,
    pub execution_input_mode: Option<String>,
    pub script_text: Option<String>,
    pub selected_text: Option<String>,
    pub mode: Option<String>,
    pub row_limit: Option<u32>,
    pub document_efficiency_mode: Option<bool>,
    pub confirmed_guardrail_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultPageRequest {
    pub tab_id: String,
    pub connection_id: String,
    pub environment_id: String,
    pub language: String,
    pub query_text: String,
    pub selected_text: Option<String>,
    pub renderer: String,
    pub page_size: Option<u32>,
    pub page_index: Option<u32>,
    pub cursor: Option<String>,
    pub document_efficiency_mode: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultPageResponse {
    pub tab_id: String,
    pub result_id: Option<String>,
    pub payload: Value,
    pub page_info: ResultPageInfo,
    pub notices: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNodeChildrenRequest {
    pub tab_id: String,
    pub connection_id: String,
    pub environment_id: String,
    pub database: Option<String>,
    pub collection: String,
    pub document_id: Value,
    pub path: Vec<Value>,
    pub query_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNodeChildrenResponse {
    pub tab_id: String,
    pub document_id: Value,
    pub path: Vec<Value>,
    pub value: Value,
    pub notices: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeySummary {
    pub key: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub ttl_seconds: Option<i64>,
    pub ttl_label: Option<String>,
    pub memory_usage_bytes: Option<u64>,
    pub memory_usage_label: Option<String>,
    pub length: Option<u64>,
    pub encoding: Option<String>,
    pub idle_seconds: Option<u64>,
    pub reference_count: Option<u64>,
    pub database_index: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyScanRequest {
    pub tab_id: Option<String>,
    pub connection_id: String,
    pub environment_id: String,
    pub database_index: Option<u32>,
    pub delimiter: Option<String>,
    pub pattern: Option<String>,
    pub type_filter: Option<String>,
    pub cursor: Option<String>,
    pub count: Option<u32>,
    pub page_size: Option<u32>,
    pub summary_mode: Option<String>,
    pub filters: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyScanResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub database_index: Option<u32>,
    pub cursor: String,
    pub next_cursor: Option<String>,
    pub scanned_count: u32,
    pub keys: Vec<RedisKeySummary>,
    pub used_type_filter_fallback: bool,
    pub module_types: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInspectRequest {
    #[serde(default)]
    pub execution_id: Option<String>,
    pub tab_id: String,
    pub connection_id: String,
    pub environment_id: String,
    pub database_index: Option<u32>,
    pub key: String,
    pub sample_size: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResponse {
    pub execution_id: String,
    pub tab: QueryTabState,
    pub result: Option<ExecutionResultEnvelope>,
    pub guardrail: GuardrailDecision,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExecutionRequest {
    pub execution_id: String,
    pub tab_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExecutionResult {
    pub ok: bool,
    pub supported: bool,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryTabReorderRequest {
    pub ordered_tab_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScopedQueryTarget {
    pub kind: String,
    pub label: String,
    #[serde(default, deserialize_with = "deserialize_string_vec_or_default")]
    pub path: Vec<String>,
    pub scope: Option<String>,
    pub query_template: Option<String>,
    pub preferred_builder: Option<String>,
}

fn deserialize_string_vec_or_default<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Vec<String>>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateScopedQueryTabRequest {
    pub connection_id: String,
    pub environment_id: Option<String>,
    pub target: ScopedQueryTarget,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQueryBuilderStateRequest {
    pub tab_id: String,
    pub builder_state: Value,
    pub query_text: Option<String>,
    #[serde(default)]
    pub query_view_mode: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationManifestRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub scope: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationManifestResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub engine: String,
    pub operations: Vec<DatastoreOperationManifest>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPlanRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub operation_id: String,
    pub object_name: Option<String>,
    pub parameters: Option<HashMap<String, Value>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPlanResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub plan: OperationPlan,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationExecutionRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub operation_id: String,
    pub object_name: Option<String>,
    pub parameters: Option<HashMap<String, Value>>,
    pub confirmation_text: Option<String>,
    pub row_limit: Option<u32>,
    pub tab_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationExecutionResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub operation_id: String,
    pub execution_support: String,
    pub executed: bool,
    pub plan: OperationPlan,
    pub result: Option<ExecutionResultEnvelope>,
    pub permission_inspection: Option<PermissionInspection>,
    pub diagnostics: Option<AdapterDiagnostics>,
    pub metadata: Option<Value>,
    pub messages: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInspectionRequest {
    pub connection_id: String,
    pub environment_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInspectionResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub inspection: PermissionInspection,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDiagnosticsRequest {
    pub connection_id: String,
    pub environment_id: String,
    pub scope: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDiagnosticsResponse {
    pub connection_id: String,
    pub environment_id: String,
    pub diagnostics: AdapterDiagnostics,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUiStateRequest {
    pub active_environment_id: Option<String>,
    pub active_activity: Option<String>,
    pub sidebar_collapsed: Option<bool>,
    pub active_sidebar_pane: Option<String>,
    #[serde(default, deserialize_with = "optional_u32_from_number")]
    pub sidebar_width: Option<u32>,
    pub explorer_filter: Option<String>,
    pub explorer_view: Option<String>,
    pub connection_group_mode: Option<String>,
    pub sidebar_section_states: Option<HashMap<String, bool>>,
    pub bottom_panel_visible: Option<bool>,
    pub active_bottom_panel_tab: Option<String>,
    #[serde(default, deserialize_with = "optional_u32_from_number")]
    pub bottom_panel_height: Option<u32>,
    pub results_dock: Option<String>,
    #[serde(default, deserialize_with = "optional_u32_from_number")]
    pub results_side_width: Option<u32>,
    pub right_drawer: Option<String>,
    #[serde(default, deserialize_with = "optional_u32_from_number")]
    pub right_drawer_width: Option<u32>,
}

fn optional_u32_from_number<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: de::Deserializer<'de>,
{
    let Some(value) = Option::<Value>::deserialize(deserializer)? else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(None);
    }

    let Some(number) = value.as_f64() else {
        return Err(de::Error::custom(
            "expected a finite non-negative number for UI size",
        ));
    };

    if !number.is_finite() || number < 0.0 || number > u32::MAX as f64 {
        return Err(de::Error::custom(
            "expected a finite non-negative number for UI size",
        ));
    }

    Ok(Some(number.round() as u32))
}

#[cfg(test)]
#[path = "../../tests/unit/domain/models/update_ui_state_request_tests.rs"]
mod update_ui_state_request_tests;
