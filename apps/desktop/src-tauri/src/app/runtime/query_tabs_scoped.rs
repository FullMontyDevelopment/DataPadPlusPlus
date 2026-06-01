use serde_json::json;

use super::{
    generate_id,
    library::effective_connection_environment_id,
    query_tabs::{
        default_query_text, default_query_view_mode, default_script_text,
        editor_label_for_connection, language_for_connection, query_tab_title_parts,
        unique_query_tab_title,
    },
};
use crate::domain::models::{
    ConnectionProfile, CreateScopedQueryTabRequest, QueryTabState, ScopedQueryTarget,
    WorkspaceSnapshot,
};

pub(super) fn build_scoped_query_tab(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    request: CreateScopedQueryTabRequest,
) -> QueryTabState {
    let builder_kind = scoped_builder_kind(connection, &request.target);
    let target_label = scoped_target_object_label(&request.target, connection);
    let limit = 20;
    let query_text = if builder_kind.as_deref() == Some("mongo-find") {
        mongo_find_query_text(
            &target_label,
            limit,
            connection.database.as_deref().map(str::trim),
        )
    } else if builder_kind.as_deref() == Some("mongo-aggregation") {
        mongo_aggregation_query_text(
            &target_label,
            limit,
            connection.database.as_deref().map(str::trim),
        )
    } else if builder_kind.as_deref() == Some("redis-key-browser") {
        redis_key_browser_query_text(
            &redis_pattern_from_target(&request.target),
            100,
            redis_database_index_from_target(&request.target),
        )
    } else {
        request
            .target
            .query_template
            .clone()
            .unwrap_or_else(|| default_query_text(connection))
    };
    let builder_state = match builder_kind.as_deref() {
        Some("mongo-find") => Some(mongo_find_builder_state(&target_label, &query_text, limit)),
        Some("mongo-aggregation") => Some(mongo_aggregation_builder_state(
            &target_label,
            &query_text,
            limit,
        )),
        Some("redis-key-browser") => Some(redis_key_browser_builder_state(
            &redis_pattern_from_target(&request.target),
            &query_text,
            redis_database_index_from_target(&request.target).unwrap_or(0),
        )),
        _ => None,
    };
    let title = scoped_query_tab_title(
        snapshot,
        connection,
        &target_label,
        matches!(
            builder_kind.as_deref(),
            Some("mongo-find" | "mongo-aggregation")
        ),
        builder_kind.as_deref(),
    );
    let environment_id =
        effective_connection_environment_id(snapshot, &connection.id, request.environment_id);

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
        query_view_mode: Some(if builder_kind.is_some() {
            "builder".into()
        } else {
            default_query_view_mode(connection)
        }),
        script_text: default_script_text(connection).map(|text| {
            if connection.engine == "mongodb" && builder_kind.as_deref() == Some("mongo-find") {
                format!("db.{target_label}.find({{}}).limit({limit})")
            } else if connection.engine == "mongodb"
                && builder_kind.as_deref() == Some("mongo-aggregation")
            {
                format!("db.{target_label}.aggregate([{{ $match: {{}} }}, {{ $limit: {limit} }}])")
            } else {
                text
            }
        }),
        scoped_target: Some(request.target),
        builder_state,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
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
    } else if connection.engine == "mongodb"
        && target.preferred_builder.as_deref() == Some("mongo-aggregation")
    {
        Some("mongo-aggregation".into())
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
    builder_kind: Option<&str>,
) -> String {
    let (_, extension) = query_tab_title_parts(connection);
    let candidate = if has_builder {
        if builder_kind == Some("mongo-aggregation") {
            format!("{target_label}.aggregate.{extension}")
        } else {
            format!("{target_label}.find.{extension}")
        }
    } else {
        format!("{target_label}.{extension}")
    };
    unique_query_tab_title(snapshot, &candidate)
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

fn scoped_target_object_label(
    target: &ScopedQueryTarget,
    connection: &ConnectionProfile,
) -> String {
    let scoped_object = if connection.engine == "mongodb" {
        target
            .scope
            .as_deref()
            .and_then(|scope| scope.split(':').rfind(|part| !part.is_empty()))
    } else {
        None
    };

    normalized_target_label(scoped_object.unwrap_or(&target.label))
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

fn mongo_aggregation_query_text(collection: &str, limit: u32, database: Option<&str>) -> String {
    let mut query = json!({
        "collection": collection,
        "operation": "aggregate",
        "pipeline": [
            { "$match": {} }
        ],
        "limit": limit,
    });

    if let Some(database) = database.filter(|value| !value.is_empty()) {
        query["database"] = json!(database);
    }

    serde_json::to_string_pretty(&query).unwrap_or_else(|_| {
        format!(
            "{{\n  \"collection\": \"{collection}\",\n  \"operation\": \"aggregate\",\n  \"pipeline\": [{{ \"$match\": {{}} }}, {{ \"$limit\": {limit} }}],\n  \"limit\": {limit}\n}}"
        )
    })
}

fn mongo_aggregation_builder_state(
    collection: &str,
    query_text: &str,
    limit: u32,
) -> serde_json::Value {
    json!({
        "kind": "mongo-aggregation",
        "collection": collection,
        "stages": [
            { "id": "stage-match", "enabled": true, "stage": "$match", "body": "{}" },
        ],
        "limit": limit,
        "lastAppliedQueryText": query_text,
    })
}

fn redis_key_browser_query_text(pattern: &str, count: u32, database_index: Option<u32>) -> String {
    let mut query = json!({
        "mode": "redis-key-browser",
        "pattern": pattern,
        "type": "all",
        "count": count,
    });

    if let Some(database_index) = database_index {
        query["database"] = json!(database_index);
    }

    serde_json::to_string_pretty(&query).unwrap_or_else(|_| {
        format!(
            "{{\n  \"mode\": \"redis-key-browser\",\n  \"pattern\": \"{pattern}\",\n  \"type\": \"all\",\n  \"count\": {count}\n}}"
        )
    })
}

fn redis_key_browser_builder_state(
    pattern: &str,
    query_text: &str,
    database_index: u32,
) -> serde_json::Value {
    let mut scan_cursor_by_db = serde_json::Map::new();
    scan_cursor_by_db.insert(database_index.to_string(), json!("0"));

    json!({
        "kind": "redis-key-browser",
        "pattern": pattern,
        "typeFilter": "all",
        "databaseIndex": database_index,
        "delimiter": ":",
        "cursor": "0",
        "scanCount": 100,
        "pageSize": 100,
        "scannedCount": 0,
        "scanCursorByDb": scan_cursor_by_db,
        "filters": { "ttl": "all" },
        "expandedPrefixes": [],
        "visibleColumns": ["ttl", "memory", "length"],
        "viewMode": "tree",
        "lastAppliedQueryText": query_text,
    })
}

fn redis_pattern_from_target(target: &ScopedQueryTarget) -> String {
    if target.kind == "database"
        || target.scope.as_deref().is_some_and(|scope| {
            let Some(rest) = scope.strip_prefix("db:") else {
                return false;
            };
            rest.chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
    {
        return "*".into();
    }

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

fn redis_database_index_from_target(target: &ScopedQueryTarget) -> Option<u32> {
    let scoped_database = target
        .scope
        .as_deref()
        .and_then(redis_database_index_from_scope);
    let label_database = redis_database_index_from_label(&target.label);
    let path_database = target
        .path
        .iter()
        .find_map(|part| redis_database_index_from_label(part));

    scoped_database.or(label_database).or(path_database)
}

fn redis_database_index_from_scope(scope: &str) -> Option<u32> {
    let rest = scope.strip_prefix("db:")?;
    let digits: String = rest
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();

    digits.parse::<u32>().ok()
}

fn redis_database_index_from_label(label: &str) -> Option<u32> {
    label
        .trim()
        .strip_prefix("DB ")
        .and_then(|value| value.parse::<u32>().ok())
}
