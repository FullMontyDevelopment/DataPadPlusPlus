use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

pub(crate) const GRAPH_VISUAL_NODE_CAP: usize = 10_000;
pub(crate) const GRAPH_VISUAL_EDGE_CAP: usize = 25_000;

#[derive(Debug, Clone)]
pub(crate) struct NormalizedGraphPayload {
    pub(crate) nodes: Value,
    pub(crate) edges: Value,
    pub(crate) node_count: usize,
    pub(crate) edge_count: usize,
    pub(crate) node_cap: usize,
    pub(crate) edge_cap: usize,
    pub(crate) truncated: bool,
    pub(crate) warnings: Vec<String>,
}

impl NormalizedGraphPayload {
    pub(crate) fn metadata(&self, engine: &str, language: &str) -> Value {
        json!({
            "engine": engine,
            "language": language,
            "nodeCount": self.node_count,
            "edgeCount": self.edge_count,
            "visualNodeCap": self.node_cap,
            "visualEdgeCap": self.edge_cap,
            "truncated": self.truncated,
            "warnings": self.warnings,
        })
    }

    pub(crate) fn into_parts(self) -> (Value, Value) {
        (self.nodes, self.edges)
    }
}

pub(crate) struct GraphCollector {
    nodes: Vec<Value>,
    edges: Vec<Value>,
    node_ids: BTreeSet<String>,
    edge_ids: BTreeSet<String>,
    node_cap: usize,
    edge_cap: usize,
    truncated: bool,
    warnings: Vec<String>,
}

impl GraphCollector {
    pub(crate) fn new(row_limit: u32) -> Self {
        let bound = graph_item_bound(row_limit);
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            node_ids: BTreeSet::new(),
            edge_ids: BTreeSet::new(),
            node_cap: bound.min(GRAPH_VISUAL_NODE_CAP),
            edge_cap: bound.min(GRAPH_VISUAL_EDGE_CAP),
            truncated: false,
            warnings: Vec::new(),
        }
    }

    pub(crate) fn add_warning(&mut self, warning: impl Into<String>) {
        self.warnings.push(warning.into());
    }

    pub(crate) fn add_node(
        &mut self,
        id: String,
        label: String,
        kind: Option<String>,
        properties: Map<String, Value>,
        raw: Value,
    ) {
        if !self.node_ids.insert(id.clone()) {
            return;
        }

        if self.nodes.len() >= self.node_cap {
            self.truncated = true;
            return;
        }

        let mut node = Map::new();
        node.insert("id".into(), Value::String(id));
        node.insert("label".into(), Value::String(label));
        if let Some(kind) = kind.filter(|value| !value.trim().is_empty()) {
            node.insert("kind".into(), Value::String(kind));
        }
        if !properties.is_empty() {
            node.insert("properties".into(), Value::Object(properties));
        }
        node.insert("raw".into(), raw);
        self.nodes.push(Value::Object(node));
    }

    pub(crate) fn add_edge(
        &mut self,
        id: String,
        from: String,
        to: String,
        label: Option<String>,
        kind: Option<String>,
        properties: Map<String, Value>,
        raw: Value,
    ) {
        if from.trim().is_empty() || to.trim().is_empty() {
            self.truncated = true;
            self.add_warning(
                "An edge was omitted because its endpoints were not visible in the result payload.",
            );
            return;
        }
        if !self.edge_ids.insert(id.clone()) {
            return;
        }

        if self.edges.len() >= self.edge_cap {
            self.truncated = true;
            return;
        }

        let mut edge = Map::new();
        edge.insert("id".into(), Value::String(id));
        edge.insert("from".into(), Value::String(from));
        edge.insert("to".into(), Value::String(to));
        if let Some(label) = label.filter(|value| !value.trim().is_empty()) {
            edge.insert("label".into(), Value::String(label));
        }
        if let Some(kind) = kind.filter(|value| !value.trim().is_empty()) {
            edge.insert("kind".into(), Value::String(kind));
        }
        if !properties.is_empty() {
            edge.insert("properties".into(), Value::Object(properties));
        }
        edge.insert("raw".into(), raw);
        self.edges.push(Value::Object(edge));
    }

    pub(crate) fn finish(self) -> Option<NormalizedGraphPayload> {
        if self.nodes.is_empty() && self.edges.is_empty() {
            return None;
        }

        Some(NormalizedGraphPayload {
            nodes: Value::Array(self.nodes),
            edges: Value::Array(self.edges),
            node_count: self.node_ids.len(),
            edge_count: self.edge_ids.len(),
            node_cap: self.node_cap,
            edge_cap: self.edge_cap,
            truncated: self.truncated,
            warnings: self.warnings,
        })
    }
}

pub(crate) fn collect_neo4j_node(collector: &mut GraphCollector, value: &Value) {
    let Some(object) = value.as_object() else {
        return;
    };
    let id = graph_string(object.get("id")).unwrap_or_else(|| value.to_string());
    let labels = object
        .get("labels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|label| graph_string(Some(label)))
        .collect::<Vec<_>>();
    let kind = labels.first().cloned();
    let label = kind
        .clone()
        .or_else(|| property_label(object.get("properties")))
        .unwrap_or_else(|| id.clone());
    let properties = properties_from_field(object.get("properties"));
    collector.add_node(id, label, kind, properties, value.clone());
}

pub(crate) fn collect_neo4j_relationship(collector: &mut GraphCollector, value: &Value) {
    let Some(object) = value.as_object() else {
        return;
    };
    let id = graph_string(object.get("id")).unwrap_or_else(|| value.to_string());
    let from = graph_string(object.get("startNode")).unwrap_or_default();
    let to = graph_string(object.get("endNode")).unwrap_or_default();
    let label = graph_string(object.get("type")).or_else(|| graph_string(object.get("label")));
    let properties = properties_from_field(object.get("properties"));
    collector.add_edge(
        id,
        from,
        to,
        label.clone(),
        label,
        properties,
        value.clone(),
    );
}

pub(crate) fn collect_arango_item(collector: &mut GraphCollector, value: &Value) {
    let Some(object) = value.as_object() else {
        return;
    };
    if object.get("_from").is_some() && object.get("_to").is_some() {
        let id = graph_string(object.get("_id"))
            .or_else(|| graph_string(object.get("_key")))
            .unwrap_or_else(|| value.to_string());
        let from = graph_string(object.get("_from")).unwrap_or_default();
        let to = graph_string(object.get("_to")).unwrap_or_default();
        let kind = arango_collection(&id);
        let properties = properties_except(value, &["_id", "_key", "_rev", "_from", "_to"]);
        collector.add_edge(id, from, to, kind.clone(), kind, properties, value.clone());
        return;
    }

    if object.get("_id").is_some() || object.get("_key").is_some() {
        let id = graph_string(object.get("_id"))
            .or_else(|| graph_string(object.get("_key")))
            .unwrap_or_else(|| value.to_string());
        let kind = arango_collection(&id);
        let label = property_label(Some(value)).unwrap_or_else(|| id.clone());
        let properties = properties_except(value, &["_id", "_key", "_rev"]);
        collector.add_node(id, label, kind, properties, value.clone());
    }
}

pub(crate) fn collect_gremlin_graph_items(collector: &mut GraphCollector, value: &Value) {
    if collect_gremlin_edge(collector, value) || collect_gremlin_vertex(collector, value) {
        return;
    }

    match value {
        Value::Array(items) => {
            for item in items {
                collect_gremlin_graph_items(collector, item);
            }
        }
        Value::Object(map) => {
            if let Some(inner) = map.get("@value") {
                collect_gremlin_graph_items(collector, inner);
                return;
            }
            for item in map.values() {
                collect_gremlin_graph_items(collector, item);
            }
        }
        _ => {}
    }
}

pub(crate) fn sparql_graph_payload(
    bindings: &[Value],
    row_limit: u32,
) -> Option<NormalizedGraphPayload> {
    let mut collector = GraphCollector::new(row_limit);
    for (index, binding) in bindings.iter().enumerate() {
        let Some(object) = binding.as_object() else {
            continue;
        };
        let subject = binding_value(object, &["s", "subject", "source", "from"]);
        let predicate = binding_value(object, &["p", "predicate", "edge", "relationship"]);
        let object_value = binding_value(object, &["o", "object", "target", "to"]);
        let Some(subject) = subject else {
            continue;
        };
        let Some(predicate) = predicate else {
            continue;
        };
        let Some(object_id) = object_value else {
            continue;
        };

        collector.add_node(
            subject.clone(),
            rdf_label(&subject),
            Some("resource".into()),
            Map::new(),
            binding
                .get("s")
                .or_else(|| binding.get("subject"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        collector.add_node(
            object_id.clone(),
            rdf_label(&object_id),
            Some(
                binding_type(object, &["o", "object", "target", "to"])
                    .unwrap_or("resource")
                    .into(),
            ),
            Map::new(),
            binding
                .get("o")
                .or_else(|| binding.get("object"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        collector.add_edge(
            format!("{subject}->{predicate}->{object_id}:{index}"),
            subject,
            object_id,
            Some(predicate.clone()),
            Some("rdf-triple".into()),
            Map::new(),
            binding.clone(),
        );
    }
    collector.finish()
}

fn collect_gremlin_vertex(collector: &mut GraphCollector, value: &Value) -> bool {
    let Some(object) = graph_object(value) else {
        return false;
    };
    let is_vertex = object
        .get("@type")
        .and_then(Value::as_str)
        .is_some_and(|value| value.eq_ignore_ascii_case("g:Vertex"))
        || object.contains_key("properties")
            && object.contains_key("id")
            && object.contains_key("label");
    if !is_vertex {
        return false;
    }

    let id = graph_string(object.get("id")).unwrap_or_else(|| value.to_string());
    let kind = graph_string(object.get("label"));
    let label = property_label(object.get("properties"))
        .or_else(|| kind.clone())
        .unwrap_or_else(|| id.clone());
    let properties = properties_from_field(object.get("properties"));
    collector.add_node(id, label, kind, properties, value.clone());
    true
}

fn collect_gremlin_edge(collector: &mut GraphCollector, value: &Value) -> bool {
    let Some(object) = graph_object(value) else {
        return false;
    };
    let is_edge = object
        .get("@type")
        .and_then(Value::as_str)
        .is_some_and(|value| value.eq_ignore_ascii_case("g:Edge"))
        || object.contains_key("id")
            && object.contains_key("label")
            && (object.contains_key("inV")
                || object.contains_key("outV")
                || object.contains_key("inVertex")
                || object.contains_key("outVertex"));
    if !is_edge {
        return false;
    }

    let id = graph_string(object.get("id")).unwrap_or_else(|| value.to_string());
    let from =
        endpoint_string(object, &["outV", "outVertex", "source", "from"]).unwrap_or_default();
    let to = endpoint_string(object, &["inV", "inVertex", "target", "to"]).unwrap_or_default();
    let label = graph_string(object.get("label"));
    let properties = properties_from_field(object.get("properties"));
    collector.add_edge(
        id,
        from,
        to,
        label.clone(),
        label,
        properties,
        value.clone(),
    );
    true
}

fn graph_item_bound(row_limit: u32) -> usize {
    (row_limit as usize)
        .saturating_mul(4)
        .max(row_limit as usize)
        .max(1)
}

fn graph_object(value: &Value) -> Option<&Map<String, Value>> {
    let object = value.as_object()?;
    if let Some(inner) = object.get("@value").and_then(Value::as_object) {
        return Some(inner);
    }
    Some(object)
}

fn graph_string(value: Option<&Value>) -> Option<String> {
    let value = unwrap_graphson(value?)?;
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Object(object) => object
            .get("id")
            .and_then(|value| graph_string(Some(value)))
            .or_else(|| {
                object
                    .get("@value")
                    .and_then(|value| graph_string(Some(value)))
            }),
        _ => None,
    }
}

fn unwrap_graphson(value: &Value) -> Option<&Value> {
    if let Some(object) = value.as_object() {
        if let Some(inner) = object.get("@value") {
            return unwrap_graphson(inner);
        }
    }
    Some(value)
}

fn properties_from_field(value: Option<&Value>) -> Map<String, Value> {
    let mut properties = Map::new();
    let Some(value) = value.and_then(unwrap_graphson) else {
        return properties;
    };
    let Some(object) = value.as_object() else {
        return properties;
    };

    for (key, value) in object {
        properties.insert(key.clone(), normalize_property_value(value));
    }
    properties
}

fn properties_except(value: &Value, excluded: &[&str]) -> Map<String, Value> {
    let mut properties = Map::new();
    let Some(object) = value.as_object() else {
        return properties;
    };
    for (key, value) in object {
        if excluded.iter().any(|excluded_key| excluded_key == key) {
            continue;
        }
        properties.insert(key.clone(), normalize_property_value(value));
    }
    properties
}

fn normalize_property_value(value: &Value) -> Value {
    let value = unwrap_graphson(value).unwrap_or(value);
    if let Some(items) = value.as_array() {
        let normalized = items
            .iter()
            .map(normalize_property_value)
            .collect::<Vec<_>>();
        if normalized.len() == 1 {
            return normalized.into_iter().next().unwrap_or(Value::Null);
        }
        return Value::Array(normalized);
    }
    if let Some(object) = value.as_object() {
        if let Some(inner) = object.get("value") {
            return normalize_property_value(inner);
        }
        let mut normalized = Map::new();
        for (key, value) in object {
            normalized.insert(key.clone(), normalize_property_value(value));
        }
        return Value::Object(normalized);
    }
    value.clone()
}

fn property_label(value: Option<&Value>) -> Option<String> {
    let object = value.and_then(unwrap_graphson).and_then(Value::as_object)?;
    for key in ["name", "title", "label", "id", "_key"] {
        if let Some(label) = object.get(key).and_then(|value| graph_string(Some(value))) {
            if !label.trim().is_empty() {
                return Some(label);
            }
        }
    }
    None
}

fn endpoint_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = object.get(*key).and_then(|value| graph_string(Some(value))) {
            return Some(value);
        }
    }
    None
}

fn arango_collection(id: &str) -> Option<String> {
    id.split_once('/')
        .map(|(collection, _)| collection.to_string())
        .filter(|value| !value.trim().is_empty())
}

fn binding_value(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = object
            .get(*key)
            .and_then(Value::as_object)
            .and_then(|binding| binding.get("value"))
            .and_then(|value| graph_string(Some(value)))
        {
            return Some(value);
        }
    }
    None
}

fn binding_type<'a>(object: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_object)
            .and_then(|binding| binding.get("type"))
            .and_then(Value::as_str)
    })
}

fn rdf_label(value: &str) -> String {
    value
        .rsplit(['/', '#', ':'])
        .next()
        .filter(|label| !label.trim().is_empty())
        .unwrap_or(value)
        .to_string()
}
