use super::*;

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
