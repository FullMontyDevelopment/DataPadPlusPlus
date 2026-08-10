use super::{is_activity, is_sidebar_pane, normalize_workspace_windows};
use crate::{
    app::runtime::blank_workspace_snapshot,
    domain::models::{QueryTabState, WorkspaceWindowBounds, WorkspaceWindowState},
};

#[test]
fn legacy_tests_activity_and_sidebar_pane_are_valid() {
    assert!(is_activity("tests"));
    assert!(is_sidebar_pane("tests"));
}

#[test]
fn disabled_multi_window_layout_assigns_every_tab_to_main() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.tabs = vec![tab("query", "query"), tab("settings", "settings")];
    snapshot.ui.active_tab_id = "query".into();
    snapshot.ui.workspace_windows = vec![editor_window("editor-one", vec!["query"])];

    let windows = normalize_workspace_windows(&snapshot);

    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].id, "main");
    assert_eq!(windows[0].tab_ids, vec!["query", "settings"]);
    assert_eq!(windows[0].active_tab_id, "query");
}

#[test]
fn normalization_repairs_duplicate_ownership_and_keeps_administration_in_main() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.multi_window_tabs.enabled = true;
    snapshot.tabs = vec![tab("query", "query"), tab("settings", "settings")];
    snapshot.ui.active_tab_id = "settings".into();
    snapshot.ui.workspace_windows = vec![
        editor_window("editor-one", vec!["query", "settings"]),
        editor_window("editor-two", vec!["query"]),
    ];

    let windows = normalize_workspace_windows(&snapshot);

    let main = windows.iter().find(|window| window.id == "main").unwrap();
    let editor = windows
        .iter()
        .find(|window| window.id == "editor-one")
        .unwrap();
    assert_eq!(main.tab_ids, vec!["settings"]);
    assert_eq!(main.active_tab_id, "settings");
    assert_eq!(editor.tab_ids, vec!["query"]);
    assert!(!windows.iter().any(|window| window.id == "editor-two"));
}

#[test]
fn normalization_repairs_active_tabs_and_clamps_editor_dimensions() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.multi_window_tabs.enabled = true;
    snapshot.tabs = vec![tab("query", "query")];
    let mut editor = editor_window("editor-one", vec!["query"]);
    editor.active_tab_id = "missing".into();
    editor.bounds = Some(WorkspaceWindowBounds {
        x: -25_000,
        y: 25_000,
        width: 20,
        height: 20_000,
    });
    snapshot.ui.workspace_windows = vec![WorkspaceWindowState::default(), editor];

    let windows = normalize_workspace_windows(&snapshot);
    let editor = windows
        .iter()
        .find(|window| window.id == "editor-one")
        .unwrap();

    assert_eq!(editor.active_tab_id, "query");
    assert_eq!(editor.bounds.as_ref().unwrap().width, 720);
    assert_eq!(editor.bounds.as_ref().unwrap().height, 4320);
}

fn tab(id: &str, kind: &str) -> QueryTabState {
    QueryTabState {
        id: id.into(),
        title: id.into(),
        tab_kind: Some(kind.into()),
        status: "idle".into(),
        ..QueryTabState::default()
    }
}

fn editor_window(id: &str, tab_ids: Vec<&str>) -> WorkspaceWindowState {
    WorkspaceWindowState {
        id: id.into(),
        role: "editor".into(),
        active_tab_id: tab_ids.first().copied().unwrap_or_default().into(),
        tab_ids: tab_ids.into_iter().map(str::to_owned).collect(),
        ..WorkspaceWindowState::default()
    }
}
