use super::*;

#[test]
fn cursor_is_bound_to_scope() {
    let paging =
        MongoExplorerPaging::new(Some("collections:catalog"), None, 1).expect("first page");
    let (_, info) = paging.finish(vec![node("a"), node("b")]);
    let cursor = info.next_cursor.expect("next cursor");

    let error = MongoExplorerPaging::new(Some("collections:other"), Some(&cursor), 1)
        .err()
        .expect("scope mismatch");
    assert_eq!(error.code, "invalid-explorer-cursor");
}

#[test]
fn malformed_cursor_is_rejected() {
    let error = MongoExplorerPaging::new(
        Some("collections:catalog"),
        Some("mongodb-explorer-v1:not-a-hash:2"),
        1,
    )
    .err()
    .expect("malformed cursor");

    assert_eq!(error.code, "invalid-explorer-cursor");
}

#[test]
fn paging_reports_known_total_and_continuation() {
    let first = MongoExplorerPaging::new(Some("collections:catalog"), None, 2).expect("first page");
    let (nodes, info) = first.finish(vec![node("a"), node("b"), node("c")]);
    assert_eq!(nodes.len(), 2);
    assert_eq!(info.known_total, Some(3));
    assert!(info.has_more);

    let cursor = info.next_cursor.expect("next cursor");
    let next = MongoExplorerPaging::new(Some("collections:catalog"), Some(&cursor), 2)
        .expect("second page");
    let (nodes, info) = next.finish(vec![node("a"), node("b"), node("c")]);
    assert_eq!(nodes[0].id, "c");
    assert!(!info.has_more);
}

fn node(id: &str) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "document".into(),
        label: id.into(),
        kind: "collection".into(),
        detail: String::new(),
        scope: None,
        path: None,
        query_template: None,
        expandable: Some(false),
    }
}
