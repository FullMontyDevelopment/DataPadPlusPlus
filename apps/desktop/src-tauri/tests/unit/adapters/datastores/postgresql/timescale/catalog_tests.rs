use super::{timescale_manifest, timescale_operation_manifests};

#[test]
fn timescale_manifest_exposes_live_copy_without_pseudo_backup() {
    let manifest = timescale_manifest();
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "supports_import_export"));
    assert!(!manifest
        .capabilities
        .iter()
        .any(|capability| capability == "supports_backup_restore"));

    let operations = timescale_operation_manifests(&manifest);
    let transfer = operations
        .iter()
        .find(|operation| operation.id == "timescaledb.data.import-export")
        .expect("TimescaleDB transfer operation");
    assert_eq!(transfer.execution_support, "live");
    assert_eq!(transfer.preview_only, Some(false));
    assert!(!operations
        .iter()
        .any(|operation| operation.id == "timescaledb.data.backup-restore"));
    assert!(operations
        .iter()
        .any(|operation| operation.id == "timescaledb.timescale.job-control"));
}
