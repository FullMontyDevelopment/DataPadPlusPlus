use std::collections::HashMap;

use serde::{Deserialize, Serialize};
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

#[derive(Clone, Serialize, Deserialize)]
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
    pub requires_confirmation: bool,
    pub safe_mode: bool,
    pub exportable: bool,
    pub created_at: String,
    pub updated_at: String,
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
    pub scoped_target: Option<ScopedQueryTarget>,
    #[serde(default)]
    pub builder_state: Option<Value>,
    #[serde(default)]
    pub metrics_state: Option<Value>,
    #[serde(default)]
    pub test_suite: Option<Value>,
    #[serde(default)]
    pub test_run: Option<Value>,
    pub status: String,
    pub dirty: bool,
    pub last_run_at: Option<String>,
    pub result: Option<ExecutionResultEnvelope>,
    #[serde(default)]
    pub history: Vec<QueryHistoryEntry>,
    pub error: Option<UserFacingError>,
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
pub struct DataEditTarget {
    pub object_kind: String,
    #[serde(default)]
    pub path: Vec<String>,
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
pub struct AppPreferences {
    pub theme: String,
    pub telemetry: String,
    pub lock_after_minutes: u32,
    pub safe_mode_enabled: bool,
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
    pub selected_text: Option<String>,
    pub mode: Option<String>,
    pub row_limit: Option<u32>,
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
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyScanRequest {
    pub tab_id: Option<String>,
    pub connection_id: String,
    pub environment_id: String,
    pub pattern: Option<String>,
    pub type_filter: Option<String>,
    pub cursor: Option<String>,
    pub count: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyScanResponse {
    pub connection_id: String,
    pub environment_id: String,
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
    pub tab_id: String,
    pub connection_id: String,
    pub environment_id: String,
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
    #[serde(default)]
    pub path: Vec<String>,
    pub scope: Option<String>,
    pub query_template: Option<String>,
    pub preferred_builder: Option<String>,
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
    pub sidebar_width: Option<u32>,
    pub explorer_filter: Option<String>,
    pub explorer_view: Option<String>,
    pub connection_group_mode: Option<String>,
    pub sidebar_section_states: Option<HashMap<String, bool>>,
    pub bottom_panel_visible: Option<bool>,
    pub active_bottom_panel_tab: Option<String>,
    pub bottom_panel_height: Option<u32>,
    pub right_drawer: Option<String>,
    pub right_drawer_width: Option<u32>,
}
