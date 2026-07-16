use super::*;

pub(super) fn screenshot_tab_title(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
) -> String {
    let extension = seed
        .query_title
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("sql");
    format!("{} overview.{extension}", connection.name)
}

pub(super) fn screenshot_folder_for_connection(connection: &ConnectionProfile) -> String {
    match connection.group.as_deref() {
        Some("Commerce") => "Commerce".into(),
        Some("Operations") => "Operations".into(),
        Some("Cache") => "Cache".into(),
        Some("Search") => "Search".into(),
        Some("Analytics") | Some("Cloud Warehouse") => "Analytics".into(),
        Some("Graph") | Some("Cloud Graph") => "Graph".into(),
        Some("Enterprise SQL") => "Operations/Enterprise".into(),
        Some("Cloud + Wide Column") | Some("Cloud Document") => "Cloud Contracts".into(),
        Some("Local Files") => "Local Files".into(),
        _ => "Showcase".into(),
    }
}

pub(super) fn screenshot_saved_work(
    connections: &[ConnectionProfile],
    environment_id: &str,
    created_at: &str,
) -> Vec<SavedWorkItem> {
    [
        (
            "saved-screenshot-revenue-by-region",
            "Revenue by region",
            "Regional revenue and order volume for the current demo window.",
            "Commerce",
            "fixture-postgresql",
            "sql",
            "select region, count(*) as orders, sum(total_amount) as revenue\nfrom orders\nwhere updated_at >= now() - interval '${LOOKBACK_DAYS} days'\ngroup by region\norder by revenue desc\nlimit ${LIMIT};",
            &["commerce", "analytics", "revenue"][..],
        ),
        (
            "saved-screenshot-open-orders",
            "Open orders by status",
            "Operational order queue with bounded rows for safe screenshots.",
            "Commerce",
            "fixture-mariadb",
            "sql",
            "select status, count(*) as orders, max(updated_at) as latest_update\nfrom orders\ngroup by status\norder by orders desc\nlimit ${LIMIT};",
            &["commerce", "orders", "operations"][..],
        ),
        (
            "saved-screenshot-support-queue",
            "Customer support queue",
            "Recent support tickets with priority and account context.",
            "Operations",
            "fixture-sqlserver",
            "sql",
            "select top 50 ticket_id, account_id, priority, status, updated_at\nfrom dbo.support_tickets\norder by updated_at desc;",
            &["operations", "support", "queue"][..],
        ),
        (
            "saved-screenshot-product-facets",
            "Product search with facets",
            "Search catalog query with category and inventory aggregations.",
            "Search",
            "fixture-opensearch",
            "json",
            "{\n  \"index\": \"products\",\n  \"query\": { \"match_all\": {} },\n  \"aggs\": {\n    \"categories\": { \"terms\": { \"field\": \"category.keyword\", \"size\": 8 } },\n    \"availability\": { \"terms\": { \"field\": \"availability.keyword\" } }\n  },\n  \"size\": 25\n}",
            &["search", "catalog", "facets"][..],
        ),
        (
            "saved-screenshot-hot-cache-keys",
            "Hot product keys",
            "Bounded cache scan for product inventory and session keys.",
            "Cache",
            "fixture-redis",
            "redis",
            "SCAN 0 MATCH product:* COUNT 50",
            &["cache", "redis", "keys"][..],
        ),
        (
            "saved-screenshot-recent-order-stream",
            "Recent order stream",
            "Stream read for order fulfillment events.",
            "Cache",
            "fixture-redis",
            "redis",
            "XREVRANGE stream:orders + - COUNT 25",
            &["cache", "streams", "orders"][..],
        ),
        (
            "saved-screenshot-daily-order-metrics",
            "Daily order metrics",
            "Time-series order volume and latency for the active region.",
            "Analytics",
            "fixture-timescaledb",
            "sql",
            "select time_bucket('1 day', time) as day, region, sum(orders) as orders, avg(latency_ms) as avg_latency_ms\nfrom order_metrics\nwhere time >= now() - interval '${LOOKBACK_DAYS} days'\ngroup by day, region\norder by day desc, region\nlimit ${LIMIT};",
            &["analytics", "timeseries", "orders"][..],
        ),
        (
            "saved-screenshot-funnel-conversion",
            "Funnel conversion",
            "Warehouse event funnel for the screenshot demo tenant.",
            "Analytics",
            "fixture-clickhouse",
            "sql",
            "select event_type, count() as events, avg(latency_ms) as avg_latency_ms\nfrom analytics.events\nwhere tenant = '${TENANT}'\ngroup by event_type\norder by events desc\nlimit ${LIMIT};",
            &["analytics", "warehouse", "funnel"][..],
        ),
        (
            "saved-screenshot-customer-journeys",
            "Customer journey paths",
            "Graph traversal for customers, orders, and product touchpoints.",
            "Graph",
            "fixture-neo4j",
            "cypher",
            "MATCH path = (account)-[*1..3]-(order)\nRETURN path\nLIMIT 25",
            &["graph", "journey", "customers"][..],
        ),
    ]
    .into_iter()
    .filter(|item| connections.iter().any(|connection| connection.id == item.4))
    .map(
        |(id, name, summary, folder, connection_id, language, query_text, tags)| SavedWorkItem {
            id: id.into(),
            kind: "query".into(),
            name: name.into(),
            summary: summary.into(),
            tags: tags.iter().map(|tag| (*tag).into()).collect(),
            updated_at: created_at.into(),
            folder: Some(folder.into()),
            favorite: Some(true),
            connection_id: Some(connection_id.into()),
            environment_id: Some(environment_id.into()),
            language: Some(language.into()),
            query_text: Some(query_text.into()),
            snapshot_result_id: None,
        },
    )
    .collect()
}

pub(super) fn screenshot_api_server_preferences(
    connections: &[ConnectionProfile],
    environment_id: &str,
) -> DatastoreApiServerPreferences {
    let connection_id = connections
        .iter()
        .find(|connection| connection.id == "fixture-postgresql")
        .or_else(|| connections.first())
        .map(|connection| connection.id.clone());

    DatastoreApiServerPreferences {
        enabled: true,
        host: "127.0.0.1".into(),
        port: 17640,
        auto_start: false,
        connection_id: connection_id.clone(),
        environment_id: Some(environment_id.into()),
        active_server_id: Some("api-server-screenshot".into()),
        servers: vec![DatastoreApiServerConfig {
            id: "api-server-screenshot".into(),
            name: "Showcase API Server".into(),
            description: Some("Read-only local API profile for website screenshots.".into()),
            host: "127.0.0.1".into(),
            port: 17640,
            auto_start: false,
            protocol: "rest".into(),
            base_path: "/showcase".into(),
            connection_id,
            environment_id: Some(environment_id.into()),
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
        }],
    }
}

pub(super) fn screenshot_mcp_server_preferences(
    connections: &[ConnectionProfile],
    environment_id: &str,
) -> DatastoreMcpServerPreferences {
    DatastoreMcpServerPreferences {
        enabled: true,
        host: "127.0.0.1".into(),
        port: 17641,
        auto_start: false,
        active_server_id: Some("mcp-server-screenshot".into()),
        servers: vec![DatastoreMcpServerConfig {
            id: "mcp-server-screenshot".into(),
            name: "Showcase MCP Server".into(),
            description: Some("Local-only MCP profile with allowlisted demo datastores.".into()),
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: false,
            allowed_origins: Vec::new(),
            connection_ids: connections
                .iter()
                .filter(|connection| {
                    matches!(
                        connection.id.as_str(),
                        "fixture-postgresql"
                            | "fixture-mongodb"
                            | "fixture-redis"
                            | "fixture-opensearch"
                            | "fixture-clickhouse"
                            | "fixture-neo4j"
                    )
                })
                .map(|connection| connection.id.clone())
                .collect(),
            environment_ids: vec![environment_id.into()],
            tokens: Vec::new(),
        }],
    }
}
