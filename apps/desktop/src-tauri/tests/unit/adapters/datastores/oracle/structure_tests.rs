use super::{
    encode_oracle_completion_cursor, is_oracle_system_owner, oracle_completion_fields_query,
    oracle_completion_objects_query, oracle_object_filter, parse_oracle_completion_cursor,
    OracleCompletionPhase, StructureRequest,
};

#[test]
fn oracle_structure_filter_escapes_owner_and_object_names() {
    let filter = oracle_object_filter(
        "owner",
        "table_name",
        &[
            ("APP'S".into(), "ORDERS".into()),
            ("APP'S".into(), "ACCOUNTS".into()),
        ],
    );
    assert!(filter.contains("APP''S"));
    assert!(filter.contains("ORDERS"));
    assert!(filter.contains("ACCOUNTS"));
    assert_eq!(filter.matches("owner = 'APP''S'").count(), 1);
    assert!(filter.contains("table_name in"));
}

#[test]
fn oracle_structure_marks_known_dictionary_owners_as_system() {
    assert!(is_oracle_system_owner("SYS"));
    assert!(!is_oracle_system_owner("DATAPADPLUSPLUS"));
}

#[test]
fn oracle_completion_cursor_round_trips_and_is_bound_to_schema() {
    let request = completion_request();
    let encoded = encode_oracle_completion_cursor(
        &request,
        "Sales:Ops",
        OracleCompletionPhase::Fields,
        2_000,
    );
    let mut continuation = request.clone();
    continuation.cursor = Some(encoded);

    let parsed = parse_oracle_completion_cursor(&continuation, "Sales:Ops").unwrap();
    assert_eq!(parsed.phase, OracleCompletionPhase::Fields);
    assert_eq!(parsed.offset, 2_000);
    assert!(parse_oracle_completion_cursor(&continuation, "OTHER").is_err());
}

#[test]
fn oracle_completion_queries_are_deterministic_and_server_paged() {
    let objects = oracle_completion_objects_query("APP'S", 250, 250);
    assert!(objects.contains("owner = 'APP''S'"));
    assert!(objects.contains("order by object_name, object_type"));
    assert!(objects.contains("offset 250 rows fetch next 251 rows only"));

    let fields = oracle_completion_fields_query("APP", 2_000, 2_000);
    assert!(fields.contains("order by c.table_name, c.column_id"));
    assert!(fields.contains("offset 2000 rows fetch next 2001 rows only"));
    assert!(fields.contains("'MATERIALIZED VIEW'"));
}

fn completion_request() -> StructureRequest {
    StructureRequest {
        connection_id: "connection-oracle".into(),
        environment_id: "environment-dev".into(),
        limit: Some(250),
        scope: Some("schema:Sales%3AOps".into()),
        cursor: None,
        focus_node_id: None,
        include_system_objects: None,
        include_inferred_relationships: None,
        max_nodes: None,
        max_edges: None,
        depth: None,
        mode: Some("completion".into()),
    }
}
