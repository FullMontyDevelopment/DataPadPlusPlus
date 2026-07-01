use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use url::Url;

use super::timestamp_now;
use crate::domain::{
    error::CommandError,
    models::{
        DatastoreMcpClientSetupApplyRequest, DatastoreMcpClientSetupApplyResponse,
        DatastoreMcpClientSetupPreview, DatastoreMcpClientSetupRequest,
    },
};

const SERVER_NAME: &str = "datapadplusplus";
const TOKEN_ENV_VAR: &str = "DATAPAD_MCP_TOKEN";
const RAW_TOKEN_PREFIX: &str = "dpp_mcp_";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum McpClient {
    Codex,
    VsCode,
    Cursor,
    ClaudeCode,
    GeminiCli,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConfigFormat {
    Json,
    Toml,
}

struct ClientTarget {
    client: McpClient,
    client_id: String,
    scope: String,
    path: PathBuf,
    format: ConfigFormat,
}

struct SetupPlan {
    preview: DatastoreMcpClientSetupPreview,
    content: String,
}

pub fn preview_client_setup<R: Runtime>(
    app: &AppHandle<R>,
    request: DatastoreMcpClientSetupRequest,
) -> Result<DatastoreMcpClientSetupPreview, CommandError> {
    Ok(build_setup_plan(app, request)?.preview)
}

pub fn apply_client_setup<R: Runtime>(
    app: &AppHandle<R>,
    request: DatastoreMcpClientSetupApplyRequest,
) -> Result<DatastoreMcpClientSetupApplyResponse, CommandError> {
    let plan = build_setup_plan(
        app,
        DatastoreMcpClientSetupRequest {
            client_id: request.client_id,
            scope: request.scope,
            endpoint: request.endpoint,
        },
    )?;
    if plan.preview.preview_id != request.preview_id {
        return Err(CommandError::new(
            "mcp-client-setup-preview-stale",
            "The MCP client setup preview is stale. Preview the file again before applying changes.",
        ));
    }
    if !plan.preview.can_apply {
        return Err(CommandError::new(
            "mcp-client-setup-unavailable",
            "Automatic MCP client setup is unavailable for this target.",
        ));
    }

    let target = PathBuf::from(&plan.preview.target_path);
    let backup_path = write_setup_file(&target, &plan.content)?;
    Ok(DatastoreMcpClientSetupApplyResponse {
        client_id: plan.preview.client_id,
        scope: plan.preview.scope,
        endpoint: plan.preview.endpoint,
        target_path: plan.preview.target_path,
        target_exists: plan.preview.target_exists,
        can_apply: plan.preview.can_apply,
        preview_id: plan.preview.preview_id,
        change_summary: "DataPad++ MCP client setup applied.".into(),
        proposed_snippet: plan.preview.proposed_snippet,
        warnings: plan.preview.warnings,
        applied: true,
        backup_path: backup_path.map(|path| path.display().to_string()),
    })
}

fn build_setup_plan<R: Runtime>(
    app: &AppHandle<R>,
    request: DatastoreMcpClientSetupRequest,
) -> Result<SetupPlan, CommandError> {
    let endpoint = validate_endpoint(&request.endpoint)?;
    let target = resolve_target(app, &request.client_id, &request.scope)?;
    let existing = match fs::read_to_string(&target.path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(CommandError::from(error)),
    };
    let target_exists = !existing.is_empty() || target.path.exists();
    let (content, proposed_snippet) = match target.format {
        ConfigFormat::Json => merge_json_config(target.client, &existing, &endpoint)?,
        ConfigFormat::Toml => merge_toml_config(&existing, &endpoint)?,
    };
    reject_raw_token_persistence(&content)?;
    let preview_id = preview_checksum(&target, &content);
    let change_summary = if target_exists {
        "Update the DataPad++ MCP entry and preserve existing client settings."
    } else {
        "Create the client config file with the DataPad++ MCP entry."
    };
    let warnings = target_warnings(target.client);

    Ok(SetupPlan {
        preview: DatastoreMcpClientSetupPreview {
            client_id: target.client_id,
            scope: target.scope,
            endpoint,
            target_path: target.path.display().to_string(),
            target_exists,
            can_apply: true,
            preview_id,
            change_summary: change_summary.into(),
            proposed_snippet,
            warnings,
        },
        content,
    })
}

fn resolve_target<R: Runtime>(
    app: &AppHandle<R>,
    client_id: &str,
    scope: &str,
) -> Result<ClientTarget, CommandError> {
    if scope != "user" {
        return Err(CommandError::new(
            "mcp-client-setup-scope-unsupported",
            "Automatic MCP client setup currently supports only user-level config files.",
        ));
    }
    let home = app.path().home_dir().map_err(|_| {
        CommandError::new(
            "mcp-client-setup-home-unavailable",
            "DataPad++ could not resolve the user home directory for MCP client setup.",
        )
    })?;
    let (client, path, format) = match client_id {
        "codex" => (
            McpClient::Codex,
            home.join(".codex").join("config.toml"),
            ConfigFormat::Toml,
        ),
        "vscode" => (
            McpClient::VsCode,
            vscode_user_mcp_path(&home),
            ConfigFormat::Json,
        ),
        "cursor" => (
            McpClient::Cursor,
            home.join(".cursor").join("mcp.json"),
            ConfigFormat::Json,
        ),
        "claude-code" => (
            McpClient::ClaudeCode,
            home.join(".claude.json"),
            ConfigFormat::Json,
        ),
        "gemini-cli" => (
            McpClient::GeminiCli,
            home.join(".gemini").join("settings.json"),
            ConfigFormat::Json,
        ),
        _ => {
            return Err(CommandError::new(
                "mcp-client-setup-client-unsupported",
                "This MCP client is not supported for automatic setup.",
            ));
        }
    };
    ensure_user_config_path(&home, &path)?;
    Ok(ClientTarget {
        client,
        client_id: client_id.into(),
        scope: scope.into(),
        path,
        format,
    })
}

fn vscode_user_mcp_path(home: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        app_data.join("Code").join("User").join("mcp.json")
    }
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("mcp.json")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("Code")
            .join("User")
            .join("mcp.json")
    }
}

fn ensure_user_config_path(home: &Path, path: &Path) -> Result<(), CommandError> {
    let normalized_home = normalize_path(home);
    let normalized_path = normalize_path(path);
    if !normalized_path.starts_with(&normalized_home) {
        return Err(CommandError::new(
            "mcp-client-setup-path-rejected",
            "DataPad++ refused to update an MCP client config outside the user profile.",
        ));
    }
    Ok(())
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        normalized.push(component.as_os_str());
    }
    normalized
}

fn validate_endpoint(endpoint: &str) -> Result<String, CommandError> {
    if endpoint.contains(RAW_TOKEN_PREFIX) {
        return Err(CommandError::new(
            "mcp-client-setup-token-rejected",
            "MCP client setup cannot persist raw auth token values.",
        ));
    }
    let parsed = Url::parse(endpoint).map_err(|_| {
        CommandError::new(
            "mcp-client-setup-endpoint-invalid",
            "MCP client setup requires a valid localhost HTTP endpoint.",
        )
    })?;
    if parsed.scheme() != "http"
        || parsed.path() != "/mcp"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err(CommandError::new(
            "mcp-client-setup-endpoint-invalid",
            "MCP client setup supports only http://127.0.0.1:<port>/mcp endpoints.",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if host != "127.0.0.1" && host != "localhost" {
        return Err(CommandError::new(
            "mcp-client-setup-endpoint-rejected",
            "MCP client setup refused a non-loopback endpoint.",
        ));
    }
    let Some(port) = parsed.port() else {
        return Err(CommandError::new(
            "mcp-client-setup-endpoint-invalid",
            "MCP client setup requires an explicit localhost port.",
        ));
    };
    if !(1024..=65535).contains(&port) {
        return Err(CommandError::new(
            "mcp-client-setup-endpoint-invalid",
            "MCP client setup requires a port between 1024 and 65535.",
        ));
    }
    Ok(format!("http://{host}:{port}/mcp"))
}

fn merge_json_config(
    client: McpClient,
    existing: &str,
    endpoint: &str,
) -> Result<(String, String), CommandError> {
    let mut value = if existing.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(existing).map_err(|error| {
            CommandError::new(
                "mcp-client-setup-config-invalid",
                format!("The existing MCP client JSON config is invalid: {error}"),
            )
        })?
    };
    let Some(root) = value.as_object_mut() else {
        return Err(CommandError::new(
            "mcp-client-setup-config-invalid",
            "The existing MCP client JSON config must be a JSON object.",
        ));
    };

    match client {
        McpClient::VsCode => {
            upsert_vscode_input(root);
            upsert_json_server(root, "servers", vscode_server(endpoint));
        }
        McpClient::Cursor => upsert_json_server(root, "mcpServers", cursor_server(endpoint)),
        McpClient::ClaudeCode => upsert_json_server(root, "mcpServers", claude_server(endpoint)),
        McpClient::GeminiCli => upsert_json_server(root, "mcpServers", gemini_server(endpoint)),
        McpClient::Codex => {
            return Err(CommandError::new(
                "mcp-client-setup-format-invalid",
                "Codex MCP setup uses TOML, not JSON.",
            ));
        }
    }

    let content = format_json(&value)?;
    let snippet = json_snippet_for(client, endpoint)?;
    Ok((content, snippet))
}

fn upsert_json_server(root: &mut Map<String, Value>, key: &str, server: Value) {
    let entry = root
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    if let Some(servers) = entry.as_object_mut() {
        servers.insert(SERVER_NAME.into(), server);
    }
}

fn upsert_vscode_input(root: &mut Map<String, Value>) {
    let input = json!({
        "type": "promptString",
        "id": "datapad-mcp-token",
        "description": "DataPad++ MCP Auth Token",
        "password": true,
    });
    let inputs = root
        .entry("inputs")
        .or_insert_with(|| Value::Array(Vec::new()));
    if !inputs.is_array() {
        *inputs = Value::Array(Vec::new());
    }
    let Some(items) = inputs.as_array_mut() else {
        return;
    };
    if let Some(existing) = items.iter_mut().find(|item| {
        item.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == "datapad-mcp-token")
    }) {
        *existing = input;
    } else {
        items.push(input);
    }
}

fn vscode_server(endpoint: &str) -> Value {
    json!({
        "type": "http",
        "url": endpoint,
        "headers": {
            "Authorization": "Bearer ${input:datapad-mcp-token}",
        },
    })
}

fn cursor_server(endpoint: &str) -> Value {
    json!({
        "url": endpoint,
        "headers": {
            "Authorization": format!("Bearer ${{env:{TOKEN_ENV_VAR}}}"),
        },
    })
}

fn claude_server(endpoint: &str) -> Value {
    json!({
        "type": "http",
        "url": endpoint,
        "headers": {
            "Authorization": format!("Bearer ${{{TOKEN_ENV_VAR}}}"),
        },
    })
}

fn gemini_server(endpoint: &str) -> Value {
    json!({
        "httpUrl": endpoint,
        "headers": {
            "Authorization": format!("Bearer ${TOKEN_ENV_VAR}"),
        },
        "timeout": 30000,
        "trust": false,
    })
}

fn merge_toml_config(existing: &str, endpoint: &str) -> Result<(String, String), CommandError> {
    let mut value = if existing.trim().is_empty() {
        toml::Value::Table(toml::map::Map::new())
    } else {
        existing.parse::<toml::Value>().map_err(|error| {
            CommandError::new(
                "mcp-client-setup-config-invalid",
                format!("The existing Codex TOML config is invalid: {error}"),
            )
        })?
    };
    let Some(root) = value.as_table_mut() else {
        return Err(CommandError::new(
            "mcp-client-setup-config-invalid",
            "The existing Codex TOML config must be a TOML table.",
        ));
    };
    let servers = root
        .entry("mcp_servers")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    if !servers.is_table() {
        *servers = toml::Value::Table(toml::map::Map::new());
    }
    let Some(servers) = servers.as_table_mut() else {
        return Err(CommandError::new(
            "mcp-client-setup-config-invalid",
            "The existing Codex MCP server config must be a TOML table.",
        ));
    };
    let mut server = toml::map::Map::new();
    server.insert("url".into(), toml::Value::String(endpoint.into()));
    server.insert(
        "bearer_token_env_var".into(),
        toml::Value::String(TOKEN_ENV_VAR.into()),
    );
    server.insert("startup_timeout_sec".into(), toml::Value::Integer(10));
    server.insert("tool_timeout_sec".into(), toml::Value::Integer(30));
    servers.insert(SERVER_NAME.into(), toml::Value::Table(server));

    let content = toml::to_string_pretty(&value).map_err(|error| {
        CommandError::new(
            "mcp-client-setup-config-invalid",
            format!("DataPad++ could not render the Codex TOML config: {error}"),
        )
    })?;
    let snippet = codex_snippet(endpoint);
    Ok((ensure_trailing_newline(content), snippet))
}

fn json_snippet_for(client: McpClient, endpoint: &str) -> Result<String, CommandError> {
    let value = match client {
        McpClient::VsCode => json!({
            "inputs": [{
                "type": "promptString",
                "id": "datapad-mcp-token",
                "description": "DataPad++ MCP Auth Token",
                "password": true,
            }],
            "servers": {
                SERVER_NAME: vscode_server(endpoint),
            },
        }),
        McpClient::Cursor => json!({
            "mcpServers": {
                SERVER_NAME: cursor_server(endpoint),
            },
        }),
        McpClient::ClaudeCode => json!({
            "mcpServers": {
                SERVER_NAME: claude_server(endpoint),
            },
        }),
        McpClient::GeminiCli => json!({
            "mcpServers": {
                SERVER_NAME: gemini_server(endpoint),
            },
        }),
        McpClient::Codex => {
            return Err(CommandError::new(
                "mcp-client-setup-format-invalid",
                "Codex MCP setup uses TOML, not JSON.",
            ));
        }
    };
    format_json(&value)
}

fn codex_snippet(endpoint: &str) -> String {
    format!(
        "[mcp_servers.{SERVER_NAME}]\nurl = \"{endpoint}\"\nbearer_token_env_var = \"{TOKEN_ENV_VAR}\"\nstartup_timeout_sec = 10\ntool_timeout_sec = 30\n"
    )
}

fn format_json(value: &Value) -> Result<String, CommandError> {
    serde_json::to_string_pretty(value)
        .map(ensure_trailing_newline)
        .map_err(CommandError::from)
}

fn ensure_trailing_newline(mut value: String) -> String {
    if !value.ends_with('\n') {
        value.push('\n');
    }
    value
}

fn reject_raw_token_persistence(content: &str) -> Result<(), CommandError> {
    if content.contains(RAW_TOKEN_PREFIX) {
        return Err(CommandError::new(
            "mcp-client-setup-token-rejected",
            "MCP client setup refused to write a raw auth token value.",
        ));
    }
    Ok(())
}

fn preview_checksum(target: &ClientTarget, content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(target.client_id.as_bytes());
    hasher.update([0]);
    hasher.update(target.scope.as_bytes());
    hasher.update([0]);
    hasher.update(target.path.display().to_string().as_bytes());
    hasher.update([0]);
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn target_warnings(client: McpClient) -> Vec<String> {
    match client {
        McpClient::VsCode => vec![
            "VS Code will prompt for the DataPad++ auth token instead of storing it in mcp.json."
                .into(),
        ],
        McpClient::ClaudeCode => {
            vec![
                "Claude Code auth token expansion depends on the local Claude Code environment."
                    .into(),
            ]
        }
        _ => Vec::new(),
    }
}

fn write_setup_file(path: &Path, content: &str) -> Result<Option<PathBuf>, CommandError> {
    reject_raw_token_persistence(content)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let backup_path = if path.exists() {
        let backup = backup_path_for(path);
        fs::copy(path, &backup)?;
        Some(backup)
    } else {
        None
    };
    let temporary_path = temporary_path_for(path);
    fs::write(&temporary_path, content)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temporary_path, path)?;
    Ok(backup_path)
}

fn backup_path_for(path: &Path) -> PathBuf {
    let timestamp = safe_timestamp();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("mcp-client-config");
    path.with_file_name(format!("{file_name}.dpp-bak-{timestamp}"))
}

fn temporary_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("mcp-client-config");
    path.with_file_name(format!("{file_name}.dpp-tmp"))
}

fn safe_timestamp() -> String {
    timestamp_now()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/datastore_mcp_client_setup_tests.rs"]
mod datastore_mcp_client_setup_tests;
