use std::collections::BTreeMap;

use super::validators::{
    validate_adapter_diagnostics_request, validate_data_edit_execution_request,
    validate_data_edit_plan_request, validate_explorer_inspect_request, validate_explorer_request,
    validate_operation_execution_request, validate_operation_manifest_request,
    validate_operation_plan_request, validate_permission_inspection_request,
    validate_redis_key_inspect_request, validate_redis_key_scan_request,
    validate_structure_request,
};
use super::{
    environment_guards::{
        apply_environment_guards_to_data_edit_plan, apply_environment_guards_to_operation_plan,
        data_edit_execution_blocked_response, data_edit_safe_mode_block_reasons,
        data_edit_safe_mode_blocked, environment_execution_blocked,
        merge_environment_plan_into_data_edit_response,
        merge_environment_plan_into_operation_response, operation_execution_blocked_response,
    },
    response_redaction::{
        redact_adapter_diagnostics_for_environment, redact_data_edit_plan_response_for_environment,
        redact_data_edit_response_for_environment, redact_execution_result_for_environment,
        redact_explorer_inspection_for_environment, redact_explorer_response_for_environment,
        redact_operation_plan_response_for_environment, redact_operation_response_for_environment,
        redact_permission_inspection_response_for_environment,
        redact_redis_key_scan_response_for_environment, redact_structure_response_for_environment,
    },
    timestamp_now, ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::{redact_sensitive_text, CommandError},
        models::{
            AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, DataEditExecutionRequest,
            DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse,
            DatastoreExperienceResponse, ExplorerInspectRequest, ExplorerInspectResponse,
            ExplorerRequest, ExplorerResponse, OperationExecutionRequest,
            OperationExecutionResponse, OperationManifestRequest, OperationManifestResponse,
            OperationPlanRequest, OperationPlanResponse, PermissionInspectionRequest,
            PermissionInspectionResponse, QueryHistoryEntry, RedisKeyInspectRequest,
            RedisKeyScanRequest, RedisKeyScanResponse, StructureRequest, StructureResponse,
        },
    },
};

impl ManagedAppState {
    pub async fn list_explorer_nodes(
        &mut self,
        mut request: ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_explorer_request(&mut request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let response = redact_explorer_response_for_environment(
            adapters::list_explorer_nodes(&resolved, &request).await?,
            &resolved_environment,
        );

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
        validate_explorer_inspect_request(&request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let response = adapters::inspect_explorer_node(&resolved, &request).await?;
        Ok(redact_explorer_inspection_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn load_structure_map(
        &self,
        mut request: StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_structure_request(&mut request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        Ok(redact_structure_response_for_environment(
            adapters::load_structure_map(&resolved, &request).await?,
            &resolved_environment,
        ))
    }

    pub async fn scan_redis_keys(
        &self,
        mut request: RedisKeyScanRequest,
    ) -> Result<RedisKeyScanResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_redis_key_scan_request(&mut request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        Ok(redact_redis_key_scan_response_for_environment(
            adapters::scan_redis_keys(&resolved, &request).await?,
            &resolved_environment,
        ))
    }

    pub async fn inspect_redis_key(
        &mut self,
        mut request: RedisKeyInspectRequest,
    ) -> Result<crate::domain::models::ExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_redis_key_inspect_request(&mut request)?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let result = redact_execution_result_for_environment(
            adapters::inspect_redis_key(&resolved, &request).await?,
            &resolved_environment,
        );
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
            tab.active_execution = None;
            self.snapshot.ui.active_tab_id = tab.id.clone();
            self.snapshot.ui.active_connection_id = tab.connection_id.clone();
            self.snapshot.ui.active_environment_id = tab.environment_id.clone();
            tab.clone()
        };
        self.snapshot.ui.bottom_panel_visible = true;
        self.snapshot.ui.active_bottom_panel_tab = "results".into();
        self.snapshot.updated_at = timestamp_now();

        Ok(crate::domain::models::ExecutionResponse {
            execution_id: request
                .execution_id
                .unwrap_or_else(|| super::generate_id("execution")),
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
            persistence_warning: None,
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
        validate_operation_manifest_request(&request)?;
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
        validate_operation_plan_request(&request)?;
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
        plan.generated_request = redact_sensitive_text(&plan.generated_request);

        let response = OperationPlanResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            plan,
        };
        Ok(redact_operation_plan_response_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn execute_operation(
        &self,
        mut request: OperationExecutionRequest,
    ) -> Result<OperationExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_operation_execution_request(&mut request)?;
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
        plan.generated_request = redact_sensitive_text(&plan.generated_request);

        if environment_execution_blocked(&resolved_environment) {
            let response = operation_execution_blocked_response(
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
            );
            return Ok(redact_operation_response_for_environment(
                response,
                &resolved_environment,
            ));
        }

        if let Some(expected) = plan.confirmation_text.clone() {
            if request.confirmation_text.as_deref() != Some(expected.as_str()) {
                let response = operation_execution_blocked_response(
                    &request,
                    operation
                        .as_ref()
                        .map(|item| item.execution_support.as_str())
                        .unwrap_or("unsupported"),
                    plan,
                    vec!["This operation needs confirmation before it can run.".into()],
                );
                return Ok(redact_operation_response_for_environment(
                    response,
                    &resolved_environment,
                ));
            }
        }

        let mut response = adapters::execute_operation(&resolved, &request).await?;
        merge_environment_plan_into_operation_response(&mut response, plan);
        Ok(redact_operation_response_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn plan_data_edit(
        &self,
        request: DataEditPlanRequest,
    ) -> Result<DataEditPlanResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_data_edit_plan_request(&request)?;
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
        response.plan.generated_request = redact_sensitive_text(&response.plan.generated_request);
        Ok(redact_data_edit_plan_response_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn execute_data_edit(
        &self,
        mut request: DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_data_edit_execution_request(&request)?;
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
        plan_response.plan.generated_request =
            redact_sensitive_text(&plan_response.plan.generated_request);

        if environment_execution_blocked(&resolved_environment) {
            let response = data_edit_execution_blocked_response(
                &request,
                plan_response,
                vec![
                    "Unresolved environment variables must be fixed before this data edit can run."
                        .into(),
                ],
            );
            return Ok(redact_data_edit_response_for_environment(
                response,
                &resolved_environment,
            ));
        }

        if data_edit_safe_mode_blocked(&environment, self.snapshot.preferences.safe_mode_enabled) {
            let response = data_edit_execution_blocked_response(
                &request,
                plan_response,
                data_edit_safe_mode_block_reasons(
                    &environment,
                    self.snapshot.preferences.safe_mode_enabled,
                ),
            );
            return Ok(redact_data_edit_response_for_environment(
                response,
                &resolved_environment,
            ));
        }

        if let Some(expected) = plan_response.plan.confirmation_text.clone() {
            if request.confirmation_text.as_deref() != Some(expected.as_str()) {
                let response = data_edit_execution_blocked_response(
                    &request,
                    plan_response,
                    vec!["This data edit needs confirmation before it can run.".into()],
                );
                return Ok(redact_data_edit_response_for_environment(
                    response,
                    &resolved_environment,
                ));
            }
        }

        let mut response = adapters::execute_data_edit(&resolved, &request).await?;
        merge_environment_plan_into_data_edit_response(&mut response, plan_response.plan);
        Ok(redact_data_edit_response_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn inspect_permissions(
        &self,
        request: PermissionInspectionRequest,
    ) -> Result<PermissionInspectionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_permission_inspection_request(&request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let inspection = adapters::inspect_permissions(&resolved).await?;

        Ok(redact_permission_inspection_response_for_environment(
            PermissionInspectionResponse {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                inspection,
            },
            &resolved_environment,
        ))
    }

    pub async fn collect_adapter_diagnostics(
        &self,
        request: AdapterDiagnosticsRequest,
    ) -> Result<AdapterDiagnosticsResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_adapter_diagnostics_request(&request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let diagnostics =
            adapters::collect_diagnostics(&resolved, request.scope.as_deref()).await?;

        Ok(AdapterDiagnosticsResponse {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            diagnostics: redact_adapter_diagnostics_for_environment(
                diagnostics,
                &resolved_environment,
            ),
        })
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
