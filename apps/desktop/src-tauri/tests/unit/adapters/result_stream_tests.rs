use super::*;
use serde_json::json;

fn request(sql: &str) -> ExecutionRequest {
    serde_json::from_value(json!({
        "tabId": "export-fixture", "connectionId": "isolated", "environmentId": "test",
        "language": "sql", "queryText": sql, "rowLimit": 500
    }))
    .unwrap()
}

fn fixture_namespace() -> String {
    format!(
        "{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

#[test]
fn every_declared_engine_has_an_explicit_stream_capability() {
    let supported_engines = [
        "postgresql",
        "cockroachdb",
        "timescaledb",
        "mysql",
        "mariadb",
        "sqlite",
        "sqlserver",
        "oracle",
        "mongodb",
        "cosmosdb",
        "dynamodb",
        "cassandra",
        "elasticsearch",
        "opensearch",
        "arango",
        "litedb",
        "neo4j",
        "duckdb",
        "clickhouse",
        "redis",
        "valkey",
        "memcached",
        "influxdb",
    ];
    let manifests = crate::adapters::registry::manifests();
    for manifest in &manifests {
        assert_eq!(
            supported(&manifest.engine),
            supported_engines.contains(&manifest.engine.as_str()),
            "{}",
            manifest.engine
        );
    }
    assert!(!supported("unknown"));
}

#[test]
fn full_export_rejects_scripts_mutations_and_multi_statement_sql() {
    for sql in [
        "delete from items",
        "select 1; delete from items",
        "select 1; select 2",
        "select * from items for update",
        "with x as (delete from items returning *) select * from x",
    ] {
        assert!(validate_sql(&request(sql)).is_err(), "{sql}");
    }
    let mut script = request("select 1");
    script.execution_input_mode = Some("script".into());
    assert!(validate_sql(&script).is_err());
    assert!(validate_sql(&request("select 'λ; text' as value limit 3")).is_ok());
    // The shared safety classifier is intentionally conservative about write
    // tokens even inside literals; full export must not weaken that policy.
    assert!(validate_sql(&request("select 'delete; update' as text limit 3")).is_err());
}

#[tokio::test]
async fn dynamodb_count_export_is_rejected_before_opening_a_connection() {
    struct NoRows;
    impl ResultRowSink for NoRows {
        fn row(&mut self, _: Value) -> Result<bool, CommandError> {
            panic!("A count request must not be treated as an empty item stream");
        }
    }
    let connection = ResolvedConnectionProfile {
        engine: "dynamodb".into(),
        ..Default::default()
    };
    let request = request(r#"{"operation":"Scan","TableName":"isolated","Select":"COUNT"}"#);
    let error = stream(&connection, &request, &mut NoRows)
        .await
        .unwrap_err();
    assert_eq!(error.code, "result-export-unsupported");
}

struct CheckingSink {
    count: u64,
    stop: Option<u64>,
}
impl ResultRowSink for CheckingSink {
    fn row(&mut self, value: Value) -> Result<bool, CommandError> {
        self.count += 1;
        assert_eq!(value["id"], self.count);
        assert_eq!(value["text"], "λ");
        assert!(value["empty"].is_null());
        assert_eq!(value["bytes"], "0x00ff");
        Ok(self.stop.is_none_or(|stop| self.count < stop))
    }
}

#[tokio::test]
async fn sqlite_native_stream_is_not_capped_at_500_and_preserves_types_and_explicit_limits() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let connection = ResolvedConnectionProfile {
        engine: "sqlite".into(),
        database: Some(file.path().to_string_lossy().into_owned()),
        ..Default::default()
    };
    for total in [501, 1500, 50_000] {
        let sql = format!("with recursive values_to_export(id) as (select 1 union all select id+1 from values_to_export where id < {total}) select id, 'λ' as text, null as empty, x'00ff' as bytes from values_to_export");
        let mut sink = CheckingSink {
            count: 0,
            stop: None,
        };
        stream(&connection, &request(&sql), &mut sink)
            .await
            .unwrap();
        assert_eq!(sink.count, total);
        let mut limited = CheckingSink {
            count: 0,
            stop: None,
        };
        stream(
            &connection,
            &request(&format!("{sql} limit 17")),
            &mut limited,
        )
        .await
        .unwrap();
        assert_eq!(limited.count, 17);
        let mut canceled = CheckingSink {
            count: 0,
            stop: Some(9),
        };
        stream(&connection, &request(&sql), &mut canceled)
            .await
            .unwrap();
        assert_eq!(
            canceled.count, 9,
            "the adapter must honor sink backpressure"
        );
    }
}

#[tokio::test]
async fn duckdb_native_stream_preserves_counts_nulls_and_stops_on_backpressure() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("isolated.duckdb");
    drop(duckdb::Connection::open(&path).unwrap());
    let connection = ResolvedConnectionProfile {
        engine: "duckdb".into(),
        database: Some(path.to_string_lossy().into_owned()),
        ..Default::default()
    };
    struct Sink {
        count: usize,
        stop: Option<usize>,
    }
    impl ResultRowSink for Sink {
        fn row(&mut self, row: Value) -> Result<bool, CommandError> {
            self.count += 1;
            assert_eq!(row["id"], self.count.to_string());
            assert_eq!(row["text"], "Unicode λ");
            assert!(row["empty"].is_null());
            Ok(self.stop.is_none_or(|stop| self.count < stop))
        }
    }
    for total in [501, 1500, 50_000] {
        let query = request(&format!(
            "SELECT range + 1 AS id, 'Unicode λ' AS text, NULL AS empty FROM range({total})"
        ));
        let mut sink = Sink {
            count: 0,
            stop: None,
        };
        stream(&connection, &query, &mut sink).await.unwrap();
        assert_eq!(sink.count, total);
        let mut stopped = Sink {
            count: 0,
            stop: Some(9),
        };
        stream(&connection, &query, &mut stopped).await.unwrap();
        assert_eq!(stopped.count, 9);
    }
}

fn fixture_port(key: &str, fallback: u16) -> u16 {
    // These tests deliberately use loopback only, never workspace connections.
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/.generated.env");
    std::fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .find_map(|line| {
            line.strip_prefix(&format!("{key}="))
                .and_then(|port| port.parse().ok())
        })
        .unwrap_or(fallback)
}

#[tokio::test]
#[ignore = "requires isolated Docker SQL Server fixture"]
async fn sqlserver_live_result_stream_preserves_rows_types_and_authored_top() {
    let connection = ResolvedConnectionProfile {
        engine: "sqlserver".into(),
        host: "127.0.0.1".into(),
        port: Some(fixture_port("DATAPADPLUSPLUS_SQLSERVER_PORT", 14333)),
        database: Some("master".into()),
        username: Some("sa".into()),
        password: Some("DataPadPlusPlus_pwd_123".into()),
        read_only: true,
        ..Default::default()
    };
    for total in [17, 501, 1500] {
        let sql = format!("SELECT TOP ({total}) ROW_NUMBER() OVER (ORDER BY a.object_id, b.object_id) AS id, N'λ' AS text, CAST(NULL AS nvarchar(10)) AS empty, CAST(0x00ff AS varbinary(2)) AS bytes FROM sys.all_objects a CROSS JOIN sys.all_objects b ORDER BY id");
        let mut sink = CheckingSink {
            count: 0,
            stop: None,
        };
        stream(&connection, &request(&sql), &mut sink)
            .await
            .unwrap();
        assert_eq!(sink.count, total);
        let mut stopped = CheckingSink {
            count: 0,
            stop: Some(9),
        };
        stream(&connection, &request(&sql), &mut stopped)
            .await
            .unwrap();
        assert_eq!(stopped.count, 9);
    }
}

#[tokio::test]
#[ignore = "requires isolated Docker PostgreSQL fixture"]
async fn postgres_live_result_stream_preserves_all_rows_and_native_values() {
    let connection = ResolvedConnectionProfile {
        engine: "postgresql".into(),
        host: "127.0.0.1".into(),
        port: Some(fixture_port("DATAPADPLUSPLUS_POSTGRES_PORT", 54329)),
        database: Some("datapadplusplus".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        read_only: true,
        ..Default::default()
    };
    for total in [501, 1500, 50_000] {
        let sql = format!("select id, 'λ'::text as text, null::text as empty, decode('00ff', 'hex') as bytes from generate_series(1, {total}) id order by id");
        let mut sink = CheckingSink {
            count: 0,
            stop: None,
        };
        stream(&connection, &request(&sql), &mut sink)
            .await
            .unwrap();
        assert_eq!(sink.count, total);
        let mut limited = CheckingSink {
            count: 0,
            stop: None,
        };
        stream(
            &connection,
            &request(&format!("{sql} limit 17")),
            &mut limited,
        )
        .await
        .unwrap();
        assert_eq!(limited.count, 17);
        let mut stopped = CheckingSink {
            count: 0,
            stop: Some(9),
        };
        stream(&connection, &request(&sql), &mut stopped)
            .await
            .unwrap();
        assert_eq!(stopped.count, 9);
    }
}

#[tokio::test]
#[ignore = "requires isolated Docker Memcached fixture"]
async fn memcached_live_result_stream_preserves_all_explicit_keys_and_stops_on_request() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let port = fixture_port("DATAPADPLUSPLUS_MEMCACHED_PORT", 11212);
    let prefix = format!("datapad-export-{}", fixture_namespace());
    let keys = (0..1501)
        .map(|id| format!("{prefix}:{id}"))
        .collect::<Vec<_>>();
    let mut seed = String::new();
    for key in &keys {
        // Expiry also cleans up an interrupted/failed fixture run.
        seed.push_str(&format!("set {key} 17 120 6\r\nλ\r\nok\r\n"));
    }
    seed.push_str("quit\r\n");
    let mut client = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    client.write_all(seed.as_bytes()).await.unwrap();
    let mut reply = String::new();
    client.read_to_string(&mut reply).await.unwrap();
    assert_eq!(reply.lines().filter(|line| *line == "STORED").count(), 1501);
    let connection = ResolvedConnectionProfile {
        engine: "memcached".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
        read_only: true,
        ..Default::default()
    };
    struct Sink {
        keys: std::collections::HashSet<String>,
        stop: Option<usize>,
    }
    impl ResultRowSink for Sink {
        fn row(&mut self, row: Value) -> Result<bool, CommandError> {
            assert_eq!(row["value"], "λ\r\nok");
            assert_eq!(row["flags"], "17");
            assert!(self.keys.insert(row["key"].as_str().unwrap().into()));
            Ok(self.stop.is_none_or(|limit| self.keys.len() < limit))
        }
    }
    let mut all = Sink {
        keys: Default::default(),
        stop: None,
    };
    let result = stream(
        &connection,
        &request(&format!("get {}", keys.join(" "))),
        &mut all,
    )
    .await;
    let mut stopped = Sink {
        keys: Default::default(),
        stop: Some(9),
    };
    let stopped_result = stream(
        &connection,
        &request(&format!("gets {}", keys.join(" "))),
        &mut stopped,
    )
    .await;
    let mut cleanup = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    cleanup
        .write_all(
            format!(
                "{}quit\r\n",
                keys.iter()
                    .map(|key| format!("delete {key}\r\n"))
                    .collect::<String>()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut discarded = Vec::new();
    cleanup.read_to_end(&mut discarded).await.unwrap();
    result.unwrap();
    stopped_result.unwrap();
    assert_eq!(all.keys.len(), 1501);
    assert_eq!(stopped.keys.len(), 9);
}

#[tokio::test]
#[ignore = "requires isolated Docker InfluxDB fixture"]
async fn influxdb_live_result_stream_keeps_chunk_boundaries_types_and_query_limits() {
    let port = fixture_port("DATAPADPLUSPLUS_INFLUXDB_PORT", 8087);
    let measurement = format!("export_{}", fixture_namespace());
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");
    let body = (0..1500)
        .map(|id| {
            format!(
                "{measurement},region=test id={id}i,precise=9007199254740993i,text=\"λ\" {}\n",
                1_000_000_000_u64 + id
            )
        })
        .collect::<String>();
    client
        .post(format!("{base}/write"))
        .query(&[("db", "metrics"), ("precision", "ns")])
        .body(body)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let connection = ResolvedConnectionProfile {
        engine: "influxdb".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
        database: Some("metrics".into()),
        read_only: true,
        ..Default::default()
    };
    struct Sink {
        count: u64,
        stop: Option<u64>,
    }
    impl ResultRowSink for Sink {
        fn row(&mut self, row: Value) -> Result<bool, CommandError> {
            assert_eq!(row["fields"]["id"], self.count);
            assert_eq!(row["fields"]["precise"], 9007199254740993_i64);
            assert_eq!(row["fields"]["text"], "λ");
            self.count += 1;
            Ok(self.stop.is_none_or(|limit| self.count < limit))
        }
    }
    let mut query = request(
        &json!({"query":format!("select * from \"{measurement}\" order by time"),"epoch":"ns"})
            .to_string(),
    );
    query.row_limit = Some(7);
    let mut all = Sink {
        count: 0,
        stop: None,
    };
    let all_result = stream(&connection, &query, &mut all).await;
    let mut stopped = Sink {
        count: 0,
        stop: Some(9),
    };
    let stopped_result = stream(&connection, &query, &mut stopped).await;
    query.query_text = format!("select * from \"{measurement}\" order by time limit 501");
    let mut limited = Sink {
        count: 0,
        stop: None,
    };
    let limited_result = stream(&connection, &query, &mut limited).await;
    client
        .post(format!("{base}/query"))
        .query(&[
            ("db", "metrics"),
            ("q", &format!("drop measurement \"{measurement}\"")),
        ])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    all_result.unwrap();
    stopped_result.unwrap();
    limited_result.unwrap();
    assert_eq!(all.count, 1500);
    assert_eq!(stopped.count, 9);
    assert_eq!(limited.count, 501);
}

#[tokio::test]
#[ignore = "requires isolated Docker MongoDB fixture"]
async fn mongodb_live_result_stream_and_loaded_chunks_preserve_every_document() {
    use crate::app::runtime::result_sessions::{document_preview, ResultSession};
    use mongodb::bson::doc;
    let port = fixture_port("DATAPADPLUSPLUS_MONGODB_PORT", 27018);
    let uri = format!(
        "mongodb://datapadplusplus:datapadplusplus@127.0.0.1:{port}/admin?directConnection=true"
    );
    let client = mongodb::Client::with_uri_str(&uri).await.unwrap();
    let name = crate::app::runtime::generate_id("result_export");
    let collection = client
        .database("catalog")
        .collection::<mongodb::bson::Document>(&name);
    collection
        .insert_many((1..=1501).map(|id| {
            doc! {
                "_id": id, "nested": { "values": [1, 2, 3], "unicode": "λ" },
                "large": i64::MAX, "__datapadLazyNode": "legitimate user field",
            }
        }))
        .await
        .unwrap();
    let connection = ResolvedConnectionProfile {
        engine: "mongodb".into(),
        database: Some("catalog".into()),
        connection_string: Some(uri),
        read_only: true,
        ..Default::default()
    };
    let mut query =
        request(&json!({"collection": name, "filter": {}, "sort": {"_id": 1}}).to_string());
    query.language = "mongodb".into();
    // Runtime captures canonical values before deriving an efficiency-mode preview.
    query.document_efficiency_mode = Some(false);
    let result = crate::adapters::execute(&connection, &query, vec![])
        .await
        .unwrap();
    let mut session = ResultSession::new(query.clone(), connection.clone(), &result, None);
    let preview = document_preview(&result.payloads[0]);
    assert_eq!(preview["documents"][0]["nested"]["__datapadLazyNode"], true);
    for index in 1..=3 {
        let page_request = serde_json::from_value(json!({
            "tabId": query.tab_id, "connectionId": query.connection_id, "environmentId": query.environment_id,
            "language": "mongodb", "queryText": query.query_text, "renderer": "document",
            "pageSize": 500, "pageIndex": index, "documentEfficiencyMode": false
        })).unwrap();
        let mut page = crate::adapters::fetch_result_page(&connection, &page_request)
            .await
            .unwrap();
        session.append(&mut page).unwrap();
    }
    let documents = session.materialize("document").unwrap();
    let documents = documents["documents"].as_array().unwrap();
    assert_eq!(documents.len(), 1501);
    for (index, document) in documents.iter().enumerate() {
        assert_eq!(document["_id"], index + 1);
        assert_eq!(document["nested"]["values"], json!([1, 2, 3]));
        assert_eq!(document["large"]["$numberLong"], i64::MAX.to_string());
        assert_eq!(document["__datapadLazyNode"], "legitimate user field");
    }
    struct MongoSink(usize);
    impl ResultRowSink for MongoSink {
        fn row(&mut self, value: Value) -> Result<bool, CommandError> {
            self.0 += 1;
            assert_eq!(value["_id"], self.0);
            assert_eq!(value["nested"]["values"], json!([1, 2, 3]));
            Ok(true)
        }
    }
    let mut sink = MongoSink(0);
    stream(&connection, &query, &mut sink).await.unwrap();
    assert_eq!(sink.0, 1501);
    query.query_text =
        json!({"collection": name, "filter": {}, "sort": {"_id": 1}, "limit": 501}).to_string();
    let mut limited = MongoSink(0);
    stream(&connection, &query, &mut limited).await.unwrap();
    assert_eq!(limited.0, 501);
    collection.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated Docker Redis fixture"]
async fn redis_live_result_stream_keeps_scan_surplus_and_full_values() {
    let port = fixture_port("DATAPADPLUSPLUS_REDIS_PORT", 6380);
    let client = redis::Client::open(format!("redis://127.0.0.1:{port}/0")).unwrap();
    let mut redis = client.get_multiplexed_async_connection().await.unwrap();
    let key = crate::app::runtime::generate_id("result_export");
    let mut seed = redis::cmd("HSET");
    seed.arg(&key);
    for index in 0..1501 {
        seed.arg(format!("field-{index}")).arg(format!("λ-{index}"));
    }
    seed.query_async::<()>(&mut redis).await.unwrap();
    redis::cmd("EXPIRE")
        .arg(&key)
        .arg(120)
        .query_async::<()>(&mut redis)
        .await
        .unwrap();
    let connection = ResolvedConnectionProfile {
        engine: "redis".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
        database: Some("0".into()),
        read_only: true,
        ..Default::default()
    };
    struct RedisSink(std::collections::BTreeMap<String, String>);
    impl ResultRowSink for RedisSink {
        fn row(&mut self, value: Value) -> Result<bool, CommandError> {
            self.0.insert(
                value["field"].as_str().unwrap().into(),
                value["value"].as_str().unwrap().into(),
            );
            Ok(true)
        }
    }
    let mut query = request(&format!("HSCAN {key} 0 COUNT 7"));
    query.language = "redis".into();
    query.row_limit = Some(7);
    let mut sink = RedisSink(Default::default());
    stream(&connection, &query, &mut sink).await.unwrap();
    assert_eq!(sink.0.len(), 1501);
    for index in 0..1501 {
        assert_eq!(sink.0[&format!("field-{index}")], format!("λ-{index}"));
    }
    redis::cmd("DEL")
        .arg(&key)
        .query_async::<()>(&mut redis)
        .await
        .unwrap();
}
