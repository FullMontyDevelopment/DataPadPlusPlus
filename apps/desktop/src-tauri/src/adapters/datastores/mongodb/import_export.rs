use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::bson_extjson::{mongodb_json_to_bson, mongodb_json_to_document};
use super::connection::{mongodb_client, mongodb_database_name};

pub(crate) async fn execute_mongodb_collection_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "mongodb.collection.export" => {
            execute_mongodb_collection_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "mongodb.collection.import" => {
            execute_mongodb_collection_import(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        _ => Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        )),
    }
}

async fn execute_mongodb_collection_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "export target",
    ) else {
        warnings.push(
            "Choose a concrete MongoDB export file path before running the live workflow.".into(),
        );
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    };
    if let Some(warning) = export_path_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
    ) {
        warnings.push(warning);
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let database_name = workflow_database_name(connection, request);
    let collection_name = match workflow_collection_name(request) {
        Some(value) => value,
        None => {
            warnings.push("MongoDB collection export needs a concrete target collection.".into());
            return Ok(operation_response(
                request,
                operation,
                plan,
                false,
                None,
                messages.clone(),
                warnings.clone(),
            ));
        }
    };
    let format = workflow_format(request, "extended-json");
    let client = mongodb_client(connection).await?;
    let collection = client
        .database(&database_name)
        .collection::<Document>(&collection_name);
    let mut find = collection.find(document_parameter(request, "filter")?);

    let projection = document_parameter(request, "projection")?;
    if !projection.is_empty() {
        find = find.projection(projection);
    }

    let sort = document_parameter(request, "sort")?;
    if !sort.is_empty() {
        find = find.sort(sort);
    }

    if let Some(limit) = numeric_parameter(request, "limit")
        .or(request.row_limit.map(u64::from))
        .and_then(|value| i64::try_from(value).ok())
        .filter(|value| *value > 0)
    {
        find = find.limit(limit);
    }

    if let Some(batch_size) = numeric_parameter(request, "batchSize")
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
    {
        find = find.batch_size(batch_size);
    }

    let documents = find.await?.try_collect::<Vec<Document>>().await?;
    let bytes_written = write_documents_to_path(
        &target_path,
        &format,
        &documents,
        extended_json_canonical(request),
    )?;
    let exported_count = documents.len();

    messages.push(format!(
        "MongoDB exported {exported_count} document(s) from {database_name}.{collection_name}."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "mongodb.collection.export",
            "database": database_name,
            "collection": collection_name,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "exportedCount": exported_count,
            "bytesWritten": bytes_written,
            "filter": request.parameters.as_ref().and_then(|items| items.get("filter")).cloned().unwrap_or_else(|| json!({})),
            "projection": request.parameters.as_ref().and_then(|items| items.get("projection")).cloned().unwrap_or_else(|| json!({})),
            "sort": request.parameters.as_ref().and_then(|items| items.get("sort")).cloned().unwrap_or_else(|| json!({})),
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_mongodb_collection_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live MongoDB collection import was blocked because this connection is read-only."
                .into(),
        );
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "import source",
    ) else {
        warnings.push(
            "Choose a concrete MongoDB import file path before running the live workflow.".into(),
        );
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    };
    if !source_path.is_file() {
        warnings.push(format!(
            "MongoDB import source `{}` does not exist or is not a file.",
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let database_name = workflow_database_name(connection, request);
    let collection_name = match workflow_collection_name(request) {
        Some(value) => value,
        None => {
            warnings.push("MongoDB collection import needs a concrete target collection.".into());
            return Ok(operation_response(
                request,
                operation,
                plan,
                false,
                None,
                messages.clone(),
                warnings.clone(),
            ));
        }
    };
    let format = workflow_format(request, "json");
    let mut documents = parse_documents_from_path(
        &source_path,
        &format,
        bool_parameter(request, "csvHeader").unwrap_or(true),
    )?;
    if documents.is_empty() {
        warnings.push("MongoDB import file did not contain any documents.".into());
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }
    let documents_read = documents.len();

    let mode = string_parameter(request, "mode")
        .unwrap_or_else(|| "insertMany".into())
        .to_ascii_lowercase();
    if matches!(
        mode.as_str(),
        "validate" | "validateonly" | "dryrun" | "dry-run"
    ) {
        messages.push(format!(
            "MongoDB validated {count} import document(s) from {path}.",
            count = documents.len(),
            path = source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "mongodb.collection.import",
                "database": database_name,
                "collection": collection_name,
                "format": format,
                "sourcePath": source_path.display().to_string(),
                "validatedCount": documents.len(),
                "insertedCount": 0,
                "mode": mode,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }
    if !matches!(mode.as_str(), "insertmany" | "insert" | "append") {
        warnings.push(format!(
            "MongoDB collection import mode `{mode}` is not live-enabled yet; use insertMany/append or validate-only."
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let client = mongodb_client(connection).await?;
    let database = client.database(&database_name);
    if bool_parameter(request, "createCollection").unwrap_or(false) {
        let collection_names = database.list_collection_names().await?;
        if !collection_names
            .iter()
            .any(|existing| existing == &collection_name)
        {
            database.create_collection(&collection_name).await?;
            messages.push(format!(
                "MongoDB created collection {database_name}.{collection_name} before import."
            ));
        }
    }
    let collection = database.collection::<Document>(&collection_name);
    let before_count = collection.count_documents(doc! {}).await?;
    let duplicate_policy = string_parameter(request, "duplicateKeyPolicy")
        .unwrap_or_else(|| "stop".into())
        .to_ascii_lowercase();
    let mut skipped_duplicates = 0_u64;
    if matches!(
        duplicate_policy.as_str(),
        "skip" | "skipexisting" | "ignore"
    ) {
        let filtered = filter_existing_document_ids(&collection, documents).await?;
        skipped_duplicates = filtered.1;
        documents = filtered.0;
    } else if matches!(duplicate_policy.as_str(), "replace" | "upsert") {
        warnings.push(format!(
            "MongoDB duplicate key policy `{duplicate_policy}` is not live-enabled yet; use stop or skip."
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let batch_size = numeric_parameter(request, "batchSize")
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
        .unwrap_or(1000);
    let ordered = bool_parameter(request, "ordered").unwrap_or(false);
    let mut inserted_count = 0_usize;
    let mut batch_count = 0_usize;
    for chunk in documents.chunks(batch_size) {
        if chunk.is_empty() {
            continue;
        }
        let result = collection
            .insert_many(chunk.iter())
            .ordered(ordered)
            .await?;
        inserted_count += result.inserted_ids.len();
        batch_count += 1;
    }
    let after_count = collection.count_documents(doc! {}).await?;

    messages.push(format!(
        "MongoDB imported {inserted_count} document(s) into {database_name}.{collection_name}."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "mongodb.collection.import",
            "database": database_name,
            "collection": collection_name,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "documentsRead": documents_read,
            "insertedCount": inserted_count,
            "skippedDuplicates": skipped_duplicates,
            "beforeCount": before_count,
            "afterCount": after_count,
            "batchSize": batch_size,
            "batches": batch_count,
            "ordered": ordered,
            "duplicateKeyPolicy": duplicate_policy,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn filter_existing_document_ids(
    collection: &mongodb::Collection<Document>,
    documents: Vec<Document>,
) -> Result<(Vec<Document>, u64), CommandError> {
    let mut filtered = Vec::with_capacity(documents.len());
    let mut skipped = 0_u64;

    for document in documents {
        if let Some(id) = document.get("_id") {
            let exists = collection
                .find_one(doc! { "_id": id.clone() })
                .await?
                .is_some();
            if exists {
                skipped += 1;
                continue;
            }
        }
        filtered.push(document);
    }

    Ok((filtered, skipped))
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    executed: bool,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support.clone(),
        executed,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

fn workflow_database_name(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> String {
    string_parameter(request, "database").unwrap_or_else(|| mongodb_database_name(connection))
}

fn workflow_collection_name(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "collection").or_else(|| {
        request
            .object_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.starts_with('<'))
            .map(str::to_string)
    })
}

fn workflow_format(request: &OperationExecutionRequest, default: &str) -> String {
    string_parameter(request, "format")
        .unwrap_or_else(|| default.into())
        .to_ascii_lowercase()
}

fn extended_json_canonical(request: &OperationExecutionRequest) -> bool {
    string_parameter(request, "extendedJsonMode")
        .is_some_and(|value| value.eq_ignore_ascii_case("canonical"))
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_parameter(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "1" => Some(true),
                        "false" | "no" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

fn numeric_parameter(request: &OperationExecutionRequest, key: &str) -> Option<u64> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
        })
}

fn document_parameter(
    request: &OperationExecutionRequest,
    key: &str,
) -> Result<Document, CommandError> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .map(|value| mongodb_json_to_document(value, key, "mongodb-file-workflow-bson"))
        .unwrap_or_else(|| Ok(Document::new()))
}

fn file_path_parameter(
    request: &OperationExecutionRequest,
    direct_keys: &[&str],
    object_key: &str,
) -> Option<String> {
    for key in direct_keys {
        if let Some(value) = string_parameter(request, key) {
            return Some(value);
        }
    }

    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(object_key))
        .and_then(Value::as_object)
        .and_then(|object| object.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn concrete_file_path(path: Option<String>, _label: &str) -> Option<PathBuf> {
    let raw = path?.trim().to_string();
    if raw.is_empty() || raw.contains("<selected-file>") || raw.contains("<") || raw.contains(">") {
        return None;
    }
    let path = PathBuf::from(raw);
    path.is_absolute().then_some(path)
}

fn export_path_warning(path: &Path, overwrite: bool) -> Option<String> {
    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Some(format!(
                "MongoDB export target folder `{}` does not exist.",
                parent.display()
            ));
        }
    }

    if path.exists() && !overwrite {
        return Some(format!(
            "MongoDB export target `{}` already exists. Re-run with overwrite enabled to replace it.",
            path.display()
        ));
    }

    None
}

fn write_documents_to_path(
    path: &Path,
    format: &str,
    documents: &[Document],
    canonical: bool,
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "json" | "extended-json" => {
            let values = documents
                .iter()
                .map(|document| document_to_extjson_value(document, canonical))
                .collect::<Vec<_>>();
            serde_json::to_writer_pretty(&mut file, &values)?;
        }
        "ndjson" => {
            for document in documents {
                serde_json::to_writer(&mut file, &document_to_extjson_value(document, canonical))?;
                file.write_all(b"\n")?;
            }
        }
        "csv" => write_csv_documents(&mut file, documents, canonical)?,
        "bson" => {
            for document in documents {
                file.write_all(&mongodb::bson::to_vec(document)?)?;
            }
        }
        other => {
            return Err(CommandError::new(
                "mongodb-file-format",
                format!(
                    "MongoDB collection file workflow does not support `{other}`. Use json, extended-json, ndjson, csv, or bson."
                ),
            ));
        }
    }

    file.flush()?;
    Ok(file.metadata()?.len())
}

fn parse_documents_from_path(
    path: &Path,
    format: &str,
    csv_header: bool,
) -> Result<Vec<Document>, CommandError> {
    let bytes = fs::read(path)?;

    match format {
        "bson" => parse_bson_documents(&bytes),
        "json" | "extended-json" => {
            let value = serde_json::from_slice::<Value>(&bytes)?;
            json_value_to_documents(&value)
        }
        "ndjson" => {
            let text = String::from_utf8(bytes).map_err(|error| {
                CommandError::new("mongodb-file-utf8", error.to_string())
            })?;
            parse_ndjson_documents(&text)
        }
        "csv" => {
            let text = String::from_utf8(bytes).map_err(|error| {
                CommandError::new("mongodb-file-utf8", error.to_string())
            })?;
            csv_text_to_documents(&text, csv_header)
        }
        other => Err(CommandError::new(
            "mongodb-file-format",
            format!(
                "MongoDB collection file workflow does not support `{other}`. Use json, extended-json, ndjson, csv, or bson."
            ),
        )),
    }
}

fn json_value_to_documents(value: &Value) -> Result<Vec<Document>, CommandError> {
    if let Some(documents) = value.get("documents").and_then(Value::as_array) {
        return documents
            .iter()
            .map(|document| mongodb_json_to_document(document, "documents[]", "mongodb-file-json"))
            .collect();
    }

    if let Some(documents) = value.as_array() {
        return documents
            .iter()
            .map(|document| mongodb_json_to_document(document, "documents[]", "mongodb-file-json"))
            .collect();
    }

    Ok(vec![mongodb_json_to_document(
        value,
        "document",
        "mongodb-file-json",
    )?])
}

fn parse_ndjson_documents(text: &str) -> Result<Vec<Document>, CommandError> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            let value = serde_json::from_str::<Value>(line).map_err(|error| {
                CommandError::new(
                    "mongodb-file-ndjson",
                    format!("MongoDB NDJSON line {} is invalid: {error}", index + 1),
                )
            })?;
            mongodb_json_to_document(&value, "document", "mongodb-file-ndjson")
        })
        .collect()
}

fn parse_bson_documents(bytes: &[u8]) -> Result<Vec<Document>, CommandError> {
    let mut documents = Vec::new();
    let mut offset = 0_usize;

    while offset < bytes.len() {
        if offset + 4 > bytes.len() {
            return Err(CommandError::new(
                "mongodb-file-bson",
                "MongoDB BSON import ended before a document length could be read.",
            ));
        }
        let length = i32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]);
        if length < 5 {
            return Err(CommandError::new(
                "mongodb-file-bson",
                "MongoDB BSON document length is invalid.",
            ));
        }
        let length = usize::try_from(length).map_err(|_| {
            CommandError::new(
                "mongodb-file-bson",
                "MongoDB BSON document length could not be represented safely.",
            )
        })?;
        let end = offset + length;
        if end > bytes.len() {
            return Err(CommandError::new(
                "mongodb-file-bson",
                "MongoDB BSON import ended inside a document.",
            ));
        }
        documents.push(mongodb::bson::from_slice::<Document>(&bytes[offset..end])?);
        offset = end;
    }

    Ok(documents)
}

fn document_to_extjson_value(document: &Document, canonical: bool) -> Value {
    if canonical {
        Bson::Document(document.clone()).into_canonical_extjson()
    } else {
        Bson::Document(document.clone()).into_relaxed_extjson()
    }
}

fn write_csv_documents(
    file: &mut File,
    documents: &[Document],
    canonical: bool,
) -> Result<(), CommandError> {
    let headers = csv_headers(documents);
    file.write_all(
        headers
            .iter()
            .map(|header| csv_escape(header))
            .collect::<Vec<_>>()
            .join(",")
            .as_bytes(),
    )?;
    file.write_all(b"\n")?;

    for document in documents {
        let row = headers
            .iter()
            .map(|header| bson_to_csv_cell(document.get(header), canonical))
            .map(|cell| csv_escape(&cell))
            .collect::<Vec<_>>()
            .join(",");
        file.write_all(row.as_bytes())?;
        file.write_all(b"\n")?;
    }

    Ok(())
}

fn csv_headers(documents: &[Document]) -> Vec<String> {
    let mut headers = BTreeSet::new();
    for document in documents {
        headers.extend(document.keys().cloned());
    }
    let mut headers = headers.into_iter().collect::<Vec<_>>();
    if let Some(position) = headers.iter().position(|header| header == "_id") {
        let id = headers.remove(position);
        headers.insert(0, id);
    }
    headers
}

fn bson_to_csv_cell(value: Option<&Bson>, canonical: bool) -> String {
    match value {
        None | Some(Bson::Null) => String::new(),
        Some(Bson::String(value)) => value.clone(),
        Some(Bson::Boolean(value)) => value.to_string(),
        Some(Bson::Int32(value)) => value.to_string(),
        Some(Bson::Int64(value)) => value.to_string(),
        Some(Bson::Double(value)) => value.to_string(),
        Some(value) => {
            let json_value = if canonical {
                value.clone().into_canonical_extjson()
            } else {
                value.clone().into_relaxed_extjson()
            };
            serde_json::to_string(&json_value).unwrap_or_default()
        }
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}

fn csv_text_to_documents(text: &str, has_header: bool) -> Result<Vec<Document>, CommandError> {
    let mut records = parse_csv_records(text)?;
    if records.is_empty() {
        return Ok(Vec::new());
    }

    let headers = if has_header {
        records
            .remove(0)
            .into_iter()
            .enumerate()
            .map(|(index, header)| {
                let header = header.trim();
                if header.is_empty() {
                    format!("field{}", index + 1)
                } else {
                    header.to_string()
                }
            })
            .collect::<Vec<_>>()
    } else {
        let width = records.iter().map(Vec::len).max().unwrap_or(0);
        (1..=width)
            .map(|index| format!("field{index}"))
            .collect::<Vec<_>>()
    };

    let mut documents = Vec::new();
    for record in records {
        if record.iter().all(|value| value.trim().is_empty()) {
            continue;
        }
        let mut document = Document::new();
        for (index, header) in headers.iter().enumerate() {
            if let Some(value) = record.get(index) {
                document.insert(header, csv_cell_to_bson(value)?);
            }
        }
        documents.push(document);
    }

    Ok(documents)
}

fn parse_csv_records(text: &str) -> Result<Vec<Vec<String>>, CommandError> {
    let mut records = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = text.chars().peekable();
    let mut in_quotes = false;

    while let Some(character) = chars.next() {
        if in_quotes {
            if character == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(character);
            }
            continue;
        }

        match character {
            '"' if field.is_empty() => in_quotes = true,
            ',' => {
                row.push(std::mem::take(&mut field));
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut row));
            }
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut row));
            }
            other => field.push(other),
        }
    }

    if in_quotes {
        return Err(CommandError::new(
            "mongodb-file-csv",
            "MongoDB CSV import ended inside a quoted field.",
        ));
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        records.push(row);
    }

    Ok(records)
}

fn csv_cell_to_bson(value: &str) -> Result<Bson, CommandError> {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("null") {
        return Ok(Bson::Null);
    }
    if trimmed.eq_ignore_ascii_case("true") {
        return Ok(Bson::Boolean(true));
    }
    if trimmed.eq_ignore_ascii_case("false") {
        return Ok(Bson::Boolean(false));
    }
    if let Ok(value) = trimmed.parse::<i64>() {
        return Ok(Bson::Int64(value));
    }
    if trimmed.contains('.') {
        if let Ok(value) = trimmed.parse::<f64>() {
            return Ok(Bson::Double(value));
        }
    }
    if matches!(trimmed.chars().next(), Some('{') | Some('[')) {
        let json = serde_json::from_str::<Value>(trimmed).map_err(|error| {
            CommandError::new(
                "mongodb-file-csv",
                format!("MongoDB CSV cell contains invalid JSON: {error}"),
            )
        })?;
        return mongodb_json_to_bson(&json, "mongodb-file-csv");
    }

    Ok(Bson::String(value.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mongodb_file_serializers_round_trip_supported_formats() {
        let documents = vec![
            doc! {
                "_id": "sku-1",
                "active": true,
                "qty": 3_i64,
                "tags": ["a", "b"],
            },
            doc! {
                "_id": "sku-2",
                "active": false,
                "qty": 7_i64,
            },
        ];
        let base = std::env::temp_dir().join(format!(
            "datapad-mongodb-file-roundtrip-{}",
            std::process::id()
        ));

        for format in ["json", "extended-json", "ndjson", "csv", "bson"] {
            let path = base.with_extension(format);
            let _ = fs::remove_file(&path);
            write_documents_to_path(&path, format, &documents, false).expect("write format");
            let parsed =
                parse_documents_from_path(&path, format, true).expect("parse generated file");
            assert_eq!(parsed.len(), 2, "{format}");
            assert_eq!(parsed[0].get_str("_id").unwrap(), "sku-1");
            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn mongodb_csv_parser_handles_quoted_cells_and_native_scalars() {
        let documents = csv_text_to_documents(
            "_id,active,qty,note\nsku-1,true,42,\"quoted, value\"\n",
            true,
        )
        .expect("csv documents");

        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].get_str("_id").unwrap(), "sku-1");
        assert_eq!(documents[0].get_bool("active").unwrap(), true);
        assert_eq!(documents[0].get_i64("qty").unwrap(), 42);
        assert_eq!(documents[0].get_str("note").unwrap(), "quoted, value");
    }

    #[tokio::test]
    async fn mongodb_file_workflow_rejects_placeholder_path_before_connecting() {
        let adapter = super::super::MongoDbAdapter;
        let operation = adapter
            .operation_manifests()
            .into_iter()
            .find(|operation| operation.id == "mongodb.collection.export")
            .expect("collection export operation");
        let connection = ResolvedConnectionProfile {
            id: "conn-mongodb".into(),
            name: "MongoDB".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            host: "127.0.0.1".into(),
            port: Some(27017),
            database: Some("catalog".into()),
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
        };
        let request = OperationExecutionRequest {
            connection_id: "conn-mongodb".into(),
            environment_id: "env-local".into(),
            operation_id: "mongodb.collection.export".into(),
            object_name: Some("products".into()),
            parameters: Some(std::collections::HashMap::from([
                ("database".into(), json!("catalog")),
                ("collection".into(), json!("products")),
                ("targetPath".into(), json!("<selected-file>.json")),
            ])),
            confirmation_text: Some("CONFIRM MONGODB".into()),
            row_limit: Some(10),
            tab_id: None,
        };
        let plan = adapter
            .plan_operation(
                &connection,
                &request.operation_id,
                request.object_name.as_deref(),
                request
                    .parameters
                    .as_ref()
                    .map(|items| {
                        items
                            .iter()
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect::<std::collections::BTreeMap<_, _>>()
                    })
                    .as_ref(),
            )
            .await
            .expect("plan");

        let response = execute_mongodb_collection_file_operation(
            &connection,
            &request,
            operation,
            plan,
            Vec::new(),
            Vec::new(),
        )
        .await
        .expect("response");

        assert!(!response.executed);
        assert_eq!(response.execution_support, "live");
        assert!(response
            .warnings
            .iter()
            .any(|warning| warning.contains("concrete MongoDB export file path")));
    }
}
