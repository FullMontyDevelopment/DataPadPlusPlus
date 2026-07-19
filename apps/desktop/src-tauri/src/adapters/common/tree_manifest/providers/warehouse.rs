use super::super::*;

pub(super) fn bigquery_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("datasets", "Datasets", "datasets", "BigQuery datasets"),
        node(
            "tables",
            "Tables",
            "tables",
            "Partitioned and clustered tables",
        ),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized views",
        ),
        node(
            "stages",
            "External Tables",
            "stages",
            "External tables and object sources",
        ),
        node(
            "warehouses",
            "Reservations",
            "warehouses",
            "Slots, reservations, and assignments",
        ),
        node("jobs", "Jobs", "jobs", "Query and load jobs"),
        node("security", "Security", "security", "IAM and dataset access"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Slots, bytes, jobs, and cost metadata",
        ),
    ]
}

pub(super) fn warehouse_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let compute_label = if engine == "clickhouse" {
        "Clusters"
    } else {
        "Warehouses"
    };
    let jobs_label = if engine == "snowflake" {
        "Tasks & Query History"
    } else {
        "Jobs"
    };
    let stage_label = if engine == "clickhouse" {
        "External Tables"
    } else {
        "Stages"
    };

    vec![
        node(
            "databases",
            "Databases",
            "databases",
            &format!("{engine} databases"),
        ),
        node("tables", "Tables", "tables", "Tables"),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized views",
        ),
        node(
            "stages",
            stage_label,
            "stages",
            "Internal and external stages",
        ),
        node(
            "warehouses",
            compute_label,
            "warehouses",
            "Compute warehouses",
        ),
        node(
            "jobs",
            jobs_label,
            "jobs",
            "Query history, jobs, and scheduled work",
        ),
        node("security", "Security", "security", "Roles and grants"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Query history, cost, and utilization",
        ),
    ]
}
