use serde_json::json;

use super::super::super::*;
use super::catalog::litedb_execution_capabilities;
use super::connection::litedb_file_path;

pub(super) async fn list_litedb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("litedb:collections") => collection_nodes(connection),
        Some(scope) if scope.starts_with("litedb:collection:") => {
            collection_child_nodes(connection, scope)
        }
        Some("litedb:diagnostics") => diagnostics_nodes(connection),
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
    let query_template = request
        .node_id
        .strip_prefix("litedb-collection:")
        .map(find_template)
        .unwrap_or_else(|| match request.node_id.as_str() {
            "litedb-collections" => json!({ "operation": "ListCollections" }).to_string(),
            "litedb-diagnostics" => json!({ "operation": "SampleSchema" }).to_string(),
            _ => json!({
                "operation": "Find",
                "collection": "collection",
                "filter": {},
                "limit": 100
            })
            .to_string(),
        });

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "LiteDB bridge request template ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(json!({
            "engine": "litedb",
            "nodeId": request.node_id,
            "databasePath": litedb_file_path(connection),
            "bridge": "dotnet-litedb-sidecar"
        })),
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "litedb-collections",
            "Collections",
            "collections",
            "Collections, documents, indexes, and schema samples",
            "litedb:collections",
            json!({ "operation": "ListCollections" }).to_string(),
        ),
        (
            "litedb-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Bridge status, file path, encryption, and schema sampling",
            "litedb:diagnostics",
            json!({ "operation": "SampleSchema" }).to_string(),
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "document".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "LiteDB".into()]),
        query_template: Some(query),
        expandable: Some(true),
    })
    .collect()
}

fn collection_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let collection = "collection";
    vec![ExplorerNode {
        id: format!("litedb-collection:{collection}"),
        family: "document".into(),
        label: collection.into(),
        kind: "collection".into(),
        detail: "Configured collection placeholder".into(),
        scope: Some(format!("litedb:collection:{collection}")),
        path: Some(vec![connection.name.clone(), "Collections".into()]),
        query_template: Some(find_template(collection)),
        expandable: Some(true),
    }]
}

fn collection_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let collection = scope.trim_start_matches("litedb:collection:");
    [
        (
            format!("litedb-documents:{collection}"),
            "Documents",
            "documents",
            "Find documents through bridge request",
            find_template(collection),
        ),
        (
            format!("litedb-indexes:{collection}"),
            "Indexes",
            "indexes",
            "Index definitions and ensure-index operation plans",
            json!({ "operation": "ListIndexes", "collection": collection }).to_string(),
        ),
        (
            format!("litedb-schema:{collection}"),
            "Schema Preview",
            "schema",
            "Inferred field structure from bounded collection reads",
            json!({ "operation": "SampleSchema", "collection": collection, "limit": 100 })
                .to_string(),
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, query)| ExplorerNode {
        id,
        family: "document".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![connection.name.clone(), collection.into()]),
        query_template: Some(query),
        expandable: Some(false),
    })
    .collect()
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "litedb-bridge-status".into(),
        family: "document".into(),
        label: "Bridge Status".into(),
        kind: "diagnostic".into(),
        detail: "Sidecar readiness, file location, and encryption context".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
        query_template: Some(json!({ "operation": "SampleSchema" }).to_string()),
        expandable: Some(false),
    }]
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

#[cfg(test)]
mod tests {
    use super::find_template;

    #[test]
    fn litedb_find_template_targets_collection() {
        let value: serde_json::Value = serde_json::from_str(&find_template("orders")).unwrap();

        assert_eq!(value["operation"], "Find");
        assert_eq!(value["collection"], "orders");
        assert_eq!(value["limit"], 100);
    }
}
