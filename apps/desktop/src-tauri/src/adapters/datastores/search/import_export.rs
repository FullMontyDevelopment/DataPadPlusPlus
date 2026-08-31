use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::super::super::*;
use super::connection::{
    search_delete, search_delete_json, search_get, search_get_allowing_status, search_post_json,
    search_put_json,
};
use super::SearchEngine;

const SEARCH_EXPORT_PAGE_SIZE: u32 = 100;
const SEARCH_BULK_BATCH_DOCUMENTS: usize = 250;
const SEARCH_BULK_BATCH_BYTES: usize = 8 * 1024 * 1024;
const SEARCH_MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;
const SEARCH_MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;
const SEARCH_TRANSFER_FORMAT_VERSION: u32 = 1;

const MANIFEST_FILE: &str = "manifest.json";
const MAPPINGS_FILE: &str = "mappings.json";
const SETTINGS_FILE: &str = "settings.json";
const DATA_FILE: &str = "data.ndjson";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTransferManifest {
    format_version: u32,
    engine: String,
    server_version: String,
    source_index: String,
    document_count: u64,
    created_at: String,
    mappings_file: String,
    settings_file: String,
    data_file: String,
}

pub(super) fn search_transfer_plan(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::search_manifest(engine),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != format!("{}.data.import-export", engine.engine) {
        return plan;
    }
    let mode = parameters
        .and_then(|values| values.get("mode"))
        .and_then(Value::as_str)
        .unwrap_or("export");
    let source_index = parameters
        .and_then(|values| values.get("index"))
        .and_then(Value::as_str)
        .or(object_name)
        .unwrap_or("<index>");
    let target_index = parameters
        .and_then(|values| values.get("targetIndex"))
        .and_then(Value::as_str)
        .unwrap_or("<new-target-index>");
    plan.request_language = "search-http".into();
    plan.generated_request = if mode == "import" {
        format!(
            "PUT /<encoded:{target_index}>\n<body: validated settings and mappings>\nPOST /_bulk\n<body: conflict-safe create actions from selected transfer folder>"
        )
    } else if engine.engine == "elasticsearch" {
        format!(
            "POST /<encoded:{source_index}>/_pit?keep_alive=1m\nPOST /_search\n<body: search_after pages sorted by _shard_doc>"
        )
    } else {
        format!(
            "POST /<encoded:{source_index}>/_search?scroll=1m\n<body: scroll pages sorted by _doc>"
        )
    };
    plan.summary = if mode == "import" {
        format!(
            "Prepared {} transfer-folder import into new index {target_index}.",
            engine.label
        )
    } else {
        format!(
            "Prepared {} transfer-folder export for index {source_index}.",
            engine.label
        )
    };
    plan.required_permissions = vec![if mode == "import" {
        "create-index, mapping/settings write, bulk create, refresh, and rollback delete access"
            .into()
    } else {
        "index metadata, search, and PIT or scroll access".into()
    }];
    plan.confirmation_text = Some(if engine.engine == "elasticsearch" {
        "CONFIRM ELASTICSEARCH".into()
    } else {
        "CONFIRM OPENSEARCH".into()
    });
    plan.estimated_scan_impact = Some(if mode == "import" {
        "The transfer creates a new index, streams bounded Bulk API batches, and deletes that new index if any batch fails. Existing indices are never modified.".into()
    } else {
        "The complete source index is read through bounded point-in-time/search-after or scroll pages.".into()
    });
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_search_transfer(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    validate_format(request)?;
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    match mode.as_str() {
        "export" => {
            let index = source_index(request)?;
            let target_path = transfer_path(request, "targetPath", "export")?;
            let result = export_search_index(engine, connection, &index, &target_path).await?;
            messages.push(format!(
                "{} exported {} document(s) from {index} in {} page(s).",
                engine.label, result.document_count, result.pages
            ));
            warnings.push(
                "The transfer folder contains server mappings/settings and native Bulk NDJSON. Cluster-wide templates and lifecycle policies are not part of an index data transfer."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": format!("{}.index.export", engine.engine),
                    "index": index,
                    "format": "search-transfer-folder",
                    "folderName": file_name(&target_path),
                    "documentCount": result.document_count,
                    "bytesWritten": result.bytes_written,
                    "pages": result.pages,
                    "pagingStrategy": result.paging_strategy,
                    "metadataFiles": [MAPPINGS_FILE, SETTINGS_FILE],
                    "dataFile": DATA_FILE,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "search-transfer-read-only",
                    "Search index import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "search-transfer-conflict-policy-invalid",
                    "Search index import requires the fail-safe conflict policy.",
                ));
            }
            let target_index = required_target_index(request)?;
            let source_path = transfer_path(request, "sourcePath", "import")?;
            let result =
                import_search_index(engine, connection, &target_index, &source_path).await?;
            messages.push(format!(
                "{} created {target_index} and imported {} document(s) in {} Bulk API batch(es).",
                engine.label, result.document_count, result.batches
            ));
            warnings.push(
                "The import restored index mappings and portable settings into a new index. Cluster templates, lifecycle policies, and source index UUIDs are intentionally not restored."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": format!("{}.index.import", engine.engine),
                    "sourceIndex": result.source_index,
                    "targetIndex": target_index,
                    "format": "search-transfer-folder",
                    "folderName": file_name(&source_path),
                    "documentCount": result.document_count,
                    "bytesRead": result.bytes_read,
                    "batches": result.batches,
                    "conflictPolicy": "fail",
                    "createdNewIndex": true,
                    "rollbackOnFailure": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "search-transfer-mode-invalid",
            "Search index transfer mode must be import or export.",
        )),
    }
}

struct SearchExportResult {
    document_count: u64,
    bytes_written: u64,
    pages: u32,
    paging_strategy: &'static str,
}

async fn export_search_index(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    index: &str,
    target_path: &Path,
) -> Result<SearchExportResult, CommandError> {
    validate_new_folder(target_path)?;
    tokio::fs::create_dir(target_path).await?;
    let result = async {
        let encoded_index = path_segment(index);
        let server_response = search_get(connection, "/").await?;
        let server_value = parse_search_json(&server_response.body, "server version")?;
        let server_version =
            required_json_string(&server_value, "/version/number", "server version")?.to_string();
        let mappings_response =
            search_get(connection, &format!("/{encoded_index}/_mapping")).await?;
        let settings_response = search_get(
            connection,
            &format!("/{encoded_index}/_settings?flat_settings=false&include_defaults=false"),
        )
        .await?;
        let mappings = index_section(&mappings_response.body, index, "mappings")?;
        let settings = index_section(&settings_response.body, index, "settings")?;
        write_json_file(&target_path.join(MAPPINGS_FILE), &mappings).await?;
        write_json_file(&target_path.join(SETTINGS_FILE), &settings).await?;
        let data_path = target_path.join(DATA_FILE);
        let mut output = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&data_path)
            .await?;
        let (document_count, pages) = if engine.engine == "elasticsearch" {
            export_elasticsearch_pit(connection, index, &mut output).await?
        } else {
            export_opensearch_scroll(connection, index, &mut output).await?
        };
        output.flush().await?;
        output.sync_all().await?;
        let manifest = SearchTransferManifest {
            format_version: SEARCH_TRANSFER_FORMAT_VERSION,
            engine: engine.engine.into(),
            server_version,
            source_index: index.into(),
            document_count,
            created_at: chrono::Utc::now().to_rfc3339(),
            mappings_file: MAPPINGS_FILE.into(),
            settings_file: SETTINGS_FILE.into(),
            data_file: DATA_FILE.into(),
        };
        write_json_file(&target_path.join(MANIFEST_FILE), &json!(manifest)).await?;
        let bytes_written = folder_bytes(target_path)?;
        Ok::<SearchExportResult, CommandError>(SearchExportResult {
            document_count,
            bytes_written,
            pages,
            paging_strategy: if engine.engine == "elasticsearch" {
                "pit-search-after"
            } else {
                "scroll"
            },
        })
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(target_path).await;
    }
    result
}

async fn export_elasticsearch_pit(
    connection: &ResolvedConnectionProfile,
    index: &str,
    output: &mut tokio::fs::File,
) -> Result<(u64, u32), CommandError> {
    let encoded_index = path_segment(index);
    let response = search_post_json(
        connection,
        &format!("/{encoded_index}/_pit?keep_alive=1m"),
        "{}",
    )
    .await?;
    let value = parse_search_json(&response.body, "point-in-time response")?;
    let mut pit_id = required_json_string(&value, "/id", "point-in-time id")?.to_string();
    let mut search_after: Option<Value> = None;
    let mut previous_sort: Option<Value> = None;
    let mut count = 0_u64;
    let mut pages = 0_u32;
    let result = async {
        loop {
            let mut body = json!({
                "size": SEARCH_EXPORT_PAGE_SIZE,
                "pit": { "id": pit_id, "keep_alive": "1m" },
                "sort": [{ "_shard_doc": "asc" }],
                "track_total_hits": false,
                "_source": true,
            });
            if let Some(sort) = search_after.as_ref() {
                body["search_after"] = sort.clone();
            }
            let response = search_post_json(connection, "/_search", &body.to_string()).await?;
            let page = parse_search_json(&response.body, "search page")?;
            if let Some(next_pit) = page.get("pit_id").and_then(Value::as_str) {
                pit_id = next_pit.to_string();
            }
            let hits = search_hits(&page)?;
            if hits.is_empty() {
                break;
            }
            pages = pages.saturating_add(1);
            for hit in hits {
                write_bulk_document(output, index, hit).await?;
                count = count.saturating_add(1);
            }
            let next_sort = hits
                .last()
                .and_then(|hit| hit.get("sort"))
                .filter(|value| value.is_array())
                .cloned()
                .ok_or_else(|| {
                    CommandError::new(
                        "search-transfer-page-invalid",
                        "Elasticsearch did not return a search-after value for the final page hit.",
                    )
                })?;
            if previous_sort.as_ref() == Some(&next_sort) {
                return Err(CommandError::new(
                    "search-transfer-page-stalled",
                    "Elasticsearch repeated a search-after cursor; export stopped before duplicating data.",
                ));
            }
            previous_sort = Some(next_sort.clone());
            search_after = Some(next_sort);
        }
        Ok::<(), CommandError>(())
    }
    .await;
    let _ = search_delete_json(connection, "/_pit", &json!({ "id": pit_id }).to_string()).await;
    result?;
    Ok((count, pages))
}

async fn export_opensearch_scroll(
    connection: &ResolvedConnectionProfile,
    index: &str,
    output: &mut tokio::fs::File,
) -> Result<(u64, u32), CommandError> {
    let encoded_index = path_segment(index);
    let mut response = search_post_json(
        connection,
        &format!("/{encoded_index}/_search?scroll=1m"),
        &json!({
            "size": SEARCH_EXPORT_PAGE_SIZE,
            "sort": ["_doc"],
            "_source": true,
            "query": { "match_all": {} },
        })
        .to_string(),
    )
    .await?;
    let mut scroll_id: Option<String> = None;
    let mut count = 0_u64;
    let mut pages = 0_u32;
    let result = async {
        loop {
            let page = parse_search_json(&response.body, "scroll page")?;
            let next_scroll_id = required_json_string(&page, "/_scroll_id", "scroll id")?;
            scroll_id = Some(next_scroll_id.to_string());
            let hits = search_hits(&page)?;
            if hits.is_empty() {
                break;
            }
            pages = pages.saturating_add(1);
            for hit in hits {
                write_bulk_document(output, index, hit).await?;
                count = count.saturating_add(1);
            }
            response = search_post_json(
                connection,
                "/_search/scroll",
                &json!({ "scroll": "1m", "scroll_id": next_scroll_id }).to_string(),
            )
            .await?;
        }
        Ok::<(), CommandError>(())
    }
    .await;
    if let Some(scroll_id) = scroll_id {
        let _ = search_delete_json(
            connection,
            "/_search/scroll",
            &json!({ "scroll_id": [scroll_id] }).to_string(),
        )
        .await;
    }
    result?;
    Ok((count, pages))
}

async fn write_bulk_document(
    output: &mut tokio::fs::File,
    index: &str,
    hit: &Value,
) -> Result<(), CommandError> {
    let id = hit.get("_id").and_then(Value::as_str).ok_or_else(|| {
        CommandError::new(
            "search-transfer-hit-invalid",
            "A search hit did not contain a document id.",
        )
    })?;
    let source = hit
        .get("_source")
        .filter(|value| value.is_object())
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-source-unavailable",
                "A search hit has no object _source. Enable _source before exporting this index.",
            )
        })?;
    let mut metadata = Map::from_iter([
        ("_index".into(), Value::String(index.into())),
        ("_id".into(), Value::String(id.into())),
    ]);
    if let Some(routing) = hit.get("_routing").and_then(Value::as_str) {
        metadata.insert("routing".into(), Value::String(routing.into()));
    }
    let action = serde_json::to_vec(&json!({ "create": metadata })).map_err(|_| {
        CommandError::new(
            "search-transfer-hit-invalid",
            "A search hit action could not be encoded.",
        )
    })?;
    let source = serde_json::to_vec(source).map_err(|_| {
        CommandError::new(
            "search-transfer-hit-invalid",
            "A search hit source could not be encoded.",
        )
    })?;
    output.write_all(&action).await?;
    output.write_all(b"\n").await?;
    output.write_all(&source).await?;
    output.write_all(b"\n").await?;
    Ok(())
}

#[derive(Debug)]
struct SearchImportResult {
    source_index: String,
    document_count: u64,
    bytes_read: u64,
    batches: u32,
}

async fn import_search_index(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    target_index: &str,
    source_path: &Path,
) -> Result<SearchImportResult, CommandError> {
    let manifest: SearchTransferManifest = read_json_file(
        &source_path.join(MANIFEST_FILE),
        1024 * 1024,
        "transfer manifest",
    )?;
    validate_manifest(engine, &manifest)?;
    let target_server = search_get(connection, "/").await?;
    let target_server = parse_search_json(&target_server.body, "server version")?;
    let target_server_version =
        required_json_string(&target_server, "/version/number", "server version")?;
    validate_server_compatibility(&manifest.server_version, target_server_version)?;
    let mappings: Value = read_json_file(
        &source_path.join(&manifest.mappings_file),
        SEARCH_MAX_METADATA_BYTES,
        "index mappings",
    )?;
    let mut settings: Value = read_json_file(
        &source_path.join(&manifest.settings_file),
        SEARCH_MAX_METADATA_BYTES,
        "index settings",
    )?;
    sanitize_index_settings(&mut settings);
    let encoded_target = path_segment(target_index);
    let existing =
        search_get_allowing_status(connection, &format!("/{encoded_target}"), &[404]).await?;
    if existing.status_code != 404 {
        return Err(CommandError::new(
            "search-transfer-target-exists",
            "Search import creates a new index so failed batches can be rolled back. Choose a target index name that does not exist.",
        ));
    }
    let create_body = json!({ "settings": settings, "mappings": mappings });
    search_put_json(
        connection,
        &format!("/{encoded_target}"),
        &create_body.to_string(),
    )
    .await?;
    let import_result = import_bulk_data(
        connection,
        &manifest,
        target_index,
        &source_path.join(&manifest.data_file),
    )
    .await;
    let (document_count, bytes_read, batches) = match import_result {
        Ok(result) => result,
        Err(mut error) => {
            if search_delete(connection, &format!("/{encoded_target}"))
                .await
                .is_err()
            {
                error.message.push_str(
                    " DataPad++ could not confirm rollback of the newly created target index; inspect it before retrying.",
                );
            }
            return Err(error);
        }
    };
    let validation = async {
        search_get(connection, &format!("/{encoded_target}/_refresh")).await?;
        let count_response = search_get(connection, &format!("/{encoded_target}/_count")).await?;
        let count_value = parse_search_json(&count_response.body, "target count")?;
        let authoritative_count =
            count_value
                .get("count")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    CommandError::new(
                        "search-transfer-count-invalid",
                        "Search engine did not return a valid target document count.",
                    )
                })?;
        if authoritative_count != document_count || document_count != manifest.document_count {
            return Err(CommandError::new(
                "search-transfer-count-mismatch",
                format!(
                    "Search import expected {} document(s), confirmed {document_count} Bulk create(s), and counted {authoritative_count} target document(s).",
                    manifest.document_count
                ),
            ));
        }
        Ok::<(), CommandError>(())
    }
    .await;
    if let Err(mut error) = validation {
        if search_delete(connection, &format!("/{encoded_target}"))
            .await
            .is_err()
        {
            error.message.push_str(
                " DataPad++ could not confirm rollback of the newly created target index; inspect it before retrying.",
            );
        }
        return Err(error);
    }
    Ok(SearchImportResult {
        source_index: manifest.source_index,
        document_count,
        bytes_read,
        batches,
    })
}

async fn import_bulk_data(
    connection: &ResolvedConnectionProfile,
    manifest: &SearchTransferManifest,
    target_index: &str,
    data_path: &Path,
) -> Result<(u64, u64, u32), CommandError> {
    if !data_path.is_file() {
        return Err(CommandError::new(
            "search-transfer-data-missing",
            "The selected search transfer folder has no data file.",
        ));
    }
    let bytes_read = fs::metadata(data_path)?.len();
    let input = tokio::fs::File::open(data_path).await?;
    let mut reader = BufReader::new(input);
    let mut batch = String::new();
    let mut batch_documents = 0_usize;
    let mut total_documents = 0_u64;
    let mut batches = 0_u32;
    let mut line_number = 0_u64;
    loop {
        let action = next_bounded_line(&mut reader).await?;
        let Some(action) = action else {
            break;
        };
        line_number = line_number.saturating_add(1);
        if action.trim().is_empty() {
            continue;
        }
        let source = next_bounded_line(&mut reader).await?.ok_or_else(|| {
            CommandError::new(
                "search-transfer-data-invalid",
                format!("Bulk action on line {line_number} has no source line."),
            )
        })?;
        line_number = line_number.saturating_add(1);
        let action = rewrite_bulk_action(
            &action,
            &manifest.source_index,
            target_index,
            line_number - 1,
        )?;
        validate_source_document(&source, line_number)?;
        let pair_bytes = action.len().saturating_add(source.len()).saturating_add(2);
        if batch_documents > 0
            && (batch_documents >= SEARCH_BULK_BATCH_DOCUMENTS
                || batch.len().saturating_add(pair_bytes) > SEARCH_BULK_BATCH_BYTES)
        {
            let created = send_bulk_batch(connection, &batch).await?;
            total_documents = total_documents.saturating_add(created);
            batches = batches.saturating_add(1);
            batch.clear();
            batch_documents = 0;
        }
        if pair_bytes > SEARCH_BULK_BATCH_BYTES {
            return Err(CommandError::new(
                "search-transfer-document-too-large",
                format!("Search document ending on line {line_number} exceeds the 8 MiB Bulk batch limit."),
            ));
        }
        batch.push_str(&action);
        batch.push('\n');
        batch.push_str(&source);
        batch.push('\n');
        batch_documents += 1;
    }
    if batch_documents > 0 {
        let created = send_bulk_batch(connection, &batch).await?;
        total_documents = total_documents.saturating_add(created);
        batches = batches.saturating_add(1);
    }
    Ok((total_documents, bytes_read, batches))
}

async fn send_bulk_batch(
    connection: &ResolvedConnectionProfile,
    batch: &str,
) -> Result<u64, CommandError> {
    let response = search_post_json(connection, "/_bulk?refresh=false", batch).await?;
    let value = parse_search_json(&response.body, "Bulk API response")?;
    let items = value
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-bulk-response-invalid",
                "Search Bulk API did not return item evidence.",
            )
        })?;
    let mut created = 0_u64;
    for item in items {
        let evidence = item
            .get("create")
            .or_else(|| item.get("index"))
            .and_then(Value::as_object)
            .ok_or_else(|| {
                CommandError::new(
                    "search-transfer-bulk-response-invalid",
                    "Search Bulk API returned an unreadable item result.",
                )
            })?;
        let status = evidence.get("status").and_then(Value::as_u64).unwrap_or(0);
        if !(200..300).contains(&status) || evidence.contains_key("error") {
            return Err(CommandError::new(
                if status == 409 {
                    "search-transfer-conflict"
                } else {
                    "search-transfer-bulk-failed"
                },
                format!(
                    "Search Bulk API rejected an item with status {status}. The newly created target index will be rolled back."
                ),
            ));
        }
        created = created.saturating_add(1);
    }
    if value.get("errors").and_then(Value::as_bool) == Some(true) {
        return Err(CommandError::new(
            "search-transfer-bulk-failed",
            "Search Bulk API reported an item failure. The newly created target index will be rolled back.",
        ));
    }
    Ok(created)
}

fn rewrite_bulk_action(
    encoded: &str,
    source_index: &str,
    target_index: &str,
    line: u64,
) -> Result<String, CommandError> {
    let value: Value = serde_json::from_str(encoded).map_err(|_| {
        CommandError::new(
            "search-transfer-data-invalid",
            format!("Bulk action line {line} is not valid JSON."),
        )
    })?;
    let object = value
        .as_object()
        .filter(|object| object.len() == 1)
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-data-invalid",
                format!("Bulk action line {line} must contain exactly one action."),
            )
        })?;
    let metadata = object
        .get("create")
        .or_else(|| object.get("index"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-data-invalid",
                format!("Bulk action line {line} must be a create or index action."),
            )
        })?;
    if metadata.get("_index").and_then(Value::as_str) != Some(source_index) {
        return Err(CommandError::new(
            "search-transfer-source-mismatch",
            format!("Bulk action line {line} does not belong to the manifest source index."),
        ));
    }
    let id = metadata
        .get("_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-data-invalid",
                format!("Bulk action line {line} has no document id."),
            )
        })?;
    let mut rewritten = Map::from_iter([
        ("_index".into(), Value::String(target_index.into())),
        ("_id".into(), Value::String(id.into())),
    ]);
    if let Some(routing) = metadata.get("routing").and_then(Value::as_str) {
        rewritten.insert("routing".into(), Value::String(routing.into()));
    }
    serde_json::to_string(&json!({ "create": rewritten })).map_err(|_| {
        CommandError::new(
            "search-transfer-data-invalid",
            format!("Bulk action line {line} could not be encoded."),
        )
    })
}

fn validate_source_document(encoded: &str, line: u64) -> Result<(), CommandError> {
    let value: Value = serde_json::from_str(encoded).map_err(|_| {
        CommandError::new(
            "search-transfer-data-invalid",
            format!("Bulk source line {line} is not valid JSON."),
        )
    })?;
    if !value.is_object() {
        return Err(CommandError::new(
            "search-transfer-data-invalid",
            format!("Bulk source line {line} must contain one document object."),
        ));
    }
    Ok(())
}

fn validate_manifest(
    engine: SearchEngine,
    manifest: &SearchTransferManifest,
) -> Result<(), CommandError> {
    if manifest.format_version != SEARCH_TRANSFER_FORMAT_VERSION {
        return Err(CommandError::new(
            "search-transfer-format-version-unsupported",
            "This search transfer folder was created by an unsupported format version.",
        ));
    }
    if manifest.engine != engine.engine {
        return Err(CommandError::new(
            "search-transfer-engine-mismatch",
            "Elasticsearch and OpenSearch transfer folders require explicit same-engine import compatibility.",
        ));
    }
    if manifest.server_version.trim().is_empty()
        || manifest.source_index.trim().is_empty()
        || manifest.mappings_file != MAPPINGS_FILE
        || manifest.settings_file != SETTINGS_FILE
        || manifest.data_file != DATA_FILE
    {
        return Err(CommandError::new(
            "search-transfer-manifest-invalid",
            "The search transfer manifest is incomplete or unsafe.",
        ));
    }
    Ok(())
}

fn validate_server_compatibility(source: &str, target: &str) -> Result<(), CommandError> {
    let source_major = version_major(source);
    let target_major = version_major(target);
    if source_major.is_none() || target_major.is_none() || source_major != target_major {
        return Err(CommandError::new(
            "search-transfer-version-incompatible",
            format!(
                "Search transfer requires a matching server major version. The bundle uses {}, while the target uses {}.",
                safe_version(source),
                safe_version(target)
            ),
        ));
    }
    Ok(())
}

fn version_major(value: &str) -> Option<u32> {
    value.trim().split('.').next()?.parse().ok()
}

fn safe_version(value: &str) -> String {
    value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        .take(32)
        .collect()
}

fn sanitize_index_settings(settings: &mut Value) {
    let Some(index) = settings.get_mut("index").and_then(Value::as_object_mut) else {
        return;
    };
    for key in [
        "uuid",
        "version",
        "creation_date",
        "creation_date_string",
        "provided_name",
        "history_uuid",
        "verified_before_close",
        "resize",
        "store",
    ] {
        index.remove(key);
    }
    if let Some(routing) = index.get_mut("routing").and_then(Value::as_object_mut) {
        if let Some(allocation) = routing.get_mut("allocation").and_then(Value::as_object_mut) {
            allocation.remove("initial_recovery");
        }
    }
}

fn source_index(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let value = parameter_string(request, "index")
        .or_else(|| request.object_name.clone())
        .unwrap_or_default();
    validate_index_name(value.trim_start_matches("search-index:"), "source")
}

fn required_target_index(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let value = parameter_string(request, "targetIndex").unwrap_or_default();
    validate_index_name(&value, "new target")
}

fn validate_index_name(value: &str, label: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 255
        || value.chars().any(char::is_control)
        || value.starts_with(['_', '-', '+'])
        || value.contains(['/', '\\', '*', '?', '"', '<', '>', '|', ' ', ',', '#', ':'])
        || value.chars().any(char::is_uppercase)
    {
        return Err(CommandError::new(
            "search-transfer-index-invalid",
            format!("Search transfer requires a valid lowercase {label} index name."),
        ));
    }
    Ok(value.into())
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "search-transfer-folder".into())
        .as_str()
    {
        "search-transfer-folder" => Ok(()),
        _ => Err(CommandError::new(
            "search-transfer-format-invalid",
            "Search index transfer uses a mappings/settings/Bulk NDJSON folder.",
        )),
    }
}

fn transfer_path(
    request: &OperationExecutionRequest,
    key: &str,
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = parameter_string(request, key).ok_or_else(|| {
        CommandError::new(
            "search-transfer-path-missing",
            format!("Choose a local search {direction} folder."),
        )
    })?;
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "search-transfer-path-unresolved",
            "The search transfer folder selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "search-transfer-path-invalid",
            "Search transfer requires a resolved absolute local folder path.",
        ));
    }
    Ok(path)
}

fn validate_new_folder(path: &Path) -> Result<(), CommandError> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-target-invalid",
                "Search export target parent directory does not exist.",
            )
        })?;
    if path == parent || path.file_name().is_none() || path.exists() {
        return Err(CommandError::new(
            "search-transfer-target-exists",
            "Search export requires a new empty transfer folder.",
        ));
    }
    Ok(())
}

async fn write_json_file(path: &Path, value: &Value) -> Result<(), CommandError> {
    let encoded = serde_json::to_vec_pretty(value).map_err(|_| {
        CommandError::new(
            "search-transfer-metadata-invalid",
            "Search transfer metadata could not be encoded.",
        )
    })?;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await?;
    file.write_all(&encoded).await?;
    file.sync_all().await?;
    Ok(())
}

fn read_json_file<T: for<'de> Deserialize<'de>>(
    path: &Path,
    max_bytes: u64,
    label: &str,
) -> Result<T, CommandError> {
    let metadata = fs::metadata(path).map_err(|_| {
        CommandError::new(
            "search-transfer-metadata-missing",
            format!("The selected search transfer folder has no {label} file."),
        )
    })?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err(CommandError::new(
            "search-transfer-metadata-invalid",
            format!("The search {label} file is invalid or too large."),
        ));
    }
    let encoded = fs::read(path)?;
    serde_json::from_slice(&encoded).map_err(|_| {
        CommandError::new(
            "search-transfer-metadata-invalid",
            format!("The search {label} file is not valid JSON."),
        )
    })
}

async fn next_bounded_line(
    reader: &mut BufReader<tokio::fs::File>,
) -> Result<Option<String>, CommandError> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let content_length = newline.unwrap_or(available.len());
        if bytes.len().saturating_add(content_length) > SEARCH_MAX_DOCUMENT_BYTES {
            return Err(CommandError::new(
                "search-transfer-document-too-large",
                "A search transfer line exceeds the 32 MiB safety limit.",
            ));
        }
        bytes.extend_from_slice(&available[..content_length]);
        reader.consume(consumed);
        if newline.is_some() {
            break;
        }
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    String::from_utf8(bytes).map(Some).map_err(|_| {
        CommandError::new(
            "search-transfer-data-invalid",
            "Search Bulk NDJSON must be valid UTF-8.",
        )
    })
}

fn index_section(body: &str, index: &str, section: &str) -> Result<Value, CommandError> {
    let value = parse_search_json(body, "index metadata")?;
    value
        .get(index)
        .and_then(|value| value.get(section))
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-metadata-invalid",
                format!("Search engine did not return {section} for the selected index."),
            )
        })
}

fn parse_search_json(body: &str, label: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|_| {
        CommandError::new(
            "search-transfer-response-invalid",
            format!("Search engine returned an invalid {label}."),
        )
    })
}

fn search_hits(page: &Value) -> Result<&Vec<Value>, CommandError> {
    page.pointer("/hits/hits")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-page-invalid",
                "Search engine returned a page without a hits array.",
            )
        })
}

fn required_json_string<'a>(
    value: &'a Value,
    pointer: &str,
    label: &str,
) -> Result<&'a str, CommandError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "search-transfer-response-invalid",
                format!("Search engine did not return a {label}."),
            )
        })
}

fn folder_bytes(path: &Path) -> Result<u64, CommandError> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
        }
    }
    Ok(total)
}

fn path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn parameter_string(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transfer")
        .to_string()
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/search/import_export_tests.rs"]
mod tests;
