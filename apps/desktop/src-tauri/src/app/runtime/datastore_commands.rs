use std::collections::BTreeMap;

use serde_json::json;

use super::{
    environment_guards::{
        apply_environment_guards_to_data_edit_plan, apply_environment_guards_to_operation_plan,
        data_edit_execution_blocked_response, environment_execution_blocked,
        merge_environment_plan_into_data_edit_response,
        merge_environment_plan_into_operation_response, operation_execution_blocked_response,
    },
    timestamp_now, ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, DataEditExecutionRequest,
            DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse,
            DatastoreExperienceResponse, ExplorerInspectRequest, ExplorerInspectResponse,
            ExplorerRequest, ExplorerResponse, OperationExecutionRequest,
            OperationExecutionResponse, OperationManifestRequest, OperationManifestResponse,
            OperationPlanRequest, OperationPlanResponse, PermissionInspectionRequest,
            PermissionInspectionResponse, QueryHistoryEntry, RedisKeyInspectRequest,
            RedisKeyScanRequest, RedisKeyScanResponse, StructureRequest, StructureResponse,
            UserFacingError,
        },
    },
};

impl ManagedAppState {
    pub async fn list_explorer_nodes(
        &mut self,
        request: ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let response = adapters::list_explorer_nodes(&resolved, &request).await?;

        if request.scope.is_none() {
            self.snapshot.explorer_nodes = response.nodes.clone();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
        }

        Ok(response)
    }

    pub async fn inspect_explorer_node(
        &self,
        request: ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        adapters::inspect_explorer_node(&resolved, &request).await
    }

    pub async fn load_structure_map(
        &self,
        request: StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        adapters::load_structure_map(&resolved, &request).await
    }

    pub async fn scan_redis_keys(
        &self,
        request: RedisKeyScanRequest,
    ) -> Result<RedisKeyScanResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        adapters::scan_redis_keys(&resolved, &request).await
    }

    pub async fn inspect_redis_key(
        &mut self,
        request: RedisKeyInspectRequest,
    ) -> Result<crate::domain::models::ExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let result = adapters::inspect_redis_key(&resolved, &request).await?;
        let executed_at = timestamp_now();
        let tab_response = {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.status = "success".into();
            tab.last_run_at = Some(executed_at.clone());
            tab.history.insert(
                0,
                QueryHistoryEntry {
                    id: super::generate_id("history"),
                    query_text: format!("INSPECT {}", request.key),
                    executed_at,
                    status: "success".into(),
                },
            );
            tab.error = None;
            tab.result = Some(result.clone());
            self.snapshot.ui.active_tab_id = tab.id.clone();
            self.snapshot.ui.active_connection_id = tab.connection_id.clone();
            self.snapshot.ui.active_environment_id = tab.environment_id.clone();
            tab.clone()
        };
        self.snapshot.ui.bottom_panel_visible = true;
        self.snapshot.ui.active_bottom_panel_tab = "results".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;

        Ok(crate::domain::models::ExecutionResponse {
            execution_id: super::generate_id("execution"),
            tab: tab_response,
            result: Some(result),
            guardrail: crate::domain::models::GuardrailDecision {
                id: None,
                status: "allow".into(),
                reasons: Vec::new(),
                safe_mode_applied: false,
                required_confirmation_text: None,
            },
            diagnostics: Vec::new(),
        })
    }

    pub fn list_datastore_experiences(&self) -> Result<DatastoreExperienceResponse, CommandError> {
        self.ensure_unlocked()?;

        Ok(DatastoreExperienceResponse {
            experiences: adapters::experience_manifests(),
        })
    }

    pub async fn list_operation_manifests(
        &self,
        request: OperationManifestRequest,
    ) -> Result<OperationManifestResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let operations = adapters::operation_manifests(&resolved)?;

        Ok(OperationManifestResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            engine: resolved.engine,
            operations,
        })
    }

    pub async fn plan_operation(
        &self,
        request: OperationPlanRequest,
    ) -> Result<OperationPlanResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let parameters = request.parameters.as_ref().map(|items| {
            items
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        });
        let mut plan = adapters::plan_operation(
            &resolved,
            &request.operation_id,
            request.object_name.as_deref(),
            parameters.as_ref(),
        )
        .await?;
        let operation = adapters::operation_manifests(&resolved)?
            .into_iter()
            .find(|item| item.id == request.operation_id);
        apply_environment_guards_to_operation_plan(
            &mut plan,
            operation.as_ref(),
            &environment,
            &resolved_environment,
            self.snapshot.preferences.safe_mode_enabled,
        );

        Ok(OperationPlanResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            plan,
        })
    }

    pub async fn execute_operation(
        &self,
        request: OperationExecutionRequest,
    ) -> Result<OperationExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let parameters = request.parameters.as_ref().map(|items| {
            items
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        });
        let mut plan = adapters::plan_operation(
            &resolved,
            &request.operation_id,
            request.object_name.as_deref(),
            parameters.as_ref(),
        )
        .await?;
        let operation = adapters::operation_manifests(&resolved)?
            .into_iter()
            .find(|item| item.id == request.operation_id);
        apply_environment_guards_to_operation_plan(
            &mut plan,
            operation.as_ref(),
            &environment,
            &resolved_environment,
            self.snapshot.preferences.safe_mode_enabled,
        );

        if environment_execution_blocked(&resolved_environment) {
            return Ok(operation_execution_blocked_response(
                &request,
                operation
                    .as_ref()
                    .map(|item| item.execution_support.as_str())
                    .unwrap_or("unsupported"),
                plan,
                vec![
                    "Unresolved environment variables must be fixed before this operation can run."
                        .into(),
                ],
            ));
        }

        if let Some(expected) = plan.confirmation_text.clone() {
            if request.confirmation_text.as_deref() != Some(expected.as_str()) {
                return Ok(operation_execution_blocked_response(
                    &request,
                    operation
                        .as_ref()
                        .map(|item| item.execution_support.as_str())
                        .unwrap_or("unsupported"),
                    plan,
                    vec![format!(
                        "Type `{expected}` before executing this operation."
                    )],
                ));
            }
        }

        let mut response = adapters::execute_operation(&resolved, &request).await?;
        merge_environment_plan_into_operation_response(&mut response, plan);
        Ok(response)
    }

    pub async fn plan_data_edit(
        &self,
        request: DataEditPlanRequest,
    ) -> Result<DataEditPlanResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let mut response = adapters::plan_data_edit(&resolved, &request).await?;
        apply_environment_guards_to_data_edit_plan(
            &mut response.plan,
            &environment,
            &resolved_environment,
            self.snapshot.preferences.safe_mode_enabled,
        );
        Ok(response)
    }

    pub async fn execute_data_edit(
        &self,
        mut request: DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        if can_auto_confirm_redis_single_key_delete(
            &resolved,
            &environment,
            &request,
            self.snapshot.preferences.safe_mode_enabled,
        ) {
            request.confirmation_text = Some(format!(
                "CONFIRM {} {}",
                resolved.engine.to_uppercase(),
                request.edit_kind.to_uppercase()
            ));
        }
        let plan_request = DataEditPlanRequest {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            edit_kind: request.edit_kind.clone(),
            target: request.target.clone(),
            changes: request.changes.clone(),
        };
        let mut plan_response = adapters::plan_data_edit(&resolved, &plan_request).await?;
        apply_environment_guards_to_data_edit_plan(
            &mut plan_response.plan,
            &environment,
            &resolved_environment,
            self.snapshot.preferences.safe_mode_enabled,
        );

        if environment_execution_blocked(&resolved_environment) {
            return Ok(data_edit_execution_blocked_response(
                &request,
                plan_response,
                vec![
                    "Unresolved environment variables must be fixed before this data edit can run."
                        .into(),
                ],
            ));
        }

        if let Some(expected) = plan_response.plan.confirmation_text.clone() {
            if request.confirmation_text.as_deref() != Some(expected.as_str()) {
                return Ok(data_edit_execution_blocked_response(
                    &request,
                    plan_response,
                    vec![format!(
                        "Type `{expected}` before executing this data edit."
                    )],
                ));
            }
        }

        let mut response = adapters::execute_data_edit(&resolved, &request).await?;
        merge_environment_plan_into_data_edit_response(&mut response, plan_response.plan);
        Ok(response)
    }

    pub async fn inspect_permissions(
        &self,
        request: PermissionInspectionRequest,
    ) -> Result<PermissionInspectionResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let inspection = adapters::inspect_permissions(&resolved).await?;

        Ok(PermissionInspectionResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            inspection,
        })
    }

    pub async fn collect_adapter_diagnostics(
        &self,
        request: AdapterDiagnosticsRequest,
    ) -> Result<AdapterDiagnosticsResponse, CommandError> {
        self.ensure_unlocked()?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let diagnostics =
            adapters::collect_diagnostics(&resolved, request.scope.as_deref()).await?;

        Ok(AdapterDiagnosticsResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            diagnostics,
        })
    }

    pub async fn refresh_metrics_tab(
        &mut self,
        tab_id: &str,
    ) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Metrics tab was not found."))?;
        let tab = self.snapshot.tabs[tab_index].clone();

        if tab.tab_kind.as_deref() != Some("metrics") {
            return Err(CommandError::new(
                "tab-kind-invalid",
                "Only Metrics tabs can refresh connection metrics.",
            ));
        }

        let profile = self.connection_by_id(&tab.connection_id)?;
        let (resolved, _, _) = self.resolve_connection_profile(&profile, &tab.environment_id)?;
        let refreshed_at = timestamp_now();
        let diagnostics_result = adapters::collect_diagnostics(&resolved, Some("connection")).await;

        {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.last_run_at = Some(refreshed_at.clone());
            tab.dirty = false;
            tab.result = None;
            match diagnostics_result {
                Ok(diagnostics) => {
                    let warnings = diagnostics.warnings.clone();
                    tab.status = "success".into();
                    tab.error = None;
                    tab.metrics_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "lastRefreshedAt": refreshed_at,
                        "diagnostics": diagnostics,
                        "warnings": warnings,
                    }));
                }
                Err(error) => {
                    tab.status = "error".into();
                    tab.error = Some(UserFacingError {
                        code: error.code.clone(),
                        message: error.message.clone(),
                    });
                    tab.metrics_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "lastRefreshedAt": refreshed_at,
                        "warnings": [error.message],
                    }));
                }
            }
        }

        self.snapshot.ui.active_tab_id = tab_id.into();
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub async fn refresh_object_view_tab(
        &mut self,
        tab_id: &str,
    ) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Object view tab was not found."))?;
        let tab = self.snapshot.tabs[tab_index].clone();

        if tab.tab_kind.as_deref() != Some("object-view") {
            return Err(CommandError::new(
                "tab-kind-invalid",
                "Only object-view tabs can refresh object metadata.",
            ));
        }

        let object_view_state = tab.object_view_state.clone().ok_or_else(|| {
            CommandError::new(
                "object-view-state-missing",
                "Object view tab is missing its target metadata.",
            )
        })?;
        let node_id = object_view_state
            .get("nodeId")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                CommandError::new(
                    "object-view-node-missing",
                    "Object view tab is missing its target node id.",
                )
            })?
            .to_string();
        let label = object_view_state
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("Object")
            .to_string();
        let kind = object_view_state
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("object")
            .to_string();
        let path = object_view_state.get("path").cloned();

        let profile = self.connection_by_id(&tab.connection_id)?;
        let (resolved, _, _) = self.resolve_connection_profile(&profile, &tab.environment_id)?;
        let refreshed_at = timestamp_now();
        let inspect_result = adapters::inspect_explorer_node(
            &resolved,
            &ExplorerInspectRequest {
                connection_id: tab.connection_id.clone(),
                environment_id: tab.environment_id.clone(),
                node_id: node_id.clone(),
            },
        )
        .await;

        {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.last_run_at = Some(refreshed_at.clone());
            tab.dirty = false;
            tab.result = None;
            match inspect_result {
                Ok(inspection) => {
                    tab.status = "success".into();
                    tab.error = None;
                    tab.object_view_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "nodeId": node_id,
                        "label": label,
                        "kind": kind,
                        "path": path,
                        "summary": inspection.summary,
                        "queryTemplate": inspection.query_template,
                        "payload": inspection.payload,
                        "lastRefreshedAt": refreshed_at,
                        "warnings": []
                    }));
                }
                Err(error) => {
                    tab.status = "error".into();
                    tab.error = Some(UserFacingError {
                        code: error.code.clone(),
                        message: error.message.clone(),
                    });
                    tab.object_view_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "nodeId": node_id,
                        "label": label,
                        "kind": kind,
                        "path": path,
                        "lastRefreshedAt": refreshed_at,
                        "warnings": [error.message]
                    }));
                }
            }
        }

        self.snapshot.ui.active_tab_id = tab_id.into();
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

fn can_auto_confirm_redis_single_key_delete(
    connection: &crate::domain::models::ResolvedConnectionProfile,
    environment: &crate::domain::models::EnvironmentProfile,
    request: &DataEditExecutionRequest,
    global_safe_mode: bool,
) -> bool {
    matches!(connection.engine.as_str(), "redis" | "valkey")
        && request.edit_kind == "delete-key"
        && request
            .target
            .key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty() && !key.contains('*'))
        && !connection.read_only
        && !global_safe_mode
        && !environment.safe_mode
        && !environment.requires_confirmation
        && matches!(environment.risk.as_str(), "low" | "medium")
}
