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
    mut request: OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let selection = resolve_datastore_transfer_selection(&mut request)?;
    let runtime = clone_runtime(&state)?;
    let execution = runtime.execute_operation(request).await;
    let mut response = match execution {
        Ok(response) => response,
        Err(mut error) => {
            if let Some(selection) = selection.as_ref() {
                let _ = complete_datastore_transfer_selection(selection, false);
                redact_datastore_transfer_error(&mut error, selection);
            }
            return Err(error);
        }
    };
    if let Some(selection) = selection.as_ref() {
        complete_datastore_transfer_selection(selection, true)?;
        redact_datastore_transfer_path(&mut response, selection);
    }
    Ok(response)
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
pub async fn execute_test_suite(
    state: State<'_, SharedAppState>,
    test_runs: State<'_, SharedTestRunRegistry>,
    mut request: ExecuteTestSuiteRequest,
) -> Result<ExecuteTestSuiteResponse, CommandError> {
    let run_id = request
        .run_id
        .clone()
        .unwrap_or_else(|| generate_id("test-run"));
    request.run_id = Some(run_id.clone());
    let tab_id = request.tab_id.clone();
    let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
    {
        let mut runs = lock_test_runs(&test_runs)?;
        runs.register(run_id.clone(), cancel_sender)
            .map_err(|message| CommandError::new("test-run-active", message))?;
    }
    if let Err(error) = mark_tab_execution_running(
        &state,
        &tab_id,
        &run_id,
        Some("Running datastore test suite".into()),
    ) {
        if let Ok(mut runs) = lock_test_runs(&test_runs) {
            runs.remove(&run_id);
        }
        return Err(error);
    }
    let mut runtime = match clone_runtime(&state) {
        Ok(runtime) => runtime,
        Err(error) => {
            if let Ok(mut runs) = lock_test_runs(&test_runs) {
                runs.remove(&run_id);
            }
            clear_tab_execution_after_error_best_effort(
                &state,
                &tab_id,
                &run_id,
                error.message.clone(),
            );
            return Err(error);
        }
    };
    let execution = runtime
        .execute_test_suite_with_cancellation(request, cancel_receiver)
        .await;
    {
        let mut runs = lock_test_runs(&test_runs)?;
        runs.remove(&run_id);
    }

    match execution {
        Ok(response) => merge_test_suite_response(&state, response, &run_id),
        Err(error) => {
            clear_tab_execution_after_error_best_effort(
                &state,
                &tab_id,
                &run_id,
                error.message.clone(),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn plan_test_suite_run(
    state: State<'_, SharedAppState>,
    request: DatastoreTestRunPlanRequest,
) -> Result<DatastoreTestRunPlanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.plan_test_suite_run(request)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, SharedAppState>,
    test_runs: State<'_, SharedTestRunRegistry>,
    request: CancelTestRunRequest,
) -> Result<CancelExecutionResult, CommandError> {
    {
        let runs = lock_test_runs(&test_runs)?;
        runs.cancel(&request.run_id);
    }
    let mut state = lock_state(&state)?;
    state.cancel_test_run(request)
}

fn merge_test_suite_response(
    state: &State<'_, SharedAppState>,
    mut response: ExecuteTestSuiteResponse,
    run_id: &str,
) -> Result<ExecuteTestSuiteResponse, CommandError> {
    let mut state = lock_state(state)?;
    let Some(index) = state
        .snapshot
        .tabs
        .iter()
        .position(|tab| tab.id == response.tab.id)
    else {
        return Err(CommandError::new(
            "tab-missing",
            "Test suite tab was closed before the run completed.",
        ));
    };
    let current = state.snapshot.tabs[index].clone();
    if current
        .active_execution
        .as_ref()
        .is_some_and(|active| active.execution_id != run_id)
    {
        return Err(CommandError::new(
            "test-run-stale",
            "A newer test run now owns this tab.",
        ));
    }
    response.tab.title = current.title;
    response.tab.pinned = current.pinned;
    response.tab.save_target = current.save_target;
    response.tab.saved_query_id = current.saved_query_id;
    response.tab.dirty = current.dirty;
    response.tab.active_execution = None;
    state.snapshot.tabs[index] = response.tab.clone();
    state.snapshot.ui.active_tab_id = response.tab.id.clone();
    state.snapshot.ui.active_connection_id = response.tab.connection_id.clone();
    state.snapshot.ui.active_environment_id = response.tab.environment_id.clone();
    state.snapshot.ui.bottom_panel_visible = true;
    state.snapshot.ui.active_bottom_panel_tab = "results".into();
    state.snapshot.updated_at = timestamp_now();
    state.persist()?;
    Ok(response)
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
pub async fn materialize_result_renderer(
    state: State<'_, SharedAppState>,
    request: MaterializeResultRendererRequest,
) -> Result<MaterializeResultRendererResponse, CommandError> {
    let result = {
        let state = lock_state(&state)?;
        let tab = state
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let result = tab
            .result
            .as_ref()
            .filter(|result| result.id == request.result_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    "result-stale",
                    "The result changed before this view could be prepared.",
                )
            })?;
        result
    };
    let renderer = request.renderer.clone();
    let payload = tauri::async_runtime::spawn_blocking(move || {
        adapters::materialize_result_renderer(&result, &renderer)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "result-materialization-failed",
            format!("The result view could not be prepared: {error}"),
        )
    })??;

    Ok(MaterializeResultRendererResponse {
        tab_id: request.tab_id,
        result_id: request.result_id,
        renderer: request.renderer,
        payload,
    })
}

#[tauri::command]
pub async fn fetch_document_node_children(
    state: State<'_, SharedAppState>,
    request: DocumentNodeChildrenRequest,
) -> Result<DocumentNodeChildrenResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.fetch_document_node_children(request).await
}
