use super::*;

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
    pub scoped_target: Option<ScopedQueryTarget>,
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
pub struct ExplorerFolderOrderRequest {
    pub order_key: String,
    #[serde(default)]
    pub ordered_node_keys: Vec<String>,
}
