use super::*;

fn secret(id: &str, account: &str) -> SecretRef {
    SecretRef {
        id: id.into(),
        account: account.into(),
        service: "DataPadPlusPlus".into(),
        provider: "desktop-secret-store".into(),
        label: "Test credential".into(),
    }
}

#[test]
fn shared_vault_accounts_survive_replacement_even_with_different_reference_ids() {
    let old = secret("old", "shared");
    let mut active = super::super::blank_workspace_snapshot();
    let mut copy = crate::domain::models::ConnectionProfile::default();
    copy.auth.connection_string_secret_ref = Some(secret("copy", "shared"));
    active.connections.push(copy);
    let mut referenced = HashSet::new();
    retain_references(&active, &mut referenced).unwrap();
    assert!(retirement_candidates(&[old], &referenced).is_empty());
}

#[test]
fn inactive_workspace_references_are_retained() {
    let active = super::super::blank_workspace_snapshot();
    let mut inactive = active.clone();
    let old = secret("old", "shared");
    let mut copy = crate::domain::models::ConnectionProfile::default();
    copy.auth.secret_ref = Some(old.clone());
    inactive.connections.push(copy);
    let mut referenced = HashSet::new();
    retain_references(&active, &mut referenced).unwrap();
    retain_references(&inactive, &mut referenced).unwrap();
    assert!(retirement_candidates(&[old], &referenced).is_empty());
}

#[test]
fn deletes_only_unique_unreferenced_datapad_owned_accounts() {
    let old = secret("old", "unused");
    let mut foreign = secret("foreign", "unused");
    foreign.service = "another-application".into();
    let candidates = [old.clone(), old, foreign];
    let retired = retirement_candidates(&candidates, &HashSet::new());
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].account, "unused");
}
