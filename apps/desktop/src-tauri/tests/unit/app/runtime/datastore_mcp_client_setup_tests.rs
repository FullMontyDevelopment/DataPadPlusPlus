use super::*;

const ENDPOINT: &str = "http://127.0.0.1:17641/mcp";

#[test]
fn json_merge_preserves_existing_settings_and_upserts_vscode_server() {
    let existing = r#"{"servers":{"other":{"command":"node"}},"inputs":[{"id":"keep","type":"promptString"}]}"#;
    let (content, snippet) = merge_json_config(McpClient::VsCode, existing, ENDPOINT).unwrap();
    let value: Value = serde_json::from_str(&content).unwrap();

    assert_eq!(value["servers"]["other"]["command"].as_str(), Some("node"));
    assert_eq!(
        value["servers"][SERVER_NAME]["headers"]["Authorization"].as_str(),
        Some("Bearer ${input:datapad-mcp-token}")
    );
    assert!(value["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == "datapad-mcp-token"));
    assert!(snippet.contains("\"servers\""));
}

#[test]
fn json_merge_rejects_malformed_config() {
    let error = merge_json_config(McpClient::Cursor, "{bad", ENDPOINT).unwrap_err();
    assert_eq!(error.code, "mcp-client-setup-config-invalid");
}

#[test]
fn toml_merge_preserves_existing_settings_and_upserts_codex_server() {
    let existing = "model = \"gpt-5\"\n\n[mcp_servers.other]\ncommand = \"node\"\n";
    let (content, snippet) = merge_toml_config(existing, ENDPOINT).unwrap();
    let value = content.parse::<toml::Value>().unwrap();

    assert_eq!(value["model"].as_str(), Some("gpt-5"));
    assert_eq!(
        value["mcp_servers"][SERVER_NAME]["bearer_token_env_var"].as_str(),
        Some(TOKEN_ENV_VAR)
    );
    assert_eq!(
        value["mcp_servers"]["other"]["command"].as_str(),
        Some("node")
    );
    assert!(snippet.contains("[mcp_servers.datapadplusplus]"));
}

#[test]
fn endpoint_validation_rejects_non_loopback_and_tokenized_urls() {
    assert!(validate_endpoint(ENDPOINT).is_ok());
    assert!(validate_endpoint("http://example.test:17641/mcp").is_err());
    assert!(validate_endpoint("http://127.0.0.1:17641/mcp?token=dpp_mcp_secret").is_err());
}

#[test]
fn raw_tokens_are_not_allowed_in_generated_content() {
    assert!(reject_raw_token_persistence("Bearer ${env:DATAPAD_MCP_TOKEN}").is_ok());
    assert!(reject_raw_token_persistence("Bearer dpp_mcp_secret").is_err());
}

#[test]
fn snippet_uses_datapad_server_name_not_literal_constant_name() {
    let snippet = json_snippet_for(McpClient::Cursor, ENDPOINT).unwrap();
    assert!(snippet.contains("\"datapadplusplus\""));
    assert!(!snippet.contains("\"SERVER_NAME\""));
}

#[test]
fn path_allowlist_rejects_config_outside_user_profile() {
    let root = std::env::temp_dir().join("dpp-mcp-setup-home");
    let inside = root.join(".cursor").join("mcp.json");
    let outside = std::env::temp_dir()
        .join("dpp-mcp-setup-outside")
        .join("mcp.json");

    assert!(ensure_user_config_path(&root, &inside).is_ok());
    assert!(ensure_user_config_path(&root, &outside).is_err());
}

#[test]
fn setup_file_write_creates_backup_and_rejects_raw_tokens() {
    let dir = std::env::temp_dir().join(format!(
        "dpp-mcp-setup-test-{}-{}",
        safe_timestamp(),
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("mcp.json");
    fs::write(&path, "{\"existing\":true}\n").unwrap();

    let backup = write_setup_file(&path, "{\"next\":true}\n")
        .unwrap()
        .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "{\"next\":true}\n");
    assert_eq!(fs::read_to_string(backup).unwrap(), "{\"existing\":true}\n");

    let blocked = write_setup_file(&path, "Bearer dpp_mcp_secret");
    assert!(blocked.is_err());
    let _ = fs::remove_dir_all(dir);
}
