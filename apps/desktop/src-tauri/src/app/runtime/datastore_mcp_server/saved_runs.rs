use super::*;
use crate::app::runtime::query_compiler;
use crate::app::runtime::{
    execution::confirmation_guardrail_id, response_redaction::redact_external_value,
    SharedExecutionRegistry, SharedTestRunRegistry,
};
use crate::domain::models::{DatastoreTestRunPlanRequest, ExecuteTestSuiteRequest};
use futures_util::future::{AbortHandle, Abortable};
use std::sync::OnceLock;

const PLAN_TTL: Duration = Duration::from_secs(300);
const RUN_TTL: Duration = Duration::from_secs(900);
const MAX_RUNS: usize = 100;

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/datastore_mcp_server/saved_runs_tests.rs"]
mod tests;

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PlanSavedRunArgs {
    pub workspace_id: String,
    pub item_id: String,
    pub expected_revision: String,
    /// Required for unbound queries. Empty string explicitly chooses no environment.
    pub environment_id: Option<String>,
    pub case_id: Option<String>,
    pub row_limit: Option<u32>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StartSavedRunArgs {
    pub plan_id: String,
    pub confirmation_text: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SavedRunArgs {
    pub run_id: String,
}

struct SavedPlan {
    args: PlanSavedRunArgs,
    server_id: String,
    token_id: String,
    fingerprint: String,
    suites: bool,
    confirmation: Option<String>,
    status: String,
    expires: Instant,
}
struct SavedRun {
    workspace_id: String,
    server_id: String,
    token_id: String,
    item_id: String,
    connection_id: String,
    environment_id: String,
    suites: bool,
    may_write: bool,
    active: bool,
    status: String,
    result: Option<Value>,
    cancellation: tokio::sync::watch::Sender<bool>,
    updated: Instant,
    safety_revision: String,
}
#[derive(Default)]
struct SavedRunRegistry {
    plans: HashMap<String, SavedPlan>,
    runs: HashMap<String, SavedRun>,
}
static REGISTRY: OnceLock<Mutex<SavedRunRegistry>> = OnceLock::new();
fn registry() -> Result<std::sync::MutexGuard<'static, SavedRunRegistry>, CommandError> {
    REGISTRY
        .get_or_init(|| Mutex::new(SavedRunRegistry::default()))
        .lock()
        .map_err(|_| {
            library_failure(
                "mcp-run-state-unavailable",
                "MCP execution state is unavailable.",
            )
        })
}
pub(crate) fn has_active_runs() -> bool {
    registry()
        .map(|s| s.runs.values().any(|r| r.active))
        .unwrap_or(true)
}
pub(super) fn item_running(id: &str) -> bool {
    registry()
        .map(|s| s.runs.values().any(|r| r.active && r.item_id == id))
        .unwrap_or(true)
}
pub(super) fn stop_server_runs(server_id: &str) {
    if let Ok(mut state) = registry() {
        state.plans.retain(|_, plan| plan.server_id != server_id);
        for run in state
            .runs
            .values()
            .filter(|run| run.server_id == server_id && run.active)
        {
            let _ = run.cancellation.send(true);
        }
    }
}

pub(super) fn require_scope(scopes: &[String], scope: &str) -> Result<(), CommandError> {
    if scopes.iter().any(|s| s == scope) {
        Ok(())
    } else {
        Err(library_failure(
            "mcp-scope-required",
            &format!("This action requires {scope}. Grant it explicitly in MCP token settings."),
        ))
    }
}
pub(super) fn token_config<'a>(
    snapshot: &'a WorkspaceSnapshot,
    server_id: &str,
    token_id: &str,
) -> Result<
    (
        &'a DatastoreMcpServerConfig,
        &'a DatastoreMcpServerTokenConfig,
    ),
    CommandError,
> {
    if !snapshot.preferences.datastore_mcp_server.enabled {
        return Err(library_failure(
            "mcp-disabled",
            "The MCP server is disabled.",
        ));
    }
    let config = snapshot
        .preferences
        .datastore_mcp_server
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| library_failure("mcp-server-missing", "The MCP configuration changed."))?;
    let token = config
        .tokens
        .iter()
        .find(|t| t.id == token_id && t.enabled)
        .ok_or_else(|| {
            library_failure(
                "mcp-token-revoked",
                "The MCP token was revoked or disabled.",
            )
        })?;
    Ok((config, token))
}
fn run_tab(
    runtime: &ManagedAppState,
    args: &PlanSavedRunArgs,
    suites: bool,
) -> Result<(LibraryNode, QueryTabState), CommandError> {
    check_workspace(runtime, &args.workspace_id)?;
    let mut item = find_item(&runtime.snapshot, &args.item_id, suites)?;
    if runtime.snapshot.tabs.iter().any(|tab| {
        linked(tab, &item.id)
            && (tab.active_execution.is_some()
                || matches!(tab.status.as_str(), "running" | "queued"))
    }) {
        return Err(library_failure(
            "library-execution-active",
            "This saved item is already executing in a desktop tab.",
        ));
    }
    if item_revision(&item) != args.expected_revision {
        return Err(library_failure(
            "library-revision-conflict",
            "The saved definition changed. Read it and plan again.",
        ));
    }
    validate_definition(&runtime.snapshot, &mut item)?;
    let mut tab = tab_for_item(&runtime.snapshot, &item);
    if let Some(bound) = effective_environment(&runtime.snapshot, &item) {
        if args.environment_id.as_ref().is_some_and(|e| e != &bound) {
            return Err(library_failure(
                "library-environment-immutable",
                "The saved environment binding cannot be overridden.",
            ));
        }
        tab.environment_id = bound;
    } else {
        tab.environment_id = args.environment_id.clone().ok_or_else(|| {
            library_failure(
                "environment-required",
                "Choose an environment explicitly; use an empty string for no environment.",
            )
        })?;
    }
    if suites {
        runtime.ensure_datastore_tests_enabled()?;
        let suite = tab.test_suite.as_ref().unwrap();
        if suite["connectionId"] != tab.connection_id
            || suite["environmentId"] != tab.environment_id
            || suite.get("scopedTarget") != serde_json::to_value(&tab.scoped_target).ok().as_ref()
        {
            return Err(library_failure(
                "datastore-test-binding-immutable",
                "The saved suite and Library target bindings disagree.",
            ));
        }
    } else if args.case_id.is_some() {
        return Err(library_failure(
            "mcp-run-invalid",
            "Case selection is only supported for test suites.",
        ));
    }
    Ok((item, tab))
}
fn fingerprint(
    runtime: &ManagedAppState,
    args: &PlanSavedRunArgs,
    item: &LibraryNode,
    tab: &QueryTabState,
    config: &DatastoreMcpServerConfig,
) -> Result<String, CommandError> {
    let value = json!({"workspace":args.workspace_id,"item":item,"case":args.case_id,"rowLimit":args.row_limit,"connection":runtime.connection_by_id(&tab.connection_id)?,"environment":runtime.environment_by_id(&tab.environment_id)?,"safeMode":runtime.snapshot.preferences.safe_mode_enabled,"config":config});
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(value.to_string())))
}
fn safety_revision(
    runtime: &ManagedAppState,
    connection_id: &str,
    environment_id: &str,
) -> Result<String, CommandError> {
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(json!({"connection":runtime.connection_by_id(connection_id)?,"environment":runtime.environment_by_id(environment_id)?,"safeMode":runtime.snapshot.preferences.safe_mode_enabled}).to_string())))
}
fn queries_for_tab(
    tab: &QueryTabState,
    case_id: Option<&str>,
) -> Result<Vec<String>, CommandError> {
    if tab.tab_kind.as_deref() != Some("test-suite") {
        return Ok(vec![if tab.query_view_mode.as_deref() == Some("script") {
            tab.script_text.clone().unwrap_or_default()
        } else {
            tab.query_text.clone()
        }]);
    }
    let suite = tab.test_suite.as_ref().unwrap();
    let mut queries = Vec::new();
    for case in suite["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["enabled"] != false && case_id.is_none_or(|id| c["id"] == id))
    {
        for phase in ["setup", "execute", "teardown"] {
            for step in case[phase]
                .as_array()
                .unwrap()
                .iter()
                .filter(|s| s["enabled"] != false)
            {
                if !matches!(step["kind"].as_str(), Some("query" | "builder")) {
                    return Err(library_failure(
                        "test-step-unsupported",
                        "Only query and builder steps have validated execution providers.",
                    ));
                }
                let mut text = step["queryText"].as_str().unwrap_or_default().to_string();
                if let Some(variables) = suite["variables"].as_object() {
                    for (key, value) in variables {
                        text = text.replace(
                            &format!("{{{{{key}}}}}"),
                            value.as_str().unwrap_or_default(),
                        );
                    }
                }
                queries.push(text);
            }
        }
    }
    if queries.is_empty() {
        return Err(library_failure(
            "test-plan-blocked",
            "No enabled test steps match this run.",
        ));
    }
    Ok(queries)
}
fn preflight(
    runtime: &ManagedAppState,
    tab: &QueryTabState,
    case_id: Option<&str>,
    config: &DatastoreMcpServerConfig,
    token: &DatastoreMcpServerTokenConfig,
) -> Result<(bool, Vec<Value>), CommandError> {
    require_scope(&token.scopes, SCOPE_LIBRARY_READ)?;
    require_scope(&token.scopes, SCOPE_QUERY_READ)?;
    if tab.tab_kind.as_deref() == Some("test-suite") {
        require_scope(&token.scopes, SCOPE_TESTS_RUN)?;
    }
    ensure_allowed_target(
        &runtime.snapshot,
        config,
        &tab.connection_id,
        &tab.environment_id,
    )
    .map_err(|_| {
        library_failure(
            "mcp-target-denied",
            "The saved connection/environment is not allowlisted.",
        )
    })?;
    let profile = runtime.connection_by_id(&tab.connection_id)?;
    let environment = runtime.environment_by_id(&tab.environment_id)?;
    let (_, resolved, _) = runtime.resolve_connection_profile(&profile, &tab.environment_id)?;
    let mut may_write = false;
    let mut guards = Vec::new();
    let texts = if tab.tab_kind.as_deref() == Some("test-suite") {
        queries_for_tab(tab, case_id)?
    } else {
        vec![query_compiler::prepare(tab, &profile)?["queryText"]
            .as_str()
            .unwrap_or_default()
            .into()]
    };
    for text in texts {
        if text.trim().is_empty() {
            return Err(library_failure(
                "mcp-run-empty",
                "A saved query or enabled step is empty.",
            ));
        }
        let query = resolve_string_template(&text, &resolved.variables)?;
        // Authorization follows the adapter, not a saved editor's display language.
        let language = language_for(&profile);
        may_write |= authorize_saved_query(&token.scopes, &query, &language)?;
        guards.push(serde_json::to_value(security::evaluate_guardrails(
            &profile,
            &environment,
            &resolved,
            &query,
            runtime.snapshot.preferences.safe_mode_enabled,
        ))?);
    }
    Ok((may_write, guards))
}
impl DatapadMcpTools {
    pub(super) fn plan_saved_run(
        &self,
        args: PlanSavedRunArgs,
        token_id: &str,
        suites: bool,
    ) -> Result<Value, CommandError> {
        let mut runtime = self.library_runtime()?;
        let (item, tab) = run_tab(&runtime, &args, suites)?;
        let server_id = self
            .current_config()
            .map_err(|_| {
                library_failure(
                    "mcp-config-unavailable",
                    "MCP configuration is unavailable.",
                )
            })?
            .id;
        let (config, token) = token_config(&runtime.snapshot, &server_id, token_id)?;
        let (may_write, guards) =
            preflight(&runtime, &tab, args.case_id.as_deref(), config, token)?;
        let fingerprint = fingerprint(&runtime, &args, &item, &tab, config)?;
        let (status, confirmation, steps) = if suites {
            runtime.snapshot.tabs.push(tab.clone());
            let plan = runtime.plan_test_suite_run(DatastoreTestRunPlanRequest {
                tab_id: tab.id.clone(),
                case_id: args.case_id.clone(),
            })?;
            (
                plan.status,
                plan.required_confirmation_text,
                serde_json::to_value(plan.steps)?,
            )
        } else {
            let status = guards[0]["status"].as_str().unwrap_or("block");
            (
                if status == "block" {
                    "blocked"
                } else if status == "confirm" {
                    "confirm"
                } else {
                    "ready"
                }
                .to_string(),
                (status == "confirm").then(|| {
                    format!(
                        "CONFIRM {}",
                        runtime
                            .environment_by_id(&tab.environment_id)
                            .map(|e| e.label)
                            .unwrap_or_default()
                    )
                }),
                Value::Null,
            )
        };
        let plan_id = generate_id("mcp-plan");
        let mut response = json!({"planId":plan_id,"workspaceId":args.workspace_id,"itemId":args.item_id,"revision":args.expected_revision,"status":status,"mayWrite":may_write,"requiredConfirmationText":confirmation,"guards":guards,"steps":steps,"expiresInSeconds":PLAN_TTL.as_secs(),"connectionId":tab.connection_id,"environmentId":tab.environment_id});
        let mut state = registry()?;
        state.plans.retain(|_, p| p.expires > Instant::now());
        if state.plans.len() >= MAX_RUNS {
            return Err(library_failure(
                "mcp-plan-limit",
                "Too many pending plans. Wait for existing plans to expire.",
            ));
        }
        state.plans.insert(
            plan_id,
            SavedPlan {
                args,
                server_id,
                token_id: token_id.into(),
                fingerprint,
                suites,
                confirmation,
                status,
                expires: Instant::now() + PLAN_TTL,
            },
        );
        let profile = runtime.connection_by_id(&tab.connection_id)?;
        let (_, environment, _) =
            runtime.resolve_connection_profile(&profile, &tab.environment_id)?;
        redact_external_value(&mut response, &environment);
        Ok(response)
    }
    pub(super) fn start_saved_run(
        &self,
        args: StartSavedRunArgs,
        token_id: &str,
        suites: bool,
    ) -> Result<Value, CommandError> {
        let _ = self.library_runtime()?;
        let plan = {
            let mut state = registry()?;
            let p = state.plans.get(&args.plan_id).ok_or_else(|| {
                library_failure(
                    "mcp-plan-invalid",
                    "This plan is missing, expired, or already used.",
                )
            })?;
            if p.args.workspace_id != self.workspace_id
                || p.token_id != token_id
                || p.suites != suites
                || p.server_id
                    != self
                        .current_config()
                        .map_err(|_| {
                            library_failure(
                                "mcp-config-unavailable",
                                "MCP configuration unavailable.",
                            )
                        })?
                        .id
            {
                return Err(library_failure(
                    "mcp-plan-denied",
                    "This plan belongs to a different workspace, server, token, or tool.",
                ));
            }
            if p.confirmation != args.confirmation_text {
                return Err(library_failure("mcp-confirmation-required","Provide the exact confirmation from the plan; it is not supplied automatically."));
            }
            state.plans.remove(&args.plan_id).unwrap()
        };
        if plan.expires <= Instant::now() || plan.status == "blocked" {
            return Err(library_failure(
                "mcp-plan-invalid",
                "The plan expired or contains blockers. Plan again.",
            ));
        }
        let shared = self.app.state::<SharedAppState>();
        let current = shared.lock().map_err(|_| {
            library_failure(
                "workspace-state-unavailable",
                "Workspace state unavailable.",
            )
        })?;
        let mut runtime = ManagedAppState {
            app: current.app.clone(),
            snapshot: current.snapshot.clone(),
        };
        let (item, mut tab) = run_tab(&runtime, &plan.args, suites)?;
        let (config, token) = token_config(&runtime.snapshot, &plan.server_id, token_id)?;
        if fingerprint(&runtime, &plan.args, &item, &tab, config)? != plan.fingerprint {
            return Err(library_failure(
                "mcp-plan-stale",
                "The definition, target, permissions, or safety settings changed. Plan again.",
            ));
        }
        let (may_write, _) =
            preflight(&runtime, &tab, plan.args.case_id.as_deref(), config, token)?;
        let timeout_ms = config.request_timeout_ms.unwrap_or(30 * 60 * 1000);
        let run_id = generate_id("mcp-run");
        tab.id = run_id.clone();
        let safety_revision = safety_revision(&runtime, &tab.connection_id, &tab.environment_id)?;
        let (cancel, receiver) = tokio::sync::watch::channel(false);
        let (abort, registration) = AbortHandle::new_pair();
        {
            let mut state = registry()?;
            state
                .runs
                .retain(|_, r| r.active || r.updated.elapsed() < RUN_TTL);
            if state.runs.len() >= MAX_RUNS
                || state
                    .runs
                    .values()
                    .any(|r| r.active && r.item_id == item.id)
            {
                return Err(library_failure(
                    "mcp-run-busy",
                    "This item is running, or the MCP run limit has been reached.",
                ));
            }
            state.runs.insert(
                run_id.clone(),
                SavedRun {
                    workspace_id: plan.args.workspace_id.clone(),
                    server_id: plan.server_id.clone(),
                    token_id: token_id.into(),
                    item_id: item.id,
                    connection_id: tab.connection_id.clone(),
                    environment_id: tab.environment_id.clone(),
                    suites,
                    may_write,
                    active: true,
                    status: "running".into(),
                    result: None,
                    cancellation: cancel.clone(),
                    updated: Instant::now(),
                    safety_revision,
                },
            );
        }
        let registered = (|| {
            let executions = self.app.state::<SharedExecutionRegistry>();
            let mut executions = executions.lock().map_err(|_| {
                library_failure(
                    "execution-state-unavailable",
                    "Execution registry unavailable.",
                )
            })?;
            let cancellations = self.app.state::<SharedTestRunRegistry>();
            let mut cancellations = cancellations.lock().map_err(|_| {
                library_failure(
                    "execution-state-unavailable",
                    "Cancellation registry unavailable.",
                )
            })?;
            cancellations
                .register(run_id.clone(), cancel)
                .map_err(|_| library_failure("mcp-run-busy", "Run already exists."))?;
            executions.register(run_id.clone(), abort);
            Ok::<(), CommandError>(())
        })();
        if let Err(error) = registered {
            registry()?.runs.remove(&run_id);
            return Err(error);
        }
        drop(current);
        runtime.snapshot.tabs.push(tab.clone());
        let app = self.app.clone();
        let id = run_id.clone();
        tauri::async_runtime::spawn(async move {
            let execute = execute_saved(
                &mut runtime,
                &tab,
                &id,
                &plan,
                args.confirmation_text,
                receiver.clone(),
            );
            let result = tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                Abortable::new(execute, registration),
            )
            .await;
            let (status, value) = match result {
                Ok(Ok(Ok(v))) => (
                    if *receiver.borrow() {
                        "canceled"
                    } else {
                        v.get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("completed")
                    }
                    .to_string(),
                    v,
                ),
                Ok(Ok(Err(e))) => (
                    if e.code == "mcp-run-canceled" {
                        "canceled"
                    } else {
                        "failed"
                    }
                    .into(),
                    json!({"code":e.code,"message":redact_sensitive_text(&e.message)}),
                ),
                _ => (
                    "uncertain".into(),
                    json!({"code":"mcp-run-interrupted","message":"Execution was interrupted or timed out. Writes may have completed and cleanup may be incomplete. Verify datastore state before retrying."}),
                ),
            };
            if let Ok(mut executions) = app.state::<SharedExecutionRegistry>().lock() {
                executions.remove(&id);
            }
            if let Ok(mut runs) = app.state::<SharedTestRunRegistry>().lock() {
                runs.remove(&id);
            }
            if let Ok(mut state) = registry() {
                if let Some(run) = state.runs.get_mut(&id) {
                    run.active = false;
                    run.status = status;
                    run.updated = Instant::now();
                    run.result = Some(if value.to_string().len() > 4 * 1024 * 1024 {
                        json!({"message":"Result exceeds the MCP response budget. Run in DataPad++ to inspect the full result.","resultOmitted":true})
                    } else {
                        value
                    });
                }
            }
        });
        Ok(
            json!({"runId":run_id,"workspaceId":self.workspace_id,"status":"running","mayWrite":may_write}),
        )
    }
    pub(super) fn saved_run_status(
        &self,
        args: SavedRunArgs,
        token_id: &str,
        cancel: bool,
    ) -> Result<Value, CommandError> {
        let runtime = self.library_runtime()?;
        let server = self.current_config().map_err(|_| {
            library_failure("mcp-config-unavailable", "MCP configuration unavailable.")
        })?;
        let (_, token) = token_config(&runtime.snapshot, &server.id, token_id)?;
        require_scope(&token.scopes, SCOPE_LIBRARY_READ)?;
        let state = registry()?;
        let run = state
            .runs
            .get(&args.run_id)
            .filter(|r| {
                r.workspace_id == self.workspace_id
                    && r.server_id == server.id
                    && r.token_id == token_id
            })
            .ok_or_else(|| {
                library_failure(
                    "mcp-run-missing",
                    "This run is unavailable for this workspace and token.",
                )
            })?;
        if cancel {
            if run.active {
                let _ = run.cancellation.send(true);
            }
            return Ok(
                json!({"runId":args.run_id,"status":run.status,"active":run.active,"cancellationRequested":*run.cancellation.borrow()}),
            );
        }
        require_scope(&token.scopes, SCOPE_QUERY_READ)?;
        if run.suites {
            require_scope(&token.scopes, SCOPE_TESTS_RUN)?;
        }
        if run.may_write {
            require_scope(&token.scopes, SCOPE_QUERY_WRITE)?;
        }
        ensure_allowed_target(
            &runtime.snapshot,
            &server,
            &run.connection_id,
            &run.environment_id,
        )
        .map_err(|_| {
            library_failure("mcp-target-denied", "Run target is no longer allowlisted.")
        })?;
        Ok(
            json!({"runId":args.run_id,"status":run.status,"active":run.active,"cancellationRequested":*run.cancellation.borrow(),"mayWrite":run.may_write,"result":run.result}),
        )
    }
}

async fn execute_saved(
    runtime: &mut ManagedAppState,
    tab: &QueryTabState,
    run_id: &str,
    plan: &SavedPlan,
    confirmation: Option<String>,
    cancellation: tokio::sync::watch::Receiver<bool>,
) -> Result<Value, CommandError> {
    if *cancellation.borrow() {
        return Err(library_failure(
            "mcp-run-canceled",
            "Canceled before execution started.",
        ));
    }
    let profile = runtime.connection_by_id(&tab.connection_id)?;
    let (_, environment, _) = runtime.resolve_connection_profile(&profile, &tab.environment_id)?;
    let safe_error = |mut error: CommandError| {
        let mut value = json!(error.message);
        redact_external_value(&mut value, &environment);
        error.message = value.as_str().unwrap_or("Execution failed.").to_string();
        error
    };
    let mut result = if plan.suites {
        let fresh = runtime.plan_test_suite_run(DatastoreTestRunPlanRequest {
            tab_id: tab.id.clone(),
            case_id: plan.args.case_id.clone(),
        })?;
        runtime
            .execute_test_suite_with_cancellation(
                ExecuteTestSuiteRequest {
                    tab_id: tab.id.clone(),
                    case_id: plan.args.case_id.clone(),
                    run_id: Some(run_id.into()),
                    plan_id: Some(fresh.plan_id),
                    confirmation_text: confirmation,
                    confirmed_guardrail_id: None,
                },
                cancellation,
            )
            .await
            .map_err(&safe_error)?
            .run
    } else {
        let prepared = query_compiler::prepare(tab, &profile)?;
        let query = prepared["queryText"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let resolved = resolve_string_template(&query, &environment.variables)?;
        let request = ExecutionRequest {
            execution_id: Some(run_id.into()),
            tab_id: tab.id.clone(),
            connection_id: tab.connection_id.clone(),
            environment_id: tab.environment_id.clone(),
            language: tab.language.clone(),
            query_text: query,
            execution_input_mode: tab.query_view_mode.clone(),
            script_text: tab.script_text.clone(),
            selected_text: None,
            mode: Some("full".into()),
            row_limit: Some(
                plan.args
                    .row_limit
                    .unwrap_or(DEFAULT_QUERY_ROW_LIMIT)
                    .clamp(1, MAX_QUERY_ROW_LIMIT),
            ),
            document_efficiency_mode: tab.document_efficiency_mode,
            confirmed_guardrail_id: confirmation.map(|_| {
                confirmation_guardrail_id(
                    &tab.connection_id,
                    &tab.environment_id,
                    "full",
                    &resolved,
                    tab.sql_scope.as_ref(),
                )
            }),
            builder_state: tab.builder_state.clone(),
            scoped_target: tab.scoped_target.clone(),
            sql_scope: tab.sql_scope.clone(),
            datastore_execution_input: prepared.get("datastoreExecutionInput").cloned(),
        };
        let mut cancel = cancellation.clone();
        let response = tokio::select! {
            result = runtime.execute_query(request) => result.map_err(&safe_error)?,
            _ = cancel.changed() => return Err(library_failure("mcp-run-canceled","Cancellation requested. The operation may already have reached the datastore; verify state before retrying.")),
        };
        json!({"status":if response.result.is_some() {"completed"} else {"blocked"},"result":response.result,"guardrail":response.guardrail})
    };
    redact_external_value(&mut result, &environment);
    Ok(result)
}

/// Recheck the live token, allowlist and guardrails immediately before every adapter call.
pub(crate) fn authorize_run_step(
    app: &AppHandle,
    execution_id: Option<&str>,
    query: &str,
    _language: &str,
) -> Result<(), CommandError> {
    let Some(id) = execution_id
        .and_then(|id| id.split(':').next())
        .filter(|id| id.starts_with("mcp-run-"))
    else {
        return Ok(());
    };
    let shared = app.state::<SharedAppState>();
    let state = shared.lock().map_err(|_| {
        library_failure(
            "workspace-state-unavailable",
            "Workspace state unavailable.",
        )
    })?;
    let registry = registry()?;
    let run = registry
        .runs
        .get(id)
        .ok_or_else(|| library_failure("mcp-run-missing", "The MCP run is unavailable."))?;
    check_workspace(&state, &run.workspace_id)?;
    if safety_revision(&state, &run.connection_id, &run.environment_id)? != run.safety_revision {
        return Err(library_failure("mcp-run-safety-changed","Connection, environment, or safety settings changed during execution. Plan again after reviewing any completed writes."));
    }
    let (config, token) = token_config(&state.snapshot, &run.server_id, &run.token_id)?;
    require_scope(&token.scopes, SCOPE_LIBRARY_READ)?;
    require_scope(&token.scopes, SCOPE_QUERY_READ)?;
    if run.suites {
        require_scope(&token.scopes, SCOPE_TESTS_RUN)?;
        state.ensure_datastore_tests_enabled()?;
    }
    ensure_allowed_target(
        &state.snapshot,
        config,
        &run.connection_id,
        &run.environment_id,
    )
    .map_err(|_| {
        library_failure(
            "mcp-target-denied",
            "The run target is no longer allowlisted.",
        )
    })?;
    let profile = state.connection_by_id(&run.connection_id)?;
    authorize_saved_query(&token.scopes, query, &language_for(&profile))?;
    let env = state.environment_by_id(&run.environment_id)?;
    let (_, resolved, _) = state.resolve_connection_profile(&profile, &run.environment_id)?;
    if security::evaluate_guardrails(
        &profile,
        &env,
        &resolved,
        query,
        state.snapshot.preferences.safe_mode_enabled,
    )
    .status
        == "block"
    {
        return Err(library_failure(
            "guardrail-blocked",
            "Current datastore safety settings block this step.",
        ));
    }
    Ok(())
}

fn authorize_saved_query(
    scopes: &[String],
    query: &str,
    language: &str,
) -> Result<bool, CommandError> {
    require_scope(scopes, SCOPE_QUERY_READ)?;
    let may_write = validate_read_only_query(query, Some(language)).is_err();
    if may_write {
        require_scope(scopes, SCOPE_QUERY_WRITE)?;
    }
    Ok(may_write)
}
