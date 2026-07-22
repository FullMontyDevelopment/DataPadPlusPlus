use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use super::{
    generate_id,
    library_validation::{
        environment_or_error, library_name_or_error, normalize_library_kind,
        normalize_library_tags, normalize_optional_library_id, validate_library_id,
    },
    timestamp_now, ManagedAppState,
};
use crate::domain::{
    error::CommandError,
    models::{
        BootstrapPayload, LibraryCreateFolderRequest, LibraryDeleteNodeRequest,
        LibraryDuplicateNodeRequest, LibraryMoveNodeRequest, LibraryNode, LibraryRenameNodeRequest,
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
    if !snapshot.saved_work.is_empty() {
        let created_at = timestamp_now();
        migrate_saved_work(
            &mut snapshot.library_nodes,
            &snapshot.saved_work,
            &created_at,
        );
    }

    for tab in &mut snapshot.tabs {
        migrate_tab_save_target(tab);
        normalize_query_view_mode(&mut tab.query_view_mode);
    }

    for closed_tab in &mut snapshot.closed_tabs {
        migrate_tab_save_target(&mut closed_tab.tab);
        normalize_query_view_mode(&mut closed_tab.tab.query_view_mode);
    }

    for node in &mut snapshot.library_nodes {
        normalize_query_view_mode(&mut node.query_view_mode);
        if node.kind == "script" && node.query_view_mode.is_none() {
            node.query_view_mode = Some("script".into());
        }
    }

    ensure_connection_library_nodes(snapshot);
    prune_empty_default_library_roots(&mut snapshot.library_nodes);
}

fn normalize_query_view_mode(query_view_mode: &mut Option<String>) {
    *query_view_mode = match query_view_mode.as_deref() {
        Some("builder" | "raw" | "script") => query_view_mode.clone(),
        Some("both") => Some("builder".into()),
        _ => None,
    };
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
            query_view_mode: None,
            document_efficiency_mode: None,
            scoped_target: None,
            builder_state: None,
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
            query_view_mode: None,
            document_efficiency_mode: None,
            scoped_target: None,
            builder_state: None,
            script_text: None,
            test_suite: None,
            snapshot_result_id: None,
        });
        parent_id = Some(id);
    }

    parent_id.unwrap_or_else(|| "library-root-queries".into())
}

fn prune_empty_default_library_roots(nodes: &mut Vec<LibraryNode>) {
    let parents: HashSet<String> = nodes
        .iter()
        .filter_map(|node| node.parent_id.clone())
        .collect();

    nodes.retain(|node| !is_unmodified_default_library_root(node) || parents.contains(&node.id));
}

fn is_unmodified_default_library_root(node: &LibraryNode) -> bool {
    node.kind == "folder"
        && node.parent_id.is_none()
        && node.connection_id.is_none()
        && node.environment_id.is_none()
        && node.query_text.is_none()
        && node.script_text.is_none()
        && node.test_suite.is_none()
        && node.tags.is_empty()
        && node.favorite.is_none()
        && ROOT_FOLDERS
            .iter()
            .any(|(id, name)| node.id == *id && node.name == *name)
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

pub(super) fn connection_library_node_id(connection_id: &str) -> String {
    format!("library-connection-{connection_id}")
}

pub(super) fn ensure_connection_library_nodes(snapshot: &mut WorkspaceSnapshot) {
    let now = timestamp_now();
    let connections = snapshot.connections.clone();

    for connection in connections {
        if let Some(node) = snapshot.library_nodes.iter_mut().find(|node| {
            node.kind == "connection"
                && node.connection_id.as_deref() == Some(connection.id.as_str())
        }) {
            node.name = connection.name.clone();
            node.summary = Some(format!("{} / connection", connection.engine));
            node.updated_at = now.clone();
            continue;
        }

        snapshot.library_nodes.push(LibraryNode {
            id: connection_library_node_id(&connection.id),
            kind: "connection".into(),
            parent_id: None,
            name: connection.name,
            summary: Some(format!("{} / connection", connection.engine)),
            tags: connection.tags,
            favorite: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: None,
            connection_id: Some(connection.id),
            environment_id: None,
            language: None,
            query_text: None,
            query_view_mode: None,
            document_efficiency_mode: None,
            scoped_target: None,
            builder_state: None,
            script_text: None,
            test_suite: None,
            snapshot_result_id: None,
        });
    }
}

pub(super) fn remove_connection_library_nodes(
    snapshot: &mut WorkspaceSnapshot,
    connection_id: &str,
) {
    snapshot.library_nodes.retain(|node| {
        !(node.kind == "connection" && node.connection_id.as_deref() == Some(connection_id))
    });

    for node in &mut snapshot.library_nodes {
        if node.kind != "connection" && node.connection_id.as_deref() == Some(connection_id) {
            node.connection_id = None;
        }
    }
}

pub(super) fn default_library_folder_for_connection(
    snapshot: &WorkspaceSnapshot,
    connection_id: &str,
) -> Option<String> {
    snapshot
        .library_nodes
        .iter()
        .find(|node| {
            node.kind == "connection" && node.connection_id.as_deref() == Some(connection_id)
        })
        .and_then(|node| node.parent_id.clone())
}

fn library_folder_for_save(
    nodes: &[LibraryNode],
    item_id: &str,
    requested_folder_id: Option<String>,
    default_folder_id: Option<String>,
) -> Option<String> {
    if requested_folder_id.is_some() {
        return requested_folder_id;
    }

    if let Some(existing) = nodes.iter().find(|node| node.id == item_id) {
        return existing.parent_id.clone();
    }

    default_folder_id
}

pub(super) fn effective_connection_environment_id(
    snapshot: &WorkspaceSnapshot,
    connection_id: &str,
    preferred_environment_id: Option<String>,
) -> String {
    if let Some(environment_id) = preferred_environment_id.filter(|environment_id| {
        snapshot
            .environments
            .iter()
            .any(|environment| environment.id == *environment_id)
    }) {
        return environment_id;
    }

    let library_environment_id = snapshot
        .library_nodes
        .iter()
        .find(|node| {
            node.kind == "connection" && node.connection_id.as_deref() == Some(connection_id)
        })
        .and_then(|node| {
            effective_library_environment_id_for_nodes(&snapshot.library_nodes, &node.id)
        });

    library_environment_id
        .or_else(|| {
            snapshot
                .connections
                .iter()
                .find(|connection| connection.id == connection_id)
                .and_then(|connection| connection.environment_ids.first().cloned())
        })
        .or_else(|| {
            if snapshot.ui.active_environment_id.is_empty() {
                None
            } else {
                Some(snapshot.ui.active_environment_id.clone())
            }
        })
        .or_else(|| {
            snapshot
                .environments
                .first()
                .map(|environment| environment.id.clone())
        })
        .unwrap_or_else(|| "env-dev".into())
}

impl ManagedAppState {
    pub fn create_library_folder(
        &mut self,
        request: LibraryCreateFolderRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let name = library_name_or_error(&request.name, "Library folder name")?;
        let parent_id = normalize_optional_library_id(request.parent_id, "Library parent id")?;
        let environment_id =
            normalize_optional_library_id(request.environment_id, "Environment id")?;
        folder_or_error(&self.snapshot, parent_id.as_deref())?;
        environment_or_error(&self.snapshot, environment_id.as_deref())?;

        let created_at = timestamp_now();
        self.snapshot.library_nodes.push(LibraryNode {
            id: generate_id("library-folder"),
            kind: "folder".into(),
            parent_id,
            name: name.into(),
            summary: None,
            tags: Vec::new(),
            favorite: None,
            created_at: created_at.clone(),
            updated_at: created_at,
            last_opened_at: None,
            connection_id: None,
            environment_id,
            language: None,
            query_text: None,
            query_view_mode: None,
            document_efficiency_mode: None,
            scoped_target: None,
            builder_state: None,
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
        validate_library_id(&request.node_id, "Library node id")?;
        let name = library_name_or_error(&request.name, "Library item name")?;

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

    pub fn duplicate_library_node(
        &mut self,
        request: LibraryDuplicateNodeRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        validate_library_id(&request.node_id, "Library node id")?;
        let source = self
            .snapshot
            .library_nodes
            .iter()
            .find(|node| node.id == request.node_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        if !matches!(source.kind.as_str(), "query" | "script") {
            return Err(CommandError::new(
                "library-duplicate-unsupported",
                "Only Library queries and scripts can be duplicated.",
            ));
        }
        let name = next_library_copy_name(&self.snapshot.library_nodes, &source);
        let timestamp = timestamp_now();
        self.snapshot.library_nodes.push(LibraryNode {
            id: generate_id("library-item"),
            name,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            last_opened_at: None,
            snapshot_result_id: None,
            ..source
        });
        self.snapshot.updated_at = timestamp;
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn move_library_node(
        &mut self,
        request: LibraryMoveNodeRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        validate_library_id(&request.node_id, "Library node id")?;
        let parent_id = normalize_optional_library_id(request.parent_id, "Library parent id")?;
        ensure_connection_library_nodes(&mut self.snapshot);
        folder_or_error(&self.snapshot, parent_id.as_deref())?;
        let deleted = collect_descendants(&self.snapshot, &request.node_id);
        if parent_id
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
        node.parent_id = parent_id;
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
        validate_library_id(&request.node_id, "Library node id")?;
        let environment_id =
            normalize_optional_library_id(request.environment_id, "Environment id")?;
        environment_or_error(&self.snapshot, environment_id.as_deref())?;

        let node = self
            .snapshot
            .library_nodes
            .iter_mut()
            .find(|node| node.id == request.node_id)
            .ok_or_else(|| {
                CommandError::new("library-node-missing", "Library item was not found.")
            })?;
        node.environment_id = environment_id;
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
        validate_library_id(&request.node_id, "Library node id")?;
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
        validate_library_id(&request.tab_id, "Tab id")?;
        let item_id = normalize_optional_library_id(request.item_id, "Library item id")?;
        let folder_id = normalize_optional_library_id(request.folder_id, "Library folder id")?;
        let environment_id =
            normalize_optional_library_id(request.environment_id, "Environment id")?;
        let kind = normalize_library_kind(request.kind)?;
        let tags = normalize_library_tags(request.tags)?;
        let tab_index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        folder_or_error(&self.snapshot, folder_id.as_deref())?;
        environment_or_error(&self.snapshot, environment_id.as_deref())?;
        let name = library_name_or_error(&request.name, "Library item name")?;

        let tab = self.snapshot.tabs[tab_index].clone();
        let item_id = item_id
            .or_else(|| {
                tab.save_target
                    .as_ref()
                    .filter(|target| target.kind == "library")
                    .and_then(|target| target.library_item_id.clone())
            })
            .or(tab.saved_query_id.clone())
            .unwrap_or_else(|| generate_id("library-item"));
        let existing_index = self
            .snapshot
            .library_nodes
            .iter()
            .position(|existing| existing.id == item_id);
        let now = timestamp_now();
        let default_folder_id =
            default_library_folder_for_connection(&self.snapshot, &tab.connection_id);
        let folder_id = library_folder_for_save(
            &self.snapshot.library_nodes,
            &item_id,
            folder_id,
            default_folder_id,
        );
        let connection = self.connection_by_id(&tab.connection_id)?;
        let query_text = if matches!(kind.as_str(), "script" | "test-suite") {
            None
        } else {
            Some(tab.query_text.clone())
        };
        let script_text = tab
            .script_text
            .clone()
            .or_else(|| (kind == "script").then(|| tab.query_text.clone()));
        let node = LibraryNode {
            id: item_id.clone(),
            kind,
            parent_id: folder_id,
            name: name.into(),
            summary: Some(connection.name.clone()),
            tags,
            favorite: None,
            created_at: now.clone(),
            updated_at: now,
            last_opened_at: None,
            connection_id: Some(tab.connection_id.clone()),
            environment_id,
            language: Some(tab.language.clone()),
            query_text,
            query_view_mode: tab.query_view_mode.clone().or_else(|| Some("raw".into())),
            document_efficiency_mode: tab.document_efficiency_mode,
            scoped_target: tab.scoped_target.clone(),
            builder_state: tab.builder_state.clone(),
            script_text,
            test_suite: tab.test_suite.clone(),
            snapshot_result_id: None,
        };

        if let Some(index) = existing_index {
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
        validate_local_save_path(&path)?;
        let tab = self
            .snapshot
            .tabs
            .iter_mut()
            .find(|tab| tab.id == request.tab_id)
            .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
        let file_content = local_file_content_for_tab(tab);

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                return Err(CommandError::new(
                    "local-save-folder-missing",
                    "Choose an existing folder before saving a local file.",
                ));
            }
        }
        fs::write(&path, file_content)?;

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
            query_view_mode: item.query_view_mode.clone().or_else(|| {
                if item.kind == "script" {
                    Some("script".into())
                } else {
                    Some(super::query_tabs::default_query_view_mode(&connection))
                }
            }),
            script_text: item.script_text.clone(),
            document_efficiency_mode: item.document_efficiency_mode,
            scoped_target: item.scoped_target.clone(),
            builder_state: item.builder_state.clone(),
            metrics_state: None,
            object_view_state: None,
            test_suite: item.test_suite.clone(),
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
        self.snapshot.updated_at = opened_at;
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    fn effective_library_environment_id(&self, node_id: &str) -> Option<String> {
        effective_library_environment_id_for_nodes(&self.snapshot.library_nodes, node_id)
    }
}

fn next_library_copy_name(nodes: &[LibraryNode], source: &LibraryNode) -> String {
    let base = format!("Copy of {}", source.name);
    let sibling_names = nodes
        .iter()
        .filter(|node| node.parent_id == source.parent_id)
        .map(|node| node.name.as_str())
        .collect::<HashSet<_>>();
    if !sibling_names.contains(base.as_str()) {
        return base;
    }
    for suffix in 2.. {
        let candidate = format!("{base} ({suffix})");
        if !sibling_names.contains(candidate.as_str()) {
            return candidate;
        }
    }
    unreachable!()
}

fn validate_local_save_path(path: &Path) -> Result<(), CommandError> {
    if !path.is_absolute() {
        return Err(CommandError::new(
            "local-save-path-invalid",
            "Local file saves require an absolute file path selected by the save dialog.",
        ));
    }

    if path.file_name().is_none() {
        return Err(CommandError::new(
            "local-save-file-name-required",
            "Choose a file name before saving.",
        ));
    }

    if path.is_dir() {
        return Err(CommandError::new(
            "local-save-target-is-folder",
            "Choose a file name, not a folder, before saving.",
        ));
    }

    if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
        if file_name_contains_unsupported_characters(file_name) {
            return Err(CommandError::new(
                "local-save-file-name-invalid",
                "Local file name contains unsupported characters.",
            ));
        }
    }

    Ok(())
}

fn file_name_contains_unsupported_characters(file_name: &str) -> bool {
    file_name
        .chars()
        .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
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

fn local_file_content_for_tab(tab: &QueryTabState) -> String {
    if tab.tab_kind.as_deref() == Some("test-suite") {
        if let Some(test_suite) = &tab.test_suite {
            return serde_json::to_string_pretty(test_suite)
                .unwrap_or_else(|_| tab.query_text.clone());
        }
    }

    if tab.query_view_mode.as_deref() == Some("script") {
        return tab
            .script_text
            .clone()
            .filter(|script_text| !script_text.trim().is_empty())
            .unwrap_or_else(|| tab.query_text.clone());
    }

    tab.query_text.clone()
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/library_tests.rs"]
mod tests;
