use crate::domain::models::{
    ClosedQueryTabSnapshot, ConnectionProfile, QueryHistoryEntry, QueryTabState, SavedWorkItem,
};

use super::super::query_tabs::{editor_label_for_connection, language_for_connection};

pub(super) fn fixture_snippets(created_at: &str) -> impl Iterator<Item = SavedWorkItem> {
    [
        SavedWorkItem {
            id: "saved-fixture-sql-count-snippet".into(),
            kind: "snippet".into(),
            name: "SQL row-count smoke snippet".into(),
            summary: "Quick count pattern for fixture tables.".into(),
            tags: vec!["fixtures".into(), "sql".into()],
            updated_at: created_at.into(),
            folder: Some("Fixture Snippets".into()),
            favorite: Some(false),
            connection_id: None,
            environment_id: Some("env-fixtures".into()),
            language: Some("sql".into()),
            query_text: Some("select count(*) as row_count from <table_name>;".into()),
            snapshot_result_id: None,
        },
        SavedWorkItem {
            id: "saved-fixture-redis-scan-snippet".into(),
            kind: "snippet".into(),
            name: "Redis session scan snippet".into(),
            summary: "Bounded SCAN pattern for cache fixture keys.".into(),
            tags: vec!["fixtures".into(), "redis".into()],
            updated_at: created_at.into(),
            folder: Some("Fixture Snippets".into()),
            favorite: Some(false),
            connection_id: Some("fixture-redis".into()),
            environment_id: Some("env-fixtures".into()),
            language: Some("redis".into()),
            query_text: Some("SCAN 0 MATCH session:* COUNT 25".into()),
            snapshot_result_id: None,
        },
    ]
    .into_iter()
}

pub(super) fn fixture_closed_tabs(
    connections: &[ConnectionProfile],
    created_at: &str,
) -> Vec<ClosedQueryTabSnapshot> {
    let Some(connection) = connections
        .iter()
        .find(|connection| connection.id == "fixture-postgresql")
        .or_else(|| connections.first())
    else {
        return Vec::new();
    };

    vec![ClosedQueryTabSnapshot {
        tab: QueryTabState {
            id: "tab-fixture-recovery-example".into(),
            title: "Recovered fixture scratch.sql".into(),
            tab_kind: Some("query".into()),
            connection_id: connection.id.clone(),
            environment_id: "env-fixtures".into(),
            family: connection.family.clone(),
            language: language_for_connection(connection),
            pinned: None,
            save_target: None,
            saved_query_id: None,
            editor_label: editor_label_for_connection(connection),
            query_text: "select count(*) as table_count from observability.table_health;".into(),
            scoped_target: None,
            builder_state: None,
            metrics_state: None,
            test_suite: None,
            test_run: None,
            status: "idle".into(),
            dirty: true,
            last_run_at: None,
            result: None,
            history: vec![QueryHistoryEntry {
                id: "history-fixture-recovery-example".into(),
                query_text: "select count(*) as table_count from observability.table_health;"
                    .into(),
                executed_at: created_at.into(),
                status: "recovered".into(),
            }],
            error: None,
        },
        closed_at: created_at.into(),
        close_reason: "fixture-recovery-example".into(),
    }]
}
