use super::*;
use crate::adapters::datastores::search::ELASTICSEARCH;

#[test]
fn search_query_template_wraps_index_and_body() {
    let template = search_query_template("logs-*");
    assert!(template.contains("\"index\": \"logs-*\""));
    assert!(template.contains("\"match_all\""));
}

#[test]
fn search_node_ids_map_to_native_object_views() {
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-index:logs").kind,
        "index"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-data-stream:metrics").kind,
        "data-stream"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-alias:current").kind,
        "alias"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "elasticsearch:cluster-health").kind,
        "cluster"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "mapping:products").kind,
        "mappings"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "search:security:users").kind,
        "users"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "search:diagnostics:lifecycle").kind,
        "lifecycle-policies"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "pipeline:normalize-products").kind,
        "pipeline"
    );
    assert_eq!(
        SearchObjectTarget::from_node_id(ELASTICSEARCH, "index-template:products-template").kind,
        "index-template"
    );
}

#[test]
fn root_nodes_include_native_search_sections() {
    let connection = test_connection("Search");

    let labels = root_nodes(ELASTICSEARCH, &connection)
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Cluster",
            "Indices",
            "Data Streams",
            "Aliases",
            "Templates",
            "Pipelines",
            "Security",
            "Diagnostics"
        ]
    );
}

#[test]
fn search_base_payload_is_view_friendly_without_raw_api_dump() {
    let target = SearchObjectTarget::from_node_id(ELASTICSEARCH, "search-index:logs");
    let payload = search_base_payload(ELASTICSEARCH, &target);

    assert_eq!(payload["engine"], "elasticsearch");
    assert_eq!(payload["objectView"], "index");
    assert_eq!(payload["index"], "logs");
    assert!(payload.get("api").is_none());
}

#[test]
fn live_search_nodes_use_generic_object_ids() {
    let connection = test_connection("Search");
    let root = root_nodes(ELASTICSEARCH, &connection);
    assert_eq!(root[0].id, "search:cluster");
    assert_eq!(root[1].id, "search:indices");

    let detail = search_index_node_detail(
        ELASTICSEARCH,
        &json!({
            "health": "green",
            "docs.count": "42",
            "store.size": "128kb"
        }),
    );
    assert_eq!(detail, "green / 42 docs / 128kb");

    let alias_detail = search_alias_node_detail(&json!({
        "index": "products-v1",
        "is_write_index": "true",
        "routing.index": "tenant-a"
    }));
    assert_eq!(alias_detail, "products-v1 / write true / routing tenant-a");
}

#[test]
fn search_mapping_fields_flatten_nested_properties() {
    let mapping = json!({
        "title": { "type": "text", "analyzer": "standard" },
        "user": {
            "properties": {
                "id": { "type": "keyword" }
            }
        }
    });
    let mut fields = Vec::new();
    collect_mapping_fields("", &mapping, &mut fields);

    let paths = fields
        .iter()
        .filter_map(|field| field.get("path").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["title", "user", "user.id"]);
    assert_eq!(fields[0]["type"], "text");
    assert_eq!(fields[1]["type"], "object");
}

#[test]
fn search_helpers_filter_and_read_nested_fields() {
    let rows = vec![
        json!({ "name": "products", "type": "index" }),
        json!({ "name": "logs", "type": "index" }),
    ];

    assert_eq!(filter_named_rows(rows.clone(), Some("products")).len(), 1);
    assert_eq!(filter_named_rows(rows, None).len(), 2);
    assert_eq!(
        string_field(
            &json!({ "settings": { "location": "/snapshots" } }),
            "settings.location"
        ),
        "/snapshots"
    );
    assert_eq!(
        string_field(&json!({ "docs.count": "42" }), "docs.count"),
        "42"
    );
}

fn test_connection(name: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "search".into(),
        name: name.into(),
        engine: "elasticsearch".into(),
        family: "search".into(),
        host: "localhost".into(),
        port: Some(9200),
        database: None,
        username: None,
        password: None,
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
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
