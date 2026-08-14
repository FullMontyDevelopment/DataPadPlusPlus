use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::workspace_bundle_integrity::{
    create_workspace_bundle_integrity, validate_workspace_bundle_integrity,
};
use crate::{
    domain::{
        error::CommandError,
        models::{SecretRef, WorkspaceSnapshot},
    },
    persistence, security,
};

const MAX_WORKSPACE_BUNDLE_BYTES: usize = 25 * 1024 * 1024;
const MAX_WORKSPACE_BUNDLE_SECRET_BYTES: usize = 64 * 1024;
const MAX_WORKSPACE_BUNDLE_SECRET_FIELD_LENGTH: usize = 512;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundlePayload {
    pub(super) snapshot: WorkspaceSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_workspace_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) history_query_texts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) secrets: Vec<WorkspaceBundleSecret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) integrity: Option<WorkspaceBundleIntegrity>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundleSecret {
    pub(super) secret_ref: SecretRef,
    pub(super) value: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundleIntegrity {
    pub(super) algorithm: String,
    pub(super) scope: String,
    pub(super) digest: String,
}

pub(super) fn workspace_bundle_payload_with_integrity(
    snapshot: WorkspaceSnapshot,
    secrets: Vec<WorkspaceBundleSecret>,
) -> Result<WorkspaceBundlePayload, CommandError> {
    workspace_bundle_payload_with_source_name(snapshot, secrets, None)
}

pub(super) fn workspace_bundle_payload_with_source_name(
    snapshot: WorkspaceSnapshot,
    secrets: Vec<WorkspaceBundleSecret>,
    source_workspace_name: Option<String>,
) -> Result<WorkspaceBundlePayload, CommandError> {
    let mut payload = WorkspaceBundlePayload {
        snapshot,
        source_workspace_name,
        history_query_texts: Vec::new(),
        secrets,
        integrity: None,
    };
    intern_workspace_history_queries(&mut payload);
    payload.integrity = Some(create_workspace_bundle_integrity(&payload)?);
    Ok(payload)
}

pub(super) fn parse_workspace_bundle_payload(
    decrypted: &str,
) -> Result<WorkspaceBundlePayload, CommandError> {
    if let Ok(mut payload) = serde_json::from_str::<WorkspaceBundlePayload>(decrypted) {
        persistence::validate_workspace_schema_version(payload.snapshot.schema_version)?;
        validate_workspace_bundle_secrets(&payload.secrets)?;
        validate_workspace_bundle_integrity(&payload)?;
        restore_workspace_history_queries(&mut payload)?;
        return Ok(payload);
    }

    let snapshot = serde_json::from_str::<WorkspaceSnapshot>(decrypted)?;
    persistence::validate_workspace_schema_version(snapshot.schema_version)?;
    Ok(WorkspaceBundlePayload {
        snapshot,
        source_workspace_name: None,
        history_query_texts: Vec::new(),
        secrets: Vec::new(),
        integrity: None,
    })
}

pub(super) fn collect_workspace_bundle_secrets(
    snapshot: &WorkspaceSnapshot,
) -> Result<Vec<WorkspaceBundleSecret>, CommandError> {
    let refs_by_key = modeled_workspace_secret_refs(snapshot)?;
    let contexts_by_key = modeled_workspace_secret_contexts(snapshot)?;

    let mut secrets = Vec::new();
    let mut missing = Vec::new();

    for secret_ref in refs_by_key.into_values() {
        match security::resolve_secret_value(&secret_ref) {
            Ok(value) => secrets.push(WorkspaceBundleSecret { secret_ref, value }),
            Err(_) => missing.push(
                contexts_by_key
                    .get(&secret_ref_key(&secret_ref))
                    .cloned()
                    .unwrap_or(secret_ref.label),
            ),
        }
    }

    if !missing.is_empty() {
        missing.sort();
        missing.dedup();
        return Err(CommandError::new(
            "workspace-bundle-secret-missing",
            format!(
                "Some selected secrets could not be included: {}. Re-enter them or export without passwords.",
                missing.join(", ")
            ),
        ));
    }

    secrets.sort_by(|left, right| left.secret_ref.id.cmp(&right.secret_ref.id));
    Ok(secrets)
}

fn modeled_workspace_secret_contexts(
    snapshot: &WorkspaceSnapshot,
) -> Result<HashMap<String, String>, CommandError> {
    let mut contexts = HashMap::new();
    for connection in &snapshot.connections {
        let mut refs = HashMap::new();
        collect_secret_refs_from_value(&serde_json::to_value(connection)?, &mut refs);
        for key in refs.into_keys() {
            contexts.insert(
                key,
                format!("Connection '{}' ({})", connection.name, connection.engine),
            );
        }
    }
    for environment in &snapshot.environments {
        let mut refs = HashMap::new();
        collect_secret_refs_from_value(&serde_json::to_value(environment)?, &mut refs);
        for key in refs.into_keys() {
            contexts.insert(key, format!("Environment '{}'", environment.label));
        }
    }
    let mut refs = HashMap::new();
    collect_secret_refs_from_value(
        &serde_json::to_value(&snapshot.preferences.datastore_mcp_server)?,
        &mut refs,
    );
    for key in refs.into_keys() {
        contexts.insert(key, "MCP Server credential".into());
    }
    Ok(contexts)
}

pub(super) fn prepare_imported_workspace_secrets(
    mut snapshot: WorkspaceSnapshot,
    mut secrets: Vec<WorkspaceBundleSecret>,
    import_secrets: bool,
) -> Result<(WorkspaceSnapshot, Vec<WorkspaceBundleSecret>), CommandError> {
    // Automatic-backup credentials are local machine configuration, not
    // portable workspace content. Legacy bundles may contain the reference.
    snapshot.preferences.workspace_backups.enabled = false;
    snapshot.preferences.workspace_backups.passphrase_secret_ref = None;
    if !import_secrets {
        for secret in &mut secrets {
            secret.value.clear();
        }
        for connection in &mut snapshot.connections {
            connection.connection_string = None;
            connection.auth.connection_string_secret_ref = None;
            connection.auth.connection_string_secret_bindings.clear();
        }
        snapshot
            .preferences
            .datastore_mcp_server
            .servers
            .iter_mut()
            .for_each(|server| {
                server.tokens.clear();
            });
        return Ok((strip_workspace_secret_references(snapshot)?, Vec::new()));
    }

    // A legacy bundle can contain plaintext connection strings without a
    // separate secret inventory. The caller's explicit opt-in allows the
    // schema-12 migration to move those values into fresh local vault entries.
    if secrets.is_empty() {
        return Ok((snapshot, Vec::new()));
    }

    let allowed_refs = modeled_workspace_secret_refs(&snapshot)?;
    let mut replacements = HashMap::<String, SecretRef>::new();
    let mut imported = Vec::with_capacity(secrets.len());

    for secret in secrets {
        // Older bundle formats used generic recursive discovery and could include
        // the local automatic-backup passphrase. It is never workspace content:
        // ignore that known legacy entry rather than importing or remapping it.
        if is_legacy_auto_backup_secret(&secret.secret_ref) {
            continue;
        }
        let key = secret_ref_key(&secret.secret_ref);
        if !allowed_refs.contains_key(&key) || replacements.contains_key(&key) {
            return Err(CommandError::new(
                "workspace-bundle-secret-reference-invalid",
                "Workspace bundle contains an unexpected or duplicate secret reference.",
            ));
        }

        let id = super::generate_id("import-secret");
        let fresh_ref = SecretRef {
            id: id.clone(),
            provider: "desktop-secret-store".into(),
            service: "DataPadPlusPlus".into(),
            account: format!("workspace-import:{id}"),
            label: secret.secret_ref.label,
        };
        replacements.insert(key, fresh_ref.clone());
        imported.push(WorkspaceBundleSecret {
            secret_ref: fresh_ref,
            value: secret.value,
        });
    }

    if replacements.len() != allowed_refs.len() {
        return Err(CommandError::new(
            "workspace-bundle-secret-missing",
            "Workspace bundle does not include every credential required by its workspace snapshot.",
        ));
    }

    let mut value = serde_json::to_value(snapshot)?;
    replace_workspace_secret_references(&mut value, &replacements);
    Ok((serde_json::from_value(value)?, imported))
}

fn is_legacy_auto_backup_secret(secret_ref: &SecretRef) -> bool {
    secret_ref.id == "workspace-auto-backup-passphrase"
        && secret_ref.service == "datapadplusplus.workspace-backup"
}

fn modeled_workspace_secret_refs(
    snapshot: &WorkspaceSnapshot,
) -> Result<HashMap<String, SecretRef>, CommandError> {
    let mut refs_by_key = HashMap::<String, SecretRef>::new();
    for connection in &snapshot.connections {
        collect_secret_refs_from_value(&serde_json::to_value(connection)?, &mut refs_by_key);
    }
    for environment in &snapshot.environments {
        collect_secret_refs_from_value(&serde_json::to_value(environment)?, &mut refs_by_key);
    }
    collect_secret_refs_from_value(
        &serde_json::to_value(&snapshot.preferences.datastore_mcp_server)?,
        &mut refs_by_key,
    );
    Ok(refs_by_key)
}

pub(super) fn strip_workspace_secret_references(
    snapshot: WorkspaceSnapshot,
) -> Result<WorkspaceSnapshot, CommandError> {
    let mut value = serde_json::to_value(snapshot)?;
    remove_secret_refs_from_value(&mut value);
    Ok(serde_json::from_value(value)?)
}

fn remove_secret_refs_from_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                remove_secret_refs_from_value(item);
            }
        }
        serde_json::Value::Object(object) => {
            let has_connection_string_bindings = object
                .get("auth")
                .and_then(serde_json::Value::as_object)
                .and_then(|auth| auth.get("connectionStringSecretBindings"))
                .and_then(serde_json::Value::as_array)
                .is_some_and(|bindings| !bindings.is_empty());
            if has_connection_string_bindings {
                object.insert("connectionString".into(), serde_json::Value::Null);
            }
            if let Some(serde_json::Value::Array(bindings)) =
                object.get_mut("connectionStringSecretBindings")
            {
                bindings.clear();
            }
            if secret_ref_from_object(object).is_some() {
                *value = serde_json::Value::Null;
                return;
            }
            for nested in object.values_mut() {
                remove_secret_refs_from_value(nested);
            }
        }
        _ => {}
    }
}

fn replace_workspace_secret_references(
    value: &mut serde_json::Value,
    replacements: &HashMap<String, SecretRef>,
) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                replace_workspace_secret_references(item, replacements);
            }
        }
        serde_json::Value::Object(object) => {
            if let Some(secret_ref) = secret_ref_from_object(object) {
                if let Some(replacement) = replacements.get(&secret_ref_key(&secret_ref)) {
                    if let Ok(replacement_value) = serde_json::to_value(replacement) {
                        *value = replacement_value;
                    }
                }
                return;
            }
            for nested in object.values_mut() {
                replace_workspace_secret_references(nested, replacements);
            }
        }
        _ => {}
    }
}

fn secret_ref_key(secret_ref: &SecretRef) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}",
        secret_ref.service, secret_ref.account, secret_ref.id
    )
}

fn intern_workspace_history_queries(payload: &mut WorkspaceBundlePayload) {
    let mut indexes = HashMap::<String, usize>::new();

    for entry in payload
        .snapshot
        .tabs
        .iter_mut()
        .flat_map(|tab| tab.history.iter_mut())
        .chain(
            payload
                .snapshot
                .closed_tabs
                .iter_mut()
                .flat_map(|closed| closed.tab.history.iter_mut()),
        )
    {
        let query_text = std::mem::take(&mut entry.query_text);
        let index = if let Some(index) = indexes.get(&query_text) {
            *index
        } else {
            let index = payload.history_query_texts.len();
            indexes.insert(query_text.clone(), index);
            payload.history_query_texts.push(query_text);
            index
        };
        entry.query_text = format!("@q:{index}");
    }
}

fn restore_workspace_history_queries(
    payload: &mut WorkspaceBundlePayload,
) -> Result<(), CommandError> {
    if payload.history_query_texts.is_empty() {
        return Ok(());
    }

    for entry in payload
        .snapshot
        .tabs
        .iter_mut()
        .flat_map(|tab| tab.history.iter_mut())
        .chain(
            payload
                .snapshot
                .closed_tabs
                .iter_mut()
                .flat_map(|closed| closed.tab.history.iter_mut()),
        )
    {
        let index = entry
            .query_text
            .strip_prefix("@q:")
            .and_then(|value| value.parse::<usize>().ok())
            .and_then(|index| payload.history_query_texts.get(index))
            .ok_or_else(|| {
                CommandError::new(
                    "workspace-bundle-history-invalid",
                    "Workspace bundle history references are invalid.",
                )
            })?;
        entry.query_text.clone_from(index);
    }

    payload.history_query_texts.clear();
    Ok(())
}

pub(super) fn validate_bundle_passphrase(passphrase: &str) -> Result<(), CommandError> {
    let trimmed = passphrase.trim();

    if trimmed.is_empty() {
        return Err(CommandError::new(
            "workspace-bundle-passphrase-required",
            "Enter a workspace backup passphrase.",
        ));
    }

    if is_common_workspace_passphrase(trimmed) {
        return Err(CommandError::new(
            "common-workspace-bundle-passphrase",
            "Choose a less common workspace backup passphrase.",
        ));
    }

    Ok(())
}

pub(super) fn validate_bundle_payload_size(encrypted_payload: &str) -> Result<(), CommandError> {
    if encrypted_payload.trim().is_empty() {
        return Err(CommandError::new(
            "workspace-bundle-required",
            "Choose a workspace bundle before importing.",
        ));
    }

    if encrypted_payload.len() > MAX_WORKSPACE_BUNDLE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "Workspace bundle is too large to import safely.",
        ));
    }

    Ok(())
}

fn validate_workspace_bundle_secrets(
    secrets: &[WorkspaceBundleSecret],
) -> Result<(), CommandError> {
    for secret in secrets {
        validate_bundle_secret_ref(&secret.secret_ref)?;

        if secret.value.is_empty() {
            return Err(CommandError::new(
                "workspace-bundle-secret-invalid",
                "Workspace bundle includes an empty secret value.",
            ));
        }

        if secret.value.contains('\0') {
            return Err(CommandError::new(
                "workspace-bundle-secret-invalid",
                "Workspace bundle includes a secret value with unsupported control data.",
            ));
        }

        if secret.value.len() > MAX_WORKSPACE_BUNDLE_SECRET_BYTES {
            return Err(CommandError::new(
                "workspace-bundle-secret-too-large",
                "Workspace bundle includes a secret value that is too large to import safely.",
            ));
        }
    }

    Ok(())
}

fn validate_bundle_secret_ref(secret_ref: &SecretRef) -> Result<(), CommandError> {
    validate_bundle_secret_id(&secret_ref.id, "Secret id")?;
    validate_bundle_secret_text(&secret_ref.provider, "Secret provider")?;
    validate_bundle_secret_text(&secret_ref.service, "Secret service")?;
    validate_bundle_secret_text(&secret_ref.account, "Secret account")?;
    validate_bundle_secret_text(&secret_ref.label, "Secret label")
}

fn validate_bundle_secret_id(value: &str, label: &str) -> Result<(), CommandError> {
    validate_bundle_secret_text(value, label)?;

    if !value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        return Err(CommandError::new(
            "workspace-bundle-secret-invalid",
            format!("{label} contains unsupported characters."),
        ));
    }

    Ok(())
}

fn validate_bundle_secret_text(value: &str, label: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() {
        return Err(CommandError::new(
            "workspace-bundle-secret-invalid",
            format!("{label} is required."),
        ));
    }

    if value.len() > MAX_WORKSPACE_BUNDLE_SECRET_FIELD_LENGTH {
        return Err(CommandError::new(
            "workspace-bundle-secret-invalid",
            format!("{label} is too long."),
        ));
    }

    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "workspace-bundle-secret-invalid",
            format!("{label} cannot contain control characters."),
        ));
    }

    Ok(())
}

fn collect_secret_refs_from_value(
    value: &serde_json::Value,
    refs_by_key: &mut HashMap<String, SecretRef>,
) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_secret_refs_from_value(item, refs_by_key);
            }
        }
        serde_json::Value::Object(object) => {
            if let Some(secret_ref) = secret_ref_from_object(object) {
                refs_by_key.insert(secret_ref_key(&secret_ref), secret_ref);
                return;
            }

            for nested in object.values() {
                collect_secret_refs_from_value(nested, refs_by_key);
            }
        }
        _ => {}
    }
}

fn secret_ref_from_object(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Option<SecretRef> {
    let id = object.get("id")?.as_str()?;
    let provider = object.get("provider")?.as_str()?;
    let service = object.get("service")?.as_str()?;
    let account = object.get("account")?.as_str()?;
    let label = object.get("label")?.as_str()?;

    Some(SecretRef {
        id: id.into(),
        provider: provider.into(),
        service: service.into(),
        account: account.into(),
        label: label.into(),
    })
}

fn is_common_workspace_passphrase(passphrase: &str) -> bool {
    const COMMON_PASSPHRASES: &[&str] = &[
        "000000",
        "111111",
        "12345",
        "123456",
        "1234567",
        "12345678",
        "123456789",
        "1234567890",
        "abc123",
        "admin",
        "administrator",
        "changeme",
        "default",
        "dragon",
        "football",
        "iloveyou",
        "letmein",
        "login",
        "monkey",
        "password",
        "password1",
        "password123",
        "passw0rd",
        "qwerty",
        "qwerty123",
        "secret",
        "welcome",
    ];
    let folded = passphrase.to_ascii_lowercase();
    let compact = folded
        .chars()
        .filter(|character| !matches!(*character, ' ' | '.' | '_' | '-'))
        .collect::<String>();
    let alphanumeric = folded
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>();

    COMMON_PASSPHRASES.contains(&folded.as_str())
        || COMMON_PASSPHRASES.contains(&compact.as_str())
        || COMMON_PASSPHRASES.contains(&alphanumeric.as_str())
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/workspace_bundle_tests.rs"]
mod tests;
