use super::*;

#[test]
fn sqlserver_live_file_workflow_manifests_are_guarded() {
    let operations = SqlServerAdapter.operation_manifests();

    let import_export = operations
        .iter()
        .find(|operation| operation.id == "sqlserver.data.import-export")
        .expect("import/export manifest");
    assert_eq!(import_export.execution_support, "live");
    assert_eq!(import_export.preview_only, Some(false));
    assert!(import_export.disabled_reason.is_none());
    let backup = operations
        .iter()
        .find(|operation| operation.id == "sqlserver.data.backup-restore")
        .expect("backup manifest");
    assert_eq!(backup.execution_support, "live");
    assert_eq!(backup.preview_only, Some(false));
    assert!(backup.disabled_reason.is_none());
}
