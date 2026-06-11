use super::*;

#[test]
fn sqlserver_live_file_workflow_manifests_are_guarded() {
    let operations = SqlServerAdapter.operation_manifests();

    for id in [
        "sqlserver.data.import-export",
        "sqlserver.data.backup-restore",
    ] {
        let operation = operations
            .iter()
            .find(|operation| operation.id == id)
            .expect("operation manifest");
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
        assert!(operation.disabled_reason.is_none());
        assert!(operation.requires_confirmation);
    }
}
