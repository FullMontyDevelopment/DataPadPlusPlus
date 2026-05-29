use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::neptune_execution_capabilities;
use super::connection::{neptune_get, parse_neptune_json};

pub(super) async fn list_neptune_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
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
            "neptune-gremlin",
            "Gremlin",
            "gremlin",
            "Property graph traversal templates",
            "neptune:gremlin",
            "g.V().limit(100)",
        ),
        (
            "neptune-opencypher",
            "openCypher",
            "opencypher",
            "openCypher pattern query templates",
            "neptune:opencypher",
            "MATCH (n) RETURN n LIMIT 100",
        ),
        (
            "neptune-sparql",
            "SPARQL",
            "sparql",
            "RDF graph query templates",
            "neptune:sparql",
            "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100",
        ),
        (
            "neptune-status",
            "Diagnostics",
            "diagnostics",
            "Cluster status, engine details, and query diagnostics",
            "neptune:diagnostics",
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
            kind: "query-template".into(),
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
            "name": "SPARQL",
            "mode": "read",
            "signature": "SELECT WHERE",
            "description": "RDF graph query endpoint",
            "requiresAdmin": "no"
        }
    ]);
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
mod tests {
    use super::{
        neptune_base_payload, neptune_diagnostic_records, neptune_object_view_kind,
        neptune_query_template,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn neptune_sparql_template_uses_sparql_query() {
        assert_eq!(
            neptune_query_template("neptune-sparql-triples"),
            "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100"
        );
    }

    #[test]
    fn neptune_inspection_payload_is_view_friendly_without_raw_api_dump() {
        let payload = neptune_base_payload(&connection(), "neptune-gremlin", "graph");

        assert_eq!(payload["objectView"], "graph");
        assert!(payload.get("api").is_none());
        assert!(payload["graphs"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn neptune_node_ids_map_to_graph_object_views() {
        assert_eq!(neptune_object_view_kind("neptune-gremlin"), "graph");
        assert_eq!(
            neptune_object_view_kind("neptune-opencypher-nodes"),
            "node-labels"
        );
        assert_eq!(
            neptune_object_view_kind("neptune-gremlin-edges"),
            "relationship-types"
        );
        assert_eq!(neptune_object_view_kind("neptune-status"), "diagnostics");
    }

    #[test]
    fn neptune_status_records_are_normalized_for_object_view() {
        let rows = neptune_diagnostic_records(Some(&serde_json::json!({
            "status": "healthy",
            "dbEngineVersion": "1.3.2.0"
        })));

        assert_eq!(rows[0]["signal"], "Cluster Status");
        assert_eq!(rows[0]["value"], "healthy");
        assert_eq!(rows[1]["value"], "1.3.2.0");
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-neptune".into(),
            name: "Neptune".into(),
            engine: "neptune".into(),
            family: "graph".into(),
            host: "127.0.0.1".into(),
            port: Some(8182),
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
