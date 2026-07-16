use std::collections::BTreeMap;

use neo4rs::{
    BoltMap, BoltNode, BoltPath, BoltRelation, BoltType, BoltUnboundedRelation, DeError, Row,
};
use serde_json::{json, Map, Number, Value};

pub(super) fn neo4j_bolt_row(row: &Row) -> Result<(Vec<String>, Vec<Value>), DeError> {
    let fallback = row
        .to_strict::<Value>()
        .unwrap_or_else(|_| Value::Object(Map::new()));
    let typed = row.to_strict::<BTreeMap<String, BoltType>>()?;
    let fallback = fallback.as_object();
    let columns = typed.keys().cloned().collect::<Vec<_>>();
    let values = typed
        .iter()
        .map(|(key, value)| bolt_value(value, fallback.and_then(|map| map.get(key))))
        .collect();
    Ok((columns, values))
}

fn bolt_value(value: &BoltType, fallback: Option<&Value>) -> Value {
    match value {
        BoltType::String(value) => Value::String(value.value.clone()),
        BoltType::Boolean(value) => Value::Bool(value.value),
        BoltType::Null(_) => Value::Null,
        BoltType::Integer(value) => Value::Number(value.value.into()),
        BoltType::Float(value) => Number::from_f64(value.value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        BoltType::List(value) => {
            let fallback = fallback.and_then(Value::as_array);
            Value::Array(
                value
                    .value
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        bolt_value(item, fallback.and_then(|items| items.get(index)))
                    })
                    .collect(),
            )
        }
        BoltType::Map(value) => bolt_map(value, fallback),
        BoltType::Node(value) => bolt_node(value),
        BoltType::Relation(value) => bolt_relation(value),
        BoltType::UnboundedRelation(value) => bolt_unbounded_relation(value),
        BoltType::Path(value) => bolt_path(value),
        _ => fallback
            .cloned()
            .unwrap_or_else(|| Value::String(format!("{value:?}"))),
    }
}

fn bolt_map(value: &BoltMap, fallback: Option<&Value>) -> Value {
    let fallback = fallback.and_then(Value::as_object);
    let mut entries = value.value.iter().collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.value.cmp(&right.0.value));
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| {
                (
                    key.value.clone(),
                    bolt_value(value, fallback.and_then(|map| map.get(&key.value))),
                )
            })
            .collect(),
    )
}

fn bolt_node(value: &BoltNode) -> Value {
    let labels = value
        .labels
        .value
        .iter()
        .filter_map(|label| match label {
            BoltType::String(label) => Some(Value::String(label.value.clone())),
            _ => None,
        })
        .collect::<Vec<_>>();
    json!({
        "id": value.id.value.to_string(),
        "labels": labels,
        "properties": bolt_map(&value.properties, None),
    })
}

fn bolt_relation(value: &BoltRelation) -> Value {
    json!({
        "id": value.id.value.to_string(),
        "startNode": value.start_node_id.value.to_string(),
        "endNode": value.end_node_id.value.to_string(),
        "type": value.typ.value,
        "properties": bolt_map(&value.properties, None),
    })
}

fn bolt_unbounded_relation(value: &BoltUnboundedRelation) -> Value {
    json!({
        "id": value.id.value.to_string(),
        "type": value.typ.value,
        "properties": bolt_map(&value.properties, None),
    })
}

fn bolt_path(value: &BoltPath) -> Value {
    let nodes = value.nodes();
    let relationships = path_relationships(value, &nodes);
    json!({
        "nodes": nodes.iter().map(bolt_node).collect::<Vec<_>>(),
        "relationships": relationships,
    })
}

fn path_relationships(value: &BoltPath, nodes: &[BoltNode]) -> Vec<Value> {
    let relationships = value.rels();
    let indices = value.indices();
    let mut current_node_index = 0_usize;
    let mut normalized = Vec::new();

    for step in indices.chunks_exact(2) {
        let relationship_offset = step[0].value;
        let Ok(relationship_index) = usize::try_from(relationship_offset.unsigned_abs()) else {
            continue;
        };
        let Some(relationship_index) = relationship_index.checked_sub(1) else {
            continue;
        };
        let Ok(next_node_index) = usize::try_from(step[1].value) else {
            continue;
        };
        let (Some(relationship), Some(current), Some(next)) = (
            relationships.get(relationship_index),
            nodes.get(current_node_index),
            nodes.get(next_node_index),
        ) else {
            continue;
        };
        let (from, to) = if relationship_offset.is_positive() {
            (&current.id, &next.id)
        } else {
            (&next.id, &current.id)
        };
        normalized.push(json!({
            "id": relationship.id.value.to_string(),
            "startNode": from.value.to_string(),
            "endNode": to.value.to_string(),
            "type": relationship.typ.value,
            "properties": bolt_map(&relationship.properties, None),
        }));
        current_node_index = next_node_index;
    }

    normalized
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neo4j/bolt_results_tests.rs"]
mod tests;
