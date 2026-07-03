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
        Ok(*TEST_FILE_SECRET_KEY.get_or_init(|| {
            let mut key = [0_u8; 32];
            OsRng.fill_bytes(&mut key);
            key
        }))
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
    let safe_mode_applied = looks_write && (safe_mode_enabled || environment.safe_mode);

    if !resolved_environment.unresolved_keys.is_empty() {
        return GuardrailDecision {
            id: None,
            status: "block".into(),
            reasons: vec![
                "Unresolved environment variables must be fixed before execution.".into(),
            ],
            safe_mode_applied,
            required_confirmation_text: None,
        };
    }

    if connection.read_only && looks_write {
        return GuardrailDecision {
            id: None,
            status: "block".into(),
            reasons: vec!["This connection is marked read-only.".into()],
            safe_mode_applied,
            required_confirmation_text: None,
        };
    }

    let mut confirmation_reasons =
        environment_risky_confirmation_reasons(environment, safe_mode_enabled, looks_write);
    if let Some(reason) = query_risk.always_confirm_reason {
        confirmation_reasons.push(reason.into());
    }
    if !confirmation_reasons.is_empty() {
        return GuardrailDecision {
            id: None,
            status: "confirm".into(),
            reasons: confirmation_reasons,
            safe_mode_applied,
            required_confirmation_text: Some(environment_confirmation_text(environment)),
        };
    }

    GuardrailDecision {
        id: None,
        status: "allow".into(),
        reasons: vec!["Guardrails cleared for the current query.".into()],
        safe_mode_applied,
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
#[path = "../../tests/unit/security/mod_tests.rs"]
mod tests;
