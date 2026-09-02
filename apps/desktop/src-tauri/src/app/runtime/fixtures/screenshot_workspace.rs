use super::*;

pub(super) fn screenshot_security_checks_snapshot(
    connections: &[ConnectionProfile],
    environment_id: &str,
) -> DatastoreSecurityCheckSnapshot {
    let connection_name = |id: &str, fallback: &str| {
        connections
            .iter()
            .find(|connection| connection.id == id)
            .map(|connection| connection.name.clone())
            .unwrap_or_else(|| fallback.into())
    };
    let checked_at = "2026-09-02T09:30:00Z".to_owned();

    DatastoreSecurityCheckSnapshot {
        status: "ready".into(),
        checked_at: Some(checked_at.clone()),
        expires_at: Some("2026-09-09T09:30:00Z".into()),
        source_metadata: Vec::new(),
        targets: vec![
            DatastoreSecurityTarget {
                id: "security-postgresql-development".into(),
                connection_id: "fixture-postgresql".into(),
                environment_id: environment_id.into(),
                connection_name: connection_name(
                    "fixture-postgresql",
                    "Northwind Analytics PostgreSQL",
                ),
                environment_name: "Development".into(),
                engine: "postgresql".into(),
                family: "sql".into(),
                status: "checked".into(),
                detected_product: Some("PostgreSQL".into()),
                detected_version: Some("16.4".into()),
                known_latest_version: None,
                recommended_version: None,
                version_status: Some("unknown".into()),
                version_source: None,
                version_source_label: None,
                version_source_url: None,
                version_source_updated_at: None,
                cpe_candidates: Vec::new(),
                finding_count: 0,
                highest_severity: None,
                last_checked_at: Some(checked_at.clone()),
                message: None,
                warnings: Vec::new(),
            },
            DatastoreSecurityTarget {
                id: "security-mongodb-development".into(),
                connection_id: "fixture-mongodb".into(),
                environment_id: environment_id.into(),
                connection_name: connection_name(
                    "fixture-mongodb",
                    "Commerce Catalog MongoDB",
                ),
                environment_name: "Development".into(),
                engine: "mongodb".into(),
                family: "document".into(),
                status: "checked".into(),
                detected_product: Some("MongoDB".into()),
                detected_version: Some("7.0".into()),
                known_latest_version: None,
                recommended_version: None,
                version_status: Some("unknown".into()),
                version_source: None,
                version_source_label: None,
                version_source_url: None,
                version_source_updated_at: None,
                cpe_candidates: Vec::new(),
                finding_count: 0,
                highest_severity: None,
                last_checked_at: Some(checked_at),
                message: None,
                warnings: Vec::new(),
            },
        ],
        findings: Vec::new(),
        posture_checks: vec![
            DatastoreSecurityPostureCheckResult {
                id: "posture-postgresql-transport".into(),
                target_ids: vec!["security-postgresql-development".into()],
                rule_id: "profile.transport".into(),
                category: "transport".into(),
                status: "pass".into(),
                severity: "NONE".into(),
                title: "Transport encryption posture is acceptable".into(),
                summary: "The connection requires TLS and certificate verification.".into(),
                evidence: Some("SSL mode: verify-full.".into()),
                remediation: "Keep TLS and certificate verification enabled.".into(),
                source: "profile".into(),
                references: Vec::new(),
            },
            DatastoreSecurityPostureCheckResult {
                id: "posture-mongodb-authentication".into(),
                target_ids: vec!["security-mongodb-development".into()],
                rule_id: "profile.authentication".into(),
                category: "auth".into(),
                status: "warn".into(),
                severity: "MEDIUM".into(),
                title: "Review password authentication policy".into(),
                summary: "Confirm that the saved account follows the organization's rotation and least-privilege policy.".into(),
                evidence: Some(
                    "Authentication: password. Secret storage: encrypted reference.".into(),
                ),
                remediation: "Use a dedicated least-privileged account and rotate its credential on schedule.".into(),
                source: "profile".into(),
                references: Vec::new(),
            },
        ],
        warnings: Vec::new(),
        errors: Vec::new(),
    }
}

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
        Some("Cloud + Wide Column") | Some("Cloud Document") => "Cloud Services".into(),
        Some("Local Files") => "Local Files".into(),
        _ => "Examples".into(),
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
            "Regional revenue and order volume for the current reporting window.",
            "Commerce",
            "fixture-postgresql",
            "sql",
            "select region, count(*) as orders, sum(total_amount) as revenue\nfrom orders\nwhere updated_at >= now() - interval '${LOOKBACK_DAYS} days'\ngroup by region\norder by revenue desc\nlimit ${LIMIT};",
            &["commerce", "analytics", "revenue"][..],
        ),
        (
            "saved-screenshot-open-orders",
            "Open orders by status",
            "Operational order queue with a bounded result set.",
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
            "Warehouse event funnel for the selected tenant.",
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
            name: "Customer Data API".into(),
            description: Some("Read-only local API profile for approved data resources.".into()),
            host: "127.0.0.1".into(),
            port: 17640,
            auto_start: false,
            request_timeout_ms: None,
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
            name: "Analytics MCP Server".into(),
            description: Some(
                "Local-only MCP profile with allowlisted datastore connections.".into(),
            ),
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: false,
            request_timeout_ms: None,
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
            allow_no_environment: false,
            tokens: Vec::new(),
        }],
    }
}
