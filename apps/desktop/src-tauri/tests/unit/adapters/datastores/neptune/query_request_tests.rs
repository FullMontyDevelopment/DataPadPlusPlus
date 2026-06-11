use super::{
    decorate_gremlin_for_mode, is_read_only_gremlin, is_read_only_opencypher, is_read_only_sparql,
    neptune_query_request,
};

#[test]
fn neptune_gremlin_request_decorates_explain_and_profile_once() {
    let profile = neptune_query_request("gremlin", "g.V().limit(1)", "profile").unwrap();
    assert_eq!(profile.mode, "profile");
    assert_eq!(profile.gremlin.as_deref(), Some("g.V().limit(1).profile()"));

    let explain = neptune_query_request("gremlin", "g.V().limit(1).explain()", "explain").unwrap();
    assert_eq!(explain.gremlin.as_deref(), Some("g.V().limit(1).explain()"));

    assert_eq!(
        decorate_gremlin_for_mode("g.V().limit(1);", "explain"),
        "g.V().limit(1).explain()"
    );
}

#[test]
fn neptune_read_only_guards_allow_native_reads() {
    assert!(is_read_only_gremlin("g.V().hasLabel('person').limit(25)"));
    assert!(is_read_only_opencypher("MATCH (n) RETURN n LIMIT 25"));
    assert!(is_read_only_sparql(
        "PREFIX ex: <urn:> SELECT ?s WHERE { ?s ?p ?o } LIMIT 25"
    ));
}

#[test]
fn neptune_read_only_guards_block_mutations() {
    assert!(!is_read_only_gremlin("g.addV('person')"));
    assert!(!is_read_only_gremlin("g.V().drop()"));
    assert!(!is_read_only_opencypher("MATCH (n) DELETE n"));
    assert!(!is_read_only_opencypher("CREATE (:Person {name: 'Ada'})"));
    assert!(!is_read_only_sparql("DELETE WHERE { ?s ?p ?o }"));
    assert!(!is_read_only_sparql(
        "LOAD <s3://bucket/file.ttl> INTO GRAPH <urn:g>"
    ));
}

#[test]
fn neptune_read_only_guards_ignore_keywords_in_strings_and_comments() {
    assert!(is_read_only_gremlin("g.V().has('name', 'drop')"));
    assert!(is_read_only_opencypher("MATCH (n) RETURN 'DELETE' AS text"));
    assert!(is_read_only_sparql(
        "SELECT ?s WHERE { ?s ?p \"DELETE\" } # DROP later"
    ));
}

#[test]
fn neptune_query_request_builds_language_bodies() {
    let cypher = neptune_query_request("opencypher", "MATCH (n) RETURN n", "full").unwrap();
    assert_eq!(cypher.path, "/openCypher");
    assert!(cypher.body.starts_with("query=MATCH+"));

    let sparql = neptune_query_request("sparql", "SELECT ?s WHERE { ?s ?p ?o }", "full").unwrap();
    assert_eq!(sparql.path, "/sparql");
    assert!(sparql.body.starts_with("query=SELECT+"));
}

#[test]
fn neptune_query_request_rejects_write_queries() {
    let error = neptune_query_request("gremlin", "g.addV('person')", "full").unwrap_err();

    assert_eq!(error.code, "neptune-write-preview-only");
}
