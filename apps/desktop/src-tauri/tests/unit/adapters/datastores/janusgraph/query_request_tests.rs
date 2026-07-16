use super::{decorate_gremlin_for_mode, is_read_only_gremlin, janusgraph_query_request};

#[test]
fn janusgraph_query_request_applies_explain_or_profile_once() {
    let explain = janusgraph_query_request("g.V().limit(1);", "explain").unwrap();
    assert_eq!(explain.gremlin, "g.V().limit(1).explain()");
    assert_eq!(explain.mode, "explain");

    let already_explained =
        janusgraph_query_request("g.V().limit(1).explain()", "explain").unwrap();
    assert_eq!(already_explained.gremlin, "g.V().limit(1).explain()");

    let profile = janusgraph_query_request("g.V().limit(1)", "profile").unwrap();
    assert_eq!(profile.gremlin, "g.V().limit(1).profile()");
    assert_eq!(profile.mode, "profile");
}

#[test]
fn janusgraph_decorates_explain_and_profile_traversals() {
    assert_eq!(
        decorate_gremlin_for_mode("g.V().limit(1);", "explain"),
        "g.V().limit(1).explain()"
    );
    assert_eq!(
        decorate_gremlin_for_mode("g.V().limit(1)", "profile"),
        "g.V().limit(1).profile()"
    );
}

#[test]
fn janusgraph_read_only_guard_allows_traversals() {
    assert!(is_read_only_gremlin("g.V().hasLabel('person').limit(25)"));
    assert!(is_read_only_gremlin("g.E().label().dedup()"));
    assert!(is_read_only_gremlin("g.V().out('knows').path()"));
}

#[test]
fn janusgraph_read_only_guard_blocks_mutations_and_scripts() {
    assert!(!is_read_only_gremlin("g.addV('person')"));
    assert!(!is_read_only_gremlin("g.V().drop()"));
    assert!(!is_read_only_gremlin("g.V().property('name', 'Ada')"));
    assert!(!is_read_only_gremlin("g.V(); graph.close()"));
    assert!(!is_read_only_gremlin("graph.openManagement()"));
}

#[test]
fn janusgraph_read_only_guard_ignores_keywords_inside_strings_and_comments() {
    assert!(is_read_only_gremlin("g.V().has('name', 'drop')"));
    assert!(is_read_only_gremlin("g.V() // drop later\n.limit(1)"));
}

#[test]
fn janusgraph_query_request_builds_write_gremlin_for_guarded_execution() {
    let request = janusgraph_query_request("g.addV('person')", "full").unwrap();

    assert_eq!(request.gremlin, "g.addV('person')");
}
