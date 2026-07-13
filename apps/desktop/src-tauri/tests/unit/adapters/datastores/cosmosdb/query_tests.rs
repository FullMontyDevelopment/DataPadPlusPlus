use serde_json::json;

use crate::domain::models::{
    CosmosDbConnectionOptions, GraphConnectionOptions, ResolvedConnectionProfile,
};

use super::{
    bounded_cosmosdb_response, cosmosdb_gremlin_request, cosmosdb_operation,
    cosmosdb_profile_payload, cosmosdb_query_body, is_read_only_cosmosdb_gremlin,
    normalize_cosmosdb_gremlin_response, normalize_cosmosdb_response_bounded, parse_request,
};

#[test]
fn cosmosdb_plain_sql_becomes_query_documents_request() {
    let value = parse_request("SELECT * FROM c").unwrap();
    assert_eq!(value["operation"], "QueryDocuments");
    assert_eq!(value["query"], "SELECT * FROM c");
}

#[test]
fn cosmosdb_operation_normalizes_action() {
    assert_eq!(
        cosmosdb_operation(&json!({ "action": "list-containers" })).unwrap(),
        "ListContainers"
    );
}

#[test]
fn cosmosdb_query_body_includes_parameters_and_limit() {
    let body = cosmosdb_query_body(
        "SELECT * FROM c WHERE c.id = @id",
        Some(&json!([{ "name": "@id", "value": "1" }])),
        25,
    );
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["maxItemCount"], 25);
    assert_eq!(value["parameters"][0]["name"], "@id");
}

#[test]
fn cosmosdb_documents_normalize_to_rows_and_documents() {
    let value = json!({
        "Documents": [
            { "id": "1", "name": "Ada" }
        ]
    });
    let result = normalize_cosmosdb_response_bounded("QueryDocuments", &value, 100);

    assert_eq!(result.columns, vec!["id", "name"]);
    assert_eq!(result.rows, vec![vec!["1", "Ada"]]);
    assert_eq!(result.documents.as_array().unwrap().len(), 1);
    assert!(!result.truncated);
}

#[test]
fn cosmosdb_documents_normalize_with_truncation_and_continuation() {
    let value = json!({
        "Documents": [
            { "id": "1", "name": "Ada" },
            { "id": "2", "name": "Grace" },
            { "id": "3", "name": "Katherine" }
        ],
        "_continuation": "next-page",
        "_requestCharge": 5.25,
        "_count": 3
    });

    let result = normalize_cosmosdb_response_bounded("QueryDocuments", &value, 2);
    let bounded = bounded_cosmosdb_response("QueryDocuments", value.clone(), 2, result.truncated);
    let profile = cosmosdb_profile_payload("QueryDocuments", &value).unwrap();

    assert!(result.truncated);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.documents.as_array().unwrap().len(), 2);
    assert_eq!(bounded["Documents"].as_array().unwrap().len(), 2);
    assert_eq!(bounded["datapad"]["continuation"], "next-page");
    assert_eq!(profile["renderer"], "profile");
    assert_eq!(profile["stages"]["requestCharge"], 5.25);
    assert_eq!(profile["stages"]["count"], 3);
}

#[test]
fn cosmosdb_query_body_uses_requested_fetch_size() {
    let body = cosmosdb_query_body("SELECT * FROM c", None, 101);
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(value["maxItemCount"], 101);
}

#[test]
fn cosmosdb_gremlin_request_uses_json_and_profile_defaults() {
    let mut connection = gremlin_connection();
    connection.graph_options = Some(GraphConnectionOptions {
        graph_name: Some("fraud".into()),
        ..GraphConnectionOptions::default()
    });

    let request = cosmosdb_gremlin_request(
        &connection,
        r#"{ "query": "g.V().limit(10)", "database": "security" }"#,
    )
    .unwrap();

    assert_eq!(request.gremlin, "g.V().limit(10)");
    assert_eq!(request.database, "security");
    assert_eq!(request.graph, "fraud");
}

#[test]
fn cosmosdb_gremlin_read_only_guard_blocks_mutations() {
    assert!(is_read_only_cosmosdb_gremlin(
        "g.V().hasLabel('person').limit(5)"
    ));
    assert!(is_read_only_cosmosdb_gremlin("g.V().values('drop')"));
    assert!(!is_read_only_cosmosdb_gremlin("g.addV('person')"));
    assert!(!is_read_only_cosmosdb_gremlin("g.V(); g.addV('person')"));
    assert!(!is_read_only_cosmosdb_gremlin("graph.traversal().V()"));
}

#[test]
fn cosmosdb_gremlin_response_normalizes_graph_objects() {
    let value = json!({
        "status": { "code": 200 },
        "result": {
            "data": [
                { "id": "n1", "label": "person", "properties": { "name": [{ "value": "Ada" }] } },
                { "id": "e1", "label": "USES", "outV": "n1", "inV": "n2", "properties": { "since": [{ "value": 2026 }] } }
            ]
        }
    });

    let normalized = normalize_cosmosdb_gremlin_response(&value, 25);
    let graph = normalized.graph_payload.expect("graph payload");

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(normalized.total_rows, 2);
    assert_eq!(graph.node_count, 1);
    assert_eq!(graph.edge_count, 1);
    assert_eq!(graph.nodes.as_array().unwrap().len(), 1);
    assert_eq!(graph.edges.as_array().unwrap().len(), 1);
}

fn gremlin_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cosmos-gremlin".into(),
        name: "Cosmos DB Gremlin".into(),
        engine: "cosmosdb".into(),
        family: "graph".into(),
        host: "example.gremlin.cosmosdb.azure.com".into(),
        port: Some(443),
        database: Some("default-db".into()),
        username: None,
        password: Some("secret".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: Some(CosmosDbConnectionOptions {
            api: Some("gremlin".into()),
            database_name: Some("default-db".into()),
            container_prefix: Some("default-graph".into()),
            ..CosmosDbConnectionOptions::default()
        }),
        search_options: None,
        time_series_options: None,
        graph_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
