use serde_json::Value;

use super::super::super::*;
use super::connection::neo4j_run_cypher;

pub(super) async fn load_neo4j_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let labels_value = neo4j_run_cypher(
        connection,
        "CALL db.schema.nodeTypeProperties() YIELD nodeLabels, propertyName UNWIND nodeLabels AS label RETURN label, collect(DISTINCT propertyName) AS properties ORDER BY label",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "results": [{ "data": [] }] }));
    let relationships_value = neo4j_run_cypher(
        connection,
        "MATCH (a)-[r]->(b) WITH a, r, b LIMIT 4000 UNWIND labels(a) AS fromLabel UNWIND labels(b) AS toLabel RETURN DISTINCT type(r) AS relationshipType, fromLabel, toLabel",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "results": [{ "data": [] }] }));

    let labels = neo4j_rows(&labels_value)
        .into_iter()
        .filter_map(|row| {
            let label = row.first()?.as_str()?.to_string();
            let properties = row
                .get(1)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            Some((label, properties))
        })
        .collect();
    let relationships = neo4j_rows(&relationships_value)
        .into_iter()
        .filter_map(|row| {
            Some((
                row.first()?.as_str()?.to_string(),
                row.get(1)?.as_str()?.to_string(),
                row.get(2)?.as_str()?.to_string(),
            ))
        })
        .collect();

    Ok(make_graph_structure_response(
        request,
        connection,
        labels,
        relationships,
        false,
    ))
}

fn neo4j_rows(value: &Value) -> Vec<Vec<Value>> {
    value
        .pointer("/results/0/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("row").and_then(Value::as_array).cloned())
        .collect()
}
