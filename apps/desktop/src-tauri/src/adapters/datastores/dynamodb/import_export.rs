use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::super::super::*;
use super::connection::dynamodb_call;

const DYNAMODB_SCAN_PAGE_SIZE: u64 = 250;
const DYNAMODB_MAX_ITEM_BYTES: usize = 400 * 1024;
const DYNAMODB_MAX_ATTRIBUTE_DEPTH: usize = 32;

#[derive(Debug)]
struct DynamoExportResult {
    items: u64,
    bytes_written: u64,
    pages: u64,
}

#[derive(Debug)]
struct DynamoImportResult {
    items: u64,
    bytes_read: u64,
}

pub(super) fn dynamodb_transfer_plan(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::dynamodb_manifest(),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != "dynamodb.data.import-export" {
        return plan;
    }
    let mode = plan_parameter(parameters, "mode").unwrap_or("export");
    let table = plan_parameter(parameters, "table")
        .or(object_name)
        .unwrap_or("<table>");
    plan.request_language = "dynamodb-json".into();
    plan.generated_request = if mode == "import" {
        format!("DescribeTable {table}\nPutItem {table} ConditionExpression=attribute_not_exists(partition-key)\n<body: one validated DynamoDB JSON item>")
    } else {
        format!("Scan {table} Limit={DYNAMODB_SCAN_PAGE_SIZE}\nExclusiveStartKey=<next-page>")
    };
    plan.summary = format!(
        "Prepared DynamoDB JSON {} for table {table}.",
        if mode == "import" { "import" } else { "export" }
    );
    plan.required_permissions = vec![if mode == "import" {
        "DescribeTable and conditional PutItem access".into()
    } else {
        "Scan access".into()
    }];
    plan.estimated_scan_impact = Some(if mode == "import" {
        "Items are validated before writes and applied individually with a partition-key absence condition. A later failure does not roll back earlier confirmed inserts.".into()
    } else {
        "The complete table is read through bounded Scan pages. This consumes table read capacity and is not a consistent point-in-time snapshot.".into()
    });
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_dynamodb_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    validate_format(request)?;
    let table = transfer_table(request)?;
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    match mode.as_str() {
        "export" => {
            let path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let result = export_table(
                connection,
                &table,
                &path,
                parameter_bool(request, "overwrite").unwrap_or(false),
            )
            .await?;
            messages.push(format!(
                "DynamoDB exported {} item(s) from {table} in {} page(s).",
                result.items, result.pages
            ));
            warnings.push(
                "DynamoDB Scan is not a point-in-time snapshot; writes concurrent with the export may be observed inconsistently across pages."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "dynamodb.table.export",
                    "table": table,
                    "format": "dynamodb-json",
                    "fileName": file_name(&path),
                    "exportedCount": result.items,
                    "bytesWritten": result.bytes_written,
                    "pages": result.pages,
                    "pageSize": DYNAMODB_SCAN_PAGE_SIZE,
                    "consistentSnapshot": false,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "dynamodb-transfer-read-only",
                    "DynamoDB import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "dynamodb-transfer-conflict-policy-invalid",
                    "DynamoDB import requires the fail-safe conflict policy.",
                ));
            }
            let path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let result = import_table(connection, &table, &path).await?;
            messages.push(format!(
                "DynamoDB imported {} item(s) into {table} without replacing an existing primary key.",
                result.items
            ));
            warnings.push(
                "DynamoDB applies conditional PutItem requests independently. Every reported item was confirmed, but a later failure does not roll back earlier inserts."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "dynamodb.table.import",
                    "table": table,
                    "format": "dynamodb-json",
                    "fileName": file_name(&path),
                    "importedCount": result.items,
                    "bytesRead": result.bytes_read,
                    "conflictPolicy": "fail",
                    "conditionalWrites": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "dynamodb-transfer-mode-invalid",
            "DynamoDB data transfer mode must be import or export.",
        )),
    }
}

async fn export_table(
    connection: &ResolvedConnectionProfile,
    table: &str,
    path: &Path,
    overwrite: bool,
) -> Result<DynamoExportResult, CommandError> {
    validate_export_target(path, overwrite)?;
    let temporary_path = temporary_output_path(path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let mut items = 0_u64;
    let mut bytes_written = 0_u64;
    let mut pages = 0_u64;
    let mut cursor: Option<Value> = None;
    let mut seen_cursors = BTreeSet::new();

    let transfer = async {
        loop {
            let mut body = Map::from_iter([
                ("TableName".into(), json!(table)),
                ("Limit".into(), json!(DYNAMODB_SCAN_PAGE_SIZE)),
                ("ReturnConsumedCapacity".into(), json!("TOTAL")),
            ]);
            if let Some(cursor) = cursor.clone() {
                body.insert("ExclusiveStartKey".into(), cursor);
            }
            let response = dynamodb_call(connection, "Scan", &Value::Object(body)).await?;
            pages = pages.saturating_add(1);
            for item in response
                .get("Items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let item = item.as_object().ok_or_else(|| {
                    CommandError::new(
                        "dynamodb-transfer-response-invalid",
                        "DynamoDB Scan returned an item that is not a typed attribute map.",
                    )
                })?;
                validate_item(item, items.saturating_add(1))?;
                let encoded = serde_json::to_vec(item).map_err(|_| {
                    CommandError::new(
                        "dynamodb-transfer-response-invalid",
                        "DynamoDB Scan returned an item that could not be encoded.",
                    )
                })?;
                output.write_all(&encoded).await?;
                output.write_all(b"\n").await?;
                bytes_written = bytes_written.saturating_add(encoded.len() as u64 + 1);
                items = items.saturating_add(1);
            }
            cursor = response
                .get("LastEvaluatedKey")
                .filter(|value| value.as_object().is_some_and(|value| !value.is_empty()))
                .cloned();
            let Some(next) = cursor.as_ref() else {
                break;
            };
            let cursor_key = serde_json::to_string(next).unwrap_or_default();
            if !seen_cursors.insert(cursor_key) {
                return Err(CommandError::new(
                    "dynamodb-transfer-cursor-repeated",
                    "DynamoDB repeated a Scan pagination cursor; the incomplete export was discarded.",
                ));
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
    Ok(DynamoExportResult {
        items,
        bytes_written,
        pages,
    })
}

async fn import_table(
    connection: &ResolvedConnectionProfile,
    table: &str,
    path: &Path,
) -> Result<DynamoImportResult, CommandError> {
    if !path.is_file() {
        return Err(CommandError::new(
            "dynamodb-transfer-source-invalid",
            "The selected DynamoDB JSON Lines source is not a readable file.",
        ));
    }
    let bytes_read = fs::metadata(path)?.len();
    let key_names = table_key_names(connection, table).await?;
    validate_import_file(path, &key_names).await?;
    let partition_key = key_names.first().expect("validated key schema");
    let input = tokio::fs::File::open(path).await?;
    let mut reader = BufReader::new(input);
    let mut imported = 0_u64;
    let mut line_number = 0_u64;
    while let Some(line) = next_item_line(&mut reader).await? {
        line_number = line_number.saturating_add(1);
        if line.trim().is_empty() {
            continue;
        }
        let item = parse_item(&line, line_number)?;
        let request = json!({
            "TableName": table,
            "Item": item,
            "ConditionExpression": "attribute_not_exists(#datapad_pk)",
            "ExpressionAttributeNames": { "#datapad_pk": partition_key },
            "ReturnConsumedCapacity": "TOTAL",
        });
        if let Err(error) = dynamodb_call(connection, "PutItem", &request).await {
            return Err(CommandError::new(
                "dynamodb-transfer-import-failed",
                format!(
                    "DynamoDB rejected item {line_number} after {imported} confirmed insert(s): {} No existing item was overwritten.",
                    safe_dynamodb_detail(&error)
                ),
            ));
        }
        imported = imported.saturating_add(1);
    }
    Ok(DynamoImportResult {
        items: imported,
        bytes_read,
    })
}

async fn table_key_names(
    connection: &ResolvedConnectionProfile,
    table: &str,
) -> Result<Vec<String>, CommandError> {
    let response =
        dynamodb_call(connection, "DescribeTable", &json!({ "TableName": table })).await?;
    let mut keys = response
        .pointer("/Table/KeySchema")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some((
                entry.get("KeyType")?.as_str()?,
                entry.get("AttributeName")?.as_str()?.to_string(),
            ))
        })
        .collect::<Vec<_>>();
    keys.sort_by_key(|(key_type, _)| if *key_type == "HASH" { 0 } else { 1 });
    let names = keys.into_iter().map(|(_, name)| name).collect::<Vec<_>>();
    if names.is_empty() {
        return Err(CommandError::new(
            "dynamodb-transfer-key-schema-invalid",
            "DynamoDB did not return a primary-key schema for the target table.",
        ));
    }
    Ok(names)
}

async fn validate_import_file(path: &Path, key_names: &[String]) -> Result<(), CommandError> {
    let input = tokio::fs::File::open(path).await?;
    let mut reader = BufReader::new(input);
    let mut item_number = 0_u64;
    while let Some(line) = next_item_line(&mut reader).await? {
        if line.trim().is_empty() {
            continue;
        }
        item_number = item_number.saturating_add(1);
        let item = parse_item(&line, item_number)?;
        for key in key_names {
            let value = item.get(key).ok_or_else(|| {
                CommandError::new(
                    "dynamodb-transfer-key-missing",
                    format!(
                        "DynamoDB item {item_number} does not contain primary-key attribute {key}."
                    ),
                )
            })?;
            if !matches!(
                value
                    .as_object()
                    .and_then(|value| value.keys().next().map(String::as_str)),
                Some("S" | "N" | "B")
            ) {
                return Err(CommandError::new(
                    "dynamodb-transfer-key-invalid",
                    format!("DynamoDB item {item_number} primary-key attribute {key} must be S, N, or B."),
                ));
            }
        }
    }
    if item_number == 0 {
        return Err(CommandError::new(
            "dynamodb-transfer-source-empty",
            "The selected DynamoDB JSON Lines file contains no items.",
        ));
    }
    Ok(())
}

fn parse_item(line: &str, item_number: u64) -> Result<Map<String, Value>, CommandError> {
    let item: Value = serde_json::from_str(line).map_err(|_| {
        CommandError::new(
            "dynamodb-transfer-item-invalid",
            format!("DynamoDB JSON line {item_number} is not valid JSON."),
        )
    })?;
    let item = item.as_object().cloned().ok_or_else(|| {
        CommandError::new(
            "dynamodb-transfer-item-invalid",
            format!("DynamoDB JSON line {item_number} must contain one typed item object."),
        )
    })?;
    validate_item(&item, item_number)?;
    Ok(item)
}

fn validate_item(item: &Map<String, Value>, item_number: u64) -> Result<(), CommandError> {
    let encoded_size = serde_json::to_vec(item)
        .map(|value| value.len())
        .unwrap_or(usize::MAX);
    if encoded_size > DYNAMODB_MAX_ITEM_BYTES {
        return Err(CommandError::new(
            "dynamodb-transfer-item-too-large",
            format!("DynamoDB item {item_number} exceeds the 400 KiB transfer safety limit."),
        ));
    }
    if item.is_empty() {
        return Err(CommandError::new(
            "dynamodb-transfer-item-invalid",
            format!("DynamoDB item {item_number} must contain at least one attribute."),
        ));
    }
    for (name, value) in item {
        if name.is_empty() || name.chars().any(char::is_control) {
            return Err(CommandError::new(
                "dynamodb-transfer-attribute-invalid",
                format!("DynamoDB item {item_number} contains an invalid attribute name."),
            ));
        }
        validate_attribute_value(value, 0, item_number)?;
    }
    Ok(())
}

fn validate_attribute_value(
    value: &Value,
    depth: usize,
    item_number: u64,
) -> Result<(), CommandError> {
    if depth > DYNAMODB_MAX_ATTRIBUTE_DEPTH {
        return Err(CommandError::new(
            "dynamodb-transfer-attribute-too-deep",
            format!("DynamoDB item {item_number} exceeds the supported nested attribute depth."),
        ));
    }
    let object = value
        .as_object()
        .ok_or_else(|| invalid_attribute(item_number))?;
    if object.len() != 1 {
        return Err(invalid_attribute(item_number));
    }
    let (kind, inner) = object.iter().next().expect("one attribute kind");
    match kind.as_str() {
        "S" | "N" => {
            if inner.as_str().is_none() {
                return Err(invalid_attribute(item_number));
            }
        }
        "B" => validate_base64(inner, item_number)?,
        "BOOL" | "NULL" => {
            if inner.as_bool().is_none() {
                return Err(invalid_attribute(item_number));
            }
        }
        "M" => {
            let map = inner
                .as_object()
                .ok_or_else(|| invalid_attribute(item_number))?;
            for value in map.values() {
                validate_attribute_value(value, depth + 1, item_number)?;
            }
        }
        "L" => {
            let values = inner
                .as_array()
                .ok_or_else(|| invalid_attribute(item_number))?;
            for value in values {
                validate_attribute_value(value, depth + 1, item_number)?;
            }
        }
        "SS" | "NS" => {
            let values = inner
                .as_array()
                .ok_or_else(|| invalid_attribute(item_number))?;
            if values.is_empty() || !values.iter().all(Value::is_string) {
                return Err(invalid_attribute(item_number));
            }
        }
        "BS" => {
            let values = inner
                .as_array()
                .ok_or_else(|| invalid_attribute(item_number))?;
            if values.is_empty() {
                return Err(invalid_attribute(item_number));
            }
            for value in values {
                validate_base64(value, item_number)?;
            }
        }
        _ => return Err(invalid_attribute(item_number)),
    }
    Ok(())
}

fn validate_base64(value: &Value, item_number: u64) -> Result<(), CommandError> {
    let value = value
        .as_str()
        .ok_or_else(|| invalid_attribute(item_number))?;
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map(|_| ())
        .map_err(|_| invalid_attribute(item_number))
}

fn invalid_attribute(item_number: u64) -> CommandError {
    CommandError::new(
        "dynamodb-transfer-attribute-invalid",
        format!("DynamoDB item {item_number} contains an invalid typed AttributeValue."),
    )
}

async fn next_item_line(
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
        if bytes.len().saturating_add(content_length) > DYNAMODB_MAX_ITEM_BYTES {
            return Err(CommandError::new(
                "dynamodb-transfer-item-too-large",
                "A DynamoDB JSON item exceeds the 400 KiB transfer safety limit.",
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
            "dynamodb-transfer-item-invalid",
            "DynamoDB JSON Lines input must be valid UTF-8.",
        )
    })
}

fn safe_dynamodb_detail(error: &CommandError) -> &str {
    if error.message.len() <= 500
        && !error.message.to_ascii_lowercase().contains("credential")
        && !error.message.to_ascii_lowercase().contains("authorization")
    {
        &error.message
    } else {
        "DynamoDB rejected the conditional PutItem request."
    }
}

fn transfer_table(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let mut table = parameter_string(request, "table");
    if table.is_none() {
        if let Some(object_name) = request.object_name.as_deref().map(str::trim) {
            table = Some(
                object_name
                    .strip_prefix("table:")
                    .unwrap_or(object_name)
                    .to_string(),
            );
        }
    }
    let table = table.unwrap_or_default();
    if table.len() < 3
        || table.len() > 255
        || !table.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err(CommandError::new(
            "dynamodb-transfer-table-invalid",
            "DynamoDB transfer requires one valid table name.",
        ));
    }
    Ok(table)
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "dynamodb-json".into())
        .as_str()
    {
        "dynamodb-json" | "jsonl" | "ndjson" => Ok(()),
        _ => Err(CommandError::new(
            "dynamodb-transfer-format-invalid",
            "DynamoDB local table transfer uses DynamoDB JSON Lines.",
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
                "dynamodb-transfer-path-missing",
                format!("Choose a local DynamoDB {direction} file."),
            )
        })?;
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "dynamodb-transfer-path-unresolved",
            "The DynamoDB transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "dynamodb-transfer-path-invalid",
            "DynamoDB transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(CommandError::new(
            "dynamodb-transfer-target-invalid",
            "DynamoDB export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "dynamodb-transfer-target-exists",
            "DynamoDB export will not overwrite an existing file without explicit confirmation.",
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
        .unwrap_or("dynamodb-export");
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
            "dynamodb-transfer-target-exists",
            "DynamoDB export target appeared during execution; the completed temporary output was discarded.",
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
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/import_export_tests.rs"]
mod tests;
