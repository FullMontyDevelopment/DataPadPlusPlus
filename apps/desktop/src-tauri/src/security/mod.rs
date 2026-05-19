use std::{collections::HashMap, fs, path::PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use serde_json::json;
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

pub trait SecretStore {
    fn store_secret(&self, secret_ref: &SecretRef, secret: &str) -> Result<(), CommandError>;
    fn resolve_secret(&self, secret_ref: &SecretRef) -> Result<String, CommandError>;
}

pub struct KeyringSecretStore;

pub struct FileSecretStore;

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
        secrets.insert(file_secret_key(secret_ref), secret.to_string());
        fs::write(path, serde_json::to_string_pretty(&secrets)?)?;
        Ok(())
    }

    fn resolve_secret(&self, secret_ref: &SecretRef) -> Result<String, CommandError> {
        let path = file_secret_path();
        let secrets = read_file_secrets(&path)?;
        if let Some(secret) = secrets.get(&file_secret_key(secret_ref)).cloned() {
            return Ok(secret);
        }

        for legacy_path in legacy_file_secret_paths() {
            if legacy_path == path {
                continue;
            }
            let legacy_secrets = read_file_secrets(&legacy_path)?;
            if let Some(secret) = legacy_secrets.get(&file_secret_key(secret_ref)).cloned() {
                return Ok(secret);
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

fn read_file_secrets(path: &PathBuf) -> Result<HashMap<String, String>, CommandError> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

fn file_secret_key(secret_ref: &SecretRef) -> String {
    format!("{}:{}", secret_ref.service, secret_ref.account)
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
    let looks_write = query_looks_write(query_text);
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

    let confirmation_reasons =
        environment_risky_confirmation_reasons(environment, safe_mode_enabled, risky_query);
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
    let normalized = query_text.to_lowercase();
    [
        "insert", "update", "delete", "drop", "truncate", "alter", "create", "flushdb", "flushall",
        "set ",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
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
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
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
