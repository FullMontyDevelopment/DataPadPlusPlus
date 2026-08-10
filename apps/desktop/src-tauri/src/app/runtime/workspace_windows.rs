use super::{
    generate_id, timestamp_now, ui::normalize_workspace_windows, ui::tab_can_detach,
    ManagedAppState,
};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, MultiWindowTabsSettingsRequest, WorkspaceTabDragSession,
        WorkspaceTabDragSessionRequest, WorkspaceTabTransferRequest, WorkspaceWindowBounds,
        WorkspaceWindowContext, WorkspaceWindowGeometryRequest, WorkspaceWindowListResponse,
        WorkspaceWindowState, WorkspaceWindowTarget,
    },
};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceMonitorBounds {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn clamp_restored_window_bounds(
    bounds: Option<&WorkspaceWindowBounds>,
    preferred_monitor_name: Option<&str>,
    monitors: &[WorkspaceMonitorBounds],
    primary_monitor_name: Option<&str>,
) -> WorkspaceWindowBounds {
    let requested = bounds.cloned().unwrap_or(WorkspaceWindowBounds {
        x: 120,
        y: 120,
        width: 1120,
        height: 760,
    });
    let monitor = preferred_monitor_name
        .and_then(|preferred| {
            monitors
                .iter()
                .find(|monitor| monitor.name.as_deref() == Some(preferred))
        })
        .or_else(|| {
            primary_monitor_name.and_then(|primary| {
                monitors
                    .iter()
                    .find(|monitor| monitor.name.as_deref() == Some(primary))
            })
        })
        .or_else(|| monitors.first());
    let Some(monitor) = monitor else {
        return WorkspaceWindowBounds {
            width: requested.width.clamp(720, 7680),
            height: requested.height.clamp(480, 4320),
            ..requested
        };
    };

    let maximum_width = monitor.width.max(720);
    let maximum_height = monitor.height.max(480);
    let width = requested.width.clamp(720, maximum_width);
    let height = requested.height.clamp(480, maximum_height);
    let maximum_x = monitor
        .x
        .saturating_add(monitor.width.saturating_sub(width) as i32);
    let maximum_y = monitor
        .y
        .saturating_add(monitor.height.saturating_sub(height) as i32);

    WorkspaceWindowBounds {
        x: requested.x.clamp(monitor.x, maximum_x),
        y: requested.y.clamp(monitor.y, maximum_y),
        width,
        height,
    }
}

#[derive(Default)]
pub struct WorkspaceWindowCoordinator {
    pub drag_session: Option<WorkspaceTabDragSession>,
    pub drag_started_at: Option<Instant>,
    pub shutting_down: bool,
}

impl ManagedAppState {
    pub fn workspace_window_context(&self, window_id: &str) -> WorkspaceWindowContext {
        let role = if window_id == "main" {
            "main"
        } else {
            "editor"
        };
        WorkspaceWindowContext {
            window_id: window_id.into(),
            role: role.into(),
            multi_window_enabled: self.snapshot.preferences.multi_window_tabs.enabled,
            // WebView2 is the only release WebView where the transfer-token spike is enabled.
            // The accessible Move commands remain available on every desktop target.
            drag_supported: cfg!(target_os = "windows"),
        }
    }

    pub fn list_workspace_windows(&self) -> WorkspaceWindowListResponse {
        let windows = normalize_workspace_windows(&self.snapshot)
            .into_iter()
            .map(|window| {
                let title = self
                    .snapshot
                    .tabs
                    .iter()
                    .find(|tab| tab.id == window.active_tab_id)
                    .map(|tab| tab.title.clone())
                    .unwrap_or_else(|| {
                        if window.id == "main" {
                            "DataPad++".into()
                        } else {
                            "Editor Window".into()
                        }
                    });
                WorkspaceWindowTarget {
                    window_id: window.id,
                    role: window.role,
                    title,
                    active_tab_id: window.active_tab_id,
                    tab_count: window.tab_ids.len(),
                }
            })
            .collect();
        WorkspaceWindowListResponse { windows }
    }

    pub fn set_active_tab_for_window(
        &mut self,
        window_id: &str,
        tab_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == tab_id)
            .cloned()
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        let window = self
            .snapshot
            .ui
            .workspace_windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| {
                CommandError::new(
                    "window-missing",
                    "The destination window is no longer open.",
                )
            })?;
        if !window.tab_ids.iter().any(|id| id == tab_id) {
            return Err(CommandError::new(
                "tab-window-mismatch",
                "The tab no longer belongs to this window.",
            ));
        }
        window.active_tab_id = tab_id.into();
        window.last_focused_at = Some(timestamp_now());
        if window_id == "main" {
            self.snapshot.ui.active_tab_id = tab.id;
            self.snapshot.ui.active_connection_id = tab.connection_id;
            self.snapshot.ui.active_environment_id = tab.environment_id;
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn reorder_tabs_for_window(
        &mut self,
        window_id: &str,
        ordered_tab_ids: Vec<String>,
    ) -> Result<BootstrapPayload, CommandError> {
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        let window = self
            .snapshot
            .ui
            .workspace_windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| {
                CommandError::new("window-missing", "The tab window is no longer open.")
            })?;
        let mut current = window.tab_ids.clone();
        let mut requested = ordered_tab_ids.clone();
        current.sort();
        requested.sort();
        requested.dedup();
        if current != requested || ordered_tab_ids.len() != window.tab_ids.len() {
            return Err(CommandError::new(
                "tab-reorder-invalid",
                "Tab order was rejected because it does not match this window's tabs.",
            ));
        }
        window.tab_ids = ordered_tab_ids;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn transfer_workspace_tab(
        &mut self,
        request: &WorkspaceTabTransferRequest,
        destination_window_id: &str,
        normalize_layout: bool,
    ) -> Result<BootstrapPayload, CommandError> {
        if !self.snapshot.preferences.multi_window_tabs.enabled {
            return Err(CommandError::new(
                "multi-window-disabled",
                "Enable the experimental Multi-window Tabs plugin before moving tabs between windows.",
            ));
        }
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == request.tab_id)
            .cloned()
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        if !tab_can_detach(&tab) {
            return Err(CommandError::new(
                "tab-not-detachable",
                "This administrative tab stays in the main DataPad++ window.",
            ));
        }
        if tab.active_execution.is_some() || matches!(tab.status.as_str(), "running" | "queued") {
            return Err(CommandError::new(
                "tab-transfer-running",
                "Wait for the current query or test run to finish before moving this tab.",
            ));
        }

        if normalize_layout {
            self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        }
        transfer_tab_ownership(
            &mut self.snapshot.ui.workspace_windows,
            request,
            destination_window_id,
        )?;

        let main_active = self
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .find(|window| window.id == "main")
            .map(|window| window.active_tab_id.clone())
            .unwrap_or_default();
        if let Some(main_tab) = self.snapshot.tabs.iter().find(|tab| tab.id == main_active) {
            self.snapshot.ui.active_tab_id = main_tab.id.clone();
            self.snapshot.ui.active_connection_id = main_tab.connection_id.clone();
            self.snapshot.ui.active_environment_id = main_tab.environment_id.clone();
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn add_editor_window_layout(
        &mut self,
        window_id: &str,
        request: &WorkspaceTabTransferRequest,
    ) {
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        self.snapshot
            .ui
            .workspace_windows
            .push(WorkspaceWindowState {
                id: window_id.into(),
                role: "editor".into(),
                bounds: Some(WorkspaceWindowBounds {
                    x: request.x.unwrap_or(120),
                    y: request.y.unwrap_or(120),
                    width: 1120,
                    height: 760,
                }),
                ..WorkspaceWindowState::default()
            });
    }

    pub fn update_workspace_window_geometry(
        &mut self,
        request: WorkspaceWindowGeometryRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        let window = self
            .snapshot
            .ui
            .workspace_windows
            .iter_mut()
            .find(|window| window.id == request.window_id)
            .ok_or_else(|| CommandError::new("window-missing", "The window is no longer open."))?;
        window.bounds = Some(WorkspaceWindowBounds {
            x: request.x,
            y: request.y,
            width: request.width.clamp(720, 7680),
            height: request.height.clamp(480, 4320),
        });
        window.monitor_name = request.monitor_name;
        window.maximized = request.maximized.unwrap_or(false);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn reattach_workspace_window(
        &mut self,
        window_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        if window_id == "main" {
            return Err(CommandError::new(
                "window-main",
                "The main window cannot be reattached.",
            ));
        }
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        let source_index = self
            .snapshot
            .ui
            .workspace_windows
            .iter()
            .position(|window| window.id == window_id)
            .ok_or_else(|| {
                CommandError::new("window-missing", "The editor window is no longer open.")
            })?;
        let source = self.snapshot.ui.workspace_windows[source_index].clone();
        if source.tab_ids.iter().any(|tab_id| {
            self.snapshot.tabs.iter().any(|tab| {
                tab.id == *tab_id
                    && (tab.active_execution.is_some()
                        || matches!(tab.status.as_str(), "running" | "queued"))
            })
        }) {
            return Err(CommandError::new(
                "window-execution-active",
                "Wait for running work to finish or cancel it before closing this editor window.",
            ));
        }
        let main_active_tab_id = {
            let main = self
                .snapshot
                .ui
                .workspace_windows
                .iter_mut()
                .find(|window| window.id == "main")
                .expect("normalized workspace has a main window");
            for tab_id in &source.tab_ids {
                if !main.tab_ids.contains(tab_id) {
                    main.tab_ids.push(tab_id.clone());
                }
            }
            if !source.active_tab_id.is_empty() {
                main.active_tab_id = source.active_tab_id;
            }
            main.active_tab_id.clone()
        };
        self.snapshot.ui.workspace_windows.remove(source_index);
        if let Some(tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == main_active_tab_id)
        {
            self.snapshot.ui.active_tab_id = tab.id.clone();
            self.snapshot.ui.active_connection_id = tab.connection_id.clone();
            self.snapshot.ui.active_environment_id = tab.environment_id.clone();
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn update_multi_window_tabs_settings(
        &mut self,
        request: MultiWindowTabsSettingsRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        if !request.enabled
            && self.snapshot.tabs.iter().any(|tab| {
                tab.active_execution.is_some()
                    || matches!(tab.status.as_str(), "running" | "queued")
            })
        {
            return Err(CommandError::new(
                "multi-window-execution-active",
                "Wait for running work to finish or cancel it before disabling Multi-window Tabs.",
            ));
        }
        self.snapshot.preferences.multi_window_tabs.enabled = request.enabled;
        if !request.enabled {
            let all_tab_ids = self
                .snapshot
                .tabs
                .iter()
                .map(|tab| tab.id.clone())
                .collect();
            self.snapshot.ui.workspace_windows = vec![WorkspaceWindowState {
                tab_ids: all_tab_ids,
                active_tab_id: self.snapshot.ui.active_tab_id.clone(),
                ..WorkspaceWindowState::default()
            }];
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

pub(super) fn transfer_tab_ownership(
    windows: &mut [WorkspaceWindowState],
    request: &WorkspaceTabTransferRequest,
    destination_window_id: &str,
) -> Result<(), CommandError> {
    let source_index = windows
        .iter()
        .position(|window| window.id == request.source_window_id)
        .ok_or_else(|| {
            CommandError::new("window-missing", "The source window is no longer open.")
        })?;
    let destination_index = windows
        .iter()
        .position(|window| window.id == destination_window_id)
        .ok_or_else(|| {
            CommandError::new(
                "window-missing",
                "The destination window is no longer open.",
            )
        })?;
    if !windows[source_index]
        .tab_ids
        .iter()
        .any(|tab_id| tab_id == &request.tab_id)
    {
        return Err(CommandError::new(
            "tab-window-mismatch",
            "The tab moved before this transfer could be completed.",
        ));
    }

    if source_index == destination_index {
        let window = &mut windows[source_index];
        window.tab_ids.retain(|tab_id| tab_id != &request.tab_id);
        let insertion = request
            .before_tab_id
            .as_ref()
            .and_then(|before| window.tab_ids.iter().position(|tab_id| tab_id == before))
            .unwrap_or(window.tab_ids.len());
        window.tab_ids.insert(insertion, request.tab_id.clone());
        window.active_tab_id = request.tab_id.clone();
        return Ok(());
    }

    let source_active_was_moved = windows[source_index].active_tab_id == request.tab_id;
    windows[source_index]
        .tab_ids
        .retain(|tab_id| tab_id != &request.tab_id);
    if source_active_was_moved {
        windows[source_index].active_tab_id = windows[source_index]
            .tab_ids
            .first()
            .cloned()
            .unwrap_or_default();
    }

    let destination = &mut windows[destination_index];
    destination
        .tab_ids
        .retain(|tab_id| tab_id != &request.tab_id);
    let insertion = request
        .before_tab_id
        .as_ref()
        .and_then(|before| {
            destination
                .tab_ids
                .iter()
                .position(|tab_id| tab_id == before)
        })
        .unwrap_or(destination.tab_ids.len());
    destination
        .tab_ids
        .insert(insertion, request.tab_id.clone());
    destination.active_tab_id = request.tab_id.clone();
    destination.last_focused_at = Some(timestamp_now());
    Ok(())
}

impl WorkspaceWindowCoordinator {
    pub fn start_drag(
        &mut self,
        request: WorkspaceTabDragSessionRequest,
    ) -> WorkspaceTabDragSession {
        let session = WorkspaceTabDragSession {
            token: generate_id("tab-drag"),
            tab_id: request.tab_id,
            source_window_id: request.source_window_id,
        };
        self.drag_session = Some(session.clone());
        self.drag_started_at = Some(Instant::now());
        session
    }

    pub fn active_drag(&self) -> Option<WorkspaceTabDragSession> {
        if self
            .drag_started_at
            .is_none_or(|started_at| started_at.elapsed() > Duration::from_secs(30))
        {
            return None;
        }
        self.drag_session.clone()
    }

    pub fn cancel_drag(&mut self, token: Option<&str>) {
        if token.is_none()
            || self
                .drag_session
                .as_ref()
                .is_some_and(|session| Some(session.token.as_str()) == token)
        {
            self.drag_session = None;
            self.drag_started_at = None;
        }
    }
}
