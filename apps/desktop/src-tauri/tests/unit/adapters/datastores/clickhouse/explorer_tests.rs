use super::{
    clickhouse_base_payload, clickhouse_column_records, clickhouse_database_from_node_id,
    clickhouse_database_records, clickhouse_object_view_kind, clickhouse_table_records, root_nodes,
    split_clickhouse_tables_by_kind,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn clickhouse_inspection_payload_is_view_friendly_without_raw_diagnostics_dump() {
    let payload = clickhouse_base_payload(&connection(), "clickhouse-database-default", "database");

    assert_eq!(payload["objectView"], "database");
    assert!(payload.get("api").is_none());
    assert!(payload["tables"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn clickhouse_node_ids_map_to_warehouse_object_views() {
    assert_eq!(
        clickhouse_object_view_kind("warehouse:databases"),
        "databases"
    );
    assert_eq!(clickhouse_object_view_kind("warehouse:tables"), "tables");
    assert_eq!(clickhouse_object_view_kind("warehouse:views"), "views");
    assert_eq!(
        clickhouse_object_view_kind("warehouse:materialized-views"),
        "materialized-views"
    );
    assert_eq!(
        clickhouse_object_view_kind("warehouse:warehouses"),
        "warehouses"
    );
    assert_eq!(clickhouse_object_view_kind("warehouse:jobs"), "jobs");
    assert_eq!(
        clickhouse_object_view_kind("warehouse:security"),
        "security"
    );
    assert_eq!(
        clickhouse_object_view_kind("warehouse:diagnostics"),
        "diagnostics"
    );
    assert_eq!(
        clickhouse_object_view_kind("clickhouse-database-default"),
        "database"
    );
    assert_eq!(
        clickhouse_object_view_kind("clickhouse-database-tables:default"),
        "tables"
    );
    assert_eq!(clickhouse_object_view_kind("table:default:events"), "table");
    assert_eq!(clickhouse_object_view_kind("view:default:v"), "view");
    assert_eq!(
        clickhouse_object_view_kind("materialized-view:default:mv"),
        "materialized-view"
    );
    assert_eq!(clickhouse_object_view_kind("default.events"), "table");
    assert_eq!(clickhouse_object_view_kind("default.events:id"), "table");
    assert_eq!(clickhouse_object_view_kind("anything"), "databases");
}

#[test]
fn clickhouse_root_uses_warehouse_sections() {
    let labels = root_nodes(&connection())
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Databases",
            "Tables",
            "Views",
            "Materialized Views",
            "Clusters",
            "Query Log",
            "Security",
            "Diagnostics"
        ]
    );
}

#[test]
fn clickhouse_database_from_section_node_uses_actual_database_name() {
    assert_eq!(
        clickhouse_database_from_node_id("clickhouse-database-tables:analytics"),
        Some("analytics".into())
    );
    assert_eq!(
        clickhouse_database_from_node_id("database:default"),
        Some("default".into())
    );
}

#[test]
fn clickhouse_database_records_filter_database_names() {
    let rows = clickhouse_database_records(Some("default\nsystem\n"), Some("default"));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "default");
}

#[test]
fn clickhouse_table_records_split_tables_and_views() {
    let rows = clickhouse_table_records(
        "default\tevents\tMergeTree\t10\t2048\ndefault\tevents_view\tView\t0\t0\n",
    );
    let (tables, views, materialized_views) = split_clickhouse_tables_by_kind(rows);

    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0]["name"], "events");
    assert_eq!(views.len(), 1);
    assert_eq!(views[0]["name"], "events_view");
    assert!(materialized_views.is_empty());
}

#[test]
fn clickhouse_table_records_split_materialized_views_separately() {
    let rows = clickhouse_table_records(
        "default\tevents\tMergeTree\t10\t2048\ndefault\tevents_v\tView\t0\t0\ndefault\tevents_mv\tMaterializedView\t0\t512\n",
    );
    let (tables, views, materialized_views) = split_clickhouse_tables_by_kind(rows);

    assert_eq!(tables.len(), 1);
    assert_eq!(views.len(), 1);
    assert_eq!(materialized_views.len(), 1);
    assert_eq!(materialized_views[0]["name"], "events_mv");
}

#[test]
fn clickhouse_column_records_capture_nullable_and_defaults() {
    let rows = clickhouse_column_records("id\tUInt64\t\nname\tNullable(String)\tDEFAULT\n");

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["nullable"], "no");
    assert_eq!(rows[1]["nullable"], "yes");
    assert_eq!(rows[1]["mode"], "DEFAULT");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-clickhouse".into(),
        name: "ClickHouse".into(),
        engine: "clickhouse".into(),
        family: "warehouse".into(),
        host: "127.0.0.1".into(),
        port: Some(8123),
        database: Some("default".into()),
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
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
        read_only: true,
    }
}
