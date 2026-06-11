use super::*;

#[test]
fn sqlite_manifest_exposes_local_maintenance_operations() {
    let manifest = sqlite_manifest();
    let operations = sqlite_operation_manifests(&manifest);
    let ids = operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect::<Vec<_>>();

    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "supports_admin_operations"));
    assert!(ids.contains(&"sqlite.database.integrity-check"));
    assert!(ids.contains(&"sqlite.database.backup"));
    assert!(ids.contains(&"sqlite.table.export"));
    assert!(ids.contains(&"sqlite.table.import"));
    assert!(ids.contains(&"sqlite.database.vacuum"));
    assert!(ids.contains(&"sqlite.index.reindex"));
    assert_eq!(
        operations
            .iter()
            .find(|operation| operation.id == "sqlite.table.export")
            .map(|operation| operation.execution_support.as_str()),
        Some("live")
    );
}
