use std::collections::HashSet;

use super::{workspace_bundle::modeled_workspace_secret_refs, ManagedAppState};
use crate::{
    domain::{
        error::CommandError,
        models::{SecretRef, WorkspaceSnapshot},
    },
    infrastructure, persistence, security,
};

pub(super) fn owned_connection_secret(secret: &SecretRef) -> bool {
    matches!(secret.service.as_str(), "DataPadPlusPlus" | "DataPad++")
        && matches!(
            secret.provider.as_str(),
            "os-keyring" | "desktop-secret-store"
        )
}

fn retain_references(
    snapshot: &WorkspaceSnapshot,
    referenced: &mut HashSet<(String, String)>,
) -> Result<(), CommandError> {
    for secret in modeled_workspace_secret_refs(snapshot)?.into_values() {
        referenced.insert((secret.service, secret.account));
    }
    if let Some(secret) = &snapshot.preferences.workspace_backups.passphrase_secret_ref {
        referenced.insert((secret.service.clone(), secret.account.clone()));
    }
    Ok(())
}

fn retirement_candidates<'a>(
    secrets: &'a [SecretRef],
    referenced: &HashSet<(String, String)>,
) -> Vec<&'a SecretRef> {
    let mut seen = HashSet::new();
    secrets
        .iter()
        .filter(|secret| {
            let key = (secret.service.clone(), secret.account.clone());
            owned_connection_secret(secret) && !referenced.contains(&key) && seen.insert(key)
        })
        .collect()
}

impl ManagedAppState {
    /// Called only after durable profile persistence. Copies may share references,
    /// including across inactive workspaces; uncertainty always retains the value.
    pub(super) fn retire_connection_secrets(&self, secrets: &[SecretRef]) {
        if secrets.is_empty() {
            return;
        }
        let mut referenced = HashSet::new();
        let inventory = retain_references(&self.snapshot, &mut referenced).and_then(|()| {
            persistence::visit_inactive_workspace_snapshots(&self.app, |snapshot| {
                retain_references(&snapshot, &mut referenced)
            })
        });
        if inventory.is_err() {
            infrastructure::log_breadcrumb(
                "connections",
                "credential-cleanup-deferred-incomplete-inventory",
            );
            return;
        }
        for secret in retirement_candidates(secrets, &referenced) {
            if security::delete_secret_value(secret).is_err() {
                infrastructure::log_breadcrumb(
                    "connections",
                    "credential-cleanup-deferred-vault-unavailable",
                );
            }
        }
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/connection_secret_cleanup_tests.rs"]
mod tests;
