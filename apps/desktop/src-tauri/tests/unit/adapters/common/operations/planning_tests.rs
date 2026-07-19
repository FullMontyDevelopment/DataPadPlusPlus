use super::{default_operation_plan, generated_operation_request};
use crate::domain::models::{AdapterManifest, ResolvedConnectionProfile};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[test]
fn mongodb_collection_import_export_requests_are_database_scoped() {
    let connection = connection();
    let manifest = manifest();
    let parameters = BTreeMap::from([
        ("database".into(), json!("catalog")),
        ("collection".into(), json!("products")),
        ("format".into(), json!("ndjson")),
        ("filter".into(), json!({ "active": true })),
        ("batchSize".into(), json!(500)),
    ]);

    let export_request = generated_operation_request(
        &connection,
        &manifest,
        "mongodb.collection.export",
        "products",
        Some(&parameters),
    );
    let export_value = serde_json::from_str::<serde_json::Value>(&export_request).unwrap();
    assert_eq!(export_value["database"], "catalog");
    assert_eq!(export_value["operation"], "export");
    assert_eq!(export_value["workflow"], "mongodb.collection.export");
    assert_eq!(export_value["target"]["path"], "<selected-file>.ndjson");
    assert_eq!(export_value["executionGate"]["owner"], "mongodb-adapter");
    assert_eq!(export_value["executionGate"]["defaultSupport"], "live");
    assert!(export_value["serializer"]["supportedFormats"]
        .as_array()
        .unwrap()
        .contains(&json!("bson")));
    assert!(export_request.contains("\"active\": true"));

    let import_plan = default_operation_plan(
        &connection,
        &manifest,
        "mongodb.collection.import",
        Some("products"),
        Some(&parameters),
    );
    let import_value =
        serde_json::from_str::<serde_json::Value>(&import_plan.generated_request).unwrap();
    assert_eq!(import_value["operation"], "import");
    assert_eq!(import_value["workflow"], "mongodb.collection.import");
    assert_eq!(import_value["source"]["path"], "<selected-file>.ndjson");
    assert!(import_value["checks"]
        .as_array()
        .unwrap()
        .contains(&json!("validator-compatible")));
    assert_eq!(
        import_plan.required_permissions,
        vec!["write/admin privilege for the target object"]
    );
    assert!(import_plan.confirmation_text.is_some());
}

#[test]
fn mongodb_database_and_collection_management_requests_are_native_commands() {
    let connection = connection();
    let manifest = manifest();

    let create_database_parameters = BTreeMap::from([
        ("database".into(), json!("analytics")),
        ("collection".into(), json!("events")),
        ("options".into(), json!({ "capped": true, "size": 1024 })),
    ]);
    let create_database_request = generated_operation_request(
        &connection,
        &manifest,
        "mongodb.database.create",
        "analytics",
        Some(&create_database_parameters),
    );
    let create_database_value =
        serde_json::from_str::<serde_json::Value>(&create_database_request).unwrap();
    assert_eq!(create_database_value["database"], "analytics");
    assert_eq!(create_database_value["create"], "events");
    assert_eq!(create_database_value["capped"], true);
    assert_eq!(create_database_value["size"], 1024);

    let rename_parameters = BTreeMap::from([
        ("database".into(), json!("catalog")),
        ("collection".into(), json!("products")),
        ("newCollection".into(), json!("archived_products")),
        ("targetDatabase".into(), json!("archive")),
        ("dropTarget".into(), json!(true)),
    ]);
    let rename_request = generated_operation_request(
        &connection,
        &manifest,
        "mongodb.collection.rename",
        "products",
        Some(&rename_parameters),
    );
    let rename_value = serde_json::from_str::<serde_json::Value>(&rename_request).unwrap();
    assert_eq!(rename_value["database"], "admin");
    assert_eq!(rename_value["renameCollection"], "catalog.products");
    assert_eq!(rename_value["to"], "archive.archived_products");
    assert_eq!(rename_value["dropTarget"], true);

    let validate_parameters = BTreeMap::from([
        ("database".into(), json!("catalog")),
        ("collection".into(), json!("products")),
        ("full".into(), json!(true)),
    ]);
    let validate_plan = default_operation_plan(
        &connection,
        &manifest,
        "mongodb.collection.validate",
        Some("products"),
        Some(&validate_parameters),
    );
    let validate_value =
        serde_json::from_str::<serde_json::Value>(&validate_plan.generated_request).unwrap();
    assert_eq!(validate_value["database"], "catalog");
    assert_eq!(validate_value["validate"], "products");
    assert_eq!(validate_value["full"], true);
    assert_eq!(
        validate_plan.required_permissions,
        vec!["read metadata/query privilege"]
    );
    assert!(validate_plan.confirmation_text.is_some());
}

#[test]
fn mongodb_user_create_can_use_secret_variable_password_source() {
    let connection = connection();
    let manifest = manifest();
    let parameters = BTreeMap::from([
        ("database".into(), json!("catalog")),
        ("name".into(), json!("reporting")),
        ("password".into(), json!("{{MONGO_USER_PASSWORD}}")),
        ("roles".into(), json!([{ "role": "read", "db": "catalog" }])),
    ]);

    let request = generated_operation_request(
        &connection,
        &manifest,
        "mongodb.user.create",
        "reporting",
        Some(&parameters),
    );
    let value = serde_json::from_str::<serde_json::Value>(&request).unwrap();

    assert_eq!(value["database"], "catalog");
    assert_eq!(value["createUser"], "reporting");
    assert_eq!(value["pwd"], "{{MONGO_USER_PASSWORD}}");
    assert_eq!(value["roles"][0]["role"], "read");
}

#[test]
fn unscoped_operation_plans_use_honest_placeholders_not_fake_samples() {
    let connection = connection();
    let cases = [
        ("mongodb", "document", "mongodb", "mongodb.query.execute"),
        ("redis", "keyvalue", "redis", "redis.query.execute"),
        ("neo4j", "graph", "cypher", "neo4j.query.execute"),
        (
            "prometheus",
            "timeseries",
            "promql",
            "prometheus.query.execute",
        ),
        ("cassandra", "widecolumn", "cql", "cassandra.query.execute"),
        (
            "elasticsearch",
            "search",
            "json",
            "elasticsearch.query.execute",
        ),
        ("postgresql", "sql", "sql", "postgresql.query.execute"),
        ("snowflake", "warehouse", "sql", "snowflake.query.execute"),
    ];

    for (engine, family, language, operation_id) in cases {
        let manifest = manifest_for(engine, family, language);
        let plan = default_operation_plan(&connection, &manifest, operation_id, None, None);
        let preview_text =
            format!("{}\n{}", plan.summary, plan.generated_request).to_ascii_lowercase();

        assert!(
            !preview_text.contains("sample"),
            "{engine} plan should not invent sample objects: {preview_text}"
        );
    }
}

#[test]
fn sql_family_operation_plans_are_dialect_aware() {
    let connection = connection();
    let sqlserver_manifest = manifest_for("sqlserver", "sql", "sql");
    let postgres_manifest = manifest_for("postgresql", "sql", "sql");
    let sqlite_manifest = manifest_for("sqlite", "sql", "sql");
    let duckdb_manifest = manifest_for("duckdb", "embedded-olap", "sql");
    let mysql_manifest = manifest_for("mysql", "sql", "sql");
    let mariadb_manifest = manifest_for("mariadb", "sql", "sql");
    let oracle_manifest = manifest_for("oracle", "sql", "sql");

    let sqlserver_explain = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.query.explain",
        "[dbo].[Accounts]",
        None,
    );
    assert!(sqlserver_explain.contains("set showplan_text on"));
    assert!(sqlserver_explain.contains("select top 100 * from [dbo].[Accounts];"));

    let sqlserver_profile = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.query.profile",
        "[dbo].[Accounts]",
        None,
    );
    assert!(sqlserver_profile.contains("set showplan_xml on"));
    assert!(sqlserver_profile.contains("select top 100 * from [dbo].[Accounts];"));
    assert!(!sqlserver_profile.contains("statistics io"));

    let sqlserver_parameters = BTreeMap::from([
        ("schema".into(), json!("dbo")),
        ("table".into(), json!("Accounts")),
        ("indexName".into(), json!("IX_Accounts_status")),
    ]);
    let sqlserver_stats = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.statistics.update",
        "[dbo].[Accounts]",
        Some(&sqlserver_parameters),
    );
    assert_eq!(
        sqlserver_stats,
        "update statistics [dbo].[Accounts] with fullscan;"
    );

    let sqlserver_rebuild = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.index.rebuild",
        "[dbo].[Accounts]",
        Some(&sqlserver_parameters),
    );
    assert!(
        sqlserver_rebuild.contains("alter index [IX_Accounts_status] on [dbo].[Accounts] rebuild")
    );

    let sqlserver_query_store = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.query-store.top-queries",
        "Query Store",
        None,
    );
    assert!(sqlserver_query_store.contains("from sys.query_store_query"));

    let sqlserver_export = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.data.import-export",
        "[dbo].[Accounts]",
        Some(&sqlserver_parameters),
    );
    let sqlserver_export_value =
        serde_json::from_str::<serde_json::Value>(&sqlserver_export).unwrap();
    assert_eq!(sqlserver_export_value["workflow"], "sqlserver.table.export");
    assert_eq!(sqlserver_export_value["schema"], "dbo");
    assert_eq!(sqlserver_export_value["table"], "Accounts");
    assert_eq!(
        sqlserver_export_value["executionGate"]["defaultSupport"],
        "live"
    );

    let sqlserver_import_parameters = BTreeMap::from([
        ("schema".into(), json!("dbo")),
        ("table".into(), json!("Accounts")),
        ("mode".into(), json!("validate-only")),
        ("format".into(), json!("csv")),
    ]);
    let sqlserver_import = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.data.import-export",
        "[dbo].[Accounts]",
        Some(&sqlserver_import_parameters),
    );
    let sqlserver_import_value =
        serde_json::from_str::<serde_json::Value>(&sqlserver_import).unwrap();
    assert_eq!(sqlserver_import_value["workflow"], "sqlserver.table.import");
    assert_eq!(
        sqlserver_import_value["executionGate"]["guards"][3],
        "insertable target-column validation"
    );

    let sqlserver_backup = generated_operation_request(
        &connection,
        &sqlserver_manifest,
        "sqlserver.data.backup-restore",
        "[datapadplusplus]",
        None,
    );
    let sqlserver_backup_value =
        serde_json::from_str::<serde_json::Value>(&sqlserver_backup).unwrap();
    assert_eq!(
        sqlserver_backup_value["workflow"],
        "sqlserver.database.backup"
    );
    assert_eq!(
        sqlserver_backup_value["executionGate"]["residualRisk"],
        "bounded logical DataPad++ backup package; native .bak backup/restore execution remains preview-first"
    );

    let postgres_export = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.data.import-export",
        "\"public\".\"accounts\"",
        None,
    );
    let postgres_export_value =
        serde_json::from_str::<serde_json::Value>(&postgres_export).unwrap();
    assert_eq!(postgres_export_value["workflow"], "postgresql.table.export");
    assert_eq!(postgres_export_value["schema"], "public");
    assert_eq!(postgres_export_value["table"], "accounts");
    assert_eq!(
        postgres_export_value["target"]["path"],
        "<selected-file>.csv"
    );
    assert_eq!(
        postgres_export_value["executionGate"]["defaultSupport"],
        "live"
    );

    let postgres_import_parameters = BTreeMap::from([
        ("schema".into(), json!("public")),
        ("table".into(), json!("accounts")),
        ("mode".into(), json!("validate-only")),
        ("format".into(), json!("csv")),
    ]);
    let postgres_import = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.data.import-export",
        "\"public\".\"accounts\"",
        Some(&postgres_import_parameters),
    );
    let postgres_import_value =
        serde_json::from_str::<serde_json::Value>(&postgres_import).unwrap();
    assert_eq!(postgres_import_value["workflow"], "postgresql.table.import");
    assert_eq!(
        postgres_import_value["source"]["path"],
        "<selected-file>.csv"
    );
    assert_eq!(
        postgres_import_value["executionGate"]["guards"][3],
        "type-aware target column validation"
    );

    let postgres_backup = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.data.backup-restore",
        "\"postgres\"",
        None,
    );
    let postgres_backup_value =
        serde_json::from_str::<serde_json::Value>(&postgres_backup).unwrap();
    assert_eq!(
        postgres_backup_value["workflow"],
        "postgresql.database.backup"
    );
    assert_eq!(
        postgres_backup_value["executionGate"]["residualRisk"],
        "bounded logical DataPad++ backup package; full pg_dump/pg_restore restore execution remains preview-first"
    );

    let mysql_parameters = BTreeMap::from([
        ("database".into(), json!("shop")),
        ("table".into(), json!("orders")),
        ("mode".into(), json!("validate-only")),
        ("format".into(), json!("csv")),
    ]);
    let mysql_import = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.data.import-export",
        "`shop`.`orders`",
        Some(&mysql_parameters),
    );
    let mysql_import_value = serde_json::from_str::<serde_json::Value>(&mysql_import).unwrap();
    assert_eq!(mysql_import_value["workflow"], "mysql.table.import");
    assert_eq!(mysql_import_value["database"], "shop");
    assert_eq!(
        mysql_import_value["executionGate"]["guards"][3],
        "insertable target-column validation"
    );

    let mysql_backup = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.data.backup-restore",
        "shop",
        None,
    );
    let mysql_backup_value = serde_json::from_str::<serde_json::Value>(&mysql_backup).unwrap();
    assert_eq!(mysql_backup_value["workflow"], "mysql.database.backup");
    assert_eq!(
        mysql_backup_value["executionGate"]["defaultSupport"],
        "live"
    );

    let mariadb_import = generated_operation_request(
        &connection,
        &mariadb_manifest,
        "mariadb.data.import-export",
        "`commerce`.`orders`",
        Some(&BTreeMap::from([
            ("database".into(), json!("commerce")),
            ("table".into(), json!("orders")),
            ("mode".into(), json!("export")),
            ("format".into(), json!("json")),
        ])),
    );
    let mariadb_import_value = serde_json::from_str::<serde_json::Value>(&mariadb_import).unwrap();
    assert_eq!(mariadb_import_value["workflow"], "mariadb.table.export");
    assert_eq!(
        mariadb_import_value["executionGate"]["defaultSupport"],
        "live"
    );

    let mariadb_backup = generated_operation_request(
        &connection,
        &mariadb_manifest,
        "mariadb.data.backup-restore",
        "commerce",
        None,
    );
    let mariadb_backup_value = serde_json::from_str::<serde_json::Value>(&mariadb_backup).unwrap();
    assert_eq!(mariadb_backup_value["workflow"], "mariadb.database.backup");
    assert_eq!(
        mariadb_backup_value["executionGate"]["defaultSupport"],
        "live"
    );
    assert!(mariadb_backup_value["executionGate"]["residualRisk"]
        .as_str()
        .unwrap_or_default()
        .contains("mariadb-dump/mysql restore"));

    let postgres_analyze = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.table.analyze",
        "\"public\".\"accounts\"",
        None,
    );
    assert_eq!(postgres_analyze, "analyze verbose \"public\".\"accounts\";");

    let postgres_vacuum = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.table.vacuum",
        "\"public\".\"accounts\"",
        None,
    );
    assert_eq!(
        postgres_vacuum,
        "vacuum (verbose, analyze) \"public\".\"accounts\";"
    );

    let postgres_reindex = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.index.reindex",
        "\"public\".\"accounts_name_idx\"",
        None,
    );
    assert!(
        postgres_reindex.contains("reindex index concurrently \"public\".\"accounts_name_idx\";")
    );

    let postgres_profile = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.query.profile",
        "\"public\".\"accounts\"",
        Some(&BTreeMap::from([
            (
                "query".into(),
                json!("select * from \"public\".\"accounts\" where active = true limit 50"),
            ),
            ("format".into(), json!("json")),
        ])),
    );
    assert!(postgres_profile.contains("PostgreSQL query profile executes the statement"));
    assert!(postgres_profile
        .contains("explain (analyze true, buffers true, verbose true, format json)"));
    assert!(postgres_profile.contains("where active = true limit 50;"));

    let postgres_routine = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.routine.execute",
        "\"public\".\"refresh_account\"",
        Some(&BTreeMap::from([
            ("schema".into(), json!("public")),
            ("routineName".into(), json!("refresh_account")),
            ("routineKind".into(), json!("procedure")),
            (
                "arguments".into(),
                json!("account_id integer, force boolean DEFAULT false"),
            ),
        ])),
    );
    assert!(postgres_routine.contains("call \"public\".\"refresh_account\"("));
    assert!(postgres_routine.contains("account_id => $1"));
    assert!(postgres_routine.contains("force => $2"));
    assert!(postgres_routine.contains("-- $1 account_id integer"));

    let postgres_cancel = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.session.cancel",
        "\"Diagnostics\"",
        Some(&BTreeMap::from([
            ("sessionPid".into(), json!(101)),
            ("sessionUser".into(), json!("app")),
            ("sessionDatabase".into(), json!("datapadplusplus")),
            ("sessionState".into(), json!("active")),
        ])),
    );
    assert!(postgres_cancel.contains("pg_cancel_backend(101)"));
    assert!(postgres_cancel.contains("pg_backend_pid() = 101"));
    assert!(postgres_cancel.contains("-- Target: pid 101, user app"));

    let postgres_terminate = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.session.terminate",
        "\"Diagnostics\"",
        Some(&BTreeMap::from([("sessionPid".into(), json!(101))])),
    );
    assert!(postgres_terminate.contains("pg_terminate_backend(101)"));
    assert!(postgres_terminate.contains("rolls back its active transaction"));

    let postgres_security = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.security.inspect",
        "\"Security\"",
        None,
    );
    assert!(postgres_security.contains("pg_auth_members"));
    assert!(postgres_security.contains("pg_default_acl"));

    let postgres_grant = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.role.grant",
        "\"Security\"",
        Some(&BTreeMap::from([
            ("roleName".into(), json!("app")),
            ("memberOf".into(), json!("reporting")),
        ])),
    );
    assert!(postgres_grant.contains("grant \"reporting\" to \"app\";"));

    let postgres_extension = generated_operation_request(
        &connection,
        &postgres_manifest,
        "postgresql.extension.update",
        "\"public\".\"uuid-ossp\"",
        Some(&BTreeMap::from([(
            "extensionName".into(),
            json!("uuid-ossp"),
        )])),
    );
    assert!(postgres_extension.contains("alter extension \"uuid-ossp\" update;"));

    let sqlite_export = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.data.import-export",
        "[accounts]",
        None,
    );
    assert!(sqlite_export.contains(".mode csv"));
    assert!(sqlite_export.contains("select * from [accounts];"));

    let sqlite_table_export = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.table.export",
        "[main].[accounts]",
        Some(&BTreeMap::from([
            ("targetPath".into(), json!("C:\\fixtures\\accounts.csv")),
            ("format".into(), json!("csv")),
            ("limit".into(), json!(500)),
        ])),
    );
    assert!(sqlite_table_export.contains("\"workflow\": \"sqlite.table.export\""));
    assert!(sqlite_table_export.contains("\"table\": \"accounts\""));
    assert!(sqlite_table_export.contains("\"limit\": 500"));

    let sqlite_table_import = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.table.import",
        "[main].[accounts]",
        Some(&BTreeMap::from([(
            "sourcePath".into(),
            json!("C:\\fixtures\\accounts.csv"),
        )])),
    );
    assert!(sqlite_table_import.contains("\"workflow\": \"sqlite.table.import\""));
    assert!(sqlite_table_import.contains("\"mode\": \"append\""));

    let sqlite_backup = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.database.backup",
        "[main]",
        Some(&BTreeMap::from([(
            "targetPath".into(),
            json!("C:\\fixtures\\backup.sqlite"),
        )])),
    );
    assert!(sqlite_backup.contains("vacuum \"main\" into"));
    assert!(sqlite_backup.contains("backup.sqlite"));

    let sqlite_integrity = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.database.integrity-check",
        "[main]",
        None,
    );
    assert!(sqlite_integrity.contains("pragma quick_check"));
    assert!(sqlite_integrity.contains("pragma integrity_check"));

    let sqlite_analyze = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.table.analyze",
        "[accounts]",
        None,
    );
    assert_eq!(sqlite_analyze, "analyze [accounts];");

    let sqlite_reindex = generated_operation_request(
        &connection,
        &sqlite_manifest,
        "sqlite.index.reindex",
        "[accounts_name_idx]",
        None,
    );
    assert_eq!(sqlite_reindex, "reindex [accounts_name_idx];");

    let duckdb_analyze = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.table.analyze",
        "\"main\".\"orders\"",
        None,
    );
    let duckdb_analyze_json: Value =
        serde_json::from_str(&duckdb_analyze).expect("duckdb analyze request");
    assert_eq!(
        duckdb_analyze_json["workflow"],
        "duckdb.table.analyze-preview"
    );
    assert_eq!(duckdb_analyze_json["operation"], "analyze-table");
    assert_eq!(
        duckdb_analyze_json["adminScope"]["executionPolicy"],
        "plan-only"
    );
    assert_eq!(
        duckdb_analyze_json["adminExecutionBoundary"]["executionPolicy"],
        "scoped-out"
    );
    assert_eq!(
        duckdb_analyze_json["adminExecutionBoundary"]["nativeClaim"],
        "admin-preview-only"
    );
    assert_eq!(
        duckdb_analyze_json["adminExecutionBoundary"]["operation"],
        "analyze-table"
    );
    assert!(
        duckdb_analyze_json["adminExecutionBoundary"]["promotionRequires"]
            .as_array()
            .is_some_and(|requirements| requirements
                .iter()
                .any(|requirement| requirement == "exclusive DuckDB writer lock evidence"))
    );
    assert!(
        duckdb_analyze_json["adminExecutionBoundary"]["blockedReasons"]
            .as_array()
            .is_some_and(|reasons| reasons
                .iter()
                .any(|reason| reason == "duckdb-admin-execution-scoped-out"))
    );
    assert!(duckdb_analyze_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "cross-process lock probe")));

    let duckdb_load = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.extension.load",
        "httpfs",
        Some(&BTreeMap::from([("extensionName".into(), json!("httpfs"))])),
    );
    let duckdb_load_json: Value =
        serde_json::from_str(&duckdb_load).expect("duckdb load extension request");
    assert_eq!(
        duckdb_load_json["workflow"],
        "duckdb.extension.load-preview"
    );
    assert_eq!(duckdb_load_json["extensionName"], "httpfs");
    assert_eq!(
        duckdb_load_json["extensionPreflight"]["catalogProbe"],
        "duckdb_extensions()"
    );
    assert_eq!(
        duckdb_load_json["extensionPreflight"]["nativeCodeExecution"],
        "blocked-until-explicit-live-gate"
    );
    assert_eq!(
        duckdb_load_json["extensionExecutionBoundary"]["executionPolicy"],
        "scoped-out"
    );
    assert_eq!(
        duckdb_load_json["extensionExecutionBoundary"]["nativeClaim"],
        "extension-preflight-only"
    );
    assert!(
        duckdb_load_json["extensionExecutionBoundary"]["promotionRequires"]
            .as_array()
            .is_some_and(|requirements| requirements
                .iter()
                .any(|requirement| requirement == "native-code trust review"))
    );
    assert!(
        duckdb_load_json["extensionExecutionBoundary"]["blockedReasons"]
            .as_array()
            .is_some_and(|reasons| reasons
                .iter()
                .any(|reason| reason == "duckdb-extension-execution-scoped-out"))
    );
    assert!(duckdb_load_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "installed-before-load check")));

    let duckdb_import = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.file.import",
        "\"main\".\"orders_import\"",
        Some(&BTreeMap::from([
            ("sourceFormat".into(), json!("csv")),
            ("tableName".into(), json!("\"main\".\"orders_import\"")),
        ])),
    );
    assert!(duckdb_import.contains("read_csv_auto"));
    assert!(duckdb_import.contains("create or replace table \"main\".\"orders_import\""));

    let duckdb_export = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.data.import-export",
        "\"main\".\"orders\"",
        Some(&BTreeMap::from([
            ("mode".into(), json!("export")),
            ("format".into(), json!("parquet")),
            ("targetPath".into(), json!("C:\\exports\\orders.parquet")),
            ("rowLimit".into(), json!(25)),
        ])),
    );
    let duckdb_export_json: Value =
        serde_json::from_str(&duckdb_export).expect("duckdb export request");
    assert_eq!(duckdb_export_json["workflow"], "duckdb.table.export");
    assert_eq!(duckdb_export_json["schema"], "main");
    assert_eq!(duckdb_export_json["table"], "orders");
    assert_eq!(
        duckdb_export_json["formatPreflight"]["requiredExtension"],
        "parquet"
    );
    assert_eq!(
        duckdb_export_json["formatPreflight"]["extensionBacked"],
        true
    );
    assert_eq!(
        duckdb_export_json["formatPreflight"]["extensionExecutionBoundary"]["executionPolicy"],
        "preloaded-extension-required"
    );
    assert_eq!(
        duckdb_export_json["formatPreflight"]["extensionExecutionBoundary"]["requiredExtension"],
        "parquet"
    );
    assert_eq!(
        duckdb_export_json["formatPreflight"]["extensionExecutionBoundary"]
            ["networkAutoloadAllowed"],
        false
    );
    assert_eq!(
        duckdb_export_json["executionGate"]["defaultSupport"],
        "live"
    );
    assert_eq!(
        duckdb_export_json["databaseLockBoundary"]["policy"],
        "desktop-preflight-required"
    );
    assert_eq!(
        duckdb_export_json["databaseLockBoundary"]["workflow"],
        "duckdb.table.export"
    );
    assert_eq!(
        duckdb_export_json["databaseLockBoundary"]["requiresWriteAccess"],
        false
    );
    assert_eq!(
        duckdb_export_json["databaseLockBoundary"]["exclusiveWriterLockValidated"],
        false
    );
    assert!(duckdb_export_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards.iter().any(|guard| guard == "bounded row export")));
    assert!(duckdb_export_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "database file read/open preflight")));
    assert!(duckdb_export_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "format capability preflight")));

    let duckdb_generic_import = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.data.import-export",
        "\"main\".\"orders_import\"",
        Some(&BTreeMap::from([
            ("mode".into(), json!("import")),
            ("sourceFormat".into(), json!("csv")),
            ("sourcePath".into(), json!("C:\\imports\\orders.csv")),
            ("targetTable".into(), json!("\"main\".\"orders_import\"")),
        ])),
    );
    let duckdb_import_json: Value =
        serde_json::from_str(&duckdb_generic_import).expect("duckdb import request");
    assert_eq!(duckdb_import_json["workflow"], "duckdb.table.import");
    assert_eq!(duckdb_import_json["format"], "csv");
    assert_eq!(duckdb_import_json["table"], "orders_import");
    assert_eq!(
        duckdb_import_json["formatPreflight"]["extensionBacked"],
        false
    );
    assert_eq!(
        duckdb_import_json["formatPreflight"]["extensionExecutionBoundary"]["executionPolicy"],
        "bundled-native"
    );
    assert_eq!(
        duckdb_import_json["databaseLockBoundary"]["workflow"],
        "duckdb.table.import"
    );
    assert_eq!(
        duckdb_import_json["databaseLockBoundary"]["requiresWriteAccess"],
        true
    );
    assert!(duckdb_import_json["databaseLockBoundary"]["checks"]
        .as_array()
        .is_some_and(|checks| checks
            .iter()
            .any(|check| check == "filesystem write-open probe")));
    assert!(duckdb_import_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "database file access/read-only preflight")));

    let duckdb_backup = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.data.backup-restore",
        "main",
        Some(&BTreeMap::from([
            ("mode".into(), json!("backup")),
            ("targetPath".into(), json!("C:\\exports\\duckdb-backup")),
        ])),
    );
    let duckdb_backup_json: Value =
        serde_json::from_str(&duckdb_backup).expect("duckdb backup request");
    assert_eq!(duckdb_backup_json["workflow"], "duckdb.database.backup");
    assert_eq!(
        duckdb_backup_json["databaseLockBoundary"]["workflow"],
        "duckdb.database.backup"
    );
    assert_eq!(
        duckdb_backup_json["executionGate"]["residualRisk"],
        "IMPORT DATABASE restore execution remains preview-first"
    );

    let duckdb_restore = generated_operation_request(
        &connection,
        &duckdb_manifest,
        "duckdb.data.backup-restore",
        "main",
        Some(&BTreeMap::from([
            ("mode".into(), json!("restore")),
            ("sourcePath".into(), json!("C:\\exports\\duckdb-backup")),
        ])),
    );
    let duckdb_restore_json: Value =
        serde_json::from_str(&duckdb_restore).expect("duckdb restore request");
    assert_eq!(
        duckdb_restore_json["workflow"],
        "duckdb.database.restore-preview"
    );
    assert_eq!(
        duckdb_restore_json["restorePreflight"]["sourcePackageValidated"],
        "desktop-preflight-required"
    );
    assert_eq!(
        duckdb_restore_json["restorePreflight"]["operationValidated"],
        false
    );
    assert_eq!(
        duckdb_restore_json["databaseLockBoundary"]["workflow"],
        "duckdb.database.restore-preview"
    );
    assert_eq!(
        duckdb_restore_json["databaseLockBoundary"]["requiresWriteAccess"],
        true
    );
    assert_eq!(
        duckdb_restore_json["databaseLockBoundary"]["crossProcessContentionValidated"],
        "desktop-fixture-required"
    );
    assert!(duckdb_restore_json["restorePreflight"]["checks"]
        .as_array()
        .is_some_and(|checks| checks.iter().any(|check| check == "schema.sql marker")));
    assert!(duckdb_restore_json["executionGate"]["guards"]
        .as_array()
        .is_some_and(|guards| guards
            .iter()
            .any(|guard| guard == "target database write/open preflight")));
    assert_eq!(
        duckdb_restore_json["restoreExecutionBoundary"]["executionPolicy"],
        "scoped-out"
    );
    assert_eq!(
        duckdb_restore_json["restoreExecutionBoundary"]["nativeClaim"],
        "restore-preflight-only"
    );
    assert!(
        duckdb_restore_json["restoreExecutionBoundary"]["promotionRequires"]
            .as_array()
            .is_some_and(
                |requirements| requirements.iter().any(|requirement| requirement
                    == "target snapshot or rollback artifact before IMPORT DATABASE")
            )
    );
    assert!(
        duckdb_restore_json["restoreExecutionBoundary"]["blockedReasons"]
            .as_array()
            .is_some_and(|reasons| reasons
                .iter()
                .any(|reason| reason == "restore-execution-scoped-out"))
    );

    let mysql_check = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.table.check",
        "`shop`.`orders`",
        None,
    );
    let mysql_check_json: Value = serde_json::from_str(&mysql_check).expect("mysql check request");
    assert_eq!(mysql_check_json["workflow"], "mysql.table.maintenance");
    assert_eq!(mysql_check_json["operation"], "check");
    assert_eq!(mysql_check_json["database"], "shop");
    assert_eq!(mysql_check_json["table"], "orders");
    assert_eq!(
        mysql_check_json["statement"],
        "check table `shop`.`orders`;"
    );
    assert_eq!(
        mysql_check_json["executionGate"]["defaultSupport"],
        "plan-only"
    );

    let mysql_repair = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.table.repair",
        "`shop`.`orders`",
        None,
    );
    let mysql_repair_json: Value =
        serde_json::from_str(&mysql_repair).expect("mysql repair request");
    assert_eq!(mysql_repair_json["operation"], "repair");
    assert!(mysql_repair_json["executionGate"]["guards"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item == "require owner/admin confirmation and a recent backup before repair"));

    let mysql_routine = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.routine.execute",
        "`shop`.`refresh_rollups`",
        Some(&BTreeMap::from([
            ("database".into(), json!("shop")),
            ("routineName".into(), json!("refresh_rollups")),
            ("routineKind".into(), json!("procedure")),
            (
                "arguments".into(),
                json!("IN account_id bigint, IN force_refresh tinyint(1)"),
            ),
        ])),
    );
    let mysql_routine_json: Value =
        serde_json::from_str(&mysql_routine).expect("mysql routine request");
    assert_eq!(mysql_routine_json["workflow"], "mysql.routine.execute");
    assert_eq!(mysql_routine_json["routine"], "refresh_rollups");
    assert!(mysql_routine_json["statement"]
        .as_str()
        .unwrap()
        .contains("call `shop`.`refresh_rollups`("));
    assert_eq!(mysql_routine_json["bindings"][0]["name"], "account_id");

    let mysql_event = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.event.disable",
        "`shop`.`refresh_rollups`",
        None,
    );
    let mysql_event_json: Value = serde_json::from_str(&mysql_event).expect("mysql event request");
    assert_eq!(mysql_event_json["workflow"], "mysql.event.toggle");
    assert_eq!(mysql_event_json["operation"], "disable");
    assert_eq!(
        mysql_event_json["statement"],
        "alter event `shop`.`refresh_rollups` disable;"
    );

    let mysql_security = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.security.inspect",
        "`shop`",
        Some(&BTreeMap::from([("database".into(), json!("shop"))])),
    );
    let mysql_security_json: Value =
        serde_json::from_str(&mysql_security).expect("mysql security request");
    assert_eq!(mysql_security_json["workflow"], "mysql.security.inspect");
    assert!(mysql_security_json["statements"]
        .as_array()
        .unwrap()
        .iter()
        .any(|statement| statement
            .as_str()
            .unwrap()
            .contains("information_schema.schema_privileges")));

    let mysql_lock = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.user.lock",
        "`shop`",
        Some(&BTreeMap::from([
            ("userName".into(), json!("reporting")),
            ("userHost".into(), json!("%")),
        ])),
    );
    let mysql_lock_json: Value = serde_json::from_str(&mysql_lock).expect("mysql lock request");
    assert_eq!(mysql_lock_json["workflow"], "mysql.user.account-state");
    assert_eq!(
        mysql_lock_json["statement"],
        "alter user 'reporting'@'%' account lock;"
    );

    let mysql_metrics = generated_operation_request(
        &connection,
        &mysql_manifest,
        "mysql.diagnostics.metrics",
        "`shop`.`orders`",
        None,
    );
    assert!(mysql_metrics.contains("performance_schema.events_statements_summary_by_digest"));
    assert!(mysql_metrics.contains("performance_schema.table_io_waits_summary_by_index_usage"));
    assert!(mysql_metrics.contains("@@optimizer_trace"));

    let mariadb_profile = generated_operation_request(
        &connection,
        &mariadb_manifest,
        "mariadb.query.profile",
        "`shop`.`orders`",
        None,
    );
    assert_eq!(
        mariadb_profile,
        "analyze format=json select * from `shop`.`orders` limit 100;"
    );

    let oracle_export = generated_operation_request(
        &connection,
        &oracle_manifest,
        "oracle.data.import-export",
        "APP.ACCOUNTS",
        None,
    );
    assert!(oracle_export.contains("set markup csv on"));
    assert!(oracle_export.contains("select * from APP.ACCOUNTS fetch first 1000 rows only;"));
    assert!(oracle_export.contains("Data Pump import/export"));

    let oracle_backup = generated_operation_request(
        &connection,
        &oracle_manifest,
        "oracle.data.backup-restore",
        "APP",
        None,
    );
    assert!(oracle_backup.contains("rman target /"));
    assert!(oracle_backup.contains("backup database plus archivelog"));
}

#[test]
fn search_operation_plans_use_http_request_shapes() {
    let connection = connection();
    let manifest = manifest_for("elasticsearch", "search", "query-dsl");

    let profile_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.query.profile",
        "products-v1",
        None,
    );
    let profile_value = serde_json::from_str::<serde_json::Value>(&profile_request).unwrap();
    assert_eq!(profile_value["method"], "POST");
    assert_eq!(profile_value["path"], "/products-v1/_search");
    assert_eq!(profile_value["body"]["profile"], true);

    let drop_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.index.drop",
        "products-v1",
        None,
    );
    let drop_value = serde_json::from_str::<serde_json::Value>(&drop_request).unwrap();
    assert_eq!(drop_value["method"], "DELETE");
    assert_eq!(drop_value["path"], "/products-v1");

    let mapping_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.index.put-mapping",
        "products-v1",
        None,
    );
    let mapping_value = serde_json::from_str::<serde_json::Value>(&mapping_request).unwrap();
    assert_eq!(mapping_value["method"], "PUT");
    assert_eq!(mapping_value["path"], "/products-v1/_mapping");
    assert_eq!(
        mapping_value["body"]["properties"]["new_field"]["type"],
        "keyword"
    );

    let alias_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.alias.put",
        "products-v1",
        None,
    );
    let alias_value = serde_json::from_str::<serde_json::Value>(&alias_request).unwrap();
    assert_eq!(alias_value["method"], "POST");
    assert_eq!(alias_value["path"], "/_aliases");
    assert_eq!(
        alias_value["body"]["actions"][0]["add"]["alias"],
        "products-v1-read"
    );

    let lifecycle_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.lifecycle.explain",
        "products-v1",
        None,
    );
    let lifecycle_value = serde_json::from_str::<serde_json::Value>(&lifecycle_request).unwrap();
    assert_eq!(lifecycle_value["method"], "GET");
    assert_eq!(lifecycle_value["path"], "/products-v1/_ilm/explain");

    let merge_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.index.force-merge",
        "products-v1",
        None,
    );
    let merge_value = serde_json::from_str::<serde_json::Value>(&merge_request).unwrap();
    assert_eq!(merge_value["method"], "POST");
    assert_eq!(merge_value["path"], "/products-v1/_forcemerge");
    assert_eq!(merge_value["body"]["max_num_segments"], 1);

    let reindex_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.index.reindex",
        "products-v1",
        None,
    );
    let reindex_value = serde_json::from_str::<serde_json::Value>(&reindex_request).unwrap();
    assert_eq!(reindex_value["method"], "POST");
    assert_eq!(reindex_value["path"], "/_reindex");
    assert_eq!(
        reindex_value["body"]["dest"]["index"],
        "products-v1-reindexed"
    );

    let pipeline_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.pipeline.put",
        "normalize-products",
        None,
    );
    let pipeline_value = serde_json::from_str::<serde_json::Value>(&pipeline_request).unwrap();
    assert_eq!(pipeline_value["method"], "PUT");
    assert_eq!(
        pipeline_value["path"],
        "/_ingest/pipeline/normalize-products"
    );

    let task_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.task.cancel",
        "node-a:123",
        None,
    );
    let task_value = serde_json::from_str::<serde_json::Value>(&task_request).unwrap();
    assert_eq!(task_value["method"], "POST");
    assert_eq!(task_value["path"], "/_tasks/node-a%3A123/_cancel");

    let slow_log_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.diagnostics.slow-log",
        "products-v1",
        None,
    );
    let slow_log_value = serde_json::from_str::<serde_json::Value>(&slow_log_request).unwrap();
    assert_eq!(slow_log_value["operation"], "Search.SlowLogDashboardPlan");
    assert_eq!(
        slow_log_value["requests"][0]["path"],
        "/_settings?filter_path=**.search.slowlog*"
    );
    assert_eq!(
        slow_log_value["requests"][1]["path"],
        "/_nodes/stats/indices/search,indexing"
    );
    assert_eq!(
        slow_log_value["executionGate"]["defaultSupport"],
        "plan-only"
    );

    let allocation_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.diagnostics.allocation",
        "products-v1",
        None,
    );
    let allocation_value = serde_json::from_str::<serde_json::Value>(&allocation_request).unwrap();
    assert_eq!(
        allocation_value["operation"],
        "Search.AllocationExplainPlan"
    );
    assert_eq!(
        allocation_value["requests"][0]["path"],
        "/_cluster/allocation/explain"
    );
    assert_eq!(
        allocation_value["requests"][1]["path"],
        "/_cat/shards?format=json&bytes=b"
    );

    let import_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.data.import-export",
        "products-v1",
        None,
    );
    let import_value = serde_json::from_str::<serde_json::Value>(&import_request).unwrap();
    assert_eq!(import_value["path"], "/products-v1/_search");
    assert_eq!(import_value["executionGate"]["defaultSupport"], "plan-only");
    assert!(import_value["executionGate"]["disabledReasons"][0]
        .as_str()
        .unwrap()
        .contains("preview-first"));

    let component_template_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.template.create",
        "products-component",
        Some(&BTreeMap::from([(
            "templateType".into(),
            json!("component"),
        )])),
    );
    let component_template_value =
        serde_json::from_str::<serde_json::Value>(&component_template_request).unwrap();
    assert_eq!(component_template_value["method"], "PUT");
    assert_eq!(
        component_template_value["path"],
        "/_component_template/products-component"
    );

    let snapshot_request = generated_operation_request(
        &connection,
        &manifest,
        "elasticsearch.snapshot.restore",
        "snapshot:2026",
        Some(&BTreeMap::from([(
            "repository".into(),
            json!("prod snapshots"),
        )])),
    );
    let snapshot_value = serde_json::from_str::<serde_json::Value>(&snapshot_request).unwrap();
    assert_eq!(
        snapshot_value["path"],
        "/_snapshot/prod%20snapshots/snapshot%3A2026/_restore"
    );
}

#[test]
fn widecolumn_operation_plans_use_native_request_shapes() {
    let connection = connection();
    let dynamo_manifest = manifest_for("dynamodb", "widecolumn", "json");
    let cassandra_manifest = manifest_for("cassandra", "widecolumn", "cql");
    let dynamo_parameters = BTreeMap::from([
        ("tableName".into(), json!("Orders")),
        ("indexName".into(), json!("customer-status-index")),
        ("partitionKey".into(), json!("customerId")),
    ]);
    let cassandra_parameters = BTreeMap::from([
        ("keyspace".into(), json!("app")),
        ("tableName".into(), json!("orders_by_customer")),
        ("indexName".into(), json!("orders_status_sai")),
        ("columnName".into(), json!("status")),
    ]);

    let dynamo_request = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.index.create",
        "Orders",
        Some(&dynamo_parameters),
    );
    let dynamo_value = serde_json::from_str::<serde_json::Value>(&dynamo_request).unwrap();
    assert_eq!(dynamo_value["operation"], "DynamoDB.UpdateTable");
    assert_eq!(dynamo_value["tableName"], "Orders");
    assert_eq!(
        dynamo_value["globalSecondaryIndexUpdates"][0]["create"]["indexName"],
        "customer-status-index"
    );

    let dynamo_metrics = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.diagnostics.metrics",
        "Orders",
        Some(&BTreeMap::from([
            ("tableName".into(), json!("Orders")),
            ("region".into(), json!("us-west-2")),
        ])),
    );
    let dynamo_metrics_value = serde_json::from_str::<serde_json::Value>(&dynamo_metrics).unwrap();
    assert_eq!(
        dynamo_metrics_value["operation"],
        "CloudWatch.GetMetricData"
    );
    assert_eq!(dynamo_metrics_value["namespace"], "AWS/DynamoDB");
    assert_eq!(
        dynamo_metrics_value["authEvidence"]["credentialScope"],
        "20260101/us-west-2/dynamodb/aws4_request"
    );
    assert!(dynamo_metrics_value["disabledReasons"][1]
        .as_str()
        .unwrap()
        .contains("IAM policy simulation"));

    let dynamo_access = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.security.inspect",
        "Orders",
        Some(&BTreeMap::from([("tableName".into(), json!("Orders"))])),
    );
    let dynamo_access_value = serde_json::from_str::<serde_json::Value>(&dynamo_access).unwrap();
    assert_eq!(
        dynamo_access_value["operation"],
        "IAM.SimulatePrincipalPolicy"
    );
    assert_eq!(
        dynamo_access_value["authEvidence"]["scheme"],
        "AWS4-HMAC-SHA256"
    );

    let ttl_parameters = BTreeMap::from([
        ("tableName".into(), json!("Orders")),
        ("ttlAttribute".into(), json!("expiresAt")),
        ("enabled".into(), json!(true)),
    ]);
    let ttl_request = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.ttl.update",
        "Orders",
        Some(&ttl_parameters),
    );
    let ttl_value = serde_json::from_str::<serde_json::Value>(&ttl_request).unwrap();
    assert_eq!(ttl_value["operation"], "DynamoDB.UpdateTimeToLive");
    assert_eq!(
        ttl_value["timeToLiveSpecification"]["attributeName"],
        "expiresAt"
    );

    let stream_parameters = BTreeMap::from([
        ("tableName".into(), json!("Orders")),
        ("streamViewType".into(), json!("NEW_AND_OLD_IMAGES")),
    ]);
    let stream_request = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.streams.update",
        "Orders",
        Some(&stream_parameters),
    );
    let stream_value = serde_json::from_str::<serde_json::Value>(&stream_request).unwrap();
    assert_eq!(stream_value["operation"], "DynamoDB.UpdateTable");
    assert_eq!(
        stream_value["streamSpecification"]["streamViewType"],
        "NEW_AND_OLD_IMAGES"
    );

    let backup_parameters = BTreeMap::from([
        ("tableName".into(), json!("Orders")),
        ("backupName".into(), json!("Orders-manual")),
    ]);
    let backup_request = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.backup.create",
        "Orders",
        Some(&backup_parameters),
    );
    let backup_value = serde_json::from_str::<serde_json::Value>(&backup_request).unwrap();
    assert_eq!(backup_value["operation"], "DynamoDB.CreateBackup");
    assert_eq!(backup_value["backupName"], "Orders-manual");

    let restore_request = generated_operation_request(
        &connection,
        &dynamo_manifest,
        "dynamodb.backup.restore",
        "Orders",
        Some(&BTreeMap::from([
            (
                "sourceBackupArn".into(),
                json!("arn:aws:dynamodb:local:0:backup/orders"),
            ),
            ("targetTableName".into(), json!("OrdersRestored")),
        ])),
    );
    let restore_value = serde_json::from_str::<serde_json::Value>(&restore_request).unwrap();
    assert_eq!(
        restore_value["operation"],
        "DynamoDB.RestoreTableFromBackup"
    );
    assert_eq!(restore_value["targetTableName"], "OrdersRestored");

    let cassandra_trace = generated_operation_request(
        &connection,
        &cassandra_manifest,
        "cassandra.query.profile",
        "\"app\".\"orders_by_customer\"",
        Some(&cassandra_parameters),
    );
    assert!(cassandra_trace.contains("tracing on;"));
    assert!(cassandra_trace.contains("system_traces.events"));

    let cassandra_index = generated_operation_request(
        &connection,
        &cassandra_manifest,
        "cassandra.index.create",
        "\"app\".\"orders_by_customer\"",
        Some(&cassandra_parameters),
    );
    assert!(cassandra_index.contains("create custom index if not exists \"orders_status_sai\""));
    assert!(cassandra_index.contains("using 'StorageAttachedIndex'"));

    let cassandra_export = generated_operation_request(
        &connection,
        &cassandra_manifest,
        "cassandra.data.import-export",
        "\"app\".\"orders_by_customer\"",
        Some(&BTreeMap::from([
            ("keyspace".into(), json!("app")),
            ("tableName".into(), json!("orders_by_customer")),
            ("mode".into(), json!("export")),
            ("format".into(), json!("csv")),
        ])),
    );
    assert!(cassandra_export.contains("cqlsh COPY is contract-only"));
    assert!(cassandra_export.contains("copy \"app\".\"orders_by_customer\" to"));

    let cassandra_snapshot = generated_operation_request(
        &connection,
        &cassandra_manifest,
        "cassandra.data.backup-restore",
        "\"app\".\"orders_by_customer\"",
        Some(&BTreeMap::from([
            ("keyspace".into(), json!("app")),
            ("tableName".into(), json!("orders_by_customer")),
            ("snapshotName".into(), json!("orders_manual")),
        ])),
    );
    assert!(cassandra_snapshot.contains("nodetool snapshot"));
    assert!(cassandra_snapshot.contains("--table \"orders_by_customer\" \"app\""));
}

#[test]
fn timeseries_operation_plans_use_native_request_shapes() {
    let connection = connection();
    let prometheus_manifest = manifest_for("prometheus", "timeseries", "promql");
    let influx_manifest = manifest_for("influxdb", "timeseries", "influxql");
    let opentsdb_manifest = manifest_for("opentsdb", "timeseries", "opentsdb");
    let prometheus_parameters = BTreeMap::from([
        ("query".into(), json!("sum(rate(http_requests_total[5m]))")),
        ("objectKind".into(), json!("metric")),
    ]);
    let influx_parameters = BTreeMap::from([
        ("bucket".into(), json!("telemetry")),
        ("measurement".into(), json!("cpu")),
        ("mode".into(), json!("export")),
    ]);
    let opentsdb_parameters = BTreeMap::from([
        ("metric".into(), json!("http.requests")),
        ("objectKind".into(), json!("metric")),
    ]);

    let prometheus_request = generated_operation_request(
        &connection,
        &prometheus_manifest,
        "prometheus.query.profile",
        "http_requests_total",
        Some(&prometheus_parameters),
    );
    let prometheus_value = serde_json::from_str::<serde_json::Value>(&prometheus_request).unwrap();
    assert_eq!(prometheus_value["method"], "GET");
    assert_eq!(prometheus_value["path"], "/api/v1/query");
    assert_eq!(
        prometheus_value["query"]["query"],
        "sum(rate(http_requests_total[5m]))"
    );

    let prometheus_cardinality_request = generated_operation_request(
        &connection,
        &prometheus_manifest,
        "prometheus.cardinality.analyze",
        "http_requests_total",
        Some(&BTreeMap::from([(
            "match".into(),
            json!("http_requests_total"),
        )])),
    );
    let prometheus_cardinality_value =
        serde_json::from_str::<serde_json::Value>(&prometheus_cardinality_request).unwrap();
    assert_eq!(prometheus_cardinality_value["path"], "/api/v1/series");
    assert_eq!(
        prometheus_cardinality_value["analysis"]["checks"][2],
        "high-cardinality-labels"
    );

    let influx_request = generated_operation_request(
        &connection,
        &influx_manifest,
        "influxdb.data.import-export",
        "cpu",
        Some(&influx_parameters),
    );
    let influx_value = serde_json::from_str::<serde_json::Value>(&influx_request).unwrap();
    assert_eq!(influx_value["operation"], "line-protocol.export");
    assert_eq!(influx_value["bucket"], "telemetry");
    assert_eq!(influx_value["measurement"], "cpu");

    let influx_retention_request = generated_operation_request(
        &connection,
        &influx_manifest,
        "influxdb.retention.update",
        "telemetry",
        Some(&BTreeMap::from([
            ("bucket".into(), json!("telemetry")),
            ("retentionPeriod".into(), json!("7d")),
        ])),
    );
    let influx_retention_value =
        serde_json::from_str::<serde_json::Value>(&influx_retention_request).unwrap();
    assert_eq!(influx_retention_value["method"], "PATCH");
    assert_eq!(
        influx_retention_value["body"]["retentionRules"][0]["everySeconds"],
        604800
    );

    let opentsdb_request = generated_operation_request(
        &connection,
        &opentsdb_manifest,
        "opentsdb.diagnostics.metrics",
        "http.requests",
        Some(&opentsdb_parameters),
    );
    let opentsdb_value = serde_json::from_str::<serde_json::Value>(&opentsdb_request).unwrap();
    assert_eq!(opentsdb_value["method"], "GET");
    assert_eq!(opentsdb_value["path"], "/api/stats");
    assert_eq!(opentsdb_value["query"]["metric"], "http.requests");

    let opentsdb_repair_request = generated_operation_request(
        &connection,
        &opentsdb_manifest,
        "opentsdb.uid.repair",
        "http.requests",
        Some(&BTreeMap::from([
            ("metric".into(), json!("http.requests")),
            ("displayName".into(), json!("HTTP Requests")),
        ])),
    );
    let opentsdb_repair_value =
        serde_json::from_str::<serde_json::Value>(&opentsdb_repair_request).unwrap();
    assert_eq!(opentsdb_repair_value["operation"], "opentsdb.uid.repair");
    assert_eq!(
        opentsdb_repair_value["update"]["displayName"],
        "HTTP Requests"
    );
}

#[test]
fn graph_operation_plans_use_native_request_shapes() {
    let connection = connection();
    let neo4j_manifest = manifest_for("neo4j", "graph", "cypher");
    let neptune_manifest = manifest_for("neptune", "graph", "gremlin");
    let neo4j_parameters = BTreeMap::from([
        ("label".into(), json!("Account")),
        ("propertyName".into(), json!("email")),
        ("indexName".into(), json!("account_email_lookup")),
        (
            "query".into(),
            json!("MATCH (n:`Account`) RETURN n LIMIT 25"),
        ),
    ]);

    let profile_request = generated_operation_request(
        &connection,
        &neo4j_manifest,
        "neo4j.query.profile",
        "Account",
        Some(&neo4j_parameters),
    );
    assert!(profile_request.starts_with("PROFILE MATCH (n:`Account`)"));

    let explain_request = generated_operation_request(
        &connection,
        &neo4j_manifest,
        "neo4j.query.explain",
        "Account",
        Some(&neo4j_parameters),
    );
    assert!(explain_request.starts_with("EXPLAIN MATCH (n:`Account`)"));

    let index_request = generated_operation_request(
        &connection,
        &neo4j_manifest,
        "neo4j.index.create",
        "Account",
        Some(&neo4j_parameters),
    );
    assert!(index_request.contains("CREATE INDEX account_email_lookup IF NOT EXISTS"));
    assert!(index_request.contains("FOR (n:Account) ON (n.email)"));

    let neo4j_export_request = generated_operation_request(
        &connection,
        &neo4j_manifest,
        "neo4j.data.import-export",
        "Account",
        Some(&neo4j_parameters),
    );
    let neo4j_export_value =
        serde_json::from_str::<serde_json::Value>(&neo4j_export_request).unwrap();
    assert_eq!(neo4j_export_value["operation"], "neo4j.export");
    assert_eq!(neo4j_export_value["format"], "graph-json");

    let metrics_request = generated_operation_request(
        &connection,
        &neptune_manifest,
        "neptune.diagnostics.metrics",
        "analytics",
        None,
    );
    let metrics_value = serde_json::from_str::<serde_json::Value>(&metrics_request).unwrap();
    assert_eq!(metrics_value["operation"], "CloudWatch.GetMetricData");
    assert_eq!(metrics_value["namespace"], "AWS/Neptune");

    let neptune_explain_request = generated_operation_request(
        &connection,
        &neptune_manifest,
        "neptune.query.explain",
        "analytics",
        Some(&BTreeMap::from([(
            "query".into(),
            json!("g.V().hasLabel('Account').limit(25)"),
        )])),
    );
    let neptune_explain_value =
        serde_json::from_str::<serde_json::Value>(&neptune_explain_request).unwrap();
    assert_eq!(neptune_explain_value["path"], "/gremlin/explain");
}

#[test]
fn warehouse_operation_plans_use_native_request_shapes() {
    let connection = connection();
    let snowflake_manifest = manifest_for("snowflake", "warehouse", "snowflake-sql");
    let bigquery_manifest = manifest_for("bigquery", "warehouse", "google-sql");
    let clickhouse_manifest = manifest_for("clickhouse", "warehouse", "clickhouse-sql");
    let query_parameters = BTreeMap::from([
        (
            "query".into(),
            json!("select * from \"ANALYTICS\".\"orders\" limit 100;"),
        ),
        ("schema".into(), json!("ANALYTICS")),
    ]);

    let snowflake_request = generated_operation_request(
        &connection,
        &snowflake_manifest,
        "snowflake.query.profile",
        "orders",
        Some(&query_parameters),
    );
    assert!(snowflake_request.contains("information_schema.query_history"));
    assert!(snowflake_request.contains("select * from \"ANALYTICS\".\"orders\" limit 100;"));

    let snowflake_clone_request = generated_operation_request(
        &connection,
        &snowflake_manifest,
        "snowflake.table.clone",
        "orders",
        Some(&BTreeMap::from([(
            "cloneName".into(),
            json!("orders_clone"),
        )])),
    );
    assert!(snowflake_clone_request.contains("CREATE TABLE"));
    assert!(snowflake_clone_request.contains("CLONE"));

    let bigquery_request = generated_operation_request(
        &connection,
        &bigquery_manifest,
        "bigquery.query.profile",
        "orders",
        Some(&BTreeMap::from([
            ("schema".into(), json!("analytics")),
            (
                "query".into(),
                json!("select * from `analytics.orders` limit 100;"),
            ),
        ])),
    );
    let bigquery_value = serde_json::from_str::<serde_json::Value>(&bigquery_request).unwrap();
    assert_eq!(bigquery_value["operation"], "BigQuery.Jobs.QueryDryRun");
    assert_eq!(bigquery_value["dryRun"], true);

    let bigquery_copy_request = generated_operation_request(
        &connection,
        &bigquery_manifest,
        "bigquery.table.copy",
        "orders",
        Some(&BTreeMap::from([(
            "destinationTable".into(),
            json!("orders_copy"),
        )])),
    );
    let bigquery_copy_value =
        serde_json::from_str::<serde_json::Value>(&bigquery_copy_request).unwrap();
    assert_eq!(bigquery_copy_value["operation"], "BigQuery.Tables.Copy");
    assert_eq!(bigquery_copy_value["destinationTable"], "orders_copy");

    let clickhouse_request = generated_operation_request(
        &connection,
        &clickhouse_manifest,
        "clickhouse.data.import-export",
        "orders",
        Some(&BTreeMap::from([("format".into(), json!("parquet"))])),
    );
    assert!(clickhouse_request.contains("INTO OUTFILE"));
    assert!(clickhouse_request.contains("FORMAT PARQUET"));

    let clickhouse_optimize_request = generated_operation_request(
        &connection,
        &clickhouse_manifest,
        "clickhouse.table.optimize",
        "orders",
        None,
    );
    assert!(clickhouse_optimize_request.contains("OPTIMIZE TABLE"));
    assert!(clickhouse_optimize_request.contains("FINAL"));

    let clickhouse_ttl_request = generated_operation_request(
        &connection,
        &clickhouse_manifest,
        "clickhouse.table.materialize-ttl",
        "orders",
        None,
    );
    assert!(clickhouse_ttl_request.contains("MATERIALIZE TTL"));

    let clickhouse_freeze_request = generated_operation_request(
        &connection,
        &clickhouse_manifest,
        "clickhouse.table.freeze",
        "orders",
        Some(&BTreeMap::from([(
            "snapshotName".into(),
            json!("orders'backup"),
        )])),
    );
    assert!(clickhouse_freeze_request.contains("FREEZE WITH NAME"));
    assert!(clickhouse_freeze_request.contains("orders\\'backup"));
}

#[test]
fn document_and_cache_operation_plans_use_native_request_shapes() {
    let connection = connection();
    let cosmos_manifest = manifest_for("cosmosdb", "document", "json");
    let litedb_manifest = manifest_for("litedb", "document", "json");
    let redis_manifest = manifest_for("redis", "keyvalue", "redis");
    let valkey_manifest = manifest_for("valkey", "keyvalue", "redis");
    let memcached_manifest = manifest_for("memcached", "keyvalue", "text");
    let cosmos_parameters = BTreeMap::from([
        ("database".into(), json!("catalog")),
        ("container".into(), json!("products")),
        ("path".into(), json!("/*")),
    ]);
    let litedb_parameters = BTreeMap::from([
        ("databaseFile".into(), json!("catalog.db")),
        ("collection".into(), json!("products")),
        ("indexName".into(), json!("idx_products_sku")),
        ("field".into(), json!("sku")),
    ]);
    let memcached_parameters = BTreeMap::from([("classId".into(), json!("2"))]);
    let redis_parameters = BTreeMap::from([
        ("database".into(), json!("0")),
        ("key".into(), json!("session:1")),
        ("redisType".into(), json!("hash")),
    ]);

    let cosmos_request = generated_operation_request(
        &connection,
        &cosmos_manifest,
        "cosmosdb.index.create",
        "catalog/products",
        Some(&cosmos_parameters),
    );
    let cosmos_value = serde_json::from_str::<serde_json::Value>(&cosmos_request).unwrap();
    assert_eq!(cosmos_value["method"], "PATCH");
    assert_eq!(cosmos_value["path"], "/dbs/catalog/colls/products");
    assert_eq!(
        cosmos_value["body"]["indexingPolicy"]["includedPaths"][0]["path"],
        "/*"
    );

    let cosmos_throughput_request = generated_operation_request(
        &connection,
        &cosmos_manifest,
        "cosmosdb.throughput.update",
        "catalog/products",
        Some(&BTreeMap::from([
            ("database".into(), json!("catalog")),
            ("container".into(), json!("products")),
            ("mode".into(), json!("autoscale")),
            ("maxRuPerSecond".into(), json!(4000)),
        ])),
    );
    let cosmos_throughput_value =
        serde_json::from_str::<serde_json::Value>(&cosmos_throughput_request).unwrap();
    assert_eq!(
        cosmos_throughput_value["operation"],
        "CosmosDB.ReplaceOffer"
    );
    assert_eq!(
        cosmos_throughput_value["throughputParameters"]["autoscaleSettings"]["maxThroughput"],
        4000
    );

    let cosmos_consistency_request = generated_operation_request(
        &connection,
        &cosmos_manifest,
        "cosmosdb.consistency.update",
        "catalog-account",
        Some(&BTreeMap::from([
            ("account".into(), json!("catalog-account")),
            ("consistencyLevel".into(), json!("Session")),
        ])),
    );
    let cosmos_consistency_value =
        serde_json::from_str::<serde_json::Value>(&cosmos_consistency_request).unwrap();
    assert_eq!(
        cosmos_consistency_value["operation"],
        "CosmosDB.UpdateAccountConsistency"
    );
    assert_eq!(
        cosmos_consistency_value["consistencyPolicy"]["defaultConsistencyLevel"],
        "Session"
    );

    let cosmos_failover_request = generated_operation_request(
        &connection,
        &cosmos_manifest,
        "cosmosdb.regions.failover",
        "catalog-account",
        Some(&BTreeMap::from([
            ("account".into(), json!("catalog-account")),
            ("writeRegion".into(), json!("West Europe")),
        ])),
    );
    let cosmos_failover_value =
        serde_json::from_str::<serde_json::Value>(&cosmos_failover_request).unwrap();
    assert_eq!(
        cosmos_failover_value["operation"],
        "CosmosDB.FailoverPriorityChange"
    );
    assert_eq!(cosmos_failover_value["writeRegion"], "West Europe");

    let litedb_request = generated_operation_request(
        &connection,
        &litedb_manifest,
        "litedb.index.create",
        "products",
        Some(&litedb_parameters),
    );
    assert!(litedb_request.contains("EnsureIndex"));
    assert!(litedb_request.contains("idx_products_sku"));

    let litedb_compact_request = generated_operation_request(
        &connection,
        &litedb_manifest,
        "litedb.storage.compact",
        "catalog.db",
        Some(&BTreeMap::from([(
            "databaseFile".into(),
            json!("catalog.db"),
        )])),
    );
    let litedb_compact_value =
        serde_json::from_str::<serde_json::Value>(&litedb_compact_request).unwrap();
    assert_eq!(litedb_compact_value["operation"], "LiteDB.Compact");
    assert_eq!(litedb_compact_value["databaseFile"], "catalog.db");
    assert_eq!(
        litedb_compact_value["localFilePreflight"]["lockBoundary"]["exclusiveWriterLockValidated"],
        false
    );
    assert_eq!(
        litedb_compact_value["localFilePreflight"]["encryptionBoundary"]["status"],
        "sidecar-required"
    );
    assert_eq!(
        litedb_compact_value["sidecarExecutionBoundary"]["status"],
        "plan-only-until-sidecar"
    );

    let litedb_rebuild_request = generated_operation_request(
        &connection,
        &litedb_manifest,
        "litedb.storage.rebuild-indexes",
        "products",
        Some(&litedb_parameters),
    );
    let litedb_rebuild_value =
        serde_json::from_str::<serde_json::Value>(&litedb_rebuild_request).unwrap();
    assert_eq!(litedb_rebuild_value["operation"], "LiteDB.RebuildIndexes");
    assert_eq!(litedb_rebuild_value["collection"], "products");
    assert_eq!(
        litedb_rebuild_value["localFilePreflight"]["intent"],
        "storage-rebuild-indexes"
    );

    let litedb_backup_request = generated_operation_request(
        &connection,
        &litedb_manifest,
        "litedb.data.backup-restore",
        "catalog.db",
        Some(&BTreeMap::from([(
            "databaseFile".into(),
            json!("catalog.db"),
        )])),
    );
    let litedb_backup_value =
        serde_json::from_str::<serde_json::Value>(&litedb_backup_request).unwrap();
    assert_eq!(litedb_backup_value["operation"], "LiteDB.Backup");
    assert_eq!(litedb_backup_value["databaseFile"], "catalog.db");
    assert_eq!(
        litedb_backup_value["sidecarExecutionBoundary"]["runtime"],
        "dotnet-litedb-sidecar"
    );
    assert!(
        litedb_backup_value["localFilePreflight"]["encryptionBoundary"]
            ["requiredForEncryptedFiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value.as_str() == Some("sidecar LiteDB open probe"))
    );

    let redis_export_request = generated_operation_request(
        &connection,
        &redis_manifest,
        "redis.key.export",
        "session:1",
        Some(&redis_parameters),
    );
    assert!(redis_export_request.contains("TYPE session:1"));
    assert!(redis_export_request.contains("TTL session:1"));
    assert!(redis_export_request.contains("HGETALL session:1"));

    let redis_json_parameters = BTreeMap::from([
        ("database".into(), json!("0")),
        ("key".into(), json!("profile:1")),
        ("redisType".into(), json!("json")),
    ]);
    let redis_json_export_request = generated_operation_request(
        &connection,
        &redis_manifest,
        "redis.key.export",
        "profile:1",
        Some(&redis_json_parameters),
    );
    assert!(redis_json_export_request.contains("JSON.GET profile:1 $"));
    let redis_json_import_plan = default_operation_plan(
        &connection,
        &redis_manifest,
        "redis.key.import",
        Some("profile:1"),
        Some(&redis_json_parameters),
    );
    assert!(redis_json_import_plan
        .generated_request
        .contains("JSON.SET profile:1 $ <json>"));

    let redis_import_plan = default_operation_plan(
        &connection,
        &redis_manifest,
        "redis.key.import",
        Some("session:1"),
        Some(&redis_parameters),
    );
    assert!(redis_import_plan
        .generated_request
        .contains("HSET session:1 <field> <value>"));
    assert_eq!(
        redis_import_plan.required_permissions,
        vec!["write/admin privilege for the target object"]
    );
    assert!(redis_import_plan.confirmation_text.is_some());

    let redis_expire_request = generated_operation_request(
        &connection,
        &redis_manifest,
        "redis.key.expire",
        "session:1",
        Some(&BTreeMap::from([("ttlSeconds".into(), json!(60))])),
    );
    assert_eq!(redis_expire_request, "SELECT 0\nEXPIRE session:1 60");

    let redis_stream_delete_request = generated_operation_request(
        &connection,
        &redis_manifest,
        "redis.stream.delete-entry",
        "orders",
        Some(&BTreeMap::from([(
            "entryIds".into(),
            json!(["1714670000000-0", "1714670000000-1"]),
        )])),
    );
    assert_eq!(
        redis_stream_delete_request,
        "SELECT 0\nXDEL orders 1714670000000-0 1714670000000-1"
    );

    let valkey_copy_request = generated_operation_request(
        &connection,
        &valkey_manifest,
        "valkey.key.copy",
        "session:1",
        Some(&BTreeMap::from([
            ("destinationKey".into(), json!("session:1:copy")),
            ("destinationDatabase".into(), json!("2")),
            ("mode".into(), json!("replace")),
        ])),
    );
    assert_eq!(
        valkey_copy_request,
        "SELECT 0\nCOPY session:1 session:1:copy DB 2 REPLACE"
    );

    let memcached_request = generated_operation_request(
        &connection,
        &memcached_manifest,
        "memcached.data.import-export",
        "class:2",
        Some(&memcached_parameters),
    );
    assert!(memcached_request.contains("lru_crawler metadump 2"));

    let memcached_flush_request = generated_operation_request(
        &connection,
        &memcached_manifest,
        "memcached.cache.flush",
        "server",
        Some(&BTreeMap::from([("delaySeconds".into(), json!(5))])),
    );
    assert!(memcached_flush_request.contains("flush_all 5"));

    let memcached_set_request = generated_operation_request(
        &connection,
        &memcached_manifest,
        "memcached.key.set",
        "session:1",
        Some(&BTreeMap::from([
            ("key".into(), json!("session:1")),
            ("value".into(), json!("cached-user")),
            ("ttlSeconds".into(), json!(60)),
        ])),
    );
    assert!(memcached_set_request.contains("set session:1 0 60 11"));
    assert!(memcached_set_request.contains("cached-user"));

    let memcached_decrement_request = generated_operation_request(
        &connection,
        &memcached_manifest,
        "memcached.key.decrement",
        "counter:1",
        Some(&BTreeMap::from([
            ("key".into(), json!("counter:1")),
            ("delta".into(), json!(2)),
        ])),
    );
    assert_eq!(memcached_decrement_request, "decr counter:1 2");

    let memcached_delete_request = generated_operation_request(
        &connection,
        &memcached_manifest,
        "memcached.key.delete",
        "session:1",
        Some(&BTreeMap::from([("key".into(), json!("session:1"))])),
    );
    assert_eq!(memcached_delete_request, "delete session:1");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-mongo".into(),
        name: "MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "localhost".into(),
        port: Some(27017),
        database: Some("catalog".into()),
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}

fn manifest() -> AdapterManifest {
    manifest_for("mongodb", "document", "mongodb")
}

fn manifest_for(engine: &str, family: &str, default_language: &str) -> AdapterManifest {
    AdapterManifest {
        id: format!("adapter-{engine}"),
        engine: engine.into(),
        family: family.into(),
        label: engine.into(),
        maturity: "stable".into(),
        capabilities: vec!["supports_import_export".into()],
        default_language: default_language.into(),
        local_database: None,
        tree: None,
    }
}
