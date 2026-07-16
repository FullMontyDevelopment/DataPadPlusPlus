use super::{
    fixture_query_replacement, PROMETHEUS_FIXTURE_CONNECTION_ID, PROMETHEUS_FIXTURE_QUERY,
};

#[test]
fn prometheus_fixture_query_migration_replaces_only_the_legacy_seed() {
    assert_eq!(
        fixture_query_replacement(PROMETHEUS_FIXTURE_CONNECTION_ID, "up"),
        Some(PROMETHEUS_FIXTURE_QUERY)
    );
    assert_eq!(
        fixture_query_replacement(PROMETHEUS_FIXTURE_CONNECTION_ID, "rate(up[5m])"),
        None
    );
    assert_eq!(
        fixture_query_replacement("production-prometheus", "up"),
        None
    );
}
