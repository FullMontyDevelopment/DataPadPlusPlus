use super::{generate_id, timestamp_now, ui::focus_query_tab, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{BootstrapPayload, QueryTabState, ScopedQueryTarget, WorkspaceSnapshot},
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

    pub fn create_api_server_tab(
        &mut self,
        server_id: Option<String>,
    ) -> Result<BootstrapPayload, CommandError> {
        let selected_server_id = selected_api_server_id(&self.snapshot, server_id);
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.tab_kind.as_deref() == Some("api-server")
                    && api_server_tab_server_id(tab) == selected_server_id.as_deref()
            })
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_api_server_tab(&self.snapshot, selected_server_id);
        self.snapshot.tabs.push(tab.clone());
        focus_settings_tab(self, &tab)?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_mcp_server_tab(
        &mut self,
        server_id: Option<String>,
    ) -> Result<BootstrapPayload, CommandError> {
        let selected_server_id = selected_mcp_server_id(&self.snapshot, server_id);
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| {
                tab.tab_kind.as_deref() == Some("mcp-server")
                    && mcp_server_tab_server_id(tab) == selected_server_id.as_deref()
            })
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_mcp_server_tab(&self.snapshot, selected_server_id);
        self.snapshot.tabs.push(tab.clone());
        focus_settings_tab(self, &tab)?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_workspace_search_tab(&mut self) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.tab_kind.as_deref() == Some("workspace-search"))
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_workspace_search_tab(&self.snapshot);
        self.snapshot.tabs.push(tab.clone());
        focus_settings_tab(self, &tab)?;
        Ok(self.bootstrap_payload())
    }

    pub fn create_security_checks_tab(&mut self) -> Result<BootstrapPayload, CommandError> {
        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.tab_kind.as_deref() == Some("security-checks"))
            .cloned()
        {
            focus_settings_tab(self, &existing_tab)?;
            return Ok(self.bootstrap_payload());
        }

        let tab = build_security_checks_tab(&self.snapshot);
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
        document_efficiency_mode: None,
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

fn build_api_server_tab(snapshot: &WorkspaceSnapshot, server_id: Option<String>) -> QueryTabState {
    let server = server_id.as_ref().and_then(|id| {
        snapshot
            .preferences
            .datastore_api_server
            .servers
            .iter()
            .find(|server| &server.id == id)
    });
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
    let connection = server
        .and_then(|server| server.connection_id.as_deref())
        .and_then(|id| {
            snapshot
                .connections
                .iter()
                .find(|connection| connection.id == id)
        })
        .or_else(|| {
            configured_connection_id.and_then(|id| {
                snapshot
                    .connections
                    .iter()
                    .find(|connection| connection.id == id)
            })
        })
        .or_else(|| {
            snapshot
                .connections
                .iter()
                .find(|connection| connection.id == snapshot.ui.active_connection_id)
        })
        .or_else(|| snapshot.connections.first());
    let environment = server
        .and_then(|server| server.environment_id.as_deref())
        .and_then(|id| {
            snapshot
                .environments
                .iter()
                .find(|environment| environment.id == id)
        })
        .or_else(|| {
            configured_environment_id.and_then(|id| {
                snapshot
                    .environments
                    .iter()
                    .find(|environment| environment.id == id)
            })
        })
        .or_else(|| {
            snapshot
                .environments
                .iter()
                .find(|environment| environment.id == snapshot.ui.active_environment_id)
        })
        .or_else(|| snapshot.environments.first());
    let title = server
        .map(|server| server.name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or("API Server");

    QueryTabState {
        id: generate_id("api-server-tab"),
        title: title.into(),
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
        document_efficiency_mode: None,
        scoped_target: server_id.map(|server_id| ScopedQueryTarget {
            kind: "api-server".into(),
            label: title.into(),
            path: Vec::new(),
            scope: Some(server_id),
            query_template: None,
            preferred_builder: None,
        }),
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

fn build_mcp_server_tab(snapshot: &WorkspaceSnapshot, server_id: Option<String>) -> QueryTabState {
    let server = server_id.as_ref().and_then(|id| {
        snapshot
            .preferences
            .datastore_mcp_server
            .servers
            .iter()
            .find(|server| &server.id == id)
    });
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
    let title = server
        .map(|server| server.name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or("MCP Server");

    QueryTabState {
        id: generate_id("mcp-server-tab"),
        title: title.into(),
        tab_kind: Some("mcp-server".into()),
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
        editor_label: "MCP Server".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        document_efficiency_mode: None,
        scoped_target: server_id.map(|server_id| ScopedQueryTarget {
            kind: "mcp-server".into(),
            label: title.into(),
            path: Vec::new(),
            scope: Some(server_id),
            query_template: None,
            preferred_builder: None,
        }),
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

fn selected_api_server_id(
    snapshot: &WorkspaceSnapshot,
    requested: Option<String>,
) -> Option<String> {
    let preferences = &snapshot.preferences.datastore_api_server;
    requested
        .filter(|id| preferences.servers.iter().any(|server| server.id == *id))
        .or_else(|| {
            preferences
                .active_server_id
                .clone()
                .filter(|id| preferences.servers.iter().any(|server| server.id == *id))
        })
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()))
}

fn api_server_tab_server_id(tab: &QueryTabState) -> Option<&str> {
    let target = tab.scoped_target.as_ref()?;
    (target.kind == "api-server")
        .then_some(target.scope.as_deref())
        .flatten()
}

fn selected_mcp_server_id(
    snapshot: &WorkspaceSnapshot,
    requested: Option<String>,
) -> Option<String> {
    let preferences = &snapshot.preferences.datastore_mcp_server;
    requested
        .filter(|id| preferences.servers.iter().any(|server| server.id == *id))
        .or_else(|| {
            preferences
                .active_server_id
                .clone()
                .filter(|id| preferences.servers.iter().any(|server| server.id == *id))
        })
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()))
}

fn mcp_server_tab_server_id(tab: &QueryTabState) -> Option<&str> {
    let target = tab.scoped_target.as_ref()?;
    (target.kind == "mcp-server")
        .then_some(target.scope.as_deref())
        .flatten()
}

fn build_workspace_search_tab(snapshot: &WorkspaceSnapshot) -> QueryTabState {
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
        id: generate_id("workspace-search-tab"),
        title: "Search".into(),
        tab_kind: Some("workspace-search".into()),
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
        editor_label: "Search".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        document_efficiency_mode: None,
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

fn build_security_checks_tab(snapshot: &WorkspaceSnapshot) -> QueryTabState {
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
        id: generate_id("security-checks-tab"),
        title: "Security Checks".into(),
        tab_kind: Some("security-checks".into()),
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
        editor_label: "Security Checks".into(),
        query_text: String::new(),
        query_view_mode: None,
        script_text: None,
        document_efficiency_mode: None,
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
