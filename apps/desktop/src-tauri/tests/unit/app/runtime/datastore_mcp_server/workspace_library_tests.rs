use super::*;

#[test]
fn mcp_library_persistence_failure_keeps_the_entire_original_snapshot() {
    let mut current = snapshot();
    let original = serde_json::to_value(&current).unwrap();
    let candidate = prepare_update(
        &current,
        &edit(&current, json!({"queryText":"select 99"})),
        false,
    )
    .unwrap();
    let result = persist_then_publish(&mut current, candidate, |pending| {
        pending.workspace_revision += 1;
        Err(library_failure(
            "workspace-save-blocked",
            "Synthetic durable-write failure.",
        ))
    });
    assert_eq!(result.unwrap_err().code, "workspace-save-blocked");
    assert_eq!(serde_json::to_value(&current).unwrap(), original);
    let candidate = prepare_update(
        &current,
        &edit(&current, json!({"queryText":"select 99"})),
        false,
    )
    .unwrap();
    persist_then_publish(&mut current, candidate, |pending| {
        pending.workspace_revision += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(
        current.library_nodes[0].query_text.as_deref(),
        Some("select 99")
    );
}

#[test]
fn mcp_library_folder_context_is_ordered_and_handles_corrupt_cycles() {
    let mut snapshot = snapshot();
    snapshot.library_nodes[0].parent_id = Some("folder".into());
    snapshot.library_nodes.push(LibraryNode {
        id: "folder".into(),
        name: "Reports".into(),
        kind: "folder".into(),
        parent_id: Some("q1".into()),
        ..Default::default()
    });
    let path = folder_context(&snapshot, &snapshot.library_nodes[0]);
    assert_eq!(path.len(), 1);
    assert_eq!(path[0]["name"], "Reports");
}

fn saved(id: &str) -> LibraryNode {
    LibraryNode {
        id: id.into(),
        kind: "query".into(),
        name: format!("Query {id}"),
        query_text: Some("select 1".into()),
        query_view_mode: Some("raw".into()),
        ..Default::default()
    }
}
fn snapshot() -> WorkspaceSnapshot {
    let mut snapshot = crate::app::runtime::blank_workspace_snapshot();
    snapshot.preferences.workspace_search.enabled = false;
    snapshot.library_nodes = vec![saved("q1"), saved("q2")];
    snapshot.saved_work.clear();
    snapshot
}
fn edit(snapshot: &WorkspaceSnapshot, changes: Value) -> UpdateLibraryArgs {
    UpdateLibraryArgs {
        workspace_id: "default".into(),
        item_id: "q1".into(),
        expected_revision: item_revision(&snapshot.library_nodes[0]),
        changes,
    }
}
#[test]
fn mcp_library_lists_canonical_items_without_search_or_legacy_saved_work() {
    let snapshot = snapshot();
    let result = list_items(&snapshot, "default", ListLibraryArgs::default(), false).unwrap();
    assert_eq!(result["total"], 2);
    assert_eq!(result["items"][0]["itemId"], "q1");
    assert!(result["items"][0].get("queryText").is_none());
}
#[test]
fn mcp_library_pagination_is_stable_and_revision_bound() {
    let mut snapshot = snapshot();
    snapshot.library_nodes.reverse();
    let first = list_items(
        &snapshot,
        "default",
        ListLibraryArgs {
            limit: Some(1),
            ..Default::default()
        },
        false,
    )
    .unwrap();
    let cursor = first["nextCursor"].as_str().unwrap().to_string();
    let second = list_items(
        &snapshot,
        "default",
        ListLibraryArgs {
            cursor: Some(cursor.clone()),
            ..Default::default()
        },
        false,
    )
    .unwrap();
    assert_eq!(second["items"][0]["itemId"], "q2");
    assert!(second["nextCursor"].is_null());
    snapshot.workspace_revision += 1;
    assert_eq!(
        list_items(
            &snapshot,
            "default",
            ListLibraryArgs {
                cursor: Some(cursor),
                ..Default::default()
            },
            false
        )
        .unwrap_err()
        .code,
        "library-cursor-stale"
    );
}
#[test]
fn mcp_library_separates_suites_and_rejects_unknown_filters() {
    let mut snapshot = snapshot();
    snapshot.library_nodes.push(LibraryNode {
        id: "suite".into(),
        kind: "test-suite".into(),
        ..Default::default()
    });
    assert_eq!(
        list_items(&snapshot, "default", ListLibraryArgs::default(), true).unwrap()["total"],
        1
    );
    assert!(list_items(
        &snapshot,
        "default",
        ListLibraryArgs {
            kind: Some("saved-query".into()),
            ..Default::default()
        },
        false
    )
    .is_err());
}
#[test]
fn mcp_library_legacy_migration_does_not_duplicate_or_replace_canonical_items() {
    let mut snapshot = snapshot();
    snapshot
        .saved_work
        .push(crate::domain::models::SavedWorkItem {
            id: "q1".into(),
            kind: "query".into(),
            name: "Legacy".into(),
            query_text: Some("old".into()),
            ..Default::default()
        });
    assert_eq!(
        list_items(&snapshot, "default", ListLibraryArgs::default(), false).unwrap()["total"],
        2
    );
    assert_eq!(
        find_item(&snapshot, "q1", false)
            .unwrap()
            .query_text
            .as_deref(),
        Some("select 1")
    );
}
#[test]
fn mcp_library_updates_only_clean_linked_tabs_and_preserves_layout() {
    let mut snapshot = snapshot();
    snapshot.tabs.push(QueryTabState {
        id: "open".into(),
        saved_query_id: Some("q1".into()),
        pinned: Some(true),
        environment_id: "env".into(),
        ..Default::default()
    });
    let updated = prepare_update(
        &snapshot,
        &edit(&snapshot, json!({"queryText":"select 2","name":"Renamed"})),
        false,
    )
    .unwrap();
    assert_eq!(updated.tabs[0].query_text, "select 2");
    assert_eq!(updated.tabs[0].pinned, Some(true));
    assert_eq!(updated.tabs[0].environment_id, "env");
    assert_eq!(updated.ui.active_tab_id, snapshot.ui.active_tab_id);
    assert_eq!(
        snapshot.library_nodes[0].query_text.as_deref(),
        Some("select 1")
    );
    snapshot.tabs[0].dirty = true;
    assert_eq!(
        prepare_update(
            &snapshot,
            &edit(&snapshot, json!({"queryText":"select 2"})),
            false
        )
        .err()
        .unwrap()
        .code,
        "library-draft-conflict"
    );
}
#[test]
fn mcp_library_stale_updates_and_identity_changes_are_rejected() {
    let snapshot = snapshot();
    let mut args = edit(&snapshot, json!({"queryText":"select 2"}));
    args.expected_revision = "stale".into();
    assert!(prepare_update(&snapshot, &args, false).is_err());
    assert!(prepare_update(
        &snapshot,
        &edit(&snapshot, json!({"connectionId":"elsewhere"})),
        false
    )
    .is_err());
    assert!(prepare_update(
        &snapshot,
        &edit(&snapshot, json!({"queryViewMode":"unsupported"})),
        false
    )
    .is_err());
}
#[test]
fn mcp_library_redacted_content_cannot_be_written_back_over_original() {
    let mut snapshot = snapshot();
    snapshot.library_nodes[0].query_text = Some("password=very-private".into());
    let (definition, redacted) = public_definition(&snapshot.library_nodes[0]);
    assert!(!definition.to_string().contains("very-private"));
    assert!(redacted.contains(&"queryText".into()));
    assert_eq!(
        prepare_update(
            &snapshot,
            &edit(&snapshot, json!({"queryText":"********"})),
            false
        )
        .err()
        .unwrap()
        .code,
        "library-field-redacted"
    );
    assert!(prepare_update(
        &snapshot,
        &edit(&snapshot, json!({"name":"Safe rename"})),
        false
    )
    .is_ok());
}
#[test]
fn mcp_library_effective_environment_uses_closest_folder_and_handles_cycles() {
    let mut snapshot = snapshot();
    snapshot.library_nodes[0].parent_id = Some("folder".into());
    snapshot.library_nodes.push(LibraryNode {
        id: "folder".into(),
        kind: "folder".into(),
        environment_id: Some("env".into()),
        ..Default::default()
    });
    assert_eq!(
        effective_environment(&snapshot, &snapshot.library_nodes[0]).as_deref(),
        Some("env")
    );
    snapshot.library_nodes[2].environment_id = None;
    snapshot.library_nodes[2].parent_id = Some("q1".into());
    assert_eq!(
        effective_environment(&snapshot, &snapshot.library_nodes[0]),
        None
    );
}

#[test]
fn mcp_library_preserves_legacy_script_content_without_a_separate_script_field() {
    let mut node = saved("script");
    node.kind = "script".into();
    node.query_view_mode = None;
    node.query_text = Some("db.items.find({})".into());
    let tab = tab_for_item(&snapshot(), &node);
    assert_eq!(tab.query_view_mode.as_deref(), Some("script"));
    assert_eq!(tab.script_text, node.query_text);
}

#[test]
fn mcp_search_rejects_unsupported_filters_instead_of_claiming_empty_workspace() {
    let request =
        serde_json::from_value(json!({"query":"query","includedTypes":["saved-query"]})).unwrap();
    let error = search_workspace_snapshot(&snapshot(), request).unwrap_err();
    assert!(error.data.unwrap()["supportedTypes"]
        .as_array()
        .unwrap()
        .contains(&json!("query")));
}

#[test]
fn mcp_search_unicode_snippets_never_split_utf8_codepoints() {
    let text = format!("{}needle{}", "🦀日本語".repeat(100), "é🙂".repeat(100));
    let start = text.find("needle").unwrap();
    let (snippet, from, to) = workspace_search_snippet(&text, start, start + 6);
    assert_eq!(&snippet[from..to], "needle");
    assert!(is_whole_word_match("query value", 0, 5));
}
