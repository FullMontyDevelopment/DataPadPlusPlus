use super::*;

#[test]
fn postgres_live_workflow_manifests_are_guarded() {
    let operations = PostgresAdapter.operation_manifests();

    for id in [
        "postgresql.query.profile",
        "postgresql.data.import-export",
        "postgresql.data.backup-restore",
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
