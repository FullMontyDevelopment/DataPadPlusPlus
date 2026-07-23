use super::*;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultFileRequest {
    pub suggested_file_name: String,
    pub extension: String,
    pub mime_type: String,
    pub contents: Option<String>,
    pub result_reference: Option<ResultExportReference>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultExportReference {
    pub tab_id: String,
    pub result_id: String,
    pub renderer: String,
    pub format: String,
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
pub struct WorkspaceSummaryCounts {
    pub connections: usize,
    pub environments: usize,
    pub library_items: usize,
    pub open_tabs: usize,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
    pub counts: WorkspaceSummaryCounts,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSwitcherStatus {
    pub enabled: bool,
    pub active_workspace_id: String,
    pub workspaces: Vec<WorkspaceSummary>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSwitcherSettingsRequest {
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateRequest {
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRenameRequest {
    pub workspace_id: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSwitchRequest {
    pub workspace_id: String,
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

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct WorkspaceSearchPreferences {
    pub enabled: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub datastore_security_checks: Option<DatastoreSecurityCheckSnapshot>,
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
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub transient_result_ids: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistence_warning: Option<PersistenceWarning>,
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
