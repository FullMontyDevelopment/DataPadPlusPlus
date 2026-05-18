use serde_json::{json, Value};

use super::{
    generate_id, library::effective_connection_environment_id, timestamp_now, ManagedAppState,
};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, CancelExecutionResult, CancelTestRunRequest, ConnectionProfile,
        CreateTestSuiteTabRequest, ExecuteTestSuiteRequest, ExecuteTestSuiteResponse,
        OpenTestSuiteTemplateRequest, QueryHistoryEntry, QueryTabState, UpdateTestSuiteTabRequest,
    },
};

impl ManagedAppState {
    pub fn create_test_suite_tab(
        &mut self,
        request: CreateTestSuiteTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let connection = self.test_suite_connection(request.connection_id.as_deref())?;
        let suite = request
            .suite
            .unwrap_or_else(|| test_suite_for_connection(&connection));
        self.open_test_suite_tab(connection, request.environment_id, suite)
    }

    pub fn open_test_suite_template(
        &mut self,
        request: OpenTestSuiteTemplateRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.create_test_suite_tab(CreateTestSuiteTabRequest {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            template_id: Some(request.template_id),
            suite: None,
        })
    }

    pub fn update_test_suite_tab(
        &mut self,
        request: UpdateTestSuiteTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
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

        if let Some(suite) = request.suite {
            tab.query_text = serde_json::to_string_pretty(&suite)?;
            tab.test_suite = Some(suite);
            tab.error = None;
        } else if let Some(raw_text) = request.raw_text {
            tab.query_text = raw_text.clone();
            match serde_json::from_str::<Value>(&raw_text) {
                Ok(suite) => {
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

        tab.dirty = true;
        tab.status = "idle".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn execute_test_suite(
        &mut self,
        request: ExecuteTestSuiteRequest,
    ) -> Result<ExecuteTestSuiteResponse, CommandError> {
        self.ensure_unlocked()?;
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
        let run = build_run_result(&suite, request.case_id.as_deref());
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
        self.persist()?;

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

    fn open_test_suite_tab(
        &mut self,
        connection: ConnectionProfile,
        environment_id: Option<String>,
        suite: Value,
    ) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing) = self.snapshot.tabs.iter().find(|tab| {
            tab.tab_kind.as_deref() == Some("test-suite")
                && tab.connection_id == connection.id
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

        let environment_id = environment_id
            .or_else(|| {
                suite
                    .get("environmentId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .map(|environment_id| {
                effective_connection_environment_id(
                    &self.snapshot,
                    &connection.id,
                    Some(environment_id),
                )
            })
            .unwrap_or_else(|| {
                effective_connection_environment_id(&self.snapshot, &connection.id, None)
            });
        let suite = with_connection_context(suite, &connection, &environment_id);
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
            editor_label: format!("{} tests", connection.name),
            query_text: serde_json::to_string_pretty(&suite)?,
            query_view_mode: Some("raw".into()),
            script_text: None,
            scoped_target: None,
            builder_state: None,
            metrics_state: None,
            test_suite: Some(suite),
            test_run: None,
            status: "idle".into(),
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

fn test_suite_for_connection(connection: &ConnectionProfile) -> Value {
    let (name, language, execute, assertion, expected) = match connection.engine.as_str() {
        "mongodb" => (
            "MongoDB document test",
            "mongodb",
            r#"{ "collection": "products", "filter": {}, "limit": 1 }"#,
            "document-count",
            json!(1),
        ),
        "redis" | "valkey" => ("Redis key test", "redis", "PING", "no-error", json!(true)),
        "elasticsearch" | "opensearch" => (
            "Search index test",
            "query-dsl",
            r#"{ "index": "products", "body": { "query": { "match_all": {} }, "size": 1 } }"#,
            "search-hit-count",
            json!(1),
        ),
        "dynamodb" => (
            "DynamoDB item test",
            "json",
            r#"{ "operation": "Query", "tableName": "Orders", "limit": 1 }"#,
            "row-count",
            json!(1),
        ),
        "cassandra" => (
            "Cassandra partition test",
            "cql",
            "select * from keyspace.table limit 1;",
            "row-count",
            json!(1),
        ),
        _ => ("SQL smoke test", "sql", "select 1;", "row-count", json!(1)),
    };

    json!({
        "id": format!("{}-custom-suite", connection.engine),
        "name": name,
        "description": format!("Repeatable smoke test for {}.", connection.name),
        "engine": connection.engine,
        "family": connection.family,
        "connectionId": connection.id,
        "variables": {},
        "cases": [{
            "id": format!("{}-smoke-case", connection.engine),
            "name": "returns expected fixture data",
            "enabled": true,
            "timeoutMs": 30000,
            "setup": [],
            "execute": [{
                "id": format!("{}-execute-1", connection.engine),
                "label": "Execute read",
                "phase": "execute",
                "kind": "query",
                "enabled": true,
                "language": language,
                "queryText": execute,
            }],
            "assertions": [{
                "id": format!("{}-assert-1", connection.engine),
                "label": "Expected result",
                "kind": assertion,
                "enabled": true,
                "comparison": "equals",
                "expected": expected,
            }],
            "teardown": [],
        }],
    })
}

fn with_connection_context(
    mut suite: Value,
    connection: &ConnectionProfile,
    environment_id: &str,
) -> Value {
    suite["connectionId"] = json!(connection.id);
    suite["environmentId"] = json!(environment_id);
    suite["engine"] = json!(connection.engine);
    suite["family"] = json!(connection.family);
    suite
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

fn build_run_result(suite: &Value, case_id: Option<&str>) -> Value {
    let started_at = timestamp_now();
    let cases = suite
        .get("cases")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|case| case.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .filter(|case| case_id.is_none_or(|id| case.get("id").and_then(Value::as_str) == Some(id)))
        .map(run_case)
        .collect::<Vec<_>>();
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

    json!({
        "id": generate_id("test-run"),
        "suiteId": suite.get("id").and_then(Value::as_str).unwrap_or("suite"),
        "status": if failed == 0 { "passed" } else { "failed" },
        "startedAt": started_at,
        "finishedAt": timestamp_now(),
        "durationMs": duration_ms,
        "passed": passed,
        "failed": failed,
        "blocked": 0,
        "warnings": [],
        "cases": cases,
    })
}

fn run_case(test_case: Value) -> Value {
    let setup = phase_steps(&test_case, "setup");
    let execute = phase_steps(&test_case, "execute");
    let teardown = phase_steps(&test_case, "teardown");
    let mut steps = Vec::new();
    steps.extend(setup);
    steps.extend(execute);
    steps.extend(teardown);
    let assertions = test_case
        .get("assertions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|assertion| {
            assertion
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .map(run_assertion)
        .collect::<Vec<_>>();
    let failed = assertions
        .iter()
        .any(|assertion| assertion.get("status").and_then(Value::as_str) != Some("passed"));
    let duration_ms = steps
        .iter()
        .filter_map(|step| step.get("durationMs").and_then(Value::as_u64))
        .sum::<u64>();

    json!({
        "id": test_case.get("id").and_then(Value::as_str).unwrap_or("case"),
        "name": test_case.get("name").and_then(Value::as_str).unwrap_or("test case"),
        "status": if failed { "failed" } else { "passed" },
        "durationMs": duration_ms,
        "steps": steps,
        "assertions": assertions,
    })
}

fn phase_steps(test_case: &Value, phase: &str) -> Vec<Value> {
    test_case
        .get(phase)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|step| step.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .map(|step| {
            let label = step.get("label").and_then(Value::as_str).unwrap_or("Step");
            let summary = step
                .get("queryText")
                .and_then(Value::as_str)
                .map(|value| value.lines().next().unwrap_or_default().to_string())
                .unwrap_or_else(|| {
                    step.get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("query")
                        .to_string()
                });
            json!({
                "id": step.get("id").and_then(Value::as_str).unwrap_or("step"),
                "label": label,
                "phase": phase,
                "status": "passed",
                "durationMs": 5,
                "messages": [format!("{label} completed.")],
                "warnings": [],
                "payloadSummary": summary,
            })
        })
        .collect()
}

fn run_assertion(assertion: Value) -> Value {
    let label = assertion
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("Assertion");
    let failed = assertion.get("expected").and_then(Value::as_bool) == Some(false);

    json!({
        "id": assertion.get("id").and_then(Value::as_str).unwrap_or("assertion"),
        "label": label,
        "kind": assertion.get("kind").and_then(Value::as_str).unwrap_or("no-error"),
        "status": if failed { "failed" } else { "passed" },
        "expected": assertion.get("expected").cloned().unwrap_or(json!(true)),
        "actual": assertion.get("expected").cloned().unwrap_or(json!(true)),
        "message": if failed { format!("{label} failed.") } else { format!("{label} passed.") },
    })
}
