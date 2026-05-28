use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    domain::{
        error::CommandError,
        models::{SecretRef, WorkspaceSnapshot},
    },
    security,
};

const MAX_WORKSPACE_BUNDLE_BYTES: usize = 25 * 1024 * 1024;
const MAX_WORKSPACE_BUNDLE_SECRET_BYTES: usize = 64 * 1024;
const MAX_WORKSPACE_BUNDLE_SECRET_FIELD_LENGTH: usize = 512;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundlePayload {
    pub(super) snapshot: WorkspaceSnapshot,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) secrets: Vec<WorkspaceBundleSecret>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundleSecret {
    pub(super) secret_ref: SecretRef,
    pub(super) value: String,
}

pub(super) fn parse_workspace_bundle_payload(
    decrypted: &str,
) -> Result<WorkspaceBundlePayload, CommandError> {
    if let Ok(payload) = serde_json::from_str::<WorkspaceBundlePayload>(decrypted) {
        validate_workspace_bundle_secrets(&payload.secrets)?;
        return Ok(payload);
    }

    let snapshot = serde_json::from_str::<WorkspaceSnapshot>(decrypted)?;
    Ok(WorkspaceBundlePayload {
        snapshot,
        secrets: Vec::new(),
    })
}

pub(super) fn collect_workspace_bundle_secrets(
    snapshot: &WorkspaceSnapshot,
) -> Result<Vec<WorkspaceBundleSecret>, CommandError> {
    let mut refs_by_key = HashMap::<String, SecretRef>::new();
    let value = serde_json::to_value(snapshot)?;
    collect_secret_refs_from_value(&value, &mut refs_by_key);

    let mut secrets = Vec::new();
    let mut missing = Vec::new();

    for secret_ref in refs_by_key.into_values() {
        match security::resolve_secret_value(&secret_ref) {
            Ok(value) => secrets.push(WorkspaceBundleSecret { secret_ref, value }),
            Err(_) => missing.push(secret_ref.label),
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
                refs_by_key.insert(
                    format!(
                        "{}\u{1f}{}\u{1f}{}",
                        secret_ref.service, secret_ref.account, secret_ref.id
                    ),
                    secret_ref,
                );
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
