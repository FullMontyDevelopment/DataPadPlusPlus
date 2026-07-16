use serde_json::Value;

use super::super::super::*;
use super::connection::arango_get;

pub(super) async fn load_arango_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let collections = arango_get(connection, "/_api/collection?excludeSystem=true")
        .await
        .ok()
        .and_then(|response| serde_json::from_str::<Value>(&response.body).ok())
        .and_then(|value| value.get("result").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let graphs = arango_get(connection, "/_api/gharial")
        .await
        .ok()
        .and_then(|response| serde_json::from_str::<Value>(&response.body).ok())
        .and_then(|value| value.get("graphs").and_then(Value::as_array).cloned())
        .unwrap_or_default();

    let labels = collections
        .iter()
        .filter_map(|collection| Some((collection.get("name")?.as_str()?.to_string(), Vec::new())))
        .collect();
    let mut relationships = Vec::new();
    for graph in graphs {
        for definition in graph
            .get("edgeDefinitions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(edge_collection) = definition.get("collection").and_then(Value::as_str) else {
                continue;
            };
            for from in definition
                .get("from")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                for to in definition
                    .get("to")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    relationships.push((
                        edge_collection.to_string(),
                        from.to_string(),
                        to.to_string(),
                    ));
                }
            }
        }
    }

    Ok(make_graph_structure_response(
        request,
        connection,
        labels,
        relationships,
        false,
    ))
}
