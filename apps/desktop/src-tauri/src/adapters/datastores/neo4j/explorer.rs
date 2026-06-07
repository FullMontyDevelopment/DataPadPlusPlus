use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::neo4j_execution_capabilities;
use super::connection::neo4j_run_cypher;

pub(super) async fn list_neo4j_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("graph:graphs") => graph_nodes(connection),
        Some("neo4j:labels" | "graph:node-labels") => {
            query_value_nodes(
                connection,
                request.limit,
                "CALL db.labels() YIELD label RETURN label ORDER BY label",
                "label",
            )
            .await?
        }
        Some("neo4j:relationships" | "graph:relationship-types") => {
            query_value_nodes(
                connection,
                request.limit,
                "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType",
                "relationship",
            )
            .await?
        }
        Some("neo4j:indexes" | "graph:indexes") => {
            query_value_nodes(
                connection,
                request.limit,
                "SHOW INDEXES YIELD name RETURN name ORDER BY name",
                "index",
            )
            .await?
        }
        Some("neo4j:constraints" | "graph:constraints") => {
            query_value_nodes(
                connection,
                request.limit,
                "SHOW CONSTRAINTS YIELD name RETURN name ORDER BY name",
                "constraint",
            )
            .await?
        }
        Some("neo4j:property-keys" | "graph:property-keys") => {
            query_value_nodes(
                connection,
                request.limit,
                "CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey",
                "property-key",
            )
            .await?
        }
        Some("neo4j:procedures" | "graph:procedures") => {
            query_value_nodes(
                connection,
                request.limit,
                "SHOW PROCEDURES YIELD name RETURN name ORDER BY name",
                "procedure",
            )
            .await?
        }
        Some("graph:security") => security_nodes(connection).await?,
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Neo4j explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: neo4j_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_neo4j_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = request
        .node_id
        .strip_prefix("neo4j-label:")
        .or_else(|| request.node_id.strip_prefix("node-label:"))
        .map(|label| format!("MATCH (n:{}) RETURN n LIMIT 100", quote_cypher_identifier(label)))
        .or_else(|| {
            request
                .node_id
                .strip_prefix("neo4j-relationship:")
                .or_else(|| request.node_id.strip_prefix("relationship:"))
                .map(|rel| {
                    format!(
                        "MATCH p=()-[r:{}]->() RETURN p LIMIT 100",
                        quote_cypher_identifier(rel)
                    )
                })
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "graph:graphs" => format!(
                "USE {} MATCH (n) RETURN n LIMIT 100",
                quote_cypher_identifier(connection.database.as_deref().unwrap_or("neo4j"))
            ),
            "neo4j-labels" | "graph:node-labels" => "CALL db.labels() YIELD label RETURN label ORDER BY label".into(),
            "neo4j-relationships" | "graph:relationship-types" => {
                "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType".into()
            }
            "neo4j-indexes" | "graph:indexes" => "SHOW INDEXES YIELD name, type, entityType RETURN name, type, entityType ORDER BY name".into(),
            "neo4j-constraints" | "graph:constraints" => "SHOW CONSTRAINTS YIELD name, type RETURN name, type ORDER BY name".into(),
            "neo4j-property-keys" | "graph:property-keys" => "CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey".into(),
            "neo4j-procedures" | "graph:procedures" => "SHOW PROCEDURES YIELD name, mode, signature, description RETURN name, mode, signature, description ORDER BY name".into(),
            "graph:security" => "SHOW USERS YIELD user RETURN user ORDER BY user".into(),
            "neo4j-diagnostics" | "graph:diagnostics" => "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition".into(),
            _ => "MATCH (n) RETURN n LIMIT 100".into(),
        });
    let object_view = neo4j_object_view_kind(&request.node_id);
    let mut payload = neo4j_base_payload(connection, &request.node_id, object_view);
    enrich_neo4j_inspection(connection, &request.node_id, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!("Neo4j {} view ready for {}.", object_view, connection.name),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "graph:graphs",
            "Databases",
            "graphs",
            "Neo4j databases and graph workspaces",
            "graph:graphs",
            "SHOW DATABASES YIELD name RETURN name ORDER BY name",
        ),
        (
            "graph:node-labels",
            "Node Labels",
            "node-labels",
            "Node labels and label-scoped match templates",
            "graph:node-labels",
            "CALL db.labels() YIELD label RETURN label ORDER BY label",
        ),
        (
            "graph:relationship-types",
            "Relationship Types",
            "relationship-types",
            "Relationship types and path query templates",
            "graph:relationship-types",
            "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType",
        ),
        (
            "graph:property-keys",
            "Property Keys",
            "property-keys",
            "Property names exposed by node and relationship metadata",
            "graph:property-keys",
            "CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey",
        ),
        (
            "graph:indexes",
            "Indexes",
            "indexes",
            "Schema indexes",
            "graph:indexes",
            "SHOW INDEXES YIELD name, type, entityType RETURN name, type, entityType ORDER BY name",
        ),
        (
            "graph:constraints",
            "Constraints",
            "constraints",
            "Schema constraints",
            "graph:constraints",
            "SHOW CONSTRAINTS YIELD name, type RETURN name, type ORDER BY name",
        ),
        (
            "graph:procedures",
            "Procedures",
            "procedures",
            "Visible procedures, signatures, modes, and permission requirements",
            "graph:procedures",
            "SHOW PROCEDURES YIELD name, mode, signature, description RETURN name, mode, signature, description ORDER BY name",
        ),
        (
            "graph:security",
            "Security",
            "security",
            "Visible users, roles, and graph privileges",
            "graph:security",
            "SHOW USERS YIELD user RETURN user ORDER BY user",
        ),
        (
            "graph:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Components, schema health, and query planning guidance",
            "graph:diagnostics",
            "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition",
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
        path: Some(vec![connection.name.clone(), "Neo4j".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

fn graph_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let graph = connection.database.as_deref().unwrap_or("neo4j");
    vec![ExplorerNode {
        id: format!("graph:{graph}"),
        family: "graph".into(),
        label: graph.into(),
        kind: "graph".into(),
        detail: "Neo4j database graph".into(),
        scope: Some(format!("graph:{graph}")),
        path: Some(vec![connection.name.clone(), "Databases".into()]),
        query_template: Some(format!(
            "USE {} MATCH (n) RETURN n LIMIT 100",
            quote_cypher_identifier(graph)
        )),
        expandable: Some(false),
    }]
}

async fn security_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Ok(value) = neo4j_run_cypher(
        connection,
        "SHOW USERS YIELD user RETURN user ORDER BY user",
    )
    .await
    else {
        return Ok(Vec::new());
    };

    Ok(first_column_values(&value)
        .into_iter()
        .map(|user| ExplorerNode {
            id: format!("security:{user}"),
            family: "graph".into(),
            label: user,
            kind: "security".into(),
            detail: "Neo4j user".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Security".into()]),
            query_template: Some("SHOW USERS YIELD user RETURN user ORDER BY user".into()),
            expandable: Some(false),
        })
        .collect())
}

async fn query_value_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
    query: &str,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = neo4j_run_cypher(connection, query).await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(first_column_values(&value)
        .into_iter()
        .take(limit)
        .map(|label| {
            let node_id = match kind {
                "label" => format!("node-label:{label}"),
                "relationship" => format!("relationship:{label}"),
                "property-key" => format!("property-key:{label}"),
                "index" => format!("index:{label}"),
                "constraint" => format!("constraint:{label}"),
                "procedure" => format!("procedure:{label}"),
                _ => format!("{kind}:{label}"),
            };
            ExplorerNode {
                id: node_id,
                family: "graph".into(),
                label: label.clone(),
                kind: kind.into(),
                detail: format!("Neo4j {kind}"),
                scope: None,
                path: Some(vec![connection.name.clone(), kind.into()]),
                query_template: Some(match kind {
                    "label" => format!(
                        "MATCH (n:{}) RETURN n LIMIT 100",
                        quote_cypher_identifier(&label)
                    ),
                    "relationship" => format!(
                        "MATCH p=()-[r:{}]->() RETURN p LIMIT 100",
                        quote_cypher_identifier(&label)
                    ),
                    _ => query.into(),
                }),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn enrich_neo4j_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) {
    let labels = optional_neo4j_query(
        connection,
        "CALL db.labels() YIELD label RETURN label ORDER BY label",
    )
    .await;
    let relationships = optional_neo4j_query(
        connection,
        "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType",
    )
    .await;
    let property_keys = optional_neo4j_query(
        connection,
        "CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey",
    )
    .await;
    let indexes = optional_neo4j_query(
        connection,
        "SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state, provider RETURN name, type, entityType, labelsOrTypes, properties, state, provider ORDER BY name",
    )
    .await;
    let constraints = optional_neo4j_query(
        connection,
        "SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties, ownedIndex RETURN name, type, entityType, labelsOrTypes, properties, ownedIndex ORDER BY name",
    )
    .await;
    let procedures = optional_neo4j_query(
        connection,
        "SHOW PROCEDURES YIELD name, mode, signature, description, admin RETURN name, mode, signature, description, admin ORDER BY name LIMIT 100",
    )
    .await;
    let components = optional_neo4j_query(
        connection,
        "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition",
    )
    .await;
    let users = optional_neo4j_query(
        connection,
        "SHOW USERS YIELD user, roles, suspended RETURN user, roles, suspended ORDER BY user",
    )
    .await;

    let label_filter = node_id
        .strip_prefix("neo4j-label:")
        .or_else(|| node_id.strip_prefix("node-label:"));
    let relationship_filter = node_id
        .strip_prefix("neo4j-relationship:")
        .or_else(|| node_id.strip_prefix("relationship:"));
    let property_filter = node_id
        .strip_prefix("neo4j-property-key:")
        .or_else(|| node_id.strip_prefix("property-key:"));
    let index_filter = node_id
        .strip_prefix("neo4j-index:")
        .or_else(|| node_id.strip_prefix("index:"));
    let constraint_filter = node_id
        .strip_prefix("neo4j-constraint:")
        .or_else(|| node_id.strip_prefix("constraint:"));

    let node_labels = label_records(labels.as_ref(), label_filter);
    let relationship_types = relationship_records(relationships.as_ref(), relationship_filter);
    let property_key_rows = property_key_records(property_keys.as_ref(), property_filter);
    let index_rows = neo4j_table_records(indexes.as_ref().unwrap_or(&json!({})))
        .into_iter()
        .filter(|row| {
            index_filter.is_none_or(|name| row.get("name").and_then(Value::as_str) == Some(name))
        })
        .collect::<Vec<_>>();
    let constraint_rows = neo4j_table_records(constraints.as_ref().unwrap_or(&json!({})))
        .into_iter()
        .filter(|row| {
            constraint_filter
                .is_none_or(|name| row.get("name").and_then(Value::as_str) == Some(name))
        })
        .collect::<Vec<_>>();
    let procedure_rows = neo4j_table_records(procedures.as_ref().unwrap_or(&json!({})));
    let diagnostics = neo4j_diagnostic_records(
        components.as_ref(),
        labels.is_some(),
        indexes.is_some(),
        constraints.is_some(),
    );
    let graphs = graph_records(connection, node_labels.len(), relationship_types.len());

    payload["graphs"] = json!(graphs);
    payload["nodeLabels"] = json!(node_labels);
    payload["relationshipTypes"] = json!(relationship_types);
    payload["propertyKeys"] = json!(property_key_rows);
    payload["indexes"] = json!(index_rows);
    payload["constraints"] = json!(constraint_rows);
    payload["procedures"] = json!(procedure_rows);
    payload["security"] = json!(neo4j_security_records(users.as_ref()));
    payload["diagnostics"] = json!(diagnostics);
    payload["labelCount"] = json!(payload["nodeLabels"].as_array().map_or(0, Vec::len));
    payload["relationshipTypeCount"] =
        json!(payload["relationshipTypes"].as_array().map_or(0, Vec::len));
    payload["indexCount"] = json!(payload["indexes"].as_array().map_or(0, Vec::len));
    payload["constraintCount"] = json!(payload["constraints"].as_array().map_or(0, Vec::len));

    if labels.is_none() && relationships.is_none() && indexes.is_none() && constraints.is_none() {
        payload["warnings"] = json!(["Neo4j metadata is unavailable from the configured HTTP transaction endpoint right now."]);
    }
}

async fn optional_neo4j_query(
    connection: &ResolvedConnectionProfile,
    query: &str,
) -> Option<Value> {
    neo4j_run_cypher(connection, query).await.ok()
}

fn neo4j_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    json!({
        "engine": "neo4j",
        "nodeId": node_id,
        "objectView": object_view,
        "graphName": connection.database.as_deref().unwrap_or("neo4j"),
        "labelCount": 0,
        "relationshipTypeCount": 0,
        "indexCount": 0,
        "constraintCount": 0,
        "nodeLabels": [],
        "relationshipTypes": [],
        "propertyKeys": [],
        "indexes": [],
        "constraints": [],
        "procedures": [],
        "security": [],
        "diagnostics": [{
            "signal": "Metadata",
            "value": "HTTP transaction",
            "status": "ready",
            "guidance": "Neo4j object views use bounded schema metadata and keep raw HTTP endpoint details out of the main view."
        }]
    })
}

fn neo4j_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "graph:graphs" {
        return "graphs";
    }
    if node_id == "neo4j-labels" || node_id == "graph:node-labels" {
        return "node-labels";
    }
    if node_id.starts_with("neo4j-label:") || node_id.starts_with("node-label:") {
        return "node-label";
    }
    if node_id == "neo4j-relationships" || node_id == "graph:relationship-types" {
        return "relationship-types";
    }
    if node_id.starts_with("neo4j-relationship:") || node_id.starts_with("relationship:") {
        return "relationship";
    }
    if node_id == "neo4j-property-keys" || node_id == "graph:property-keys" {
        return "property-keys";
    }
    if node_id.starts_with("neo4j-property-key:") || node_id.starts_with("property-key:") {
        return "property-key";
    }
    if node_id == "neo4j-indexes" || node_id == "graph:indexes" {
        return "indexes";
    }
    if node_id.starts_with("neo4j-index:") || node_id.starts_with("index:") {
        return "index";
    }
    if node_id == "neo4j-constraints" || node_id == "graph:constraints" {
        return "constraints";
    }
    if node_id.starts_with("neo4j-constraint:") || node_id.starts_with("constraint:") {
        return "constraint";
    }
    if node_id == "neo4j-procedures"
        || node_id == "graph:procedures"
        || node_id.starts_with("neo4j-procedure:")
        || node_id.starts_with("procedure:")
    {
        return "procedures";
    }
    if node_id == "graph:security" || node_id.starts_with("security:") {
        return "security";
    }
    if node_id == "neo4j-diagnostics" || node_id == "graph:diagnostics" {
        return "diagnostics";
    }
    if node_id.starts_with("graph:") {
        return "graph";
    }

    "graphs"
}

fn graph_records(
    connection: &ResolvedConnectionProfile,
    labels: usize,
    relationship_types: usize,
) -> Vec<Value> {
    let graph = connection.database.as_deref().unwrap_or("neo4j");
    vec![json!({
        "name": graph,
        "database": graph,
        "nodes": "-",
        "relationships": "-",
        "labels": labels,
        "relationshipTypes": relationship_types,
    })]
}

fn label_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    first_column_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|label| filter.is_none_or(|expected| expected == label))
        .map(|label| {
            json!({
                "label": label,
                "count": "-",
                "properties": "Refresh Property Keys for field metadata",
                "indexedProperties": "-",
                "constraints": "-"
            })
        })
        .collect()
}

fn relationship_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    first_column_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|relationship| filter.is_none_or(|expected| expected == relationship))
        .map(|relationship| {
            json!({
                "type": relationship,
                "count": "-",
                "from": "-",
                "to": "-",
                "properties": "Refresh Property Keys for field metadata"
            })
        })
        .collect()
}

fn property_key_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    first_column_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|property| filter.is_none_or(|expected| expected == property))
        .map(|property| {
            json!({
                "name": property,
                "types": "mixed",
                "labels": "-",
                "relationshipTypes": "-",
                "indexed": "-"
            })
        })
        .collect()
}

pub(crate) fn neo4j_table_records(value: &Value) -> Vec<Value> {
    let Some(result) = value
        .get("results")
        .and_then(Value::as_array)
        .and_then(|results| results.first())
    else {
        return Vec::new();
    };
    let columns = result
        .get("columns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();

    result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("row").and_then(Value::as_array))
        .map(|row| {
            let mut record = serde_json::Map::new();
            for (index, column) in columns.iter().enumerate() {
                record.insert(
                    (*column).into(),
                    row.get(index).cloned().unwrap_or_else(|| json!("-")),
                );
            }
            Value::Object(record)
        })
        .collect()
}

fn neo4j_diagnostic_records(
    components: Option<&Value>,
    labels_available: bool,
    indexes_available: bool,
    constraints_available: bool,
) -> Vec<Value> {
    let component_rows = neo4j_table_records(components.unwrap_or(&json!({})));
    let component = component_rows
        .first()
        .and_then(|row| row.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Neo4j");
    let version = component_rows
        .first()
        .and_then(|row| row.get("versions"))
        .map(neo4j_value_to_display)
        .unwrap_or_else(|| "-".into());

    vec![
        json!({
            "signal": "Component",
            "value": format!("{component} {version}"),
            "status": if components.is_some() { "ready" } else { "unavailable" },
            "guidance": "Use diagnostics to confirm edition, version, and metadata support."
        }),
        json!({
            "signal": "Schema Metadata",
            "value": if labels_available && indexes_available && constraints_available { "available" } else { "partial" },
            "status": if labels_available { "ready" } else { "watch" },
            "guidance": "Labels, indexes, and constraints are collected independently so permission gaps do not break the whole view."
        }),
    ]
}

fn neo4j_security_records(value: Option<&Value>) -> Vec<Value> {
    neo4j_table_records(value.unwrap_or(&json!({})))
        .into_iter()
        .map(|row| {
            json!({
                "principal": row.get("user").and_then(Value::as_str).unwrap_or("-"),
                "role": row.get("roles").map(neo4j_value_to_display).unwrap_or_else(|| "-".into()),
                "privilege": "visible",
                "scope": "database",
                "effect": if row.get("suspended").and_then(Value::as_bool) == Some(true) { "suspended" } else { "allow" },
            })
        })
        .collect()
}

fn neo4j_value_to_display(value: &Value) -> String {
    match value {
        Value::Array(items) => items
            .iter()
            .map(neo4j_value_to_display)
            .collect::<Vec<_>>()
            .join(", "),
        Value::String(value) => value.clone(),
        Value::Null => "-".into(),
        _ => value.to_string(),
    }
}

pub(crate) fn first_column_values(value: &Value) -> Vec<String> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|result| {
            result
                .get("data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|item| {
            item.get("row")
                .and_then(Value::as_array)
                .and_then(|row| row.first())
        })
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .collect()
}

pub(crate) fn quote_cypher_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        first_column_values, neo4j_base_payload, neo4j_object_view_kind, neo4j_table_records,
        quote_cypher_identifier, root_nodes,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn neo4j_first_column_values_reads_http_result_rows() {
        let value = json!({
            "results": [{
                "columns": ["label"],
                "data": [{ "row": ["Person"] }, { "row": ["Order"] }]
            }],
            "errors": []
        });

        assert_eq!(first_column_values(&value), vec!["Person", "Order"]);
    }

    #[test]
    fn neo4j_identifier_quote_escapes_backticks() {
        assert_eq!(quote_cypher_identifier("Odd`Label"), "`Odd``Label`");
    }

    #[test]
    fn neo4j_root_uses_native_schema_and_diagnostics_sections() {
        let nodes = root_nodes(&connection());
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Databases",
                "Node Labels",
                "Relationship Types",
                "Property Keys",
                "Indexes",
                "Constraints",
                "Procedures",
                "Security",
                "Diagnostics"
            ]
        );
        assert!(nodes
            .iter()
            .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
    }

    #[test]
    fn neo4j_inspection_payload_is_view_friendly_without_raw_api_dump() {
        let payload = neo4j_base_payload(&connection(), "neo4j-labels", "node-labels");

        assert_eq!(payload["objectView"], "node-labels");
        assert!(payload.get("api").is_none());
        assert!(payload["nodeLabels"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn neo4j_node_ids_map_to_graph_object_views() {
        assert_eq!(neo4j_object_view_kind("graph:graphs"), "graphs");
        assert_eq!(neo4j_object_view_kind("graph:node-labels"), "node-labels");
        assert_eq!(neo4j_object_view_kind("node-label:Person"), "node-label");
        assert_eq!(
            neo4j_object_view_kind("relationship:BOUGHT"),
            "relationship"
        );
        assert_eq!(neo4j_object_view_kind("graph:security"), "security");
        assert_eq!(neo4j_object_view_kind("neo4j-labels"), "node-labels");
        assert_eq!(neo4j_object_view_kind("neo4j-label:Person"), "node-label");
        assert_eq!(
            neo4j_object_view_kind("neo4j-relationship:BOUGHT"),
            "relationship"
        );
        assert_eq!(neo4j_object_view_kind("neo4j-indexes"), "indexes");
        assert_eq!(neo4j_object_view_kind("neo4j-diagnostics"), "diagnostics");
    }

    #[test]
    fn neo4j_table_records_map_columns_to_rows() {
        let rows = neo4j_table_records(&json!({
            "results": [{
                "columns": ["name", "type", "state"],
                "data": [
                    { "row": ["idx_person_name", "RANGE", "ONLINE"] }
                ]
            }],
            "errors": []
        }));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "idx_person_name");
        assert_eq!(rows[0]["state"], "ONLINE");
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-neo4j".into(),
            name: "Neo4j".into(),
            engine: "neo4j".into(),
            family: "graph".into(),
            host: "127.0.0.1".into(),
            port: Some(7474),
            database: Some("neo4j".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
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
