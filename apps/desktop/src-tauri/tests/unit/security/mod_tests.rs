use super::*;
use std::collections::HashMap;

fn connection(read_only: bool) -> ConnectionProfile {
    ConnectionProfile {
        id: "conn".into(),
        name: "Connection".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("app".into()),
        connection_string: None,
        connection_mode: None,
        environment_ids: Vec::new(),
        tags: Vec::new(),
        favorite: false,
        redis_options: None,
        memcached_options: None,
        mongodb_options: None,
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
        read_only,
        icon: "postgresql".into(),
        color: None,
        group: None,
        notes: None,
        auth: Default::default(),
        created_at: "2026-05-19T00:00:00Z".into(),
        updated_at: "2026-05-19T00:00:00Z".into(),
    }
}

fn environment(risk: &str, safe_mode: bool, requires_confirmation: bool) -> EnvironmentProfile {
    EnvironmentProfile {
        id: "env".into(),
        label: "QA".into(),
        color: "#2563eb".into(),
        risk: risk.into(),
        inherits_from: None,
        variables: HashMap::new(),
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
        requires_confirmation,
        safe_mode,
        exportable: true,
        created_at: "2026-05-19T00:00:00Z".into(),
        updated_at: "2026-05-19T00:00:00Z".into(),
    }
}

fn resolved_environment(unresolved_keys: Vec<String>) -> ResolvedEnvironment {
    ResolvedEnvironment {
        environment_id: "env".into(),
        label: "QA".into(),
        risk: "low".into(),
        variables: HashMap::new(),
        unresolved_keys,
        inherited_chain: Vec::new(),
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
    }
}

#[test]
fn safe_mode_requires_confirmation_for_risky_queries() {
    let decision = evaluate_guardrails(
        &connection(false),
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        "delete from accounts where id = 1",
        true,
    );

    assert_eq!(decision.status, "confirm");
    assert_eq!(
        decision.required_confirmation_text.as_deref(),
        Some("CONFIRM QA")
    );
    assert!(decision
        .reasons
        .iter()
        .any(|reason| reason.contains("Global safe mode")));
}

#[test]
fn high_risk_environment_allows_reads_without_confirmation() {
    let decision = evaluate_guardrails(
        &connection(false),
        &environment("high", false, false),
        &resolved_environment(Vec::new()),
        "select * from accounts",
        false,
    );

    assert_eq!(decision.status, "allow");
}

#[test]
fn high_risk_environment_requires_confirmation_for_writes() {
    let decision = evaluate_guardrails(
        &connection(false),
        &environment("high", false, false),
        &resolved_environment(Vec::new()),
        "delete from accounts where id = 1",
        false,
    );

    assert_eq!(decision.status, "confirm");
    assert!(decision
        .reasons
        .iter()
        .any(|reason| reason.contains("high risk")));
}

#[test]
fn safe_mode_allows_mongo_and_redis_reads() {
    let mut mongo = connection(false);
    mongo.engine = "mongodb".into();
    mongo.family = "document".into();
    let mut redis = connection(false);
    redis.engine = "redis".into();
    redis.family = "key-value".into();

    let mongo_decision = evaluate_guardrails(
        &mongo,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        r#"{ "database": "catalog", "collection": "products", "filter": {}, "limit": 20 }"#,
        true,
    );
    let redis_decision = evaluate_guardrails(
        &redis,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        "GET session:1",
        true,
    );

    assert_eq!(mongo_decision.status, "allow");
    assert_eq!(redis_decision.status, "allow");
}

#[test]
fn safe_mode_requires_confirmation_for_mongo_and_redis_writes() {
    let mut mongo = connection(false);
    mongo.engine = "mongodb".into();
    mongo.family = "document".into();
    let mut redis = connection(false);
    redis.engine = "redis".into();
    redis.family = "key-value".into();

    let mongo_decision = evaluate_guardrails(
        &mongo,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        r#"{ "operation": "deleteMany", "database": "catalog", "collection": "products", "filter": {} }"#,
        true,
    );
    let redis_decision = evaluate_guardrails(
        &redis,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        "DEL session:1",
        true,
    );

    assert_eq!(mongo_decision.status, "confirm");
    assert_eq!(redis_decision.status, "confirm");
}

#[test]
fn unresolved_environment_variables_block_before_confirmation() {
    let decision = evaluate_guardrails(
        &connection(false),
        &environment("high", true, true),
        &resolved_environment(vec!["DB_NAME".into()]),
        "select 1",
        true,
    );

    assert_eq!(decision.status, "block");
}

#[test]
fn tokenized_write_detection_ignores_keyword_inside_identifier() {
    assert!(!query_looks_write(
        "select updated_at, delete_count from audit_log"
    ));
    assert!(query_looks_write("update accounts set name = 'Ada'"));
}

#[test]
fn oracle_guardrails_confirm_plsql_locks_and_block_read_only_writes() {
    let mut oracle = connection(false);
    oracle.engine = "oracle".into();

    for statement in [
        "begin dbms_output.put_line('ready'); end;",
        "select * from accounts for update",
        "alter session set current_schema = APP",
    ] {
        let decision = evaluate_guardrails(
            &oracle,
            &environment("low", false, false),
            &resolved_environment(Vec::new()),
            statement,
            true,
        );
        assert_eq!(decision.status, "confirm", "{statement}");
    }

    oracle.read_only = true;
    let blocked = evaluate_guardrails(
        &oracle,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        "begin delete from accounts; end;",
        true,
    );
    assert_eq!(blocked.status, "block");
}

#[test]
fn connection_string_secret_detection_catches_common_secret_shapes() {
    assert!(connection_string_contains_secret(
        "mongodb://user:secret@localhost:27017/catalog"
    ));
    assert!(connection_string_contains_secret(
        "Server=localhost;User Id=sa;Password=secret;"
    ));
    assert!(connection_string_contains_secret(
        "https://example.local/query?access_token=secret"
    ));
    assert!(connection_string_contains_secret(
        "https://example.local/oauth?client_secret=secret"
    ));
    assert!(connection_string_contains_secret(
        "Service=local;Private_Key=secret;"
    ));
    assert!(!connection_string_contains_secret(
        "Server=localhost;User Id=sa;Password=${DB_PASSWORD};"
    ));
    assert!(!connection_string_contains_secret(
        "mongodb://localhost:27017/catalog"
    ));
    assert!(!connection_string_contains_secret(
        "Server=localhost;Database=app;Encrypt=true;"
    ));
}

#[test]
fn encrypted_file_secret_round_trips_without_plaintext() {
    let secret_ref = SecretRef {
        id: "secret-test".into(),
        provider: "test".into(),
        service: "DataPadPlusPlusTest".into(),
        account: "account".into(),
        label: "Test secret".into(),
    };
    let storage_key = file_secret_key(&secret_ref);
    let encrypted =
        encrypt_file_secret(&storage_key, "do-not-store-me").expect("encrypt file secret");

    assert_ne!(encrypted.ciphertext, "do-not-store-me");
    assert!(!serde_json::to_string(&encrypted)
        .expect("serialize encrypted secret")
        .contains("do-not-store-me"));
    assert_eq!(
        decrypt_file_secret(&storage_key, &encrypted).expect("decrypt file secret"),
        "do-not-store-me"
    );
}

#[test]
fn corrupted_file_secret_nonce_returns_error() {
    let encrypted = EncryptedFileSecret {
        version: FILE_SECRET_VERSION,
        nonce: BASE64.encode([1_u8, 2, 3]),
        ciphertext: BASE64.encode([4_u8, 5, 6]),
    };

    let error = decrypt_file_secret("storage-key", &encrypted)
        .expect_err("invalid nonce should fail without panicking");

    assert_eq!(error.code, "file-secret-decryption");
}

#[test]
fn plaintext_file_secret_payloads_are_rejected() {
    let path = std::env::temp_dir().join(format!(
        "datapadplusplus-plaintext-secret-test-{}.json",
        std::process::id()
    ));
    fs::write(&path, r#"{ "legacy": "plain-secret" }"#).expect("write legacy secret file");

    let error = read_file_secrets(&path).expect_err("plaintext file should be rejected");
    assert_eq!(error.code, "plaintext-secret-file-detected");
    let _ = fs::remove_file(path);
}

#[test]
fn redis_destructive_commands_require_confirmation_even_in_low_risk_environment() {
    let mut connection = connection(false);
    connection.engine = "redis".into();
    let decision = evaluate_guardrails(
        &connection,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        "DEL account:1",
        false,
    );

    assert_eq!(decision.status, "confirm");
    assert!(decision
        .reasons
        .iter()
        .any(|reason| reason.contains("Redis destructive")));
}

#[test]
fn mongodb_raw_writes_require_confirmation_even_in_low_risk_environment() {
    let mut connection = connection(false);
    connection.engine = "mongodb".into();
    let decision = evaluate_guardrails(
        &connection,
        &environment("low", false, false),
        &resolved_environment(Vec::new()),
        r#"{ "collection": "products", "operation": "deleteMany", "filter": { "sku": "old" } }"#,
        false,
    );

    assert_eq!(decision.status, "confirm");
    assert!(decision
        .reasons
        .iter()
        .any(|reason| reason.contains("MongoDB raw write")));
}

#[test]
fn export_encryption_round_trips_with_kdf_metadata() {
    let encrypted = encrypt_export_payload("correct horse battery staple", "{\"ok\":true}")
        .expect("export should encrypt");
    let decoded = BASE64.decode(&encrypted).expect("bundle should be base64");
    let package: serde_json::Value =
        serde_json::from_slice(&decoded).expect("bundle should contain json metadata");

    assert_eq!(package["kdf"].as_str(), Some(EXPORT_KDF));
    assert_eq!(
        package["iterations"].as_u64(),
        Some(EXPORT_KDF_ITERATIONS as u64)
    );
    assert!(package["salt"].as_str().is_some());

    let decrypted = decrypt_export_payload("correct horse battery staple", &encrypted)
        .expect("export should decrypt");
    assert_eq!(decrypted, "{\"ok\":true}");
}

#[test]
fn export_decryption_rejects_wrong_passphrase() {
    let encrypted =
        encrypt_export_payload("right", "{\"ok\":true}").expect("export should encrypt");

    assert!(decrypt_export_payload("wrong", &encrypted).is_err());
}

#[test]
fn export_decryption_accepts_legacy_sha256_bundles() {
    let key = derive_legacy_key("legacy");
    let cipher = Aes256Gcm::new_from_slice(&key).expect("legacy key should initialize");
    let nonce_bytes = [7_u8; 12];
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, b"{\"legacy\":true}".as_slice())
        .expect("legacy payload should encrypt");
    let encrypted = BASE64.encode(
        json!({
            "nonce": BASE64.encode(nonce_bytes),
            "ciphertext": BASE64.encode(ciphertext),
        })
        .to_string(),
    );

    let decrypted =
        decrypt_export_payload("legacy", &encrypted).expect("legacy bundle should decrypt");
    assert_eq!(decrypted, "{\"legacy\":true}");
}
