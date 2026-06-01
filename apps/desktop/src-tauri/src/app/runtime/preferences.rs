use super::{timestamp_now, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{BootstrapPayload, UpdateUiStateRequest},
};

use super::ui::{
    clamp_bottom_panel_height, clamp_results_side_width, clamp_right_drawer_width,
    clamp_sidebar_width, is_activity, is_bottom_panel_tab, is_connection_group_mode,
    is_explorer_view, is_results_dock, is_right_drawer, is_sidebar_pane,
};

impl ManagedAppState {
    pub fn set_theme(&mut self, theme: &str) -> Result<BootstrapPayload, CommandError> {
        self.snapshot.preferences.theme = theme.into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn set_safe_mode_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<BootstrapPayload, CommandError> {
        self.snapshot.preferences.safe_mode_enabled = enabled;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn set_ui_state(
        &mut self,
        patch: UpdateUiStateRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        if let Some(active_environment_id) = patch.active_environment_id {
            if active_environment_id.is_empty()
                || self
                    .snapshot
                    .environments
                    .iter()
                    .any(|item| item.id == active_environment_id)
            {
                self.snapshot.ui.active_environment_id = active_environment_id;
            }
        }

        if let Some(active_activity) = patch.active_activity.filter(|value| is_activity(value)) {
            self.snapshot.ui.active_activity = normalize_primary_sidebar_value(active_activity);
        }

        if let Some(sidebar_collapsed) = patch.sidebar_collapsed {
            self.snapshot.ui.sidebar_collapsed = sidebar_collapsed;
        }

        if let Some(active_sidebar_pane) = patch
            .active_sidebar_pane
            .filter(|value| is_sidebar_pane(value))
        {
            self.snapshot.ui.active_sidebar_pane =
                normalize_primary_sidebar_value(active_sidebar_pane);
        }

        if let Some(sidebar_width) = patch.sidebar_width {
            self.snapshot.ui.sidebar_width = clamp_sidebar_width(sidebar_width);
        }

        if let Some(explorer_filter) = patch.explorer_filter {
            self.snapshot.ui.explorer_filter = explorer_filter;
        }

        if let Some(explorer_view) = patch.explorer_view.filter(|value| is_explorer_view(value)) {
            self.snapshot.ui.explorer_view = explorer_view;
        }

        if let Some(connection_group_mode) = patch
            .connection_group_mode
            .filter(|value| is_connection_group_mode(value))
        {
            self.snapshot.ui.connection_group_mode = connection_group_mode;
        }

        if let Some(sidebar_section_states) = patch.sidebar_section_states {
            self.snapshot.ui.sidebar_section_states = sidebar_section_states;
        }

        if let Some(bottom_panel_visible) = patch.bottom_panel_visible {
            self.snapshot.ui.bottom_panel_visible = bottom_panel_visible;
        }

        if let Some(active_bottom_panel_tab) = patch
            .active_bottom_panel_tab
            .filter(|value| is_bottom_panel_tab(value))
        {
            self.snapshot.ui.active_bottom_panel_tab = active_bottom_panel_tab;
        }

        if let Some(bottom_panel_height) = patch.bottom_panel_height {
            self.snapshot.ui.bottom_panel_height = clamp_bottom_panel_height(bottom_panel_height);
        }

        if let Some(results_dock) = patch.results_dock.filter(|value| is_results_dock(value)) {
            self.snapshot.ui.results_dock = results_dock;
        }

        if let Some(results_side_width) = patch.results_side_width {
            self.snapshot.ui.results_side_width = clamp_results_side_width(results_side_width);
        }

        if let Some(right_drawer) = patch.right_drawer.filter(|value| is_right_drawer(value)) {
            self.snapshot.ui.right_drawer = right_drawer;
        }

        if let Some(right_drawer_width) = patch.right_drawer_width {
            self.snapshot.ui.right_drawer_width = clamp_right_drawer_width(right_drawer_width);
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn set_locked(&mut self, is_locked: bool) -> Result<BootstrapPayload, CommandError> {
        self.snapshot.lock_state.is_locked = is_locked;
        self.snapshot.lock_state.locked_at = if is_locked {
            Some(timestamp_now())
        } else {
            None
        };
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

fn normalize_primary_sidebar_value(value: String) -> String {
    if matches!(
        value.as_str(),
        "connections" | "environments" | "tests" | "saved-work" | "search"
    ) {
        "library".into()
    } else {
        value
    }
}
