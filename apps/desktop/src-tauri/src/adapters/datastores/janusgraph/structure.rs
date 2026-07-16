use std::collections::BTreeMap;

use serde_json::Value;

use super::super::super::*;
use super::connection::janusgraph_run_gremlin;

pub(super) async fn load_janusgraph_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let property_value = janusgraph_run_gremlin(
        connection,
        "g.V().group().by(label).by(properties().key().dedup().fold()).next()",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "result": { "data": [] } }));
    let relationship_value = janusgraph_run_gremlin(
        connection,
        "g.E().limit(4000).project('type','from','to').by(label).by(outV().label()).by(inV().label()).dedup().toList()",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "result": { "data": [] } }));

    let mut labels = BTreeMap::<String, Vec<String>>::new();
    for item in gremlin_data(&property_value) {
        let Some(object) = item.as_object() else {
            continue;
        };
        for (label, properties) in object {
            labels.insert(
                label.clone(),
                properties
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
            );
        }
    }
    let relationships = gremlin_data(&relationship_value)
        .into_iter()
        .filter_map(|item| {
            Some((
                item.get("type")?.as_str()?.to_string(),
                item.get("from")?.as_str()?.to_string(),
                item.get("to")?.as_str()?.to_string(),
            ))
        })
        .collect();

    Ok(make_graph_structure_response(
        request,
        connection,
        labels.into_iter().collect(),
        relationships,
        false,
    ))
}

fn gremlin_data(value: &Value) -> Vec<Value> {
    value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
