use super::*;
use crate::domain::models::GraphConnectionOptions;

#[test]
fn manifest_promotes_only_graphson_data_transfer() {
    let manifest = super::super::catalog::janusgraph_manifest();
    let operations = super::super::catalog::janusgraph_operation_manifests(&manifest);
    let transfer = operations
        .iter()
        .find(|value| value.id == "janusgraph.data.import-export")
        .unwrap();
    let backup = operations
        .iter()
        .find(|value| value.id == "janusgraph.data.backup-restore")
        .unwrap();
    assert_eq!(transfer.execution_support, "live");
    assert_eq!(transfer.preview_only, Some(false));
    assert_ne!(backup.execution_support, "live");
}

#[test]
fn transfer_queries_use_bindings_and_preserve_graph_shape() {
    for expected in ["vertex.id()", "property.id()", "property.properties()"] {
        assert!(VERTEX_PAGE_QUERY.contains(expected));
    }
    for expected in ["edge.id()", "outVertex().id()", "inVertex().id()"] {
        assert!(EDGE_PAGE_QUERY.contains(expected));
    }
    assert!(IMPORT_VERTICES_QUERY.contains("transferVertices[row.id]"));
    assert!(IMPORT_EDGES_QUERY.contains("transferVertices[row.outId]"));
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn live_fixture_round_trip_preserves_graphson_values_and_conflicts() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = fixture_connection(false);
    let _ = janusgraph_run_gremlin(
        &connection,
        "g.V().hasLabel('TransferProbe').drop().iterate(); graph.tx().commit(); true",
    )
    .await;
    janusgraph_run_gremlin(
        &connection,
        "def a = g.V().hasLabel('Account').limit(1).next(); def probe = graph.addVertex(org.apache.tinkerpop.gremlin.structure.T.label, 'TransferProbe', 'transferProbe', true, 'nativeLong', 9223372036854775806L, 'nativeDouble', 1234567890.125d, 'nativeInstant', java.time.Instant.parse('2026-08-31T10:30:45.123456789Z'), 'nativeBytes', [0,1,2,254,255] as byte[]); a.addEdge('TRANSFER_LINK', probe, 'weight', 7.125d); graph.tx().commit(); true",
    )
    .await
    .unwrap();
    let before_vertices = fixture_count(&connection, "g.V().count()").await;
    let before_edges = fixture_count(&connection, "g.E().count()").await;
    let path = std::env::temp_dir().join(format!(
        "datapad-janusgraph-transfer-{:016x}.graphson",
        rand::rng().random::<u64>()
    ));
    let _ = std::fs::remove_file(&path);
    let exported = export_graph(&connection, &path).await.unwrap();
    assert_eq!(exported["vertexCount"], json!(before_vertices));
    assert_eq!(exported["edgeCount"], json!(before_edges));
    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(contents.contains("g:Int64"));
    assert!(contents.contains("g:Double"));
    assert!(contents.contains("gx:Instant"));
    assert!(contents.contains("janusgraph-byte-array"));

    janusgraph_run_gremlin(
        &connection,
        "g.V().drop().iterate(); graph.tx().commit(); true",
    )
    .await
    .unwrap();
    let invalid_path = path.with_extension("invalid.graphson");
    let mut invalid_lines = contents
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    let invalid_edge = invalid_lines
        .iter_mut()
        .find(|line| line.get("kind").and_then(Value::as_str) == Some("edge"))
        .unwrap();
    replace_graphson_map_field(
        invalid_edge.get_mut("graphson").unwrap(),
        "outId",
        json!({"@type":"g:Int64","@value":-1}),
    );
    let invalid_contents = invalid_lines
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    std::fs::write(&invalid_path, invalid_contents).unwrap();
    assert!(import_graph(&connection, &invalid_path).await.is_err());
    assert_eq!(fixture_count(&connection, "g.V().count()").await, 0);
    assert_eq!(fixture_count(&connection, "g.E().count()").await, 0);
    let _ = std::fs::remove_file(invalid_path);

    let imported = import_graph(&connection, &path).await.unwrap();
    assert_eq!(imported["vertexCount"], json!(before_vertices));
    assert_eq!(imported["edgeCount"], json!(before_edges));
    assert_eq!(
        fixture_count(&connection, "g.V().count()").await,
        before_vertices
    );
    assert_eq!(
        fixture_count(&connection, "g.E().count()").await,
        before_edges
    );
    let verification = janusgraph_run_gremlin(
        &connection,
        "def probe = g.V().hasLabel('TransferProbe').next(); def p = probe.value('nativeInstant'); [instant:p.getClass().name, longValue:probe.value('nativeLong'), bytes:(probe.value('nativeBytes') as byte[]).collect{ it as int }, edgeCount:g.E().hasLabel('TRANSFER_LINK').count().next()]",
    )
    .await
    .unwrap();
    let values = verification["result"]["data"].as_array().unwrap();
    let field = |name: &str| {
        values
            .iter()
            .find_map(|value| value.get(name))
            .cloned()
            .unwrap_or(Value::Null)
    };
    assert_eq!(field("instant"), "java.time.Instant");
    assert_eq!(field("longValue"), json!(9_223_372_036_854_775_806_i64));
    assert_eq!(field("edgeCount"), json!(1));
    assert_eq!(field("bytes"), json!([0, 1, 2, -2, -1]));
    assert_eq!(
        import_graph(&connection, &path).await.unwrap_err().code,
        "janusgraph-import-target-not-empty"
    );
    janusgraph_run_gremlin(
        &connection,
        "g.V().hasLabel('TransferProbe').drop().iterate(); graph.tx().commit(); true",
    )
    .await
    .unwrap();
    let _ = std::fs::remove_file(path);
}

fn replace_graphson_map_field(value: &mut Value, key: &str, replacement: Value) {
    let entries = value
        .get_mut("@value")
        .and_then(Value::as_array_mut)
        .expect("GraphSON map entries");
    let index = entries
        .iter()
        .position(|value| value.as_str() == Some(key))
        .expect("GraphSON map field");
    entries[index + 1] = replacement;
}

async fn fixture_count(connection: &ResolvedConnectionProfile, query: &str) -> u64 {
    decoded_count(&janusgraph_run_gremlin(connection, query).await.unwrap()).unwrap()
}

fn fixture_connection(read_only: bool) -> ResolvedConnectionProfile {
    let port = std::env::var("DATAPADPLUSPLUS_JANUSGRAPH_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8183);
    ResolvedConnectionProfile {
        id: "fixture-janusgraph-transfer".into(),
        name: "Fixture JanusGraph transfer".into(),
        engine: "janusgraph".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
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
        graph_options: Some(GraphConnectionOptions {
            connect_mode: Some("gremlin-websocket".into()),
            traversal_source: Some("g".into()),
            query_timeout_ms: Some(120_000),
            ..GraphConnectionOptions::default()
        }),
        mongodb_options: None,
        warehouse_options: None,
        read_only,
    }
}
