use super::apply_scoped_target_override;
use crate::domain::models::{
    CassandraConnectionOptions, CosmosDbConnectionOptions, PostgresConnectionOptions,
    RedisConnectionOptions, ResolvedConnectionProfile, ScopedQueryTarget,
    WarehouseConnectionOptions,
};

#[test]
fn scoped_target_overrides_mongodb_database_without_changing_the_saved_profile() {
    let mut connection = resolved_connection("mongodb", "document");
    let target = target(
        "collection",
        "orders",
        &["archive", "Collections"],
        "collection:archive:orders",
    );

    apply_scoped_target_override(&mut connection, Some(&target));

    assert_eq!(connection.database.as_deref(), Some("archive"));
}

#[test]
fn scoped_target_overrides_cassandra_keyspace_and_redis_database() {
    let mut cassandra = resolved_connection("cassandra", "widecolumn");
    cassandra.cassandra_options = Some(CassandraConnectionOptions::default());
    apply_scoped_target_override(
        &mut cassandra,
        Some(&target(
            "table",
            "orders",
            &["commerce", "Tables"],
            "table:commerce.orders",
        )),
    );
    assert_eq!(cassandra.database.as_deref(), Some("commerce"));
    assert_eq!(
        cassandra
            .cassandra_options
            .as_ref()
            .and_then(|options| options.default_keyspace.as_deref()),
        Some("commerce")
    );

    let mut redis = resolved_connection("redis", "keyvalue");
    redis.redis_options = Some(RedisConnectionOptions::default());
    apply_scoped_target_override(
        &mut redis,
        Some(&target("database", "DB 4", &["Databases"], "db:4")),
    );
    assert_eq!(
        redis
            .redis_options
            .as_ref()
            .and_then(|options| options.database_index),
        Some(4)
    );
}

#[test]
fn scoped_target_overrides_cosmos_database_and_container_for_execution_and_paging() {
    let mut connection = resolved_connection("cosmosdb", "document");
    connection.cosmos_db_options = Some(CosmosDbConnectionOptions::default());
    apply_scoped_target_override(
        &mut connection,
        Some(&target(
            "items",
            "Items",
            &["catalog", "Containers", "orders", "Items"],
            "cosmos:items:catalog:orders",
        )),
    );

    let options = connection.cosmos_db_options.as_ref().unwrap();
    assert_eq!(connection.database.as_deref(), Some("catalog"));
    assert_eq!(options.database_name.as_deref(), Some("catalog"));
    assert_eq!(options.container_prefix.as_deref(), Some("orders"));
}

#[test]
fn schema_only_sql_targets_do_not_replace_the_connection_database() {
    let mut connection = resolved_connection("postgresql", "sql");
    connection.postgres_options = Some(PostgresConnectionOptions::default());
    apply_scoped_target_override(
        &mut connection,
        Some(&target(
            "table",
            "accounts",
            &["public", "Tables"],
            "table:public.accounts",
        )),
    );
    assert_eq!(connection.database.as_deref(), Some("default_database"));
    assert_eq!(
        connection
            .postgres_options
            .as_ref()
            .and_then(|options| options.search_path.as_deref()),
        Some("public")
    );
}

#[test]
fn sql_targets_decode_database_and_schema_without_using_the_connection_name() {
    let mut sqlserver = resolved_connection("sqlserver", "sql");
    apply_scoped_target_override(
        &mut sqlserver,
        Some(&target(
            "table",
            "billing.invoices",
            &["Fixture sqlserver", "Databases", "archive", "Tables"],
            "table:archive:billing:invoices",
        )),
    );
    assert_eq!(sqlserver.database.as_deref(), Some("archive"));

    let mut oracle = resolved_connection("oracle", "sql");
    apply_scoped_target_override(
        &mut oracle,
        Some(&target(
            "table",
            "ACCOUNTS",
            &["Fixture oracle", "Databases", "FREEPDB1", "Tables"],
            "oracle:object:table:DATAPADPLUSPLUS:ACCOUNTS",
        )),
    );
    assert_eq!(oracle.database.as_deref(), Some("FREEPDB1"));
}

#[test]
fn warehouse_targets_apply_project_and_dataset_to_the_transient_profile() {
    let mut connection = resolved_connection("bigquery", "warehouse");
    connection.warehouse_options = Some(WarehouseConnectionOptions::default());
    apply_scoped_target_override(
        &mut connection,
        Some(&target(
            "table",
            "orders",
            &[
                "Projects",
                "commerce-project",
                "Datasets",
                "analytics",
                "Tables",
            ],
            "table:analytics:orders",
        )),
    );

    let options = connection.warehouse_options.as_ref().unwrap();
    assert_eq!(connection.database.as_deref(), Some("commerce-project"));
    assert_eq!(options.project_id.as_deref(), Some("commerce-project"));
    assert_eq!(options.dataset_id.as_deref(), Some("analytics"));
}

fn target(kind: &str, label: &str, path: &[&str], scope: &str) -> ScopedQueryTarget {
    ScopedQueryTarget {
        kind: kind.into(),
        label: label.into(),
        path: path.iter().map(|value| (*value).into()).collect(),
        scope: Some(scope.into()),
        query_template: None,
        preferred_builder: None,
    }
}

fn resolved_connection(engine: &str, family: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: format!("conn-{engine}"),
        name: format!("Fixture {engine}"),
        engine: engine.into(),
        family: family.into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("default_database".into()),
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
        read_only: false,
    }
}
