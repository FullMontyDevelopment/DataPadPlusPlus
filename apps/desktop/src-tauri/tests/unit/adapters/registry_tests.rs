use std::collections::HashSet;
use std::path::PathBuf;

use super::*;

#[test]
fn adapter_registrations_are_unique_and_match_adapter_manifests() {
    let mut seen = HashSet::new();

    for registration in adapter_registrations() {
        assert!(
            seen.insert(registration.engine),
            "duplicate native adapter registration for {}",
            registration.engine
        );

        let adapter = (registration.adapter)();
        let manifest = adapter.manifest();
        let capabilities = adapter.execution_capabilities();

        assert_eq!(
            manifest.engine, registration.engine,
            "native adapter registration should match its manifest engine"
        );
        assert!(
            capabilities.default_row_limit > 0,
            "{} should expose a positive default row limit",
            registration.engine
        );
        assert!(
            !capabilities.editor_language.trim().is_empty(),
            "{} should expose an editor language",
            registration.engine
        );
    }
}

#[test]
fn public_native_manifest_list_preserves_one_manifest_per_engine() {
    let mut seen = HashSet::new();

    for manifest in manifests() {
        assert!(
            seen.insert(manifest.engine.clone()),
            "duplicate native manifest for {}",
            manifest.engine
        );
        assert!(
            !manifest.label.trim().is_empty(),
            "{} should expose a label",
            manifest.engine
        );
        assert!(
            !manifest.capabilities.is_empty(),
            "{} should expose capabilities",
            manifest.engine
        );
    }
}

#[test]
fn adapter_contracts_match_the_normalized_all_engine_fixture() {
    let contracts = manifests()
        .into_iter()
        .map(|manifest| {
            let adapter = adapter_for_engine(&manifest.engine)
                .unwrap_or_else(|error| panic!("{}: {}", manifest.engine, error.message));
            let tree = datastore_tree_manifest(&manifest.engine, &manifest.family);
            serde_json::json!({
                "manifest": manifest,
                "tree": tree,
                "experience": adapter.experience_manifest(),
                "operations": adapter.operation_manifests(),
            })
        })
        .collect::<Vec<_>>();
    let actual = serde_json::to_string_pretty(&contracts).expect("serialize adapter contracts");
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/architecture/datastore-adapter-contracts.json");

    if std::env::var_os("UPDATE_DATASTORE_CONTRACT_FIXTURES").is_some() {
        std::fs::write(&fixture_path, format!("{actual}\n"))
            .expect("write normalized adapter contract fixture");
    }

    let expected = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display()));
    assert_eq!(actual, expected.trim_end());
}
