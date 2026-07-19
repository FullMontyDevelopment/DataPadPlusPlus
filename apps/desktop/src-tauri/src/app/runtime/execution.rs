use sha2::{Digest, Sha256};

use super::{
    environments::resolve_string_template,
    generate_id,
    response_redaction::{
        redact_execution_result_for_environment, redact_result_page_for_environment,
    },
    sql_hints::{enrich_sql_execution_error, sql_dialect_hint_message},
    timestamp_now,
    validators::{
        validate_cancel_execution_request, validate_document_node_children_request,
        validate_execution_request, validate_result_page_request,
    },
    ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            CancelExecutionRequest, CancelExecutionResult, DocumentNodeChildrenRequest,
            DocumentNodeChildrenResponse, ExecutionRequest, ExecutionResponse,
            QueryExecutionNotice, QueryHistoryEntry, ResultPageRequest, ResultPageResponse,
            UserFacingError,
        },
    },
    security,
};

impl ManagedAppState {
    pub async fn execute_query(
        &mut self,
        mut request: ExecutionRequest,
    ) -> Result<ExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_execution_request(&mut request)?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (resolved_connection, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let query_template = adapters::selected_query(&request).to_string();
        if profile.engine == "mongodb" && request.execution_input_mode.as_deref() == Some("script")
        {
            security::analyze_mongodb_script(&query_template)?;
        }
        let query_text = resolve_string_template(&query_template, &resolved_environment.variables)?;
        let mut resolved_request = request.clone();
        resolved_request.query_text =
            resolve_string_template(&request.query_text, &resolved_environment.variables)?;
        resolved_request.selected_text = request
            .selected_text
            .as_deref()
            .map(|value| resolve_string_template(value, &resolved_environment.variables))
            .transpose()?;
        resolved_request.script_text = request
            .script_text
            .as_deref()
            .map(|value| resolve_string_template(value, &resolved_environment.variables))
            .transpose()?;
        let mut guardrail = security::evaluate_guardrails(
            &profile,
            &environment,
            &resolved_environment,
            &query_text,
            self.snapshot.preferences.safe_mode_enabled,
        );
        if guardrail.status == "confirm" {
            let guardrail_id = confirmation_guardrail_id(
                &profile.id,
                &environment.id,
                request.mode.as_deref().unwrap_or("full"),
                &query_text,
            );
            guardrail.id = Some(guardrail_id.clone());
            guardrail.required_confirmation_text = Some(format!("CONFIRM {}", environment.label));

            if request.confirmed_guardrail_id.as_deref() != Some(guardrail_id.as_str()) {
                let executed_at = timestamp_now();
                let tab_response = {
                    let tab = &mut self.snapshot.tabs[tab_index];
                    tab.query_text = request.query_text.clone();
                    if request.execution_input_mode.as_deref() == Some("script") {
                        tab.script_text = request.script_text.clone();
                    }
                    tab.query_view_mode = request.execution_input_mode.clone();
                    if request.document_efficiency_mode.is_some() {
                        tab.document_efficiency_mode = request.document_efficiency_mode;
                    }
                    tab.status = "blocked".into();
                    tab.last_run_at = Some(executed_at.clone());
                    tab.history.insert(
                        0,
                        QueryHistoryEntry {
                            id: generate_id("history"),
                            query_text: query_template,
                            executed_at,
                            status: "blocked".into(),
                        },
                    );
                    tab.error = Some(UserFacingError {
                        code: "guardrail-confirmation-required".into(),
                        message: guardrail.reasons.join(" "),
                    });
                    tab.result = None;
                    tab.active_execution = None;
                    self.snapshot.ui.active_tab_id = tab.id.clone();
                    self.snapshot.ui.active_connection_id = tab.connection_id.clone();
                    self.snapshot.ui.active_environment_id = tab.environment_id.clone();
                    tab.clone()
                };

                self.snapshot.guardrails = vec![guardrail.clone()];
                self.snapshot.ui.bottom_panel_visible = true;
                self.snapshot.ui.active_bottom_panel_tab = "messages".into();
                self.snapshot.updated_at = timestamp_now();

                return Ok(ExecutionResponse {
                    execution_id: request
                        .execution_id
                        .unwrap_or_else(|| generate_id("execution")),
                    tab: tab_response,
                    result: None,
                    guardrail,
                    diagnostics: vec![
                        "Execution requires explicit confirmation before running.".into()
                    ],
                    persistence_warning: None,
                });
            }
        }

        let mut execution_notices = if guardrail.status == "confirm" {
            vec![QueryExecutionNotice {
                code: "guardrail-confirm".into(),
                level: "warning".into(),
                message: guardrail
                    .reasons
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "Confirmation required.".into()),
            }]
        } else {
            Vec::new()
        };
        execution_notices.push(QueryExecutionNotice {
            code: "sql-syntax-hint".into(),
            level: "info".into(),
            message: sql_dialect_hint_message(&resolved_connection, &query_text)
                .unwrap_or_default(),
        });
        execution_notices.retain(|notice| !notice.message.is_empty());

        let result = if guardrail.status == "block" {
            None
        } else {
            match adapters::execute(
                &resolved_connection,
                &resolved_request,
                execution_notices.clone(),
            )
            .await
            {
                Ok(result) => Some(redact_execution_result_for_environment(
                    result,
                    &resolved_environment,
                )),
                Err(error) => {
                    return Err(enrich_sql_execution_error(
                        &resolved_connection,
                        &query_text,
                        error,
                    ))
                }
            }
        };

        let status = if guardrail.status == "block" {
            "blocked".to_string()
        } else if result.is_some() {
            "success".to_string()
        } else {
            "error".to_string()
        };

        let executed_at = timestamp_now();
        let tab_response = {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.query_text = request.query_text.clone();
            if request.execution_input_mode.as_deref() == Some("script") {
                tab.script_text = request.script_text.clone();
            }
            tab.query_view_mode = request.execution_input_mode.clone();
            if request.document_efficiency_mode.is_some() {
                tab.document_efficiency_mode = request.document_efficiency_mode;
            }
            tab.status = status.clone();
            tab.last_run_at = Some(executed_at.clone());
            tab.history.insert(
                0,
                QueryHistoryEntry {
                    id: generate_id("history"),
                    query_text: query_template,
                    executed_at,
                    status: status.clone(),
                },
            );
            tab.error = if guardrail.status == "block" {
                Some(UserFacingError {
                    code: "guardrail-blocked".into(),
                    message: guardrail.reasons.join(" "),
                })
            } else {
                None
            };
            tab.result = result.clone();
            tab.active_execution = None;
            self.snapshot.ui.active_tab_id = tab.id.clone();
            self.snapshot.ui.active_connection_id = tab.connection_id.clone();
            self.snapshot.ui.active_environment_id = tab.environment_id.clone();
            tab.clone()
        };
        self.snapshot.guardrails = vec![guardrail.clone()];
        self.snapshot.ui.bottom_panel_visible = true;
        self.snapshot.ui.active_bottom_panel_tab = "results".into();
        self.snapshot.updated_at = timestamp_now();

        Ok(ExecutionResponse {
            execution_id: request
                .execution_id
                .unwrap_or_else(|| generate_id("execution")),
            tab: tab_response,
            result,
            guardrail,
            diagnostics: execution_notices
                .into_iter()
                .map(|notice| notice.message)
                .collect(),
            persistence_warning: None,
        })
    }

    pub async fn cancel_execution(
        &self,
        request: CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        self.ensure_unlocked()?;
        validate_cancel_execution_request(&request)?;
        let tab = request
            .tab_id
            .as_ref()
            .and_then(|tab_id| self.snapshot.tabs.iter().find(|item| &item.id == tab_id))
            .cloned()
            .ok_or_else(|| {
                CommandError::new("tab-missing", "Tab was not found for cancellation.")
            })?;
        let profile = self.connection_by_id(&tab.connection_id)?;
        let (resolved, _, _) = self.resolve_connection_profile(&profile, &tab.environment_id)?;
        adapters::cancel(&resolved, &request).await
    }

    pub async fn fetch_result_page(
        &self,
        mut request: ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_result_page_request(&mut request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        let mut resolved_request = request.clone();
        resolved_request.query_text =
            resolve_string_template(&request.query_text, &resolved_environment.variables)?;
        resolved_request.selected_text = request
            .selected_text
            .as_deref()
            .map(|value| resolve_string_template(value, &resolved_environment.variables))
            .transpose()?;
        let response = adapters::fetch_result_page(&resolved, &resolved_request).await?;
        Ok(redact_result_page_for_environment(
            response,
            &resolved_environment,
        ))
    }

    pub async fn fetch_document_node_children(
        &self,
        request: DocumentNodeChildrenRequest,
    ) -> Result<DocumentNodeChildrenResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_document_node_children_request(&request)?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        adapters::fetch_document_node_children(&resolved, &request).await
    }
}

fn confirmation_guardrail_id(
    connection_id: &str,
    environment_id: &str,
    mode: &str,
    query_text: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(connection_id.as_bytes());
    hasher.update([0]);
    hasher.update(environment_id.as_bytes());
    hasher.update([0]);
    hasher.update(mode.as_bytes());
    hasher.update([0]);
    hasher.update(query_text.as_bytes());
    let digest = hasher.finalize();
    let short_id = digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("guardrail-{short_id}")
}
