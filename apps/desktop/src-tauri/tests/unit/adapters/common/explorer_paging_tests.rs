use super::*;
use crate::domain::models::{ExecutionCapabilities, ExplorerNode};

fn request(scope: Option<&str>, cursor: Option<String>) -> ExplorerRequest {
    ExplorerRequest {
        connection_id: "connection-1".into(),
        environment_id: "environment-1".into(),
        limit: Some(2),
        scope: scope.map(str::to_string),
        cursor,
    }
}

fn response() -> ExplorerResponse {
    ExplorerResponse {
        connection_id: "connection-1".into(),
        environment_id: "environment-1".into(),
        scope: None,
        summary: "Explorer".into(),
        capabilities: ExecutionCapabilities {
            can_cancel: false,
            can_explain: false,
            supports_live_metadata: true,
            editor_language: "sql".into(),
            default_row_limit: 100,
        },
        nodes: (0..5)
            .map(|index| ExplorerNode {
                id: format!("node-{index}"),
                label: format!("Node {index}"),
                family: "sql".into(),
                kind: "table".into(),
                detail: String::new(),
                ..ExplorerNode::default()
            })
            .collect(),
        page_info: None,
    }
}

#[test]
fn pages_and_binds_cursors_to_the_scope() {
    let first = apply_default_explorer_paging("postgresql", &request(None, None), response())
        .expect("first page");
    assert_eq!(first.nodes.len(), 2);
    assert!(first.page_info.as_ref().expect("page info").has_more);
    let cursor = first
        .page_info
        .and_then(|page| page.next_cursor)
        .expect("cursor");

    let second = apply_default_explorer_paging(
        "postgresql",
        &request(None, Some(cursor.clone())),
        response(),
    )
    .expect("second page");
    assert_eq!(second.nodes[0].id, "node-2");

    let result = apply_default_explorer_paging(
        "postgresql",
        &request(Some("other"), Some(cursor)),
        response(),
    );
    let error = match result {
        Ok(_) => panic!("scope mismatch should fail"),
        Err(error) => error,
    };
    assert_eq!(error.code, "invalid-explorer-cursor");
}

#[test]
fn continuation_fetches_enough_rows_for_the_requested_page() {
    let first = apply_default_explorer_paging("postgresql", &request(None, None), response())
        .expect("first page");
    let cursor = first
        .page_info
        .and_then(|page| page.next_cursor)
        .expect("cursor");
    let prepared = prepare_default_explorer_request("postgresql", &request(None, Some(cursor)))
        .expect("prepared request");

    assert_eq!(prepared.limit, Some(4));
    assert_eq!(prepared.cursor, None);
}
