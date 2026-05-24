use serde_json::json;

use super::{
    response_redaction::{
        redact_adapter_diagnostics_for_environment, redact_explorer_inspection_for_environment,
    },
    timestamp_now,
    validators::validate_required_tab_id,
    ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{ExplorerInspectRequest, UserFacingError},
    },
};

impl ManagedAppState {
    pub async fn refresh_metrics_tab(
        &mut self,
        tab_id: &str,
    ) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Metrics tab was not found."))?;
        let tab = self.snapshot.tabs[tab_index].clone();

        if tab.tab_kind.as_deref() != Some("metrics") {
            return Err(CommandError::new(
                "tab-kind-invalid",
                "Only Metrics tabs can refresh connection metrics.",
            ));
        }

        let profile = self.connection_by_id(&tab.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &tab.environment_id)?;
        let refreshed_at = timestamp_now();
        let diagnostics_result = adapters::collect_diagnostics(&resolved, Some("connection")).await;

        {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.last_run_at = Some(refreshed_at.clone());
            tab.dirty = false;
            tab.result = None;
            match diagnostics_result {
                Ok(diagnostics) => {
                    let diagnostics = redact_adapter_diagnostics_for_environment(
                        diagnostics,
                        &resolved_environment,
                    );
                    let warnings = diagnostics.warnings.clone();
                    tab.status = "success".into();
                    tab.error = None;
                    tab.metrics_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "lastRefreshedAt": refreshed_at,
                        "diagnostics": diagnostics,
                        "warnings": warnings,
                    }));
                }
                Err(error) => {
                    tab.status = "error".into();
                    tab.error = Some(UserFacingError {
                        code: error.code.clone(),
                        message: error.message.clone(),
                    });
                    tab.metrics_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "lastRefreshedAt": refreshed_at,
                        "warnings": [error.message],
                    }));
                }
            }
        }

        self.snapshot.ui.active_tab_id = tab_id.into();
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub async fn refresh_object_view_tab(
        &mut self,
        tab_id: &str,
    ) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
        validate_required_tab_id(tab_id)?;
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|item| item.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Object view tab was not found."))?;
        let tab = self.snapshot.tabs[tab_index].clone();

        if tab.tab_kind.as_deref() != Some("object-view") {
            return Err(CommandError::new(
                "tab-kind-invalid",
                "Only object-view tabs can refresh object metadata.",
            ));
        }

        let object_view_state = tab.object_view_state.clone().ok_or_else(|| {
            CommandError::new(
                "object-view-state-missing",
                "Object view tab is missing its target metadata.",
            )
        })?;
        let node_id = object_view_state
            .get("nodeId")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                CommandError::new(
                    "object-view-node-missing",
                    "Object view tab is missing its target node id.",
                )
            })?
            .to_string();
        let label = object_view_state
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("Object")
            .to_string();
        let kind = object_view_state
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("object")
            .to_string();
        let path = object_view_state.get("path").cloned();
        let profile = self.connection_by_id(&tab.connection_id)?;
        let (resolved, resolved_environment, _) =
            self.resolve_connection_profile(&profile, &tab.environment_id)?;
        let refreshed_at = timestamp_now();
        let inspect_result = adapters::inspect_explorer_node(
            &resolved,
            &ExplorerInspectRequest {
                connection_id: tab.connection_id.clone(),
                environment_id: tab.environment_id.clone(),
                node_id: node_id.clone(),
            },
        )
        .await;

        {
            let tab = &mut self.snapshot.tabs[tab_index];
            tab.last_run_at = Some(refreshed_at.clone());
            tab.dirty = false;
            tab.result = None;
            match inspect_result {
                Ok(inspection) => {
                    let inspection = redact_explorer_inspection_for_environment(
                        inspection,
                        &resolved_environment,
                    );
                    tab.status = "success".into();
                    tab.error = None;
                    tab.object_view_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "nodeId": node_id,
                        "label": label,
                        "kind": kind,
                        "path": path,
                        "summary": inspection.summary,
                        "queryTemplate": inspection.query_template,
                        "payload": inspection.payload,
                        "lastRefreshedAt": refreshed_at,
                        "warnings": []
                    }));
                }
                Err(error) => {
                    tab.status = "error".into();
                    tab.error = Some(UserFacingError {
                        code: error.code.clone(),
                        message: error.message.clone(),
                    });
                    tab.object_view_state = Some(json!({
                        "connectionId": tab.connection_id.clone(),
                        "environmentId": tab.environment_id.clone(),
                        "nodeId": node_id,
                        "label": label,
                        "kind": kind,
                        "path": path,
                        "lastRefreshedAt": refreshed_at,
                        "warnings": [error.message]
                    }));
                }
            }
        }

        self.snapshot.ui.active_tab_id = tab_id.into();
        self.snapshot.ui.active_connection_id = tab.connection_id;
        self.snapshot.ui.active_environment_id = tab.environment_id;
        self.snapshot.ui.right_drawer = "none".into();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}
