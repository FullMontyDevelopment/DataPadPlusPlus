use duckdb::Connection;

use super::{
    database_child_nodes, duckdb_column_records, duckdb_object_from_scope, duckdb_object_view_kind,
    duckdb_select_template, duckdb_table_and_view_records, root_nodes, table_nodes,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn duckdb_select_template_quotes_schema_and_table() {
    assert_eq!(
        duckdb_select_template("main.orders"),
        "select * from \"main\".\"orders\" limit 100;"
    );
}

#[test]
fn duckdb_node_ids_map_to_object_view_kinds() {
    assert_eq!(duckdb_object_view_kind("duckdb:database"), "database");
    assert_eq!(duckdb_object_view_kind("schema:main"), "schema");
    assert_eq!(duckdb_object_view_kind("tables:main"), "tables");
    assert_eq!(duckdb_object_view_kind("views:main"), "views");
    assert_eq!(duckdb_object_view_kind("indexes:main"), "indexes");
    assert_eq!(duckdb_object_view_kind("functions:main"), "functions");
    assert_eq!(duckdb_object_view_kind("table:main:orders"), "table");
    assert_eq!(duckdb_object_view_kind("view:main:order_view"), "view");
    assert_eq!(duckdb_object_view_kind("duckdb:files"), "files");
    assert_eq!(duckdb_object_view_kind("duckdb:pragmas"), "pragmas");
    assert_eq!(duckdb_object_view_kind("duckdb-table:main.orders"), "table");
    assert_eq!(duckdb_object_view_kind("duckdb-extensions"), "extensions");
    assert_eq!(
        duckdb_object_view_kind("duckdb-extension:parquet"),
        "extension"
    );
    assert_eq!(duckdb_object_view_kind("duckdb-root"), "database");
}

#[test]
fn duckdb_root_uses_local_olap_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "datapad.duckdb",
            "Attached Databases",
            "Extensions",
            "Files",
            "Pragmas",
            "Diagnostics"
        ]
    );
    assert!(nodes
        .iter()
        .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
}

#[test]
fn duckdb_database_scope_returns_schema_sections() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("create table orders(id integer);")
        .unwrap();
    let nodes = database_child_nodes(&connection(), &db).unwrap();

    assert!(nodes.iter().any(|node| node.label == "main"));
    assert!(nodes.iter().any(|node| node.label == "Statistics"));
}

#[test]
fn duckdb_schema_tables_and_views_are_split_for_tree_nodes() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "create table orders(id integer); create view order_view as select * from orders;",
    )
    .unwrap();

    let tables = table_nodes(&connection(), &db, "main", false, Some(100)).unwrap();
    let views = table_nodes(&connection(), &db, "main", true, Some(100)).unwrap();

    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].id, "table:main:orders");
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, "view:main:order_view");
}

#[test]
fn duckdb_modern_table_scope_becomes_qualified_table_name() {
    assert_eq!(
        duckdb_object_from_scope("table:main:orders"),
        Some("main.orders".into())
    );
    assert_eq!(
        duckdb_object_from_scope("view:analytics:daily_revenue"),
        Some("analytics.daily_revenue".into())
    );
}

#[test]
fn duckdb_table_and_view_records_split_catalog_objects() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "create table orders(id integer); create view order_view as select * from orders;",
    )
    .unwrap();
    let (tables, views) = duckdb_table_and_view_records(&db, None).unwrap();

    assert!(tables.iter().any(|row| row["name"] == "orders"));
    assert!(views.iter().any(|row| row["name"] == "order_view"));
}

#[test]
fn duckdb_column_records_include_types_and_nullability() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("create table orders(id integer not null, name varchar);")
        .unwrap();
    let rows = duckdb_column_records(&db, "main.orders").unwrap();

    assert_eq!(rows[0]["name"], "id");
    assert_eq!(rows[0]["type"], "INTEGER");
    assert_eq!(rows[0]["nullable"], "NO");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-duckdb".into(),
        name: "DuckDB".into(),
        engine: "duckdb".into(),
        family: "embedded-olap".into(),
        host: "tests/fixtures/duckdb/datapad.duckdb".into(),
        port: None,
        database: Some("tests/fixtures/duckdb/datapad.duckdb".into()),
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
