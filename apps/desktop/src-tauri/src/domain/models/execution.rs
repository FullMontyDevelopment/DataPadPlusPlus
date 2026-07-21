use super::*;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builder_state: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scoped_target: Option<ScopedQueryTarget>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultPageRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scoped_target: Option<ScopedQueryTarget>,
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
pub struct PersistenceWarning {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResponse {
    pub execution_id: String,
    pub tab: QueryTabState,
    pub result: Option<ExecutionResultEnvelope>,
    pub guardrail: GuardrailDecision,
    pub diagnostics: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persistence_warning: Option<PersistenceWarning>,
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
pub struct UpdateQueryTabTargetRequest {
    pub tab_id: String,
    pub scoped_target: ScopedQueryTarget,
    pub query_text: String,
    pub query_view_mode: String,
    #[serde(default)]
    pub script_text: Option<String>,
    #[serde(default)]
    pub builder_state: Option<Value>,
    #[serde(default)]
    pub title: Option<String>,
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
