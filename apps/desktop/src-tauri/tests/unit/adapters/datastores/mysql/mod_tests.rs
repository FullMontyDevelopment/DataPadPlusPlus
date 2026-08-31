use super::*;

#[test]
fn mysql_family_file_workflows_are_scoped_live() {
    let mysql = MysqlLikeAdapter { engine: "mysql" }.operation_manifests();
    for id in [
        "mysql.table.check",
        "mysql.table.analyze",
        "mysql.table.optimize",
        "mysql.table.repair",
        "mysql.routine.execute",
        "mysql.event.enable",
        "mysql.user.lock",
    ] {
        let operation = mysql
            .iter()
            .find(|operation| operation.id == id)
            .expect("mysql guarded admin workflow");
        assert_eq!(operation.execution_support, "plan-only");
        assert_eq!(operation.preview_only, Some(true));
        assert!(operation.disabled_reason.is_some());
    }

    let import_export = mysql
        .iter()
        .find(|operation| operation.id == "mysql.data.import-export")
        .expect("mysql data workflow");
    assert_eq!(import_export.execution_support, "live");
    assert_eq!(import_export.preview_only, Some(false));
    assert!(import_export.disabled_reason.is_none());
    let backup = mysql
        .iter()
        .find(|operation| operation.id == "mysql.data.backup-restore")
        .expect("mysql backup limitation");
    assert_eq!(backup.execution_support, "unsupported");
    assert_eq!(backup.preview_only, Some(true));
    assert!(backup
        .disabled_reason
        .as_deref()
        .unwrap_or_default()
        .contains("mysqldump"));

    let mariadb = MysqlLikeAdapter { engine: "mariadb" }.operation_manifests();
    let import_export = mariadb
        .iter()
        .find(|operation| operation.id == "mariadb.data.import-export")
        .expect("mariadb data workflow");
    assert_eq!(import_export.execution_support, "live");
    assert_eq!(import_export.preview_only, Some(false));
    assert!(import_export.disabled_reason.is_none());
    let backup = mariadb
        .iter()
        .find(|operation| operation.id == "mariadb.data.backup-restore")
        .expect("mariadb backup limitation");
    assert_eq!(backup.execution_support, "unsupported");
    assert_eq!(backup.preview_only, Some(true));
    assert!(backup
        .disabled_reason
        .as_deref()
        .unwrap_or_default()
        .contains("mariadb-dump"));
}
