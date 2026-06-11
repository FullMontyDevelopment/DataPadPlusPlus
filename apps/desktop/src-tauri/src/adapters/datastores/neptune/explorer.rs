use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::neptune_execution_capabilities;
use super::connection::{neptune_get, parse_neptune_json};

pub(super) async fn list_neptune_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("graph:graphs") => graph_nodes(connection),
        Some("graph:node-labels") => node_label_template_nodes(connection),
        Some("graph:relationship-types") => relationship_template_nodes(connection),
        Some("graph:procedures") => query_language_nodes(connection),
        Some("graph:security") => security_nodes(connection),
        Some("graph:diagnostics") => diagnostics_template_nodes(connection),
        Some("neptune:gremlin") => gremlin_template_nodes(connection),
        Some("neptune:opencypher") => opencypher_template_nodes(connection),
        Some("neptune:sparql") => sparql_template_nodes(connection),
        Some("neptune:diagnostics") => diagnostics_template_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Amazon Neptune explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: neptune_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_neptune_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = neptune_query_template(&request.node_id);
    let object_view = neptune_object_view_kind(&request.node_id);
    let mut payload = neptune_base_payload(connection, &request.node_id, object_view);
    enrich_neptune_inspection(connection, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Amazon Neptune {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template.into()),
        payload: Some(payload),
    })
}

fn neptune_query_template(node_id: &str) -> &'static str {
    match node_id {
        "graph:graphs" | "graph:neptune" => "g.V().limit(100)",
        "graph:node-labels" => "g.V().label().dedup().limit(100)",
        "graph:relationship-types" => "g.E().label().dedup().limit(100)",
        "graph:procedures" => "GET /loader",
        "graph:security" => "IAM database authentication / SigV4",
        "graph:diagnostics" => "GET /status",
        "node-label:gremlin-labels" => "g.V().label().dedup().limit(100)",
        "node-label:opencypher-labels" => "MATCH (n) RETURN DISTINCT labels(n) LIMIT 100",
        "node-label:sparql-classes" => "SELECT DISTINCT ?class WHERE { ?s a ?class } LIMIT 100",
        "relationship:gremlin-edges" => "g.E().label().dedup().limit(100)",
        "relationship:opencypher-relationships" => {
            "MATCH p=()-[r]->() RETURN DISTINCT type(r) LIMIT 100"
        }
        "relationship:sparql-predicates" => "SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT 100",
        "security:iam-auth" => "IAM database authentication / SigV4",
        "neptune-gremlin" | "neptune-gremlin-vertices" => "g.V().limit(100)",
        "neptune-gremlin-edges" => "g.E().limit(100)",
        "neptune-gremlin-labels" => "g.V().label().dedup().limit(100)",
        "neptune-opencypher" | "neptune-opencypher-nodes" => "MATCH (n) RETURN n LIMIT 100",
        "neptune-opencypher-relationships" => "MATCH p=()-[r]->() RETURN p LIMIT 100",
        "neptune-sparql" | "neptune-sparql-triples" => {
            "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100"
        }
        "neptune-status" => "GET /status",
        _ => "g.V().limit(100)",
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "graph:graphs",
            "Cluster Graph",
            "graphs",
            "Neptune property graph and RDF query surfaces",
            "graph:graphs",
            "g.V().limit(100)",
        ),
        (
            "graph:node-labels",
            "Node Labels",
            "node-labels",
            "Label and class discovery query templates",
            "graph:node-labels",
            "g.V().label().dedup().limit(100)",
        ),
        (
            "graph:relationship-types",
            "Relationship Types",
            "relationship-types",
            "Edge label and RDF predicate discovery templates",
            "graph:relationship-types",
            "g.E().label().dedup().limit(100)",
        ),
        (
            "graph:procedures",
            "Query Languages",
            "procedures",
            "Gremlin, openCypher, SPARQL, loader, explain, and profile entry points",
            "graph:procedures",
            "g.V().limit(100)",
        ),
        (
            "graph:security",
            "IAM / Security",
            "security",
            "IAM authentication, SigV4, and access guidance",
            "graph:security",
            "IAM database authentication / SigV4",
        ),
        (
            "graph:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Cluster status, engine details, and query diagnostics",
            "graph:diagnostics",
            "GET /status",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "graph".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "Amazon Neptune".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

fn graph_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "graph:neptune".into(),
        family: "graph".into(),
        label: connection.database.as_deref().unwrap_or("Neptune").into(),
        kind: "graph".into(),
        detail: "Amazon Neptune cluster graph".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Cluster Graph".into()]),
        query_template: Some("g.V().limit(100)".into()),
        expandable: Some(false),
    }]
}

fn node_label_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "Node Labels",
        [
            (
                "node-label:gremlin-labels",
                "Gremlin Labels",
                "g.V().label().dedup().limit(100)",
            ),
            (
                "node-label:opencypher-labels",
                "openCypher Labels",
                "MATCH (n) RETURN DISTINCT labels(n) LIMIT 100",
            ),
            (
                "node-label:sparql-classes",
                "SPARQL Classes",
                "SELECT DISTINCT ?class WHERE { ?s a ?class } LIMIT 100",
            ),
        ],
    )
}

fn relationship_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "Relationship Types",
        [
            (
                "relationship:gremlin-edges",
                "Gremlin Edge Labels",
                "g.E().label().dedup().limit(100)",
            ),
            (
                "relationship:opencypher-relationships",
                "openCypher Relationships",
                "MATCH p=()-[r]->() RETURN DISTINCT type(r) LIMIT 100",
            ),
            (
                "relationship:sparql-predicates",
                "SPARQL Predicates",
                "SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT 100",
            ),
        ],
    )
}

fn query_language_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        gremlin_template_nodes(connection),
        opencypher_template_nodes(connection),
        sparql_template_nodes(connection),
        diagnostics_template_nodes(connection),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "security:iam-auth".into(),
        family: "graph".into(),
        label: "IAM Authentication".into(),
        kind: "security".into(),
        detail: "SigV4 and IAM database authentication configuration".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "IAM / Security".into()]),
        query_template: Some("IAM database authentication / SigV4".into()),
        expandable: Some(false),
    }]
}

fn gremlin_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "Gremlin",
        [
            ("neptune-gremlin-vertices", "Vertices", "g.V().limit(100)"),
            ("neptune-gremlin-edges", "Edges", "g.E().limit(100)"),
            (
                "neptune-gremlin-labels",
                "Labels",
                "g.V().label().dedup().limit(100)",
            ),
        ],
    )
}

fn opencypher_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "openCypher",
        [
            (
                "neptune-opencypher-nodes",
                "Nodes",
                "MATCH (n) RETURN n LIMIT 100",
            ),
            (
                "neptune-opencypher-relationships",
                "Relationships",
                "MATCH p=()-[r]->() RETURN p LIMIT 100",
            ),
            (
                "neptune-opencypher-labels",
                "Labels",
                "MATCH (n) RETURN DISTINCT labels(n) LIMIT 100",
            ),
        ],
    )
}

fn sparql_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "SPARQL",
        [
            (
                "neptune-sparql-triples",
                "Triples",
                "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100",
            ),
            (
                "neptune-sparql-classes",
                "Classes",
                "SELECT DISTINCT ?class WHERE { ?s a ?class } LIMIT 100",
            ),
            (
                "neptune-sparql-predicates",
                "Predicates",
                "SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT 100",
            ),
        ],
    )
}

fn diagnostics_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    template_nodes(
        connection,
        "Diagnostics",
        [
            ("neptune-status", "Status", "GET /status"),
            (
                "neptune-gremlin-profile",
                "Gremlin Profile",
                "g.V().limit(100).profile()",
            ),
            (
                "neptune-gremlin-explain",
                "Gremlin Explain",
                "g.V().limit(100).explain()",
            ),
        ],
    )
}

fn template_nodes<const N: usize>(
    connection: &ResolvedConnectionProfile,
    group: &str,
    templates: [(&str, &str, &str); N],
) -> Vec<ExplorerNode> {
    templates
        .into_iter()
        .map(|(id, label, query)| ExplorerNode {
            id: id.into(),
            family: "graph".into(),
            label: label.into(),
            kind: if id.starts_with("node-label:") {
                "node-label"
            } else if id.starts_with("relationship:") {
                "relationship"
            } else {
                "procedures"
            }
            .into(),
            detail: format!("Amazon Neptune {group} query template"),
            scope: None,
            path: Some(vec![connection.name.clone(), group.into()]),
            query_template: Some(query.into()),
            expandable: Some(false),
        })
        .collect()
}

async fn enrich_neptune_inspection(connection: &ResolvedConnectionProfile, payload: &mut Value) {
    let status = optional_neptune_json(connection, "/status").await;
    payload["graphs"] = json!([{
        "name": connection.database.as_deref().unwrap_or("neptune"),
        "database": connection.database.as_deref().unwrap_or("-"),
        "nodes": "query Gremlin/openCypher",
        "relationships": "query Gremlin/openCypher",
        "labels": "query label metadata",
        "relationshipTypes": "query edge metadata"
    }]);
    payload["nodeLabels"] = json!([{
        "label": "Vertices",
        "count": "-",
        "properties": "Open a Gremlin or openCypher query to inspect labels and properties",
        "indexedProperties": "-",
        "constraints": "-"
    }]);
    payload["relationshipTypes"] = json!([{
        "type": "Edges",
        "count": "-",
        "from": "-",
        "to": "-",
        "properties": "Open a Gremlin or openCypher query to inspect edge labels"
    }]);
    payload["procedures"] = json!([
        {
            "name": "Gremlin",
            "mode": "read",
            "signature": "g.V()/g.E()",
            "description": "Property graph traversal endpoint",
            "requiresAdmin": "no"
        },
        {
            "name": "openCypher",
            "mode": "read",
            "signature": "MATCH ... RETURN ...",
            "description": "Property graph pattern query endpoint",
            "requiresAdmin": "no"
        },
        {
            "name": "Loader",
            "mode": "admin",
            "signature": "GET /loader",
            "description": "Review bulk loader jobs and import status",
            "requiresAdmin": "yes"
        },
        {
            "name": "SPARQL",
            "mode": "read",
            "signature": "SELECT WHERE",
            "description": "RDF graph query endpoint",
            "requiresAdmin": "no"
        }
    ]);
    payload["security"] = json!([{
        "principal": "IAM",
        "role": "SigV4",
        "privilege": "connection",
        "scope": "cluster",
        "effect": "configured outside Neptune"
    }]);
    payload["diagnostics"] = json!(neptune_diagnostic_records(status.as_ref()));
    if status.is_none() {
        payload["warnings"] = json!([
            "Amazon Neptune status metadata is unavailable from the configured endpoint right now."
        ]);
    }
}

async fn optional_neptune_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = neptune_get(connection, path).await.ok()?;
    parse_neptune_json(&response.body).ok()
}

fn neptune_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    json!({
        "engine": "neptune",
        "nodeId": node_id,
        "objectView": object_view,
        "graphName": connection.database.as_deref().unwrap_or("neptune"),
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
            "value": "status",
            "status": "ready",
            "guidance": "Neptune object views expose query-language entry points and status diagnostics without dumping raw endpoint names."
        }]
    })
}

fn neptune_object_view_kind(node_id: &str) -> &'static str {
    match node_id {
        "graph:graphs" => "graphs",
        "graph:neptune" => "graph",
        "graph:node-labels" => "node-labels",
        "graph:relationship-types" => "relationship-types",
        "graph:procedures" => "procedures",
        "graph:security" | "security:iam-auth" => "security",
        "graph:diagnostics" => "diagnostics",
        id if id.starts_with("node-label:") => "node-label",
        id if id.starts_with("relationship:") => "relationship",
        "neptune-gremlin" | "neptune-opencypher" | "neptune-sparql" => "graph",
        "neptune-gremlin-vertices" | "neptune-opencypher-nodes" | "neptune-sparql-classes" => {
            "node-labels"
        }
        "neptune-gremlin-edges"
        | "neptune-opencypher-relationships"
        | "neptune-sparql-predicates" => "relationship-types",
        "neptune-gremlin-labels" | "neptune-opencypher-labels" => "property-keys",
        "neptune:diagnostics"
        | "neptune-status"
        | "neptune-gremlin-profile"
        | "neptune-gremlin-explain" => "diagnostics",
        _ => "graph",
    }
}

fn neptune_diagnostic_records(status: Option<&Value>) -> Vec<Value> {
    vec![
        json!({
            "signal": "Cluster Status",
            "value": status.and_then(|value| value.get("status")).map(neptune_value_to_display).unwrap_or_else(|| "-".into()),
            "status": if status.is_some() { "ready" } else { "unavailable" },
            "guidance": "Use status to verify the cluster endpoint before running graph traversals."
        }),
        json!({
            "signal": "Engine",
            "value": status.and_then(|value| value.get("dbEngineVersion").or_else(|| value.get("engineVersion"))).map(neptune_value_to_display).unwrap_or_else(|| "-".into()),
            "status": if status.is_some() { "ready" } else { "unavailable" },
            "guidance": "Neptune supports Gremlin, openCypher, and SPARQL surfaces depending on engine version."
        }),
        json!({
            "signal": "Query Cost",
            "value": "bounded traversals",
            "status": "guarded",
            "guidance": "Keep depth, limits, labels, and predicates explicit before running broad graph scans."
        }),
    ]
}

fn neptune_value_to_display(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neptune/explorer_tests.rs"]
mod tests;
