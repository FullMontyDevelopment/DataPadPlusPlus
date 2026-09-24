use super::*;
#[test]
fn secrets_are_selected_by_known_slot_not_vault_coordinates() {
    assert!(secret_pointer("mongodb", "auth.connectionStringSecretRef").is_ok());
    assert!(secret_pointer("oracle", "oracleOptions.walletPasswordSecretRef").is_ok());
    assert!(secret_pointer("mongodb", "oracleOptions.walletPasswordSecretRef").is_err());
    assert!(secret_pointer("mongodb", "__proto__.password").is_err());
}
#[test]
fn secret_references_remain_separate_from_values() {
    let mut profile = ConnectionProfile::default();
    let secret = SecretRef {
        id: "test".into(),
        provider: "os-keyring".into(),
        service: "DataPadPlusPlus".into(),
        account: "test".into(),
        label: "test".into(),
    };
    set_secret(&mut profile, "/auth/secretRef", Some(&secret)).unwrap();
    assert_eq!(
        profile_secret(&profile, "/auth/secretRef").unwrap().id,
        "test"
    );
    set_secret(&mut profile, "/auth/secretRef", None).unwrap();
    assert!(profile_secret(&profile, "/auth/secretRef").is_none());
}
