use super::*;
use crate::domain::models::{ClosedQueryTabSnapshot, LibraryNode, SavedWorkItem};

#[test]
fn migration_preserves_script_expressions_in_open_closed_and_saved_work() {
    let mut snapshot = blank_workspace_snapshot();
    let source = "const NAME = 'catalog'; print(`${NAME}`)";
    let script = QueryTabState {
        id: "script".into(),
        query_text: source.into(),
        script_text: Some(source.into()),
        query_view_mode: Some("script".into()),
        ..Default::default()
    };
    snapshot.tabs = vec![
        script.clone(),
        QueryTabState {
            id: "raw".into(),
            query_text: "select * from ${SCHEMA}.items".into(),
            ..Default::default()
        },
    ];
    snapshot.closed_tabs = vec![ClosedQueryTabSnapshot {
        tab: script,
        closed_at: "2026-10-23".into(),
        close_reason: "user".into(),
    }];
    snapshot.library_nodes = vec![LibraryNode {
        id: "saved-script".into(),
        kind: "script".into(),
        query_text: Some(source.into()),
        script_text: Some(source.into()),
        ..Default::default()
    }];
    snapshot.saved_work = vec![SavedWorkItem {
        kind: "script".into(),
        query_text: Some(source.into()),
        ..Default::default()
    }];
    migrate_legacy_variable_tokens(&mut snapshot);
    assert_eq!(snapshot.tabs[0].query_text, source);
    assert_eq!(snapshot.tabs[0].script_text.as_deref(), Some(source));
    assert_eq!(snapshot.closed_tabs[0].tab.query_text, source);
    assert_eq!(
        snapshot.library_nodes[0].query_text.as_deref(),
        Some(source)
    );
    assert_eq!(
        snapshot.library_nodes[0].script_text.as_deref(),
        Some(source)
    );
    assert_eq!(snapshot.saved_work[0].query_text.as_deref(), Some(source));
    assert_eq!(
        snapshot.tabs[1].query_text,
        "select * from {{SCHEMA}}.items"
    );
}
