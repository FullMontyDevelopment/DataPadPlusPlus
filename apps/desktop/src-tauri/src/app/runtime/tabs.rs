use std::collections::{HashMap, HashSet};

use super::library::effective_connection_environment_id;
use super::query_tabs::{
    build_environment_tab, build_explorer_tab, build_metrics_tab, build_object_view_tab,
    build_query_tab, build_scoped_query_tab, next_query_tab_title, normalize_tab_title,
    query_tab_title_parts,
};
use super::ui::focus_query_tab;
use super::validators::{
    validate_connection_id, validate_create_object_view_tab_request,
    validate_create_scoped_query_tab_request, validate_environment_id,
    validate_query_tab_reorder_request, validate_required_tab_id,
    validate_update_query_builder_state_request, validate_update_query_tab_request,
    validate_update_query_tab_target_request,
};
use super::{generate_id, timestamp_now, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, ClosedQueryTabSnapshot, CreateObjectViewTabRequest,
        CreateScopedQueryTabRequest, PersistenceWarning, QueryTabReorderRequest, QueryTabState,
        ScopedQueryTarget, UpdateQueryBuilderStateRequest, UpdateQueryTabTargetRequest,
        WorkspaceSnapshot,
    },
};
use crate::infrastructure;

impl ManagedAppState {
    pub fn set_active_tab(&mut self, tab_id: &str) -> Result<BootstrapPayload, CommandError> {
        validate_required_tab_id(tab_id)?;
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|item| item.id == tab_id)
            .cloned()
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        self.snapshot.ui.active_tab_id = tab.id;
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn set_tab_environment(
        &mut self,
        tab_id: &str,
        environment_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_required_tab_id(tab_id)?;
        let environment_exists = environment_id.is_empty()
            || self
                .snapshot
                .environments
                .iter()
                .any(|item| item.id == environment_id);

        if !environment_exists {
            return Err(CommandError::new(
                "environment-missing",
                "Environment was not found.",
            ));
        }

        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        tab.environment_id = environment_id.into();
        tab.status = "idle".into();
        tab.result = None;
        tab.error = None;
        tab.last_run_at = None;

        self.snapshot.ui.active_tab_id = tab.id.clone();
        self.snapshot.ui.active_connection_id = tab.connection_id.clone();
        self.snapshot.ui.active_environment_id = tab.environment_id.clone();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_query_tab(
        &mut self,
        connection_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_connection_id(connection_id)?;
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;
        let title = next_query_tab_title(&self.snapshot, &connection);
        let mut tab = build_query_tab(&connection, true, title);
        tab.environment_id =
            effective_connection_environment_id(&self.snapshot, &connection.id, None);
        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_explorer_tab(
        &mut self,
        connection_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_connection_id(connection_id)?;
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.connection_id == connection.id && tab.tab_kind.as_deref() == Some("explorer")
            })
            .cloned()
        {
            focus_query_tab(&mut self.snapshot.ui, &existing_tab);
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.snapshot.ui.explorer_view = "structure".into();
            self.snapshot.ui.right_drawer = "none".into();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_explorer_tab(&self.snapshot, &connection);

        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.ui.explorer_view = "structure".into();
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_metrics_tab(
        &mut self,
        connection_id: &str,
        environment_id: Option<String>,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_connection_id(connection_id)?;
        if let Some(environment_id) = environment_id.as_deref() {
            validate_environment_id(environment_id)?;
        }
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;
        let environment_id =
            effective_connection_environment_id(&self.snapshot, &connection.id, environment_id);

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.connection_id == connection.id
                    && tab.environment_id == environment_id
                    && tab.tab_kind.as_deref() == Some("metrics")
            })
            .cloned()
        {
            focus_query_tab(&mut self.snapshot.ui, &existing_tab);
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.snapshot.ui.right_drawer = "none".into();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_metrics_tab(&self.snapshot, &connection, environment_id);

        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_environment_tab(
        &mut self,
        environment_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_environment_id(environment_id)?;
        let environment = self
            .snapshot
            .environments
            .iter()
            .find(|item| item.id == environment_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new("environment-missing", "Environment was not found.")
            })?;

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.environment_id == environment.id
                    && tab.tab_kind.as_deref() == Some("environment")
            })
            .cloned()
        {
            focus_query_tab(&mut self.snapshot.ui, &existing_tab);
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.snapshot.ui.active_environment_id = environment.id;
            self.snapshot.ui.right_drawer = "none".into();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_environment_tab(&self.snapshot, &environment);

        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.ui.active_environment_id = environment.id;
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_object_view_tab(
        &mut self,
        request: CreateObjectViewTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_create_object_view_tab_request(&request)?;
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == request.connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;
        let environment_id = effective_connection_environment_id(
            &self.snapshot,
            &connection.id,
            request.environment_id.clone(),
        );

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.connection_id == connection.id
                    && tab.environment_id == environment_id
                    && tab.tab_kind.as_deref() == Some("object-view")
                    && tab.object_view_state.as_ref().and_then(|state| {
                        state
                            .get("nodeId")
                            .and_then(|node_id| node_id.as_str())
                            .map(|node_id| node_id == request.node_id)
                    }) == Some(true)
            })
            .cloned()
        {
            focus_query_tab(&mut self.snapshot.ui, &existing_tab);
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.snapshot.ui.right_drawer = "none".into();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_object_view_tab(&self.snapshot, &connection, request, environment_id);

        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_scoped_query_tab(
        &mut self,
        request: CreateScopedQueryTabRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_create_scoped_query_tab_request(&request)?;
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == request.connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;
        let legacy_title = legacy_scoped_title_candidate(&connection, &request.target);

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.connection_id == request.connection_id
                    && if let Some(target) = tab.scoped_target.as_ref() {
                        scoped_targets_match(target, &request.target)
                    } else {
                        tab.title == legacy_title
                    }
            })
            .cloned()
        {
            focus_query_tab(&mut self.snapshot.ui, &existing_tab);
            self.snapshot.ui.active_activity = "library".into();
            self.snapshot.ui.active_sidebar_pane = "library".into();
            self.snapshot.updated_at = timestamp_now();
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_scoped_query_tab(&self.snapshot, &connection, request);

        self.snapshot.tabs.push(tab.clone());
        focus_query_tab(&mut self.snapshot.ui, &tab);
        self.snapshot.ui.active_activity = "library".into();
        self.snapshot.ui.active_sidebar_pane = "library".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn close_query_tab(&mut self, tab_id: &str) -> Result<BootstrapPayload, CommandError> {
        validate_required_tab_id(tab_id)?;
        let Some(tab_index) = self.snapshot.tabs.iter().position(|item| item.id == tab_id) else {
            return Ok(self.bootstrap_payload());
        };
        let closed_tab = self.snapshot.tabs.remove(tab_index);

        archive_closed_tab(&mut self.snapshot, closed_tab.clone(), "user");

        if let Some(active_tab) = self
            .snapshot
            .tabs
            .get(tab_index)
            .cloned()
            .or_else(|| {
                tab_index
                    .checked_sub(1)
                    .and_then(|index| self.snapshot.tabs.get(index).cloned())
            })
            .or_else(|| self.snapshot.tabs.first().cloned())
        {
            self.snapshot.ui.active_tab_id = active_tab.id;
            self.snapshot.ui.active_connection_id = active_tab.connection_id;
            self.snapshot.ui.active_environment_id = active_tab.environment_id;
        } else {
            let fallback_connection = self
                .snapshot
                .connections
                .iter()
                .find(|connection| connection.id == closed_tab.connection_id)
                .cloned()
                .or_else(|| self.snapshot.connections.first().cloned());
            self.snapshot.ui.active_tab_id = String::new();
            self.snapshot.ui.active_connection_id = fallback_connection
                .as_ref()
                .map(|connection| connection.id.clone())
                .unwrap_or_default();
            self.snapshot.ui.active_environment_id = if closed_tab.environment_id.is_empty() {
                fallback_connection
                    .and_then(|connection| connection.environment_ids.first().cloned())
                    .unwrap_or_default()
            } else {
                closed_tab.environment_id
            };
            self.snapshot.ui.bottom_panel_visible = false;
        }

        self.snapshot.updated_at = timestamp_now();
        let persistence_warning = tab_close_persistence_warning(self.persist());
        if let Some(warning) = persistence_warning.as_ref() {
            infrastructure::log_warning(
                "command",
                format!(
                    "tab-close-persist-failed tab={tab_id} code={} message={}",
                    warning.code, warning.message
                ),
            );
        }
        let mut payload = self.bootstrap_payload();
        payload.persistence_warning = persistence_warning;
        Ok(payload)
    }

    pub fn reopen_closed_query_tab(
        &mut self,
        closed_tab_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_required_tab_id(closed_tab_id)?;
        let closed_tab_index = self
            .snapshot
            .closed_tabs
            .iter()
            .position(|item| item.tab.id == closed_tab_id)
            .ok_or_else(|| CommandError::new("closed-tab-missing", "Closed tab was not found."))?;
        let closed_tab = self.snapshot.closed_tabs.remove(closed_tab_index);
        let mut tab = closed_tab.tab;

        tab.id = generate_id("tab");
        tab.result = None;

        if tab.status == "running" || tab.status == "queued" {
            tab.status = "idle".into();
        }

        self.snapshot.tabs.push(tab.clone());
        self.snapshot.ui.active_tab_id = tab.id;
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn reorder_query_tabs(
        &mut self,
        request: QueryTabReorderRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_query_tab_reorder_request(&request)?;
        reorder_query_tabs_in_place(&mut self.snapshot.tabs, request.ordered_tab_ids)?;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn update_query_tab(
        &mut self,
        tab_id: &str,
        query_text: &str,
        query_view_mode: Option<String>,
        document_efficiency_mode: Option<bool>,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_update_query_tab_request(tab_id, query_text, query_view_mode.as_deref())?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        if query_view_mode.as_deref() == Some("script") {
            tab.script_text = Some(query_text.into());
        } else {
            tab.query_text = query_text.into();
        }
        if query_view_mode.is_some() {
            tab.query_view_mode = query_view_mode;
        }
        if document_efficiency_mode.is_some() {
            tab.document_efficiency_mode = document_efficiency_mode;
        }
        tab.dirty = true;
        tab.error = None;
        if tab.result.is_none() {
            tab.status = "idle".into();
            tab.last_run_at = None;
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn update_query_builder_state(
        &mut self,
        request: UpdateQueryBuilderStateRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_update_query_builder_state_request(&request)?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;

        tab.builder_state = Some(request.builder_state);
        if let Some(query_text) = request.query_text {
            tab.query_text = query_text;
        }
        if let Some(query_view_mode) = request.query_view_mode {
            tab.query_view_mode = Some(query_view_mode);
        }
        tab.dirty = true;
        tab.error = None;
        if tab.result.is_none() {
            tab.status = "idle".into();
            tab.last_run_at = None;
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn update_query_tab_target(
        &mut self,
        request: UpdateQueryTabTargetRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_update_query_tab_target_request(&request)?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|item| item.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;

        apply_query_target_update(tab, request)?;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn rename_query_tab(
        &mut self,
        tab_id: &str,
        title: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validate_required_tab_id(tab_id)?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let title = normalize_tab_title(title, &tab.title);

        tab.title = title;
        if tab.saved_query_id.is_some() || tab.save_target.is_some() {
            tab.dirty = true;
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

pub(super) fn apply_query_target_update(
    tab: &mut QueryTabState,
    request: UpdateQueryTabTargetRequest,
) -> Result<(), CommandError> {
    if tab.active_execution.is_some() {
        return Err(CommandError::new(
            "query-target-change-running",
            "Wait for the current query to finish before changing its target.",
        ));
    }

    tab.scoped_target = Some(request.scoped_target);
    tab.query_text = request.query_text;
    tab.query_view_mode = Some(request.query_view_mode);
    tab.script_text = request.script_text;
    tab.builder_state = request.builder_state;
    if let Some(title) = request.title.filter(|value| !value.trim().is_empty()) {
        tab.title = title.trim().to_string();
    }
    tab.status = "idle".into();
    tab.active_execution = None;
    tab.dirty = true;
    tab.last_run_at = None;
    tab.result = None;
    tab.error = None;
    Ok(())
}

pub(super) fn scoped_targets_match(left: &ScopedQueryTarget, right: &ScopedQueryTarget) -> bool {
    left.kind == right.kind
        && left.label == right.label
        && left.path == right.path
        && left.scope == right.scope
        && left.preferred_builder == right.preferred_builder
}

pub(super) fn legacy_scoped_title_candidate(
    connection: &crate::domain::models::ConnectionProfile,
    target: &ScopedQueryTarget,
) -> String {
    let (_, extension) = query_tab_title_parts(connection);
    let label = legacy_normalized_target_label(&target.label);
    let has_builder =
        connection.engine == "mongodb" && target.preferred_builder.as_deref() == Some("mongo-find");

    if has_builder {
        format!("{label}.find.{extension}")
    } else {
        format!("{label}.{extension}")
    }
}

fn legacy_normalized_target_label(label: &str) -> String {
    let trimmed = label.trim();

    if trimmed.is_empty() {
        "query".into()
    } else {
        trimmed
            .chars()
            .map(|character| {
                if character.is_control() || character == '/' || character == '\\' {
                    '_'
                } else {
                    character
                }
            })
            .take(80)
            .collect()
    }
}

fn archive_closed_tab(snapshot: &mut WorkspaceSnapshot, mut tab: QueryTabState, reason: &str) {
    const MAX_CLOSED_TABS: usize = 25;

    tab.result = None;
    snapshot
        .closed_tabs
        .retain(|closed_tab| closed_tab.tab.id != tab.id);
    snapshot.closed_tabs.insert(
        0,
        ClosedQueryTabSnapshot {
            tab,
            closed_at: timestamp_now(),
            close_reason: reason.into(),
        },
    );
    snapshot.closed_tabs.truncate(MAX_CLOSED_TABS);
}

pub(super) fn tab_close_persistence_warning(
    result: Result<(), CommandError>,
) -> Option<PersistenceWarning> {
    result.err().map(|error| PersistenceWarning {
        code: error.code,
        message: error.message,
    })
}

pub(super) fn reorder_query_tabs_in_place(
    tabs: &mut Vec<QueryTabState>,
    ordered_tab_ids: Vec<String>,
) -> Result<(), CommandError> {
    let current_ids = tabs
        .iter()
        .map(|tab| tab.id.as_str())
        .collect::<HashSet<_>>();
    let requested_ids = ordered_tab_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    if ordered_tab_ids.len() != tabs.len()
        || requested_ids.len() != ordered_tab_ids.len()
        || requested_ids != current_ids
    {
        return Err(CommandError::new(
            "tab-reorder-invalid",
            "Tab order was rejected because it does not match the open query tabs.",
        ));
    }

    let mut tabs_by_id = tabs
        .drain(..)
        .map(|tab| (tab.id.clone(), tab))
        .collect::<HashMap<_, _>>();
    *tabs = ordered_tab_ids
        .into_iter()
        .filter_map(|tab_id| tabs_by_id.remove(&tab_id))
        .collect();

    Ok(())
}
