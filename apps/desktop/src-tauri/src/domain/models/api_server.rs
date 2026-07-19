use super::*;

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
