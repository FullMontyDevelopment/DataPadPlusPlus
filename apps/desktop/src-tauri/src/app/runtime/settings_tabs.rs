use super::{generate_id, timestamp_now, ui::focus_query_tab, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{BootstrapPayload, QueryTabState, WorkspaceSnapshot},
};

impl ManagedAppState {
    pub fn create_settings_tab(&mut self) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.tab_kind.as_deref() == Some("settings"))
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_settings_tab(&self.snapshot);
        self.snapshot.tabs.push(tab.clone());
        focus_settings_tab(self, &tab)?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_api_server_tab(&mut self) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.tab_kind.as_deref() == Some("api-server"))
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_api_server_tab(&self.snapshot);
        self.snapshot.tabs.push(tab.clone());
        focus_settings_tab(self, &tab)?;
        Ok(self.bootstrap_payload())
    }
}

fn focus_settings_tab(
    state: &mut ManagedAppState,
    tab: &QueryTabState,
) -> Result<(), CommandError> {
    focus_query_tab(&mut state.snapshot.ui, tab);
    state.snapshot.ui.active_activity = "library".into();
    state.snapshot.ui.active_sidebar_pane = "library".into();
    state.snapshot.ui.right_drawer = "none".into();
    state.snapshot.updated_at = timestamp_now();
    state.persist()
}

fn build_settings_tab(snapshot: &WorkspaceSnapshot) -> QueryTabState {
    let connection = snapshot
        .connections
        .iter()
        .find(|connection| connection.id == snapshot.ui.active_connection_id)
        .or_else(|| snapshot.connections.first());
    let environment = snapshot
        .environments
        .iter()
        .find(|environment| environment.id == snapshot.ui.active_environment_id)
        .or_else(|| snapshot.environments.first());

    QueryTabState {
        id: generate_id("settings-tab"),
        title: "Settings".into(),
        tab_kind: Some("settings".into()),
        connection_id: connection
            .map(|connection| connection.id.clone())
            .unwrap_or_default(),
        environment_id: environment
            .map(|environment| environment.id.clone())
            .unwrap_or_default(),
        family: connection
            .map(|connection| connection.family.clone())
            .unwrap_or_else(|| "sql".into()),
        language: "text".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "Settings".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}

fn build_api_server_tab(snapshot: &WorkspaceSnapshot) -> QueryTabState {
    let configured_connection_id = snapshot
        .preferences
        .datastore_api_server
        .connection_id
        .as_deref();
    let configured_environment_id = snapshot
        .preferences
        .datastore_api_server
        .environment_id
        .as_deref();
    let connection = configured_connection_id
        .and_then(|id| {
            snapshot
                .connections
                .iter()
                .find(|connection| connection.id == id)
        })
        .or_else(|| {
            snapshot
                .connections
                .iter()
                .find(|connection| connection.id == snapshot.ui.active_connection_id)
        })
        .or_else(|| snapshot.connections.first());
    let environment = configured_environment_id
        .and_then(|id| {
            snapshot
                .environments
                .iter()
                .find(|environment| environment.id == id)
        })
        .or_else(|| {
            snapshot
                .environments
                .iter()
                .find(|environment| environment.id == snapshot.ui.active_environment_id)
        })
        .or_else(|| snapshot.environments.first());

    QueryTabState {
        id: generate_id("api-server-tab"),
        title: "API Server".into(),
        tab_kind: Some("api-server".into()),
        connection_id: connection
            .map(|connection| connection.id.clone())
            .unwrap_or_default(),
        environment_id: environment
            .map(|environment| environment.id.clone())
            .unwrap_or_default(),
        family: connection
            .map(|connection| connection.family.clone())
            .unwrap_or_else(|| "sql".into()),
        language: "json".into(),
        pinned: None,
        save_target: None,
        saved_query_id: None,
        editor_label: "API Server".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: Vec::new(),
        error: None,
    }
}
