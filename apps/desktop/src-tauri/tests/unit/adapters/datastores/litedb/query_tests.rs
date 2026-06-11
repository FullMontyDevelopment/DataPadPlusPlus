use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::OnceLock,
};

use serde_json::json;

use super::super::LiteDbAdapter;
use super::{
    bounded_litedb_response, execute_litedb_query, litedb_operation,
    litedb_sidecar_response_from_stdout, litedb_sidecar_timeout_ms, normalize_litedb_request,
    normalize_litedb_response_bounded, parse_litedb_request, preview_litedb_response,
    validate_litedb_sidecar_path,
};
use crate::domain::models::{ExecutionRequest, ResolvedConnectionProfile};

static LITEDB_PROCESS_SIDECAR_FIXTURE: OnceLock<PathBuf> = OnceLock::new();

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
        warehouse_options: None,
        read_only: true,
    }
}

fn litedb_process_sidecar_fixture_path() -> PathBuf {
    LITEDB_PROCESS_SIDECAR_FIXTURE
        .get_or_init(compile_litedb_process_sidecar_fixture)
        .clone()
}

fn compile_litedb_process_sidecar_fixture() -> PathBuf {
    let fixture_dir = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-process-sidecar-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&fixture_dir).unwrap();
    let source_path = fixture_dir.join("litedb_process_sidecar_fixture.rs");
    let executable_path = fixture_dir.join(format!(
        "litedb-process-sidecar{}",
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::write(&source_path, LITEDB_PROCESS_SIDECAR_SOURCE).unwrap();

    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
    let output = StdCommand::new(rustc)
        .arg("--edition=2021")
        .arg(&source_path)
        .arg("-o")
        .arg(&executable_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "failed to compile LiteDB process sidecar fixture: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    executable_path
}

fn connection_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

const LITEDB_PROCESS_SIDECAR_SOURCE: &str = r#"
use std::{
io::{self, Read},
path::Path,
};

fn main() {
let mut input = String::new();
io::stdin().read_to_string(&mut input).expect("stdin");
let database_path = json_string_field(&input, "databasePath").unwrap_or_else(|| "missing.db".to_string());

if !Path::new(&database_path).exists() {
    println!(
        "{{\"ok\":false,\"message\":\"LiteDB file open failed for databasePath={} password=secret\"}}",
        escape_json(&database_path)
    );
    return;
}

let collection = json_string_field(&input, "collection").unwrap_or_else(|| "collection".to_string());
println!(
    "{{\"ok\":true,\"response\":{{\"documents\":[{{\"_id\":\"process-1\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}},{{\"_id\":\"process-2\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}},{{\"_id\":\"process-3\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}}],\"hasMore\":true,\"sidecar\":{{\"fixture\":\"local-process\",\"databasePath\":\"{}\"}}}}}}",
    escape_json(&collection),
    escape_json(&collection),
    escape_json(&collection),
    escape_json(&database_path)
);
}

fn json_string_field(input: &str, key: &str) -> Option<String> {
let needle = format!("\"{}\":", key);
let start = input.find(&needle)? + needle.len();
let rest = input[start..].trim_start();
let mut chars = rest.chars();
if chars.next()? != '"' {
    return None;
}

let mut value = String::new();
let mut escaped = false;
for character in rest[1..].chars() {
    if escaped {
        value.push(match character {
            '"' => '"',
            '\\' => '\\',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            other => other,
        });
        escaped = false;
        continue;
    }

    match character {
        '\\' => escaped = true,
        '"' => return Some(value),
        other => value.push(other),
    }
}

None
}

fn escape_json(value: &str) -> String {
value
    .replace('\\', "\\\\")
    .replace('"', "\\\"")
    .replace('\n', "\\n")
    .replace('\r', "\\r")
    .replace('\t', "\\t")
}
"#;

fn execution_request(query_text: String, row_limit: Option<u32>) -> ExecutionRequest {
    ExecutionRequest {
        execution_id: Some("exec-litedb-sidecar".into()),
        tab_id: "tab-litedb".into(),
        connection_id: "conn-litedb".into(),
        environment_id: "env-local".into(),
        language: "litedb".into(),
        query_text,
        execution_input_mode: None,
        script_text: None,
        selected_text: None,
        mode: None,
        row_limit,
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
    }
}

#[test]
fn litedb_plain_collection_becomes_find_request() {
    let value = parse_litedb_request("products").unwrap();
    assert_eq!(value["operation"], "Find");
    assert_eq!(value["collection"], "products");
}

#[test]
fn litedb_operation_normalizes_action() {
    assert_eq!(
        litedb_operation(&json!({ "action": "sample-schema" })).unwrap(),
        "SampleSchema"
    );
}

#[test]
fn litedb_preview_response_normalizes_documents() {
    let response = preview_litedb_response(&connection(), "Find", &json!({}), 25);
    let result = normalize_litedb_response_bounded("Find", &response, 25);

    assert!(result.columns.contains(&"status".into()));
    assert_eq!(
        result.rows[0][result
            .columns
            .iter()
            .position(|column| column == "status")
            .unwrap()],
        "bridge-request-built"
    );
    assert_eq!(result.documents.as_array().unwrap().len(), 1);
}

#[test]
fn litedb_list_collections_normalizes_collection_rows() {
    let result = normalize_litedb_response_bounded(
        "ListCollections",
        &json!({ "collections": ["orders"] }),
        5,
    );

    assert_eq!(result.columns, vec!["collection"]);
    assert_eq!(result.rows, vec![vec!["orders"]]);
}

#[test]
fn litedb_request_normalization_clamps_limit_only_for_read_lists() {
    let request = normalize_litedb_request(
        "Find",
        json!({ "Collection": "products", "Limit": 10000 }),
        50,
    );
    let count = normalize_litedb_request("Count", json!({ "Collection": "products" }), 50);

    assert_eq!(request["collection"], "products");
    assert_eq!(request["limit"], 51);
    assert!(count.get("limit").is_none());
}

#[test]
fn litedb_response_bounding_preserves_truncation_metadata() {
    let response = json!({
        "documents": [
            { "_id": 1, "name": "one" },
            { "_id": 2, "name": "two" },
            { "_id": 3, "name": "three" }
        ],
        "hasMore": true
    });

    let result = normalize_litedb_response_bounded("Find", &response, 2);
    let preflight = json!({
        "readProbe": { "status": "ok" },
        "writeProbe": { "status": "blocked" },
        "sidecarExecutionBoundary": { "status": "plan-only-until-sidecar" }
    });
    let bounded = bounded_litedb_response("Find", response, 2, result.truncated, &preflight);

    assert!(result.truncated);
    assert_eq!(result.documents.as_array().unwrap().len(), 2);
    assert_eq!(bounded["documents"].as_array().unwrap().len(), 2);
    assert_eq!(bounded["datapad"]["truncated"], true);
    assert_eq!(
        bounded["datapad"]["sidecarExecutionBoundary"]["status"],
        "plan-only-until-sidecar"
    );
}

#[tokio::test]
async fn litedb_sidecar_read_dispatch_contract_returns_bounded_rows() {
    let mut connection = connection();
    let file_path = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-sidecar-{}.db",
        std::process::id()
    ));
    std::fs::write(&file_path, b"litedb fixture").unwrap();
    connection.connection_string = Some(format!(
        "Filename={};SidecarPath=datapad-fixture-sidecar;Password=secret;SidecarTimeoutMs=5000",
        file_path.display()
    ));
    connection.password = Some("secret".into());

    let request = execution_request(
        json!({
            "operation": "Find",
            "collection": "products",
            "limit": 1000
        })
        .to_string(),
        Some(2),
    );
    let result = execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![])
        .await
        .unwrap();

    let _ = std::fs::remove_file(&file_path);

    assert_eq!(result.truncated, Some(true));
    assert!(result.summary.contains("sidecar returned"));
    assert!(result
        .notices
        .iter()
        .any(|notice| notice.code == "litedb-sidecar-live-read"));
    assert_eq!(result.payloads[0]["documents"].as_array().unwrap().len(), 2);
    assert_eq!(
        result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]["status"],
        "live-read-dispatch"
    );
    assert_eq!(
        result.payloads[3]["stages"]["runtime"],
        "dotnet-litedb-sidecar"
    );
    assert_eq!(result.payloads[3]["stages"]["liveExecution"], true);
    assert_eq!(
        result.payloads[3]["stages"]["sidecarExecutionBoundary"]["status"],
        "live-read-dispatch"
    );
}

#[tokio::test]
async fn litedb_sidecar_local_process_dispatch_contract_returns_bounded_rows() {
    let mut connection = connection();
    let sidecar_path = litedb_process_sidecar_fixture_path();
    let file_path = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-process-sidecar-read-{}.db",
        std::process::id()
    ));
    std::fs::write(&file_path, b"litedb fixture").unwrap();
    connection.connection_string = Some(format!(
        "Filename={};SidecarPath={};Password=secret;SidecarTimeoutMs=10000",
        connection_path(&file_path),
        connection_path(&sidecar_path)
    ));
    connection.password = Some("secret".into());

    let request = execution_request(
        json!({
            "operation": "Find",
            "collection": "orders",
            "limit": 1000
        })
        .to_string(),
        Some(2),
    );
    let result = execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![])
        .await
        .unwrap();

    let _ = std::fs::remove_file(&file_path);

    assert_eq!(result.truncated, Some(true));
    assert_eq!(result.payloads[0]["documents"].as_array().unwrap().len(), 2);
    assert_eq!(
        result.payloads[0]["documents"][0]["status"],
        "local-sidecar-process"
    );
    assert_eq!(
        result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]["dispatchEvidence"],
        "local-sidecar-process"
    );
    assert_eq!(
        result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]
            ["processDispatchValidated"],
        true
    );
    assert_eq!(
        result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]
            ["engineRuntimeValidated"],
        false
    );
}

#[tokio::test]
async fn litedb_sidecar_local_process_open_failure_redacts_error_output() {
    let mut connection = connection();
    let sidecar_path = litedb_process_sidecar_fixture_path();
    let missing_file_path = std::env::temp_dir().join(format!(
        "datapadplusplus-litedb-process-sidecar-missing-{}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&missing_file_path);
    connection.connection_string = Some(format!(
        "Filename={};SidecarPath={};Password=secret;SidecarTimeoutMs=10000",
        connection_path(&missing_file_path),
        connection_path(&sidecar_path)
    ));
    connection.password = Some("secret".into());

    let request = execution_request(
        json!({
            "operation": "Find",
            "collection": "orders"
        })
        .to_string(),
        Some(2),
    );
    let error = match execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![]).await {
        Ok(_) => panic!("expected LiteDB process sidecar open failure"),
        Err(error) => error,
    };

    assert_eq!(error.code, "litedb-sidecar-request-failed");
    assert!(error.message.contains("LiteDB file open failed"));
    assert!(!error.message.contains("secret"));
    assert!(!error.message.contains("Password=secret"));
    assert!(error.message.contains("[REDACTED]"));
}

#[test]
fn litedb_sidecar_response_redacts_failed_secret_output() {
    let mut connection = connection();
    connection.password = Some("secret".into());
    connection.connection_string =
        Some("Filename=C:/data/app.db;Password=secret;SidecarPath=C:/sidecar.exe".into());

    let error = litedb_sidecar_response_from_stdout(
        &connection,
        r#"{"ok":false,"message":"bad secret Filename=C:/data/app.db;Password=secret;SidecarPath=C:/sidecar.exe"}"#,
    )
    .unwrap_err();

    assert_eq!(error.code, "litedb-sidecar-request-failed");
    assert!(!error.message.contains("secret"));
    assert!(!error.message.contains("Password=secret"));
    assert!(!error.message.contains("Filename=C:/data/app.db"));
    assert!(error.message.contains("[REDACTED]"));
}

#[test]
fn litedb_sidecar_path_validation_rejects_urls_and_relative_paths() {
    assert_eq!(
        validate_litedb_sidecar_path("https://example.com/sidecar")
            .unwrap_err()
            .code,
        "litedb-sidecar-path-invalid"
    );
    assert_eq!(
        validate_litedb_sidecar_path("sidecar.exe")
            .unwrap_err()
            .code,
        "litedb-sidecar-path-relative"
    );

    let absolute_path = std::env::temp_dir().join("litedb-sidecar.exe");
    assert!(validate_litedb_sidecar_path(absolute_path.to_string_lossy().as_ref()).is_ok());
}

#[test]
fn litedb_sidecar_timeout_option_is_bounded() {
    let mut connection = connection();

    assert_eq!(litedb_sidecar_timeout_ms(&connection), 20_000);

    connection.connection_string = Some("Filename=C:/data/app.db;SidecarTimeoutMs=25".into());
    assert_eq!(litedb_sidecar_timeout_ms(&connection), 1_000);

    connection.connection_string = Some("Filename=C:/data/app.db;SidecarTimeoutMs=180000".into());
    assert_eq!(litedb_sidecar_timeout_ms(&connection), 120_000);
}
