use super::super::*;

pub(super) fn redis_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let engine_label = if engine == "valkey" {
        "Valkey"
    } else {
        "Redis"
    };
    let module_prefix = if engine == "valkey" {
        "Valkey-compatible"
    } else {
        "Redis Stack"
    };

    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            &format!("Logical {engine_label} databases"),
            vec![node_with(
                "db",
                "DB {{database:0}}",
                "database",
                &format!("{engine_label} logical database"),
                vec![
                    node("keys", "Keys", "keys", "All key types"),
                    node(
                        "strings",
                        "Strings",
                        "strings",
                        "String, bitmap, and HyperLogLog values",
                    ),
                    node("hashes", "Hashes", "hashes", "Hash maps"),
                    node("lists", "Lists", "lists", "Ordered list values"),
                    node("sets", "Sets", "sets", "Set values"),
                    node(
                        "sorted-sets",
                        "Sorted Sets",
                        "sorted-sets",
                        "Scored set values",
                    ),
                    node("streams", "Streams", "streams", "Append-only stream values"),
                    node_optional(
                        "json",
                        "JSON",
                        "json",
                        &format!("{module_prefix} JSON documents"),
                    ),
                    node_optional(
                        "time-series",
                        "Time Series",
                        "time-series",
                        &format!("{module_prefix} time-series keys"),
                    ),
                    node_optional(
                        "bloom-filters",
                        "Bloom Filters",
                        "bloom",
                        &format!("{module_prefix} Bloom filters"),
                    ),
                    node_optional(
                        "search-indexes",
                        "Search Indexes",
                        "search-indexes",
                        &format!("{module_prefix} search indexes"),
                    ),
                    node_optional(
                        "vector-indexes",
                        "Vector Indexes",
                        "vector-indexes",
                        &format!("{module_prefix} vector structures"),
                    ),
                    node_optional(
                        "pubsub",
                        "Pub/Sub",
                        "pubsub",
                        "Channels, patterns, and subscribers",
                    ),
                ],
                NodeOptions::default_database("0"),
            )],
            NodeOptions::default(),
        ),
        node_optional(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster slots, nodes, and failover status",
        ),
        node_optional(
            "sentinel",
            "Sentinel",
            "sentinel",
            "Sentinel masters, replicas, and failover status",
        ),
        node(
            "lua-scripts",
            "Lua Scripts",
            "lua-scripts",
            "Loaded scripts and SHA views",
        ),
        node_optional(
            "functions",
            "Functions",
            "functions",
            &format!("{engine_label} functions and libraries"),
        ),
        node(
            "security",
            "ACL / Security",
            "security",
            "ACL users, categories, and permissions",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "INFO, SLOWLOG, memory, and latency metadata",
        ),
    ]
}

pub(super) fn memcached_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "server",
            "Server",
            "server",
            "Memcached cache server overview",
            vec![
                node(
                    "stats",
                    "Stats",
                    "stats",
                    "Operational counters, hit rate, item count, and memory use",
                ),
                node(
                    "slabs",
                    "Slabs",
                    "slabs",
                    "Slab classes, chunk sizes, pages, and allocation pressure",
                ),
                node(
                    "items",
                    "Item Classes",
                    "items",
                    "Item-class counts, ages, evictions, and reclaim signals",
                ),
                node(
                    "known-key",
                    "Known Key Lookup",
                    "known-key",
                    "Targeted get/gets/write previews for application-known cache keys",
                ),
                node(
                    "settings",
                    "Settings",
                    "settings",
                    "Cache limits, protocol flags, and LRU behavior",
                ),
                node(
                    "connections",
                    "Connections",
                    "connections",
                    "Client connection pressure and rejected clients",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Hit ratio, evictions, memory pressure, and connection pressure",
        ),
    ]
}
