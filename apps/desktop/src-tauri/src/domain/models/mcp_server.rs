use super::*;

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
