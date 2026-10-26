use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use super::{
    environments::resolve_string_template,
    generate_id,
    response_redaction::{
        prepare_execution_result_for_workspace, prepare_result_page_for_workspace,
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
            QueryExecutionNotice, QueryHistoryEntry, ResolvedConnectionProfile, ResultPageRequest,
            ResultPageResponse, ScopedQueryTarget, SqlQueryScope, UserFacingError,
        },
    },
    security,
};

impl ManagedAppState {
    pub async fn execute_query(
        &mut self,
        request: ExecutionRequest,
    ) -> Result<ExecutionResponse, CommandError> {
        self.execute_query_internal(request, false).await
    }

    pub async fn execute_workbench_query(
        &mut self,
        request: ExecutionRequest,
    ) -> Result<ExecutionResponse, CommandError> {
        self.execute_query_internal(request, true).await
    }

    async fn execute_query_internal(
        &mut self,
        mut request: ExecutionRequest,
        retain_result_session: bool,
    ) -> Result<ExecutionResponse, CommandError> {
        self.ensure_unlocked()?;
        validate_execution_request(&mut request)?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        super::library::validate_tab_environment_context(
            &self.snapshot,
            &self.snapshot.tabs[tab_index],
            &request.connection_id,
            &request.environment_id,
        )?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let environment = self.environment_by_id(&request.environment_id)?;
        let (mut resolved_connection, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        apply_scoped_target_override(&mut resolved_connection, request.scoped_target.as_ref());
        apply_sql_query_scope(&mut resolved_connection, request.sql_scope.as_ref())?;
        let query_template = adapters::selected_query(&request).to_string();
        if profile.engine == "mongodb" && request.execution_input_mode.as_deref() == Some("script")
        {
            security::analyze_mongodb_script(&query_template)?;
        }
        let is_script = profile.engine == "mongodb"
            && request.execution_input_mode.as_deref() == Some("script");
        let query_text = if is_script {
            super::script_templates::resolve_script_template(
                &query_template,
                &resolved_environment.variables,
            )?
        } else {
            resolve_string_template(&query_template, &resolved_environment.variables)?
        };
        super::datastore_mcp_server::authorize_run_step(
            &self.app,
            request.execution_id.as_deref(),
            &query_text,
            &request.language,
        )?;
        let mut resolved_request = request.clone();
        if is_script {
            resolved_request.script_timeout = self
                .snapshot
                .preferences
                .query_results
                .script_timeout
                .clone();
            resolved_request.script_timeout.validate()?;
            let app = self.app.clone();
            let environment = resolved_environment.clone();
            let execution_id = request.execution_id.clone();
            let tab_id = request.tab_id.clone();
            resolved_request.script_progress = Some(std::sync::Arc::new(move |mut progress| {
                use tauri::{Emitter, Manager};
                if app
                    .try_state::<super::SharedAppState>()
                    .is_some_and(|state| {
                        state
                            .try_lock()
                            .map(|runtime| runtime.snapshot.lock_state.is_locked)
                            .unwrap_or(true)
                    })
                {
                    return;
                }
                super::response_redaction::redact_external_value(&mut progress, &environment);
                progress["executionId"] = serde_json::json!(execution_id);
                progress["tabId"] = serde_json::json!(tab_id);
                let _ = app.emit("query-script-progress", progress);
            }));
            // Only the chosen source participates in validation and execution.
            resolved_request.query_text = query_text.clone();
            resolved_request.script_text = Some(query_text.clone());
            resolved_request.selected_text = None;
        } else {
            resolved_request.query_text = query_text.clone();
            resolved_request.selected_text = None;
            resolved_request.script_text = None;
        }
        resolved_request.datastore_execution_input = if is_script {
            None
        } else {
            request
                .datastore_execution_input
                .as_ref()
                .map(|value| resolve_json_templates(value, &resolved_environment.variables))
                .transpose()?
        };
        let mut guardrail = security::evaluate_guardrails(
            &profile,
            &environment,
            &resolved_environment,
            &query_text,
            self.snapshot.preferences.safe_mode_enabled,
        );
        let required_approval = guardrail.status == "confirm";
        if required_approval {
            let legacy_guardrail_id = confirmation_guardrail_id(
                &profile.id,
                &environment.id,
                request.mode.as_deref().unwrap_or("full"),
                &query_text,
                request.sql_scope.as_ref(),
            );
            let guardrail_id = if retain_result_session {
                let mut bound_request = request.clone();
                bound_request.execution_id = None;
                bound_request.confirmed_guardrail_id = None;
                let workspace_id = self.workspace_switcher_status()?.active_workspace_id;
                let context = serde_json::to_value((
                    workspace_id,
                    bound_request,
                    &query_text,
                    (
                        &resolved_connection.host,
                        &resolved_connection.database,
                        &resolved_connection.connection_string,
                        &resolved_connection.username,
                        &resolved_connection.password,
                    ),
                    &profile,
                    &environment,
                    self.snapshot.preferences.safe_mode_enabled,
                    &self.snapshot.preferences.query_results,
                ))?;
                let binding = Sha256::digest(serde_json::to_vec(&context)?)
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                if let Some(id) = request.confirmed_guardrail_id.as_deref() {
                    super::execution_approvals::consume(id, &binding)?;
                    id.to_string()
                } else {
                    super::execution_approvals::issue(binding)?
                }
            } else {
                legacy_guardrail_id
            };
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
                            sql_scope: request.sql_scope.clone(),
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
                self.snapshot.updated_at = timestamp_now();

                return Ok(ExecutionResponse {
                    execution_id: request
                        .execution_id
                        .unwrap_or_else(|| generate_id("execution")),
                    tab: tab_response,
                    result: None,
                    guardrail,
                    diagnostics: Vec::new(),
                    persistence_warning: None,
                });
            }
            guardrail.status = "allow".into();
            guardrail.id = None;
            guardrail.required_confirmation_text = None;
            guardrail.reasons = vec!["Execution approved for this run.".into()];
        }

        let mut execution_notices = if required_approval {
            vec![QueryExecutionNotice {
                code: "guardrail-approved".into(),
                level: "info".into(),
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

        let preview_documents = retain_result_session
            && resolved_connection.engine == "mongodb"
            && request.document_efficiency_mode == Some(true)
            && serde_json::from_str::<Value>(&query_text).is_ok_and(|input| {
                input.get("projection").is_none()
                    && input.get("pipeline").is_none()
                    && matches!(
                        input
                            .get("operation")
                            .and_then(Value::as_str)
                            .unwrap_or("find")
                            .to_lowercase()
                            .as_str(),
                        "find" | "findone"
                    )
            });
        // Keep the full values in the session; efficiency mode affects presentation only.
        if preview_documents {
            resolved_request.document_efficiency_mode = Some(false);
        }
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
                Ok(mut result) => {
                    let limit = retain_result_session
                        .then_some(self.snapshot.preferences.query_results.maximum_loaded_rows)
                        .flatten();
                    if let Some(limit) = limit {
                        for payload in &mut result.payloads {
                            super::result_sessions::truncate_payload(payload, limit as usize);
                        }
                        if let Some(info) = &mut result.page_info {
                            info.buffered_rows = info.buffered_rows.min(limit);
                            if info.buffered_rows >= limit {
                                info.has_more = false;
                            }
                        }
                    }
                    if retain_result_session {
                        let mut session_request = resolved_request.clone();
                        session_request.document_efficiency_mode = Some(preview_documents);
                        let mut session = super::result_sessions::ResultSession::new(
                            session_request,
                            resolved_connection.clone(),
                            &result,
                            limit,
                        );
                        session.context_stamp = super::result_sessions::context_stamp(
                            &self.snapshot,
                            &request.connection_id,
                        );
                        self.result_sessions.insert(result.id.clone(), session);
                    }
                    if preview_documents {
                        for payload in &mut result.payloads {
                            if payload.get("renderer").and_then(Value::as_str) == Some("document") {
                                *payload = super::result_sessions::document_preview(payload);
                            }
                        }
                    }
                    Some(std::sync::Arc::new(prepare_execution_result_for_workspace(
                        result,
                        &resolved_environment,
                    )))
                }
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
            tab.sql_scope = request.sql_scope.clone();
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
                    sql_scope: request.sql_scope.clone(),
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
        self.validate_result_context(
            &request.tab_id,
            &request.connection_id,
            &request.environment_id,
        )?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (mut resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        apply_scoped_target_override(&mut resolved, request.scoped_target.as_ref());
        apply_sql_query_scope(&mut resolved, request.sql_scope.as_ref())?;
        let mut resolved_request = request.clone();
        resolved_request.query_text =
            resolve_string_template(&request.query_text, &resolved_environment.variables)?;
        resolved_request.selected_text = request
            .selected_text
            .as_deref()
            .map(|value| resolve_string_template(value, &resolved_environment.variables))
            .transpose()?;
        let response = adapters::fetch_result_page(&resolved, &resolved_request).await?;
        Ok(prepare_result_page_for_workspace(
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
        self.validate_result_context(
            &request.tab_id,
            &request.connection_id,
            &request.environment_id,
        )?;
        let profile = self.connection_by_id(&request.connection_id)?;
        let (resolved, _, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        adapters::fetch_document_node_children(&resolved, &request).await
    }

    pub(crate) fn validate_result_context(
        &self,
        tab_id: &str,
        connection_id: &str,
        environment_id: &str,
    ) -> Result<(), CommandError> {
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == tab_id)
            .ok_or_else(|| {
                CommandError::new("tab-missing", "The result tab is no longer available.")
            })?;
        super::library::validate_tab_environment_context(
            &self.snapshot,
            tab,
            connection_id,
            environment_id,
        )
    }
}

fn resolve_json_templates(
    value: &Value,
    variables: &HashMap<String, String>,
) -> Result<Value, CommandError> {
    match value {
        Value::String(value) => Ok(Value::String(resolve_string_template(value, variables)?)),
        Value::Array(values) => values
            .iter()
            .map(|value| resolve_json_templates(value, variables))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => values
            .iter()
            .map(|(key, value)| {
                resolve_json_templates(value, variables).map(|value| (key.clone(), value))
            })
            .collect::<Result<serde_json::Map<_, _>, _>>()
            .map(Value::Object),
        _ => Ok(value.clone()),
    }
}

fn apply_scoped_target_override(
    connection: &mut ResolvedConnectionProfile,
    target: Option<&ScopedQueryTarget>,
) {
    let Some(target) = target else {
        return;
    };
    let path = target_path_values(connection, target);

    match connection.engine.as_str() {
        // LiteDB's database is a file path, never an Explorer display label or namespace.
        // Its adapter selects collections within that same file.
        "mongodb" => {
            if let Some(database) = direct_target_value(target, &["database", "catalog"])
                .or_else(|| scoped_namespace(target, &["collection", "view", "documents"]))
                .or_else(|| path.first().cloned())
            {
                connection.database = Some(database);
            }
        }
        "cosmosdb" => {
            if let Some(database) = direct_target_value(target, &["database", "catalog"])
                .or_else(|| scoped_namespace(target, &["container", "collection", "graph"]))
                .or_else(|| path.first().cloned())
            {
                connection.database = Some(database.clone());
                if let Some(options) = connection.cosmos_db_options.as_mut() {
                    options.database_name = Some(database);
                }
            }
            if let Some(container) = cosmos_container_from_target(target) {
                if let Some(options) = connection.cosmos_db_options.as_mut() {
                    options.container_prefix = Some(container);
                }
            }
        }
        "cassandra" => {
            let keyspace = scoped_namespace(target, &["table", "data", "materialized-view"])
                .or_else(|| path.first().cloned());
            if let (Some(keyspace), Some(options)) =
                (keyspace, connection.cassandra_options.as_mut())
            {
                connection.database = Some(keyspace.clone());
                options.default_keyspace = Some(keyspace);
            }
        }
        "redis" | "valkey" => {
            if let Some(database_index) = redis_database_index(target) {
                if let Some(options) = connection.redis_options.as_mut() {
                    options.database_index = Some(database_index);
                }
            }
        }
        "neo4j" | "arango" | "janusgraph" => {
            let graph_name = direct_target_value(target, &["graph", "database"])
                .or_else(|| target_path_value_after(target, &["graphs", "databases"]));
            if let (Some(graph_name), Some(options)) = (
                graph_name.filter(|value| !value.is_empty()),
                connection.graph_options.as_mut(),
            ) {
                options.database_name = Some(graph_name.clone());
                options.graph_name = Some(graph_name);
            }
        }
        "influxdb" | "opentsdb" | "prometheus" => {
            let namespace = direct_target_value(target, &["bucket", "database"])
                .or_else(|| target_path_value_after(target, &["buckets", "databases"]));
            if let (Some(namespace), Some(options)) =
                (namespace, connection.time_series_options.as_mut())
            {
                if connection.engine == "influxdb" {
                    options.bucket = Some(namespace.clone());
                }
                options.database_name = Some(namespace);
            }
        }
        "clickhouse" | "duckdb" | "snowflake" | "bigquery" => {
            let namespace = direct_target_value(target, &["database", "catalog", "project"])
                .or_else(|| {
                    target_path_value_after(target, &["databases", "catalogs", "projects"])
                });
            let scoped_schema = sql_schema_from_target(target)
                .or_else(|| direct_target_value(target, &["schema", "dataset"]));
            if let (Some(namespace), Some(options)) =
                (namespace, connection.warehouse_options.as_mut())
            {
                connection.database = Some(namespace.clone());
                if connection.engine == "bigquery" {
                    options.project_id = Some(namespace.clone());
                } else if connection.engine == "snowflake" {
                    options.database_name = Some(namespace.clone());
                    options.catalog_name = Some(namespace.clone());
                } else {
                    options.database_name = Some(namespace.clone());
                }
            }
            if let (Some(schema), Some(options)) =
                (scoped_schema, connection.warehouse_options.as_mut())
            {
                if connection.engine == "bigquery" {
                    options.dataset_id = Some(schema);
                } else {
                    options.schema_name = Some(schema);
                }
            }
        }
        "postgresql" | "cockroachdb" | "timescaledb" | "sqlserver" | "mysql" | "mariadb"
        | "oracle" => {
            if let Some(database) = sql_database_from_target(connection, target, &path) {
                connection.database = Some(database);
            }
            if matches!(
                connection.engine.as_str(),
                "postgresql" | "cockroachdb" | "timescaledb"
            ) {
                if let (Some(schema), Some(options)) = (
                    sql_schema_from_target(target),
                    connection.postgres_options.as_mut(),
                ) {
                    options.search_path = Some(schema);
                }
            }
        }
        _ => {}
    }
}

fn apply_sql_query_scope(
    connection: &mut ResolvedConnectionProfile,
    scope: Option<&SqlQueryScope>,
) -> Result<(), CommandError> {
    adapters::apply_sql_query_scope(connection, scope)
}

fn scoped_namespace(target: &ScopedQueryTarget, prefixes: &[&str]) -> Option<String> {
    let scope = target.scope.as_deref()?;
    let (prefix, value) = scope.split_once(':')?;
    if !prefixes.contains(&normalized_kind(prefix).as_str()) {
        return None;
    }
    value
        .split([':', '.'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn redis_database_index(target: &ScopedQueryTarget) -> Option<u32> {
    let scope_value = target
        .scope
        .as_deref()
        .and_then(|scope| scope.strip_prefix("db:"))
        .and_then(|value| value.split(':').next());
    let label_value = target.label.trim().strip_prefix("DB ");
    scope_value.or(label_value)?.parse().ok()
}

fn cosmos_container_from_target(target: &ScopedQueryTarget) -> Option<String> {
    direct_target_value(target, &["container", "collection", "graph"])
        .or_else(|| target_path_value_after(target, &["containers", "collections", "graphs"]))
        .or_else(|| {
            let parts = target.scope.as_deref()?.split(':').collect::<Vec<_>>();
            (matches!(parts.first(), Some(&"cosmos"))
                && matches!(
                    parts.get(1),
                    Some(&"container") | Some(&"items") | Some(&"partition-key")
                )
                && parts.len() >= 4)
                .then(|| parts[3].trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn direct_target_value(target: &ScopedQueryTarget, kinds: &[&str]) -> Option<String> {
    kinds
        .contains(&normalized_kind(&target.kind).as_str())
        .then(|| target.label.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn target_path_value_after(target: &ScopedQueryTarget, containers: &[&str]) -> Option<String> {
    target.path.windows(2).find_map(|pair| {
        containers
            .contains(&normalized_kind(&pair[0]).as_str())
            .then(|| pair[1].trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn sql_database_from_target(
    connection: &ResolvedConnectionProfile,
    target: &ScopedQueryTarget,
    path: &[String],
) -> Option<String> {
    if let Some(database) = direct_target_value(target, &["database", "catalog"]) {
        return Some(database);
    }
    let scope = target.scope.as_deref().unwrap_or_default();
    if connection.engine == "oracle" {
        if let Some(database) = oracle_object_target(scope).and_then(|target| target.database) {
            return Some(database);
        }
    }
    if let Some(database) = target_path_value_after(target, &["databases", "catalogs"]) {
        return Some(database);
    }

    let parts = scope.split(':').collect::<Vec<_>>();
    if connection.engine == "sqlserver" && parts.len() >= 4 && parts[0] == "table" {
        return Some(parts[1].to_string());
    }
    if matches!(connection.engine.as_str(), "mysql" | "mariadb") {
        if let Some(identity) = scope.strip_prefix("table:") {
            return identity.split('.').next().map(str::to_string);
        }
        if parts.first() == Some(&"mysql") && parts.len() >= 2 {
            return Some(parts[1].to_string());
        }
    }

    (path.len() >= 2).then(|| path[0].clone())
}

fn sql_schema_from_target(target: &ScopedQueryTarget) -> Option<String> {
    if let Some(schema) = direct_target_value(target, &["schema", "dataset"]) {
        return Some(schema);
    }
    let scope = target.scope.as_deref()?;
    if let Some(target) = oracle_object_target(scope) {
        return Some(target.schema);
    }
    if let Some(schema) = target_path_value_after(target, &["schemas", "user-schemas", "datasets"])
    {
        return Some(schema);
    }

    let parts = scope.split(':').collect::<Vec<_>>();
    if parts.first() == Some(&"table") && parts.len() >= 4 {
        return Some(parts[2].to_string());
    }
    let identity = scope.split_once(':')?.1;
    identity
        .split(['.', ':'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

struct OracleObjectTarget {
    database: Option<String>,
    schema: String,
}

fn oracle_object_target(scope: &str) -> Option<OracleObjectTarget> {
    let parts = scope.split(':').collect::<Vec<_>>();
    if parts.first() != Some(&"oracle") || parts.get(1) != Some(&"object") {
        return None;
    }

    let (database, schema) = match parts.as_slice() {
        [_, _, _, "database", database, schema, _] => (
            Some(decode_scope_component(database)?),
            decode_scope_component(schema)?,
        ),
        [_, _, _, "schema", schema, _] | [_, _, _, schema, _] => {
            (None, decode_scope_component(schema)?)
        }
        _ => return None,
    };
    Some(OracleObjectTarget { database, schema })
}

fn decode_scope_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let hex = bytes.get(index + 1..index + 3)?;
        let hex = std::str::from_utf8(hex).ok()?;
        decoded.push(u8::from_str_radix(hex, 16).ok()?);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn target_path_values(
    connection: &ResolvedConnectionProfile,
    target: &ScopedQueryTarget,
) -> Vec<String> {
    const CONTAINERS: &[&str] = &[
        "databases",
        "catalogs",
        "schemas",
        "user schemas",
        "tables",
        "views",
        "materialized views",
        "collections",
        "containers",
        "indexes",
        "data streams",
        "keyspaces",
        "graphs",
        "node labels",
        "metrics",
        "measurements",
        "buckets",
    ];
    target
        .path
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .filter(|value| !value.eq_ignore_ascii_case(&connection.name))
        .filter(|value| !CONTAINERS.contains(&value.to_ascii_lowercase().as_str()))
        .map(str::to_string)
        .collect()
}

fn normalized_kind(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

pub(super) fn confirmation_guardrail_id(
    connection_id: &str,
    environment_id: &str,
    mode: &str,
    query_text: &str,
    sql_scope: Option<&SqlQueryScope>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(connection_id.as_bytes());
    hasher.update([0]);
    hasher.update(environment_id.as_bytes());
    hasher.update([0]);
    hasher.update(mode.as_bytes());
    hasher.update([0]);
    hasher.update(query_text.as_bytes());
    hasher.update([0]);
    if let Some(scope) = sql_scope {
        hasher.update(serde_json::to_vec(scope).unwrap_or_default());
    }
    let digest = hasher.finalize();
    let short_id = digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("guardrail-{short_id}")
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/execution_target_tests.rs"]
mod execution_target_tests;
