use super::*;
use serde_json::json;

use super::objects::object_kinds;

type TestTemplateParts = (
    &'static str,
    &'static str,
    Vec<&'static str>,
    &'static str,
    &'static str,
    &'static str,
    serde_json::Value,
);

pub(super) fn experience_manifest_for_manifest(
    manifest: &AdapterManifest,
) -> DatastoreExperienceManifest {
    DatastoreExperienceManifest {
        engine: manifest.engine.clone(),
        family: manifest.family.clone(),
        label: manifest.label.clone(),
        maturity: manifest.maturity.clone(),
        object_kinds: object_kinds(manifest),
        context_actions: context_actions(manifest),
        query_builders: query_builders(manifest),
        editable_scopes: editable_scopes(manifest),
        diagnostics_tabs: diagnostics_tabs(manifest),
        result_renderers: result_renderers(manifest),
        safety_rules: safety_rules(manifest),
        tree: manifest.tree.clone(),
        test_templates: test_templates(manifest),
        test_assertions: test_assertions(),
    }
}

fn context_actions(manifest: &AdapterManifest) -> Vec<DatastoreExperienceAction> {
    if manifest.engine == "oracle" {
        return oracle_context_actions(manifest);
    }

    if manifest.engine == "sqlserver" {
        return sqlserver_context_actions(manifest);
    }

    if manifest.engine == "sqlite" {
        return sqlite_context_actions(manifest);
    }

    let mut actions = vec![
        action(
            "open-query",
            "Open Query",
            "query",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open an editor scoped to the selected object.",
        ),
        action(
            "refresh-metadata",
            "Refresh Metadata",
            "connection",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            false,
            "Reload engine-native metadata.",
        ),
    ];

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_explain_plan")
    {
        actions.push(action(
            "view-plan",
            "View Execution Plan",
            "query",
            "diagnostic",
            Some(format!("{}.query.explain", manifest.engine)),
            true,
            "Generate the safest non-mutating execution plan supported by the engine.",
        ));
    }

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_index_management")
    {
        actions.push(action(
            "create-index",
            "Create Index",
            "index",
            "write",
            Some(format!("{}.index.create", manifest.engine)),
            true,
            "Preview an engine-specific index creation request.",
        ));
    }

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_permission_inspection")
    {
        actions.push(action(
            "inspect-permissions",
            "Inspect Permissions",
            "role",
            "read",
            Some(format!("{}.security.inspect", manifest.engine)),
            false,
            "Show effective roles, grants, IAM hints, and unavailable actions.",
        ));
    }

    actions
}

fn sqlite_context_actions(manifest: &AdapterManifest) -> Vec<DatastoreExperienceAction> {
    vec![
        action(
            "open-query",
            "Open SQL Query",
            "query",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open a raw SQLite SQL editor scoped to the selected object.",
        ),
        action(
            "open-select-builder",
            "Open SELECT Builder",
            "table",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open the visual SELECT builder for a SQLite table or view.",
        ),
        action(
            "refresh-metadata",
            "Refresh Branch",
            "connection",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            false,
            "Reload SQLite file metadata for the selected branch.",
        ),
        action(
            "explain-query-plan",
            "Explain Query Plan",
            "query",
            "diagnostic",
            Some(format!("{}.query.explain", manifest.engine)),
            true,
            "Generate EXPLAIN QUERY PLAN output without changing data.",
        ),
        action(
            "integrity-check",
            "Integrity Check",
            "diagnostic",
            "diagnostic",
            Some(format!("{}.diagnostics.integrity-check", manifest.engine)),
            true,
            "Run PRAGMA quick_check/integrity_check previews for the SQLite file.",
        ),
        action(
            "create-index",
            "Create Index...",
            "table",
            "write",
            Some(format!("{}.index.create", manifest.engine)),
            true,
            "Preview a SQLite CREATE INDEX statement.",
        ),
        action(
            "create-trigger",
            "Create Trigger...",
            "table",
            "write",
            Some(format!("{}.trigger.create", manifest.engine)),
            true,
            "Preview a SQLite CREATE TRIGGER statement.",
        ),
        action(
            "vacuum",
            "Vacuum...",
            "maintenance",
            "write",
            Some(format!("{}.maintenance.vacuum", manifest.engine)),
            true,
            "Preview VACUUM or VACUUM INTO maintenance.",
        ),
    ]
}

fn sqlserver_context_actions(manifest: &AdapterManifest) -> Vec<DatastoreExperienceAction> {
    vec![
        action(
            "open-query",
            "Open T-SQL Query",
            "query",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open a raw T-SQL editor scoped to the selected SQL Server object.",
        ),
        action(
            "open-select-builder",
            "Open SELECT Builder",
            "table",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open the visual SELECT builder for a table or view.",
        ),
        action(
            "refresh-metadata",
            "Refresh Branch",
            "connection",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            false,
            "Reload SQL Server metadata for the selected branch.",
        ),
        action(
            "estimated-plan",
            "Estimated Plan",
            "query",
            "diagnostic",
            Some(format!("{}.query.explain", manifest.engine)),
            true,
            "Generate SET SHOWPLAN output without executing the query.",
        ),
        action(
            "actual-plan",
            "Actual Plan...",
            "query",
            "diagnostic",
            Some(format!("{}.query.profile", manifest.engine)),
            true,
            "Preview an actual-plan/statistics request that may execute workload.",
        ),
        action(
            "generate-ddl",
            "Generate DDL",
            "object",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            true,
            "Inspect object definition using SQL Server catalog metadata.",
        ),
        action(
            "create-index",
            "Create Index...",
            "table",
            "write",
            Some(format!("{}.index.create", manifest.engine)),
            true,
            "Preview a CREATE INDEX request.",
        ),
        action(
            "rebuild-index",
            "Rebuild Index...",
            "index",
            "write",
            Some(format!("{}.index.rebuild", manifest.engine)),
            true,
            "Preview an ALTER INDEX REBUILD request.",
        ),
        action(
            "inspect-permissions",
            "Inspect Permissions",
            "security",
            "read",
            Some(format!("{}.security.inspect", manifest.engine)),
            false,
            "Show effective roles, grants, and unavailable SQL Server actions.",
        ),
        action(
            "query-store",
            "Open Query Store",
            "diagnostic",
            "read",
            Some(format!("{}.diagnostics.query-store", manifest.engine)),
            false,
            "Inspect Query Store runtime stats and plan health where available.",
        ),
    ]
}

fn oracle_context_actions(manifest: &AdapterManifest) -> Vec<DatastoreExperienceAction> {
    vec![
        action(
            "open-query",
            "Open SQL Query",
            "query",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open a SQL editor scoped to the selected Oracle object.",
        ),
        action(
            "open-plsql-script",
            "Open PL/SQL Script",
            "script",
            "read",
            Some(format!("{}.query.execute", manifest.engine)),
            true,
            "Open a PL/SQL script template for packages, procedures, and functions.",
        ),
        action(
            "refresh-metadata",
            "Refresh Metadata",
            "connection",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            false,
            "Reload Oracle dictionary metadata using USER_*/ALL_* views.",
        ),
        action(
            "view-plan",
            "Explain Plan",
            "query",
            "diagnostic",
            Some(format!("{}.query.explain", manifest.engine)),
            true,
            "Generate EXPLAIN PLAN and DBMS_XPLAN output templates.",
        ),
        action(
            "compile-object",
            "Compile Object...",
            "object",
            "write",
            Some(format!("{}.object.create", manifest.engine)),
            true,
            "Preview an ALTER ... COMPILE request for PL/SQL objects.",
        ),
        action(
            "generate-ddl",
            "Generate DDL",
            "object",
            "read",
            Some(format!("{}.metadata.refresh", manifest.engine)),
            true,
            "Use DBMS_METADATA where granted to inspect object DDL.",
        ),
        action(
            "inspect-permissions",
            "Inspect Grants",
            "role",
            "read",
            Some(format!("{}.security.inspect", manifest.engine)),
            false,
            "Show effective roles, grants, and unavailable Oracle actions.",
        ),
    ]
}

fn query_builders(manifest: &AdapterManifest) -> Vec<DatastoreExperienceBuilder> {
    match manifest.engine.as_str() {
        "mongodb" => vec![
            builder("mongo-find", "Find Builder", "collection", "visual"),
            builder(
                "mongo-aggregation",
                "Aggregation Builder",
                "collection",
                "visual",
            ),
        ],
        "elasticsearch" | "opensearch" => {
            vec![builder(
                "search-dsl",
                "Search DSL Builder",
                "index",
                "split",
            )]
        }
        "dynamodb" => vec![builder(
            "dynamodb-key-condition",
            "Key Condition Builder",
            "table",
            "split",
        )],
        "redis" | "valkey" => vec![builder("redis-key-browser", "Key Browser", "key", "visual")],
        "cassandra" => vec![builder(
            "cql-partition",
            "Partition Key Builder",
            "table",
            "split",
        )],
        "prometheus" => vec![builder(
            "timeseries-query",
            "PromQL Range Builder",
            "query",
            "split",
        )],
        "influxdb" => vec![builder(
            "timeseries-query",
            "Flux / InfluxQL Builder",
            "query",
            "split",
        )],
        "opentsdb" => vec![builder(
            "timeseries-query",
            "Metric Query Builder",
            "query",
            "split",
        )],
        "neo4j" => vec![builder(
            "graph-query",
            "Cypher Pattern Builder",
            "query",
            "split",
        )],
        "arango" => vec![builder(
            "graph-query",
            "AQL Graph Builder",
            "query",
            "split",
        )],
        "janusgraph" => vec![builder(
            "graph-query",
            "Gremlin Traversal Builder",
            "query",
            "split",
        )],
        "neptune" => vec![builder(
            "graph-query",
            "Gremlin / openCypher Builder",
            "query",
            "split",
        )],
        "postgresql" | "cockroachdb" | "sqlserver" | "mysql" | "mariadb" | "sqlite"
        | "timescaledb" | "oracle" | "duckdb" | "clickhouse" | "snowflake" | "bigquery" => {
            vec![builder("sql-select", "SQL SELECT Builder", "table", "raw")]
        }
        _ => Vec::new(),
    }
}

fn editable_scopes(manifest: &AdapterManifest) -> Vec<DatastoreEditableScope> {
    match manifest.engine.as_str() {
        "sqlite" => vec![editable_scope(
            "table",
            "Table Rows",
            &["insert-row", "update-row", "delete-row"],
            true,
            true,
        )],
        "postgresql" | "cockroachdb" | "timescaledb" | "oracle" => vec![editable_scope(
            "table",
            "Table Rows",
            &["insert-row", "update-row", "delete-row"],
            true,
            true,
        )],
        "sqlserver" | "mysql" | "mariadb" => vec![editable_scope(
            "table",
            "Table Rows",
            &["insert-row", "update-row", "delete-row"],
            true,
            true,
        )],
        "mongodb" => vec![editable_scope(
            "collection",
            "Collection Documents",
            &[
                "insert-document",
                "set-field",
                "unset-field",
                "rename-field",
                "change-field-type",
                "update-document",
                "delete-document",
            ],
            true,
            true,
        )],
        "litedb" => vec![editable_scope(
            "collection",
            "Collection Documents",
            &["insert-document", "update-document", "delete-document"],
            true,
            true,
        )],
        "redis" => vec![editable_scope(
            "key",
            "Keys",
            &[
                "set-key-value",
                "set-ttl",
                "delete-key",
                "rename-key",
                "persist-ttl",
                "hash-set-field",
                "hash-delete-field",
                "list-push",
                "list-set-index",
                "list-remove-value",
                "set-add-member",
                "set-remove-member",
                "zset-add-member",
                "zset-remove-member",
                "stream-add-entry",
                "stream-delete-entry",
                "timeseries-add-sample",
                "timeseries-delete-sample",
                "json-set-path",
                "json-delete-path",
                "vector-add-member",
                "vector-remove-member",
                "vector-set-attributes",
            ],
            false,
            true,
        )],
        "valkey" => vec![editable_scope(
            "key",
            "Keys",
            &[
                "set-key-value",
                "set-ttl",
                "delete-key",
                "rename-key",
                "persist-ttl",
                "hash-set-field",
                "hash-delete-field",
                "list-push",
                "list-set-index",
                "list-remove-value",
                "set-add-member",
                "set-remove-member",
                "zset-add-member",
                "zset-remove-member",
                "stream-add-entry",
                "stream-delete-entry",
            ],
            false,
            true,
        )],
        "dynamodb" => vec![editable_scope(
            "table",
            "Items",
            &["put-item", "update-item", "delete-item"],
            true,
            true,
        )],
        "elasticsearch" | "opensearch" => vec![editable_scope(
            "index",
            "Documents",
            &["index-document", "update-document", "delete-document"],
            true,
            true,
        )],
        "cassandra" => vec![editable_scope(
            "table",
            "Rows",
            &["update-row"],
            true,
            false,
        )],
        _ => Vec::new(),
    }
}

fn diagnostics_tabs(manifest: &AdapterManifest) -> Vec<DatastoreDiagnosticsTab> {
    if manifest.engine == "sqlserver" {
        return vec![
            diagnostics_tab(
                "overview",
                "Overview",
                "Connection health, database size, session counts, and adapter status.",
                "metrics",
            ),
            diagnostics_tab(
                "plans",
                "Execution Plans",
                "Estimated and guarded actual-plan output.",
                "plan",
            ),
            diagnostics_tab(
                "query-store",
                "Query Store",
                "Top queries, regressed queries, forced plans, and runtime stats.",
                "table",
            ),
            diagnostics_tab(
                "sessions-blocking",
                "Sessions & Blocking",
                "Active sessions, blocking tree, long-running requests, waits, and locks.",
                "table",
            ),
            diagnostics_tab(
                "waits-io",
                "Waits & IO",
                "Wait statistics, file IO, memory grants, and TempDB pressure.",
                "metrics",
            ),
            diagnostics_tab(
                "index-health",
                "Index Health",
                "Usage, missing indexes, fragmentation, and statistics signals.",
                "table",
            ),
            diagnostics_tab(
                "security",
                "Security",
                "Logins, users, roles, grants, and disabled-action reasons.",
                "table",
            ),
            diagnostics_tab(
                "agent-events",
                "Agent & Events",
                "SQL Server Agent jobs and Extended Events where available.",
                "table",
            ),
        ];
    }

    if manifest.engine == "oracle" {
        return vec![
            diagnostics_tab(
                "overview",
                "Overview",
                "Connection health, adapter maturity, and dictionary access.",
                "metrics",
            ),
            diagnostics_tab(
                "plans",
                "Execution Plans",
                "EXPLAIN PLAN and DBMS_XPLAN renderer payloads.",
                "plan",
            ),
            diagnostics_tab(
                "sql-monitor",
                "SQL Monitor",
                "SQL Monitor and current-operation templates where available.",
                "profile",
            ),
            diagnostics_tab(
                "sessions",
                "Sessions & Locks",
                "V$SESSION, V$LOCK, waits, blocking sessions, and deadlock context.",
                "table",
            ),
            diagnostics_tab(
                "storage",
                "Storage",
                "Tablespaces, segments, quotas, and storage alerts.",
                "metrics",
            ),
            diagnostics_tab(
                "security",
                "Security",
                "Roles, grants, profiles, and disabled-action reasons.",
                "table",
            ),
        ];
    }

    if manifest.engine == "sqlite" {
        return vec![
            diagnostics_tab(
                "overview",
                "Overview",
                "File size, object counts, page usage, and adapter status.",
                "metrics",
            ),
            diagnostics_tab(
                "query-plan",
                "Query Plan",
                "EXPLAIN QUERY PLAN scan/index/tree output.",
                "plan",
            ),
            diagnostics_tab(
                "pragmas",
                "Pragmas",
                "database_list, table_list, journal, synchronous, cache, encoding, and app metadata.",
                "table",
            ),
            diagnostics_tab(
                "integrity",
                "Integrity",
                "quick_check, foreign_key_check, optimize, and maintenance plans.",
                "table",
            ),
            diagnostics_tab(
                "storage",
                "Storage",
                "Page count, freelist count, auto-vacuum, mmap, and attached file paths.",
                "metrics",
            ),
        ];
    }

    let mut tabs = vec![diagnostics_tab(
        "overview",
        "Overview",
        "Connection health, adapter maturity, and metadata status.",
        "metrics",
    )];

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_explain_plan")
    {
        tabs.push(diagnostics_tab(
            "plans",
            "Plans",
            "Execution plans and plan visualization payloads.",
            "plan",
        ));
    }

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_query_profile")
    {
        tabs.push(diagnostics_tab(
            "profiles",
            "Profiles",
            "Query profile and execution-stage details.",
            "profile",
        ));
    }

    if manifest
        .capabilities
        .iter()
        .any(|item| item == "supports_permission_inspection")
    {
        tabs.push(diagnostics_tab(
            "security",
            "Security",
            "Roles, grants, IAM hints, and disabled-action reasons.",
            "table",
        ));
    }

    tabs
}

fn result_renderers(manifest: &AdapterManifest) -> Vec<String> {
    match manifest.family.as_str() {
        "document" => vec!["document", "json", "table", "raw"],
        "keyvalue" => vec!["keyvalue", "table", "json", "raw", "metrics"],
        "search" => vec!["searchHits", "json", "table", "metrics", "profile", "raw"],
        "widecolumn" => vec!["table", "json", "metrics", "raw"],
        "graph" => vec!["graph", "table", "json", "profile"],
        "timeseries" => vec!["series", "chart", "table", "metrics", "json"],
        _ => vec![
            "table", "schema", "json", "plan", "profile", "metrics", "raw",
        ],
    }
    .into_iter()
    .map(String::from)
    .collect()
}

fn safety_rules(manifest: &AdapterManifest) -> Vec<String> {
    let mut rules = vec![
        "Read-only profiles block live data edits before execution.".into(),
        "Destructive and admin operations remain guarded preview plans in this phase.".into(),
        "Safe edits require an unambiguous target and adapter-specific permission checks.".into(),
    ];

    match manifest.family.as_str() {
        "sql" | "embedded-olap" => {
            rules.push("Row updates and deletes require a complete primary-key predicate.".into());
        }
        "document" => {
            rules.push(
                "Document field edits require a stable document id and collection scope.".into(),
            );
        }
        "keyvalue" => {
            rules.push("Key edits are scoped to one key and never run wildcard deletes.".into());
        }
        "widecolumn" => {
            rules.push("Wide-column edits require complete partition-key conditions.".into());
        }
        "search" => {
            rules.push(
                "Index mutations are preview-only; query builders generate read requests.".into(),
            );
        }
        _ => {}
    }

    rules
}

fn test_assertions() -> Vec<String> {
    [
        "row-count",
        "cell-value",
        "json-path",
        "document-count",
        "key-exists",
        "key-type",
        "key-ttl",
        "search-hit-count",
        "schema-exists",
        "no-error",
        "duration-under",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn test_templates(manifest: &AdapterManifest) -> Vec<serde_json::Value> {
    let Some((name, language, setup, execute, teardown, assertion, expected)) =
        test_template_parts(manifest)
    else {
        return Vec::new();
    };
    let setup_steps = setup
        .into_iter()
        .enumerate()
        .map(|(index, query_text)| {
            json!({
                "id": format!("{}-setup-{}", manifest.engine, index + 1),
                "label": format!("Setup {}", index + 1),
                "phase": "setup",
                "kind": "query",
                "enabled": true,
                "language": language,
                "queryText": query_text,
            })
        })
        .collect::<Vec<_>>();
    let suite = json!({
        "id": format!("{}-smoke-suite", manifest.engine),
        "name": name,
        "description": format!("Repeatable smoke test for {}.", manifest.label),
        "engine": manifest.engine,
        "family": manifest.family,
        "variables": {},
        "cases": [{
            "id": format!("{}-smoke-case", manifest.engine),
            "name": "returns expected fixture data",
            "enabled": true,
            "timeoutMs": 30000,
            "setup": setup_steps,
            "execute": [{
                "id": format!("{}-execute-1", manifest.engine),
                "label": "Execute read",
                "phase": "execute",
                "kind": "query",
                "enabled": true,
                "language": language,
                "queryText": execute,
            }],
            "assertions": [{
                "id": format!("{}-assert-1", manifest.engine),
                "label": "Expected result",
                "kind": assertion,
                "enabled": true,
                "comparison": "equals",
                "expected": expected,
            }, {
                "id": format!("{}-assert-no-error", manifest.engine),
                "label": "No execution errors",
                "kind": "no-error",
                "enabled": true,
                "expected": true,
            }],
            "teardown": [{
                "id": format!("{}-teardown-1", manifest.engine),
                "label": "Cleanup fixture data",
                "phase": "teardown",
                "kind": "query",
                "enabled": true,
                "language": language,
                "queryText": teardown,
            }],
        }],
    });

    vec![json!({
        "id": format!("{}-smoke-suite", manifest.engine),
        "label": name,
        "description": format!("Create a repeatable {} suite with setup, assertions, and teardown.", manifest.label),
        "engine": manifest.engine,
        "family": manifest.family,
        "suite": suite,
    })]
}

fn test_template_parts(manifest: &AdapterManifest) -> Option<TestTemplateParts> {
    match manifest.engine.as_str() {
        "postgresql" | "cockroachdb" | "sqlserver" | "mysql" | "mariadb" | "sqlite" => Some((
            "SQL smoke test",
            "sql",
            vec![
                "create temporary table if not exists datapad_test_accounts (id int primary key, name text);",
                "insert into datapad_test_accounts (id, name) values (1, 'Ada');",
            ],
            "select id, name from datapad_test_accounts where id = 1;",
            "drop table if exists datapad_test_accounts;",
            "row-count",
            json!(1),
        )),
        "mongodb" => Some((
            "MongoDB document test",
            "mongodb",
            vec![r#"{ "collection": "datapad_test_products", "operation": "insertOne", "document": { "_id": "datapad-test-product", "sku": "luna-lamp" } }"#],
            r#"{ "collection": "datapad_test_products", "filter": { "_id": "datapad-test-product" }, "limit": 5 }"#,
            r#"{ "collection": "datapad_test_products", "operation": "deleteOne", "filter": { "_id": "datapad-test-product" } }"#,
            "document-count",
            json!(1),
        )),
        "redis" | "valkey" => Some((
            "Redis key test",
            "redis",
            vec!["SET datapad:test:sku luna-lamp EX 300"],
            "GET datapad:test:sku",
            "DEL datapad:test:sku",
            "key-exists",
            json!(true),
        )),
        "elasticsearch" | "opensearch" => Some((
            "Search index test",
            "query-dsl",
            vec![r#"{ "index": "datapad-test-products", "operation": "index", "id": "luna-lamp", "document": { "sku": "luna-lamp" } }"#],
            r#"{ "index": "datapad-test-products", "body": { "query": { "term": { "sku": "luna-lamp" } }, "size": 5 } }"#,
            r#"{ "index": "datapad-test-products", "operation": "delete", "id": "luna-lamp" }"#,
            "search-hit-count",
            json!(1),
        )),
        "dynamodb" => Some((
            "DynamoDB item test",
            "json",
            vec![r#"{ "operation": "PutItem", "tableName": "datapad-test-orders", "item": { "pk": { "S": "ORDER#1" }, "sk": { "S": "META" } } }"#],
            "{ \"operation\": \"Query\", \"tableName\": \"datapad-test-orders\", \"keyConditionExpression\": \"#pk = :pk\" }",
            r#"{ "operation": "DeleteItem", "tableName": "datapad-test-orders", "key": { "pk": { "S": "ORDER#1" }, "sk": { "S": "META" } } }"#,
            "row-count",
            json!(1),
        )),
        "cassandra" => Some((
            "Cassandra partition test",
            "cql",
            vec!["insert into datapad_test.orders (account_id, order_id, total) values ('acct-1', 'order-1', 42);"],
            "select * from datapad_test.orders where account_id = 'acct-1' and order_id = 'order-1';",
            "delete from datapad_test.orders where account_id = 'acct-1' and order_id = 'order-1';",
            "row-count",
            json!(1),
        )),
        "oracle" => Some((
            "Oracle SQL/PLSQL smoke test",
            "sql",
            vec![
                "begin execute immediate 'create global temporary table datapad_test_accounts (id number primary key, name varchar2(100)) on commit preserve rows'; exception when others then if sqlcode != -955 then raise; end if; end;",
                "insert into datapad_test_accounts (id, name) values (1, 'Ada')",
            ],
            "select id, name from datapad_test_accounts where id = 1",
            "truncate table datapad_test_accounts",
            "row-count",
            json!(1),
        )),
        _ => None,
    }
}

fn action(
    id: &str,
    label: &str,
    scope: &str,
    risk: &str,
    operation_id: Option<String>,
    requires_selection: bool,
    description: &str,
) -> DatastoreExperienceAction {
    DatastoreExperienceAction {
        id: id.into(),
        label: label.into(),
        scope: scope.into(),
        risk: risk.into(),
        operation_id,
        requires_selection,
        description: description.into(),
    }
}

fn builder(kind: &str, label: &str, scope: &str, default_mode: &str) -> DatastoreExperienceBuilder {
    DatastoreExperienceBuilder {
        kind: kind.into(),
        label: label.into(),
        scope: scope.into(),
        default_mode: default_mode.into(),
    }
}

fn editable_scope(
    scope: &str,
    label: &str,
    edit_kinds: &[&str],
    requires_primary_key: bool,
    live_execution: bool,
) -> DatastoreEditableScope {
    DatastoreEditableScope {
        scope: scope.into(),
        label: label.into(),
        edit_kinds: edit_kinds.iter().map(|item| (*item).into()).collect(),
        requires_primary_key,
        live_execution,
    }
}

fn diagnostics_tab(
    id: &str,
    label: &str,
    description: &str,
    default_renderer: &str,
) -> DatastoreDiagnosticsTab {
    DatastoreDiagnosticsTab {
        id: id.into(),
        label: label.into(),
        description: description.into(),
        default_renderer: default_renderer.into(),
    }
}
