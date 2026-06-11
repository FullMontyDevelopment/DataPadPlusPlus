use super::{oracle_connect_descriptor, oracle_service_name, oracle_sqlplus_path};
use crate::domain::models::{OracleConnectionOptions, ResolvedConnectionProfile};

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-oracle".into(),
        name: "Oracle".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "dbhost".into(),
        port: None,
        database: Some("FREEPDB1".into()),
        username: Some("APP".into()),
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
        read_only: true,
    }
}

#[test]
fn oracle_descriptor_uses_default_port_and_service() {
    assert_eq!(oracle_service_name(&connection()), "FREEPDB1");
    assert_eq!(
        oracle_connect_descriptor(&connection()),
        "dbhost:1521/FREEPDB1"
    );
}

#[test]
fn oracle_descriptor_supports_sid_and_tns_modes() {
    let mut sid = connection();
    sid.oracle_options = Some(OracleConnectionOptions {
        connect_mode: Some("sid".into()),
        sid: Some("FREE".into()),
        ..Default::default()
    });
    assert_eq!(oracle_connect_descriptor(&sid), "dbhost:1521:FREE");

    let mut tns = connection();
    tns.oracle_options = Some(OracleConnectionOptions {
        connect_mode: Some("tns-alias".into()),
        tns_alias: Some("SALES_PDB".into()),
        ..Default::default()
    });
    assert_eq!(oracle_connect_descriptor(&tns), "SALES_PDB");
}

#[test]
fn oracle_descriptor_supports_cloud_wallet_service() {
    let mut connection = connection();
    connection.oracle_options = Some(OracleConnectionOptions {
        connect_mode: Some("cloud-wallet".into()),
        service_name: Some("sales_high".into()),
        wallet_path: Some("C:/wallets/sales".into()),
        application_name: Some("DataPad++".into()),
        fetch_size: Some(250),
        ..Default::default()
    });

    assert_eq!(
        oracle_connect_descriptor(&connection),
        "tcps://dbhost:1521/sales_high"
    );
}

#[test]
fn oracle_sqlplus_path_requires_runtime_or_path() {
    assert_eq!(oracle_sqlplus_path(&connection()), None);

    let mut with_path = connection();
    with_path.oracle_options = Some(OracleConnectionOptions {
        sql_plus_path: Some("C:/oracle/bin/sqlplus.exe".into()),
        ..Default::default()
    });
    assert_eq!(
        oracle_sqlplus_path(&with_path),
        Some("C:/oracle/bin/sqlplus.exe".into())
    );

    let mut with_runtime = connection();
    with_runtime.oracle_options = Some(OracleConnectionOptions {
        execution_runtime: Some("sqlplus".into()),
        ..Default::default()
    });
    assert_eq!(oracle_sqlplus_path(&with_runtime), Some("sqlplus".into()));
}
