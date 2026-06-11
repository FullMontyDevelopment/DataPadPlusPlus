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

    for id in ["mysql.data.import-export", "mysql.data.backup-restore"] {
        let operation = mysql
            .iter()
            .find(|operation| operation.id == id)
            .expect("mysql file workflow");
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
        assert!(operation.disabled_reason.is_none());
    }

    let mariadb = MysqlLikeAdapter { engine: "mariadb" }.operation_manifests();
    for id in ["mariadb.data.import-export", "mariadb.data.backup-restore"] {
        let operation = mariadb
            .iter()
            .find(|operation| operation.id == id)
            .expect("mariadb file workflow");
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
        assert!(operation.disabled_reason.is_none());
        assert!(operation.description.contains("MariaDB"));
    }
}
