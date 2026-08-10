use super::workspace_windows::{
    clamp_restored_window_bounds, transfer_tab_ownership, WorkspaceMonitorBounds,
};
use crate::domain::models::{
    WorkspaceTabTransferRequest, WorkspaceWindowBounds, WorkspaceWindowState,
};

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
