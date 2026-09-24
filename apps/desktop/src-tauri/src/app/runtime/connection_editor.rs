use super::connection_secret_cleanup::owned_connection_secret as owned_secret;
use super::{generate_id, timestamp_now, ManagedAppState};
use crate::{
    domain::{
        error::CommandError,
        models::{BootstrapPayload, ConnectionProfile, SecretRef},
    },
    security,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSecretMutation {
    pub slot: String,
    pub action: String,
    pub value: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEditorSaveRequest {
    pub profile: ConnectionProfile,
    pub expected_updated_at: Option<String>,
    pub workspace_revision: u64,
    #[serde(default)]
    pub secrets: Vec<ConnectionSecretMutation>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSecretRevealRequest {
    pub connection_id: String,
    pub expected_updated_at: String,
    pub workspace_revision: u64,
    pub slot: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealedConnectionSecret {
    pub value: String,
}

fn secret_pointer(engine: &str, slot: &str) -> Result<String, CommandError> {
    if matches!(slot, "auth.secretRef" | "auth.connectionStringSecretRef") {
        return Ok(format!("/{}", slot.replace('.', "/")));
    }
    let catalogue: Value = serde_json::from_str(include_str!(
        "../../../../../../packages/shared-types/src/connection-editor-catalog.json"
    ))?;
    let allowed = catalogue
        .get(engine)
        .and_then(|item| item.get("fields"))
        .and_then(Value::as_array)
        .is_some_and(|fields| {
            fields
                .iter()
                .any(|field| field["kind"] == "secret" && field["path"] == slot)
        });
    if !allowed {
        return Err(CommandError::new(
            "connection-secret-slot",
            "This credential is not available for this connection.",
        ));
    }
    Ok(format!("/{}", slot.replace('.', "/")))
}

fn profile_secret(profile: &ConnectionProfile, pointer: &str) -> Option<SecretRef> {
    serde_json::to_value(profile)
        .ok()?
        .pointer(pointer)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
}
fn set_secret(
    profile: &mut ConnectionProfile,
    pointer: &str,
    secret: Option<&SecretRef>,
) -> Result<(), CommandError> {
    let mut value = serde_json::to_value(&*profile)?;
    let parts = pointer
        .trim_start_matches('/')
        .split('/')
        .collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(CommandError::new(
            "connection-secret-slot",
            "Unsupported credential slot.",
        ));
    }
    if !value[parts[0]].is_object() {
        value[parts[0]] = serde_json::json!({});
    }
    value[parts[0]][parts[1]] = serde_json::to_value(secret)?;
    *profile = serde_json::from_value(value)?;
    Ok(())
}
fn stale() -> CommandError {
    CommandError::new(
        "connection-editor-stale",
        "The workspace or connection changed. Reopen the connection editor before continuing.",
    )
}

impl ManagedAppState {
    pub fn reveal_connection_secret(
        &self,
        request: ConnectionSecretRevealRequest,
    ) -> Result<RevealedConnectionSecret, CommandError> {
        self.ensure_unlocked()?;
        if !request.confirmed {
            return Err(CommandError::new(
                "connection-reveal-confirmation",
                "Confirm before revealing a saved credential.",
            ));
        }
        if request.workspace_revision != self.snapshot.workspace_revision {
            return Err(stale());
        }
        let profile = self.connection_by_id(&request.connection_id)?;
        if profile.updated_at != request.expected_updated_at {
            return Err(stale());
        }
        let pointer = secret_pointer(&profile.engine, &request.slot)?;
        let secret = profile_secret(&profile, &pointer)
            .filter(owned_secret)
            .ok_or_else(|| {
                CommandError::new(
                    "connection-secret-unavailable",
                    "No DataPad++ credential is stored for this field.",
                )
            })?;
        let value = security::resolve_secret_value(&secret).map_err(|_| {
            CommandError::new(
                "connection-secret-unavailable",
                format!(
                    "The saved credential for {} ({}) is unavailable. Re-enter it to replace it.",
                    profile.name, profile.engine
                ),
            )
        })?;
        Ok(RevealedConnectionSecret { value })
    }

    pub fn save_connection_editor(
        &mut self,
        mut request: ConnectionEditorSaveRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        if request.workspace_revision != self.snapshot.workspace_revision {
            return Err(stale());
        }
        if super::datastore_mcp_server::has_active_runs()
            || self.snapshot.tabs.iter().any(|tab| {
                tab.connection_id == request.profile.id
                    && (tab.active_execution.is_some()
                        || matches!(tab.status.as_str(), "queued" | "running"))
            })
        {
            return Err(CommandError::new("connection-execution-active", "Wait for running MCP work and this connection's running queries to finish, or cancel them, before changing its settings."));
        }
        let previous = self
            .snapshot
            .connections
            .iter()
            .find(|profile| profile.id == request.profile.id)
            .cloned();
        if previous.as_ref().map(|profile| profile.updated_at.as_str())
            != request.expected_updated_at.as_deref()
        {
            return Err(stale());
        }
        if previous
            .as_ref()
            .is_some_and(|profile| profile.engine != request.profile.engine)
        {
            return Err(CommandError::new(
                "connection-engine-change",
                "Create a new connection to change datastore type.",
            ));
        }
        // References are backend-owned. A caller may replace values, not supply arbitrary vault accounts.
        let mut profile_json = serde_json::to_value(&request.profile)?;
        let previous_json = previous
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or(Value::Null);
        for (section, object) in profile_json.as_object_mut().into_iter().flatten() {
            if let Some(fields) = object.as_object_mut() {
                for (key, value) in fields {
                    if key == "secretRef"
                        || key.ends_with("SecretRef")
                        || key.ends_with("TokenRef")
                        || key == "secretAccessKeyRef"
                    {
                        *value = previous_json
                            .get(section)
                            .and_then(|value| value.get(key))
                            .cloned()
                            .unwrap_or(Value::Null);
                    }
                }
            }
        }
        request.profile = serde_json::from_value(profile_json)?;
        request.profile.connection_string = None;
        let mut created = Vec::new();
        let mut retired = Vec::new();
        let result = (|| {
            let mut seen = std::collections::HashSet::new();
            for mutation in &request.secrets {
                if !seen.insert(&mutation.slot) {
                    return Err(CommandError::new(
                        "connection-secret-duplicate",
                        "A credential can only be changed once per save.",
                    ));
                }
                let pointer = secret_pointer(&request.profile.engine, &mutation.slot)?;
                let old = previous
                    .as_ref()
                    .and_then(|profile| profile_secret(profile, &pointer));
                if mutation.slot == "auth.connectionStringSecretRef" {
                    match mutation.action.as_str() {
                        "replace" => {
                            let value = mutation.value.as_ref().filter(|value| !value.is_empty()).ok_or_else(|| CommandError::new("connection-string-required", "Enter a complete connection string."))?;
                            request.profile.connection_string = Some(value.clone());
                        }
                        "remove" if request.profile.connection_mode.as_deref() != Some("connection-string") => {
                            request.profile.auth.connection_string_secret_ref = None;
                        }
                        _ => return Err(CommandError::new("connection-string-required", "Replace the connection string or choose another connection method before removing it.")),
                    }
                    continue;
                }
                let replacement = match mutation.action.as_str() {
                    "remove" => None,
                    "replace" => {
                        let value = mutation
                            .value
                            .as_ref()
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| {
                                CommandError::new(
                                    "connection-secret-empty",
                                    "Enter a credential or explicitly remove it.",
                                )
                            })?;
                        let id = generate_id("connection-secret");
                        let secret = SecretRef {
                            id: id.clone(),
                            provider: "desktop-secret-store".into(),
                            service: "DataPadPlusPlus".into(),
                            account: format!("connection:{}:{id}", request.profile.id),
                            label: format!("{} credential", request.profile.name),
                        };
                        security::store_secret_value(&secret, value).map_err(|_| CommandError::new("connection-secret-store", format!("Unable to save a credential for {} ({}). No profile changes were saved.", request.profile.name, request.profile.engine)))?;
                        created.push(secret.clone());
                        Some(secret)
                    }
                    _ => {
                        return Err(CommandError::new(
                            "connection-secret-action",
                            "Unsupported credential action.",
                        ))
                    }
                };
                set_secret(&mut request.profile, &pointer, replacement.as_ref())?;
                if let Some(old) = old.filter(owned_secret) {
                    retired.push(old);
                }
            }
            request.profile.updated_at = timestamp_now();
            self.upsert_connection(request.profile.clone())
        })();
        if result.is_ok() {
            self.retire_connection_secrets(&retired);
        } else {
            for secret in created {
                let _ = security::delete_secret_value(&secret);
            }
        }
        result
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/connection_editor_tests.rs"]
mod tests;
