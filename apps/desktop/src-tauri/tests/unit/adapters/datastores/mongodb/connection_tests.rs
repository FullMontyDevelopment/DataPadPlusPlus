use super::*;

#[test]
fn mongodb_uri_uses_admin_auth_source_for_database_connections() {
    let connection = resolved_connection(Some("catalog"));

    assert_eq!(
        mongodb_uri(&connection),
        "mongodb://datapadplusplus:datapadplusplus@localhost:27018/catalog?authSource=admin"
    );
}

#[test]
fn mongodb_uri_does_not_append_auth_source_to_connection_strings() {
    let mut connection = resolved_connection(Some("catalog"));
    connection.connection_string =
        Some("mongodb://user:secret@localhost:27018/catalog?authSource=app".into());

    assert_eq!(
        mongodb_uri(&connection),
        "mongodb://user:secret@localhost:27018/catalog?authSource=app"
    );
}

#[test]
fn mongodb_uri_uses_admin_database_without_extra_auth_source() {
    let connection = resolved_connection(Some("admin"));

    assert_eq!(
        mongodb_uri(&connection),
        "mongodb://datapadplusplus:datapadplusplus@localhost:27018/admin"
    );
}

#[test]
fn mongodb_uri_treats_empty_database_as_admin() {
    let connection = resolved_connection(Some(""));

    assert_eq!(
        mongodb_uri(&connection),
        "mongodb://datapadplusplus:datapadplusplus@localhost:27018/admin"
    );
}

#[test]
fn mongodb_database_name_uses_connection_string_database_when_profile_database_is_empty() {
    let mut connection = resolved_connection(Some(""));
    connection.connection_string =
        Some("mongodb://user:secret@localhost:27018/catalog?authSource=admin".into());

    assert_eq!(mongodb_database_name(&connection), "catalog");
}

#[test]
fn mongodb_database_name_ignores_empty_connection_string_path() {
    let mut connection = resolved_connection(None);
    connection.connection_string = Some("mongodb://localhost:27018/?authSource=admin".into());

    assert_eq!(mongodb_database_name(&connection), "admin");
}

#[test]
fn mongodb_database_name_from_query_prefers_explicit_database_field() {
    let connection = resolved_connection(Some("admin"));
    let input = serde_json::json!({
        "database": "catalog",
        "collection": "products",
        "filter": {}
    });

    assert_eq!(
        mongodb_database_name_from_query(&input, &connection),
        Some(("catalog".into(), true))
    );
}

#[test]
fn mongodb_database_name_from_query_falls_back_to_connection_database() {
    let connection = resolved_connection(Some("catalog"));
    let input = serde_json::json!({
        "collection": "products",
        "filter": {}
    });

    assert_eq!(
        mongodb_database_name_from_query(&input, &connection),
        Some(("catalog".into(), false))
    );
}

#[test]
fn mongodb_database_name_from_query_does_not_fall_back_to_admin() {
    let connection = resolved_connection(None);
    let input = serde_json::json!({
        "collection": "products",
        "filter": {}
    });

    assert_eq!(mongodb_database_name_from_query(&input, &connection), None);
    assert_eq!(
        mongodb_database_name_from_command(&input, &connection),
        "admin"
    );
}

#[test]
fn mongodb_uri_percent_encodes_field_credentials() {
    let mut connection = resolved_connection(Some("catalog"));
    connection.username = Some("user@example.com".into());
    connection.password = Some("p@ss word".into());

    assert_eq!(
        mongodb_uri(&connection),
        "mongodb://user%40example.com:p%40ss%20word@localhost:27018/catalog?authSource=admin"
    );
}

fn resolved_connection(database: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-mongo".into(),
        name: "Fixture MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "localhost".into(),
        port: Some(27018),
        database: database.map(str::to_string),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
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
