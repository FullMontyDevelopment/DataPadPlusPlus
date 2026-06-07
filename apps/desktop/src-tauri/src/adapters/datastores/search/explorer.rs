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
        Some("search:cluster") => cluster_section_nodes(),
        Some("search:indices") => index_nodes(engine, connection, request.limit).await?,
        Some(scope) if scope.starts_with("index:") => {
            index_section_nodes(scope.trim_start_matches("index:"))
        }
        Some(scope) if scope.starts_with("search-index:") => {
            index_section_nodes(scope.trim_start_matches("search-index:"))
        }
        Some("search:data-streams") => data_stream_nodes(engine, connection, request.limit).await?,
        Some(scope) if scope.starts_with("data-stream:") => {
            data_stream_section_nodes(scope.trim_start_matches("data-stream:"))
        }
        Some(scope) if scope.starts_with("search-data-stream:") => {
            data_stream_section_nodes(scope.trim_start_matches("search-data-stream:"))
        }
        Some("search:aliases") => alias_nodes(engine, connection, request.limit).await?,
        Some("search:templates") => template_section_nodes(),
        Some("search:templates:index") => index_template_nodes(connection, request.limit).await?,
        Some("search:templates:component") => {
            component_template_nodes(connection, request.limit).await?
        }
        Some("search:pipelines") => pipeline_nodes(connection, request.limit).await?,
        Some("search:security") => security_section_nodes(),
        Some("search:diagnostics") => diagnostics_section_nodes(),
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
            "search-cluster",
            "Cluster",
            "cluster",
            "Cluster health, node, shard, and segment diagnostics",
            "search:cluster",
        ),
        (
            "search-indices",
            "Indices",
            "indices",
            "Search indices, mappings, shards, and document counts",
            "search:indices",
        ),
        (
            "search-data-streams",
            "Data Streams",
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
            "search-templates",
            "Templates",
            "templates",
            "Index and component templates",
            "search:templates",
        ),
        (
            "search-pipelines",
            "Pipelines",
            "pipelines",
            "Ingest pipelines and processors",
            "search:pipelines",
        ),
        (
            "search-security",
            "Security",
            "security",
            "Users, roles, API keys, and privileges",
            "search:security",
        ),
        (
            "search-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Shards, segments, tasks, snapshots, and lifecycle",
            "search:diagnostics",
        ),
    ]
    .into_iter()
    .map(|(_id, label, kind, detail, scope)| ExplorerNode {
        id: scope.into(),
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
        .filter_map(|item| {
            item.get("index")
                .and_then(Value::as_str)
                .map(|index| (index, item))
        })
        .map(|(index, item)| ExplorerNode {
            id: format!("index:{index}"),
            family: "search".into(),
            label: index.into(),
            kind: "index".into(),
            detail: search_index_node_detail(engine, item),
            scope: Some(format!("index:{index}")),
            path: Some(vec![connection.name.clone(), "Indices".into()]),
            query_template: Some(search_query_template(index)),
            expandable: Some(true),
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
            id: format!("data-stream:{name}"),
            family: "search".into(),
            label: name.into(),
            kind: "data-stream".into(),
            detail: "Search data stream".into(),
            scope: Some(format!("data-stream:{name}")),
            path: Some(vec![connection.name.clone(), "Data Streams".into()]),
            query_template: Some(search_query_template(name)),
            expandable: Some(true),
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
        .filter_map(|item| {
            item.get("alias")
                .and_then(Value::as_str)
                .map(|alias| (alias, item))
        })
        .map(|(alias, item)| ExplorerNode {
            id: format!("alias:{alias}"),
            family: "search".into(),
            label: alias.into(),
            kind: "alias".into(),
            detail: search_alias_node_detail(item),
            scope: None,
            path: Some(vec![connection.name.clone(), "Aliases".into()]),
            query_template: Some(search_query_template(alias)),
            expandable: Some(false),
        })
        .collect())
}

fn search_index_node_detail(engine: SearchEngine, item: &Value) -> String {
    let health = string_field(item, "health");
    let docs = string_field(item, "docs.count");
    let storage = string_field(item, "store.size");
    let mut parts = [health, docs, storage]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if let Some(documents) = parts.get_mut(1) {
        *documents = format!("{documents} docs");
    }

    if parts.is_empty() {
        format!("{} index", engine.label)
    } else {
        parts.join(" / ")
    }
}

fn search_alias_node_detail(item: &Value) -> String {
    let index = string_field(item, "index");
    let write_index = string_field(item, "is_write_index");
    let routing = string_field(item, "routing.index");
    let mut parts = Vec::new();

    if !index.is_empty() {
        parts.push(index);
    }
    if !write_index.is_empty() && write_index != "-" {
        parts.push(format!("write {write_index}"));
    }
    if !routing.is_empty() && routing != "-" {
        parts.push(format!("routing {routing}"));
    }

    if parts.is_empty() {
        "Search alias".into()
    } else {
        parts.join(" / ")
    }
}

fn cluster_section_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "search:cluster:health",
            "Health",
            "health",
            "Cluster health and shard allocation",
            "Cluster",
        ),
        leaf(
            "search:cluster:nodes",
            "Nodes",
            "nodes",
            "Node roles, heap, disk, and CPU",
            "Cluster",
        ),
        leaf(
            "search:cluster:allocation",
            "Shard Allocation",
            "shards",
            "Shard routing and node placement",
            "Cluster",
        ),
    ]
}

fn index_section_nodes(index: &str) -> Vec<ExplorerNode> {
    vec![
        leaf_with_query(
            "documents",
            index,
            "Documents",
            "documents",
            "Bounded Query DSL search",
            "Indices",
            search_query_template(index),
        ),
        scoped_leaf(
            "mapping",
            index,
            "Mappings",
            "mappings",
            "Fields, analyzers, and doc values",
            "Indices",
        ),
        scoped_leaf(
            "settings",
            index,
            "Settings",
            "settings",
            "Shard, refresh, lifecycle, and analyzer settings",
            "Indices",
        ),
        scoped_leaf(
            "aliases",
            index,
            "Aliases",
            "aliases",
            "Aliases targeting this index",
            "Indices",
        ),
        scoped_leaf(
            "shards",
            index,
            "Shards",
            "shards",
            "Shard placement and state",
            "Indices",
        ),
        scoped_leaf(
            "segments",
            index,
            "Segments",
            "segments",
            "Lucene segment health",
            "Indices",
        ),
    ]
}

fn data_stream_section_nodes(stream: &str) -> Vec<ExplorerNode> {
    vec![
        leaf_with_query(
            "documents",
            stream,
            "Documents",
            "documents",
            "Bounded Query DSL search",
            "Data Streams",
            search_query_template(stream),
        ),
        scoped_leaf(
            "backing-indices",
            stream,
            "Backing Indices",
            "backing-indices",
            "Concrete backing indices",
            "Data Streams",
        ),
        scoped_leaf(
            "lifecycle",
            stream,
            "Lifecycle",
            "lifecycle-policies",
            "ILM or ISM policy state",
            "Data Streams",
        ),
        scoped_leaf(
            "stream-stats",
            stream,
            "Statistics",
            "statistics",
            "Document and storage counters",
            "Data Streams",
        ),
    ]
}

fn template_section_nodes() -> Vec<ExplorerNode> {
    vec![
        branch(
            "search:templates:index",
            "Index Templates",
            "templates",
            "Composable index templates",
            "Templates",
        ),
        branch(
            "search:templates:component",
            "Component Templates",
            "templates",
            "Reusable component templates",
            "Templates",
        ),
    ]
}

async fn index_template_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(search_templates(connection, "index")
        .await
        .into_iter()
        .take(bounded_page_size(limit.or(Some(100))) as usize)
        .map(|template| {
            let name = string_field(&template, "name");
            ExplorerNode {
                id: format!("index-template:{name}"),
                family: "search".into(),
                label: name,
                kind: "index-template".into(),
                detail: format!(
                    "{} / priority {}",
                    string_field(&template, "patterns"),
                    string_field(&template, "priority")
                ),
                scope: None,
                path: Some(vec!["Templates".into(), "Index Templates".into()]),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn component_template_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(search_templates(connection, "component")
        .await
        .into_iter()
        .take(bounded_page_size(limit.or(Some(100))) as usize)
        .map(|template| {
            let name = string_field(&template, "name");
            ExplorerNode {
                id: format!("component-template:{name}"),
                family: "search".into(),
                label: name,
                kind: "component-template".into(),
                detail: string_field(&template, "components"),
                scope: None,
                path: Some(vec!["Templates".into(), "Component Templates".into()]),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn pipeline_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(search_pipelines(connection)
        .await
        .into_iter()
        .take(bounded_page_size(limit.or(Some(100))) as usize)
        .map(|pipeline| {
            let name = string_field(&pipeline, "name");
            ExplorerNode {
                id: format!("pipeline:{name}"),
                family: "search".into(),
                label: name,
                kind: "pipeline".into(),
                detail: format!("{} processor(s)", string_field(&pipeline, "processors")),
                scope: None,
                path: Some(vec!["Pipelines".into()]),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

fn security_section_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "search:security:users",
            "Users",
            "users",
            "Visible users and realms",
            "Security",
        ),
        leaf(
            "search:security:roles",
            "Roles",
            "roles",
            "Cluster and index privileges",
            "Security",
        ),
        leaf(
            "search:security:api-keys",
            "API Keys",
            "api-keys",
            "API keys and expiry state",
            "Security",
        ),
    ]
}

fn diagnostics_section_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "search:diagnostics:shards",
            "Shards",
            "shards",
            "Shard routing and state",
            "Diagnostics",
        ),
        leaf(
            "search:diagnostics:segments",
            "Segments",
            "segments",
            "Segment counts and deleted docs",
            "Diagnostics",
        ),
        leaf(
            "search:diagnostics:tasks",
            "Tasks",
            "tasks",
            "Active task list",
            "Diagnostics",
        ),
        leaf(
            "search:diagnostics:snapshots",
            "Snapshots",
            "snapshots",
            "Snapshot repositories and states",
            "Diagnostics",
        ),
        leaf(
            "search:diagnostics:lifecycle",
            "Lifecycle Policies",
            "lifecycle-policies",
            "ILM or ISM policy status",
            "Diagnostics",
        ),
    ]
}

fn branch(id: &str, label: &str, kind: &str, detail: &str, parent: &str) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "search".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(id.into()),
        path: Some(vec![parent.into()]),
        query_template: None,
        expandable: Some(true),
    }
}

fn leaf(id: &str, label: &str, kind: &str, detail: &str, parent: &str) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "search".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![parent.into()]),
        query_template: None,
        expandable: Some(false),
    }
}

fn scoped_leaf(
    prefix: &str,
    object: &str,
    label: &str,
    kind: &str,
    detail: &str,
    parent: &str,
) -> ExplorerNode {
    leaf(&format!("{prefix}:{object}"), label, kind, detail, parent)
}

fn leaf_with_query(
    prefix: &str,
    object: &str,
    label: &str,
    kind: &str,
    detail: &str,
    parent: &str,
    query_template: String,
) -> ExplorerNode {
    let mut node = scoped_leaf(prefix, object, label, kind, detail, parent);
    node.query_template = Some(query_template);
    node
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

        if let Some(index) = node_id.strip_prefix("index:") {
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

        if let Some(stream) = node_id.strip_prefix("data-stream:") {
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

        if let Some(alias) = node_id.strip_prefix("alias:") {
            return Self {
                kind: "alias".into(),
                name: Some(alias.into()),
            };
        }

        for (prefix, kind) in [
            ("documents:", "documents"),
            ("mapping:", "mappings"),
            ("settings:", "settings"),
            ("aliases:", "aliases"),
            ("shards:", "shards"),
            ("segments:", "segments"),
            ("backing-indices:", "backing-indices"),
            ("lifecycle:", "lifecycle-policies"),
            ("stream-stats:", "statistics"),
            ("index-template:", "index-template"),
            ("component-template:", "component-template"),
            ("pipeline:", "pipeline"),
        ] {
            if let Some(name) = node_id.strip_prefix(prefix) {
                return Self {
                    kind: kind.into(),
                    name: Some(name.into()),
                };
            }
        }

        if let Some(kind) = node_id.strip_prefix("search:cluster:") {
            return Self {
                kind: if kind == "allocation" {
                    "shards".into()
                } else {
                    kind.into()
                },
                name: None,
            };
        }

        if node_id.ends_with(":cluster-health")
            || node_id == "search:cluster"
            || node_id == "search:cluster:health"
        {
            return Self {
                kind: "cluster".into(),
                name: None,
            };
        }

        if let Some(kind) = node_id.strip_prefix("search:security:") {
            return Self {
                kind: kind.into(),
                name: None,
            };
        }

        if let Some(kind) = node_id.strip_prefix("search:diagnostics:") {
            return Self {
                kind: if kind == "lifecycle" {
                    "lifecycle-policies".into()
                } else {
                    kind.into()
                },
                name: None,
            };
        }

        if let Some(kind) = node_id.strip_prefix("search:templates:") {
            return Self {
                kind: if kind == "index" {
                    "templates".into()
                } else {
                    "component-template".into()
                },
                name: None,
            };
        }

        if let Some(kind) = node_id.strip_prefix("search:") {
            return Self {
                kind: kind.into(),
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
        "documents" => merge_search_payload(
            &mut payload,
            search_index_payload(connection, target.name.as_deref().unwrap_or("_all")).await,
        ),
        "mappings" => merge_search_payload(
            &mut payload,
            search_mapping_payload(connection, target.name.as_deref().unwrap_or("_all")).await,
        ),
        "settings" => merge_search_payload(
            &mut payload,
            json!({ "settings": search_settings(connection, target.name.as_deref().unwrap_or("_all")).await }),
        ),
        "data-stream" => merge_search_payload(
            &mut payload,
            search_data_stream_payload(connection, target.name.as_deref()).await,
        ),
        "backing-indices" | "statistics" => merge_search_payload(
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
        "templates" => merge_search_payload(
            &mut payload,
            json!({ "templates": search_templates(connection, "all").await }),
        ),
        "index-template" => merge_search_payload(
            &mut payload,
            json!({ "templates": filter_named_rows(search_templates(connection, "index").await, target.name.as_deref()) }),
        ),
        "component-template" => merge_search_payload(
            &mut payload,
            json!({ "templates": filter_named_rows(search_templates(connection, "component").await, target.name.as_deref()) }),
        ),
        "pipelines" => merge_search_payload(
            &mut payload,
            json!({ "pipelines": search_pipelines(connection).await }),
        ),
        "pipeline" => merge_search_payload(
            &mut payload,
            json!({ "pipelines": filter_named_rows(search_pipelines(connection).await, target.name.as_deref()) }),
        ),
        "security" | "users" | "roles" | "api-keys" => merge_search_payload(
            &mut payload,
            search_security_payload(connection, target.kind.as_str()).await,
        ),
        "diagnostics" | "shards" | "segments" | "tasks" | "snapshots" | "lifecycle-policies" => {
            merge_search_payload(
                &mut payload,
                search_diagnostics_payload(engine, connection, target.kind.as_str()).await,
            )
        }
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

async fn search_mapping_payload(connection: &ResolvedConnectionProfile, index: &str) -> Value {
    let fields = search_mapping_fields(connection, index).await;

    json!({
        "fields": fields,
        "mappings": fields,
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

async fn search_templates(connection: &ResolvedConnectionProfile, kind: &str) -> Vec<Value> {
    let mut rows = Vec::new();

    if kind == "all" || kind == "index" {
        rows.extend(index_templates(connection).await);
    }

    if kind == "all" || kind == "component" {
        rows.extend(component_templates(connection).await);
    }

    rows
}

async fn index_templates(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_index_template")
        .await
        .and_then(|value| {
            value
                .get("index_templates")
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let template = item.get("index_template").unwrap_or(&Value::Null);
            let patterns = template
                .get("index_patterns")
                .and_then(Value::as_array)
                .map(|values| join_json_strings(values))
                .unwrap_or_default();
            let composed_of = template
                .get("composed_of")
                .and_then(Value::as_array)
                .map(|values| join_json_strings(values))
                .unwrap_or_default();
            json!({
                "name": string_field(&item, "name"),
                "type": "index",
                "patterns": patterns,
                "priority": template.get("priority").map(display_json_scalar).unwrap_or_default(),
                "components": composed_of,
                "version": template.get("version").map(display_json_scalar).unwrap_or_default(),
            })
        })
        .collect()
}

async fn component_templates(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_component_template")
        .await
        .and_then(|value| {
            value
                .get("component_templates")
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let template = item.get("component_template").unwrap_or(&Value::Null);
            let template_parts = [
                template.pointer("/template/settings").map(|_| "settings"),
                template.pointer("/template/mappings").map(|_| "mappings"),
                template.pointer("/template/aliases").map(|_| "aliases"),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");

            json!({
                "name": string_field(&item, "name"),
                "type": "component",
                "patterns": "-",
                "priority": "-",
                "components": template_parts,
                "version": template.get("version").map(display_json_scalar).unwrap_or_default(),
            })
        })
        .collect()
}

async fn search_pipelines(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_ingest/pipeline")
        .await
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|(name, pipeline)| {
            let processors = pipeline
                .get("processors")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or_default();
            let on_failure = pipeline
                .get("on_failure")
                .and_then(Value::as_array)
                .map(|items| items.len().to_string())
                .unwrap_or_else(|| "-".into());
            json!({
                "name": name,
                "description": string_field(&pipeline, "description"),
                "processors": processors,
                "onFailure": on_failure,
            })
        })
        .collect()
}

fn filter_named_rows(rows: Vec<Value>, name: Option<&str>) -> Vec<Value> {
    let Some(name) = name else {
        return rows;
    };

    rows.into_iter()
        .filter(|row| row.get("name").and_then(Value::as_str) == Some(name))
        .collect()
}

async fn search_security_payload(connection: &ResolvedConnectionProfile, kind: &str) -> Value {
    let users = if kind == "security" || kind == "users" {
        search_users(connection).await
    } else {
        Vec::new()
    };
    let roles = if kind == "security" || kind == "roles" {
        search_roles(connection).await
    } else {
        Vec::new()
    };
    let api_keys = if kind == "security" || kind == "api-keys" {
        search_api_keys(connection).await
    } else {
        Vec::new()
    };

    json!({
        "users": users,
        "roles": roles,
        "apiKeys": api_keys,
    })
}

async fn search_users(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_security/user")
        .await
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|(name, user)| {
            json!({
                "name": name,
                "realm": string_field(&user, "metadata._reserved"),
                "roles": user.get("roles").and_then(Value::as_array).map(|values| join_json_strings(values)).unwrap_or_default(),
                "enabled": user.get("enabled").map(display_json_scalar).unwrap_or_default(),
            })
        })
        .collect()
}

async fn search_roles(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_security/role")
        .await
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|(name, role)| {
            json!({
                "name": name,
                "clusterPrivileges": role.get("cluster").and_then(Value::as_array).map(|values| join_json_strings(values)).unwrap_or_default(),
                "indexPrivileges": role.get("indices").and_then(Value::as_array).map(|items| items.len().to_string()).unwrap_or_default(),
                "applicationPrivileges": role.get("applications").and_then(Value::as_array).map(|items| items.len().to_string()).unwrap_or_default(),
            })
        })
        .collect()
}

async fn search_api_keys(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_security/api_key")
        .await
        .and_then(|value| value.get("api_keys").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|key| {
            json!({
                "name": string_field(&key, "name"),
                "owner": string_field(&key, "username"),
                "status": if key.get("invalidated").and_then(Value::as_bool).unwrap_or(false) { "invalidated" } else { "active" },
                "expiresAt": key.get("expiration").map(display_json_scalar).unwrap_or_default(),
            })
        })
        .collect()
}

async fn search_diagnostics_payload(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    kind: &str,
) -> Value {
    json!({
        "shards": if kind == "diagnostics" || kind == "shards" { search_shards(connection, None).await } else { Vec::new() },
        "segments": if kind == "diagnostics" || kind == "segments" { search_segments(connection, None).await } else { Vec::new() },
        "tasks": if kind == "diagnostics" || kind == "tasks" { search_tasks(connection).await } else { Vec::new() },
        "snapshots": if kind == "diagnostics" || kind == "snapshots" { search_snapshots(connection).await } else { Vec::new() },
        "lifecyclePolicies": if kind == "diagnostics" || kind == "lifecycle-policies" { search_lifecycle_policies(engine, connection).await } else { Vec::new() },
    })
}

async fn search_tasks(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_tasks?detailed=true")
        .await
        .and_then(|value| value.get("nodes").and_then(Value::as_object).cloned())
        .unwrap_or_default()
        .into_iter()
        .flat_map(|(node, value)| {
            value
                .get("tasks")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(move |(_, task)| {
                    json!({
                        "action": string_field(&task, "action"),
                        "description": string_field(&task, "description"),
                        "runningTime": string_field(&task, "running_time"),
                        "cancellable": task.get("cancellable").map(display_json_scalar).unwrap_or_default(),
                        "node": node,
                    })
                })
        })
        .collect()
}

async fn search_snapshots(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    optional_search_json(connection, "/_snapshot/_all")
        .await
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|(repository, detail)| {
            json!({
                "repository": repository,
                "snapshot": "-",
                "state": string_field(&detail, "type"),
                "indices": string_field(&detail, "settings.location"),
                "startedAt": "-",
            })
        })
        .collect()
}

async fn search_lifecycle_policies(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
) -> Vec<Value> {
    if engine.engine == "opensearch" {
        return optional_search_json(connection, "/_plugins/_ism/policies")
            .await
            .and_then(|value| value.get("policies").and_then(Value::as_array).cloned())
            .unwrap_or_default()
            .into_iter()
            .map(|policy| {
                json!({
                    "name": string_field(&policy, "_id"),
                    "type": "ISM",
                    "phase": "-",
                    "managedIndices": "-",
                    "status": string_field(&policy, "policy.enabled"),
                })
            })
            .collect();
    }

    optional_search_json(connection, "/_ilm/policy")
        .await
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|(name, policy)| {
            json!({
                "name": name,
                "type": "ILM",
                "phase": "-",
                "managedIndices": "-",
                "status": policy.pointer("/policy/phases").map(|_| "defined").unwrap_or("visible"),
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

fn join_json_strings(values: &[Value]) -> String {
    values
        .iter()
        .map(display_json_scalar)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn string_field(value: &Value, key: &str) -> String {
    if let Some(value) = value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| value.get(key).map(display_json_scalar))
    {
        return value;
    }

    let pointer = format!("/{}", key.replace('.', "/"));
    value
        .pointer(&pointer)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            value
                .pointer(&pointer)
                .map(display_json_scalar)
                .unwrap_or_default()
        })
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
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "mapping:products").kind,
            "mappings"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "search:security:users").kind,
            "users"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "search:diagnostics:lifecycle").kind,
            "lifecycle-policies"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "pipeline:normalize-products").kind,
            "pipeline"
        );
        assert_eq!(
            SearchObjectTarget::from_node_id(ELASTICSEARCH, "index-template:products-template")
                .kind,
            "index-template"
        );
    }

    #[test]
    fn root_nodes_include_native_search_sections() {
        let connection = test_connection("Search");

        let labels = root_nodes(ELASTICSEARCH, &connection)
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Cluster",
                "Indices",
                "Data Streams",
                "Aliases",
                "Templates",
                "Pipelines",
                "Security",
                "Diagnostics"
            ]
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
    fn live_search_nodes_use_generic_object_ids() {
        let connection = test_connection("Search");
        let root = root_nodes(ELASTICSEARCH, &connection);
        assert_eq!(root[0].id, "search:cluster");
        assert_eq!(root[1].id, "search:indices");

        let detail = search_index_node_detail(
            ELASTICSEARCH,
            &json!({
                "health": "green",
                "docs.count": "42",
                "store.size": "128kb"
            }),
        );
        assert_eq!(detail, "green / 42 docs / 128kb");

        let alias_detail = search_alias_node_detail(&json!({
            "index": "products-v1",
            "is_write_index": "true",
            "routing.index": "tenant-a"
        }));
        assert_eq!(alias_detail, "products-v1 / write true / routing tenant-a");
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

    #[test]
    fn search_helpers_filter_and_read_nested_fields() {
        let rows = vec![
            json!({ "name": "products", "type": "index" }),
            json!({ "name": "logs", "type": "index" }),
        ];

        assert_eq!(filter_named_rows(rows.clone(), Some("products")).len(), 1);
        assert_eq!(filter_named_rows(rows, None).len(), 2);
        assert_eq!(
            string_field(
                &json!({ "settings": { "location": "/snapshots" } }),
                "settings.location"
            ),
            "/snapshots"
        );
        assert_eq!(
            string_field(&json!({ "docs.count": "42" }), "docs.count"),
            "42"
        );
    }

    fn test_connection(name: &str) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "search".into(),
            name: name.into(),
            engine: "elasticsearch".into(),
            family: "search".into(),
            host: "localhost".into(),
            port: Some(9200),
            database: None,
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
            read_only: false,
        }
    }
}
