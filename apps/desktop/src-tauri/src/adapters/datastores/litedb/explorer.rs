use std::fs;

use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::litedb_execution_capabilities;
use super::connection::litedb_file_path;

pub(super) async fn list_litedb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("litedb:database") => database_child_nodes(connection),
        Some("litedb:collections") => Vec::new(),
        Some(scope) if scope.starts_with("litedb:collection:") => {
            collection_child_nodes(connection, scope)
        }
        Some("litedb:indexes") => Vec::new(),
        Some(scope) if scope.starts_with("litedb:collection-indexes:") => Vec::new(),
        Some("litedb:file-storage") => file_storage_child_nodes(connection),
        Some("litedb:diagnostics") => diagnostics_child_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} LiteDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: litedb_execution_capabilities(),
        nodes,
    })
}

pub(super) fn inspect_litedb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let query_template = litedb_query_template(&request.node_id);
    let payload = litedb_inspection_payload(connection, &request.node_id);

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "LiteDB metadata view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:database",
            &litedb_file_name(connection),
            "database",
            "Local LiteDB file overview",
            Some("litedb:database"),
            true,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![],
        ),
        litedb_node(
            "litedb:diagnostics",
            "Diagnostics",
            "diagnostics",
            "File health, storage pressure, and index coverage",
            Some("litedb:diagnostics"),
            false,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![],
        ),
    ]
}

fn database_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:collections",
            "Collections",
            "collections",
            "Document collections",
            Some("litedb:collections"),
            true,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:indexes",
            "Indexes",
            "indexes",
            "Collection index definitions",
            Some("litedb:indexes"),
            true,
            Some(json!({ "operation": "ListIndexes" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:file-storage",
            "File Storage",
            "file-storage",
            "Stored files and chunk health",
            Some("litedb:file-storage"),
            true,
            None,
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:storage",
            "Storage",
            "storage",
            "Pages, free space, and maintenance health",
            Some("litedb:storage"),
            false,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:settings",
            "Settings",
            "settings",
            "Connection and local file options",
            Some("litedb:settings"),
            false,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
    ]
}

fn collection_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let collection = scope.trim_start_matches("litedb:collection:");
    vec![
        litedb_node(
            &format!("litedb:documents:{collection}"),
            "Documents",
            "documents",
            "Open a bounded document query",
            Some(&format!("litedb:documents:{collection}")),
            false,
            Some(find_template(collection)),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:schema:{collection}"),
            "Schema Preview",
            "schema",
            "Inferred field paths and value types",
            Some(&format!("litedb:schema:{collection}")),
            false,
            Some(
                json!({ "operation": "Schema", "collection": collection, "limit": 100 })
                    .to_string(),
            ),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:collection-indexes:{collection}"),
            "Indexes",
            "indexes",
            "Collection index definitions",
            Some(&format!("litedb:collection-indexes:{collection}")),
            true,
            Some(json!({ "operation": "ListIndexes", "collection": collection }).to_string()),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:collection-storage:{collection}"),
            "Storage",
            "storage",
            "Collection storage footprint",
            Some(&format!("litedb:collection-storage:{collection}")),
            false,
            None,
            vec![litedb_file_name(connection), collection.into()],
        ),
    ]
}

fn file_storage_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:files",
            "Files",
            "files",
            "File metadata and chunk counts",
            Some("litedb:files"),
            false,
            None,
            vec![litedb_file_name(connection), "File Storage".into()],
        ),
        litedb_node(
            "litedb:chunks",
            "Chunks",
            "chunks",
            "Chunk distribution and missing chunks",
            Some("litedb:chunks"),
            false,
            None,
            vec![litedb_file_name(connection), "File Storage".into()],
        ),
    ]
}

fn diagnostics_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![litedb_node(
        "litedb:file-health",
        "File Health",
        "diagnostics",
        "Local file availability and safety posture",
        Some("litedb:file-health"),
        false,
        Some(json!({ "operation": "ListCollections" }).to_string()),
        vec![litedb_file_name(connection), "Diagnostics".into()],
    )]
}

fn litedb_inspection_payload(connection: &ResolvedConnectionProfile, node_id: &str) -> Value {
    let object_view = litedb_object_view(node_id);
    let collection = collection_from_node_id(node_id);
    let file_path = litedb_file_path(connection);
    let file_size = file_size_label(&file_path);
    let file_exists = fs::metadata(&file_path).is_ok();
    let mut warnings = Vec::new();

    if !file_exists {
        warnings
            .push("LiteDB file metadata is unavailable; verify the local file path.".to_string());
    }

    warnings.push(
        "Live collection enumeration requires the LiteDB sidecar; no placeholder collections are shown."
            .to_string(),
    );

    let collections = collection
        .as_ref()
        .map(|name| {
            vec![json!({
                "name": name,
                "documentCount": "-",
                "indexes": "-",
                "avgDocumentSize": "-",
            })]
        })
        .unwrap_or_default();
    let indexes = collection
        .as_ref()
        .map(|name| {
            vec![json!({
                "collection": name,
                "name": "_id",
                "expression": "$._id",
                "unique": true,
                "status": "expected",
            })]
        })
        .unwrap_or_default();
    let fields = collection
        .as_ref()
        .map(|name| {
            vec![json!({
                "path": "_id",
                "types": "document id",
                "presence": "-",
                "example": format!("{name} document key"),
                "warning": "",
            })]
        })
        .unwrap_or_default();
    let settings = vec![
        json!({ "name": "File", "value": file_path, "scope": "local file" }),
        json!({ "name": "Mode", "value": connection.connection_string.as_deref().unwrap_or("local-file"), "scope": "connection" }),
        json!({ "name": "Password", "value": if connection.password.is_some() { "stored secret" } else { "not configured" }, "scope": "secret store" }),
        json!({ "name": "Read Only", "value": connection.read_only, "scope": "safety" }),
    ];
    let storage = vec![
        json!({ "name": "File Size", "value": file_size, "status": if file_exists { "healthy" } else { "watch" }, "guidance": "Local file size is read directly from the filesystem." }),
        json!({ "name": "Collection Metadata", "value": if collections.is_empty() { "sidecar required" } else { "scoped collection" }, "status": "watch", "guidance": "Collection counts and page allocation need the LiteDB sidecar metadata endpoint." }),
    ];
    let diagnostics = vec![
        json!({ "signal": "File Available", "value": file_exists, "status": if file_exists { "healthy" } else { "watch" }, "guidance": "Queries need the configured local file to exist and be accessible." }),
        json!({ "signal": "Live Collection Enumeration", "value": "sidecar required", "status": "watch", "guidance": "DataPad++ no longer shows invented collection names when live metadata is unavailable." }),
        json!({ "signal": "Read Only", "value": connection.read_only, "status": if connection.read_only { "healthy" } else { "watch" }, "guidance": "Writable local file operations remain guarded by environment safety rules." }),
    ];

    json!({
        "engine": "litedb",
        "database": litedb_file_name(connection),
        "objectView": object_view,
        "collection": collection,
        "collectionCount": collections.len(),
        "documentCount": "-",
        "indexCount": indexes.len(),
        "fileSize": file_size_label(&litedb_file_path(connection)),
        "collections": collections,
        "fields": fields,
        "indexes": indexes,
        "files": [],
        "chunks": [],
        "storage": storage,
        "settings": settings,
        "diagnostics": diagnostics,
        "warnings": warnings,
    })
}

fn litedb_query_template(node_id: &str) -> String {
    if let Some(collection) = collection_from_node_id(node_id) {
        if node_id.starts_with("litedb:schema:") {
            return json!({ "operation": "Schema", "collection": collection, "limit": 100 })
                .to_string();
        }

        if node_id.starts_with("litedb:collection-indexes:") {
            return json!({ "operation": "ListIndexes", "collection": collection }).to_string();
        }

        return find_template(&collection);
    }

    if node_id == "litedb:indexes" {
        return json!({ "operation": "ListIndexes" }).to_string();
    }

    json!({ "operation": "ListCollections" }).to_string()
}

pub(crate) fn find_template(collection: &str) -> String {
    json!({
        "operation": "Find",
        "collection": collection,
        "filter": {},
        "limit": 100
    })
    .to_string()
}

fn litedb_object_view(node_id: &str) -> &'static str {
    if node_id == "litedb:database" {
        return "database";
    }
    if node_id == "litedb:collections" {
        return "collections";
    }
    if node_id.starts_with("litedb:collection:") {
        return "collection";
    }
    if node_id.starts_with("litedb:documents:") {
        return "documents";
    }
    if node_id.starts_with("litedb:schema:") {
        return "schema";
    }
    if node_id == "litedb:indexes" || node_id.starts_with("litedb:collection-indexes:") {
        return "indexes";
    }
    if node_id.starts_with("litedb:index:") {
        return "index";
    }
    if node_id == "litedb:file-storage" {
        return "file-storage";
    }
    if node_id == "litedb:files" {
        return "files";
    }
    if node_id == "litedb:chunks" {
        return "chunks";
    }
    if node_id == "litedb:storage" || node_id.starts_with("litedb:collection-storage:") {
        return "storage";
    }
    if node_id == "litedb:settings" {
        return "settings";
    }
    "diagnostics"
}

fn collection_from_node_id(node_id: &str) -> Option<String> {
    [
        "litedb:collection:",
        "litedb:documents:",
        "litedb:schema:",
        "litedb:collection-indexes:",
        "litedb:collection-storage:",
    ]
    .into_iter()
    .find_map(|prefix| node_id.strip_prefix(prefix))
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
}

// Mirrors the ExplorerNode shape so LiteDB scopes stay readable at call sites.
#[allow(clippy::too_many_arguments)]
fn litedb_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    query_template: Option<String>,
    path: Vec<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "document".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

fn litedb_file_name(connection: &ResolvedConnectionProfile) -> String {
    litedb_file_path(connection)
        .split(['/', '\\'])
        .rfind(|segment| !segment.trim().is_empty())
        .unwrap_or("local.db")
        .to_string()
}

fn file_size_label(path: &str) -> String {
    fs::metadata(path)
        .map(|metadata| human_bytes(metadata.len()))
        .unwrap_or_else(|_| "-".into())
}

fn human_bytes(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB", bytes / 1024.0 / 1024.0)
    } else if bytes >= 1024.0 {
        format!("{:.1} KB", bytes / 1024.0)
    } else {
        format!("{bytes:.0} B")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        collection_child_nodes, collection_from_node_id, database_child_nodes, find_template,
        inspect_litedb_explorer_node, list_litedb_explorer_nodes, litedb_object_view, root_nodes,
    };
    use crate::domain::models::{
        ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile,
    };

    #[tokio::test]
    async fn litedb_collections_scope_does_not_invent_placeholder_collection() {
        let response = list_litedb_explorer_nodes(
            &connection(),
            &ExplorerRequest {
                connection_id: "conn-litedb".into(),
                environment_id: "env-local".into(),
                scope: Some("litedb:collections".into()),
                limit: None,
            },
        )
        .await
        .unwrap();

        assert!(response.nodes.is_empty());
    }

    #[test]
    fn litedb_root_uses_database_and_diagnostics_sections() {
        let nodes = root_nodes(&connection());
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["catalog.db", "Diagnostics"]);
        assert_eq!(nodes[0].id, "litedb:database");
        assert_eq!(nodes[0].scope.as_deref(), Some("litedb:database"));
    }

    #[test]
    fn litedb_database_children_match_native_sections() {
        let nodes = database_child_nodes(&connection());
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Collections",
                "Indexes",
                "File Storage",
                "Storage",
                "Settings"
            ]
        );
    }

    #[test]
    fn litedb_known_collection_scope_keeps_management_children() {
        let nodes = collection_child_nodes(&connection(), "litedb:collection:orders");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec!["Documents", "Schema Preview", "Indexes", "Storage"]
        );
        let expected = find_template("orders");
        assert_eq!(nodes[0].query_template.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn litedb_inspection_payload_is_view_friendly_without_raw_bridge_dump() {
        let response = inspect_litedb_explorer_node(
            &connection(),
            &ExplorerInspectRequest {
                connection_id: "conn-litedb".into(),
                environment_id: "env-local".into(),
                node_id: "litedb:database".into(),
            },
        );
        let payload = response.payload.unwrap();

        assert_eq!(payload["objectView"], "database");
        assert_eq!(payload["engine"], "litedb");
        assert!(payload.get("bridge").is_none());
        assert!(payload["diagnostics"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn litedb_schema_template_uses_user_facing_schema_alias() {
        let response = inspect_litedb_explorer_node(
            &connection(),
            &ExplorerInspectRequest {
                connection_id: "conn-litedb".into(),
                environment_id: "env-local".into(),
                node_id: "litedb:schema:orders".into(),
            },
        );
        let query: Value = serde_json::from_str(&response.query_template.unwrap()).unwrap();

        assert_eq!(query["operation"], "Schema");
        assert_eq!(query["collection"], "orders");
    }

    #[test]
    fn litedb_node_ids_map_to_object_views() {
        assert_eq!(litedb_object_view("litedb:database"), "database");
        assert_eq!(litedb_object_view("litedb:collection:orders"), "collection");
        assert_eq!(litedb_object_view("litedb:schema:orders"), "schema");
        assert_eq!(litedb_object_view("litedb:file-storage"), "file-storage");
        assert_eq!(litedb_object_view("litedb:unknown"), "diagnostics");
        assert_eq!(
            collection_from_node_id("litedb:collection-indexes:orders").as_deref(),
            Some("orders")
        );
    }

    #[test]
    fn litedb_find_template_targets_collection() {
        let value: serde_json::Value = serde_json::from_str(&find_template("orders")).unwrap();

        assert_eq!(value["operation"], "Find");
        assert_eq!(value["collection"], "orders");
        assert_eq!(value["limit"], 100);
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-litedb".into(),
            name: "LiteDB".into(),
            engine: "litedb".into(),
            family: "document".into(),
            host: "C:/data/catalog.db".into(),
            port: None,
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }
}
