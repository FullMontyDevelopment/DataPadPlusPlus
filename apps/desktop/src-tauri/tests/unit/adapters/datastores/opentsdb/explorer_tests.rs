use serde_json::json;

use super::{
    aggregator_nodes, default_query_template, diagnostics, downsampling_nodes, normalize_stats,
    normalize_trees, opentsdb_object_view, parse_string_array, root_nodes, uid_metadata_records,
};

#[test]
fn opentsdb_default_query_template_uses_metric() {
    let template = default_query_template("sys.cpu.user");
    assert!(template.contains("\"metric\": \"sys.cpu.user\""));
    assert!(template.contains("\"aggregator\": \"avg\""));
}

#[test]
fn opentsdb_root_uses_native_metric_tag_and_guidance_sections() {
    let nodes = root_nodes();
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Metrics",
            "Tags",
            "Aggregators",
            "Downsampling",
            "UID Metadata",
            "Trees",
            "Stats",
            "Diagnostics"
        ]
    );
}

#[test]
fn opentsdb_aggregator_and_downsampling_nodes_are_query_guidance_not_fake_metrics() {
    let aggregators = aggregator_nodes();
    let downsampling = downsampling_nodes();

    assert_eq!(aggregators[0].kind, "aggregator");
    assert_eq!(aggregators[0].label, "avg");
    assert_eq!(downsampling[0].kind, "downsampler");
    assert_eq!(downsampling[0].label, "1m-avg");
}

#[test]
fn opentsdb_string_array_parser_reads_suggest_responses() {
    let values = parse_string_array(r#"["sys.cpu.user","http.requests"]"#).unwrap();

    assert_eq!(values, vec!["sys.cpu.user", "http.requests"]);
}

#[test]
fn opentsdb_stats_are_normalized_for_object_views() {
    let stats = normalize_stats(&json!([
        { "metric": "tsd.rpc.received", "value": 42 },
        { "metric": "tsd.http.query.latency_95pct", "value": 84 }
    ]));

    assert_eq!(stats[0]["name"], "tsd.rpc.received");
    assert_eq!(stats[1]["unit"], "latency");
}

#[test]
fn opentsdb_node_ids_map_to_object_views() {
    assert_eq!(opentsdb_object_view("opentsdb:metrics"), "metrics");
    assert_eq!(opentsdb_object_view("metric:sys.cpu.user"), "metric");
    assert_eq!(opentsdb_object_view("tag:host"), "tag");
    assert_eq!(opentsdb_object_view("aggregator:avg"), "aggregator");
    assert_eq!(opentsdb_object_view("downsampler:1m-avg"), "downsampler");
    assert_eq!(
        opentsdb_object_view("opentsdb:uid-metadata"),
        "uid-metadata"
    );
    assert_eq!(opentsdb_object_view("uid:metric:sys.cpu.user"), "uid");
    assert_eq!(opentsdb_object_view("opentsdb:trees"), "trees");
    assert_eq!(opentsdb_object_view("tree:service-map"), "tree");
    assert_eq!(opentsdb_object_view("opentsdb:diagnostics"), "diagnostics");
}

#[test]
fn opentsdb_diagnostics_are_view_friendly() {
    let diagnostics = diagnostics(
        &[json!({ "name": "sys.cpu.user" })],
        &[json!({ "name": "host" })],
        &[],
    );

    assert_eq!(diagnostics[0]["signal"], "Metric Metadata");
    assert_eq!(diagnostics[2]["status"], "watch");
}

#[test]
fn opentsdb_uid_metadata_is_derived_without_raw_api_payloads() {
    let rows = uid_metadata_records(
        &[json!({ "name": "sys.cpu.user", "uid": "000001" })],
        &[json!({ "name": "host" })],
        &[json!({ "value": "app-1" })],
    );

    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["kind"], "metric");
    assert_eq!(rows[0]["uid"], "000001");
    assert_eq!(rows[1]["kind"], "tagk");
    assert_eq!(rows[2]["kind"], "tagv");
}

#[test]
fn opentsdb_trees_are_normalized_for_native_view() {
    let trees = normalize_trees(&json!([
        {
            "name": "service-map",
            "enabled": true,
            "rules": [{ "field": "host" }],
            "collisions": 0,
            "description": "Service hierarchy"
        }
    ]));

    assert_eq!(trees.len(), 1);
    assert_eq!(trees[0]["name"], "service-map");
    assert_eq!(trees[0]["rules"], 1);
    assert_eq!(trees[0]["description"], "Service hierarchy");
}
