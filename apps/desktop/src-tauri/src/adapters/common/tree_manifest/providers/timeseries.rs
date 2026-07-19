use super::super::*;

pub(super) fn prometheus_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "metrics",
            "Metrics",
            "metrics",
            "Prometheus metric families",
        ),
        node("labels", "Labels", "labels", "Metric labels"),
        node("targets", "Targets", "targets", "Scrape targets"),
        node("rules", "Rules", "rules", "Recording and alerting rules"),
        node("alerts", "Alerts", "alerts", "Alert states"),
        node(
            "service-discovery",
            "Service Discovery",
            "service-discovery",
            "Discovered and dropped targets",
        ),
        node(
            "tsdb",
            "TSDB Status",
            "tsdb",
            "Head series, chunks, blocks, WAL, and retention",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "TSDB, runtime, and status metadata",
        ),
    ]
}

pub(super) fn influx_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "selected-bucket",
            "{{database}}",
            "bucket",
            "Selected InfluxDB bucket",
            influx_bucket_children(),
            NodeOptions::requires_database(),
        ),
        node_with(
            "buckets",
            "Buckets",
            "buckets",
            "InfluxDB buckets",
            Vec::new(),
            NodeOptions::hidden_when_database_selected(),
        ),
        node("tasks", "Tasks", "tasks", "Scheduled Flux tasks"),
        node(
            "security",
            "Tokens",
            "security",
            "Authorizations and bucket scopes",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Cardinality, storage, and query health",
        ),
    ]
}

fn influx_bucket_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "measurements",
            "Measurements",
            "measurements",
            "Measurement names",
        ),
        node("tags", "Tags", "tags", "Indexed tag keys and values"),
        node("fields", "Fields", "fields", "Field keys and value types"),
        node(
            "retention-policies",
            "Retention Policies",
            "retention-policies",
            "Retention and shard groups",
        ),
    ]
}

pub(super) fn open_tsdb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("metrics", "Metrics", "metrics", "OpenTSDB metric names"),
        node("tags", "Tags", "tags", "Tag keys and values"),
        node(
            "aggregators",
            "Aggregators",
            "aggregators",
            "Supported aggregation functions",
        ),
        node(
            "downsampling",
            "Downsampling",
            "downsampling",
            "Downsample windows and fill policies",
        ),
        node(
            "uid-metadata",
            "UID Metadata",
            "uid-metadata",
            "Metric and tag UID metadata",
        ),
        node("trees", "Trees", "trees", "OpenTSDB tree definitions"),
        node("stats", "Stats", "stats", "Runtime stats"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Backend health and query metadata",
        ),
    ]
}
