use std::{collections::HashMap, fs, path::PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::domain::{
    error::CommandError,
    models::{
        ConnectionProfile, EnvironmentProfile, GuardrailDecision, ResolvedEnvironment, SecretRef,
    },
};

pub const SAFE_MODE_LABEL: &str = "production-safe-mode";
const EXPORT_KDF: &str = "pbkdf2-sha256";
const EXPORT_KDF_ITERATIONS: u32 = 210_000;
const FILE_SECRET_VERSION: u8 = 1;
#[cfg(not(test))]
const FILE_SECRET_MASTER_SERVICE: &str = "DataPadPlusPlus";
#[cfg(not(test))]
const FILE_SECRET_MASTER_ACCOUNT: &str = "encrypted-file-secret-store-master-key";

pub trait SecretStore {
    fn store_secret(&self, secret_ref: &SecretRef, secret: &str) -> Result<(), CommandError>;
    fn resolve_secret(&self, secret_ref: &SecretRef) -> Result<String, CommandError>;
}

pub struct KeyringSecretStore;

pub struct FileSecretStore;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedFileSecret {
    version: u8,
    nonce: String,
    ciphertext: String,
}

impl SecretStore for KeyringSecretStore {
    fn store_secret(&self, secret_ref: &SecretRef, secret: &str) -> Result<(), CommandError> {
        let entry = Entry::new(&secret_ref.service, &secret_ref.account)
            .map_err(|error| CommandError::new("secret-store", error.to_string()))?;
        entry
            .set_password(secret)
            .map_err(|error| CommandError::new("secret-store", error.to_string()))
    }

    fn resolve_secret(&self, secret_ref: &SecretRef) -> Result<String, CommandError> {
        let entry = Entry::new(&secret_ref.service, &secret_ref.account)
            .map_err(|error| CommandError::new("secret-store", error.to_string()))?;
        entry
            .get_password()
            .map_err(|error| CommandError::new("secret-store", error.to_string()))
    }
}

impl SecretStore for FileSecretStore {
    fn store_secret(&self, secret_ref: &SecretRef, secret: &str) -> Result<(), CommandError> {
        let path = file_secret_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut secrets = read_file_secrets(&path)?;
        let key = file_secret_key(secret_ref);
        secrets.insert(key.clone(), encrypt_file_secret(&key, secret)?);
        fs::write(path, serde_json::to_string_pretty(&secrets)?)?;
        Ok(())
    }

    fn resolve_secret(&self, secret_ref: &SecretRef) -> Result<String, CommandError> {
        let path = file_secret_path();
        let secrets = read_file_secrets(&path)?;
        let key = file_secret_key(secret_ref);
        if let Some(secret) = secrets.get(&key) {
            return decrypt_file_secret(&key, secret);
        }

        for legacy_path in legacy_file_secret_paths() {
            if legacy_path == path {
                continue;
            }
            let legacy_secrets = read_file_secrets(&legacy_path)?;
            if let Some(secret) = legacy_secrets.get(&key) {
                return decrypt_file_secret(&key, secret);
            }
        }

        Err(CommandError::new("secret-store", "Secret was not found."))
    }
}

pub fn using_file_secret_store() -> bool {
    env_value(&[
        "DATAPADPLUSPLUS_SECRET_STORE",
        "DATANAUT_SECRET_STORE",
        "UNIVERSALITY_SECRET_STORE",
    ])
    .map(|value| value.eq_ignore_ascii_case("file"))
    .unwrap_or(false)
}

pub fn store_secret_value(secret_ref: &SecretRef, secret: &str) -> Result<(), CommandError> {
    if using_file_secret_store() {
        FileSecretStore.store_secret(secret_ref, secret)
    } else {
        KeyringSecretStore.store_secret(secret_ref, secret)
    }
}

pub fn resolve_secret_value(secret_ref: &SecretRef) -> Result<String, CommandError> {
    if using_file_secret_store() {
        FileSecretStore.resolve_secret(secret_ref)
    } else {
        KeyringSecretStore.resolve_secret(secret_ref)
    }
}

fn file_secret_path() -> PathBuf {
    if let Some(path) = env_value(&[
        "DATAPADPLUSPLUS_SECRET_FILE",
        "DATANAUT_SECRET_FILE",
        "UNIVERSALITY_SECRET_FILE",
    ]) {
        return PathBuf::from(path);
    }

    if let Some(workspace_dir) = env_value(&[
        "DATAPADPLUSPLUS_WORKSPACE_DIR",
        "DATANAUT_WORKSPACE_DIR",
        "UNIVERSALITY_WORKSPACE_DIR",
    ]) {
        return PathBuf::from(workspace_dir).join("secrets.json");
    }

    std::env::temp_dir()
        .join("datapadplusplus")
        .join("secrets.json")
}

fn legacy_file_secret_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = std::env::var("DATANAUT_SECRET_FILE") {
        paths.push(PathBuf::from(path));
    }

    if let Ok(path) = std::env::var("UNIVERSALITY_SECRET_FILE") {
        paths.push(PathBuf::from(path));
    }

    if let Ok(workspace_dir) = std::env::var("DATANAUT_WORKSPACE_DIR") {
        paths.push(PathBuf::from(workspace_dir).join("secrets.json"));
    }

    if let Ok(workspace_dir) = std::env::var("UNIVERSALITY_WORKSPACE_DIR") {
        paths.push(PathBuf::from(workspace_dir).join("secrets.json"));
    }

    paths.push(std::env::temp_dir().join("datanaut").join("secrets.json"));
    paths.push(
        std::env::temp_dir()
            .join("universality")
            .join("secrets.json"),
    );
    paths
}

fn read_file_secrets(path: &PathBuf) -> Result<HashMap<String, EncryptedFileSecret>, CommandError> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(&content)?;
    if value
        .as_object()
        .is_some_and(|object| object.values().any(Value::is_string))
    {
        return Err(CommandError::new(
            "plaintext-secret-file-detected",
            "A legacy plaintext secret file was detected. Delete it and re-enter credentials so DataPad++ can store them encrypted.",
        ));
    }

    Ok(serde_json::from_value(value)?)
}

fn file_secret_key(secret_ref: &SecretRef) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret_ref.service.as_bytes());
    hasher.update([0]);
    hasher.update(secret_ref.account.as_bytes());
    BASE64.encode(hasher.finalize())
}

fn encrypt_file_secret(
    storage_key: &str,
    secret: &str,
) -> Result<EncryptedFileSecret, CommandError> {
    let key = file_secret_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| CommandError::new("file-secret-encryption", error.to_string()))?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: secret.as_bytes(),
                aad: storage_key.as_bytes(),
            },
        )
        .map_err(|error| CommandError::new("file-secret-encryption", error.to_string()))?;

    Ok(EncryptedFileSecret {
        version: FILE_SECRET_VERSION,
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_file_secret(
    storage_key: &str,
    encrypted: &EncryptedFileSecret,
) -> Result<String, CommandError> {
    if encrypted.version != FILE_SECRET_VERSION {
        return Err(CommandError::new(
            "file-secret-version",
            "Encrypted secret file uses an unsupported version.",
        ));
    }

    let key = file_secret_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| CommandError::new("file-secret-decryption", error.to_string()))?;
    let nonce_bytes = BASE64
        .decode(&encrypted.nonce)
        .map_err(|error| CommandError::new("file-secret-decryption", error.to_string()))?;
    let nonce_bytes: [u8; 12] = nonce_bytes.try_into().map_err(|_| {
        CommandError::new(
            "file-secret-decryption",
            "Encrypted secret file contains an invalid nonce.",
        )
    })?;
    let ciphertext = BASE64
        .decode(&encrypted.ciphertext)
        .map_err(|error| CommandError::new("file-secret-decryption", error.to_string()))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad: storage_key.as_bytes(),
            },
        )
        .map_err(|error| CommandError::new("file-secret-decryption", error.to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|error| CommandError::new("file-secret-decryption", error.to_string()))
}

fn file_secret_master_key() -> Result<[u8; 32], CommandError> {
    #[cfg(test)]
    {
        use std::sync::OnceLock;

        static TEST_FILE_SECRET_KEY: OnceLock<[u8; 32]> = OnceLock::new();
        return Ok(*TEST_FILE_SECRET_KEY.get_or_init(|| {
            let mut key = [0_u8; 32];
            OsRng.fill_bytes(&mut key);
            key
        }));
    }

    #[cfg(not(test))]
    {
        let secret_ref = SecretRef {
            id: "datapadplusplus-file-secret-master-key".into(),
            provider: "keyring".into(),
            service: FILE_SECRET_MASTER_SERVICE.into(),
            account: FILE_SECRET_MASTER_ACCOUNT.into(),
            label: "Encrypted file secret store master key".into(),
        };

        match KeyringSecretStore.resolve_secret(&secret_ref) {
            Ok(encoded) => decode_file_secret_master_key(&encoded),
            Err(_) => {
                let mut key = [0_u8; 32];
                OsRng.fill_bytes(&mut key);
                let encoded = BASE64.encode(key);
                KeyringSecretStore
                    .store_secret(&secret_ref, &encoded)
                    .map_err(|error| {
                        CommandError::new(
                            "file-secret-master-key",
                            format!(
                                "Encrypted file secret storage requires the OS keyring for its master key: {}",
                                error.message
                            ),
                        )
                    })?;
                Ok(key)
            }
        }
    }
}

#[cfg(not(test))]
fn decode_file_secret_master_key(encoded: &str) -> Result<[u8; 32], CommandError> {
    let decoded = BASE64
        .decode(encoded)
        .map_err(|error| CommandError::new("file-secret-master-key", error.to_string()))?;
    let key: [u8; 32] = decoded.try_into().map_err(|_| {
        CommandError::new(
            "file-secret-master-key",
            "Encrypted file secret store master key has an invalid length.",
        )
    })?;
    Ok(key)
}

pub fn connection_string_contains_secret(connection_string: &str) -> bool {
    let trimmed = connection_string.trim();
    if trimmed.is_empty() {
        return false;
    }

    url_connection_string_contains_secret(trimmed)
        || key_value_connection_string_contains_secret(trimmed)
        || secret_query_parameter_is_present(trimmed)
}

fn url_connection_string_contains_secret(value: &str) -> bool {
    let Some(scheme_index) = value.find("://") else {
        return false;
    };
    let authority_start = scheme_index + 3;
    let authority_end = value[authority_start..]
        .find(['/', '?', '#'])
        .map(|index| authority_start + index)
        .unwrap_or(value.len());
    let authority = &value[authority_start..authority_end];
    let Some(userinfo_end) = authority.rfind('@') else {
        return false;
    };
    let userinfo = &authority[..userinfo_end];
    userinfo
        .split_once(':')
        .is_some_and(|(_, password)| is_plain_secret_literal(password))
}

fn key_value_connection_string_contains_secret(value: &str) -> bool {
    value.split(';').any(|part| {
        let Some((key, raw_value)) = part.split_once('=') else {
            return false;
        };
        let key = key.trim().to_ascii_lowercase();
        let raw_value = raw_value.trim();
        is_plain_secret_literal(raw_value)
            && matches!(
                key.as_str(),
                "password"
                    | "pwd"
                    | "pass"
                    | "access token"
                    | "access_token"
                    | "auth_token"
                    | "client_secret"
                    | "private_key"
                    | "refresh_token"
                    | "sharedaccesskey"
                    | "shared access key"
                    | "secret"
                    | "secretkey"
                    | "secret key"
                    | "apikey"
                    | "api key"
                    | "token"
            )
    })
}

fn secret_query_parameter_is_present(value: &str) -> bool {
    let Some(query_start) = value.find('?') else {
        return false;
    };
    value[query_start + 1..].split('&').any(|part| {
        let Some((key, raw_value)) = part.split_once('=') else {
            return false;
        };
        let key = key.trim().to_ascii_lowercase();
        is_plain_secret_literal(raw_value)
            && matches!(
                key.as_str(),
                "password"
                    | "pwd"
                    | "access_token"
                    | "access-token"
                    | "auth_token"
                    | "auth-token"
                    | "client_secret"
                    | "client-secret"
                    | "private_key"
                    | "private-key"
                    | "refresh_token"
                    | "refresh-token"
                    | "token"
                    | "secret"
                    | "secretkey"
                    | "api_key"
                    | "apikey"
            )
    })
}

fn is_plain_secret_literal(value: &str) -> bool {
    let trimmed = value.trim();
    !(trimmed.is_empty()
        || (trimmed.starts_with("${") && trimmed.ends_with('}'))
        || matches!(trimmed, "****" | "***" | "<secret>" | "<redacted>"))
}

fn env_value(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
    })
}

pub fn evaluate_guardrails(
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    resolved_environment: &ResolvedEnvironment,
    query_text: &str,
    safe_mode_enabled: bool,
) -> GuardrailDecision {
    let query_risk = classify_query_risk(connection, query_text);
    let looks_write = query_risk.looks_write;
    let risky_query = looks_write || matches!(environment.risk.as_str(), "high" | "critical");

    if !resolved_environment.unresolved_keys.is_empty() {
        return GuardrailDecision {
            id: None,
            status: "block".into(),
            reasons: vec![
                "Unresolved environment variables must be fixed before execution.".into(),
            ],
            safe_mode_applied: safe_mode_enabled || environment.safe_mode,
            required_confirmation_text: None,
        };
    }

    if connection.read_only && looks_write {
        return GuardrailDecision {
            id: None,
            status: "block".into(),
            reasons: vec!["This connection is marked read-only.".into()],
            safe_mode_applied: safe_mode_enabled || environment.safe_mode,
            required_confirmation_text: None,
        };
    }

    let mut confirmation_reasons =
        environment_risky_confirmation_reasons(environment, safe_mode_enabled, risky_query);
    if let Some(reason) = query_risk.always_confirm_reason {
        confirmation_reasons.push(reason.into());
    }
    if !confirmation_reasons.is_empty() {
        return GuardrailDecision {
            id: None,
            status: "confirm".into(),
            reasons: confirmation_reasons,
            safe_mode_applied: safe_mode_enabled || environment.safe_mode,
            required_confirmation_text: Some(environment_confirmation_text(environment)),
        };
    }

    GuardrailDecision {
        id: None,
        status: "allow".into(),
        reasons: vec!["Guardrails cleared for the current query.".into()],
        safe_mode_applied: safe_mode_enabled || environment.safe_mode,
        required_confirmation_text: None,
    }
}

pub fn query_looks_write(query_text: &str) -> bool {
    classify_tokenized_query_risk(query_text).looks_write
}

#[derive(Debug, Default, Clone, Copy)]
struct QueryRisk {
    looks_write: bool,
    always_confirm_reason: Option<&'static str>,
}

fn classify_query_risk(connection: &ConnectionProfile, query_text: &str) -> QueryRisk {
    match connection.engine.as_str() {
        "mongodb" => classify_mongodb_query_risk(query_text),
        "redis" | "valkey" => classify_redis_query_risk(query_text),
        _ => classify_tokenized_query_risk(query_text),
    }
}

fn classify_mongodb_query_risk(query_text: &str) -> QueryRisk {
    let Ok(input) = serde_json::from_str::<Value>(query_text) else {
        return classify_tokenized_query_risk(query_text);
    };
    let operation = input
        .get("operation")
        .or_else(|| input.get("op"))
        .and_then(Value::as_str)
        .map(normalize_operation)
        .unwrap_or_else(|| {
            if input.get("command").is_some() {
                "runcommand".into()
            } else {
                "find".into()
            }
        });

    if matches!(
        operation.as_str(),
        "insertone"
            | "insertmany"
            | "updateone"
            | "updatemany"
            | "replaceone"
            | "deleteone"
            | "deletemany"
            | "bulkwrite"
    ) {
        return QueryRisk {
            looks_write: true,
            always_confirm_reason: Some(
                "MongoDB raw write operations require confirmation before execution.",
            ),
        };
    }

    if operation == "runcommand" {
        let command_name = input
            .get("command")
            .and_then(Value::as_object)
            .and_then(|command| command.keys().next())
            .map(|value| value.to_lowercase());
        if command_name.as_deref().is_some_and(|command| {
            matches!(
                command,
                "drop" | "dropdatabase" | "collmod" | "create" | "createindexes" | "dropindexes"
            )
        }) {
            return QueryRisk {
                looks_write: true,
                always_confirm_reason: Some(
                    "MongoDB administrative commands require confirmation before execution.",
                ),
            };
        }
    }

    QueryRisk::default()
}

fn classify_redis_query_risk(query_text: &str) -> QueryRisk {
    let command = query_tokens(query_text)
        .into_iter()
        .next()
        .unwrap_or_default();
    if command.is_empty() {
        return QueryRisk::default();
    }

    if matches!(
        command.as_str(),
        "del" | "unlink" | "flushdb" | "flushall" | "restore" | "rename" | "renamenx"
    ) {
        return QueryRisk {
            looks_write: true,
            always_confirm_reason: Some(
                "Redis destructive keyspace operations require confirmation before execution.",
            ),
        };
    }

    let write_command = matches!(
        command.as_str(),
        "set"
            | "mset"
            | "setex"
            | "psetex"
            | "hset"
            | "hmset"
            | "hdel"
            | "lpush"
            | "rpush"
            | "lset"
            | "lrem"
            | "sadd"
            | "srem"
            | "zadd"
            | "zrem"
            | "xadd"
            | "xdel"
            | "expire"
            | "pexpire"
            | "persist"
            | "json.set"
            | "json.del"
    );

    QueryRisk {
        looks_write: write_command,
        always_confirm_reason: None,
    }
}

fn classify_tokenized_query_risk(query_text: &str) -> QueryRisk {
    let tokens = query_tokens(query_text);
    let looks_write = tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert"
                | "update"
                | "delete"
                | "drop"
                | "truncate"
                | "alter"
                | "create"
                | "merge"
                | "replace"
                | "grant"
                | "revoke"
                | "flushdb"
                | "flushall"
        )
    });
    let destructive = tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "delete" | "drop" | "truncate" | "flushdb" | "flushall"
        )
    });

    QueryRisk {
        looks_write,
        always_confirm_reason: destructive
            .then_some("Destructive operations require confirmation before execution."),
    }
}

fn query_tokens(query_text: &str) -> Vec<String> {
    query_text
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || character == '_' || character == '.')
        })
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect()
}

fn normalize_operation(value: &str) -> String {
    value.replace(['_', '-', ' '], "").to_lowercase()
}

pub fn environment_confirmation_text(environment: &EnvironmentProfile) -> String {
    format!("CONFIRM {}", environment.label)
}

pub fn environment_risky_confirmation_reasons(
    environment: &EnvironmentProfile,
    safe_mode_enabled: bool,
    risky: bool,
) -> Vec<String> {
    if !risky {
        return Vec::new();
    }

    let mut reasons = Vec::new();

    if safe_mode_enabled {
        reasons.push("Global safe mode requires confirmation for risky work.".into());
    }

    if environment.safe_mode {
        reasons.push(format!(
            "{} safe mode requires confirmation for risky work.",
            environment.label
        ));
    }

    if environment.requires_confirmation {
        reasons.push(format!(
            "{} requires confirmation for risky work.",
            environment.label
        ));
    }

    if matches!(environment.risk.as_str(), "high" | "critical") {
        reasons.push(format!(
            "{} is a {} risk environment.",
            environment.label, environment.risk
        ));
    }

    reasons
}

fn derive_legacy_key(passphrase: &str) -> [u8; 32] {
    let digest = Sha256::digest(passphrase.as_bytes());
    let mut key = [0_u8; 32];
    key.copy_from_slice(&digest[..32]);
    key
}

fn derive_export_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    key
}

pub fn encrypt_export_payload(passphrase: &str, payload: &str) -> Result<String, CommandError> {
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_export_key(passphrase, &salt, EXPORT_KDF_ITERATIONS);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| CommandError::new("export-encryption", error.to_string()))?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, payload.as_bytes())
        .map_err(|error| CommandError::new("export-encryption", error.to_string()))?;

    Ok(BASE64.encode(
        json!({
            "kdf": EXPORT_KDF,
            "iterations": EXPORT_KDF_ITERATIONS,
            "salt": BASE64.encode(salt),
            "nonce": BASE64.encode(nonce_bytes),
            "ciphertext": BASE64.encode(ciphertext),
        })
        .to_string(),
    ))
}

pub fn decrypt_export_payload(
    passphrase: &str,
    encrypted_payload: &str,
) -> Result<String, CommandError> {
    let decoded = BASE64
        .decode(encrypted_payload)
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;
    let package: serde_json::Value = serde_json::from_slice(&decoded)?;
    let nonce_b64 = package["nonce"]
        .as_str()
        .ok_or_else(|| CommandError::new("export-decryption", "Missing nonce."))?;
    let ciphertext_b64 = package["ciphertext"]
        .as_str()
        .ok_or_else(|| CommandError::new("export-decryption", "Missing ciphertext."))?;
    let nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;
    let ciphertext = BASE64
        .decode(ciphertext_b64)
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;
    let key = if package["kdf"].as_str() == Some(EXPORT_KDF) {
        let salt_b64 = package["salt"]
            .as_str()
            .ok_or_else(|| CommandError::new("export-decryption", "Missing salt."))?;
        let iterations = package["iterations"]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| CommandError::new("export-decryption", "Invalid KDF iterations."))?;
        let salt = BASE64
            .decode(salt_b64)
            .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;
        derive_export_key(passphrase, &salt, iterations)
    } else {
        derive_legacy_key(passphrase)
    };
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|error| CommandError::new("export-decryption", error.to_string()))
}

#[cfg(test)]
mod tests {
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
    fn high_risk_environment_requires_confirmation_even_for_reads() {
        let decision = evaluate_guardrails(
            &connection(false),
            &environment("high", false, false),
            &resolved_environment(Vec::new()),
            "select * from accounts",
            false,
        );

        assert_eq!(decision.status, "confirm");
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("high risk")));
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
}
