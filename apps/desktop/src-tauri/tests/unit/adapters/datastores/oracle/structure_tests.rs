use super::super::sidecar::shutdown_oracle_sidecar_for_tests;
use super::{
    encode_oracle_completion_cursor, is_oracle_system_owner, load_oracle_structure,
    oracle_completion_fields_query, oracle_completion_objects_query, oracle_object_filter,
    parse_oracle_completion_cursor, OracleCompletionPhase, StructureRequest,
};
use crate::domain::models::{OracleConnectionOptions, ResolvedConnectionProfile};
use std::collections::HashSet;

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

#[tokio::test]
#[ignore = "requires the seeded Oracle Docker fixture and bundled managed runtime"]
async fn oracle_live_fixture_pages_completion_objects_and_fields() {
    let connection = live_fixture_connection();
    let mut request = completion_request();
    request.connection_id = connection.id.clone();
    request.environment_id = "fixture-oracle".into();
    request.limit = Some(25);
    request.scope = Some("schema:DATAPADPLUSPLUS".into());

    let mut object_names = Vec::new();
    let mut field_identities = HashSet::new();
    let mut page_count = 0;
    let mut crossed_field_boundary = false;

    loop {
        if request
            .cursor
            .as_deref()
            .is_some_and(|cursor| cursor.contains(":fields:2000:"))
        {
            crossed_field_boundary = true;
        }

        let response = load_oracle_structure(&connection, &request)
            .await
            .expect("live Oracle completion page");
        page_count += 1;
        eprintln!(
            "live Oracle completion page {page_count}: {} object(s), next={:?}",
            response.nodes.len(),
            response.next_cursor
        );
        assert!(page_count < 30, "Oracle completion did not terminate");

        for node in response.nodes {
            if node.fields.is_empty() {
                object_names.push(node.label.clone());
            }
            for field in node.fields {
                field_identities.insert(format!("{}|{}", node.label, field.name));
            }
        }

        let Some(cursor) = response.next_cursor else {
            break;
        };
        request.cursor = Some(cursor);
    }

    shutdown_oracle_sidecar_for_tests().await;

    assert!(
        page_count >= 8,
        "expected object and field continuation pages"
    );
    assert!(
        object_names.len() >= 130,
        "expected the paging stress objects"
    );
    assert_eq!(
        object_names.iter().collect::<HashSet<_>>().len(),
        object_names.len(),
        "completion object pages must not duplicate identifiers"
    );
    for name in [
        "DPP_PAGING_TABLE_125",
        "DPP_CASE_TABLE",
        "Dpp_Case_Table",
        "Dpp$Quoted#Table",
        "Dpp_販売_Table",
    ] {
        assert!(object_names.iter().any(|candidate| candidate == name));
    }
    assert!(
        crossed_field_boundary,
        "expected a second 2,000-row field page"
    );
    assert!(field_identities.contains("DPP_PAGING_TABLE_125|PAGING_VALUE_17"));
    assert!(field_identities.contains("Dpp$Quoted#Table|Mixed$Column#"));
    assert!(field_identities.contains("Dpp_販売_Table|説明"));
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

fn live_fixture_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-oracle-live-fixture".into(),
        name: "Oracle paging fixture".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(
            std::env::var("DATAPADPLUSPLUS_ORACLE_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(1522),
        ),
        database: Some("FREEPDB1".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: Some(OracleConnectionOptions {
            connect_mode: Some("service".into()),
            execution_runtime: Some("managed".into()),
            service_name: Some("FREEPDB1".into()),
            application_name: Some("DataPad++ paging fixture".into()),
            fetch_size: Some(100),
            connection_timeout_ms: Some(15_000),
            request_timeout_ms: Some(30_000),
            use_tls: Some(false),
            ..Default::default()
        }),
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
