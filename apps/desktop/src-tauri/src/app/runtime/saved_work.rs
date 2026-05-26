use super::query_tabs::{
    editor_label_for_connection, language_for_connection, upsert_saved_work_item,
};
use super::{generate_id, timestamp_now, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, QuerySaveTarget, QueryTabState, SaveQueryTabToLibraryRequest,
        SavedWorkItem,
    },
};

impl ManagedAppState {
    pub fn save_query_tab(
        &mut self,
        tab_id: &str,
        mut item: SavedWorkItem,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;

        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;

        if item.id.trim().is_empty() {
            item.id = generate_id("saved");
        }

        if item.name.trim().is_empty() {
            item.name = self.snapshot.tabs[tab_index].title.clone();
        }

        item.updated_at = timestamp_now();
        let request = SaveQueryTabToLibraryRequest {
            tab_id: tab_id.into(),
            item_id: Some(item.id.clone()),
            folder_id: None,
            name: item.name.clone(),
            kind: Some(item.kind.clone()),
            environment_id: item.environment_id.clone(),
            tags: item.tags.clone(),
        };
        upsert_saved_work_item(&mut self.snapshot.saved_work, item);
        self.save_query_tab_to_library(request)
    }

    pub fn upsert_saved_work(
        &mut self,
        mut item: SavedWorkItem,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        item.updated_at = timestamp_now();
        let saved_work_id = item.id.clone();
        let saved_query_name = item.name.clone();
        let saved_query_text = item.query_text.clone();

        upsert_saved_work_item(&mut self.snapshot.saved_work, item);
        super::library::ensure_library_nodes(&mut self.snapshot);

        for tab in &mut self.snapshot.tabs {
            if tab.saved_query_id.as_deref() == Some(saved_work_id.as_str()) {
                if let Some(query_text) = &saved_query_text {
                    tab.query_text = query_text.clone();
                }
                tab.title = saved_query_name.clone();
                tab.dirty = false;
            }
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn delete_saved_work(
        &mut self,
        saved_work_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        self.snapshot
            .saved_work
            .retain(|item| item.id != saved_work_id);
        self.snapshot
            .library_nodes
            .retain(|item| item.id != saved_work_id);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn open_saved_work(
        &mut self,
        saved_work_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let item = self
            .snapshot
            .saved_work
            .iter()
            .find(|saved| saved.id == saved_work_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new("saved-work-missing", "Library item was not found.")
            })?;
        if self
            .snapshot
            .library_nodes
            .iter()
            .any(|node| node.id == saved_work_id)
        {
            return self.open_library_item(saved_work_id);
        }
        let query_text = item.query_text.clone().ok_or_else(|| {
            CommandError::new(
                "saved-work-not-openable",
                "Library item does not contain query text.",
            )
        })?;
        let connection_id = item
            .connection_id
            .clone()
            .unwrap_or_else(|| self.snapshot.ui.active_connection_id.clone());
        let connection = self.connection_by_id(&connection_id)?;
        let environment_id = item
            .environment_id
            .clone()
            .or_else(|| connection.environment_ids.first().cloned())
            .unwrap_or_else(|| self.snapshot.ui.active_environment_id.clone());
        let tab = QueryTabState {
            id: generate_id("tab"),
            title: item.name.clone(),
            tab_kind: Some("query".into()),
            connection_id: connection.id.clone(),
            environment_id,
            family: connection.family.clone(),
            language: item
                .language
                .clone()
                .unwrap_or_else(|| language_for_connection(&connection)),
            pinned: None,
            save_target: Some(QuerySaveTarget {
                kind: "library".into(),
                library_item_id: Some(item.id.clone()),
                path: None,
            }),
            saved_query_id: Some(item.id.clone()),
            editor_label: editor_label_for_connection(&connection),
            query_text,
            query_view_mode: if item.kind == "script" {
                Some("script".into())
            } else {
                Some(super::query_tabs::default_query_view_mode(&connection))
            },
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
        };

        self.snapshot.tabs.push(tab.clone());
        self.snapshot.ui.active_connection_id = tab.connection_id.clone();
        self.snapshot.ui.active_environment_id = tab.environment_id.clone();
        self.snapshot.ui.active_tab_id = tab.id.clone();
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}
