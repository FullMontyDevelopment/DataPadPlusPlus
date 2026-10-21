//! Session-only canonical data. Never serialized into workspaces or sent to a WebView.
use std::{collections::HashMap, sync::Arc};

use serde_json::Value;

use crate::domain::{
    error::CommandError,
    models::{
        ExecutionRequest, ExecutionResultEnvelope, ResolvedConnectionProfile, ResultPageInfo,
        ResultPageResponse,
    },
};

#[derive(Clone)]
pub struct ResultSession {
    pub context_stamp: String,
    pub request: ExecutionRequest,
    pub connection: ResolvedConnectionProfile,
    pub chunks: HashMap<String, Vec<Arc<Value>>>,
    pub page_info: Option<ResultPageInfo>,
    pub maximum_loaded_rows: Option<u32>,
    pub revision: u64,
    pub requires_refresh: bool,
}

impl ResultSession {
    pub fn page_renderer<'a>(&self, requested: &'a str) -> &'a str {
        if self.chunks.contains_key("document")
            && matches!(requested, "document" | "table" | "json" | "raw")
        {
            "document"
        } else {
            requested
        }
    }

    pub fn export_chunks(&self, renderer: &str) -> Option<&Vec<Arc<Value>>> {
        // Alternate row renderers of document results share their original document source.
        if matches!(renderer, "document" | "table" | "json") && self.chunks.contains_key("document")
        {
            self.chunks.get("document")
        } else {
            self.chunks.get(renderer)
        }
    }

    pub fn materialize(&self, renderer: &str) -> Result<Value, CommandError> {
        if let Some(chunks) = self.chunks.get("document") {
            let documents = chunks
                .iter()
                .flat_map(|chunk| {
                    chunk
                        .get("documents")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .cloned()
                })
                .collect::<Vec<_>>();
            return match renderer {
                "document" => {
                    let mut payload = chunks
                        .first()
                        .map(|value| (**value).clone())
                        .unwrap_or_default();
                    payload["documents"] = Value::Array(documents);
                    Ok(payload)
                }
                "table" => Ok(
                    serde_json::json!({"renderer": "table", "columns": ["document"],
                    "rows": documents.iter().map(|value| vec![value.to_string()]).collect::<Vec<_>>()}),
                ),
                "json" => Ok(serde_json::json!({"renderer": "json", "value": documents})),
                "raw" => Ok(
                    serde_json::json!({"renderer": "raw", "text": serde_json::to_string_pretty(&documents)?}),
                ),
                _ => Err(CommandError::new(
                    "result-renderer-unavailable",
                    "This result cannot use the selected renderer.",
                )),
            };
        }
        Err(CommandError::new(
            "result-renderer-unavailable",
            "This result cannot use the selected renderer.",
        ))
    }

    pub fn apply_document_edit(
        &mut self,
        request: &crate::domain::models::DataEditExecutionRequest,
        response: &crate::domain::models::DataEditExecutionResponse,
    ) {
        let Some(evidence) = response
            .metadata
            .as_ref()
            .and_then(|value| value.get("documentEvidence"))
        else {
            // A successful non-document edit cannot be merged without authoritative
            // source-row identity (joins and projections may not be one-to-one).
            // Never export the pre-edit values as though they matched the view.
            self.requires_refresh = true;
            self.revision += 1;
            return;
        };
        let Some(before) = evidence
            .get("beforeDocument")
            .filter(|value| value.is_object())
        else {
            return;
        };
        let Some(after) = evidence.get("afterDocument") else {
            return;
        };
        let Some(chunks) = self.chunks.get_mut("document") else {
            return;
        };
        for chunk in chunks {
            if chunk.get("collection").and_then(Value::as_str)
                != request.target.collection.as_deref()
            {
                continue;
            }
            if request.target.database.is_some()
                && chunk.get("database").and_then(Value::as_str)
                    != request.target.database.as_deref()
            {
                continue;
            }
            let Some(documents) = Arc::make_mut(chunk)
                .get_mut("documents")
                .and_then(Value::as_array_mut)
            else {
                continue;
            };
            // Replace only an exact baseline; never insert a full document into a projection.
            if let Some(index) = documents.iter().position(|value| value == before) {
                if after.is_null() {
                    documents.remove(index);
                } else {
                    documents[index] = after.clone();
                }
                self.revision += 1;
                if after.is_null() {
                    if let Some(info) = self.page_info.as_mut() {
                        info.buffered_rows = info.buffered_rows.saturating_sub(1);
                        // Offset-based continuations cannot safely resume after a deletion.
                        info.has_more = false;
                    }
                }
            } else if documents.iter().any(|value| {
                value
                    .get("_id")
                    .is_some_and(|id| Some(id) == before.get("_id"))
            }) {
                self.requires_refresh = true;
                self.revision += 1;
            }
        }
    }

    pub fn new(
        request: ExecutionRequest,
        connection: ResolvedConnectionProfile,
        result: &ExecutionResultEnvelope,
        maximum_loaded_rows: Option<u32>,
    ) -> Self {
        Self {
            context_stamp: String::new(),
            request,
            connection,
            chunks: result
                .payloads
                .iter()
                .filter_map(|payload| {
                    Some((
                        payload.get("renderer")?.as_str()?.to_owned(),
                        vec![Arc::new(payload.clone())],
                    ))
                })
                .collect(),
            page_info: result.page_info.clone(),
            maximum_loaded_rows,
            revision: 0,
            requires_refresh: false,
        }
    }

    pub fn append(&mut self, page: &mut ResultPageResponse) -> Result<(), CommandError> {
        let previous_info = self.page_info.as_ref().ok_or_else(|| {
            CommandError::new(
                "result-page-unsupported",
                "This result has no continuation.",
            )
        })?;
        if !previous_info.has_more || page.page_info.page_index != previous_info.page_index + 1 {
            return Err(CommandError::new(
                "result-page-stale",
                "This continuation has already loaded or belongs to an older result.",
            ));
        }
        let renderer = page
            .payload
            .get("renderer")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let chunks = self.chunks.get_mut(renderer).ok_or_else(|| {
            CommandError::new(
                "result-page-unsupported",
                "This datastore did not return a continuation for this result.",
            )
        })?;
        let previous = self.page_info.as_ref().map_or(0, |info| info.buffered_rows);
        if let Some(limit) = self.maximum_loaded_rows {
            truncate_payload(&mut page.payload, limit.saturating_sub(previous) as usize);
        }
        let count = payload_count(&page.payload);
        page.page_info.buffered_rows = previous.saturating_add(count as u32);
        if self
            .maximum_loaded_rows
            .is_some_and(|limit| page.page_info.buffered_rows >= limit)
        {
            page.page_info.has_more = false;
            page.notices.push("Maximum loaded rows reached. Change Queries & Results settings and run again to load more.".into());
        }
        chunks.push(Arc::new(page.payload.clone()));
        self.page_info = Some(page.page_info.clone());
        self.revision += 1;
        Ok(())
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/result_sessions_tests.rs"]
mod tests;

pub fn context_stamp(
    snapshot: &crate::domain::models::WorkspaceSnapshot,
    connection_id: &str,
) -> String {
    use sha2::{Digest, Sha256};
    let profile = snapshot
        .connections
        .iter()
        .find(|profile| profile.id == connection_id);
    // Only a digest is retained. Environment inheritance is included in the binding.
    Sha256::digest(serde_json::to_vec(&(profile, &snapshot.environments)).unwrap_or_default())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn payload_count(payload: &Value) -> usize {
    if payload.get("renderer").and_then(Value::as_str) == Some("keyvalue") {
        if let Some(entries) = payload.get("entries").and_then(Value::as_object) {
            return entries.len();
        }
        if let Some(members) = payload.get("members").and_then(Value::as_array) {
            return members.len();
        }
        return usize::from(payload.get("value").is_some());
    }
    ["documents", "rows", "hits", "entries", "records", "items"]
        .iter()
        .find_map(|key| payload.get(key).and_then(Value::as_array).map(Vec::len))
        .unwrap_or(0)
}

pub fn truncate_payload(payload: &mut Value, limit: usize) {
    if payload.get("renderer").and_then(Value::as_str) == Some("keyvalue") {
        if let Some(entries) = payload.get_mut("entries").and_then(Value::as_object_mut) {
            *entries = entries
                .iter()
                .take(limit)
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
        }
        if let Some(members) = payload.get_mut("members").and_then(Value::as_array_mut) {
            members.truncate(limit);
        }
        return;
    }
    for key in ["documents", "rows", "hits", "entries", "records", "items"] {
        if let Some(items) = payload.get_mut(key).and_then(Value::as_array_mut) {
            items.truncate(limit);
        }
    }
}

/// Previews are derived from complete source values, never used as export data.
pub fn document_preview(payload: &Value) -> Value {
    let mut preview = payload.clone();
    if let Some(documents) = preview.get_mut("documents").and_then(Value::as_array_mut) {
        for document in documents {
            let Some(fields) = document.as_object_mut() else {
                continue;
            };
            for (key, value) in fields {
                if key == "_id" {
                    continue;
                }
                let shape = match value {
                    Value::Array(items) => Some(("array", items.len())),
                    // BSON wrappers remain scalar editors, not expandable document previews.
                    Value::Object(fields) if !is_bson_wrapper(fields) => {
                        Some(("object", fields.len()))
                    }
                    _ => None,
                };
                if let Some((kind, count)) = shape {
                    *value = serde_json::json!({
                        "__datapadLazyNode": true, "type": kind,
                        "childCount": count, "path": [key], "loaded": false,
                    });
                }
            }
        }
        preview["hydrationMode"] = "lazy".into();
    }
    preview
}

fn is_bson_wrapper(fields: &serde_json::Map<String, Value>) -> bool {
    fields.len() == 1
        && fields.keys().next().is_some_and(|key| {
            matches!(
                key.as_str(),
                "$oid"
                    | "$date"
                    | "$numberInt"
                    | "$numberLong"
                    | "$numberDouble"
                    | "$numberDecimal"
                    | "$binary"
                    | "$timestamp"
                    | "$regularExpression"
                    | "$minKey"
                    | "$maxKey"
                    | "$uuid"
            )
        })
}
