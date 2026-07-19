use super::super::*;

pub(super) fn graph_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "arango" => arango_graph_operation_request(operation_id, object_name, parameters),
        "neptune" => neptune_graph_operation_request(operation_id, object_name, parameters),
        "janusgraph" => janusgraph_operation_request(operation_id, object_name, parameters),
        _ => neo4j_operation_request(operation_id, object_name, parameters),
    }
}

fn neo4j_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "MATCH (n:{}) RETURN n LIMIT 100",
            cypher_identifier(object_name)
        )
    });
    let label = string_parameter(parameters, "label").unwrap_or_else(|| object_name.into());
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName").unwrap_or_else(|| {
        format!(
            "{}_{}_lookup",
            safe_identifier(&label),
            safe_identifier(&property)
        )
    });

    if operation_id.ends_with("query.explain") {
        return format!("EXPLAIN {}", strip_plan_prefix(&query));
    }

    if operation_id.ends_with("query.profile") {
        return format!("PROFILE {}", strip_plan_prefix(&query));
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return "CALL dbms.queryJmx(\"org.neo4j:*\") YIELD name, attributes RETURN name, attributes LIMIT 100;".into();
    }

    if operation_id.ends_with("security.inspect") {
        return "SHOW USERS;\nSHOW ROLES;\nSHOW PRIVILEGES;".into();
    }

    if operation_id.ends_with("index.create") {
        return format!(
            "CREATE INDEX {} IF NOT EXISTS FOR (n:{}) ON (n.{});",
            cypher_identifier(&index_name),
            cypher_identifier(&label),
            cypher_identifier(&property)
        );
    }

    if operation_id.ends_with("index.drop") {
        return format!("DROP INDEX {} IF EXISTS;", cypher_identifier(&index_name));
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "neo4j.export",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "graph-json".into()),
            "query": query,
            "scope": object_name,
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        let constraint_name =
            string_parameter(parameters, "constraintName").unwrap_or_else(|| object_name.into());
        return format!(
            "DROP CONSTRAINT {} IF EXISTS;",
            cypher_identifier(&constraint_name)
        );
    }

    query
}

fn arango_graph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query")
        .unwrap_or_else(|| format!("FOR doc IN {object_name} LIMIT 100 RETURN doc"));
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("{object_name}_{property}_idx"));

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/explain",
            "body": {
                "query": query,
                "options": { "allPlans": true }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/explain",
            "body": {
                "query": query,
                "options": { "allPlans": true, "profile": true }
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/_admin/statistics"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/_api/user"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/_api/index?collection={object_name}"),
            "body": {
                "name": index_name,
                "type": "persistent",
                "fields": [property]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": format!("/_api/index/{index_name}")
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/_api/export",
            "body": {
                "collection": object_name,
                "format": string_parameter(parameters, "format").unwrap_or_else(|| "jsonl".into()),
                "query": query
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn neptune_graph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "g.V().hasLabel('{}').limit(100)",
            escape_single_quoted(object_name)
        )
    });

    if operation_id.ends_with("query.explain") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/gremlin/explain",
            "body": { "gremlin": query }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/gremlin/profile",
            "body": { "gremlin": query }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CloudWatch.GetMetricData",
            "namespace": "AWS/Neptune",
            "cluster": object_name,
            "metrics": ["CPUUtilization", "GremlinRequestsPerSec", "SparqlRequestsPerSec", "BufferCacheHitRatio"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "IAM.SimulatePrincipalPolicy",
            "resource": object_name,
            "actions": ["neptune-db:ReadDataViaQuery", "neptune-db:WriteDataViaQuery", "neptune-db:GetQueryStatus"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "Neptune.StartLoaderJob",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "source": string_parameter(parameters, "source").unwrap_or_else(|| "<selected-s3-location>".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "neptune-bulk".into()),
            "scope": object_name,
            "validation": "validate-before-write"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn janusgraph_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let query = string_parameter(parameters, "query").unwrap_or_else(|| {
        format!(
            "g.V().hasLabel('{}').limit(100)",
            escape_single_quoted(object_name)
        )
    });
    let property = string_parameter(parameters, "propertyName").unwrap_or_else(|| "id".into());
    let index_name = string_parameter(parameters, "indexName")
        .unwrap_or_else(|| format!("{object_name}_{property}_idx"));

    if operation_id.ends_with("query.explain") {
        return format!("{query}.explain()");
    }

    if operation_id.ends_with("query.profile") {
        return format!("{query}.profile()");
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return [
            "mgmt = graph.openManagement()",
            "mgmt.getRelationTypes(VertexLabel).collect { it.name() }",
            "mgmt.getGraphIndexes(Vertex).collect { it.name() }",
            "mgmt.rollback()",
        ]
        .join("\n");
    }

    if operation_id.ends_with("index.create") {
        return [
            "mgmt = graph.openManagement()".into(),
            format!(
                "key = mgmt.getPropertyKey('{}')",
                escape_single_quoted(&property)
            ),
            format!(
                "mgmt.buildIndex('{}', Vertex.class).addKey(key).buildCompositeIndex()",
                escape_single_quoted(&index_name)
            ),
            "mgmt.commit()".into(),
        ]
        .join("\n");
    }

    if operation_id.ends_with("index.drop") {
        return [
            "mgmt = graph.openManagement()".into(),
            format!(
                "index = mgmt.getGraphIndex('{}')",
                escape_single_quoted(&index_name)
            ),
            "mgmt.updateIndex(index, SchemaAction.DISABLE_INDEX).get()".into(),
            "mgmt.commit()".into(),
        ]
        .join("\n");
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "janusgraph.export",
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "graph-json".into()),
            "query": query,
            "scope": object_name,
            "validation": "bounded-export"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn cypher_identifier(value: &str) -> String {
    if is_simple_identifier(value) {
        value.into()
    } else {
        format!("`{}`", value.replace('`', "``"))
    }
}
