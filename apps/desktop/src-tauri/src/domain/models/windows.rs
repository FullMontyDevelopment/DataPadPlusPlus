use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowContext {
    pub window_id: String,
    pub role: String,
    pub multi_window_enabled: bool,
    pub drag_supported: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowTarget {
    pub window_id: String,
    pub role: String,
    pub title: String,
    pub active_tab_id: String,
    pub tab_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowListResponse {
    pub windows: Vec<WorkspaceWindowTarget>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabTransferRequest {
    pub tab_id: String,
    pub source_window_id: String,
    pub correlation_id: Option<String>,
    pub destination_window_id: Option<String>,
    pub before_tab_id: Option<String>,
    pub create_window: Option<bool>,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabTransferResponse {
    pub payload: BootstrapPayload,
    pub source_window_id: String,
    pub destination_window_id: String,
    pub created_window: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowGeometryRequest {
    pub window_id: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub monitor_name: Option<String>,
    pub maximized: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowCloseRequest {
    pub window_id: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabDragSessionRequest {
    pub tab_id: String,
    pub source_window_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabDragSession {
    pub token: String,
    pub tab_id: String,
    pub source_window_id: String,
}
