use super::{is_read_only_cypher, neo4j_query_request};

#[test]
fn neo4j_query_request_applies_explain_or_profile_once() {
    let explain = neo4j_query_request("MATCH (n) RETURN n", "explain").unwrap();
    assert_eq!(explain.statement, "EXPLAIN MATCH (n) RETURN n");
    assert_eq!(explain.mode, "explain");

    let already_explained = neo4j_query_request("EXPLAIN MATCH (n) RETURN n", "explain").unwrap();
    assert_eq!(already_explained.statement, "EXPLAIN MATCH (n) RETURN n");

    let profile = neo4j_query_request("MATCH (n) RETURN n", "profile").unwrap();
    assert_eq!(profile.statement, "PROFILE MATCH (n) RETURN n");
    assert_eq!(profile.mode, "profile");
}

#[test]
fn neo4j_read_only_guard_allows_read_cypher() {
    assert!(is_read_only_cypher("MATCH (n) RETURN n"));
    assert!(is_read_only_cypher("OPTIONAL MATCH (n) RETURN n"));
    assert!(is_read_only_cypher("WITH 1 AS x RETURN x"));
    assert!(is_read_only_cypher("SHOW INDEXES"));
    assert!(is_read_only_cypher("CALL db.labels()"));
}

#[test]
fn neo4j_read_only_guard_blocks_mutating_cypher() {
    assert!(!is_read_only_cypher("CREATE (:Person {name: 'Ada'})"));
    assert!(!is_read_only_cypher(
        "MATCH (n) SET n.name = 'Ada' RETURN n"
    ));
    assert!(!is_read_only_cypher("MATCH (n) DETACH DELETE n"));
    assert!(!is_read_only_cypher(
        "LOAD CSV FROM 'file:///data.csv' AS row RETURN row"
    ));
    assert!(!is_read_only_cypher(
        "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'DELETE n', {})"
    ));
    assert!(!is_read_only_cypher("CALL custom.mutatingProcedure()"));
}

#[test]
fn neo4j_read_only_guard_ignores_keywords_inside_strings_and_comments() {
    assert!(is_read_only_cypher("MATCH (n) RETURN 'DELETE' AS value"));
    assert!(is_read_only_cypher("MATCH (n) // DELETE later\nRETURN n"));
}

#[test]
fn neo4j_query_request_builds_write_cypher_for_guarded_execution() {
    let request = neo4j_query_request("MATCH (n) DELETE n", "full").unwrap();

    assert_eq!(request.statement, "MATCH (n) DELETE n");
}
