use serde_json::json;

use super::super::super::*;
use super::catalog::neptune_execution_capabilities;

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

pub(super) fn inspect_neptune_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let query_template = match request.node_id.as_str() {
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
    };

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Amazon Neptune query template ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template.into()),
        payload: Some(json!({
            "engine": "neptune",
            "nodeId": request.node_id,
            "api": ["/status", "/gremlin", "/openCypher", "/sparql"]
        })),
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

#[cfg(test)]
mod tests {
    use super::inspect_neptune_explorer_node;
    use crate::domain::models::{ExplorerInspectRequest, ResolvedConnectionProfile};

    #[test]
    fn neptune_sparql_template_uses_sparql_query() {
        let connection = ResolvedConnectionProfile {
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
            read_only: true,
        };
        let request = ExplorerInspectRequest {
            connection_id: connection.id.clone(),
            environment_id: "env".into(),
            node_id: "neptune-sparql-triples".into(),
        };

        let response = inspect_neptune_explorer_node(&connection, &request);
        assert_eq!(
            response.query_template.as_deref(),
            Some("SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100")
        );
    }
}
