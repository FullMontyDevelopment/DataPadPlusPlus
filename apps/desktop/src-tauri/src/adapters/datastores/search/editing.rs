use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::{search_delete, search_post_json, search_put_json};
use super::SearchEngine;

pub(super) async fn execute_search_data_edit(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(format!(
            "Live {} document edit execution was blocked because this connection is read-only.",
            engine.label
        ));
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This search document edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(format!(
            "Generated a safe {} document-edit plan. Live execution is not enabled for this edit.",
            engine.label
        ));
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let edit = match search_edit_request(request) {
        Ok(edit) => edit,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let response = match edit.method.as_str() {
        "PUT" => search_put_json(connection, &edit.path, &edit.body).await?,
        "POST" => search_post_json(connection, &edit.path, &edit.body).await?,
        "DELETE" => search_delete(connection, &edit.path).await?,
        _ => {
            return Err(CommandError::new(
                "search-edit-method",
                format!("Unsupported search edit method `{}`.", edit.method),
            ));
        }
    };
    let response_json = serde_json::from_str::<Value>(&response.body).unwrap_or_else(|_| json!({}));
    messages.push(format!("{} {} completed.", engine.label, request.edit_kind));

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(json!({
            "method": edit.method,
            "path": edit.path,
            "body": edit.body,
            "response": response_json,
        })),
    ))
}

#[derive(Debug, PartialEq)]
struct SearchEditRequest {
    method: String,
    path: String,
    body: String,
}

fn search_edit_request(
    request: &DataEditExecutionRequest,
) -> Result<SearchEditRequest, CommandError> {
    match request.edit_kind.as_str() {
        "index-document" => index_document_request(request),
        "update-document" => update_document_request(request),
        "delete-document" => delete_document_request(request),
        other => Err(CommandError::new(
            "search-edit-unsupported",
            format!("Search document edit `{other}` is not supported."),
        )),
    }
}

fn index_document_request(
    request: &DataEditExecutionRequest,
) -> Result<SearchEditRequest, CommandError> {
    let index = required_index(request)?;
    let document_id = required_document_id(request)?;
    let source = change_document(request)?;
    let body = serde_json::to_string(&source)
        .map_err(|error| CommandError::new("search-edit-json", error.to_string()))?;

    Ok(SearchEditRequest {
        method: "PUT".into(),
        path: format!(
            "/{}/_doc/{}?refresh=true",
            path_segment(&index),
            path_segment(&document_id)
        ),
        body,
    })
}

fn update_document_request(
    request: &DataEditExecutionRequest,
) -> Result<SearchEditRequest, CommandError> {
    let index = required_index(request)?;
    let document_id = required_document_id(request)?;
    let source = change_document(request)?;
    let body = serde_json::to_string(&json!({ "doc": source }))
        .map_err(|error| CommandError::new("search-edit-json", error.to_string()))?;

    Ok(SearchEditRequest {
        method: "POST".into(),
        path: format!(
            "/{}/_update/{}?refresh=true",
            path_segment(&index),
            path_segment(&document_id)
        ),
        body,
    })
}

fn delete_document_request(
    request: &DataEditExecutionRequest,
) -> Result<SearchEditRequest, CommandError> {
    let index = required_index(request)?;
    let document_id = required_document_id(request)?;

    Ok(SearchEditRequest {
        method: "DELETE".into(),
        path: format!(
            "/{}/_doc/{}?refresh=true",
            path_segment(&index),
            path_segment(&document_id)
        ),
        body: String::new(),
    })
}

fn required_index(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    request
        .target
        .table
        .clone()
        .or_else(|| request.target.collection.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "search-edit-missing-index",
                "Search document edits require a target index.",
            )
        })
}

fn required_document_id(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    request
        .target
        .document_id
        .as_ref()
        .map(document_id_to_string)
        .or_else(|| request.target.key.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "search-edit-missing-document-id",
                "Search document edits require a stable document id.",
            )
        })
}

fn change_document(request: &DataEditExecutionRequest) -> Result<Value, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "search-edit-missing-changes",
            "Search document index/update edits require at least one field value.",
        ));
    }

    let mut source = Map::new();
    for change in &request.changes {
        let field = change
            .field
            .clone()
            .or_else(|| {
                change
                    .path
                    .as_ref()
                    .filter(|path| !path.is_empty())
                    .map(|path| path.join("."))
            })
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    "search-edit-missing-field",
                    "Search document edits require field names for each change.",
                )
            })?;
        source.insert(field, change.value.clone().unwrap_or(Value::Null));
    }

    Ok(Value::Object(source))
}

fn document_id_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn path_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

fn data_edit_response(
    request: &DataEditExecutionRequest,
    plan: DataEditPlanResponse,
    executed: bool,
    messages: Vec<String>,
    warnings: Vec<String>,
    metadata: Option<Value>,
) -> DataEditExecutionResponse {
    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan.execution_support,
        executed,
        plan: plan.plan,
        messages,
        warnings,
        result: None,
        metadata,
    }
}

#[cfg(test)]
mod tests {
    use crate::domain::models::DataEditTarget;

    use super::*;

    fn request(edit_kind: &str, changes: Vec<DataEditChange>) -> DataEditExecutionRequest {
        DataEditExecutionRequest {
            connection_id: "conn-search".into(),
            environment_id: "env-dev".into(),
            edit_kind: edit_kind.into(),
            target: DataEditTarget {
                object_kind: "document".into(),
                table: Some("orders".into()),
                document_id: Some(json!("101")),
                ..Default::default()
            },
            changes,
            confirmation_text: None,
        }
    }

    #[test]
    fn search_update_document_request_builds_partial_doc_body() {
        let edit = search_edit_request(&request(
            "update-document",
            vec![DataEditChange {
                field: Some("status".into()),
                value: Some(json!("fulfilled")),
                ..Default::default()
            }],
        ))
        .expect("update document");

        assert_eq!(edit.method, "POST");
        assert_eq!(edit.path, "/orders/_update/101?refresh=true");
        assert_eq!(edit.body, r#"{"doc":{"status":"fulfilled"}}"#);
    }

    #[test]
    fn search_index_document_request_requires_document_id_and_uses_source_body() {
        let edit = search_edit_request(&request(
            "index-document",
            vec![DataEditChange {
                field: Some("total_amount".into()),
                value: Some(json!(128.4)),
                ..Default::default()
            }],
        ))
        .expect("index document");

        assert_eq!(edit.method, "PUT");
        assert_eq!(edit.path, "/orders/_doc/101?refresh=true");
        assert_eq!(edit.body, r#"{"total_amount":128.4}"#);
    }

    #[test]
    fn search_delete_document_request_has_empty_body() {
        let edit =
            search_edit_request(&request("delete-document", Vec::new())).expect("delete document");

        assert_eq!(edit.method, "DELETE");
        assert_eq!(edit.path, "/orders/_doc/101?refresh=true");
        assert!(edit.body.is_empty());
    }

    #[test]
    fn path_segment_percent_encodes_reserved_characters() {
        assert_eq!(path_segment("orders 2026/05"), "orders%202026%2F05");
    }
}
