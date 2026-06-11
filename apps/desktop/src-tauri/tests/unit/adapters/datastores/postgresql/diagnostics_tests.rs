use serde_json::json;

use super::{dead_row_ratio, push_pg_metric, quote_pg_identifier};

#[test]
fn skips_missing_postgres_metrics() {
    let mut metrics = Vec::new();

    push_pg_metric(
        &mut metrics,
        "postgres.present",
        Some(7.0),
        "rows",
        json!({}),
    );
    push_pg_metric(&mut metrics, "postgres.missing", None, "rows", json!({}));

    assert_eq!(metrics.len(), 1);
    assert_eq!(metrics[0]["name"], "postgres.present");
}

#[test]
fn computes_dead_row_ratio_safely() {
    assert_eq!(dead_row_ratio(0.0, 0.0), 0.0);
    assert_eq!(dead_row_ratio(90.0, 10.0), 0.1);
}

#[test]
fn quotes_pg_extension_schema_identifiers() {
    assert_eq!(quote_pg_identifier("public"), "\"public\"");
    assert_eq!(quote_pg_identifier("pg\"ext"), "\"pg\"\"ext\"");
}
