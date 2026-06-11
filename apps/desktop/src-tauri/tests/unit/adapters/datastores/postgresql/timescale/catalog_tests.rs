use super::{timescale_manifest, timescale_operation_manifests};

#[test]
fn timescale_manifest_exposes_import_export_and_backup_contracts() {
    let manifest = timescale_manifest();
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "supports_import_export"));
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "supports_backup_restore"));

    let operations = timescale_operation_manifests(&manifest);
    assert!(operations
        .iter()
        .any(|operation| operation.id == "timescaledb.data.import-export"));
    assert!(operations
        .iter()
        .any(|operation| operation.id == "timescaledb.data.backup-restore"));
    assert!(operations
        .iter()
        .any(|operation| operation.id == "timescaledb.timescale.job-control"));
}
