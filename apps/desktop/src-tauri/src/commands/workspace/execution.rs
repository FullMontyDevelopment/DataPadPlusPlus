use super::*;

#[tauri::command]
pub async fn list_datastore_operations(
    state: State<'_, SharedAppState>,
    request: OperationManifestRequest,
) -> Result<OperationManifestResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.list_operation_manifests(request).await
}

#[tauri::command]
pub async fn plan_datastore_operation(
    state: State<'_, SharedAppState>,
    request: OperationPlanRequest,
) -> Result<OperationPlanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.plan_operation(request).await
}

#[tauri::command]
pub async fn execute_datastore_operation(
    state: State<'_, SharedAppState>,
    request: OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.execute_operation(request).await
}

#[tauri::command]
pub async fn plan_data_edit(
    state: State<'_, SharedAppState>,
    request: DataEditPlanRequest,
) -> Result<DataEditPlanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.plan_data_edit(request).await
}

#[tauri::command]
pub async fn execute_data_edit(
    state: State<'_, SharedAppState>,
    request: DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.execute_data_edit(request).await
}

#[tauri::command]
pub async fn inspect_connection_permissions(
    state: State<'_, SharedAppState>,
    request: PermissionInspectionRequest,
) -> Result<PermissionInspectionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.inspect_permissions(request).await
}

#[tauri::command]
pub async fn collect_adapter_diagnostics(
    state: State<'_, SharedAppState>,
    request: AdapterDiagnosticsRequest,
) -> Result<AdapterDiagnosticsResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.collect_adapter_diagnostics(request).await
}

#[tauri::command]
pub async fn refresh_metrics_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.refresh_metrics_tab(&tab_id).await?;
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn refresh_object_view_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.refresh_object_view_tab(&tab_id).await?;
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn execute_query_request(
    state: State<'_, SharedAppState>,
    executions: State<'_, SharedExecutionRegistry>,
    mut request: ExecutionRequest,
) -> Result<ExecutionResponse, CommandError> {
    let execution_id = request_execution_id(&mut request);
    let tab_id = request.tab_id.clone();
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "execute-query-start execution={} connection={} environment={} language={} mode={}",
            execution_id,
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.language,
            request.mode.as_deref().unwrap_or("full")
        ),
    );
    mark_tab_execution_running(&state, &tab_id, &execution_id, None)?;
    let mut runtime = clone_runtime(&state)?;
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut executions = lock_executions(&executions)?;
        executions.register(execution_id.clone(), abort_handle);
    }
    let execution =
        Abortable::new(runtime.execute_query(request.clone()), abort_registration).await;
    {
        let mut executions = lock_executions(&executions)?;
        executions.remove(&execution_id);
    }
    match execution {
        Err(_) => {
            infrastructure::log_breadcrumb(
                "command",
                format!("execute-query-complete execution={execution_id} canceled=true"),
            );
            clear_tab_execution_after_cancel(&state, &request, &execution_id)
        }
        Ok(Ok(response)) => {
            infrastructure::log_breadcrumb(
                "command",
                format!("execute-query-complete execution={execution_id} ok=true"),
            );
            merge_execution_response(&state, response)
        }
        Ok(Err(error)) => {
            let message = error.message.clone();
            clear_tab_execution_after_error_best_effort(&state, &tab_id, &execution_id, message);
            infrastructure::log_breadcrumb(
                "command",
                format!("execute-query-complete execution={execution_id} ok=false"),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn execute_test_suite(
    state: State<'_, SharedAppState>,
    request: ExecuteTestSuiteRequest,
) -> Result<ExecuteTestSuiteResponse, CommandError> {
    let mut state = lock_state(&state)?;
    state.execute_test_suite(request)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, SharedAppState>,
    request: CancelTestRunRequest,
) -> Result<CancelExecutionResult, CommandError> {
    let mut state = lock_state(&state)?;
    state.cancel_test_run(request)
}

#[tauri::command]
pub async fn cancel_execution_request(
    state: State<'_, SharedAppState>,
    executions: State<'_, SharedExecutionRegistry>,
    request: CancelExecutionRequest,
) -> Result<CancelExecutionResult, CommandError> {
    adapters::cancel_mongodb_script_execution(&request.execution_id);
    {
        let mut executions = lock_executions(&executions)?;
        if executions.abort(&request.execution_id) {
            return Ok(CancelExecutionResult {
                ok: true,
                supported: true,
                message: format!(
                    "Cancellation requested for execution {}.",
                    request.execution_id
                ),
            });
        }
    }

    let runtime = clone_runtime(&state)?;
    runtime.cancel_execution(request).await
}

#[tauri::command]
pub async fn fetch_result_page(
    state: State<'_, SharedAppState>,
    request: ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.fetch_result_page(request).await
}

#[tauri::command]
pub async fn fetch_document_node_children(
    state: State<'_, SharedAppState>,
    request: DocumentNodeChildrenRequest,
) -> Result<DocumentNodeChildrenResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.fetch_document_node_children(request).await
}
