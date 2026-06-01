mod cql;
mod inspect;
mod tree;

use super::super::super::*;
use super::catalog::cassandra_execution_capabilities;

pub(super) use inspect::inspect_cassandra_explorer_node;

pub(super) async fn list_cassandra_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = tree::nodes_for_scope(connection, request.scope.as_deref());

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Cassandra explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: cassandra_execution_capabilities(),
        nodes,
    })
}
