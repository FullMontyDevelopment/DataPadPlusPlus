use serde_json::Value;
use sha2::{Digest, Sha256};

use super::workspace_bundle::{WorkspaceBundleIntegrity, WorkspaceBundlePayload};
use crate::domain::error::CommandError;

const WORKSPACE_BUNDLE_HASH_ALGORITHM: &str = "sha256";
const WORKSPACE_BUNDLE_HASH_SCOPE: &str = "workspace-bundle-payload-v1";

pub(super) fn create_workspace_bundle_integrity(
    payload: &WorkspaceBundlePayload,
) -> Result<WorkspaceBundleIntegrity, CommandError> {
    Ok(WorkspaceBundleIntegrity {
        algorithm: WORKSPACE_BUNDLE_HASH_ALGORITHM.into(),
        scope: WORKSPACE_BUNDLE_HASH_SCOPE.into(),
        digest: workspace_bundle_digest(payload)?,
    })
}

pub(super) fn validate_workspace_bundle_integrity(
    payload: &WorkspaceBundlePayload,
) -> Result<(), CommandError> {
    let Some(integrity) = &payload.integrity else {
        return Ok(());
    };

    if integrity.algorithm != WORKSPACE_BUNDLE_HASH_ALGORITHM
        || integrity.scope != WORKSPACE_BUNDLE_HASH_SCOPE
        || integrity.digest.len() != 64
        || !integrity
            .digest
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(CommandError::new(
            "workspace-bundle-integrity-invalid",
            "Workspace bundle integrity metadata is unsupported.",
        ));
    }

    if workspace_bundle_digest(payload)? != integrity.digest.to_ascii_lowercase() {
        return Err(CommandError::new(
            "workspace-bundle-integrity-mismatch",
            "Workspace bundle integrity check failed. The file may be corrupt or modified.",
        ));
    }

    Ok(())
}

fn workspace_bundle_digest(payload: &WorkspaceBundlePayload) -> Result<String, CommandError> {
    let value = serde_json::json!({
        "snapshot": &payload.snapshot,
        "secrets": &payload.secrets,
    });
    let canonical = canonical_json(&value)?;
    let digest = Sha256::digest(canonical.as_bytes());
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn canonical_json(value: &Value) -> Result<String, CommandError> {
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => serde_json::to_string(value).map_err(CommandError::from),
        Value::Array(items) => Ok(format!(
            "[{}]",
            items
                .iter()
                .map(canonical_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut entries = Vec::with_capacity(keys.len());

            for key in keys {
                let encoded_key = serde_json::to_string(key).map_err(CommandError::from)?;
                let encoded_value =
                    canonical_json(object.get(key).ok_or_else(|| {
                        CommandError::new("serialization-error", "Missing key.")
                    })?)?;
                entries.push(format!("{encoded_key}:{encoded_value}"));
            }

            Ok(format!("{{{}}}", entries.join(",")))
        }
    }
}
