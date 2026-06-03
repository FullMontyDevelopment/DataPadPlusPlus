use serde_json::json;

use super::{
    generate_id,
    library::effective_connection_environment_id,
    query_tabs::{
        default_query_text, default_query_view_mode, default_script_text,
        editor_label_for_connection, language_for_connection, query_tab_title_parts,
        unique_query_tab_title,
    },
    query_tabs_scoped_redis::{
        redis_database_index_from_target, redis_key_browser_builder_state,
        redis_key_browser_query_text, redis_pattern_from_target,
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
    let target_object_name = scoped_target_object_name(&request.target, connection);
    let target_label =
        scoped_target_object_label(&request.target, connection, target_object_name.as_deref());
    let limit = 20;
    let query_text = if builder_kind.as_deref() == Some("mongo-find") {
        mongo_find_query_text(
            target_object_name.as_deref().unwrap_or_default(),
            limit,
            connection.database.as_deref().map(str::trim),
        )
    } else if builder_kind.as_deref() == Some("mongo-aggregation") {
        mongo_aggregation_query_text(
            target_object_name.as_deref().unwrap_or_default(),
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
        Some("mongo-find") => Some(mongo_find_builder_state(
            target_object_name.as_deref().unwrap_or_default(),
            &query_text,
            limit,
        )),
        Some("mongo-aggregation") => Some(mongo_aggregation_builder_state(
            target_object_name.as_deref().unwrap_or_default(),
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
                target_object_name
                    .as_ref()
                    .map(|collection| format!("db.{collection}.find({{}}).limit({limit})"))
                    .unwrap_or_default()
            } else if connection.engine == "mongodb"
                && builder_kind.as_deref() == Some("mongo-aggregation")
            {
                target_object_name
                    .as_ref()
                    .map(|collection| {
                        format!(
                            "db.{collection}.aggregate([{{ $match: {{}} }}, {{ $limit: {limit} }}])"
                        )
                    })
                    .unwrap_or_default()
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
    target_object_name: Option<&str>,
) -> String {
    if connection.engine == "mongodb" {
        return normalized_target_label(target_object_name.unwrap_or_default());
    }

    normalized_target_label(&target.label)
}

fn scoped_target_object_name(
    target: &ScopedQueryTarget,
    connection: &ConnectionProfile,
) -> Option<String> {
    if connection.engine != "mongodb" {
        return None;
    }

    if let Some(scope) = target.scope.as_deref() {
        let parts: Vec<&str> = scope.split(':').filter(|part| !part.is_empty()).collect();
        let scope_kind = parts.first().copied().unwrap_or_default();
        if matches!(
            scope_kind,
            "collection" | "documents" | "aggregation" | "view" | "gridfs"
        ) {
            if parts.len() >= 3 {
                return non_empty_object_name(&parts[2..].join(":"));
            }
            if parts.len() == 2 && scope_kind != "aggregation" {
                return non_empty_object_name(parts[1]);
            }
        }
    }

    let object_container_index = ["Collections", "Views", "GridFS"]
        .iter()
        .filter_map(|container| target.path.iter().position(|part| part == container))
        .min();

    object_container_index
        .and_then(|index| target.path.get(index + 1))
        .and_then(|value| non_empty_object_name(value))
}

fn non_empty_object_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.into())
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
