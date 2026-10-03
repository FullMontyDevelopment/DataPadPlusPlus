use super::workspace_windows::{
    clamp_restored_window_bounds, reorder_workspace_tabs, transfer_tab_ownership,
    WorkspaceMonitorBounds,
};
use super::{blank_workspace_snapshot, ui::normalize_workspace_windows};
use crate::domain::models::{
    QueryTabState, WorkspaceTabTransferRequest, WorkspaceWindowBounds, WorkspaceWindowState,
};

#[test]
fn single_window_reorder_survives_persistence_normalization_and_reload() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.tabs = vec![tab("one"), tab("two"), tab("three")];
    snapshot.ui.active_tab_id = "two".into();
    let original_tabs = snapshot.tabs.clone();

    reorder_workspace_tabs(
        &mut snapshot,
        "main",
        vec!["three".into(), "one".into(), "two".into()],
    )
    .unwrap();
    let saved = serde_json::to_string(&snapshot).unwrap();
    let reloaded = serde_json::from_str(&saved).unwrap();
    let windows = normalize_workspace_windows(&reloaded);

    assert_eq!(windows[0].tab_ids, ["three", "one", "two"]);
    assert_eq!(windows[0].active_tab_id, "two");
    assert_eq!(snapshot.ui.active_tab_id, "two");
    for original in original_tabs {
        let moved = snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == original.id)
            .unwrap();
        assert_eq!(
            serde_json::to_value(moved).unwrap(),
            serde_json::to_value(original).unwrap()
        );
    }
}

#[test]
fn multi_window_reorder_changes_only_the_requested_window_order() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.multi_window_tabs.enabled = true;
    snapshot.tabs = vec![tab("one"), tab("two"), tab("three"), tab("four")];
    snapshot.ui.active_tab_id = "two".into();
    snapshot.ui.workspace_windows = vec![
        window("main", "main", &["one", "two"]),
        window("editor-one", "editor", &["three", "four"]),
    ];
    let original_tabs = serde_json::to_value(&snapshot.tabs).unwrap();

    for (id, order) in [
        ("main", vec!["two", "one"]),
        ("editor-one", vec!["four", "three"]),
    ] {
        reorder_workspace_tabs(
            &mut snapshot,
            id,
            order.into_iter().map(str::to_owned).collect(),
        )
        .unwrap();
        snapshot.ui.workspace_windows = normalize_workspace_windows(&snapshot);
    }
    assert_eq!(snapshot.ui.workspace_windows[0].tab_ids, ["two", "one"]);
    assert_eq!(snapshot.ui.workspace_windows[1].tab_ids, ["four", "three"]);
    assert_eq!(snapshot.ui.workspace_windows[0].active_tab_id, "two");
    assert_eq!(snapshot.ui.workspace_windows[1].active_tab_id, "four");
    assert_eq!(serde_json::to_value(&snapshot.tabs).unwrap(), original_tabs);
}

#[test]
fn stale_or_foreign_reorder_leaves_the_entire_snapshot_unchanged() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.multi_window_tabs.enabled = true;
    snapshot.tabs = vec![tab("one"), tab("two"), tab("three")];
    snapshot.ui.workspace_windows = vec![
        window("main", "main", &["one", "two"]),
        window("editor-one", "editor", &["three"]),
    ];
    for (id, order) in [
        ("main", vec!["one", "one"]),
        ("main", vec!["one"]),
        ("main", vec!["one", "missing"]),
        ("main", vec!["one", "three"]),
        ("missing", vec!["one", "two"]),
    ] {
        let before = serde_json::to_value(&snapshot).unwrap();
        assert!(reorder_workspace_tabs(
            &mut snapshot,
            id,
            order.into_iter().map(str::to_owned).collect()
        )
        .is_err());
        assert_eq!(serde_json::to_value(&snapshot).unwrap(), before);
    }
}

fn tab(id: &str) -> QueryTabState {
    QueryTabState {
        id: id.into(),
        tab_kind: Some("query".into()),
        title: format!("Draft {id}"),
        query_text: "select 42;".into(),
        environment_id: format!("env-{id}"),
        pinned: Some(true),
        dirty: true,
        ..QueryTabState::default()
    }
}

#[test]
fn transfer_is_atomic_and_preserves_destination_order() {
    let mut windows = vec![
        window("main", "main", &["one", "two"]),
        window("editor-one", "editor", &["three", "four"]),
    ];
    let request = transfer("two", "main", Some("editor-one"), Some("four"));

    transfer_tab_ownership(&mut windows, &request, "editor-one").unwrap();

    assert_eq!(windows[0].tab_ids, vec!["one"]);
    assert_eq!(windows[0].active_tab_id, "one");
    assert_eq!(windows[1].tab_ids, vec!["three", "two", "four"]);
    assert_eq!(windows[1].active_tab_id, "two");
}

#[test]
fn rejected_transfer_does_not_mutate_ownership() {
    let mut windows = vec![
        window("main", "main", &["one"]),
        window("editor-one", "editor", &["two"]),
    ];
    let before = windows.clone();
    let request = transfer("two", "main", Some("editor-one"), None);

    let error = transfer_tab_ownership(&mut windows, &request, "editor-one").unwrap_err();

    assert_eq!(error.code, "tab-window-mismatch");
    assert_eq!(windows[0].tab_ids, before[0].tab_ids);
    assert_eq!(windows[1].tab_ids, before[1].tab_ids);
}

#[test]
fn same_window_transfer_reorders_without_duplicate_claims() {
    let mut windows = vec![window("main", "main", &["one", "two", "three"])];
    let request = transfer("three", "main", Some("main"), Some("one"));

    transfer_tab_ownership(&mut windows, &request, "main").unwrap();

    assert_eq!(windows[0].tab_ids, vec!["three", "one", "two"]);
    assert_eq!(windows[0].active_tab_id, "three");
}

#[test]
fn missing_destination_rolls_back_without_partial_source_removal() {
    let mut windows = vec![window("main", "main", &["one", "two"])];
    let request = transfer("two", "main", Some("missing"), None);

    let error = transfer_tab_ownership(&mut windows, &request, "missing").unwrap_err();

    assert_eq!(error.code, "window-missing");
    assert_eq!(windows[0].tab_ids, vec!["one", "two"]);
}

#[test]
fn restored_bounds_fall_back_to_primary_when_a_monitor_was_removed() {
    let monitors = vec![
        WorkspaceMonitorBounds {
            name: Some("primary".into()),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
        WorkspaceMonitorBounds {
            name: Some("secondary".into()),
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
        },
    ];
    let restored = clamp_restored_window_bounds(
        Some(&WorkspaceWindowBounds {
            x: 4600,
            y: 1800,
            width: 1120,
            height: 760,
        }),
        Some("removed-monitor"),
        &monitors,
        Some("primary"),
    );

    assert_eq!(restored.x, 800);
    assert_eq!(restored.y, 320);
    assert_eq!(restored.width, 1120);
    assert_eq!(restored.height, 760);
}

#[test]
fn restored_bounds_keep_valid_negative_monitor_coordinates() {
    let monitors = vec![WorkspaceMonitorBounds {
        name: Some("left".into()),
        x: -1920,
        y: -120,
        width: 1920,
        height: 1080,
    }];
    let restored = clamp_restored_window_bounds(
        Some(&WorkspaceWindowBounds {
            x: -1700,
            y: 20,
            width: 1000,
            height: 700,
        }),
        Some("left"),
        &monitors,
        Some("left"),
    );

    assert_eq!(restored.x, -1700);
    assert_eq!(restored.y, 20);
}

fn window(id: &str, role: &str, tab_ids: &[&str]) -> WorkspaceWindowState {
    WorkspaceWindowState {
        id: id.into(),
        role: role.into(),
        tab_ids: tab_ids.iter().map(|id| (*id).to_owned()).collect(),
        active_tab_id: tab_ids.last().copied().unwrap_or_default().into(),
        ..WorkspaceWindowState::default()
    }
}

fn transfer(
    tab_id: &str,
    source_window_id: &str,
    destination_window_id: Option<&str>,
    before_tab_id: Option<&str>,
) -> WorkspaceTabTransferRequest {
    WorkspaceTabTransferRequest {
        tab_id: tab_id.into(),
        source_window_id: source_window_id.into(),
        destination_window_id: destination_window_id.map(str::to_owned),
        before_tab_id: before_tab_id.map(str::to_owned),
        ..WorkspaceTabTransferRequest::default()
    }
}
