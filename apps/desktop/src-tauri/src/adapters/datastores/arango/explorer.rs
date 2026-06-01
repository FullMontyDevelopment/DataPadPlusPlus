use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::arango_execution_capabilities;
use super::connection::arango_get;

pub(super) async fn list_arango_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("arango:collections") => collection_nodes(connection, request.limit, None).await?,
        Some("arango:graphs" | "graph:graphs") => graph_nodes(connection, request.limit).await?,
        Some("graph:node-labels") => {
            collection_nodes(
                connection,
                request.limit,
                Some(ArangoCollectionKind::Document),
            )
            .await?
        }
        Some("graph:relationship-types") => {
            collection_nodes(connection, request.limit, Some(ArangoCollectionKind::Edge)).await?
        }
        Some("graph:indexes") => all_index_nodes(connection, request.limit).await?,
        Some("graph:procedures") => foxx_service_nodes(connection).await?,
        Some("graph:security" | "arango:security") => security_nodes(connection).await?,
        Some(scope)
            if scope.starts_with("arango:collection:")
                || scope.starts_with("node-label:")
                || scope.starts_with("relationship:") =>
        {
            collection_child_nodes(connection, scope).await?
        }
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} ArangoDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: arango_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_arango_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let collection_query = request
        .node_id
        .strip_prefix("arango-collection:")
        .or_else(|| request.node_id.strip_prefix("node-label:"))
        .or_else(|| request.node_id.strip_prefix("relationship:"))
        .map(arango_collection_query);
    let graph_query = request
        .node_id
        .strip_prefix("arango-graph:")
        .or_else(|| named_graph_id(&request.node_id))
        .map(arango_graph_query);
    let query_template =
        collection_query
            .or(graph_query)
            .unwrap_or_else(|| match request.node_id.as_str() {
                "graph:graphs" => "FOR graph IN _graphs RETURN graph".into(),
                "graph:node-labels" => "FOR doc IN collection LIMIT 100 RETURN doc".into(),
                "graph:relationship-types" => {
                    "FOR edge IN edge_collection LIMIT 100 RETURN edge".into()
                }
                "graph:indexes" => "FOR doc IN collection LIMIT 100 RETURN doc".into(),
                "graph:procedures" => "RETURN VERSION()".into(),
                "graph:security" => "RETURN CURRENT_USER()".into(),
                _ => "FOR doc IN collections RETURN doc".into(),
            });
    let object_view = arango_object_view_kind(&request.node_id);
    let mut payload = arango_base_payload(connection, &request.node_id, object_view);
    enrich_arango_inspection(connection, &request.node_id, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "ArangoDB {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "graph:graphs",
            "Graphs",
            "graphs",
            "Named graph definitions and edge relations",
            "graph:graphs",
            "FOR v, e, p IN 1..2 OUTBOUND @start GRAPH @graph RETURN p",
            true,
        ),
        (
            "graph:node-labels",
            "Document Collections",
            "node-labels",
            "Document collections used as graph vertices",
            "graph:node-labels",
            "FOR doc IN collection LIMIT 100 RETURN doc",
            true,
        ),
        (
            "graph:relationship-types",
            "Edge Collections",
            "relationship-types",
            "Edge collections that connect graph vertices",
            "graph:relationship-types",
            "FOR edge IN edge_collection LIMIT 100 RETURN edge",
            true,
        ),
        (
            "graph:indexes",
            "Indexes",
            "indexes",
            "Collection index definitions",
            "graph:indexes",
            "FOR doc IN collection LIMIT 100 RETURN doc",
            true,
        ),
        (
            "graph:procedures",
            "Services",
            "procedures",
            "Foxx services and server-side graph workflows",
            "graph:procedures",
            "RETURN VERSION()",
            true,
        ),
        (
            "graph:security",
            "Security",
            "security",
            "Users, permissions, and database access surfaces",
            "graph:security",
            "RETURN CURRENT_USER()",
            true,
        ),
        (
            "graph:diagnostics",
            "Diagnostics",
            "diagnostics",
            "AQL explain/profile and server status surfaces",
            "graph:diagnostics",
            "RETURN VERSION()",
            false,
        ),
    ]
    .into_iter()
    .map(
        |(id, label, kind, detail, scope, query, expandable)| ExplorerNode {
            id: id.into(),
            family: "graph".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: Some(scope.into()),
            path: Some(vec![connection.name.clone(), "ArangoDB".into()]),
            query_template: Some(query.into()),
            expandable: Some(expandable),
        },
    )
    .collect()
}

async fn collection_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
    collection_kind: Option<ArangoCollectionKind>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = arango_json(connection, "/_api/collection").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(value
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| {
            let name = item.get("name").and_then(Value::as_str)?;
            let kind = ArangoCollectionKind::from_value(item)?;
            if collection_kind.is_some_and(|expected| expected != kind) {
                return None;
            }
            Some((name, kind))
        })
        .map(|(name, kind)| ExplorerNode {
            id: match kind {
                ArangoCollectionKind::Document => format!("node-label:{name}"),
                ArangoCollectionKind::Edge => format!("relationship:{name}"),
            },
            family: "graph".into(),
            label: name.into(),
            kind: match kind {
                ArangoCollectionKind::Document => "node-label",
                ArangoCollectionKind::Edge => "relationship",
            }
            .into(),
            detail: match kind {
                ArangoCollectionKind::Document => "ArangoDB document collection",
                ArangoCollectionKind::Edge => "ArangoDB edge collection",
            }
            .into(),
            scope: Some(match kind {
                ArangoCollectionKind::Document => format!("node-label:{name}"),
                ArangoCollectionKind::Edge => format!("relationship:{name}"),
            }),
            path: Some(vec![
                connection.name.clone(),
                match kind {
                    ArangoCollectionKind::Document => "Document Collections",
                    ArangoCollectionKind::Edge => "Edge Collections",
                }
                .into(),
            ]),
            query_template: Some(arango_collection_query(name)),
            expandable: Some(true),
        })
        .collect())
}

async fn collection_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let collection = scope
        .strip_prefix("arango:collection:")
        .or_else(|| scope.strip_prefix("node-label:"))
        .or_else(|| scope.strip_prefix("relationship:"))
        .unwrap_or(scope);
    let value = arango_json(connection, &format!("/_api/index?collection={collection}")).await?;
    Ok(value
        .get("indexes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .map(|name| ExplorerNode {
            id: format!("index:{collection}:{name}"),
            family: "graph".into(),
            label: name.into(),
            kind: "index".into(),
            detail: "ArangoDB index".into(),
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                "Collections".into(),
                collection.into(),
            ]),
            query_template: Some(arango_collection_query(collection)),
            expandable: Some(false),
        })
        .collect())
}

async fn all_index_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let collections = arango_json(connection, "/_api/collection").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let mut nodes = Vec::new();

    for collection in collections
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .take(25)
    {
        let indexes =
            optional_arango_json(connection, &format!("/_api/index?collection={collection}")).await;
        for name in indexes
            .as_ref()
            .and_then(|value| value.get("indexes"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("name").and_then(Value::as_str))
        {
            nodes.push(ExplorerNode {
                id: format!("index:{collection}:{name}"),
                family: "graph".into(),
                label: format!("{collection}.{name}"),
                kind: "index".into(),
                detail: "ArangoDB collection index".into(),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    "Indexes".into(),
                    collection.into(),
                ]),
                query_template: Some(arango_collection_query(collection)),
                expandable: Some(false),
            });
            if nodes.len() >= limit {
                return Ok(nodes);
            }
        }
    }

    Ok(nodes)
}

async fn graph_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = arango_json(connection, "/_api/gharial").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(value
        .get("graphs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| item.get("_key").and_then(Value::as_str))
        .map(|name| ExplorerNode {
            id: format!("arango-graph:{name}"),
            family: "graph".into(),
            label: name.into(),
            kind: "graph".into(),
            detail: "ArangoDB named graph".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Graphs".into()]),
            query_template: Some(arango_graph_query(name)),
            expandable: Some(false),
        })
        .collect())
}

async fn foxx_service_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some(value) = optional_arango_json(connection, "/_api/foxx?excludeSystem=true").await
    else {
        return Ok(Vec::new());
    };

    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let mount = item
                .get("mount")
                .or_else(|| item.get("mountPoint"))
                .and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("procedure:{mount}"),
                family: "graph".into(),
                label: mount.into(),
                kind: "procedures".into(),
                detail: "ArangoDB Foxx service".into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Services".into()]),
                query_template: Some("RETURN VERSION()".into()),
                expandable: Some(false),
            })
        })
        .collect())
}

async fn security_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some(value) = optional_arango_json(connection, "/_api/user").await else {
        return Ok(Vec::new());
    };

    Ok(value
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("user").and_then(Value::as_str))
        .map(|user| ExplorerNode {
            id: format!("security:{user}"),
            family: "graph".into(),
            label: user.into(),
            kind: "security".into(),
            detail: "ArangoDB user".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Security".into()]),
            query_template: Some("RETURN CURRENT_USER()".into()),
            expandable: Some(false),
        })
        .collect())
}

async fn arango_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<Value, CommandError> {
    let response = arango_get(connection, path).await?;
    serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "arango-json-invalid",
            format!("ArangoDB returned invalid JSON: {error}"),
        )
    })
}

async fn enrich_arango_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) {
    let collections = optional_arango_json(connection, "/_api/collection").await;
    let graphs = optional_arango_json(connection, "/_api/gharial").await;
    let version = optional_arango_json(connection, "/_api/version").await;
    let users = optional_arango_json(connection, "/_api/user").await;
    let services = optional_arango_json(connection, "/_api/foxx?excludeSystem=true").await;
    let collection_filter = node_id
        .strip_prefix("arango-collection:")
        .or_else(|| node_id.strip_prefix("node-label:"))
        .or_else(|| node_id.strip_prefix("relationship:"))
        .or_else(|| {
            node_id
                .strip_prefix("arango-index:")
                .and_then(|rest| rest.split(':').next())
        })
        .or_else(|| {
            node_id
                .strip_prefix("index:")
                .and_then(|rest| rest.split(':').next())
        });
    let graph_filter = if node_id == "graph:graphs" {
        None
    } else {
        node_id
            .strip_prefix("arango-graph:")
            .or_else(|| node_id.strip_prefix("graph:"))
    };
    let indexes = if let Some(collection) = collection_filter {
        optional_arango_json(connection, &format!("/_api/index?collection={collection}")).await
    } else {
        None
    };

    let (node_labels, relationship_types) =
        arango_collection_records(collections.as_ref(), collection_filter);
    let graph_rows = arango_graph_records(graphs.as_ref(), graph_filter);
    let index_rows = arango_index_records(
        indexes.as_ref(),
        node_id
            .strip_prefix("arango-index:")
            .or_else(|| node_id.strip_prefix("index:")),
    );

    payload["graphs"] = json!(graph_rows);
    payload["nodeLabels"] = json!(node_labels);
    payload["relationshipTypes"] = json!(relationship_types);
    payload["indexes"] = json!(index_rows);
    payload["procedures"] = json!(arango_foxx_records(services.as_ref()));
    payload["security"] = json!(arango_security_records(users.as_ref()));
    payload["diagnostics"] = json!(arango_diagnostic_records(
        version.as_ref(),
        collections.is_some(),
        graphs.is_some(),
    ));
    payload["labelCount"] = json!(payload["nodeLabels"].as_array().map_or(0, Vec::len));
    payload["relationshipTypeCount"] =
        json!(payload["relationshipTypes"].as_array().map_or(0, Vec::len));
    payload["indexCount"] = json!(payload["indexes"].as_array().map_or(0, Vec::len));

    if collections.is_none() && graphs.is_none() && version.is_none() {
        payload["warnings"] =
            json!(["ArangoDB metadata is unavailable from the configured HTTP API right now."]);
    }
}

async fn optional_arango_json(connection: &ResolvedConnectionProfile, path: &str) -> Option<Value> {
    arango_json(connection, path).await.ok()
}

fn arango_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    json!({
        "engine": "arango",
        "nodeId": node_id,
        "objectView": object_view,
        "graphName": connection.database.as_deref().unwrap_or("_system"),
        "labelCount": 0,
        "relationshipTypeCount": 0,
        "indexCount": 0,
        "constraintCount": 0,
        "graphs": [],
        "nodeLabels": [],
        "relationshipTypes": [],
        "propertyKeys": [],
        "indexes": [],
        "constraints": [],
        "procedures": [],
        "security": [],
        "diagnostics": [{
            "signal": "Metadata",
            "value": "HTTP API",
            "status": "ready",
            "guidance": "ArangoDB object views use bounded collection, graph, and index metadata while keeping raw HTTP endpoints out of the main view."
        }]
    })
}

fn arango_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "arango-collections" || node_id == "graph:node-labels" {
        return "node-labels";
    }
    if node_id.starts_with("arango-collection:") || node_id.starts_with("node-label:") {
        return "node-label";
    }
    if node_id == "graph:relationship-types" {
        return "relationship-types";
    }
    if node_id.starts_with("relationship:") {
        return "relationship";
    }
    if node_id == "arango-graphs" || node_id == "graph:graphs" {
        return "graphs";
    }
    if node_id == "graph:indexes" {
        return "indexes";
    }
    if node_id.starts_with("arango-index:") || node_id.starts_with("index:") {
        return "index";
    }
    if node_id == "graph:procedures" || node_id.starts_with("procedure:") {
        return "procedures";
    }
    if node_id == "arango-security"
        || node_id == "graph:security"
        || node_id.starts_with("security:")
    {
        return "security";
    }
    if node_id == "arango-diagnostics" || node_id == "graph:diagnostics" {
        return "diagnostics";
    }
    if node_id.starts_with("arango-graph:") || node_id.starts_with("graph:") {
        return "graph";
    }
    "diagnostics"
}

fn named_graph_id(node_id: &str) -> Option<&str> {
    let graph = node_id.strip_prefix("graph:")?;
    match graph {
        "graphs" | "node-labels" | "relationship-types" | "indexes" | "procedures" | "security"
        | "diagnostics" => None,
        _ => Some(graph),
    }
}

fn arango_collection_records(
    value: Option<&Value>,
    filter: Option<&str>,
) -> (Vec<Value>, Vec<Value>) {
    let mut document_collections = Vec::new();
    let mut edge_collections = Vec::new();

    for collection in value
        .and_then(|value| value.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = collection.get("name").and_then(Value::as_str) else {
            continue;
        };
        if filter.is_some_and(|expected| expected != name) {
            continue;
        }

        let status = collection
            .get("statusString")
            .and_then(Value::as_str)
            .unwrap_or_else(|| arango_collection_status(collection.get("status")));
        let is_edge = collection.get("type").and_then(Value::as_i64) == Some(3);
        if is_edge {
            edge_collections.push(json!({
                "type": name,
                "count": "-",
                "from": "_from",
                "to": "_to",
                "properties": format!("edge collection | {status}")
            }));
        } else {
            document_collections.push(json!({
                "label": name,
                "count": "-",
                "properties": format!("document collection | {status}"),
                "indexedProperties": "-",
                "constraints": "-"
            }));
        }
    }

    (document_collections, edge_collections)
}

fn arango_graph_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    value
        .and_then(|value| value.get("graphs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|graph| {
            graph
                .get("_key")
                .and_then(Value::as_str)
                .map(|name| (name, graph))
        })
        .filter(|(name, _)| filter.is_none_or(|expected| expected == *name))
        .map(|(name, graph)| {
            let edges = graph
                .get("edgeDefinitions")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            json!({
                "name": name,
                "database": "-",
                "nodes": "-",
                "relationships": edges,
                "labels": "-",
                "relationshipTypes": edges
            })
        })
        .collect()
}

fn arango_index_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    let filter_parts = filter
        .map(|filter| filter.split(':').collect::<Vec<_>>())
        .unwrap_or_default();
    let expected_name = filter_parts.get(1).copied();

    value
        .and_then(|value| value.get("indexes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|index| {
            index
                .get("name")
                .or_else(|| index.get("id"))
                .and_then(Value::as_str)
                .map(|name| (name, index))
        })
        .filter(|(name, _)| expected_name.is_none_or(|expected| expected == *name))
        .map(|(name, index)| {
            json!({
                "name": name,
                "type": index.get("type").and_then(Value::as_str).unwrap_or("-"),
                "target": index.get("fields").map(arango_value_to_display).unwrap_or_else(|| "-".into()),
                "properties": index.get("fields").map(arango_value_to_display).unwrap_or_else(|| "-".into()),
                "state": if index.get("sparse").and_then(Value::as_bool) == Some(true) { "sparse" } else { "active" },
                "provider": "ArangoDB"
            })
        })
        .collect()
}

fn arango_foxx_records(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let name = item
                .get("mount")
                .or_else(|| item.get("mountPoint"))
                .and_then(Value::as_str)?;
            Some(json!({
                "name": name,
                "mode": "service",
                "signature": item.get("name").and_then(Value::as_str).unwrap_or("-"),
                "description": item.get("description").and_then(Value::as_str).unwrap_or("Foxx service"),
                "requiresAdmin": "depends on service permissions"
            }))
        })
        .collect()
}

fn arango_security_records(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(|value| value.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("user").and_then(Value::as_str))
        .map(|user| {
            json!({
                "principal": user,
                "role": "database user",
                "privilege": "visible",
                "scope": "database",
                "effect": "allow"
            })
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArangoCollectionKind {
    Document,
    Edge,
}

impl ArangoCollectionKind {
    fn from_value(value: &Value) -> Option<Self> {
        match value.get("type").and_then(Value::as_i64) {
            Some(2) => Some(Self::Document),
            Some(3) => Some(Self::Edge),
            _ => None,
        }
    }
}

fn arango_diagnostic_records(
    version: Option<&Value>,
    collections_available: bool,
    graphs_available: bool,
) -> Vec<Value> {
    vec![
        json!({
            "signal": "Server Version",
            "value": version.and_then(|value| value.get("version")).and_then(Value::as_str).unwrap_or("-"),
            "status": if version.is_some() { "ready" } else { "unavailable" },
            "guidance": "Use diagnostics to confirm server reachability before running AQL explain/profile workflows."
        }),
        json!({
            "signal": "Metadata",
            "value": if collections_available && graphs_available { "available" } else { "partial" },
            "status": if collections_available { "ready" } else { "watch" },
            "guidance": "Collection, graph, and index metadata are collected independently so one failed surface does not blank the tree."
        }),
    ]
}

fn arango_collection_status(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_i64) {
        Some(3) => "loaded",
        Some(2) => "unloaded",
        Some(4) => "being unloaded",
        Some(5) => "deleted",
        Some(6) => "loading",
        _ => "unknown",
    }
}

fn arango_value_to_display(value: &Value) -> String {
    match value {
        Value::Array(items) => items
            .iter()
            .map(arango_value_to_display)
            .collect::<Vec<_>>()
            .join(", "),
        Value::String(value) => value.clone(),
        Value::Null => "-".into(),
        _ => value.to_string(),
    }
}

pub(crate) fn arango_collection_query(collection: &str) -> String {
    format!(
        "FOR doc IN {} LIMIT 100 RETURN doc",
        quote_aql_identifier(collection)
    )
}

pub(crate) fn arango_graph_query(graph: &str) -> String {
    format!(
        "FOR v, e, p IN 1..2 ANY @start GRAPH {} RETURN p",
        quote_aql_string(graph)
    )
}

fn quote_aql_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn quote_aql_string(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        arango_base_payload, arango_collection_records, arango_index_records,
        arango_object_view_kind, root_nodes,
    };
    use super::{arango_collection_query, arango_graph_query};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn arango_collection_query_quotes_identifier() {
        assert_eq!(
            arango_collection_query("odd`collection"),
            "FOR doc IN `odd``collection` LIMIT 100 RETURN doc"
        );
    }

    #[test]
    fn arango_graph_query_quotes_graph_name() {
        assert_eq!(
            arango_graph_query("social"),
            "FOR v, e, p IN 1..2 ANY @start GRAPH \"social\" RETURN p"
        );
    }

    #[test]
    fn arango_root_marks_leaf_views_as_non_expandable() {
        let nodes = root_nodes(&connection());
        let diagnostics = nodes
            .iter()
            .find(|node| node.id == "graph:diagnostics")
            .expect("diagnostics node");
        let security = nodes
            .iter()
            .find(|node| node.id == "graph:security")
            .expect("security node");

        assert_eq!(diagnostics.expandable, Some(false));
        assert_eq!(security.expandable, Some(true));
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Graphs",
                "Document Collections",
                "Edge Collections",
                "Indexes",
                "Services",
                "Security",
                "Diagnostics"
            ]
        );
        assert!(nodes
            .iter()
            .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
    }

    #[test]
    fn arango_inspection_payload_is_view_friendly_without_raw_api_dump() {
        let payload = arango_base_payload(&connection(), "arango-collections", "node-labels");

        assert_eq!(payload["objectView"], "node-labels");
        assert!(payload.get("api").is_none());
        assert!(payload["nodeLabels"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn arango_node_ids_map_to_graph_object_views() {
        assert_eq!(arango_object_view_kind("graph:graphs"), "graphs");
        assert_eq!(arango_object_view_kind("graph:node-labels"), "node-labels");
        assert_eq!(arango_object_view_kind("node-label:users"), "node-label");
        assert_eq!(
            arango_object_view_kind("graph:relationship-types"),
            "relationship-types"
        );
        assert_eq!(
            arango_object_view_kind("relationship:follows"),
            "relationship"
        );
        assert_eq!(arango_object_view_kind("graph:indexes"), "indexes");
        assert_eq!(arango_object_view_kind("index:users:by_name"), "index");
        assert_eq!(arango_object_view_kind("graph:procedures"), "procedures");
        assert_eq!(arango_object_view_kind("graph:security"), "security");
        assert_eq!(arango_object_view_kind("arango-collections"), "node-labels");
        assert_eq!(
            arango_object_view_kind("arango-collection:users"),
            "node-label"
        );
        assert_eq!(arango_object_view_kind("arango-graphs"), "graphs");
        assert_eq!(arango_object_view_kind("arango-graph:social"), "graph");
        assert_eq!(
            arango_object_view_kind("arango-index:users:by_name"),
            "index"
        );
    }

    #[test]
    fn arango_collection_records_split_document_and_edge_collections() {
        let (documents, edges) = arango_collection_records(
            Some(&json!({
                "result": [
                    { "name": "users", "type": 2, "status": 3 },
                    { "name": "follows", "type": 3, "status": 3 }
                ]
            })),
            None,
        );

        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0]["label"], "users");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0]["type"], "follows");
    }

    #[test]
    fn arango_index_records_are_view_rows() {
        let rows = arango_index_records(
            Some(&json!({
                "indexes": [{
                    "name": "by_name",
                    "type": "persistent",
                    "fields": ["name"],
                    "sparse": true
                }]
            })),
            None,
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "by_name");
        assert_eq!(rows[0]["properties"], "name");
        assert_eq!(rows[0]["state"], "sparse");
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-arango".into(),
            name: "ArangoDB".into(),
            engine: "arango".into(),
            family: "graph".into(),
            host: "127.0.0.1".into(),
            port: Some(8529),
            database: Some("_system".into()),
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
