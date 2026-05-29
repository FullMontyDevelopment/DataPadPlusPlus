use crate::domain::models::{QueryTabState, UiState, WorkspaceSnapshot};

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

pub(super) fn focus_query_tab(ui: &mut UiState, tab: &QueryTabState) {
    ui.active_connection_id = tab.connection_id.clone();
    ui.active_environment_id = tab.environment_id.clone();
    ui.active_tab_id = tab.id.clone();
    ui.right_drawer = "none".into();
}

pub(super) fn normalize_ui_state(snapshot: &WorkspaceSnapshot) -> UiState {
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
    }
}

#[cfg(test)]
mod tests {
    use super::{is_activity, is_sidebar_pane};

    #[test]
    fn legacy_tests_activity_and_sidebar_pane_are_valid() {
        assert!(is_activity("tests"));
        assert!(is_sidebar_pane("tests"));
    }
}
