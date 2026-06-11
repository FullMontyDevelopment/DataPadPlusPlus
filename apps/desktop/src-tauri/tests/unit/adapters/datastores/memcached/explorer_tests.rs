use super::{
    diagnostic_records, item_records, known_key_actions, memcached_object_view,
    root_memcached_nodes, server_child_nodes, slab_records, stats_entries,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn memcached_root_uses_server_and_diagnostics_sections() {
    let connection = connection();
    let nodes = root_memcached_nodes(&connection);
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["Server", "Diagnostics"]);
    assert_eq!(nodes[0].id, "memcached:server");
    assert_eq!(nodes[0].scope.as_deref(), Some("memcached:server"));
}

#[test]
fn memcached_server_children_match_native_views() {
    let connection = connection();
    let nodes = server_child_nodes(&connection);
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Stats",
            "Slabs",
            "Item Classes",
            "Known Key Lookup",
            "Settings",
            "Connections"
        ]
    );
    assert!(nodes
        .iter()
        .any(|node| node.id == "memcached:slabs" && node.expandable == Some(true)));
    assert!(nodes.iter().any(|node| node.id == "memcached:known-key"
        && node.query_template.as_deref() == Some("get <key>")));
}

#[test]
fn memcached_stats_are_normalized_into_slabs_items_and_diagnostics() {
    let entries = stats_entries(query_records_for_test());
    let slabs = slab_records(&entries);
    let items = item_records(&entries);
    let diagnostics = diagnostic_records(&entries);

    assert_eq!(slabs[0]["classId"], "1");
    assert_eq!(slabs[0]["chunkSize"], 96);
    assert_eq!(items[0]["classId"], "1");
    assert_eq!(items[0]["number"], 10);
    assert_eq!(diagnostics[0]["signal"], "Hit Rate");
}

#[test]
fn memcached_node_ids_map_to_object_views() {
    assert_eq!(memcached_object_view("memcached:server"), "server");
    assert_eq!(memcached_object_view("memcached:slab:1"), "slab");
    assert_eq!(
        memcached_object_view("memcached:item-class:1"),
        "item-class"
    );
    assert_eq!(memcached_object_view("memcached:known-key"), "known-key");
    assert_eq!(memcached_object_view("memcached:unknown"), "diagnostics");
}

#[test]
fn memcached_known_key_actions_are_explicit_and_guarded() {
    let actions = known_key_actions();

    assert!(actions.iter().any(|action| action["action"] == "Get"));
    assert!(actions
        .iter()
        .any(|action| { action["action"] == "Delete" && action["risk"] == "destructive" }));
    assert!(actions
        .iter()
        .any(|action| { action["action"] == "Set" && action["status"] == "preview" }));
}

fn query_records_for_test() -> &'static str {
    "STAT curr_items 10\r\nSTAT bytes 2048\r\nSTAT limit_maxbytes 4096\r\nSTAT get_hits 90\r\nSTAT get_misses 10\r\nSTAT evictions 1\r\nSTAT curr_connections 2\r\nSTAT max_connections 100\r\nSTAT 1:chunk_size 96\r\nSTAT 1:chunks_per_page 10922\r\nSTAT 1:total_pages 1\r\nSTAT 1:used_chunks 10\r\nSTAT 1:free_chunks 2\r\nSTAT items:1:number 10\r\nSTAT items:1:age 30\r\nSTAT items:1:evicted 1\r\nSTAT items:1:outofmemory 0\r\nSTAT items:1:reclaimed 5\r\nEND\r\n"
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-memcached".into(),
        name: "Memcached".into(),
        engine: "memcached".into(),
        family: "keyvalue".into(),
        host: "localhost".into(),
        port: Some(11211),
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
        read_only: true,
    }
}
