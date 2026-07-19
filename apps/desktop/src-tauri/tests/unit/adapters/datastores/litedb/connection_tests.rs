use super::{litedb_file_path, litedb_local_file_preflight, litedb_sidecar_path};
use crate::domain::models::ResolvedConnectionProfile;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-litedb".into(),
        name: "LiteDB".into(),
        engine: "litedb".into(),
        family: "document".into(),
        host: "catalog.db".into(),
        port: None,
        database: None,
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

#[test]
fn litedb_file_path_prefers_connection_string() {
    let mut connection = connection();
    connection.connection_string = Some("litedb://C:/data/app.db".into());

    assert_eq!(litedb_file_path(&connection), "C:/data/app.db");
}

#[test]
fn litedb_connection_string_options_extract_file_sidecar_and_password() {
    let mut connection = connection();
    connection.connection_string = Some(
        "Filename=C:/data/app.db;Password=secret;SidecarPath=C:/tools/litedb-sidecar.exe".into(),
    );

    assert_eq!(litedb_file_path(&connection), "C:/data/app.db");
    assert_eq!(
        litedb_sidecar_path(&connection),
        Some("C:/tools/litedb-sidecar.exe".into())
    );
    assert_eq!(
        litedb_local_file_preflight(&connection, false)["passwordConfigured"],
        true
    );

    connection.connection_string =
        Some("litedb://C:/data/app.db?sidecarPath=C:/tools/sidecar.exe".into());
    assert_eq!(litedb_file_path(&connection), "C:/data/app.db");
    assert_eq!(
        litedb_sidecar_path(&connection),
        Some("C:/tools/sidecar.exe".into())
    );
}

#[test]
fn litedb_local_file_preflight_reports_file_and_sidecar_boundary() {
    let mut connection = connection();
    let file_path = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-preflight-{}.db",
        std::process::id()
    ));
    std::fs::write(&file_path, b"litedb fixture").unwrap();
    connection.host = file_path.to_string_lossy().to_string();
    connection.password = Some("secret".into());
    connection.read_only = false;

    let preflight = litedb_local_file_preflight(&connection, true);

    assert_eq!(preflight["fileKind"], "local-file");
    assert_eq!(preflight["exists"], true);
    assert_eq!(preflight["readProbe"]["status"], "ok");
    assert!(matches!(
        preflight["writeProbe"]["status"].as_str(),
        Some("ok") | Some("blocked")
    ));
    assert_eq!(preflight["encryptionBoundary"]["passwordConfigured"], true);
    assert_eq!(
        preflight["sidecarExecutionBoundary"]["status"],
        "plan-only-until-sidecar"
    );
    assert_eq!(
        preflight["lockBoundary"]["exclusiveWriterLockValidated"],
        false
    );

    let _ = std::fs::remove_file(file_path);
}

#[test]
fn litedb_read_only_preflight_blocks_write_probe_without_mutation() {
    let mut connection = connection();
    let file_path = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-readonly-preflight-{}.db",
        std::process::id()
    ));
    std::fs::write(&file_path, b"litedb fixture").unwrap();
    connection.host = file_path.to_string_lossy().to_string();
    connection.read_only = true;

    let preflight = litedb_local_file_preflight(&connection, true);

    assert_eq!(preflight["exists"], true);
    assert_eq!(preflight["writeProbe"]["status"], "blocked");
    assert_eq!(preflight["writeProbe"]["reason"], "connection-read-only");
    assert_eq!(preflight["writeProbe"]["mutatesFile"], false);

    let _ = std::fs::remove_file(file_path);
}
