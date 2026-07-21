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
            QueryExecutionNotice, QueryHistoryEntry, ResolvedConnectionProfile, ResultPageRequest,
            ResultPageResponse, ScopedQueryTarget, UserFacingError,
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
        let (mut resolved_connection, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        apply_scoped_target_override(&mut resolved_connection, request.scoped_target.as_ref());
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
        let (mut resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &request.environment_id)?;
        apply_scoped_target_override(&mut resolved, request.scoped_target.as_ref());
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

fn apply_scoped_target_override(
    connection: &mut ResolvedConnectionProfile,
    target: Option<&ScopedQueryTarget>,
) {
    let Some(target) = target else {
        return;
    };
    let path = target_path_values(connection, target);

    match connection.engine.as_str() {
        "mongodb" | "litedb" => {
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
    if let Some(database) = target_path_value_after(target, &["databases", "catalogs"]) {
        return Some(database);
    }

    let scope = target.scope.as_deref().unwrap_or_default();
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
    if let Some(schema) = target_path_value_after(target, &["schemas", "user-schemas", "datasets"])
    {
        return Some(schema);
    }

    let scope = target.scope.as_deref()?;
    let parts = scope.split(':').collect::<Vec<_>>();
    if parts.first() == Some(&"table") && parts.len() >= 4 {
        return Some(parts[2].to_string());
    }
    if parts.first() == Some(&"oracle") && parts.get(1) == Some(&"object") {
        return parts.get(3).map(|value| (*value).to_string());
    }
    let identity = scope.split_once(':')?.1;
    identity
        .split(['.', ':'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/execution_target_tests.rs"]
mod execution_target_tests;
