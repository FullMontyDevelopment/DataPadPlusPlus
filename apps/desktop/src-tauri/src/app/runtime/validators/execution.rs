use crate::domain::{
    error::CommandError,
    models::{
        CancelExecutionRequest, DocumentNodeChildrenRequest, ExecutionRequest, ResultPageRequest,
    },
};

use super::common::*;

pub(in crate::app::runtime) fn validate_execution_request(
    request: &mut ExecutionRequest,
) -> Result<(), CommandError> {
    validate_optional_text(
        request.execution_id.as_deref(),
        "Execution id",
        MAX_ID_LENGTH,
    )?;
    validate_required_id(&request.tab_id, "Tab id")?;
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_required_text(&request.language, "Query language", 80)?;
    validate_query_text(&request.query_text, "Query text")?;
    validate_optional_text(
        request.execution_input_mode.as_deref(),
        "Execution input mode",
        32,
    )?;
    if let Some(script) = &request.script_text {
        validate_query_text(script, "Script text")?;
    }
    if let Some(selected) = &request.selected_text {
        validate_query_text(selected, "Selected text")?;
    }
    validate_optional_text(request.mode.as_deref(), "Execution mode", 32)?;
    if let Some(builder_state) = &request.builder_state {
        assert_json_size(builder_state, "Query builder state")?;
    }
    if request.mode.as_deref() == Some("count") && request.builder_state.is_none() {
        return Err(invalid_request(
            "Query Builder Count requires the current builder state.",
        ));
    }
    validate_optional_text(
        request.confirmed_guardrail_id.as_deref(),
        "Guardrail confirmation id",
        MAX_ID_LENGTH,
    )?;
    clamp_optional_u32(&mut request.row_limit, 1, MAX_ROW_LIMIT);
    Ok(())
}

pub(in crate::app::runtime) fn validate_result_page_request(
    request: &mut ResultPageRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_required_text(&request.language, "Query language", 80)?;
    validate_query_text(&request.query_text, "Query text")?;
    if let Some(selected) = &request.selected_text {
        validate_query_text(selected, "Selected text")?;
    }
    validate_required_text(&request.renderer, "Result renderer", 80)?;
    if !RESULT_RENDERERS.contains(&request.renderer.as_str()) {
        return Err(invalid_request(format!(
            "Unsupported result renderer: {}.",
            request.renderer
        )));
    }
    validate_optional_text(request.cursor.as_deref(), "Result cursor", MAX_SCOPE_LENGTH)?;
    clamp_optional_u32(&mut request.page_size, 1, MAX_RESULT_PAGE_SIZE);
    clamp_optional_u32(&mut request.page_index, 0, MAX_RESULT_PAGE_INDEX);
    Ok(())
}

pub(in crate::app::runtime) fn validate_document_node_children_request(
    request: &DocumentNodeChildrenRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_required_text(
        &request.collection,
        "Collection name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        request.database.as_deref(),
        "Database name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    if let Some(query_text) = &request.query_text {
        validate_query_text(query_text, "Query text")?;
    }
    const MAX_DOCUMENT_PATH_SEGMENTS: usize = 100;
    if request.path.is_empty() || request.path.len() > MAX_DOCUMENT_PATH_SEGMENTS {
        return Err(invalid_request(format!(
            "Document field path must contain 1 to {MAX_DOCUMENT_PATH_SEGMENTS} segments."
        )));
    }
    for segment in &request.path {
        if segment.as_str().is_none() && segment.as_u64().is_none() {
            return Err(invalid_request(
                "Document field path segments must be strings or array indexes.",
            ));
        }
    }
    assert_json_size(&request.document_id, "Document id")?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_cancel_execution_request(
    request: &CancelExecutionRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.execution_id, "Execution id")?;
    validate_optional_text(request.tab_id.as_deref(), "Tab id", MAX_ID_LENGTH)
}

pub(in crate::app::runtime) fn validate_required_tab_id(tab_id: &str) -> Result<(), CommandError> {
    validate_required_id(tab_id, "Tab id")
}
