use super::*;

#[test]
fn typed_values_decode_to_native_bolt_values() {
    assert!(matches!(
        decode_value(&json!({"$neo4j":{"type":"date","value":"2026-08-31"}})).unwrap(),
        BoltType::Date(_)
    ));
    assert!(matches!(
        decode_value(&json!({"$neo4j":{"type":"bytes","value":"AAECAw=="}})).unwrap(),
        BoltType::Bytes(value) if value.value.as_ref() == [0, 1, 2, 3]
    ));
    assert!(matches!(
        decode_value(&json!({"$neo4j":{"type":"zoned-date-time","value":"2026-08-31T12:30:45.123456789","zoneId":"Africa/Johannesburg"}})).unwrap(),
        BoltType::DateTimeZoneId(value) if value.tz_id() == "Africa/Johannesburg"
    ));
}

#[test]
fn duration_parser_preserves_calendar_and_clock_components() {
    for input in ["P14M3DT4H5M6.000000700S", "P1Y2M3DT4H5M6.000000700S"] {
        let debug = format!("{:?}", parse_duration(input).unwrap());
        for expected in ["value: 14", "value: 3", "value: 14706", "value: 700"] {
            assert!(debug.contains(expected), "missing {expected} in {debug}");
        }
    }
}

#[test]
fn identifiers_are_escaped_and_invalid_controls_are_rejected() {
    assert_eq!(quote_identifier("Order`Line").unwrap(), "`Order``Line`");
    assert_eq!(
        quote_identifier("bad\nlabel").unwrap_err().code,
        "neo4j-import-record-invalid"
    );
}

#[test]
fn manifest_promotes_only_graph_transfer_not_backup() {
    let manifest = super::super::catalog::neo4j_manifest();
    let operations = super::super::catalog::neo4j_operation_manifests(&manifest);
    let transfer = operations
        .iter()
        .find(|value| value.id == "neo4j.data.import-export")
        .unwrap();
    let backup = operations
        .iter()
        .find(|value| value.id == "neo4j.data.backup-restore")
        .unwrap();
    assert_eq!(transfer.execution_support, "live");
    assert_eq!(transfer.preview_only, Some(false));
    assert_ne!(backup.execution_support, "live");
}

#[tokio::test]
async fn live_fixture_round_trip_preserves_graph_and_native_types() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = fixture_connection();
    let (graph, _, password) = neo4j_bolt_graph(&connection).await.unwrap();
    graph
        .run(query(
            "MATCH (n:TransferProbe {id:'dpp-transfer-probe'}) DETACH DELETE n",
        ))
        .await
        .unwrap();
    graph.run(query("MATCH (a:Account {id:'1'}) CREATE (t:TransferProbe {id:'dpp-transfer-probe', nativeDate:date('2026-08-31'), nativeDateTime:datetime('2026-08-31T12:30:45.123456789+02:00'), nativeDuration:duration('P14M3DT4H5M6.000000700S'), nativePoint:point({srid:4326, x:18.4241, y:-33.9249}), nativeBytes:$bytes}) CREATE (a)-[:TRANSFER_LINK {at:datetime('2026-08-31T10:30:45Z')}]->(t)")
        .param("bytes", vec![0_u8, 1, 2, 3, 254, 255]))
        .await
        .unwrap();
    let (before_nodes, before_relationships) = graph_counts(&graph).await;
    let path = std::env::temp_dir().join(format!(
        "datapad-neo4j-transfer-{:016x}.jsonl",
        rand::rng().random::<u64>()
    ));
    let exported = export_graph(&graph, &path, &password).await.unwrap();
    assert_eq!(exported["nodeCount"], json!(before_nodes));
    assert_eq!(exported["relationshipCount"], json!(before_relationships));

    graph.run(query("MATCH (n) DETACH DELETE n")).await.unwrap();
    let result = import_graph(&graph, &path, &password).await;
    if result.is_err() {
        let _ = import_graph(&graph, &path, &password).await;
    }
    let imported = result.unwrap();
    assert_eq!(imported["nodeCount"], json!(before_nodes));
    assert_eq!(imported["relationshipCount"], json!(before_relationships));
    assert_eq!(
        graph_counts(&graph).await,
        (before_nodes, before_relationships)
    );

    let mut types = graph.execute(query("MATCH (n:TransferProbe {id:'dpp-transfer-probe'}) RETURN valueType(n.nativeDate) AS dateType, valueType(n.nativeDateTime) AS dateTimeType, valueType(n.nativeDuration) AS durationType, valueType(n.nativePoint) AS pointType, valueType(n.nativeBytes) AS bytesType"))
        .await.unwrap();
    let row = types.next().await.unwrap().unwrap();
    for (column, expected) in [
        ("dateType", "DATE"),
        ("dateTimeType", "ZONED DATETIME"),
        ("durationType", "DURATION"),
        ("pointType", "POINT"),
        ("bytesType", "LIST<INTEGER"),
    ] {
        assert!(row.get::<String>(column).unwrap().starts_with(expected));
    }
    let conflict = import_graph(&graph, &path, &password).await.unwrap_err();
    assert_eq!(conflict.code, "neo4j-import-target-not-empty");

    graph
        .run(query(
            "MATCH (n:TransferProbe {id:'dpp-transfer-probe'}) DETACH DELETE n",
        ))
        .await
        .unwrap();
    let _ = std::fs::remove_file(path);
}

async fn graph_counts(graph: &Graph) -> (u64, u64) {
    let mut rows = graph.execute(query("CALL { MATCH (n) RETURN count(n) AS nodes } CALL { MATCH ()-[r]->() RETURN count(r) AS relationships } RETURN nodes, relationships"))
        .await.unwrap();
    let row = rows.next().await.unwrap().unwrap();
    (
        row.get::<i64>("nodes").unwrap() as u64,
        row.get::<i64>("relationships").unwrap() as u64,
    )
}

fn fixture_connection() -> ResolvedConnectionProfile {
    let port = std::env::var("DATAPADPLUSPLUS_NEO4J_BOLT_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(7688);
    ResolvedConnectionProfile {
        id: "fixture-neo4j-transfer".into(),
        name: "Fixture Neo4j transfer".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
        database: Some("neo4j".into()),
        username: Some("neo4j".into()),
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
        graph_options: Some(crate::domain::models::GraphConnectionOptions {
            connect_mode: Some("neo4j-bolt".into()),
            ..crate::domain::models::GraphConnectionOptions::default()
        }),
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
