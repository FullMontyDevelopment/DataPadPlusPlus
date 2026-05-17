use std::{collections::HashSet, fs, path::PathBuf};

use super::{generate_id, timestamp_now, ManagedAppState};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, LibraryCreateFolderRequest, LibraryDeleteNodeRequest,
        LibraryMoveNodeRequest, LibraryNode, LibraryRenameNodeRequest,
        LibrarySetEnvironmentRequest, QuerySaveTarget, QueryTabState, SaveQueryTabToLibraryRequest,
        SaveQueryTabToLocalFileRequest, SavedWorkItem, WorkspaceSnapshot,
    },
};

const ROOT_FOLDERS: &[(&str, &str)] = &[
    ("library-root-queries", "Queries"),
    ("library-root-scripts", "Scripts"),
    ("library-root-tests", "Tests"),
    ("library-root-snippets", "Snippets"),
    ("library-root-notes", "Notes"),
];

pub(super) fn ensure_library_nodes(snapshot: &mut WorkspaceSnapshot) {
    let created_at = timestamp_now();
    ensure_default_library_folders(&mut snapshot.library_nodes, &created_at);

    if !snapshot.saved_work.is_empty() {
        migrate_saved_work(
            &mut snapshot.library_nodes,
            &snapshot.saved_work,
            &created_at,
        );
    }

    for tab in &mut snapshot.tabs {
        migrate_tab_save_target(tab);
    }

    for closed_tab in &mut snapshot.closed_tabs {
        migrate_tab_save_target(&mut closed_tab.tab);
    }
}

pub(super) fn library_nodes_are_empty_scaffold(nodes: &[LibraryNode]) -> bool {
    nodes.is_empty()
        || nodes.iter().all(|node| {
            node.kind == "folder"
                && node.parent_id.is_none()
                && node.connection_id.is_none()
                && node.environment_id.is_none()
                && node.query_text.is_none()
                && node.script_text.is_none()
                && ROOT_FOLDERS
                    .iter()
                    .any(|(id, name)| node.id == *id && node.name == *name)
        })
}

fn migrate_tab_save_target(tab: &mut QueryTabState) {
    if tab.save_target.is_none() {
        if let Some(saved_query_id) = tab.saved_query_id.clone() {
            tab.save_target = Some(QuerySaveTarget {
                kind: "library".into(),
                library_item_id: Some(saved_query_id),
                path: None,
            });
        }
    }
}

fn ensure_default_library_folders(nodes: &mut Vec<LibraryNode>, created_at: &str) {
    for (id, name) in ROOT_FOLDERS {
        if nodes.iter().all(|node| node.id != *id) {
            nodes.push(LibraryNode {
                id: (*id).into(),
                kind: "folder".into(),
                parent_id: None,
                name: (*name).into(),
                summary: Some("Workspace library folder.".into()),
                tags: Vec::new(),
                favorite: None,
                created_at: created_at.into(),
                updated_at: created_at.into(),
                last_opened_at: None,
                connection_id: None,
                environment_id: None,
                language: None,
                query_text: None,
                script_text: None,
                test_suite: None,
                snapshot_result_id: None,
            });
        }
    }
}

fn migrate_saved_work(
    nodes: &mut Vec<LibraryNode>,
    saved_work: &[SavedWorkItem],
    created_at: &str,
) {
    for item in saved_work {
        if nodes.iter().any(|node| node.id == item.id) {
            continue;
        }

        let parent_id = ensure_legacy_folder(nodes, item.folder.as_deref(), created_at);
        nodes.push(LibraryNode {
            id: item.id.clone(),
            kind: if item.kind.is_empty() {
                "query".into()
            } else {
                item.kind.clone()
            },
            parent_id: Some(parent_id),
            name: item.name.clone(),
            summary: Some(item.summary.clone()),
            tags: item.tags.clone(),
            favorite: item.favorite,
            created_at: item.updated_at.clone(),
            updated_at: item.updated_at.clone(),
            last_opened_at: None,
            connection_id: item.connection_id.clone(),
            environment_id: item.environment_id.clone(),
            language: item.language.clone(),
            query_text: item.query_text.clone(),
            script_text: None,
            test_suite: None,
            snapshot_result_id: item.snapshot_result_id.clone(),
        });
    }
}

fn ensure_legacy_folder(
    nodes: &mut Vec<LibraryNode>,
    folder: Option<&str>,
    created_at: &str,
) -> String {
    let raw = folder.unwrap_or("Queries").trim();
    let normalized = if raw.is_empty() || raw.eq_ignore_ascii_case("Saved Queries") {
        "Queries"
    } else {
        raw
    };
    let segments: Vec<String> = normalized
        .split(['/', '\\'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    let segments = if segments.is_empty() {
        vec!["Queries".into()]
    } else {
        segments
    };

    let mut parent_id: Option<String> = None;
    let mut path = Vec::new();

    for segment in segments {
        path.push(segment.clone());
        if let Some(existing) = nodes.iter().find(|node| {
            node.kind == "folder" && node.parent_id == parent_id && node.name == segment
        }) {
            parent_id = Some(existing.id.clone());
            continue;
        }

        let id = library_folder_id(&path);
        nodes.push(LibraryNode {
            id: id.clone(),
            kind: "folder".into(),
            parent_id: parent_id.clone(),
            name: segment,
            summary: Some("Migrated Library folder.".into()),
            tags: Vec::new(),
            favorite: None,
            created_at: created_at.into(),
            updated_at: created_at.into(),
            last_opened_at: None,
            connection_id: None,
            environment_id: None,
            language: None,
            query_text: None,
            script_text: None,
            test_suite: None,
            snapshot_result_id: None,
        });
        parent_id = Some(id);
    }

    parent_id.unwrap_or_else(|| "library-root-queries".into())
}

fn library_folder_id(path: &[String]) -> String {
    let slug = path
        .join("-")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    format!("library-folder-{slug}")
}

fn folder_or_error(
    snapshot: &WorkspaceSnapshot,
    folder_id: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(folder_id) = folder_id {
        let folder = snapshot
            .library_nodes
            .iter()
            .find(|node| node.id == folder_id)
            .ok_or_else(|| {
                CommandError::new("library-folder-missing", "Library folder was not found.")
            })?;

        if folder.kind != "folder" {
            return Err(CommandError::new(
                "library-parent-not-folder",
                "Library items can only be placed inside folders.",
            ));
        }
    }

    Ok(())
}

fn collect_descendants(snapshot: &WorkspaceSnapshot, node_id: &str) -> HashSet<String> {
    let mut deleted = HashSet::from([node_id.to_string()]);
    let mut changed = true;

    while changed {
        changed = false;
        for node in &snapshot.library_nodes {
            if node
                .parent_id
                .as_ref()
                .is_some_and(|parent_id| deleted.contains(parent_id))
                && deleted.insert(node.id.clone())
            {
                changed = true;
            }
        }
    }

    deleted
}

fn unlink_deleted_library_items(snapshot: &mut WorkspaceSnapshot, deleted_ids: &HashSet<String>) {
    for tab in &mut snapshot.tabs {
        if tab
            .save_target
            .as_ref()
            .and_then(|target| target.library_item_id.as_ref())
            .is_some_and(|library_item_id| deleted_ids.contains(library_item_id))
        {
            tab.save_target = None;
            tab.saved_query_id = None;
            tab.dirty = true;
        }
    }

    for tab in &mut snapshot.closed_tabs {
        if tab
            .tab
            .save_target
            .as_ref()
            .and_then(|target| target.library_item_id.as_ref())
            .is_some_and(|library_item_id| deleted_ids.contains(library_item_id))
        {
            tab.tab.save_target = None;
            tab.tab.saved_query_id = None;
        }
    }
}

impl ManagedAppState {
    pub fn create_library_folder(
        &mut self,
        request: LibraryCreateFolderRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let name = request.name.trim();
        if name.is_empty() {
            return Err(CommandError::new(
                "library-folder-name-required",
                "Enter a folder name before creating a Library folder.",
            ));
        }
        folder_or_error(&self.snapshot, request.parent_id.as_deref())?;

        let created_at = timestamp_now();
        self.snapshot.library_nodes.push(LibraryNode {
            id: generate_id("library-folder"),
            kind: "folder".into(),
            parent_id: request.parent_id,
            name: name.into(),
            summary: None,
            tags: Vec::new(),
            favorite: None,
            created_at: created_at.clone(),
            updated_at: created_at,
            last_opened_at: None,
            connection_id: None,
            environment_id: request.environment_id,
            language: None,
            query_text: None,
            script_text: None,
            test_suite: None,
            snapshot_result_id: None,
        });

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn rename_library_node(
        &mut self,
        request: LibraryRenameNodeRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let name = request.name.trim();
        if name.is_empty() {
            return Err(CommandError::new(
                "library-node-name-required",
                "Enter a Library item name before renaming it.",
            ));
        }

        let node = self
            .snapshot
            .library_nodes
            .iter_mut()
            .find(|node| node.id == request.node_id)
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        node.name = name.into();
        node.updated_at = timestamp_now();

        for tab in &mut self.snapshot.tabs {
            if tab
                .save_target
                .as_ref()
                .and_then(|target| target.library_item_id.as_ref())
                == Some(&request.node_id)
            {
                tab.title = node.name.clone();
            }
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn move_library_node(
        &mut self,
        request: LibraryMoveNodeRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        folder_or_error(&self.snapshot, request.parent_id.as_deref())?;
        let deleted = collect_descendants(&self.snapshot, &request.node_id);
        if request
            .parent_id
            .as_ref()
            .is_some_and(|parent_id| deleted.contains(parent_id))
        {
            return Err(CommandError::new(
                "library-move-cycle",
                "A Library folder cannot be moved inside itself.",
            ));
        }

        let node = self
            .snapshot
            .library_nodes
            .iter_mut()
            .find(|node| node.id == request.node_id)
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        node.parent_id = request.parent_id;
        node.updated_at = timestamp_now();

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn set_library_node_environment(
        &mut self,
        request: LibrarySetEnvironmentRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        if let Some(environment_id) = request.environment_id.as_deref() {
            if self
                .snapshot
                .environments
                .iter()
                .all(|environment| environment.id != environment_id)
            {
                return Err(CommandError::new(
                    "library-environment-missing",
                    "Environment was not found.",
                ));
            }
        }

        let node = self
            .snapshot
            .library_nodes
            .iter_mut()
            .find(|node| node.id == request.node_id)
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        node.environment_id = request
            .environment_id
            .filter(|environment_id| !environment_id.trim().is_empty());
        node.updated_at = timestamp_now();

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn delete_library_node(
        &mut self,
        request: LibraryDeleteNodeRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        if self
            .snapshot
            .library_nodes
            .iter()
            .all(|node| node.id != request.node_id)
        {
            return Err(CommandError::new(
                "library-node-missing",
                "Library item was not found.",
            ));
        }

        let deleted = collect_descendants(&self.snapshot, &request.node_id);
        self.snapshot
            .library_nodes
            .retain(|node| !deleted.contains(&node.id));
        unlink_deleted_library_items(&mut self.snapshot, &deleted);

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn save_query_tab_to_library(
        &mut self,
        request: SaveQueryTabToLibraryRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        folder_or_error(&self.snapshot, request.folder_id.as_deref())?;

        let name = request.name.trim();
        if name.is_empty() {
            return Err(CommandError::new(
                "library-item-name-required",
                "Enter a Library item name before saving.",
            ));
        }

        let tab = self.snapshot.tabs[tab_index].clone();
        let item_id = request
            .item_id
            .or_else(|| {
                tab.save_target
                    .as_ref()
                    .filter(|target| target.kind == "library")
                    .and_then(|target| target.library_item_id.clone())
            })
            .or(tab.saved_query_id.clone())
            .unwrap_or_else(|| generate_id("library-item"));
        let now = timestamp_now();
        let kind = request.kind.unwrap_or_else(|| "query".into());
        let folder_id = request
            .folder_id
            .unwrap_or_else(|| "library-root-queries".into());
        let connection = self.connection_by_id(&tab.connection_id)?;
        let query_text = if matches!(kind.as_str(), "script" | "test-suite") {
            None
        } else {
            Some(tab.query_text.clone())
        };
        let script_text = if kind == "script" {
            Some(tab.query_text.clone())
        } else {
            None
        };
        let node = LibraryNode {
            id: item_id.clone(),
            kind,
            parent_id: Some(folder_id),
            name: name.into(),
            summary: Some(connection.name.clone()),
            tags: request.tags,
            favorite: None,
            created_at: now.clone(),
            updated_at: now,
            last_opened_at: None,
            connection_id: Some(tab.connection_id.clone()),
            environment_id: request.environment_id,
            language: Some(tab.language.clone()),
            query_text,
            script_text,
            test_suite: tab.test_suite.clone(),
            snapshot_result_id: None,
        };

        if let Some(index) = self
            .snapshot
            .library_nodes
            .iter()
            .position(|existing| existing.id == item_id)
        {
            let created_at = self.snapshot.library_nodes[index].created_at.clone();
            self.snapshot.library_nodes[index] = LibraryNode { created_at, ..node };
        } else {
            self.snapshot.library_nodes.push(node);
        }

        let tab = &mut self.snapshot.tabs[tab_index];
        tab.save_target = Some(QuerySaveTarget {
            kind: "library".into(),
            library_item_id: Some(item_id.clone()),
            path: None,
        });
        tab.saved_query_id = Some(item_id);
        tab.title = name.into();
        tab.dirty = false;
        tab.result = None;
        tab.error = None;
        tab.status = "idle".into();

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn save_query_tab_to_local_file(
        &mut self,
        request: SaveQueryTabToLocalFileRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let path = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    "local-save-path-required",
                    "Choose a file path before saving.",
                )
            })?;
        let path = PathBuf::from(path);
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, &tab.query_text)?;

        tab.save_target = Some(QuerySaveTarget {
            kind: "local-file".into(),
            library_item_id: None,
            path: Some(path.to_string_lossy().to_string()),
        });
        tab.saved_query_id = None;
        if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
            tab.title = file_name.into();
        }
        tab.dirty = false;
        tab.result = None;
        tab.error = None;
        tab.status = "idle".into();

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn open_library_item(
        &mut self,
        library_item_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let item_index = self
            .snapshot
            .library_nodes
            .iter()
            .position(|node| node.id == library_item_id)
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        let item = self.snapshot.library_nodes[item_index].clone();
        if item.kind == "folder" {
            return Err(CommandError::new(
                "library-folder-not-openable",
                "Choose a Library query or script to open.",
            ));
        }
        let query_text = item
            .query_text
            .clone()
            .or(item.script_text.clone())
            .or_else(|| {
                item.test_suite
                    .as_ref()
                    .and_then(|suite| serde_json::to_string_pretty(suite).ok())
            })
            .ok_or_else(|| {
                CommandError::new(
                    "library-item-not-openable",
                    "Library item has no query text or test suite definition.",
                )
            })?;
        let opened_at = timestamp_now();
        self.snapshot.library_nodes[item_index].last_opened_at = Some(opened_at.clone());

        if let Some(existing_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| library_item_matches_tab(tab, &item.id))
            .cloned()
        {
            self.snapshot.ui.active_connection_id = existing_tab.connection_id;
            self.snapshot.ui.active_environment_id = existing_tab.environment_id;
            self.snapshot.ui.active_tab_id = existing_tab.id;
            self.snapshot.updated_at = opened_at;
            self.persist()?;
            return Ok(self.bootstrap_payload());
        }
        let connection_id = item
            .connection_id
            .clone()
            .unwrap_or_else(|| self.snapshot.ui.active_connection_id.clone());
        let connection = self.connection_by_id(&connection_id)?;
        let environment_id = self
            .effective_library_environment_id(&item.id)
            .or_else(|| connection.environment_ids.first().cloned())
            .unwrap_or_else(|| self.snapshot.ui.active_environment_id.clone());

        let tab = QueryTabState {
            id: generate_id("tab"),
            title: item.name.clone(),
            tab_kind: Some(if item.kind == "test-suite" {
                "test-suite".into()
            } else {
                "query".into()
            }),
            connection_id: connection.id.clone(),
            environment_id,
            family: connection.family.clone(),
            language: item
                .language
                .clone()
                .unwrap_or_else(|| super::query_tabs::language_for_connection(&connection)),
            pinned: None,
            save_target: Some(QuerySaveTarget {
                kind: "library".into(),
                library_item_id: Some(item.id.clone()),
                path: None,
            }),
            saved_query_id: Some(item.id.clone()),
            editor_label: super::query_tabs::editor_label_for_connection(&connection),
            query_text,
            scoped_target: None,
            builder_state: None,
            metrics_state: None,
            test_suite: item.test_suite.clone(),
            test_run: None,
            status: "idle".into(),
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
        self.snapshot.updated_at = opened_at;
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    fn effective_library_environment_id(&self, node_id: &str) -> Option<String> {
        effective_library_environment_id_for_nodes(&self.snapshot.library_nodes, node_id)
    }
}

fn effective_library_environment_id_for_nodes(
    nodes: &[LibraryNode],
    node_id: &str,
) -> Option<String> {
    let mut current_id = Some(node_id.to_string());
    let mut visited = HashSet::new();

    while let Some(id) = current_id {
        if !visited.insert(id.clone()) {
            break;
        }

        let node = nodes.iter().find(|node| node.id == id)?;
        if let Some(environment_id) = &node.environment_id {
            return Some(environment_id.clone());
        }
        current_id = node.parent_id.clone();
    }

    None
}

fn library_item_matches_tab(tab: &QueryTabState, library_item_id: &str) -> bool {
    tab.save_target
        .as_ref()
        .filter(|target| target.kind == "library")
        .and_then(|target| target.library_item_id.as_deref())
        .is_some_and(|tab_library_item_id| tab_library_item_id == library_item_id)
        || tab
            .saved_query_id
            .as_deref()
            .is_some_and(|saved_query_id| saved_query_id == library_item_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_library_environment_uses_closest_parent_assignment() {
        let nodes = vec![
            test_node("top", None, Some("env-a")),
            test_node("child", Some("top"), Some("env-b")),
            test_node("query", Some("child"), None),
            test_node("direct-query", Some("child"), Some("env-c")),
        ];

        assert_eq!(
            effective_library_environment_id_for_nodes(&nodes, "query").as_deref(),
            Some("env-b")
        );
        assert_eq!(
            effective_library_environment_id_for_nodes(&nodes, "direct-query").as_deref(),
            Some("env-c")
        );
    }

    #[test]
    fn effective_library_environment_stops_on_parent_cycles() {
        let nodes = vec![
            test_node("first", Some("second"), None),
            test_node("second", Some("first"), None),
        ];

        assert_eq!(
            effective_library_environment_id_for_nodes(&nodes, "first"),
            None
        );
    }

    fn test_node(id: &str, parent_id: Option<&str>, environment_id: Option<&str>) -> LibraryNode {
        LibraryNode {
            id: id.into(),
            kind: if id.contains("query") {
                "query".into()
            } else {
                "folder".into()
            },
            parent_id: parent_id.map(str::to_string),
            name: id.into(),
            summary: None,
            tags: Vec::new(),
            favorite: None,
            created_at: "2026-05-15T00:00:00.000Z".into(),
            updated_at: "2026-05-15T00:00:00.000Z".into(),
            last_opened_at: None,
            connection_id: None,
            environment_id: environment_id.map(str::to_string),
            language: None,
            query_text: None,
            script_text: None,
            test_suite: None,
            snapshot_result_id: None,
        }
    }
}
