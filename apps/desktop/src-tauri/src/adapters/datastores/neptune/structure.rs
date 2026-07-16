use std::collections::BTreeMap;

use serde_json::Value;

use super::super::super::*;
use super::query::execute_neptune_metadata;

pub(super) async fn load_neptune_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let property_value = execute_neptune_metadata(
        connection,
        "gremlin",
        "g.V().group().by(label).by(properties().key().dedup().fold()).next()",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "result": { "data": [] } }));
    let relationship_value = execute_neptune_metadata(
        connection,
        "gremlin",
        "g.E().limit(4000).project('type','from','to').by(label).by(outV().label()).by(inV().label()).dedup().toList()",
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "result": { "data": [] } }));

    Ok(make_graph_structure_response(
        request,
        connection,
        graph_labels(&property_value),
        graph_relationships(&relationship_value),
        false,
    ))
}

fn graph_labels(value: &Value) -> Vec<(String, Vec<String>)> {
    let mut labels = BTreeMap::<String, Vec<String>>::new();
    for item in gremlin_data(value) {
        let Some(object) = item.as_object() else {
            continue;
        };
        for (label, properties) in object {
            let entry = labels.entry(label.clone()).or_default();
            entry.extend(
                properties
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string),
            );
            entry.sort();
            entry.dedup();
        }
    }
    labels.into_iter().collect()
}

fn graph_relationships(value: &Value) -> Vec<(String, String, String)> {
    gremlin_data(value)
        .into_iter()
        .filter_map(|item| {
            Some((
                item.get("type")?.as_str()?.to_string(),
                item.get("from")?.as_str()?.to_string(),
                item.get("to")?.as_str()?.to_string(),
            ))
        })
        .collect()
}

fn gremlin_data(value: &Value) -> Vec<Value> {
    value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
