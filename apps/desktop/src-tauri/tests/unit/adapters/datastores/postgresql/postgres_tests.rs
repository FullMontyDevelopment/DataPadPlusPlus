use super::*;

#[test]
fn postgres_live_workflow_manifests_are_guarded() {
    let operations = PostgresAdapter.operation_manifests();

    for id in ["postgresql.query.profile", "postgresql.data.import-export"] {
        let operation = operations
            .iter()
            .find(|operation| operation.id == id)
            .expect("operation manifest");
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
        assert!(operation.disabled_reason.is_none());
        assert!(operation.requires_confirmation);
    }
    let backup = operations
        .iter()
        .find(|operation| operation.id == "postgresql.data.backup-restore")
        .expect("backup limitation");
    assert_eq!(backup.execution_support, "unsupported");
    assert_eq!(backup.preview_only, Some(true));
    assert!(backup
        .disabled_reason
        .as_deref()
        .unwrap_or_default()
        .contains("pg_dump"));
}
