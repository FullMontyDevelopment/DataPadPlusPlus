use std::fs;

use crate::domain::models::ExplorerPageInfo;
use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::litedb_execution_capabilities;
use super::connection::{litedb_file_path, litedb_local_file_preflight, require_litedb_sidecar};
use super::query::{execute_litedb_sidecar_operation, litedb_live_sidecar_boundary};

pub(super) async fn list_litedb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("litedb:database") => database_child_nodes(connection),
        Some("litedb:collections") => collection_nodes(connection).await?,
        Some(scope) if scope.starts_with("litedb:collection:") => {
            collection_child_nodes(connection, scope)
        }
        Some("litedb:indexes") => collection_index_nodes(connection, None).await?,
        Some(scope) if scope.starts_with("litedb:collection-indexes:") => {
            let collection = scope.trim_start_matches("litedb:collection-indexes:");
            collection_index_nodes(connection, Some(collection)).await?
        }
        Some("litedb:file-storage") => file_storage_child_nodes(connection),
        Some("litedb:storage") => Vec::new(),
        Some("litedb:pragmas") => Vec::new(),
        Some("litedb:maintenance") => maintenance_child_nodes(connection),
        Some("litedb:diagnostics") => diagnostics_child_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    let scope = request.scope.as_deref().unwrap_or("root");
    let offset = match request.cursor.as_deref() {
        None => 0,
        Some(cursor) => cursor
            .rsplit_once('|')
            .filter(|(saved, _)| *saved == scope)
            .and_then(|(_, offset)| offset.parse::<usize>().ok())
            .filter(|offset| *offset <= nodes.len())
            .ok_or_else(|| {
                CommandError::new(
                    "litedb-explorer-cursor-invalid",
                    "This Explorer page is no longer valid. Refresh the branch.",
                )
            })?,
    };
    let total = nodes.len();
    let nodes = nodes
        .into_iter()
        .skip(offset)
        .take(request.limit.unwrap_or(100).clamp(1, 1000) as usize)
        .collect::<Vec<_>>();
    let end = offset + nodes.len();
    let page_info = Some(ExplorerPageInfo {
        cursor: request.cursor.clone(),
        next_cursor: (end < total).then(|| format!("{scope}|{end}")),
        returned_count: nodes.len() as u32,
        known_total: Some(total as u32),
        has_more: end < total,
    });
    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} LiteDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: litedb_execution_capabilities(),
        nodes,
        page_info,
    })
}

pub(super) async fn inspect_litedb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = litedb_query_template(&request.node_id);
    let payload = litedb_inspection_payload(connection, &request.node_id).await?;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "LiteDB metadata view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

async fn collection_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let sidecar = require_litedb_sidecar(connection)?;
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ListCollections",
        &json!({}),
        1000,
        &sidecar,
        true,
    )
    .await?;
    let rows = outcome.response["collections"].as_array().ok_or_else(|| {
        CommandError::new(
            "litedb-metadata-invalid",
            "The LiteDB runtime returned invalid collection metadata.",
        )
    })?;
    let mut names = rows
        .iter()
        .filter_map(|row| row.as_str().or_else(|| row["name"].as_str()))
        .collect::<Vec<_>>();
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    Ok(names
        .into_iter()
        .map(|name| {
            litedb_node(
                &format!("litedb:collection:{name}"),
                name,
                "collection",
                "LiteDB document collection",
                Some(&format!("litedb:collection:{name}")),
                true,
                Some(find_template(name)),
                vec![litedb_file_name(connection), "Collections".into()],
            )
        })
        .collect())
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:database",
            &litedb_file_name(connection),
            "database",
            "Local LiteDB file overview",
            Some("litedb:database"),
            true,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![],
        ),
        litedb_node(
            "litedb:diagnostics",
            "Diagnostics",
            "diagnostics",
            "File health, storage pressure, and index coverage",
            Some("litedb:diagnostics"),
            false,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![],
        ),
    ]
}

fn database_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:collections",
            "Collections",
            "collections",
            "Document collections",
            Some("litedb:collections"),
            true,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:indexes",
            "Indexes",
            "indexes",
            "Collection index definitions",
            Some("litedb:indexes"),
            true,
            Some(json!({ "operation": "ListIndexes" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:file-storage",
            "File Storage",
            "file-storage",
            "Stored files and chunk health",
            Some("litedb:file-storage"),
            true,
            None,
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:storage",
            "Storage",
            "storage",
            "Page allocation, file size, and free-space posture",
            Some("litedb:storage"),
            false,
            Some(json!({ "operation": "Statistics" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:pragmas",
            "Pragmas",
            "pragmas",
            "LiteDB file options and runtime settings",
            Some("litedb:pragmas"),
            false,
            Some(json!({ "operation": "ListCollections" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
        litedb_node(
            "litedb:maintenance",
            "Maintenance",
            "maintenance",
            "Checkpoint, compact, rebuild, and backup workflows",
            Some("litedb:maintenance"),
            true,
            Some(json!({ "operation": "Diagnostics" }).to_string()),
            vec![litedb_file_name(connection)],
        ),
    ]
}

fn maintenance_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:checkpoint",
            "Checkpoint",
            "maintenance",
            "Flush pending pages without changing collection data",
            Some("litedb:checkpoint"),
            false,
            None,
            vec![litedb_file_name(connection), "Maintenance".into()],
        ),
        litedb_node(
            "litedb:compact",
            "Compact Copy",
            "maintenance",
            "Create a compacted copy after backup validation",
            Some("litedb:compact"),
            false,
            None,
            vec![litedb_file_name(connection), "Maintenance".into()],
        ),
        litedb_node(
            "litedb:rebuild-indexes",
            "Rebuild Indexes",
            "maintenance",
            "Rebuild collection indexes through guarded maintenance",
            Some("litedb:rebuild-indexes"),
            false,
            None,
            vec![litedb_file_name(connection), "Maintenance".into()],
        ),
        litedb_node(
            "litedb:backup",
            "Backup",
            "backup",
            "Create a safe local database copy",
            Some("litedb:backup"),
            false,
            None,
            vec![litedb_file_name(connection), "Maintenance".into()],
        ),
    ]
}

fn collection_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let collection = scope.trim_start_matches("litedb:collection:");
    vec![
        litedb_node(
            &format!("litedb:documents:{collection}"),
            "Documents",
            "documents",
            "Open a bounded document query",
            Some(&format!("litedb:documents:{collection}")),
            false,
            Some(find_template(collection)),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:schema:{collection}"),
            "Schema Preview",
            "schema",
            "Inferred field paths and value types",
            Some(&format!("litedb:schema:{collection}")),
            false,
            Some(
                json!({ "operation": "Schema", "collection": collection, "limit": 100 })
                    .to_string(),
            ),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:collection-indexes:{collection}"),
            "Indexes",
            "indexes",
            "Collection index definitions",
            Some(&format!("litedb:collection-indexes:{collection}")),
            true,
            Some(json!({ "operation": "ListIndexes", "collection": collection }).to_string()),
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:collection-statistics:{collection}"),
            "Statistics",
            "statistics",
            "Collection counts, index coverage, and storage signals",
            Some(&format!("litedb:collection-statistics:{collection}")),
            false,
            None,
            vec![litedb_file_name(connection), collection.into()],
        ),
        litedb_node(
            &format!("litedb:collection-storage:{collection}"),
            "Storage",
            "storage",
            "Collection page allocation and free-space posture",
            Some(&format!("litedb:collection-storage:{collection}")),
            false,
            Some(json!({ "operation": "Statistics", "collection": collection }).to_string()),
            vec![litedb_file_name(connection), collection.into()],
        ),
    ]
}

async fn collection_index_nodes(
    connection: &ResolvedConnectionProfile,
    collection: Option<&str>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let sidecar = require_litedb_sidecar(connection)?;
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ListIndexes",
        &json!({"collection": collection}),
        1000,
        &sidecar,
        true,
    )
    .await?;
    let rows = outcome.response["indexes"].as_array().ok_or_else(|| {
        CommandError::new(
            "litedb-metadata-invalid",
            "The LiteDB runtime returned invalid index metadata.",
        )
    })?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let name = row["name"].as_str()?;
            let owner = row["collection"].as_str()?;
            let label = if collection.is_some() {
                name.to_string()
            } else {
                format!("{owner}.{name}")
            };
            let path = if collection.is_some() {
                vec![
                    litedb_file_name(connection),
                    "Collections".into(),
                    owner.into(),
                    "Indexes".into(),
                ]
            } else {
                vec![litedb_file_name(connection), "Indexes".into()]
            };
            Some(litedb_node(
                &format!("litedb:index:{owner}:{name}"),
                &label,
                "index",
                &format!(
                    "{}{}",
                    row["expression"].as_str().unwrap_or(""),
                    if row["unique"] == true {
                        " | unique"
                    } else {
                        ""
                    }
                ),
                Some(&format!("litedb:index:{owner}:{name}")),
                false,
                Some(json!({"operation": "ListIndexes", "collection": owner}).to_string()),
                path,
            ))
        })
        .collect())
}

fn file_storage_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        litedb_node(
            "litedb:files",
            "Files",
            "files",
            "File metadata and chunk counts",
            Some("litedb:files"),
            false,
            None,
            vec![litedb_file_name(connection), "File Storage".into()],
        ),
        litedb_node(
            "litedb:chunks",
            "Chunks",
            "chunks",
            "Chunk distribution and missing chunks",
            Some("litedb:chunks"),
            false,
            None,
            vec![litedb_file_name(connection), "File Storage".into()],
        ),
    ]
}

fn diagnostics_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![litedb_node(
        "litedb:file-health",
        "File Health",
        "diagnostics",
        "Local file availability and safety posture",
        Some("litedb:file-health"),
        false,
        Some(json!({ "operation": "ListCollections" }).to_string()),
        vec![litedb_file_name(connection), "Diagnostics".into()],
    )]
}

async fn litedb_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Result<Value, CommandError> {
    let object_view = litedb_object_view(node_id);
    let collection = collection_from_node_id(node_id);
    let sidecar = require_litedb_sidecar(connection)?;
    let metadata = execute_litedb_sidecar_operation(
        connection,
        "GetMetadata",
        &json!({"collection": collection}),
        1000,
        &sidecar,
        true,
    )
    .await?;
    let mut live_boundary =
        litedb_live_sidecar_boundary(Some(&sidecar), "GetMetadata", metadata.evidence, false);
    live_boundary["engineRuntimeValidated"] = metadata.response["engineOpenValidated"].clone();
    let metadata = metadata.response;
    let file_path = litedb_file_path(connection);
    let file_size = file_size_label(&file_path);
    let mut local_file_preflight = litedb_local_file_preflight(connection, false);
    local_file_preflight["sidecarExecutionBoundary"] = live_boundary.clone();
    local_file_preflight["encryptionBoundary"]["liveValidation"] = json!("engine-open-succeeded");
    let file_exists = local_file_preflight["exists"].as_bool().unwrap_or(false);
    let read_probe_status = local_file_preflight["readProbe"]["status"].clone();
    let write_probe_status = local_file_preflight["writeProbe"]["status"].clone();
    let mut warnings = Vec::new();

    if !file_exists {
        warnings
            .push("LiteDB file metadata is unavailable; verify the local file path.".to_string());
    }

    let collections = metadata["collections"].clone();
    let indexes = metadata["indexes"].clone();
    let fields = if collection.is_some() && matches!(object_view, "schema" | "collection") {
        execute_litedb_sidecar_operation(
            connection,
            "SampleSchema",
            &json!({"collection": collection, "limit": 25}),
            25,
            &sidecar,
            true,
        )
        .await?
        .response["fields"]
            .clone()
    } else {
        json!([])
    };
    let settings = vec![
        json!({ "name": "File", "value": file_path, "scope": "local file" }),
        json!({ "name": "Mode", "value": "local-file", "scope": "connection" }),
        json!({ "name": "Password", "value": if connection.password.is_some() { "stored secret" } else { "not configured" }, "scope": "secret store" }),
        json!({ "name": "Read Only", "value": connection.read_only, "scope": "safety" }),
    ];
    let pragmas = metadata["pragmas"].clone();
    let storage = vec![
        json!({ "name": "File Size", "value": file_size, "status": if file_exists { "healthy" } else { "watch" }, "guidance": "Local file size is read directly from the filesystem." }),
        json!({ "name": "Collections", "value": metadata["collectionCount"], "status": "healthy", "guidance": "Read from the LiteDB engine." }),
    ];
    let maintenance = vec![
        json!({ "name": "Checkpoint", "effect": "Flush pending pages", "risk": "low", "status": "preview" }),
        json!({ "name": "Compact Copy", "effect": "Write a compacted database copy", "risk": "medium", "status": "guarded" }),
        json!({ "name": "Rebuild Indexes", "effect": "Rebuild collection index structures", "risk": "medium", "status": "guarded" }),
        json!({ "name": "Backup", "effect": "Copy database file after checkpoint", "risk": "low", "status": "preview" }),
    ];
    let statistics = vec![
        json!({ "name": "Documents", "value": metadata["documentCount"], "scope": "selected scope" }),
        json!({ "name": "Indexes", "value": metadata["indexCount"], "scope": "selected scope" }),
        json!({ "name": "Average Document Size", "value": "-", "scope": "collection" }),
        json!({ "name": "Storage Pages", "value": "-", "scope": "collection" }),
    ];
    let diagnostics = vec![
        json!({ "signal": "File Available", "value": file_exists, "status": if file_exists { "healthy" } else { "watch" }, "guidance": "Queries need the configured local file to exist and be accessible." }),
        json!({ "signal": "Read Open Probe", "value": read_probe_status, "status": if local_file_preflight["readProbe"]["status"].as_str() == Some("ok") { "healthy" } else { "watch" }, "guidance": "Filesystem and LiteDB engine read access have been checked." }),
        json!({ "signal": "Write Open Probe", "value": write_probe_status, "status": if local_file_preflight["writeProbe"]["status"].as_str() == Some("ok") { "watch" } else { "blocked" }, "guidance": "Filesystem write-open evidence does not prove LiteDB exclusive writer-lock behavior." }),
        json!({ "signal": "Live Collection Enumeration", "value": metadata["collectionCount"], "status": "healthy", "guidance": "Collections and indexes were read from the LiteDB engine." }),
        json!({ "signal": "Read Only", "value": connection.read_only, "status": if connection.read_only { "healthy" } else { "watch" }, "guidance": "Writable local file operations remain guarded by environment safety rules." }),
    ];

    Ok(json!({
        "engine": "litedb",
        "database": litedb_file_name(connection),
        "objectView": object_view,
        "collection": collection,
        "collectionCount": metadata["collectionCount"],
        "documentCount": metadata["documentCount"],
        "indexCount": metadata["indexCount"],
        "fileSize": file_size_label(&litedb_file_path(connection)),
        "collections": collections,
        "fields": fields,
        "indexes": indexes,
        "files": [],
        "chunks": [],
        "storage": storage,
        "statistics": statistics,
        "pragmas": pragmas,
        "settings": settings,
        "maintenance": maintenance,
        "diagnostics": diagnostics,
        "localFilePreflight": local_file_preflight,
        "sidecarExecutionBoundary": live_boundary,
        "warnings": warnings,
    }))
}

fn litedb_query_template(node_id: &str) -> String {
    if let Some(collection) = collection_from_node_id(node_id) {
        if node_id.starts_with("litedb:schema:") {
            return json!({ "operation": "Schema", "collection": collection, "limit": 100 })
                .to_string();
        }

        if node_id.starts_with("litedb:collection-indexes:") {
            return json!({ "operation": "ListIndexes", "collection": collection }).to_string();
        }

        if node_id.starts_with("litedb:collection-statistics:") {
            return json!({ "operation": "Statistics", "collection": collection }).to_string();
        }

        if node_id.starts_with("litedb:collection-storage:") {
            return json!({ "operation": "Statistics", "collection": collection }).to_string();
        }

        return find_template(&collection);
    }

    if node_id == "litedb:indexes" {
        return json!({ "operation": "ListIndexes" }).to_string();
    }

    if node_id == "litedb:pragmas" {
        return json!({ "operation": "Pragmas" }).to_string();
    }

    if node_id == "litedb:storage" {
        return json!({ "operation": "Statistics" }).to_string();
    }

    if node_id == "litedb:maintenance"
        || node_id == "litedb:checkpoint"
        || node_id == "litedb:compact"
        || node_id == "litedb:rebuild-indexes"
        || node_id == "litedb:backup"
    {
        return json!({ "operation": "Maintenance" }).to_string();
    }

    json!({ "operation": "ListCollections" }).to_string()
}

pub(crate) fn find_template(collection: &str) -> String {
    json!({
        "operation": "Find",
        "collection": collection,
        "filter": {},
        "limit": 100
    })
    .to_string()
}

fn litedb_object_view(node_id: &str) -> &'static str {
    if node_id == "litedb:database" {
        return "database";
    }
    if node_id == "litedb:collections" {
        return "collections";
    }
    if node_id.starts_with("litedb:collection:") {
        return "collection";
    }
    if node_id.starts_with("litedb:documents:") {
        return "documents";
    }
    if node_id.starts_with("litedb:schema:") {
        return "schema";
    }
    if node_id == "litedb:indexes" || node_id.starts_with("litedb:collection-indexes:") {
        return "indexes";
    }
    if node_id.starts_with("litedb:index:") {
        return "index";
    }
    if node_id == "litedb:file-storage" {
        return "file-storage";
    }
    if node_id == "litedb:files" {
        return "files";
    }
    if node_id == "litedb:chunks" {
        return "chunks";
    }
    if node_id == "litedb:storage" || node_id.starts_with("litedb:collection-storage:") {
        return "storage";
    }
    if node_id.starts_with("litedb:collection-statistics:") {
        return "statistics";
    }
    if node_id == "litedb:pragmas" {
        return "pragmas";
    }
    if node_id == "litedb:maintenance"
        || node_id == "litedb:checkpoint"
        || node_id == "litedb:compact"
        || node_id == "litedb:rebuild-indexes"
        || node_id == "litedb:backup"
    {
        return "maintenance";
    }
    if node_id == "litedb:settings" {
        return "settings";
    }
    "diagnostics"
}

fn collection_from_node_id(node_id: &str) -> Option<String> {
    if let Some(index) = node_id.strip_prefix("litedb:index:") {
        return index
            .split_once(':')
            .map(|(collection, _)| collection.to_string());
    }
    [
        "litedb:collection:",
        "litedb:documents:",
        "litedb:schema:",
        "litedb:collection-indexes:",
        "litedb:collection-storage:",
        "litedb:collection-statistics:",
    ]
    .into_iter()
    .find_map(|prefix| node_id.strip_prefix(prefix))
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
}

// Mirrors the ExplorerNode shape so LiteDB scopes stay readable at call sites.
#[allow(clippy::too_many_arguments)]
fn litedb_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    query_template: Option<String>,
    path: Vec<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "document".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

fn litedb_file_name(connection: &ResolvedConnectionProfile) -> String {
    litedb_file_path(connection)
        .split(['/', '\\'])
        .rfind(|segment| !segment.trim().is_empty())
        .unwrap_or("local.db")
        .to_string()
}

fn file_size_label(path: &str) -> String {
    fs::metadata(path)
        .map(|metadata| human_bytes(metadata.len()))
        .unwrap_or_else(|_| "-".into())
}

fn human_bytes(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB", bytes / 1024.0 / 1024.0)
    } else if bytes >= 1024.0 {
        format!("{:.1} KB", bytes / 1024.0)
    } else {
        format!("{bytes:.0} B")
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/explorer_tests.rs"]
mod tests;
