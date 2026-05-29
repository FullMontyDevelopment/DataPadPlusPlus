use crate::domain::{
    error::CommandError,
    models::{
        AdapterDiagnosticsRequest, CreateObjectViewTabRequest, DataEditExecutionRequest,
        DataEditPlanRequest, ExplorerInspectRequest, ExplorerRequest, OperationExecutionRequest,
        OperationManifestRequest, OperationPlanRequest, PermissionInspectionRequest,
        RedisKeyInspectRequest, RedisKeyScanRequest, StructureRequest,
    },
};

use super::common::*;

pub(in crate::app::runtime) fn validate_explorer_request(
    request: &mut ExplorerRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_optional_text(request.scope.as_deref(), "Explorer scope", MAX_SCOPE_LENGTH)?;
    clamp_optional_u32(&mut request.limit, 1, MAX_EXPLORER_LIMIT);
    Ok(())
}

pub(in crate::app::runtime) fn validate_structure_request(
    request: &mut StructureRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_optional_text(
        request.scope.as_deref(),
        "Structure scope",
        MAX_SCOPE_LENGTH,
    )?;
    validate_optional_text(
        request.cursor.as_deref(),
        "Structure cursor",
        MAX_SCOPE_LENGTH,
    )?;
    validate_optional_id(request.focus_node_id.as_deref(), "Structure focus node id")?;
    if let Some(mode) = request.mode.as_deref() {
        if mode != "overview" && mode != "relationships" {
            return Err(invalid_request("Structure mode is invalid."));
        }
    }
    clamp_optional_u32(&mut request.limit, 1, MAX_STRUCTURE_LIMIT);
    clamp_optional_u32(&mut request.max_nodes, 1, MAX_STRUCTURE_LIMIT);
    clamp_optional_u32(&mut request.max_edges, 0, MAX_STRUCTURE_LIMIT * 4);
    clamp_optional_u32(&mut request.depth, 0, 6);
    Ok(())
}

pub(in crate::app::runtime) fn validate_explorer_inspect_request(
    request: &ExplorerInspectRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_required_id(&request.node_id, "Explorer node id")?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_create_object_view_tab_request(
    request: &CreateObjectViewTabRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_optional_id(request.environment_id.as_deref(), "Environment id")?;
    validate_required_id(&request.node_id, "Object view node id")?;
    validate_required_text(&request.label, "Object view label", MAX_OBJECT_NAME_LENGTH)?;
    validate_required_text(&request.kind, "Object view kind", 80)?;
    validate_path(request.path.as_deref().unwrap_or(&[]), "Object view path")?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_redis_key_scan_request(
    request: &mut RedisKeyScanRequest,
) -> Result<(), CommandError> {
    validate_optional_text(request.tab_id.as_deref(), "Tab id", MAX_ID_LENGTH)?;
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_optional_text(request.delimiter.as_deref(), "Redis delimiter", 8)?;
    validate_optional_text(
        request.pattern.as_deref(),
        "Redis key pattern",
        MAX_SCOPE_LENGTH,
    )?;
    validate_optional_text(request.type_filter.as_deref(), "Redis type filter", 64)?;
    validate_optional_text(request.cursor.as_deref(), "Redis cursor", 128)?;
    clamp_optional_u32(&mut request.database_index, 0, MAX_REDIS_DATABASE);
    clamp_optional_u32(&mut request.count, 1, MAX_REDIS_COUNT);
    clamp_optional_u32(&mut request.page_size, 1, MAX_REDIS_PAGE_SIZE);
    Ok(())
}

pub(in crate::app::runtime) fn validate_redis_key_inspect_request(
    request: &mut RedisKeyInspectRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.tab_id, "Tab id")?;
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_required_text(&request.key, "Redis key", MAX_SCOPE_LENGTH)?;
    clamp_optional_u32(&mut request.sample_size, 1, MAX_REDIS_SAMPLE_SIZE);
    Ok(())
}

pub(in crate::app::runtime) fn validate_operation_manifest_request(
    request: &OperationManifestRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_optional_text(
        request.scope.as_deref(),
        "Operation scope",
        MAX_SCOPE_LENGTH,
    )?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_operation_plan_request(
    request: &OperationPlanRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_operation_id(&request.operation_id)?;
    validate_optional_text(
        request.object_name.as_deref(),
        "Operation object name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    assert_json_size(&request.parameters, "Operation parameters")?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_operation_execution_request(
    request: &mut OperationExecutionRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_operation_id(&request.operation_id)?;
    validate_optional_text(
        request.object_name.as_deref(),
        "Operation object name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        request.confirmation_text.as_deref(),
        "Confirmation text",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(request.tab_id.as_deref(), "Tab id", MAX_ID_LENGTH)?;
    assert_json_size(&request.parameters, "Operation parameters")?;
    clamp_optional_u32(&mut request.row_limit, 1, MAX_ROW_LIMIT);
    Ok(())
}

pub(in crate::app::runtime) fn validate_permission_inspection_request(
    request: &PermissionInspectionRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_adapter_diagnostics_request(
    request: &AdapterDiagnosticsRequest,
) -> Result<(), CommandError> {
    validate_required_id(&request.connection_id, "Connection id")?;
    validate_required_id(&request.environment_id, "Environment id")?;
    validate_optional_text(
        request.scope.as_deref(),
        "Diagnostics scope",
        MAX_SCOPE_LENGTH,
    )?;
    Ok(())
}

pub(in crate::app::runtime) fn validate_data_edit_plan_request(
    request: &DataEditPlanRequest,
) -> Result<(), CommandError> {
    validate_data_edit_shape(
        &request.connection_id,
        &request.environment_id,
        &request.edit_kind,
        &request.target,
        &request.changes,
    )
}

pub(in crate::app::runtime) fn validate_data_edit_execution_request(
    request: &DataEditExecutionRequest,
) -> Result<(), CommandError> {
    validate_data_edit_shape(
        &request.connection_id,
        &request.environment_id,
        &request.edit_kind,
        &request.target,
        &request.changes,
    )?;
    validate_optional_text(
        request.confirmation_text.as_deref(),
        "Confirmation text",
        MAX_OBJECT_NAME_LENGTH,
    )
}

fn validate_data_edit_shape(
    connection_id: &str,
    environment_id: &str,
    edit_kind: &str,
    target: &crate::domain::models::DataEditTarget,
    changes: &[crate::domain::models::DataEditChange],
) -> Result<(), CommandError> {
    validate_required_id(connection_id, "Connection id")?;
    validate_required_id(environment_id, "Environment id")?;
    if !DATA_EDIT_KINDS.contains(&edit_kind) {
        return Err(invalid_request(format!(
            "Unsupported data edit kind: {}.",
            if edit_kind.is_empty() {
                "(empty)"
            } else {
                edit_kind
            }
        )));
    }
    validate_required_text(&target.object_kind, "Data edit object kind", 80)?;
    validate_path(&target.path, "Data edit target path")?;
    validate_optional_text(
        target.database.as_deref(),
        "Database name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        target.schema.as_deref(),
        "Schema name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        target.table.as_deref(),
        "Table name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(
        target.collection.as_deref(),
        "Collection name",
        MAX_OBJECT_NAME_LENGTH,
    )?;
    validate_optional_text(target.key.as_deref(), "Key name", MAX_OBJECT_NAME_LENGTH)?;
    assert_json_size(target, "Data edit target")?;
    if changes.len() > MAX_DATA_EDIT_CHANGES {
        return Err(invalid_request(format!(
            "Data edits may include at most {MAX_DATA_EDIT_CHANGES} changes."
        )));
    }
    for change in changes {
        validate_optional_text(
            change.field.as_deref(),
            "Data edit field",
            MAX_OBJECT_NAME_LENGTH,
        )?;
        validate_optional_text(
            change.new_name.as_deref(),
            "Data edit new field name",
            MAX_OBJECT_NAME_LENGTH,
        )?;
        validate_optional_text(change.value_type.as_deref(), "Data edit value type", 80)?;
        validate_path(
            change.path.as_deref().unwrap_or(&[]),
            "Data edit change path",
        )?;
        assert_json_size(change, "Data edit change")?;
    }
    Ok(())
}
