use super::*;
use crate::domain::models::{CockroachConnectionCapabilities, PostgresConnectionOptions};

#[test]
fn cockroach_explorer_hides_profile_restricted_native_surfaces() {
    let connection = connection_with_capabilities(CockroachConnectionCapabilities {
        inspect_jobs: Some(false),
        inspect_ranges: Some(false),
        inspect_regions: Some(true),
        inspect_cluster_status: Some(true),
        inspect_cluster_settings: Some(false),
        inspect_sessions: Some(true),
        inspect_contention: Some(false),
        inspect_roles_and_grants: Some(true),
        inspect_certificates: Some(false),
        inspect_zone_configurations: Some(false),
        explain_analyze: Some(false),
    });

    let root_labels = cockroach_root_nodes(&connection)
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();
    assert!(!root_labels.contains(&"Jobs".into()));
    assert!(!root_labels.contains(&"Ranges".into()));
    assert!(!root_labels.contains(&"Contention".into()));
    assert!(root_labels.contains(&"Regions and localities".into()));
    assert!(root_labels.contains(&"Sessions".into()));

    assert!(cockroach_section_nodes(&connection, "cockroach:ranges").is_empty());
    assert!(cockroach_section_nodes(&connection, "cockroach:contention").is_empty());
    assert!(!cockroach_section_nodes(&connection, "cockroach:regions").is_empty());
}

#[tokio::test]
async fn cockroach_direct_inspection_reports_restricted_profile_capability() {
    let connection = connection_with_capabilities(CockroachConnectionCapabilities {
        inspect_jobs: Some(true),
        inspect_ranges: Some(false),
        inspect_regions: Some(true),
        inspect_cluster_status: Some(true),
        inspect_cluster_settings: Some(true),
        inspect_sessions: Some(true),
        inspect_contention: Some(true),
        inspect_roles_and_grants: Some(true),
        inspect_certificates: Some(true),
        inspect_zone_configurations: Some(true),
        explain_analyze: Some(false),
    });

    let (_, query_template, payload) = inspect_cockroach_node(&connection, "cockroach:ranges")
        .await
        .expect("restricted range payload");

    assert!(query_template.contains("hidden by profile capability"));
    assert_eq!(
        payload.get("kind").and_then(Value::as_str),
        Some("restricted")
    );
    assert!(payload
        .get("warnings")
        .and_then(Value::as_array)
        .expect("warnings")
        .iter()
        .any(|warning| warning
            .as_str()
            .unwrap_or_default()
            .contains("range metadata")));
}

fn connection_with_capabilities(
    capabilities: CockroachConnectionCapabilities,
) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cockroach".into(),
        name: "CockroachDB".into(),
        engine: "cockroachdb".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(26257),
        database: Some("defaultdb".into()),
        username: Some("root".into()),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: Some(PostgresConnectionOptions {
            cockroach_capabilities: Some(capabilities),
            ..PostgresConnectionOptions::default()
        }),
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
