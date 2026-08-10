use serde_json::{json, Value};

mod planning;
mod providers;
mod runner;
mod templates;

use super::validators;
use super::{
    generate_id, library::effective_connection_environment_id, timestamp_now, ManagedAppState,
};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, CancelExecutionResult, CancelTestRunRequest, ConnectionProfile,
        CreateTestSuiteTabRequest, DatastoreTestRunPlanRequest, DatastoreTestRunPlanResponse,
        ExecuteTestSuiteRequest, ExecuteTestSuiteResponse, OpenTestSuiteCaseRequest,
        OpenTestSuiteTemplateRequest, QueryHistoryEntry, QueryTabState, ScopedQueryTarget,
        UpdateTestSuiteTabRequest,
    },
};
use templates::test_suite_for_connection;

impl ManagedAppState {
    pub fn create_test_suite_tab(
        &mut self,
        request: CreateTestSuiteTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        self.ensure_datastore_tests_enabled()?;
        validators::validate_create_test_suite_tab_request(&request)?;
        let connection = self.test_suite_connection(Some(&request.connection_id))?;
        self.environment_by_id(&request.environment_id)?;
        if !connection
            .environment_ids
            .iter()
            .any(|environment_id| environment_id == &request.environment_id)
        {
            return Err(CommandError::new(
                "datastore-test-environment-invalid",
                "Choose an environment assigned to the selected datastore connection.",
            ));
        }
        let provider = providers::provider_for_connection(&connection).ok_or_else(|| {
            CommandError::new(
                "datastore-tests-unsupported",
                format!(
                    "{} does not advertise validated datastore test execution.",
                    connection.name
                ),
            )
        })?;
        provider.validate_target(&request.scoped_target)?;
        if let Some(suite) = request.suite.as_ref() {
            validate_suite_creation_binding(
                suite,
                &connection,
                &request.environment_id,
                &request.scoped_target,
            )?;
        }
        let suite = request.suite.unwrap_or_else(|| {
            test_suite_for_connection(&connection, &request.scoped_target, provider)
        });
        self.open_test_suite_tab(
            connection,
            request.environment_id,
            request.scoped_target,
            suite,
        )
    }

    pub fn open_test_suite_template(
        &mut self,
        request: OpenTestSuiteTemplateRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_datastore_tests_enabled()?;
        validators::validate_open_test_suite_template_request(&request)?;
        self.create_test_suite_tab(CreateTestSuiteTabRequest {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            scoped_target: request.scoped_target,
            template_id: Some(request.template_id),
            suite: None,
        })
    }

    pub fn open_test_suite_case(
        &mut self,
        request: OpenTestSuiteCaseRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        self.ensure_datastore_tests_enabled()?;
        let item = self
            .snapshot
            .library_nodes
            .iter()
            .find(|item| item.id == request.library_item_id && item.kind == "test-suite")
            .ok_or_else(|| {
                CommandError::new(
                    "library-node-missing",
                    "Test suite was not found in the Library.",
                )
            })?;
        let owns_case = item
            .test_suite
            .as_ref()
            .and_then(|suite| suite.get("cases"))
            .and_then(Value::as_array)
            .is_some_and(|cases| {
                cases
                    .iter()
                    .any(|case| case.get("id").and_then(Value::as_str) == Some(&request.case_id))
            });
        if !owns_case {
            return Err(CommandError::new(
                "test-case-missing",
                "The selected test case does not belong to this suite.",
            ));
        }

        self.open_library_item(&request.library_item_id)?;
        let active_tab_id = self.snapshot.ui.active_tab_id.clone();
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|tab| tab.id == active_tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Test suite tab was not found."))?;
        tab.active_test_case_id = Some(request.case_id);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn plan_test_suite_run(
        &self,
        request: DatastoreTestRunPlanRequest,
    ) -> Result<DatastoreTestRunPlanResponse, CommandError> {
        self.ensure_unlocked()?;
        validators::validate_datastore_test_run_plan_request(&request)?;
        planning::plan(self, &request)
    }

    pub fn update_test_suite_tab(
        &mut self,
        request: UpdateTestSuiteTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        self.ensure_datastore_tests_enabled()?;
        validators::validate_update_test_suite_tab_request(&request)?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Test suite tab was not found."))?;

        if tab.tab_kind.as_deref() != Some("test-suite") {
            return Err(CommandError::new(
                "tab-not-test-suite",
                "Choose a test suite tab before updating tests.",
            ));
        }

        let mut content_changed = false;
        if let Some(suite) = request.suite {
            let suite = normalize_suite_update(tab, suite)?;
            tab.query_text = serde_json::to_string_pretty(&suite)?;
            tab.test_suite = Some(suite);
            tab.error = None;
            content_changed = true;
        } else if let Some(raw_text) = request.raw_text {
            tab.query_text = raw_text.clone();
            content_changed = true;
            match serde_json::from_str::<Value>(&raw_text) {
                Ok(suite) => {
                    let suite = normalize_suite_update(tab, suite)?;
                    tab.test_suite = Some(suite);
                    tab.error = None;
                }
                Err(error) => {
                    tab.error = Some(crate::domain::models::UserFacingError {
                        code: "test-suite-json-invalid".into(),
                        message: format!("The raw test suite JSON is invalid. {error}"),
                    });
                }
            }
        }

        if let Some(case_id) = request.active_test_case_id {
            let valid_case = tab
                .test_suite
                .as_ref()
                .and_then(|suite| suite.get("cases"))
                .and_then(Value::as_array)
                .is_some_and(|cases| {
                    cases
                        .iter()
                        .any(|case| case.get("id").and_then(Value::as_str) == Some(&case_id))
                });
            if !valid_case {
                return Err(CommandError::new(
                    "test-case-missing",
                    "The selected test case does not belong to this suite.",
                ));
            }
            tab.active_test_case_id = Some(case_id);
        }

        if content_changed {
            tab.dirty = true;
            tab.status = "idle".into();
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub async fn execute_test_suite(
        &mut self,
        request: ExecuteTestSuiteRequest,
    ) -> Result<ExecuteTestSuiteResponse, CommandError> {
        let (_, cancellation) = tokio::sync::watch::channel(false);
        self.execute_test_suite_with_cancellation(request, cancellation)
            .await
    }

    pub(crate) async fn execute_test_suite_with_cancellation(
        &mut self,
        request: ExecuteTestSuiteRequest,
        mut cancellation: tokio::sync::watch::Receiver<bool>,
    ) -> Result<ExecuteTestSuiteResponse, CommandError> {
        self.ensure_unlocked()?;
        self.ensure_datastore_tests_enabled()?;
        validators::validate_execute_test_suite_request(&request)?;
        let run_id = request
            .run_id
            .clone()
            .unwrap_or_else(|| generate_id("test-run"));
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Test suite tab was not found."))?;
        let suite = self.snapshot.tabs[tab_index]
            .test_suite
            .clone()
            .or_else(|| serde_json::from_str(&self.snapshot.tabs[tab_index].query_text).ok())
            .ok_or_else(|| {
                CommandError::new(
                    "test-suite-invalid",
                    "The test suite definition cannot be parsed.",
                )
            })?;
        let connection = self.connection_by_id(&self.snapshot.tabs[tab_index].connection_id)?;
        let provider = providers::provider_for_connection(&connection).ok_or_else(|| {
            CommandError::new(
                "datastore-tests-unsupported",
                format!(
                    "{} does not advertise validated datastore test execution.",
                    connection.name
                ),
            )
        })?;
        let test_tab = self.snapshot.tabs[tab_index].clone();
        let plan_confirmed = if let Some(plan_id) = request.plan_id.as_deref() {
            planning::authorize(
                self,
                &request.tab_id,
                request.case_id.as_deref(),
                plan_id,
                request.confirmation_text.as_deref(),
            )?;
            true
        } else {
            let internal_plan = planning::plan(
                self,
                &DatastoreTestRunPlanRequest {
                    tab_id: request.tab_id.clone(),
                    case_id: request.case_id.clone(),
                },
            )?;
            if internal_plan.status != "ready" {
                return Err(CommandError::new(
                    if internal_plan.status == "confirm" {
                        "test-plan-confirmation-required"
                    } else {
                        "test-plan-blocked"
                    },
                    if internal_plan.status == "confirm" {
                        "Review the test run plan and enter its exact confirmation phrase before executing writes."
                    } else {
                        internal_plan
                            .blockers
                            .first()
                            .map(String::as_str)
                            .unwrap_or("The test run is blocked.")
                    },
                ));
            }
            planning::authorize(
                self,
                &request.tab_id,
                request.case_id.as_deref(),
                &internal_plan.plan_id,
                None,
            )?;
            false
        };
        let mut run_context = runner::TestRunContext {
            test_tab: &test_tab,
            provider,
            confirmed_guardrail_id: request.confirmed_guardrail_id.as_deref(),
            plan_confirmed,
            run_id: &run_id,
            cancellation: &mut cancellation,
        };
        let run =
            build_run_result(self, &suite, request.case_id.as_deref(), &mut run_context).await?;
        let status = run
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("failed")
            .to_string();
        let tab_status = if status == "passed" {
            "success"
        } else if status == "blocked" {
            "blocked"
        } else {
            "error"
        };
        let now = timestamp_now();

        let tab = &mut self.snapshot.tabs[tab_index];
        tab.test_suite = Some(suite.clone());
        tab.test_run = Some(run.clone());
        tab.status = tab_status.into();
        tab.last_run_at = Some(now.clone());
        tab.history.insert(
            0,
            QueryHistoryEntry {
                id: generate_id("history"),
                query_text: format!(
                    "Run test suite: {}",
                    suite.get("name").and_then(Value::as_str).unwrap_or("Tests")
                ),
                executed_at: now,
                status: tab.status.clone(),
                sql_scope: tab.sql_scope.clone(),
            },
        );
        tab.error = if status == "passed" {
            None
        } else {
            Some(crate::domain::models::UserFacingError {
                code: format!("test-suite-{status}"),
                message: format!(
                    "{} assertion(s) failed.",
                    run.get("failed").and_then(Value::as_u64).unwrap_or(0)
                ),
            })
        };
        self.snapshot.ui.active_tab_id = tab.id.clone();
        self.snapshot.ui.active_connection_id = tab.connection_id.clone();
        self.snapshot.ui.active_environment_id = tab.environment_id.clone();
        self.snapshot.ui.bottom_panel_visible = true;
        self.snapshot.ui.active_bottom_panel_tab = "results".into();
        self.snapshot.updated_at = timestamp_now();
        Ok(ExecuteTestSuiteResponse {
            tab: self.snapshot.tabs[tab_index].clone(),
            run,
            diagnostics: vec!["Test suite run completed.".into()],
        })
    }

    pub fn cancel_test_run(
        &mut self,
        request: CancelTestRunRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        self.ensure_unlocked()?;
        validators::validate_cancel_test_run_request(&request)?;
        if let Some(tab_id) = request.tab_id {
            if let Some(tab) = self.snapshot.tabs.iter_mut().find(|tab| tab.id == tab_id) {
                if let Some(run) = tab.test_run.as_mut() {
                    if run.get("id").and_then(Value::as_str) == Some(request.run_id.as_str()) {
                        run["status"] = json!("canceled");
                        tab.status = "blocked".into();
                    }
                }
            }
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(CancelExecutionResult {
            ok: true,
            supported: true,
            message: "Test run cancellation requested.".into(),
        })
    }

    fn test_suite_connection(
        &self,
        connection_id: Option<&str>,
    ) -> Result<ConnectionProfile, CommandError> {
        let connection_id = connection_id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or(self.snapshot.ui.active_connection_id.as_str());

        self.snapshot
            .connections
            .iter()
            .find(|connection| connection.id == connection_id)
            .or_else(|| self.snapshot.connections.first())
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    "connection-missing",
                    "Create or select a connection before creating tests.",
                )
            })
    }

    pub(crate) fn ensure_datastore_tests_enabled(&self) -> Result<(), CommandError> {
        if self.snapshot.preferences.datastore_tests.enabled {
            Ok(())
        } else {
            Err(CommandError::new(
                "datastore-tests-disabled",
                "Enable the experimental Datastore Tests plugin in Settings before working with test suites.",
            ))
        }
    }

    fn open_test_suite_tab(
        &mut self,
        connection: ConnectionProfile,
        environment_id: String,
        scoped_target: ScopedQueryTarget,
        suite: Value,
    ) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing) = self.snapshot.tabs.iter().find(|tab| {
            tab.tab_kind.as_deref() == Some("test-suite")
                && tab.connection_id == connection.id
                && tab
                    .scoped_target
                    .as_ref()
                    .and_then(|target| serde_json::to_value(target).ok())
                    == serde_json::to_value(&scoped_target).ok()
                && tab.test_suite.as_ref().and_then(|suite| suite.get("id")) == suite.get("id")
        }) {
            self.snapshot.ui.active_tab_id = existing.id.clone();
            self.snapshot.ui.active_connection_id = existing.connection_id.clone();
            self.snapshot.ui.active_environment_id = existing.environment_id.clone();
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let environment_id = effective_connection_environment_id(
            &self.snapshot,
            &connection.id,
            Some(environment_id),
        );
        let provider = providers::provider_for_connection(&connection).ok_or_else(|| {
            CommandError::new(
                "datastore-tests-unsupported",
                format!(
                    "{} does not advertise validated datastore test execution.",
                    connection.name
                ),
            )
        })?;
        provider.validate_target(&scoped_target)?;
        let suite = with_connection_context(
            suite,
            &connection,
            &environment_id,
            &scoped_target,
            provider.query_language(),
        );
        let title = unique_test_tab_title(
            &self.snapshot,
            suite
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Test suite"),
        );
        let tab = QueryTabState {
            id: generate_id("test-tab"),
            title,
            tab_kind: Some("test-suite".into()),
            connection_id: connection.id.clone(),
            environment_id,
            family: connection.family.clone(),
            language: "json".into(),
            pinned: None,
            save_target: None,
            saved_query_id: None,
            editor_label: format!("{} · {} tests", connection.name, scoped_target.label),
            query_text: serde_json::to_string_pretty(&suite)?,
            query_view_mode: Some("raw".into()),
            script_text: None,
            document_efficiency_mode: None,
            scoped_target: Some(scoped_target),
            sql_scope: None,
            builder_state: None,
            metrics_state: None,
            object_view_state: None,
            test_suite: Some(suite),
            test_run: None,
            active_test_case_id: None,
            status: "idle".into(),
            active_execution: None,
            dirty: true,
            last_run_at: None,
            result: None,
            history: Vec::new(),
            error: None,
        };

        self.snapshot.tabs.push(tab.clone());
        self.snapshot.ui.active_tab_id = tab.id.clone();
        self.snapshot.ui.active_connection_id = connection.id.clone();
        self.snapshot.ui.active_environment_id = tab.environment_id.clone();
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

fn with_connection_context(
    mut suite: Value,
    connection: &ConnectionProfile,
    environment_id: &str,
    scoped_target: &ScopedQueryTarget,
    query_language: &str,
) -> Value {
    suite["connectionId"] = json!(connection.id);
    suite["environmentId"] = json!(environment_id);
    suite["engine"] = json!(connection.engine);
    suite["family"] = json!(connection.family);
    suite["scopedTarget"] = json!(scoped_target);
    suite["inferredLanguage"] = json!(query_language);
    normalize_suite_step_languages(&mut suite, query_language);
    suite
}

fn validate_suite_creation_binding(
    suite: &Value,
    connection: &ConnectionProfile,
    environment_id: &str,
    scoped_target: &ScopedQueryTarget,
) -> Result<(), CommandError> {
    for field in [
        "connectionId",
        "environmentId",
        "engine",
        "family",
        "scopedTarget",
    ] {
        if suite.get(field).is_none() {
            return Err(CommandError::new(
                "datastore-test-target-required",
                "Imported test suites require a connection, environment, and datastore target.",
            ));
        }
    }
    if suite.get("connectionId") != Some(&json!(connection.id))
        || suite.get("environmentId") != Some(&json!(environment_id))
        || suite.get("engine") != Some(&json!(connection.engine))
        || suite.get("family") != Some(&json!(connection.family))
        || suite.get("scopedTarget") != Some(&json!(scoped_target))
    {
        return Err(CommandError::new(
            "datastore-test-binding-immutable",
            "Test suite connection, environment, and target cannot be changed.",
        ));
    }
    Ok(())
}

fn normalize_suite_update(tab: &QueryTabState, mut suite: Value) -> Result<Value, CommandError> {
    let current = tab.test_suite.as_ref().ok_or_else(|| {
        CommandError::new(
            "test-suite-invalid",
            "The current test suite definition is unavailable.",
        )
    })?;
    for field in [
        "connectionId",
        "environmentId",
        "engine",
        "family",
        "scopedTarget",
    ] {
        if suite.get(field) != current.get(field) {
            return Err(CommandError::new(
                "datastore-test-binding-immutable",
                "Test suite connection, environment, and target cannot be changed.",
            ));
        }
    }
    let language = current
        .get("inferredLanguage")
        .and_then(Value::as_str)
        .or_else(|| {
            current
                .get("cases")
                .and_then(Value::as_array)
                .and_then(|cases| cases.first())
                .and_then(|case| case.get("execute"))
                .and_then(Value::as_array)
                .and_then(|steps| steps.first())
                .and_then(|step| step.get("language"))
                .and_then(Value::as_str)
        })
        .unwrap_or("text")
        .to_string();
    normalize_suite_step_languages(&mut suite, &language);
    Ok(suite)
}

fn normalize_suite_step_languages(suite: &mut Value, query_language: &str) {
    suite["inferredLanguage"] = json!(query_language);
    let Some(cases) = suite.get_mut("cases").and_then(Value::as_array_mut) else {
        return;
    };
    for case in cases {
        for phase in ["setup", "execute", "teardown"] {
            let Some(steps) = case.get_mut(phase).and_then(Value::as_array_mut) else {
                continue;
            };
            for step in steps {
                step["language"] = json!(query_language);
            }
        }
    }
}

fn unique_test_tab_title(
    snapshot: &crate::domain::models::WorkspaceSnapshot,
    name: &str,
) -> String {
    let candidate = format!("{name}.datapad-test.json");
    if !snapshot.tabs.iter().any(|tab| tab.title == candidate) {
        return candidate;
    }

    let mut index = 2;
    loop {
        let title = format!("{name} {index}.datapad-test.json");
        if !snapshot.tabs.iter().any(|tab| tab.title == title) {
            return title;
        }
        index += 1;
    }
}

async fn build_run_result(
    runtime: &mut ManagedAppState,
    suite: &Value,
    case_id: Option<&str>,
    context: &mut runner::TestRunContext<'_>,
) -> Result<Value, CommandError> {
    let started_at = timestamp_now();
    let suite_variables = suite
        .get("variables")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let selected_cases = suite
        .get("cases")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|case| case.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .filter(|case| case_id.is_none_or(|id| case.get("id").and_then(Value::as_str) == Some(id)))
        .collect::<Vec<_>>();
    let mut cases = Vec::new();
    for test_case in selected_cases {
        if *context.cancellation.borrow() {
            break;
        }
        cases.push(runner::run_case(runtime, test_case, &suite_variables, context).await?);
    }
    let failed = cases
        .iter()
        .flat_map(|case| {
            case.get("assertions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .filter(|assertion| assertion.get("status").and_then(Value::as_str) != Some("passed"))
        .count();
    let passed = cases
        .iter()
        .flat_map(|case| {
            case.get("assertions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .filter(|assertion| assertion.get("status").and_then(Value::as_str) == Some("passed"))
        .count();
    let duration_ms = cases
        .iter()
        .filter_map(|case| case.get("durationMs").and_then(Value::as_u64))
        .sum::<u64>();

    let status = if *context.cancellation.borrow() {
        "canceled"
    } else {
        ["canceled", "error", "blocked", "failed"]
            .into_iter()
            .find(|candidate| {
                cases
                    .iter()
                    .any(|case| case.get("status").and_then(Value::as_str) == Some(*candidate))
            })
            .unwrap_or("passed")
    };

    Ok(json!({
        "id": context.run_id,
        "suiteId": suite.get("id").and_then(Value::as_str).unwrap_or("suite"),
        "connectionId": context.test_tab.connection_id,
        "environmentId": context.test_tab.environment_id,
        "scopedTarget": context.test_tab.scoped_target,
        "inferredLanguage": context.provider.query_language(),
        "status": status,
        "startedAt": started_at,
        "finishedAt": timestamp_now(),
        "durationMs": duration_ms,
        "passed": passed,
        "failed": failed,
        "blocked": cases.iter().filter(|case| case.get("status").and_then(Value::as_str) == Some("blocked")).count(),
        "warnings": if context.provider.persistent_case_session() {
            Vec::<String>::new()
        } else {
            vec!["This adapter executes each step independently; temporary session state is not preserved between steps.".to_string()]
        },
        "cases": cases,
        "providerId": context.provider.id(),
        "persistentCaseSession": context.provider.persistent_case_session(),
    }))
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/tests_workbench_tests.rs"]
mod tests_workbench_tests;
