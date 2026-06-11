use super::*;

#[test]
fn sqlite_select_template_escapes_identifiers() {
    assert_eq!(
        sqlite_select_template("main", "accounts"),
        "select * from [main].[accounts] limit 100;"
    );
    assert_eq!(
        sqlite_select_template("main", "odd]table"),
        "select * from [main].[odd]]table] limit 100;"
    );
}

#[test]
fn sqlite_database_nodes_match_native_sections() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-sections-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        sqlx::query("create view active_accounts as select id, name from accounts")
            .execute(&setup_pool)
            .await
            .expect("create accounts view");

        let connection = test_connection(path.to_string_lossy().as_ref());
        let labels = database_nodes(&connection, &setup_pool, "main")
            .await
            .expect("database sections")
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables".into()));
        assert!(labels.contains(&"Views".into()));
        assert!(labels.contains(&"Indexes".into()));
        assert!(labels.contains(&"Triggers".into()));
        assert!(!labels.contains(&"Virtual Tables".into()));
        assert!(!labels.contains(&"FTS Tables".into()));
        assert!(!labels.contains(&"RTree Tables".into()));
        assert!(!labels.contains(&"Pragmas".into()));
        assert!(!labels.contains(&"Schema".into()));

        setup_pool.close().await;
        let _ = std::fs::remove_file(&path);
    });
}

#[test]
fn sqlite_table_nodes_include_object_view_sections() {
    let connection = test_connection("fixture.sqlite");
    let labels = table_nodes(&connection, "main", "accounts")
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Columns",
            "Constraints",
            "Indexes",
            "Triggers",
            "Foreign Keys",
            "Statistics",
            "Data",
            "DDL"
        ]
    );
}

#[test]
fn inspect_sqlite_table_returns_non_saveable_view_hint() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-explorer-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        sqlx::query("create index accounts_name_idx on accounts(name)")
            .execute(&setup_pool)
            .await
            .expect("create accounts index");
        sqlx::query("create view active_accounts as select id, name from accounts")
            .execute(&setup_pool)
            .await
            .expect("create accounts view");
        setup_pool.close().await;

        let response = inspect_sqlite_explorer_node(
            &test_connection(path.to_string_lossy().as_ref()),
            &ExplorerInspectRequest {
                connection_id: "conn".into(),
                environment_id: "env".into(),
                node_id: "table:main:accounts".into(),
            },
        )
        .await
        .expect("inspect sqlite table");

        assert_eq!(
            response.query_template.as_deref(),
            Some("select * from [main].[accounts] limit 100;")
        );
        let payload = response.payload.expect("payload");
        assert_eq!(payload["objectView"], "table");
        assert_eq!(
            payload["definition"],
            "CREATE TABLE accounts (id integer primary key, name text not null)"
        );
        assert!(payload["columns"]
            .as_array()
            .is_some_and(|columns| columns.iter().any(|column| column["name"] == "name")));
        assert!(payload["indexes"].as_array().is_some_and(|indexes| indexes
            .iter()
            .any(|index| index["name"] == "accounts_name_idx")));

        let _ = std::fs::remove_file(&path);
    });
}

#[test]
fn inspect_sqlite_table_section_returns_native_section_view() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-section-inspect-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        setup_pool.close().await;

        let response = inspect_sqlite_explorer_node(
            &test_connection(path.to_string_lossy().as_ref()),
            &ExplorerInspectRequest {
                connection_id: "conn".into(),
                environment_id: "env".into(),
                node_id: "table-section:main:accounts:columns".into(),
            },
        )
        .await
        .expect("inspect sqlite table section");

        assert_eq!(
            response.query_template.as_deref(),
            Some("pragma [main].table_xinfo('accounts')")
        );
        let payload = response.payload.expect("payload");
        assert_eq!(payload["objectView"], "columns");
        assert_eq!(payload["objectName"], "accounts");
        assert!(payload["columns"]
            .as_array()
            .is_some_and(|columns| columns.iter().any(|column| column["name"] == "name")));

        let _ = std::fs::remove_file(&path);
    });
}

#[test]
fn sqlite_foreign_key_records_group_composite_keys() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-composite-fk-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query(
            "create table accounts (
                id integer not null,
                region text not null,
                primary key (id, region)
            )",
        )
        .execute(&pool)
        .await
        .expect("create accounts table");
        sqlx::query(
            "create table orders (
                id integer primary key,
                account_id integer,
                region text,
                foreign key (account_id, region)
                  references accounts(id, region)
                  on update cascade
                  on delete set null
            )",
        )
        .execute(&pool)
        .await
        .expect("create orders table");

        let payload = table_inspection_payload(&pool, "main", "orders")
            .await
            .expect("table payload");
        let foreign_keys = payload["foreignKeys"].as_array().expect("foreign keys");

        assert_eq!(foreign_keys.len(), 1);
        assert_eq!(foreign_keys[0]["from"], "orders.account_id, region");
        assert_eq!(foreign_keys[0]["columns"], "account_id, region");
        assert_eq!(foreign_keys[0]["table"], "accounts");
        assert_eq!(foreign_keys[0]["to"], "accounts.id, region");
        assert_eq!(foreign_keys[0]["referencedColumns"], "id, region");
        assert_eq!(foreign_keys[0]["onUpdate"], "CASCADE");
        assert_eq!(foreign_keys[0]["onDelete"], "SET NULL");

        pool.close().await;
        let _ = std::fs::remove_file(&path);
    });
}

fn test_connection(path: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-sqlite".into(),
        name: "SQLite".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: path.into(),
        port: None,
        database: Some(path.into()),
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
        warehouse_options: None,
        read_only: false,
    }
}
