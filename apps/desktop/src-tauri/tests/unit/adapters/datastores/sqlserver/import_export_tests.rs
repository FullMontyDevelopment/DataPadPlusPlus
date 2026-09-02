use super::*;
use rand::RngExt;

#[test]
fn parses_quoted_sqlserver_names() {
    assert_eq!(
        parse_qualified_sqlserver_name("[dbo].[Accounts]"),
        Some(("dbo".into(), "Accounts".into()))
    );
    assert_eq!(
        parse_qualified_sqlserver_name("[odd.schema].[account.name]"),
        Some(("odd.schema".into(), "account.name".into()))
    );
    assert_eq!(
        parse_qualified_sqlserver_name("Accounts"),
        Some(("dbo".into(), "Accounts".into()))
    );
}

#[test]
fn builds_sqlserver_import_statement() {
    let columns = vec!["active".into(), "id".into(), "profile".into()];

    assert_eq!(
        sqlserver_insert_statement("dbo", "Accounts", &columns),
        "insert into [dbo].[Accounts] ([active], [id], [profile]) values (@P1, @P2, @P3);"
    );
}

#[test]
fn sqlserver_csv_parser_handles_quotes_and_newlines() {
    let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

    assert_eq!(rows[0], vec!["id", "name"]);
    assert_eq!(rows[1], vec!["1", "A, B"]);
    assert_eq!(rows[2], vec!["2", "line\nbreak"]);
}

#[test]
fn import_columns_are_deterministic() {
    let records = vec![BTreeMap::from([
        ("name".into(), json!("Acme")),
        ("id".into(), json!(1)),
    ])];

    assert_eq!(import_columns(&records), vec!["id", "name"]);
}

#[test]
fn validates_server_locations_and_database_names() {
    assert_eq!(
        server_location_clause("/var/opt/mssql/data/backup.bak")
            .unwrap()
            .0,
        "server-path"
    );
    assert_eq!(
        server_location_clause("D:\\backups\\backup.bak").unwrap().0,
        "server-path"
    );
    assert_eq!(
        server_location_clause("https://storage.example/backups/backup.bak")
            .unwrap()
            .0,
        "cloud-uri"
    );
    assert_eq!(
        server_location_clause("https://storage.example/backup.bak?sig=secret")
            .unwrap_err()
            .code,
        "sqlserver-transfer-url-secret-rejected"
    );
    assert!(validate_database_name("restored_database-1", "target").is_ok());
    assert!(validate_database_name("bad/name", "target").is_err());
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn live_fixture_creates_verifies_and_restores_native_backup() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    use crate::domain::models::SqlServerConnectionOptions;
    let suffix = rand::rng().random::<u32>();
    let backup_path = format!("/var/opt/mssql/data/datapad_transfer_{suffix}.bak");
    let restored_database = format!("datapad_transfer_{suffix}");
    let connection = fixture_connection();
    let backup = native_sqlserver_backup(&connection, "datapadplusplus", &backup_path)
        .await
        .unwrap();
    assert_eq!(backup["format"], "bak");
    assert_eq!(backup["checksumVerified"], true);
    assert_eq!(
        native_sqlserver_backup(&connection, "datapadplusplus", &backup_path)
            .await
            .unwrap_err()
            .code,
        "sqlserver-backup-target-exists"
    );
    let restored = native_sqlserver_restore(&connection, &backup_path, &restored_database)
        .await
        .unwrap();
    assert_eq!(restored["databaseState"], "ONLINE");
    assert_eq!(
        native_sqlserver_restore(&connection, &backup_path, &restored_database)
            .await
            .unwrap_err()
            .code,
        "sqlserver-restore-target-exists"
    );
    let mut restored_connection = connection.clone();
    restored_connection.database = Some(restored_database.clone());
    let mut restored_client = sqlserver_client(&restored_connection).await.unwrap();
    let rows = restored_client
        .simple_query("SELECT COUNT_BIG(*) AS row_count FROM dbo.accounts")
        .await
        .unwrap()
        .into_first_result()
        .await
        .unwrap();
    assert!(rows[0].get::<i64, _>("row_count").unwrap_or_default() > 0);
    drop(restored_client);
    let mut client = sqlserver_client(&connection).await.unwrap();
    cleanup_failed_restore(&mut client, &restored_database)
        .await
        .unwrap();

    fn fixture_connection() -> ResolvedConnectionProfile {
        let port = std::env::var("DATAPADPLUSPLUS_SQLSERVER_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(14333);
        ResolvedConnectionProfile {
            id: "fixture-sqlserver-transfer".into(),
            name: "Fixture SQL Server transfer".into(),
            engine: "sqlserver".into(),
            family: "sql".into(),
            host: "127.0.0.1".into(),
            port: Some(port),
            database: Some("datapadplusplus".into()),
            username: Some("sa".into()),
            password: Some("DataPadPlusPlus_pwd_123".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: Some(SqlServerConnectionOptions {
                authentication_mode: Some("sql-server".into()),
                trust_server_certificate: Some(true),
                ..SqlServerConnectionOptions::default()
            }),
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
}

#[test]
fn csv_escape_quotes_special_fields() {
    assert_eq!(csv_escape("A, B"), "\"A, B\"");
    assert_eq!(csv_escape("A \"B\""), "\"A \"\"B\"\"\"");
    assert_eq!(csv_escape("plain"), "plain");
}
