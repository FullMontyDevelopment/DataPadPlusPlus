use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::super::super::*;
use super::connection::{
    cosmosdb_create_document, cosmosdb_default_database, cosmosdb_get, cosmosdb_post_query,
    CosmosDbQueryRequestOptions,
};
use super::query::cosmosdb_query_body;

const COSMOSDB_TRANSFER_PAGE_SIZE: u32 = 100;
const COSMOSDB_MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const COSMOSDB_MAX_LINE_BYTES: usize = 3 * 1024 * 1024;
const COSMOSDB_TRANSFER_FORMAT_VERSION: u32 = 1;

#[derive(Debug)]
struct CosmosExportResult {
    documents: u64,
    bytes_written: u64,
    pages: u64,
    request_charge: f64,
}

#[derive(Debug)]
struct CosmosImportResult {
    documents: u64,
    bytes_read: u64,
    request_charge: f64,
}

pub(super) fn cosmosdb_transfer_plan(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::cosmosdb_manifest(),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != "cosmosdb.data.import-export" {
        return plan;
    }
    let mode = plan_parameter(parameters, "mode").unwrap_or("export");
    let database = plan_parameter(parameters, "database")
        .unwrap_or_else(|| connection.database.as_deref().unwrap_or("<database>"));
    let container = plan_parameter(parameters, "container")
        .or(object_name)
        .unwrap_or("<container>");
    plan.request_language = "cosmosdb-sql-rest".into();
    plan.generated_request = if mode == "import" {
        format!("GET /dbs/{database}/colls/{container}\nPOST /dbs/{database}/colls/{container}/docs\nx-ms-documentdb-partitionkey: <validated routing values>\n<body: one validated document>")
    } else {
        format!("POST /dbs/{database}/colls/{container}/docs\nx-ms-documentdb-isquery: true\nx-ms-continuation: <next-page>\n<body: SELECT * FROM c>")
    };
    plan.summary = format!(
        "Prepared Cosmos DB NoSQL {} for {database}.{container}.",
        if mode == "import" { "import" } else { "export" }
    );
    plan.required_permissions = vec![if mode == "import" {
        "container metadata read and document create access".into()
    } else {
        "container metadata read and cross-partition document query access".into()
    }];
    plan.estimated_scan_impact = Some(if mode == "import" {
        "Every document is validated against the target hierarchical partition-key paths before a create-only request. A later failure does not roll back earlier confirmed creates.".into()
    } else {
        "The complete container is read through bounded cross-partition query pages and consumes request units.".into()
    });
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_cosmosdb_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    validate_format(request)?;
    let (database, container) = transfer_target(connection, request)?;
    let partition_paths = load_partition_paths(connection, &database, &container).await?;
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    match mode.as_str() {
        "export" => {
            let path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let result = export_container(
                connection,
                &database,
                &container,
                &partition_paths,
                &path,
                parameter_bool(request, "overwrite").unwrap_or(false),
            )
            .await?;
            messages.push(format!(
                "Cosmos DB exported {} document(s) from {database}.{container} in {} page(s).",
                result.documents, result.pages
            ));
            warnings.push(
                "Cosmos DB system-managed resource identifiers, self links, attachments links, timestamps, and ETags are retained only as source evidence and are regenerated on import."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "cosmosdb.container.export",
                    "database": database,
                    "container": container,
                    "partitionKeyPaths": partition_paths,
                    "format": "cosmos-json-lines",
                    "fileName": file_name(&path),
                    "exportedCount": result.documents,
                    "bytesWritten": result.bytes_written,
                    "pages": result.pages,
                    "requestCharge": result.request_charge,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "cosmosdb-transfer-read-only",
                    "Cosmos DB import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "cosmosdb-transfer-conflict-policy-invalid",
                    "Cosmos DB import requires the fail-safe conflict policy.",
                ));
            }
            let path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let result =
                import_container(connection, &database, &container, &partition_paths, &path)
                    .await?;
            messages.push(format!(
                "Cosmos DB imported {} document(s) into {database}.{container} without replacing an existing id/partition pair.",
                result.documents
            ));
            warnings.push(
                "Cosmos DB applies document creates independently. Every reported document was confirmed, but a later conflict or failure does not roll back earlier creates."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "cosmosdb.container.import",
                    "database": database,
                    "container": container,
                    "partitionKeyPaths": partition_paths,
                    "format": "cosmos-json-lines",
                    "fileName": file_name(&path),
                    "importedCount": result.documents,
                    "bytesRead": result.bytes_read,
                    "requestCharge": result.request_charge,
                    "conflictPolicy": "fail",
                    "createOnly": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "cosmosdb-transfer-mode-invalid",
            "Cosmos DB data transfer mode must be import or export.",
        )),
    }
}

async fn load_partition_paths(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Result<Vec<String>, CommandError> {
    let response = cosmosdb_get(connection, &format!("/dbs/{database}/colls/{container}")).await?;
    let value: Value = serde_json::from_str(&response.body).map_err(|_| {
        CommandError::new(
            "cosmosdb-transfer-container-invalid",
            "Cosmos DB returned invalid container metadata.",
        )
    })?;
    let paths = value
        .pointer("/partitionKey/paths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if paths.is_empty()
        || paths.len() > 3
        || paths.iter().any(|path| parse_partition_path(path).is_err())
    {
        return Err(CommandError::new(
            "cosmosdb-transfer-partition-schema-unsupported",
            "Cosmos DB transfer requires one to three supported hierarchical partition-key paths.",
        ));
    }
    Ok(paths)
}

async fn export_container(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
    partition_paths: &[String],
    path: &Path,
    overwrite: bool,
) -> Result<CosmosExportResult, CommandError> {
    validate_export_target(path, overwrite)?;
    let temporary_path = temporary_output_path(path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let query = cosmosdb_query_body("SELECT * FROM c", None);
    let mut continuation = None;
    let mut session_token = None;
    let mut documents = 0_u64;
    let mut bytes_written = 0_u64;
    let mut pages = 0_u64;
    let mut request_charge = 0_f64;

    let transfer = async {
        loop {
            let response = cosmosdb_post_query(
                connection,
                &format!("/dbs/{database}/colls/{container}/docs"),
                &query,
                CosmosDbQueryRequestOptions {
                    max_item_count: COSMOSDB_TRANSFER_PAGE_SIZE,
                    continuation: continuation.clone(),
                    partition_key: None,
                    session_token: session_token.clone(),
                    enable_cross_partition: true,
                    populate_query_metrics: false,
                    populate_index_metrics: false,
                },
                None,
            )
            .await?;
            pages = pages.saturating_add(1);
            request_charge += response.request_charge.unwrap_or(0.0);
            continuation = response.continuation.clone();
            session_token = response.session_token.clone().or(session_token);
            let value: Value = serde_json::from_str(&response.body).map_err(|_| {
                CommandError::new(
                    "cosmosdb-transfer-response-invalid",
                    "Cosmos DB returned invalid document query JSON.",
                )
            })?;
            for document in value
                .get("Documents")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let envelope = export_envelope(
                    database,
                    container,
                    partition_paths,
                    document,
                    documents.saturating_add(1),
                )?;
                let encoded = serde_json::to_vec(&envelope).map_err(|_| {
                    CommandError::new(
                        "cosmosdb-transfer-response-invalid",
                        "Cosmos DB document transfer envelope could not be encoded.",
                    )
                })?;
                output.write_all(&encoded).await?;
                output.write_all(b"\n").await?;
                bytes_written = bytes_written.saturating_add(encoded.len() as u64 + 1);
                documents = documents.saturating_add(1);
            }
            if continuation.is_none() {
                break;
            }
        }
        output.flush().await?;
        output.sync_all().await?;
        Ok::<(), CommandError>(())
    }
    .await;

    drop(output);
    if let Err(error) = transfer {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    commit_temporary_output(&temporary_path, path, overwrite)?;
    Ok(CosmosExportResult {
        documents,
        bytes_written,
        pages,
        request_charge,
    })
}

fn export_envelope(
    database: &str,
    container: &str,
    partition_paths: &[String],
    document: &Value,
    number: u64,
) -> Result<Value, CommandError> {
    let mut document = validate_document(document, number)?.clone();
    let partition_key = resolve_partition_key(&document, partition_paths, number)?;
    let source_etag = document.remove("_etag");
    let source_timestamp = document.remove("_ts");
    for field in ["_rid", "_self", "_attachments"] {
        document.remove(field);
    }
    validate_document_size(&document, number)?;
    Ok(json!({
        "formatVersion": COSMOSDB_TRANSFER_FORMAT_VERSION,
        "source": {
            "database": database,
            "container": container,
            "partitionKeyPaths": partition_paths,
        },
        "partitionKey": partition_key,
        "document": document,
        "sourceEtag": source_etag,
        "sourceTimestamp": source_timestamp,
    }))
}

async fn import_container(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
    partition_paths: &[String],
    path: &Path,
) -> Result<CosmosImportResult, CommandError> {
    if !path.is_file() {
        return Err(CommandError::new(
            "cosmosdb-transfer-source-invalid",
            "The selected Cosmos DB JSON Lines source is not a readable file.",
        ));
    }
    let bytes_read = fs::metadata(path)?.len();
    validate_import_file(path, partition_paths).await?;
    let input = tokio::fs::File::open(path).await?;
    let mut reader = BufReader::new(input);
    let mut documents = 0_u64;
    let mut line = 0_u64;
    let mut request_charge = 0_f64;
    while let Some(encoded) = next_bounded_line(&mut reader).await? {
        line = line.saturating_add(1);
        if encoded.trim().is_empty() {
            continue;
        }
        let envelope = parse_envelope(&encoded, line, partition_paths)?;
        let document = envelope
            .get("document")
            .expect("validated document envelope");
        let partition_key = envelope
            .get("partitionKey")
            .expect("validated partition key");
        let body = serde_json::to_string(document).map_err(|_| invalid_envelope(line))?;
        let response = cosmosdb_create_document(
            connection,
            &format!("/dbs/{database}/colls/{container}/docs"),
            &body,
            partition_key,
        )
        .await
        .map_err(|error| {
            CommandError::new(
                "cosmosdb-transfer-import-failed",
                format!(
                    "Cosmos DB rejected document line {line} after {documents} confirmed create(s): {} No existing document was overwritten.",
                    safe_cosmos_detail(&error)
                ),
            )
        })?;
        request_charge += response.request_charge.unwrap_or(0.0);
        documents = documents.saturating_add(1);
    }
    Ok(CosmosImportResult {
        documents,
        bytes_read,
        request_charge,
    })
}

async fn validate_import_file(path: &Path, partition_paths: &[String]) -> Result<(), CommandError> {
    let input = tokio::fs::File::open(path).await?;
    let mut reader = BufReader::new(input);
    let mut document_number = 0_u64;
    let mut line = 0_u64;
    while let Some(encoded) = next_bounded_line(&mut reader).await? {
        line = line.saturating_add(1);
        if encoded.trim().is_empty() {
            continue;
        }
        parse_envelope(&encoded, line, partition_paths)?;
        document_number = document_number.saturating_add(1);
    }
    if document_number == 0 {
        return Err(CommandError::new(
            "cosmosdb-transfer-source-empty",
            "The selected Cosmos DB JSON Lines file contains no documents.",
        ));
    }
    Ok(())
}

fn parse_envelope(
    encoded: &str,
    line: u64,
    target_partition_paths: &[String],
) -> Result<Value, CommandError> {
    let value: Value = serde_json::from_str(encoded).map_err(|_| invalid_envelope(line))?;
    if value.get("formatVersion").and_then(Value::as_u64)
        != Some(COSMOSDB_TRANSFER_FORMAT_VERSION as u64)
    {
        return Err(invalid_envelope(line));
    }
    let source_paths = value
        .pointer("/source/partitionKeyPaths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    if source_paths
        != target_partition_paths
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    {
        return Err(CommandError::new(
            "cosmosdb-transfer-partition-schema-mismatch",
            format!("Cosmos DB document line {line} was exported from a different partition-key schema."),
        ));
    }
    let document = validate_document(
        value
            .get("document")
            .ok_or_else(|| invalid_envelope(line))?,
        line,
    )?;
    validate_document_size(document, line)?;
    if document.keys().any(|key| is_system_field(key)) {
        return Err(CommandError::new(
            "cosmosdb-transfer-system-field-invalid",
            format!("Cosmos DB document line {line} contains a server-managed system field."),
        ));
    }
    let supplied_partition = value
        .get("partitionKey")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_envelope(line))?;
    let resolved_partition = resolve_partition_key(document, target_partition_paths, line)?;
    if supplied_partition != resolved_partition.as_slice() {
        return Err(CommandError::new(
            "cosmosdb-transfer-partition-value-mismatch",
            format!("Cosmos DB document line {line} routing metadata does not match the document values."),
        ));
    }
    Ok(value)
}

fn validate_document(value: &Value, number: u64) -> Result<&Map<String, Value>, CommandError> {
    let document = value.as_object().ok_or_else(|| invalid_envelope(number))?;
    if document
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(|id| id.is_empty() || id.len() > 1_023 || id.contains(['/', '\\', '?', '#']))
    {
        return Err(CommandError::new(
            "cosmosdb-transfer-id-invalid",
            format!("Cosmos DB document {number} requires a valid string id."),
        ));
    }
    Ok(document)
}

fn validate_document_size(document: &Map<String, Value>, number: u64) -> Result<(), CommandError> {
    let size = serde_json::to_vec(document)
        .map(|value| value.len())
        .unwrap_or(usize::MAX);
    if size > COSMOSDB_MAX_DOCUMENT_BYTES {
        return Err(CommandError::new(
            "cosmosdb-transfer-document-too-large",
            format!("Cosmos DB document {number} exceeds the 2 MiB document limit."),
        ));
    }
    Ok(())
}

fn resolve_partition_key(
    document: &Map<String, Value>,
    paths: &[String],
    number: u64,
) -> Result<Vec<Value>, CommandError> {
    paths
        .iter()
        .map(|path| {
            let segments = parse_partition_path(path)?;
            let mut value = document.get(&segments[0]);
            for segment in segments.iter().skip(1) {
                value = value.and_then(Value::as_object).and_then(|value| value.get(segment));
            }
            value
                .filter(|value| !matches!(value, Value::Array(_) | Value::Object(_)))
                .cloned()
                .ok_or_else(|| {
                    CommandError::new(
                        "cosmosdb-transfer-partition-value-missing",
                        format!("Cosmos DB document {number} does not contain a scalar value for partition path {path}."),
                    )
                })
        })
        .collect()
}

fn parse_partition_path(path: &str) -> Result<Vec<String>, CommandError> {
    let segments = path
        .strip_prefix('/')
        .unwrap_or_default()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
        .collect::<Vec<_>>();
    if segments.is_empty()
        || segments
            .iter()
            .any(|segment| segment.chars().any(char::is_control))
    {
        Err(CommandError::new(
            "cosmosdb-transfer-partition-schema-unsupported",
            format!("Cosmos DB partition-key path {path} is invalid."),
        ))
    } else {
        Ok(segments)
    }
}

fn is_system_field(key: &str) -> bool {
    matches!(key, "_rid" | "_self" | "_etag" | "_attachments" | "_ts")
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
        if bytes.len().saturating_add(content_length) > COSMOSDB_MAX_LINE_BYTES {
            return Err(CommandError::new(
                "cosmosdb-transfer-document-too-large",
                "A Cosmos DB transfer envelope exceeds the 3 MiB safety limit.",
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
            "cosmosdb-transfer-envelope-invalid",
            "Cosmos DB JSON Lines input must be valid UTF-8.",
        )
    })
}

fn invalid_envelope(line: u64) -> CommandError {
    CommandError::new(
        "cosmosdb-transfer-envelope-invalid",
        format!("Cosmos DB JSON line {line} is not a valid transfer envelope."),
    )
}

fn safe_cosmos_detail(error: &CommandError) -> &str {
    if error.message.len() <= 500
        && !error.message.to_ascii_lowercase().contains("authorization")
        && !error.message.to_ascii_lowercase().contains("token")
    {
        &error.message
    } else {
        "Cosmos DB rejected the create request."
    }
}

fn transfer_target(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<(String, String), CommandError> {
    let mut database = parameter_string(request, "database")
        .unwrap_or_else(|| cosmosdb_default_database(connection));
    let mut container =
        parameter_string(request, "container").or_else(|| parameter_string(request, "collection"));
    if container.is_none() {
        if let Some(object_name) = request.object_name.as_deref().map(str::trim) {
            if let Some(rest) = object_name.strip_prefix("container:") {
                let parts = rest.splitn(2, ':').collect::<Vec<_>>();
                if let Some(scope) = parts.first().filter(|value| !value.is_empty()) {
                    database = (*scope).to_string();
                }
                container = parts.get(1).map(|value| (*value).to_string());
            } else if let Some((scope, name)) = object_name.rsplit_once('.') {
                database = scope.to_string();
                container = Some(name.to_string());
            } else {
                container = Some(object_name.to_string());
            }
        }
    }
    let container = container.unwrap_or_default();
    validate_resource_name(&database, "database")?;
    validate_resource_name(&container, "container")?;
    Ok((database, container))
}

fn validate_resource_name(value: &str, label: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 255
        || value.chars().any(char::is_control)
        || value.contains(['/', '\\', '?', '#'])
    {
        return Err(CommandError::new(
            "cosmosdb-transfer-target-invalid",
            format!("Cosmos DB transfer requires one valid {label}."),
        ));
    }
    Ok(())
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "cosmos-json-lines".into())
        .as_str()
    {
        "cosmos-json-lines" | "jsonl" | "ndjson" => Ok(()),
        _ => Err(CommandError::new(
            "cosmosdb-transfer-format-invalid",
            "Cosmos DB NoSQL transfer uses Cosmos DB JSON Lines with routing metadata.",
        )),
    }
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys
        .iter()
        .find_map(|key| parameter_string(request, key))
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-transfer-path-missing",
                format!("Choose a local Cosmos DB {direction} file."),
            )
        })?;
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "cosmosdb-transfer-path-unresolved",
            "The Cosmos DB transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "cosmosdb-transfer-path-invalid",
            "Cosmos DB transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(CommandError::new(
            "cosmosdb-transfer-target-invalid",
            "Cosmos DB export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "cosmosdb-transfer-target-exists",
            "Cosmos DB export will not overwrite an existing file without explicit confirmation.",
        ));
    }
    Ok(())
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("cosmosdb-export");
    path.with_file_name(format!(
        ".{name}.datapad-part-{}-{suffix}",
        std::process::id()
    ))
}

fn commit_temporary_output(
    temporary_path: &Path,
    target_path: &Path,
    overwrite: bool,
) -> Result<(), CommandError> {
    if !target_path.exists() {
        fs::rename(temporary_path, target_path)?;
        return Ok(());
    }
    if !overwrite {
        let _ = fs::remove_file(temporary_path);
        return Err(CommandError::new(
            "cosmosdb-transfer-target-exists",
            "Cosmos DB export target appeared during execution; the completed temporary output was discarded.",
        ));
    }
    let backup_path = temporary_output_path(target_path).with_extension("previous");
    fs::rename(target_path, &backup_path)?;
    if let Err(error) = fs::rename(temporary_path, target_path) {
        let _ = fs::rename(&backup_path, target_path);
        return Err(CommandError::from(error));
    }
    let _ = fs::remove_file(backup_path);
    Ok(())
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

fn parameter_bool(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_bool)
}

fn plan_parameter<'a>(
    parameters: Option<&'a BTreeMap<String, Value>>,
    key: &str,
) -> Option<&'a str> {
    parameters
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
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
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/import_export_tests.rs"]
mod tests;
