use serde_json::json;

use super::generate_id;
use crate::domain::models::{
    ConnectionProfile, CreateScopedQueryTabRequest, QueryTabState, SavedWorkItem,
    ScopedQueryTarget, WorkspaceSnapshot,
};

pub(super) fn default_query_text(connection: &ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" | "litedb" => {
            "{\n  \"collection\": \"products\",\n  \"filter\": {},\n  \"limit\": 50\n}".into()
        }
        "dynamodb" => "{\n  \"operation\": \"Query\",\n  \"tableName\": \"Orders\",\n  \"keyConditionExpression\": \"#pk = :pk\",\n  \"expressionAttributeNames\": { \"#pk\": \"pk\" },\n  \"expressionAttributeValues\": { \":pk\": { \"S\": \"CUSTOMER#123\" } },\n  \"limit\": 25\n}".into(),
        "cosmosdb" => "select top 50 * from c".into(),
        "redis" | "valkey" => "SCAN 0 MATCH session:* COUNT 25".into(),
        "memcached" => "stats".into(),
        "cassandra" => "select * from keyspace.table limit 25;".into(),
        "neo4j" => "MATCH (n) RETURN n LIMIT 25".into(),
        "neptune" | "janusgraph" => "g.V().limit(25)".into(),
        "arango" => "FOR doc IN collection LIMIT 25 RETURN doc".into(),
        "influxdb" => "SELECT * FROM measurement LIMIT 25".into(),
        "prometheus" => "up".into(),
        "opentsdb" => "{\n  \"start\": \"1h-ago\",\n  \"queries\": [\n    { \"metric\": \"sys.cpu.user\", \"aggregator\": \"avg\" }\n  ]\n}".into(),
        "elasticsearch" | "opensearch" => {
            "{\n  \"index\": \"products\",\n  \"body\": {\n    \"query\": { \"match_all\": {} },\n    \"size\": 20\n  }\n}".into()
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
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
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
        environment_id: connection
            .environment_ids
            .first()
            .cloned()
            .unwrap_or_else(|| "env-dev".into()),
        family: connection.family.clone(),
        language: "text".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Explorer".into(),
        query_text: String::new(),
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
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
        scoped_target: None,
        builder_state: None,
        metrics_state: Some(json!({
            "connectionId": connection.id.clone(),
            "environmentId": metrics_environment_id,
            "warnings": []
        })),
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

pub(super) fn build_scoped_query_tab(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    request: CreateScopedQueryTabRequest,
) -> QueryTabState {
    let builder_kind = scoped_builder_kind(connection, &request.target);
    let target_label = normalized_target_label(&request.target.label);
    let limit = 50;
    let query_text = if builder_kind.as_deref() == Some("mongo-find") {
        mongo_find_query_text(
            &target_label,
            limit,
            connection.database.as_deref().map(str::trim),
        )
    } else if builder_kind.as_deref() == Some("redis-key-browser") {
        redis_key_browser_query_text(&redis_pattern_from_target(&request.target), 100)
    } else {
        request
            .target
            .query_template
            .clone()
            .unwrap_or_else(|| default_query_text(connection))
    };
    let builder_state = match builder_kind.as_deref() {
        Some("mongo-find") => Some(mongo_find_builder_state(&target_label, &query_text, limit)),
        Some("redis-key-browser") => Some(redis_key_browser_builder_state(
            &redis_pattern_from_target(&request.target),
            &query_text,
        )),
        _ => None,
    };
    let title = scoped_query_tab_title(
        snapshot,
        connection,
        &target_label,
        builder_kind.as_deref() == Some("mongo-find"),
    );
    let environment_id = request
        .environment_id
        .or_else(|| connection.environment_ids.first().cloned())
        .unwrap_or_else(|| "env-dev".into());

    QueryTabState {
        id: generate_id("tab"),
        title,
        tab_kind: Some("query".into()),
        connection_id: connection.id.clone(),
        environment_id,
        family: connection.family.clone(),
        language: language_for_connection(connection),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: editor_label_for_connection(connection),
        query_text,
        scoped_target: Some(request.target),
        builder_state,
        metrics_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        dirty: true,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

fn scoped_builder_kind(
    connection: &ConnectionProfile,
    target: &ScopedQueryTarget,
) -> Option<String> {
    if connection.engine == "mongodb" && target.preferred_builder.as_deref() == Some("mongo-find") {
        Some("mongo-find".into())
    } else if matches!(connection.engine.as_str(), "redis" | "valkey")
        && target.preferred_builder.as_deref() == Some("redis-key-browser")
    {
        Some("redis-key-browser".into())
    } else {
        None
    }
}

fn scoped_query_tab_title(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    target_label: &str,
    has_builder: bool,
) -> String {
    let (_, extension) = query_tab_title_parts(connection);
    let candidate = if has_builder {
        format!("{target_label}.find.{extension}")
    } else {
        format!("{target_label}.{extension}")
    };
    unique_query_tab_title(snapshot, &candidate)
}

fn unique_query_tab_title(snapshot: &WorkspaceSnapshot, candidate: &str) -> String {
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

fn normalized_target_label(label: &str) -> String {
    let trimmed = label.trim();

    if trimmed.is_empty() {
        "query".into()
    } else {
        trimmed
            .chars()
            .map(|character| {
                if character.is_control() || character == '/' || character == '\\' {
                    '_'
                } else {
                    character
                }
            })
            .take(80)
            .collect()
    }
}

fn mongo_find_query_text(collection: &str, limit: u32, database: Option<&str>) -> String {
    let mut query = json!({
        "collection": collection,
        "filter": {},
        "limit": limit,
    });

    if let Some(database) = database.filter(|value| !value.is_empty()) {
        query["database"] = json!(database);
    }

    serde_json::to_string_pretty(&query).unwrap_or_else(|_| {
        format!(
            "{{\n  \"collection\": \"{collection}\",\n  \"filter\": {{}},\n  \"limit\": {limit}\n}}"
        )
    })
}

fn mongo_find_builder_state(collection: &str, query_text: &str, limit: u32) -> serde_json::Value {
    json!({
        "kind": "mongo-find",
        "collection": collection,
        "filters": [],
        "projectionMode": "all",
        "projectionFields": [],
        "sort": [],
        "skip": 0,
        "limit": limit,
        "lastAppliedQueryText": query_text,
    })
}

fn redis_key_browser_query_text(pattern: &str, count: u32) -> String {
    serde_json::to_string_pretty(&json!({
        "mode": "redis-key-browser",
        "pattern": pattern,
        "type": "all",
        "count": count,
    }))
    .unwrap_or_else(|_| {
        format!(
            "{{\n  \"mode\": \"redis-key-browser\",\n  \"pattern\": \"{pattern}\",\n  \"type\": \"all\",\n  \"count\": {count}\n}}"
        )
    })
}

fn redis_key_browser_builder_state(pattern: &str, query_text: &str) -> serde_json::Value {
    json!({
        "kind": "redis-key-browser",
        "pattern": pattern,
        "typeFilter": "all",
        "cursor": "0",
        "scanCount": 100,
        "pageSize": 100,
        "scannedCount": 0,
        "expandedPrefixes": [],
        "visibleColumns": ["ttl", "memory", "length"],
        "viewMode": "tree",
        "lastAppliedQueryText": query_text,
    })
}

fn redis_pattern_from_target(target: &ScopedQueryTarget) -> String {
    let scoped_prefix = target
        .scope
        .as_deref()
        .and_then(|scope| scope.strip_prefix("prefix:"));
    let candidate = scoped_prefix.unwrap_or(target.label.as_str()).trim();

    if candidate.is_empty() {
        "*".into()
    } else if candidate.contains('*') {
        candidate.into()
    } else if candidate.ends_with(':') {
        format!("{candidate}*")
    } else {
        candidate.into()
    }
}
