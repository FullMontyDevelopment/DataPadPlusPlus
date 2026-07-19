use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FirstInstallGuidePreferences {
    pub status: String,
    pub current_step_id: Option<String>,
    pub updated_at: Option<String>,
    pub completed_at: Option<String>,
}

impl Default for FirstInstallGuidePreferences {
    fn default() -> Self {
        Self {
            status: "unseen".into(),
            current_step_id: None,
            updated_at: None,
            completed_at: None,
        }
    }
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
    pub datastore_security_checks: DatastoreSecurityChecksPreferences,
    #[serde(default)]
    pub workspace_search: WorkspaceSearchPreferences,
    #[serde(default)]
    pub first_install_guide: FirstInstallGuidePreferences,
    #[serde(default)]
    pub explorer_folder_orders: HashMap<String, Vec<String>>,
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
    pub mongo_script_guide_visible: bool,
    pub mongo_script_guide_width: u32,
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
            mongo_script_guide_visible: true,
            mongo_script_guide_width: 360,
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
    pub mongo_script_guide_visible: Option<bool>,
    #[serde(default, deserialize_with = "optional_u32_from_number")]
    pub mongo_script_guide_width: Option<u32>,
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
#[path = "../../../tests/unit/domain/models/update_ui_state_request_tests.rs"]
mod update_ui_state_request_tests;
