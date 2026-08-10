use std::collections::HashSet;

use crate::domain::models::{
    QueryTabState, UiState, WorkspaceSnapshot, WorkspaceWindowBounds, WorkspaceWindowState,
};

pub(super) fn is_activity(value: &str) -> bool {
    matches!(
        value,
        "connections"
            | "environments"
            | "explorer"
            | "library"
            | "tests"
            | "saved-work"
            | "search"
            | "settings"
    )
}

pub(super) fn is_sidebar_pane(value: &str) -> bool {
    matches!(
        value,
        "connections" | "environments" | "explorer" | "library" | "tests" | "saved-work" | "search"
    )
}

pub(super) fn is_bottom_panel_tab(value: &str) -> bool {
    matches!(value, "results" | "messages" | "history" | "details")
}

pub(super) fn is_explorer_view(value: &str) -> bool {
    matches!(value, "tree" | "structure")
}

pub(super) fn is_connection_group_mode(value: &str) -> bool {
    matches!(value, "none" | "environment" | "database-type")
}

pub(super) fn is_right_drawer(value: &str) -> bool {
    matches!(
        value,
        "none" | "connection" | "inspection" | "diagnostics" | "operations"
    )
}

pub(super) fn is_results_dock(value: &str) -> bool {
    matches!(value, "bottom" | "right")
}

pub(super) fn clamp_bottom_panel_height(value: u32) -> u32 {
    value.clamp(120, 900)
}

pub(super) fn clamp_sidebar_width(value: u32) -> u32 {
    value.clamp(220, 420)
}

pub(super) fn clamp_right_drawer_width(value: u32) -> u32 {
    value.clamp(320, 560)
}

pub(super) fn clamp_results_side_width(value: u32) -> u32 {
    value.clamp(320, 2400)
}

pub(super) fn clamp_mongo_script_guide_width(value: u32) -> u32 {
    value.clamp(280, 520)
}

pub(super) fn focus_query_tab(ui: &mut UiState, tab: &QueryTabState) {
    ui.active_connection_id = tab.connection_id.clone();
    ui.active_environment_id = tab.environment_id.clone();
    ui.active_tab_id = tab.id.clone();
    ui.right_drawer = "none".into();
}

pub(super) fn tab_can_detach(tab: &QueryTabState) -> bool {
    matches!(
        tab.tab_kind.as_deref().unwrap_or("query"),
        "query" | "explorer" | "test-suite" | "metrics" | "object-view" | "workspace-search"
    )
}

pub(super) fn normalize_workspace_windows(
    snapshot: &WorkspaceSnapshot,
) -> Vec<WorkspaceWindowState> {
    let all_tab_ids = snapshot
        .tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<Vec<_>>();
    let valid_tab_ids = all_tab_ids.iter().cloned().collect::<HashSet<_>>();

    if !snapshot.preferences.multi_window_tabs.enabled {
        return vec![WorkspaceWindowState {
            tab_ids: all_tab_ids,
            active_tab_id: snapshot.ui.active_tab_id.clone(),
            ..WorkspaceWindowState::default()
        }];
    }

    let mut seen_window_ids = HashSet::new();
    let mut seen_tab_ids = HashSet::new();
    let mut windows = Vec::new();

    for existing in &snapshot.ui.workspace_windows {
        let is_main = existing.id == "main";
        if existing.id.trim().is_empty()
            || !seen_window_ids.insert(existing.id.clone())
            || (!is_main && existing.role != "editor")
        {
            continue;
        }

        let mut window = existing.clone();
        window.role = if is_main {
            "main".into()
        } else {
            "editor".into()
        };
        window.bounds = window.bounds.map(normalize_window_bounds);
        window.tab_ids.retain(|tab_id| {
            if !valid_tab_ids.contains(tab_id) || seen_tab_ids.contains(tab_id) {
                return false;
            }
            let Some(tab) = snapshot.tabs.iter().find(|tab| tab.id == *tab_id) else {
                return false;
            };
            if !is_main && !tab_can_detach(tab) {
                return false;
            }
            seen_tab_ids.insert(tab_id.clone())
        });
        if !window.tab_ids.contains(&window.active_tab_id) {
            window.active_tab_id = window.tab_ids.first().cloned().unwrap_or_default();
        }
        if is_main || !window.tab_ids.is_empty() {
            windows.push(window);
        }
    }

    if !windows.iter().any(|window| window.id == "main") {
        windows.insert(0, WorkspaceWindowState::default());
    }

    let unassigned = all_tab_ids
        .into_iter()
        .filter(|tab_id| !seen_tab_ids.contains(tab_id))
        .collect::<Vec<_>>();
    let main = windows
        .iter_mut()
        .find(|window| window.id == "main")
        .expect("main workspace window is present");
    main.tab_ids.extend(unassigned);
    if main.tab_ids.contains(&snapshot.ui.active_tab_id) {
        main.active_tab_id = snapshot.ui.active_tab_id.clone();
    } else if !main.tab_ids.contains(&main.active_tab_id) {
        main.active_tab_id = main.tab_ids.first().cloned().unwrap_or_default();
    }

    windows
}

fn normalize_window_bounds(bounds: WorkspaceWindowBounds) -> WorkspaceWindowBounds {
    WorkspaceWindowBounds {
        width: bounds.width.clamp(720, 7680),
        height: bounds.height.clamp(480, 4320),
        ..bounds
    }
}

pub(super) fn normalize_ui_state(snapshot: &WorkspaceSnapshot) -> UiState {
    let workspace_windows = normalize_workspace_windows(snapshot);
    let active_tab = snapshot
        .tabs
        .iter()
        .find(|item| item.id == snapshot.ui.active_tab_id)
        .cloned()
        .or_else(|| snapshot.tabs.first().cloned());
    let active_connection = snapshot
        .connections
        .iter()
        .find(|item| item.id == snapshot.ui.active_connection_id)
        .cloned()
        .or_else(|| {
            active_tab
                .as_ref()
                .and_then(|tab| {
                    snapshot
                        .connections
                        .iter()
                        .find(|item| item.id == tab.connection_id)
                })
                .cloned()
        })
        .or_else(|| snapshot.connections.first().cloned());
    let active_environment = snapshot
        .environments
        .iter()
        .find(|item| item.id == snapshot.ui.active_environment_id)
        .cloned()
        .or_else(|| {
            active_tab
                .as_ref()
                .and_then(|tab| {
                    snapshot
                        .environments
                        .iter()
                        .find(|item| item.id == tab.environment_id)
                })
                .cloned()
        })
        .or_else(|| snapshot.environments.first().cloned());
    let active_activity = if matches!(
        snapshot.ui.active_activity.as_str(),
        "connections" | "environments" | "tests" | "saved-work" | "search"
    ) {
        "library".into()
    } else if is_activity(&snapshot.ui.active_activity) {
        snapshot.ui.active_activity.clone()
    } else {
        "library".into()
    };
    let active_sidebar_pane = if matches!(
        snapshot.ui.active_sidebar_pane.as_str(),
        "connections" | "environments" | "tests" | "saved-work" | "search"
    ) {
        "library".into()
    } else if is_sidebar_pane(&snapshot.ui.active_sidebar_pane) {
        snapshot.ui.active_sidebar_pane.clone()
    } else if active_activity == "settings" {
        "library".into()
    } else {
        active_activity.clone()
    };
    let has_active_tab = active_tab.is_some();
    let active_bottom_panel_tab = if is_bottom_panel_tab(&snapshot.ui.active_bottom_panel_tab) {
        snapshot.ui.active_bottom_panel_tab.clone()
    } else {
        "results".into()
    };

    UiState {
        active_connection_id: active_connection.map(|item| item.id).unwrap_or_default(),
        active_environment_id: active_environment.map(|item| item.id).unwrap_or_default(),
        active_tab_id: active_tab.map(|item| item.id).unwrap_or_default(),
        explorer_filter: snapshot.ui.explorer_filter.clone(),
        explorer_view: if is_explorer_view(&snapshot.ui.explorer_view) {
            snapshot.ui.explorer_view.clone()
        } else {
            "structure".into()
        },
        connection_group_mode: if is_connection_group_mode(&snapshot.ui.connection_group_mode) {
            snapshot.ui.connection_group_mode.clone()
        } else {
            "none".into()
        },
        sidebar_section_states: snapshot.ui.sidebar_section_states.clone(),
        active_activity,
        sidebar_collapsed: snapshot.ui.sidebar_collapsed,
        active_sidebar_pane,
        sidebar_width: clamp_sidebar_width(snapshot.ui.sidebar_width),
        bottom_panel_visible: snapshot.ui.bottom_panel_visible
            && (has_active_tab || active_bottom_panel_tab == "messages"),
        active_bottom_panel_tab,
        bottom_panel_height: clamp_bottom_panel_height(snapshot.ui.bottom_panel_height),
        results_dock: if is_results_dock(&snapshot.ui.results_dock) {
            snapshot.ui.results_dock.clone()
        } else {
            "bottom".into()
        },
        results_side_width: clamp_results_side_width(snapshot.ui.results_side_width),
        mongo_script_guide_visible: snapshot.ui.mongo_script_guide_visible,
        mongo_script_guide_width: clamp_mongo_script_guide_width(
            snapshot.ui.mongo_script_guide_width,
        ),
        right_drawer: if snapshot.ui.right_drawer == "inspection"
            || snapshot.ui.right_drawer == "diagnostics"
        {
            "none".into()
        } else if is_right_drawer(&snapshot.ui.right_drawer) {
            snapshot.ui.right_drawer.clone()
        } else {
            "none".into()
        },
        right_drawer_width: clamp_right_drawer_width(snapshot.ui.right_drawer_width),
        workspace_windows,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/ui_tests.rs"]
mod tests;
