use serde_json::json;

pub(super) use super::query_tabs_scoped::build_scoped_query_tab;
use super::{generate_id, library::effective_connection_environment_id};
use crate::domain::models::{
    ConnectionProfile, CreateObjectViewTabRequest, EnvironmentProfile, QueryTabState,
    SavedWorkItem, WorkspaceSnapshot,
};

pub(super) fn default_query_text(connection: &ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" | "litedb" => {
            "{\n  \"collection\": \"\",\n  \"filter\": {},\n  \"limit\": 20\n}".into()
        }
        "dynamodb" => "{\n  \"operation\": \"Scan\",\n  \"tableName\": \"\",\n  \"limit\": 25\n}".into(),
        "cosmosdb" => "select top 50 * from c".into(),
        "redis" | "valkey" => "SCAN 0 MATCH * COUNT 25".into(),
        "memcached" => "stats".into(),
        "cassandra" => String::new(),
        "neo4j" => "MATCH (n) RETURN n LIMIT 25".into(),
        "neptune" | "janusgraph" => "g.V().limit(25)".into(),
        "arango" => String::new(),
        "influxdb" => String::new(),
        "prometheus" => "up".into(),
        "opentsdb" => "{\n  \"start\": \"1h-ago\",\n  \"queries\": []\n}".into(),
        "elasticsearch" | "opensearch" => {
            "{\n  \"index\": \"\",\n  \"body\": {\n    \"query\": { \"match_all\": {} },\n    \"size\": 20\n  }\n}".into()
        }
        _ => "select 1;".into(),
    }
}

pub(super) fn language_for_connection(connection: &ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" => "mongodb".into(),
        "redis" | "valkey" => "redis".into(),
        "cassandra" => "cql".into(),
        "neo4j" => "cypher".into(),
        "neptune" | "janusgraph" => "gremlin".into(),
        "arango" => "aql".into(),
        "prometheus" => "promql".into(),
        "influxdb" => "influxql".into(),
        "opentsdb" => "opentsdb".into(),
        "elasticsearch" | "opensearch" => "query-dsl".into(),
        "bigquery" => "google-sql".into(),
        "snowflake" => "snowflake-sql".into(),
        "clickhouse" => "clickhouse-sql".into(),
        "dynamodb" | "litedb" => "json".into(),
        _ => "sql".into(),
    }
}

pub(super) fn editor_label_for_connection(connection: &ConnectionProfile) -> String {
    match language_for_connection(connection).as_str() {
        "mongodb" | "json" => "Document query".into(),
        "redis" => {
            if connection.engine == "valkey" {
                "Valkey console".into()
            } else {
                "Redis console".into()
            }
        }
        "cypher" => "Cypher editor".into(),
        "gremlin" => "Gremlin editor".into(),
        "sparql" => "SPARQL editor".into(),
        "aql" => "AQL editor".into(),
        "promql" => "PromQL editor".into(),
        "influxql" | "flux" | "opentsdb" => "Time-series query".into(),
        "query-dsl" => "Search DSL editor".into(),
        "google-sql" => "GoogleSQL editor".into(),
        "snowflake-sql" => "Snowflake SQL editor".into(),
        "clickhouse-sql" => "ClickHouse SQL editor".into(),
        "cql" => "CQL editor".into(),
        _ => "SQL editor".into(),
    }
}

pub(super) fn default_query_view_mode(connection: &ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" | "redis" | "valkey" | "dynamodb" | "cassandra" | "elasticsearch"
        | "opensearch" => "builder".into(),
        _ => "raw".into(),
    }
}

pub(super) fn default_script_text(connection: &ConnectionProfile) -> Option<String> {
    if connection.engine == "mongodb" {
        Some(String::new())
    } else {
        None
    }
}

pub(super) fn query_tab_title_parts(
    connection: &ConnectionProfile,
) -> (&'static str, &'static str) {
    if connection.engine == "dynamodb" || connection.family == "search" {
        return ("Query", "json");
    }

    match connection.family.as_str() {
        "document" => ("Query", "json"),
        "keyvalue" => ("Console", "redis"),
        _ => ("Query", "sql"),
    }
}

pub(super) fn next_query_tab_title(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
) -> String {
    let (prefix, extension) = query_tab_title_parts(connection);
    let mut index = 1;
    let mut title = format!("{prefix} {index}.{extension}");

    while snapshot.tabs.iter().any(|tab| tab.title == title) {
        index += 1;
        title = format!("{prefix} {index}.{extension}");
    }

    title
}

pub(super) fn normalize_tab_title(title: &str, fallback: &str) -> String {
    let trimmed = title.trim();

    if trimmed.is_empty() {
        fallback.into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub(super) fn upsert_saved_work_item(saved_work: &mut Vec<SavedWorkItem>, item: SavedWorkItem) {
    if let Some(index) = saved_work
        .iter()
        .position(|existing| existing.id == item.id)
    {
        saved_work[index] = item;
    } else {
        saved_work.push(item);
    }
}

pub(super) fn build_query_tab(
    connection: &ConnectionProfile,
    dirty: bool,
    title: String,
) -> QueryTabState {
    QueryTabState {
        id: generate_id("tab"),
        title,
        tab_kind: Some("query".into()),
        connection_id: connection.id.clone(),
        environment_id: connection
            .environment_ids
            .first()
            .cloned()
            .unwrap_or_else(|| "env-dev".into()),
        family: connection.family.clone(),
        language: language_for_connection(connection),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: editor_label_for_connection(connection),
        query_text: default_query_text(connection),
        query_view_mode: Some(default_query_view_mode(connection)),
        script_text: default_script_text(connection),
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn build_explorer_tab(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
) -> QueryTabState {
    let title = unique_query_tab_title(snapshot, &format!("Explorer - {}", connection.name));

    QueryTabState {
        id: generate_id("tab"),
        title,
        tab_kind: Some("explorer".into()),
        connection_id: connection.id.clone(),
        environment_id: effective_connection_environment_id(snapshot, &connection.id, None),
        family: connection.family.clone(),
        language: "text".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Explorer".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn build_metrics_tab(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    environment_id: String,
) -> QueryTabState {
    let title = unique_query_tab_title(snapshot, &format!("Metrics - {}", connection.name));
    let metrics_environment_id = environment_id.clone();

    QueryTabState {
        id: generate_id("metrics-tab"),
        title,
        tab_kind: Some("metrics".into()),
        connection_id: connection.id.clone(),
        environment_id,
        family: connection.family.clone(),
        language: "json".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Metrics".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: Some(json!({
            "connectionId": connection.id.clone(),
            "environmentId": metrics_environment_id,
            "warnings": []
        })),
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn build_environment_tab(
    snapshot: &WorkspaceSnapshot,
    environment: &EnvironmentProfile,
) -> QueryTabState {
    let connection = snapshot
        .connections
        .iter()
        .find(|connection| connection.id == snapshot.ui.active_connection_id)
        .or_else(|| snapshot.connections.first());
    let title = unique_query_tab_title(snapshot, &format!("Environment - {}", environment.label));

    QueryTabState {
        id: generate_id("environment-tab"),
        title,
        tab_kind: Some("environment".into()),
        connection_id: connection
            .map(|connection| connection.id.clone())
            .unwrap_or_default(),
        environment_id: environment.id.clone(),
        family: connection
            .map(|connection| connection.family.clone())
            .unwrap_or_else(|| "sql".into()),
        language: "text".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Environment".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn build_object_view_tab(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    request: CreateObjectViewTabRequest,
    environment_id: String,
) -> QueryTabState {
    let title = unique_query_tab_title(snapshot, &object_view_title(&request, connection));

    QueryTabState {
        id: generate_id("object-view-tab"),
        title,
        tab_kind: Some("object-view".into()),
        connection_id: connection.id.clone(),
        environment_id: environment_id.clone(),
        family: connection.family.clone(),
        language: "json".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Object view".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: Some(json!({
            "connectionId": connection.id.clone(),
            "environmentId": environment_id,
            "nodeId": request.node_id,
            "label": request.label,
            "kind": request.kind,
            "path": request.path,
            "warnings": []
        })),
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn unique_query_tab_title(snapshot: &WorkspaceSnapshot, candidate: &str) -> String {
    if !snapshot.tabs.iter().any(|tab| tab.title == candidate) {
        return candidate.into();
    }

    let (stem, extension) = candidate
        .rsplit_once('.')
        .map(|(stem, extension)| (stem.to_string(), format!(".{extension}")))
        .unwrap_or_else(|| (candidate.to_string(), String::new()));
    let mut index = 2;
    let mut title = format!("{stem} {index}{extension}");

    while snapshot.tabs.iter().any(|tab| tab.title == title) {
        index += 1;
        title = format!("{stem} {index}{extension}");
    }

    title
}

fn object_view_title(
    request: &CreateObjectViewTabRequest,
    connection: &ConnectionProfile,
) -> String {
    let path = request.path.clone().unwrap_or_default();
    let parent = path.last().filter(|item| item.as_str() != request.label);

    if let Some(parent) = parent {
        format!("{parent} - {}", request.label)
    } else if request.label.trim().is_empty() {
        format!("View - {}", connection.name)
    } else {
        request.label.clone()
    }
}
