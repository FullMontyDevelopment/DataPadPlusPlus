use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::search_execution_capabilities;
use super::connection::search_get;
use super::SearchEngine;

pub(super) async fn list_search_explorer_nodes(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("search:indices") => index_nodes(engine, connection, request.limit).await?,
        Some("search:data-streams") => data_stream_nodes(engine, connection, request.limit).await?,
        Some("search:aliases") => alias_nodes(engine, connection, request.limit).await?,
        Some("search:cluster") => cluster_nodes(engine, connection).await?,
        Some(_) => Vec::new(),
        None => root_nodes(engine, connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} {} explorer node(s) for {}.",
            nodes.len(),
            engine.label,
            connection.name
        ),
        capabilities: search_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_search_explorer_node(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let target = SearchObjectTarget::from_node_id(engine, &request.node_id);
    let query_template = target.query_template();
    let payload = search_object_payload(engine, connection, &target).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "{} metadata loaded for {} on {}.",
            engine.label,
            target.label(),
            connection.name
        ),
        query_template,
        payload: Some(payload),
    })
}

fn root_nodes(engine: SearchEngine, connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "search-indices",
            "Indices",
            "indices",
            "Search indices, mappings, shards, and document counts",
            "search:indices",
        ),
        (
            "search-data-streams",
            "Data streams",
            "data-streams",
            "Time-oriented data streams and backing indices",
            "search:data-streams",
        ),
        (
            "search-aliases",
            "Aliases",
            "aliases",
            "Index aliases and routing surfaces",
            "search:aliases",
        ),
        (
            "search-cluster",
            "Cluster",
            "cluster",
            "Cluster health, node, shard, and segment diagnostics",
            "search:cluster",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope)| ExplorerNode {
        id: format!("{}:{id}", engine.engine),
        family: "search".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), engine.label.into()]),
        query_template: Some(search_query_template("_all")),
        expandable: Some(true),
    })
    .collect()
}

async fn index_nodes(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let value = search_json(connection, "/_cat/indices?format=json").await?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| item.get("index").and_then(Value::as_str))
        .map(|index| ExplorerNode {
            id: format!("search-index:{index}"),
            family: "search".into(),
            label: index.into(),
            kind: "index".into(),
            detail: format!("{} index", engine.label),
            scope: None,
            path: Some(vec![connection.name.clone(), "Indices".into()]),
            query_template: Some(search_query_template(index)),
            expandable: Some(false),
        })
        .collect())
}

async fn data_stream_nodes(
    _engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let value = search_json(connection, "/_data_stream").await?;
    Ok(value
        .get("data_streams")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .map(|name| ExplorerNode {
            id: format!("search-data-stream:{name}"),
            family: "search".into(),
            label: name.into(),
            kind: "data-stream".into(),
            detail: "Search data stream".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Data streams".into()]),
            query_template: Some(search_query_template(name)),
            expandable: Some(false),
        })
        .collect())
}

async fn alias_nodes(
    _engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let value = search_json(connection, "/_cat/aliases?format=json").await?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| item.get("alias").and_then(Value::as_str))
        .map(|alias| ExplorerNode {
            id: format!("search-alias:{alias}"),
            family: "search".into(),
            label: alias.into(),
            kind: "alias".into(),
            detail: "Search alias".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Aliases".into()]),
            query_template: Some(search_query_template(alias)),
            expandable: Some(false),
        })
        .collect())
}

async fn cluster_nodes(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = search_json(connection, "/_cluster/health").await?;
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    Ok(vec![ExplorerNode {
        id: format!("{}:cluster-health", engine.engine),
        family: "search".into(),
        label: "Cluster health".into(),
        kind: "cluster-health".into(),
        detail: format!("Status: {status}"),
        scope: None,
        path: Some(vec![connection.name.clone(), "Cluster".into()]),
        query_template: Some("GET /_cluster/health".into()),
        expandable: Some(false),
    }])
}

async fn search_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<Value, CommandError> {
    let response = search_get(connection, path).await?;
    serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "search-json-invalid",
            format!("Search engine returned invalid JSON: {error}"),
        )
    })
}

async fn optional_search_json(connection: &ResolvedConnectionProfile, path: &str) -> Option<Value> {
    search_json(connection, path).await.ok()
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SearchObjectTarget {
    kind: String,
    name: Option<String>,
}

impl SearchObjectTarget {
    fn from_node_id(engine: SearchEngine, node_id: &str) -> Self {
        if let Some(index) = node_id.strip_prefix("search-index:") {
            return Self {
                kind: "index".into(),
                name: Some(index.into()),
            };
        }

        if let Some(stream) = node_id.strip_prefix("search-data-stream:") {
            return Self {
                kind: "data-stream".into(),
                name: Some(stream.into()),
            };
        }

        if let Some(alias) = node_id.strip_prefix("search-alias:") {
            return Self {
                kind: "alias".into(),
                name: Some(alias.into()),
            };
        }

        if node_id.ends_with(":cluster-health") || node_id.contains("cluster") {
            return Self {
                kind: "cluster".into(),
                name: None,
            };
        }

        let prefix = format!("{}:search-", engine.engine);
        let kind = node_id
            .strip_prefix(&prefix)
            .unwrap_or(node_id)
            .trim()
            .to_lowercase()
            .replace('_', "-");

        Self {
            kind: if kind.is_empty() {
                "cluster".into()
            } else {
                kind
            },
            name: None,
        }
    }

    fn label(&self) -> &str {
        self.name.as_deref().unwrap_or(self.kind.as_str())
    }

    fn query_template(&self) -> Option<String> {
        match self.kind.as_str() {
            "index" | "data-stream" | "alias" | "documents" => Some(search_query_template(
                self.name.as_deref().unwrap_or("_all"),
            )),
            _ => None,
        }
    }
}

async fn search_object_payload(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    target: &SearchObjectTarget,
) -> Value {
    let mut payload = search_base_payload(engine, target);

    match target.kind.as_str() {
        "index" => merge_search_payload(
            &mut payload,
            search_index_payload(connection, target.name.as_deref().unwrap_or("_all")).await,
        ),
        "data-stream" => merge_search_payload(
            &mut payload,
            search_data_stream_payload(connection, target.name.as_deref()).await,
        ),
        "alias" => merge_search_payload(
            &mut payload,
            search_alias_payload(connection, target.name.as_deref()).await,
        ),
        "indices" => merge_search_payload(
            &mut payload,
            json!({ "indices": search_indices(connection).await }),
        ),
        "data-streams" => merge_search_payload(
            &mut payload,
            json!({ "dataStreams": search_data_streams(connection, None).await }),
        ),
        "aliases" => merge_search_payload(
            &mut payload,
            json!({ "aliases": search_aliases(connection, None).await }),
        ),
        "cluster" | "health" => {
            merge_search_payload(&mut payload, search_cluster_payload(connection).await)
        }
        _ => merge_search_payload(&mut payload, search_cluster_payload(connection).await),
    }

    payload
}

fn search_base_payload(engine: SearchEngine, target: &SearchObjectTarget) -> Value {
    json!({
        "engine": engine.engine,
        "objectView": target.kind,
        "objectName": target.name,
        "index": target.name,
    })
}

async fn search_cluster_payload(connection: &ResolvedConnectionProfile) -> Value {
    let health = optional_search_json(connection, "/_cluster/health").await;
    let status = health
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let cluster_name = health
        .as_ref()
        .and_then(|value| value.get("cluster_name"))
        .and_then(Value::as_str)
        .unwrap_or("cluster");
    let nodes = search_nodes(connection).await;
    let indices = search_indices(connection).await;
    let shards = search_shards(connection, None).await;
    let statistics = vec![
        json!({ "name": "cluster.status", "value": status, "unit": "state", "source": "cluster health" }),
        json!({ "name": "cluster.indices", "value": indices.len(), "unit": "indices", "source": "cat indices" }),
        json!({ "name": "cluster.nodes", "value": nodes.len(), "unit": "nodes", "source": "cat nodes" }),
        json!({ "name": "cluster.shards", "value": shards.len(), "unit": "shards", "source": "cat shards" }),
    ];

    json!({
        "clusterName": cluster_name,
        "status": status,
        "nodeCount": nodes.len(),
        "shardCount": shards.len(),
        "indices": indices,
        "nodes": nodes,
        "shards": shards,
        "statistics": statistics,
    })
}

async fn search_index_payload(connection: &ResolvedConnectionProfile, index: &str) -> Value {
    let indices = search_indices(connection)
        .await
        .into_iter()
        .filter(|row| row.get("name").and_then(Value::as_str) == Some(index))
        .collect::<Vec<_>>();
    let fields = search_mapping_fields(connection, index).await;
    let settings = search_settings(connection, index).await;
    let aliases = search_aliases(connection, Some(index)).await;
    let shards = search_shards(connection, Some(index)).await;
    let segments = search_segments(connection, Some(index)).await;
    let document_count = indices
        .first()
        .and_then(|row| row.get("documents"))
        .cloned()
        .unwrap_or(Value::Null);

    json!({
        "objectName": index,
        "index": index,
        "documentCount": document_count,
        "indices": indices,
        "fields": fields,
        "mappings": fields,
        "settings": settings,
        "aliases": aliases,
        "shards": shards,
        "segments": segments,
    })
}

async fn search_data_stream_payload(
    connection: &ResolvedConnectionProfile,
    stream: Option<&str>,
) -> Value {
    let data_streams = search_data_streams(connection, stream).await;
    let backing_indices = data_streams
        .iter()
        .flat_map(|item| {
            item.get("backingIndices")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(Value::as_str)
        .map(|name| json!({ "name": name, "type": "backing-index" }))
        .collect::<Vec<_>>();

    json!({
        "dataStreams": data_streams,
        "indices": backing_indices,
    })
}

async fn search_alias_payload(
    connection: &ResolvedConnectionProfile,
    alias: Option<&str>,
) -> Value {
    json!({ "aliases": search_aliases(connection, alias).await })
}

async fn search_indices(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_cat/indices?format=json")
        .await
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            json!({
                "name": string_field(&item, "index"),
                "health": string_field(&item, "health"),
                "status": string_field(&item, "status"),
                "documents": string_field(&item, "docs.count"),
                "primaryShards": string_field(&item, "pri"),
                "replicaShards": string_field(&item, "rep"),
                "storage": string_field(&item, "store.size"),
            })
        })
        .collect()
}

async fn search_data_streams(
    connection: &ResolvedConnectionProfile,
    stream: Option<&str>,
) -> Vec<Value> {
    optional_search_json(connection, "/_data_stream")
        .await
        .and_then(|value| value.get("data_streams").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            stream
                .map(|name| item.get("name").and_then(Value::as_str) == Some(name))
                .unwrap_or(true)
        })
        .map(|item| {
            let backing = item
                .get("indices")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.get("index_name").and_then(Value::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>();
            json!({
                "name": string_field(&item, "name"),
                "generation": item.get("generation").cloned().unwrap_or(Value::Null),
                "status": string_field(&item, "status"),
                "template": string_field(&item, "template"),
                "backingIndices": backing,
            })
        })
        .collect()
}

async fn search_aliases(
    connection: &ResolvedConnectionProfile,
    filter: Option<&str>,
) -> Vec<Value> {
    optional_search_json(connection, "/_cat/aliases?format=json")
        .await
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            filter
                .map(|name| {
                    item.get("alias").and_then(Value::as_str) == Some(name)
                        || item.get("index").and_then(Value::as_str) == Some(name)
                })
                .unwrap_or(true)
        })
        .map(|item| {
            json!({
                "name": string_field(&item, "alias"),
                "indices": string_field(&item, "index"),
                "writeIndex": string_field(&item, "is_write_index"),
                "routing": string_field(&item, "routing.index"),
                "filter": string_field(&item, "filter"),
            })
        })
        .collect()
}

async fn search_nodes(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_cat/nodes?format=json")
        .await
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            json!({
                "name": string_field(&item, "name"),
                "roles": string_field(&item, "node.role"),
                "heapUsed": string_field(&item, "heap.percent"),
                "diskUsed": string_field(&item, "disk.used_percent"),
                "cpu": string_field(&item, "cpu"),
                "status": "visible",
            })
        })
        .collect()
}

async fn search_shards(connection: &ResolvedConnectionProfile, index: Option<&str>) -> Vec<Value> {
    let path = index
        .map(|index| format!("/_cat/shards/{index}?format=json"))
        .unwrap_or_else(|| "/_cat/shards?format=json".into());
    optional_search_json(connection, &path)
        .await
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            json!({
                "index": string_field(&item, "index"),
                "shard": string_field(&item, "shard"),
                "primary": string_field(&item, "prirep"),
                "state": string_field(&item, "state"),
                "node": string_field(&item, "node"),
                "documents": string_field(&item, "docs"),
                "storage": string_field(&item, "store"),
            })
        })
        .collect()
}

async fn search_segments(
    connection: &ResolvedConnectionProfile,
    index: Option<&str>,
) -> Vec<Value> {
    let path = index
        .map(|index| format!("/_cat/segments/{index}?format=json"))
        .unwrap_or_else(|| "/_cat/segments?format=json".into());
    optional_search_json(connection, &path)
        .await
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            json!({
                "index": string_field(&item, "index"),
                "shard": string_field(&item, "shard"),
                "segments": string_field(&item, "segment"),
                "deletedDocs": string_field(&item, "docs.deleted"),
                "memory": string_field(&item, "memory"),
            })
        })
        .collect()
}

async fn search_settings(connection: &ResolvedConnectionProfile, index: &str) -> Vec<Value> {
    optional_search_json(connection, &format!("/{index}/_settings"))
        .await
        .and_then(|value| value.get(index).cloned())
        .and_then(|value| value.get("settings").cloned())
        .map(flatten_json_settings)
        .unwrap_or_default()
}

async fn search_mapping_fields(connection: &ResolvedConnectionProfile, index: &str) -> Vec<Value> {
    let Some(mapping) = optional_search_json(connection, &format!("/{index}/_mapping"))
        .await
        .and_then(|value| value.get(index).cloned())
        .and_then(|value| value.get("mappings").cloned())
    else {
        return Vec::new();
    };

    let mut fields = Vec::new();
    collect_mapping_fields(
        "",
        mapping.get("properties").unwrap_or(&Value::Null),
        &mut fields,
    );
    fields
}

fn collect_mapping_fields(prefix: &str, value: &Value, fields: &mut Vec<Value>) {
    let Some(properties) = value.as_object() else {
        return;
    };

    for (name, mapping) in properties {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        let field_type = string_field(mapping, "type");
        let display_type = if field_type.is_empty() {
            "object".to_string()
        } else {
            field_type
        };
        fields.push(json!({
            "path": path,
            "type": display_type,
            "searchable": mapping.get("index").and_then(Value::as_bool).unwrap_or(true),
            "aggregatable": mapping.get("doc_values").and_then(Value::as_bool).unwrap_or(true),
            "analyzer": string_field(mapping, "analyzer"),
            "normalizer": string_field(mapping, "normalizer"),
        }));
        collect_mapping_fields(
            &path,
            mapping.get("properties").unwrap_or(&Value::Null),
            fields,
        );
    }
}

fn flatten_json_settings(value: Value) -> Vec<Value> {
    fn walk(prefix: &str, value: &Value, rows: &mut Vec<Value>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    let path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    };
                    walk(&path, child, rows);
                }
            }
            Value::Array(_) => {
                rows.push(json!({ "name": prefix, "value": value.to_string(), "scope": "index" }))
            }
            _ => rows.push(
                json!({ "name": prefix, "value": display_json_scalar(value), "scope": "index" }),
            ),
        }
    }

    let mut rows = Vec::new();
    walk("", &value, &mut rows);
    rows
}

fn display_json_scalar(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| value.get(key).map(display_json_scalar).unwrap_or_default())
}

fn merge_search_payload(target: &mut Value, addition: Value) {
    let Some(target) = target.as_object_mut() else {
        return;
    };
    let Some(addition) = addition.as_object() else {
        return;
    };
    for (key, value) in addition {
        target.insert(key.clone(), value.clone());
    }
}

pub(crate) fn search_query_template(index: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "index": index,
        "body": {
            "query": { "match_all": {} },
            "size": 100
        }
    }))
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::datastores::search::ELASTICSEARCH;

    #[test]
    fn search_query_template_wraps_index_and_body() {
        let template = search_query_template("logs-*");
        assert!(template.contains("\"index\": \"logs-*\""));
        assert!(template.contains("\"match_all\""));
    }

    #[test]
    fn search_node_ids_map_to_native_object_views() {
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-index:logs").kind,
            "index"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-data-stream:metrics").kind,
            "data-stream"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-alias:current").kind,
            "alias"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "elasticsearch:cluster-health").kind,
            "cluster"
        );
    }

    #[test]
    fn search_base_payload_is_view_friendly_without_raw_api_dump() {
        let target = SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-index:logs");
        let payload = search_base_payload(ELASTICSEARCH, &target);

        assert_eq!(payload["engine"], "elasticsearch");
        assert_eq!(payload["objectView"], "index");
        assert_eq!(payload["index"], "logs");
        assert!(payload.get("api").is_none());
    }

    #[test]
    fn search_mapping_fields_flatten_nested_properties() {
        let mapping = json!({
            "title": { "type": "text", "analyzer": "standard" },
            "user": {
                "properties": {
                    "id": { "type": "keyword" }
                }
            }
        });
        let mut fields = Vec::new();
        collect_mapping_fields("", &mapping, &mut fields);

        let paths = fields
            .iter()
            .filter_map(|field| field.get("path").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["title", "user", "user.id"]);
        assert_eq!(fields[0]["type"], "text");
        assert_eq!(fields[1]["type"], "object");
    }
}
