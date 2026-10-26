use super::{query_compiler, timestamp_now, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, ConnectionProfile, NewBuilderQueryLimit, QueryTabResultSettingsRequest,
        QueryTabState, WorkspaceSnapshot,
    },
};
use serde_json::json;

pub(super) fn initialize_query_limit(
    tab: &mut QueryTabState,
    connection: &ConnectionProfile,
    policy: &NewBuilderQueryLimit,
) -> Result<(), CommandError> {
    if *policy == NewBuilderQueryLimit::DatastoreDefault {
        return Ok(());
    }
    let result = query_compiler::invoke(
        "initializeQueryLimit",
        &json!({
            "tab":tab, "connection":{"engine":connection.engine,"database":connection.database}, "policy":policy
        }),
    )?;
    *tab = serde_json::from_value(result).map_err(|_| {
        CommandError::new(
            "query-settings-invalid",
            "The new query's default limit could not be prepared.",
        )
    })?;
    Ok(())
}

impl ManagedAppState {
    pub fn set_query_tab_result_settings(
        &mut self,
        window_id: &str,
        request: QueryTabResultSettingsRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let (index, tab) = prepare_query_tab_settings(&self.snapshot, window_id, &request)?;
        let previous = self.snapshot.clone();
        self.snapshot.tabs[index] = tab;
        self.snapshot.updated_at = timestamp_now();
        if let Err(error) = self.persist() {
            self.snapshot = previous;
            return Err(error);
        }
        Ok(self.bootstrap_payload())
    }
}

pub(super) fn prepare_query_tab_settings(
    snapshot: &WorkspaceSnapshot,
    window_id: &str,
    request: &QueryTabResultSettingsRequest,
) -> Result<(usize, QueryTabState), CommandError> {
    if request.expected_revision != snapshot.workspace_revision {
        return Err(CommandError::new(
            "query-settings-stale",
            "The workspace changed. Review the selected query and try again.",
        ));
    }
    if request
        .fetch_batch_size
        .is_some_and(|value| !(1..=5000).contains(&value))
    {
        return Err(CommandError::new(
            "query-settings-invalid",
            "Batch size must be from 1 to 5,000.",
        ));
    }
    if snapshot
        .ui
        .workspace_windows
        .iter()
        .any(|window| window.id != window_id && window.tab_ids.contains(&request.tab_id))
    {
        return Err(CommandError::new(
            "query-settings-other-window",
            "Move this query to this window before changing its advanced settings.",
        ));
    }
    let index = snapshot
        .tabs
        .iter()
        .position(|tab| tab.id == request.tab_id)
        .ok_or_else(|| CommandError::new("tab-missing", "The selected query has been closed."))?;
    let mut tab = snapshot.tabs[index].clone();
    if !matches!(tab.tab_kind.as_deref(), None | Some("query"))
        || tab.active_execution.is_some()
        || matches!(tab.status.as_str(), "running" | "queued")
    {
        return Err(CommandError::new(
            "query-busy",
            "The selected query is unavailable or running. Wait for it to finish.",
        ));
    }
    if request.remove_query_limit {
        let connection = snapshot
            .connections
            .iter()
            .find(|connection| connection.id == tab.connection_id)
            .ok_or_else(|| {
                CommandError::new(
                    "connection-missing",
                    "The selected query's connection is no longer available.",
                )
            })?;
        // Results/history can be large and are irrelevant to compiling a limit change.
        let result = query_compiler::invoke("removeQueryLimit", &json!({"tab":{
            "queryViewMode":tab.query_view_mode,"queryText":tab.query_text,"scriptText":tab.script_text,
            "builderState":tab.builder_state,"scopedTarget":tab.scoped_target,"sqlScope":tab.sql_scope
        },"connection":{"engine":connection.engine,"database":connection.database}}))
                .map_err(|_| CommandError::new("query-limit-unavailable", "The selected query must be a valid builder that supports No limit. Raw queries and native limits are unchanged."))?;
        tab.builder_state = Some(result["builderState"].clone());
        tab.query_text = result["queryText"]
            .as_str()
            .ok_or_else(|| {
                CommandError::new(
                    "query-settings-invalid",
                    "The query limit could not be changed.",
                )
            })?
            .into();
        tab.dirty = true;
    }
    tab.query_fetch_batch_size = request.fetch_batch_size;
    Ok((index, tab))
}
