use super::*;

mod objects;
mod providers;

pub(crate) fn experience_manifest_for_manifest(
    manifest: &AdapterManifest,
) -> DatastoreExperienceManifest {
    providers::experience_manifest_for_manifest(manifest)
}

#[cfg(test)]
#[path = "../../tests/unit/adapters/experience_tests.rs"]
mod tests;
