use super::*;

pub(super) fn fixture_environments(
    created_at: &str,
    sqlite_fixture: &str,
) -> Vec<EnvironmentProfile> {
    let mut variables = HashMap::new();
    variables.insert("FIXTURE_HOST".into(), "127.0.0.1".into());
    variables.insert("SQLITE_FIXTURE".into(), sqlite_fixture.into());

    vec![
        EnvironmentProfile {
            id: "env-fixtures".into(),
            label: "Fixtures".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables,
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-fixtures-prod-sim".into(),
            label: "Fixture Prod Sim".into(),
            color: "#ec7b7b".into(),
            risk: "critical".into(),
            inherits_from: Some("env-fixtures".into()),
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: true,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
    ]
}

pub(super) fn screenshot_environments(
    created_at: &str,
    sqlite_fixture: &str,
) -> Vec<EnvironmentProfile> {
    let mut variables = HashMap::new();
    variables.insert("FIXTURE_HOST".into(), "127.0.0.1".into());
    variables.insert("SQLITE_FIXTURE".into(), sqlite_fixture.into());
    variables.insert("REGION".into(), "emea".into());
    variables.insert("TENANT".into(), "acme-demo".into());
    variables.insert("LOOKBACK_DAYS".into(), "14".into());
    variables.insert("LIMIT".into(), "50".into());

    vec![
        EnvironmentProfile {
            id: "env-local-demo".into(),
            label: "Local Demo".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables,
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-staging".into(),
            label: "Staging".into(),
            color: "#f0bf4f".into(),
            risk: "medium".into(),
            inherits_from: Some("env-local-demo".into()),
            variables: HashMap::from([
                ("TENANT".into(), "acme-staging".into()),
                ("LOOKBACK_DAYS".into(), "30".into()),
            ]),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-production-preview".into(),
            label: "Production Preview".into(),
            color: "#ec7b7b".into(),
            risk: "critical".into(),
            inherits_from: Some("env-staging".into()),
            variables: HashMap::from([
                ("TENANT".into(), "acme-production-preview".into()),
                ("LIMIT".into(), "100".into()),
            ]),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: true,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
    ]
}

pub(super) fn decorate_screenshot_connections(connections: &mut [ConnectionProfile]) {
    for connection in connections {
        if let Some((name, group, color, notes)) = screenshot_connection_display(&connection.id) {
            connection.name = name.into();
            connection.group = Some(group.into());
            connection.color = Some(color.into());
            connection.tags = screenshot_tags_for_connection(connection);
            connection.notes = Some(notes.into());
            connection.favorite = matches!(
                connection.id.as_str(),
                "fixture-postgresql"
                    | "fixture-mongodb"
                    | "fixture-redis"
                    | "fixture-opensearch"
                    | "fixture-clickhouse"
                    | "fixture-neo4j"
            );
            connection.environment_ids = vec![
                "env-local-demo".into(),
                "env-staging".into(),
                "env-production-preview".into(),
            ];
            connection.read_only = true;
        }
    }
}

pub(super) fn screenshot_connection_display(
    id: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    Some(match id {
        "fixture-postgresql" => (
            "Northwind Analytics PostgreSQL",
            "Commerce",
            "#2dbf9b",
            "Curated relational demo for revenue, orders, and operational health screenshots.",
        ),
        "fixture-sqlserver" => (
            "Operations SQL Server",
            "Operations",
            "#4aa3ff",
            "Operational order and support data with recent activity views.",
        ),
        "fixture-mysql" => (
            "Inventory MySQL",
            "Commerce",
            "#f0a95b",
            "Inventory availability and catalog freshness for commerce workflows.",
        ),
        "fixture-sqlite" => (
            "Local Accounts SQLite",
            "Local Files",
            "#c9a86a",
            "Portable local-file account sample for import/export screenshots.",
        ),
        "fixture-mongodb" => (
            "Commerce Catalog MongoDB",
            "Commerce",
            "#5abf6f",
            "Document catalog, orders, and large-document samples for builder and browser views.",
        ),
        "fixture-redis" => (
            "Realtime Cache Redis",
            "Cache",
            "#d15b5b",
            "Hot keys, order streams, product inventory, and session cache samples.",
        ),
        "fixture-valkey" => (
            "Edge Cache Valkey",
            "Cache",
            "#c9463c",
            "Valkey cache data for stream and high-volume key screenshots.",
        ),
        "fixture-memcached" => (
            "Feature Flag Memcached",
            "Cache",
            "#8ac16f",
            "Simple product and feature-flag cache samples.",
        ),
        "fixture-mariadb" => (
            "Orders MariaDB",
            "Commerce",
            "#b98edb",
            "Order lifecycle data for SQL family comparison screenshots.",
        ),
        "fixture-cockroachdb" => (
            "Regional Accounts CockroachDB",
            "Commerce",
            "#6eb7ff",
            "Distributed SQL account sample with region-aware names.",
        ),
        "fixture-timescaledb" => (
            "Order Metrics TimescaleDB",
            "Analytics",
            "#55a8e6",
            "Hypertable order and service metrics for time-series screenshots.",
        ),
        "fixture-clickhouse" => (
            "Warehouse Events ClickHouse",
            "Analytics",
            "#f3d74f",
            "High-volume event analytics for warehouse result and profile views.",
        ),
        "fixture-influxdb" => (
            "Latency Metrics InfluxDB",
            "Analytics",
            "#8d74ff",
            "Service latency time-series data for operations dashboards.",
        ),
        "fixture-prometheus" => (
            "Service Health Prometheus",
            "Operations",
            "#e87941",
            "Prometheus health vectors for diagnostics screenshots.",
        ),
        "fixture-opensearch" => (
            "Search Catalog OpenSearch",
            "Search",
            "#5cb3ff",
            "Product and order indexes with facets, profiles, and diagnostics.",
        ),
        "fixture-elasticsearch" => (
            "Search Orders Elasticsearch",
            "Search",
            "#f0bf4f",
            "Order search index for search-family comparison screenshots.",
        ),
        "fixture-neo4j" => (
            "Customer Journey Neo4j",
            "Graph",
            "#4f8dff",
            "Graph sample for account, order, and journey path exploration.",
        ),
        "fixture-arangodb" => (
            "Graph Catalog ArangoDB",
            "Graph",
            "#75b84d",
            "Multi-model account and order graph sample.",
        ),
        "fixture-janusgraph" => (
            "Network Signals JanusGraph",
            "Graph",
            "#9a7bd7",
            "Graph traversal sample for wide graph integrations.",
        ),
        "fixture-cassandra" => (
            "Order Ledger Cassandra",
            "Cloud + Wide Column",
            "#64a6d8",
            "Wide-column order ledger data for table and key access screenshots.",
        ),
        "fixture-oracle" => (
            "Finance Operations Oracle",
            "Enterprise SQL",
            "#d85f4f",
            "Enterprise SQL sample with plans, packages, and operational order data.",
        ),
        "fixture-dynamodb" => (
            "Serverless Orders DynamoDB",
            "Cloud + Wide Column",
            "#5487e8",
            "Local DynamoDB order and event sample for cloud-contract screenshots.",
        ),
        "fixture-bigquery" => (
            "Marketing Analytics BigQuery",
            "Cloud Warehouse",
            "#669df6",
            "Mock BigQuery analytics endpoint for cloud warehouse screenshots.",
        ),
        "fixture-snowflake" => (
            "Revenue Warehouse Snowflake",
            "Cloud Warehouse",
            "#7dd3fc",
            "Mock Snowflake warehouse endpoint for BI-oriented screenshots.",
        ),
        "fixture-cosmosdb" => (
            "Customer Profiles Cosmos DB",
            "Cloud Document",
            "#58a6ff",
            "Mock Cosmos DB customer profile sample for document workflows.",
        ),
        "fixture-neptune" => (
            "Recommendation Graph Neptune",
            "Cloud Graph",
            "#64d2ff",
            "Mock Neptune recommendation graph sample.",
        ),
        _ => return None,
    })
}

pub(super) fn screenshot_tags_for_connection(connection: &ConnectionProfile) -> Vec<String> {
    let mut tags = vec![
        "screenshot".into(),
        "demo".into(),
        connection.family.clone(),
    ];
    if let Some(group) = &connection.group {
        tags.push(group.to_lowercase().replace([' ', '+'], "-"));
    }
    tags
}
