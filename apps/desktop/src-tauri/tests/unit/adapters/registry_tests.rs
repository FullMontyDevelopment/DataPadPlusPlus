use std::collections::HashSet;

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
