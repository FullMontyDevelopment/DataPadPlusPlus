use super::*;
use crate::app::runtime::{library, library_validation, query_compiler};
use crate::domain::error::CommandError;

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/datastore_mcp_server/workspace_library_tests.rs"]
mod tests;

#[derive(Debug, Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ListLibraryArgs {
    pub name: Option<String>,
    /// query or script; omit for both. Test-suite listing has a separate tool.
    pub kind: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LibraryItemArgs {
    pub workspace_id: String,
    pub item_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct UpdateLibraryArgs {
    pub workspace_id: String,
    pub item_id: String,
    pub expected_revision: String,
    /// Partial replacement of name, summary, tags, queryText, scriptText,
    /// queryViewMode, builderState, or testSuite. Identity and target fields are immutable.
    pub changes: Value,
}

pub(super) fn library_failure(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

pub(super) fn library_reply(result: Result<Value, CommandError>) -> CallToolResult {
    match result {
        Ok(value) => CallToolResult::structured(value),
        Err(error) => {
            let errors = matches!(
                error.code.as_str(),
                "query-builder-invalid" | "test-suite-invalid"
            )
            .then(|| serde_json::from_str::<Value>(&error.message).ok())
            .flatten();
            let mut response =
                json!({"code":error.code,"message":redact_sensitive_text(&error.message)});
            if let Some(mut errors) = errors {
                sanitize_definition(&mut errors);
                response["errors"] = errors;
            }
            CallToolResult::structured_error(response)
        }
    }
}

pub(super) fn active_workspace_id(runtime: &ManagedAppState) -> Result<String, CommandError> {
    Ok(runtime.workspace_switcher_status()?.active_workspace_id)
}

pub(super) fn check_workspace(
    runtime: &ManagedAppState,
    expected: &str,
) -> Result<(), CommandError> {
    runtime.ensure_unlocked()?;
    if active_workspace_id(runtime)? != expected {
        return Err(library_failure(
            "mcp-workspace-changed",
            "The active workspace changed. Reconnect and list saved items again.",
        ));
    }
    Ok(())
}

pub(super) fn item_revision(node: &LibraryNode) -> String {
    let mut node = node.clone();
    node.last_opened_at = None;
    URL_SAFE_NO_PAD.encode(Sha256::digest(
        serde_json::to_vec(&node).unwrap_or_default(),
    ))
}

pub(super) fn find_item(
    snapshot: &WorkspaceSnapshot,
    id: &str,
    suites: bool,
) -> Result<LibraryNode, CommandError> {
    let mut snapshot = snapshot.clone();
    library::ensure_library_nodes(&mut snapshot);
    snapshot
        .library_nodes
        .into_iter()
        .find(|node| {
            node.id == id
                && if suites {
                    node.kind == "test-suite"
                } else {
                    matches!(node.kind.as_str(), "query" | "script")
                }
        })
        .ok_or_else(|| {
            library_failure(
                "library-item-missing",
                "The saved item was not found in this workspace.",
            )
        })
}

pub(super) fn effective_environment(
    snapshot: &WorkspaceSnapshot,
    node: &LibraryNode,
) -> Option<String> {
    let mut current = Some(node);
    let mut seen = HashSet::new();
    while let Some(item) = current {
        if !seen.insert(&item.id) {
            break;
        }
        if let Some(environment) = &item.environment_id {
            return Some(environment.clone());
        }
        current = item.parent_id.as_ref().and_then(|id| {
            snapshot
                .library_nodes
                .iter()
                .find(|candidate| &candidate.id == id)
        });
    }
    None
}

fn public_definition(node: &LibraryNode) -> (Value, Vec<String>) {
    let raw = json!({"name":node.name,"summary":node.summary,"tags":node.tags,"queryText":node.query_text,"scriptText":node.script_text,"queryViewMode":node.query_view_mode,"builderState":node.builder_state,"testSuite":node.test_suite});
    let mut safe = raw.clone();
    let mut redacted = Vec::new();
    for (field, value) in safe.as_object_mut().unwrap() {
        sanitize_definition(value);
        if *value != raw[field] {
            redacted.push(field.clone());
        }
    }
    (safe, redacted)
}

pub(super) fn sanitize_definition(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_sensitive_text(text),
        Value::Array(values) => values.iter_mut().for_each(sanitize_definition),
        Value::Object(object) => {
            for (key, value) in object {
                let lower = key.to_ascii_lowercase();
                if ["password", "secret", "token", "credential", "privatekey"]
                    .iter()
                    .any(|needle| lower.contains(needle))
                {
                    *value = json!("********");
                } else {
                    sanitize_definition(value);
                }
            }
        }
        _ => {}
    }
}

pub(super) fn item_summary(snapshot: &WorkspaceSnapshot, node: &LibraryNode) -> Value {
    let (_, redacted) = public_definition(node);
    let key_browser = node.query_view_mode.as_deref() == Some("builder")
        && node
            .builder_state
            .as_ref()
            .is_some_and(|state| state["kind"] == "redis-key-browser");
    let profile = snapshot
        .connections
        .iter()
        .find(|profile| Some(&profile.id) == node.connection_id.as_ref());
    let reason = if key_browser {
        Some("Key-browser layouts are editable, but are not executable queries. Save a raw Redis/Valkey command for execution.")
    } else if profile.is_none() {
        Some("The saved connection is unavailable.")
    } else if node.kind == "test-suite" && !snapshot.preferences.datastore_tests.enabled {
        Some("Enable the Datastore Tests plugin before running saved suites.")
    } else if node.kind == "test-suite"
        && !profile.is_some_and(|profile| {
            matches!(
                profile.engine.as_str(),
                "postgresql" | "sqlite" | "mongodb" | "redis" | "valkey" | "dynamodb"
            )
        })
    {
        Some("This datastore has no validated test-suite execution provider.")
    } else {
        None
    };
    json!({"itemId":node.id,"name":redact_sensitive_text(&node.name),"kind":node.kind,"revision":item_revision(node),"folderId":node.parent_id,"folderPath":folder_context(snapshot,node),"connectionId":node.connection_id,"environmentId":effective_environment(snapshot,node),"editingMode":node.query_view_mode.as_deref().unwrap_or(if node.kind == "script" {"script"} else if node.kind == "test-suite" {"test-suite"} else {"raw"}),"language":node.language,"scopedTarget":node.scoped_target,"sqlScope":node.sql_scope,"redactedFields":redacted,"capabilities":{"read":true,"update":true,"requiresLibraryWrite":true,"run":reason.is_none(),"runUnavailableReason":reason,"runRequiresTargetAuthorization":true}})
}

fn folder_context(snapshot: &WorkspaceSnapshot, node: &LibraryNode) -> Vec<Value> {
    let mut parent = node.parent_id.as_ref();
    let mut seen = HashSet::from([&node.id]);
    let mut path = Vec::new();
    while let Some(id) = parent {
        if !seen.insert(id) {
            break;
        }
        let Some(folder) = snapshot.library_nodes.iter().find(|item| &item.id == id) else {
            break;
        };
        path.push(
            json!({"id":folder.id,"name":redact_sensitive_text(&folder.name),"kind":folder.kind}),
        );
        parent = folder.parent_id.as_ref();
    }
    path.reverse();
    path
}

fn persist_then_publish<T>(
    current: &mut T,
    mut candidate: T,
    persist: impl FnOnce(&mut T) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    persist(&mut candidate)?;
    *current = candidate;
    Ok(())
}

pub(super) fn list_items(
    snapshot: &WorkspaceSnapshot,
    workspace_id: &str,
    args: ListLibraryArgs,
    suites: bool,
) -> Result<Value, CommandError> {
    if args.kind.as_deref().is_some_and(|kind| {
        if suites {
            kind != "test-suite"
        } else {
            !matches!(kind, "query" | "script")
        }
    }) {
        return Err(library_failure(
            "library-kind-invalid",
            "Choose query or script, or omit kind; test-suite listing accepts only test-suite.",
        ));
    }
    let mut normalized = snapshot.clone();
    library::ensure_library_nodes(&mut normalized);
    let name = args
        .name
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let fingerprint = URL_SAFE_NO_PAD.encode(Sha256::digest(format!(
        "{workspace_id}:{}:{suites}:{:?}:{name}",
        snapshot.workspace_revision, args.kind
    )));
    let after = if let Some(cursor) = &args.cursor {
        let decoded = URL_SAFE_NO_PAD
            .decode(cursor)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .ok_or_else(|| {
                library_failure(
                    "library-cursor-invalid",
                    "The listing cursor is invalid. List saved items again.",
                )
            })?;
        if decoded["fingerprint"] != fingerprint {
            return Err(library_failure(
                "library-cursor-stale",
                "The workspace or listing filters changed. Restart the listing.",
            ));
        }
        Some(
            decoded["after"]
                .as_str()
                .ok_or_else(|| {
                    library_failure(
                        "library-cursor-invalid",
                        "The listing cursor has no item identity.",
                    )
                })?
                .to_string(),
        )
    } else {
        None
    };
    let mut nodes = normalized
        .library_nodes
        .iter()
        .filter(|node| {
            (if suites {
                node.kind == "test-suite"
            } else {
                matches!(node.kind.as_str(), "query" | "script")
            }) && args.kind.as_ref().is_none_or(|kind| &node.kind == kind)
                && node.name.to_lowercase().contains(&name)
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    nodes.dedup_by(|a, b| a.id == b.id);
    let total = nodes.len();
    let nodes = nodes
        .into_iter()
        .filter(|node| after.as_ref().is_none_or(|after| &node.id > after))
        .collect::<Vec<_>>();
    let limit = args.limit.unwrap_or(50).clamp(1, 100);
    let page = nodes
        .iter()
        .take(limit)
        .map(|node| item_summary(&normalized, node))
        .collect::<Vec<_>>();
    let next = if nodes.len() > limit {
        Some(
            URL_SAFE_NO_PAD
                .encode(json!({"fingerprint":fingerprint,"after":nodes[limit-1].id}).to_string()),
        )
    } else {
        None
    };
    Ok(
        json!({"workspaceId":workspace_id,"workspaceRevision":snapshot.workspace_revision,"total":total,"items":page,"nextCursor":next}),
    )
}

pub(super) fn get_item(
    runtime: &ManagedAppState,
    args: LibraryItemArgs,
    suites: bool,
) -> Result<Value, CommandError> {
    check_workspace(runtime, &args.workspace_id)?;
    let item = find_item(&runtime.snapshot, &args.item_id, suites)?;
    let (definition, _) = public_definition(&item);
    Ok(
        json!({"workspaceId":args.workspace_id,"workspaceRevision":runtime.snapshot.workspace_revision,"item":item_summary(&runtime.snapshot,&item),"definition":definition}),
    )
}

pub(super) fn tab_for_item(snapshot: &WorkspaceSnapshot, node: &LibraryNode) -> QueryTabState {
    QueryTabState {
        id: format!("mcp-item-{}", node.id),
        title: node.name.clone(),
        tab_kind: Some(
            if node.kind == "test-suite" {
                "test-suite"
            } else {
                "query"
            }
            .into(),
        ),
        connection_id: node.connection_id.clone().unwrap_or_default(),
        environment_id: effective_environment(snapshot, node).unwrap_or_default(),
        language: node.language.clone().unwrap_or_else(|| "sql".into()),
        query_text: node.query_text.clone().unwrap_or_default(),
        script_text: node.script_text.clone().or_else(|| {
            if node.kind == "script" {
                node.query_text.clone()
            } else {
                None
            }
        }),
        query_view_mode: node.query_view_mode.clone().or_else(|| {
            Some(
                if node.kind == "script" {
                    "script"
                } else {
                    "raw"
                }
                .into(),
            )
        }),
        scoped_target: node.scoped_target.clone(),
        sql_scope: node.sql_scope.clone(),
        builder_state: node.builder_state.clone(),
        test_suite: node.test_suite.clone(),
        document_efficiency_mode: node.document_efficiency_mode,
        status: "idle".into(),
        ..Default::default()
    }
}

pub(super) fn validate_definition(
    snapshot: &WorkspaceSnapshot,
    node: &mut LibraryNode,
) -> Result<(), CommandError> {
    let tab = tab_for_item(snapshot, node);
    let connection = snapshot
        .connections
        .iter()
        .find(|profile| profile.id == tab.connection_id);
    if node.query_view_mode.as_deref() == Some("builder") {
        let connection = connection.ok_or_else(|| {
            library_failure(
                "connection-missing",
                "The saved builder needs its original connection.",
            )
        })?;
        let state = node.builder_state.as_ref().ok_or_else(|| {
            library_failure(
                "query-builder-invalid",
                "The saved builder definition is missing.",
            )
        })?;
        let (query, compiled) = query_compiler::compile(state, connection, &tab)?;
        node.query_text = Some(query);
        node.builder_state = Some(compiled);
    }
    if let Some(suite) = node.test_suite.as_mut() {
        let result = query_compiler::invoke("validateSuiteShape", suite)?;
        if result["ok"] != true {
            return Err(library_failure(
                "test-suite-invalid",
                &result["errors"].to_string(),
            ));
        }
        let mut ids = HashSet::new();
        for case in suite["cases"].as_array_mut().unwrap() {
            if !ids.insert(case["id"].as_str().unwrap().to_string()) {
                return Err(library_failure(
                    "test-suite-invalid",
                    "Test case and step IDs must be unique.",
                ));
            }
            for phase in ["setup", "execute", "teardown"] {
                for step in case[phase].as_array_mut().unwrap() {
                    if !ids.insert(step["id"].as_str().unwrap().to_string()) {
                        return Err(library_failure(
                            "test-suite-invalid",
                            "Test case and step IDs must be unique.",
                        ));
                    }
                    if step["phase"] != phase {
                        return Err(library_failure(
                            "test-suite-invalid",
                            "Step phases must match their containing section.",
                        ));
                    }
                    if step["kind"] == "builder" {
                        let connection = connection.ok_or_else(|| {
                            library_failure(
                                "connection-missing",
                                "The suite needs its original connection.",
                            )
                        })?;
                        let (query, state) =
                            query_compiler::compile(&step["builderState"], connection, &tab)?;
                        step["queryText"] = json!(query);
                        step["builderState"] = state;
                    }
                }
            }
        }
    }
    Ok(())
}

pub(super) fn prepare_update(
    snapshot: &WorkspaceSnapshot,
    args: &UpdateLibraryArgs,
    suites: bool,
) -> Result<WorkspaceSnapshot, CommandError> {
    let old = find_item(snapshot, &args.item_id, suites)?;
    if item_running(&old.id) {
        return Err(library_failure(
            "library-execution-active",
            "Wait for this item's MCP execution to finish before editing.",
        ));
    }
    if item_revision(&old) != args.expected_revision {
        return Err(library_failure(
            "library-revision-conflict",
            "This saved item changed. Read its current definition before editing.",
        ));
    }
    if snapshot.tabs.iter().any(|tab| {
        linked(tab, &old.id)
            && (tab.dirty
                || tab.active_execution.is_some()
                || matches!(tab.status.as_str(), "running" | "queued"))
    }) {
        return Err(library_failure("library-draft-conflict","Save or discard the linked tab's unsaved draft and wait for its execution to finish before editing through MCP."));
    }
    let changes = args
        .changes
        .as_object()
        .ok_or_else(|| library_failure("library-update-invalid", "Changes must be an object."))?;
    if changes.is_empty() || args.changes.to_string().len() > MAX_REQUEST_BYTES {
        return Err(library_failure(
            "library-update-invalid",
            "Provide non-empty changes within the MCP request size limit.",
        ));
    }
    let (_, redacted) = public_definition(&old);
    let mut raw = serde_json::to_value(&old)?;
    for (key, value) in changes {
        if ![
            "name",
            "summary",
            "tags",
            "queryText",
            "scriptText",
            "queryViewMode",
            "builderState",
            "testSuite",
        ]
        .contains(&key.as_str())
        {
            return Err(library_failure(
                "library-field-immutable",
                "Only saved content, name, summary, tags, and editing mode may be changed.",
            ));
        }
        if redacted.contains(key) {
            return Err(library_failure("library-field-redacted","This field contains redacted content. Edit it in DataPad++ to avoid overwriting hidden values."));
        }
        if suites
            && matches!(
                key.as_str(),
                "queryText" | "scriptText" | "queryViewMode" | "builderState"
            )
            || !suites && key == "testSuite"
        {
            return Err(library_failure(
                "library-update-invalid",
                "This content field is not valid for the saved item kind.",
            ));
        }
        raw[key] = value.clone();
    }
    let mut node: LibraryNode = serde_json::from_value(raw).map_err(|_| {
        library_failure(
            "library-update-invalid",
            "The saved definition has invalid field types.",
        )
    })?;
    node.name = library_validation::library_name_or_error(&node.name, "Library item name")?.into();
    node.tags = library_validation::normalize_library_tags(node.tags)?;
    if node
        .query_view_mode
        .as_deref()
        .is_some_and(|mode| !matches!(mode, "raw" | "builder" | "script"))
    {
        return Err(library_failure(
            "library-update-invalid",
            "Choose raw, builder, or script editing mode.",
        ));
    }
    if changes.contains_key("queryText") && node.query_view_mode.as_deref() == Some("builder") {
        return Err(library_failure(
            "library-update-invalid",
            "Edit builderState, or explicitly switch queryViewMode to raw to edit queryText.",
        ));
    }
    // Cosmos raw SQL and its parameter/partition editor share one authoritative draft.
    // Updating only queryText must not leave execution pointing at the previous SQL.
    if changes.contains_key("queryText") {
        if let Some(builder) = node
            .builder_state
            .as_mut()
            .filter(|b| b["kind"] == "cosmos-sql")
        {
            if let Some(editor) = builder
                .get_mut("editorState")
                .filter(|e| e["kind"] == "cosmos-sql")
            {
                editor["sql"] = json!(node.query_text);
            }
        }
    }
    if suites {
        let previous = old.test_suite.as_ref().ok_or_else(|| {
            library_failure("test-suite-invalid", "The saved test suite is missing.")
        })?;
        let next = node.test_suite.as_ref().ok_or_else(|| {
            library_failure("test-suite-invalid", "A test suite cannot be removed.")
        })?;
        for field in [
            "id",
            "connectionId",
            "environmentId",
            "engine",
            "family",
            "scopedTarget",
            "inferredLanguage",
        ] {
            if previous.get(field) != next.get(field) {
                return Err(library_failure("datastore-test-binding-immutable","Test suite identity, language, connection, environment, and target cannot be changed."));
            }
        }
    }
    if changes.contains_key("builderState")
        && node.builder_state.is_some()
        && node.query_view_mode.as_deref() != Some("builder")
    {
        let mut validation = node.clone();
        validation.query_view_mode = Some("builder".into());
        validate_definition(snapshot, &mut validation)?;
        node.builder_state = validation.builder_state;
    }
    validate_definition(snapshot, &mut node)?;
    node.updated_at = timestamp_now();
    let mut candidate = snapshot.clone();
    library::ensure_library_nodes(&mut candidate);
    *candidate
        .library_nodes
        .iter_mut()
        .find(|item| item.id == node.id)
        .unwrap() = node.clone();
    // Retire the migrated shadow; otherwise an old savedWork value can resurrect deleted content.
    candidate.saved_work.retain(|item| item.id != node.id);
    for tab in &mut candidate.tabs {
        if !linked(tab, &node.id) {
            continue;
        }
        tab.title = node.name.clone();
        tab.query_text = if suites {
            serde_json::to_string_pretty(&node.test_suite)?
        } else {
            node.query_text.clone().unwrap_or_default()
        };
        tab.script_text = node.script_text.clone();
        tab.query_view_mode = node.query_view_mode.clone();
        tab.builder_state = node.builder_state.clone();
        tab.test_suite = node.test_suite.clone();
        tab.result = None;
        tab.test_run = None;
        tab.error = None;
        tab.status = "idle".into();
    }
    candidate.updated_at = timestamp_now();
    Ok(candidate)
}

pub(super) fn linked(tab: &QueryTabState, id: &str) -> bool {
    tab.saved_query_id.as_deref() == Some(id)
        || tab
            .save_target
            .as_ref()
            .and_then(|target| target.library_item_id.as_deref())
            == Some(id)
}

impl DatapadMcpTools {
    pub(super) fn list_library(
        &self,
        args: ListLibraryArgs,
        suites: bool,
    ) -> Result<Value, CommandError> {
        let runtime = self.library_runtime()?;
        list_items(
            &runtime.snapshot,
            &active_workspace_id(&runtime)?,
            args,
            suites,
        )
    }

    pub(super) fn library_runtime(&self) -> Result<ManagedAppState, CommandError> {
        self.runtime().map_err(|error| {
            library_failure(
                error
                    .data
                    .as_ref()
                    .and_then(|data| data["code"].as_str())
                    .unwrap_or("mcp-runtime-unavailable"),
                &error.message,
            )
        })
    }

    pub(super) fn update_library(
        &self,
        args: UpdateLibraryArgs,
        suites: bool,
        token_id: &str,
    ) -> Result<Value, CommandError> {
        let _ = self.library_runtime()?;
        let shared = self.app.state::<SharedAppState>();
        let mut state = shared.lock().map_err(|_| {
            library_failure(
                "workspace-state-unavailable",
                "Workspace state is unavailable.",
            )
        })?;
        check_workspace(&state, &args.workspace_id)?;
        let config = self.current_config().map_err(|_| {
            library_failure("mcp-config-unavailable", "MCP configuration unavailable.")
        })?;
        let (_, token) = token_config(&state.snapshot, &config.id, token_id)?;
        require_scope(&token.scopes, SCOPE_LIBRARY_READ)?;
        require_scope(&token.scopes, SCOPE_LIBRARY_WRITE)?;
        let snapshot = prepare_update(&state.snapshot, &args, suites)?;
        let candidate = ManagedAppState {
            app: state.app.clone(),
            snapshot,
        };
        persist_then_publish(&mut *state, candidate, ManagedAppState::persist)?;
        get_item(
            &state,
            LibraryItemArgs {
                workspace_id: args.workspace_id,
                item_id: args.item_id,
            },
            suites,
        )
    }
}
