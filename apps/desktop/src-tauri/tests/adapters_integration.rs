use std::collections::{BTreeSet, HashMap};
use std::env;
use std::fs;

use datapadplusplus_desktop_lib::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            DataEditChange, DataEditExecutionRequest, DataEditPlanRequest, DataEditTarget,
            ExecutionRequest, ExplorerRequest, ResolvedConnectionProfile, ResultPageRequest,
        },
    },
};
use serde_json::json;
use sqlx::Executor;

fn fixtures_enabled() -> bool {
    env::var("DATAPADPLUSPLUS_FIXTURE_RUN").unwrap_or_default() == "1"
}

fn fixture_profile_enabled(profile: &str) -> bool {
    let value = env::var("DATAPADPLUSPLUS_FIXTURE_PROFILE").unwrap_or_default();
    value
        .split(',')
        .map(str::trim)
        .any(|item| item == "all" || item == profile)
}

fn env_or(key: &str, fallback: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| generated_fixture_env_value(key))
        .unwrap_or_else(|| fallback.to_string())
}

fn generated_fixture_env_value(key: &str) -> Option<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find_map(|root| {
            let candidate = root.join("tests").join("fixtures").join(".generated.env");
            candidate.exists().then_some(candidate)
        })?;
    let contents = fs::read_to_string(path).ok()?;

    contents.lines().find_map(|line| {
        let (env_key, value) = line.split_once('=')?;
        (env_key.trim() == key).then(|| value.trim().to_string())
    })
}

fn execution_request(
    connection_id: &str,
    environment_id: &str,
    language: &str,
    query_text: &str,
) -> ExecutionRequest {
    ExecutionRequest {
        execution_id: None,
        tab_id: format!("tab-{connection_id}"),
        connection_id: connection_id.to_string(),
        environment_id: environment_id.to_string(),
        language: language.to_string(),
        query_text: query_text.to_string(),
        execution_input_mode: None,
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(25),
        confirmed_guardrail_id: None,
    }
}

fn result_page_request(
    connection_id: &str,
    environment_id: &str,
    language: &str,
    query_text: &str,
) -> ResultPageRequest {
    ResultPageRequest {
        tab_id: format!("tab-{connection_id}"),
        connection_id: connection_id.to_string(),
        environment_id: environment_id.to_string(),
        language: language.to_string(),
        query_text: query_text.to_string(),
        selected_text: None,
        renderer: "table".into(),
        page_size: Some(50),
        page_index: Some(1),
        cursor: None,
    }
}

fn resolved_connection(engine: &str, family: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: format!("conn-{engine}"),
        name: format!("Fixture {engine}"),
        engine: engine.into(),
        family: family.into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some(if family == "keyvalue" {
            "0".into()
        } else {
            "datapadplusplus".into()
        }),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: true,
    }
}

#[tokio::test]
async fn every_registered_adapter_has_consistent_operation_contracts() -> Result<(), CommandError> {
    for manifest in adapters::manifests() {
        let connection = resolved_connection(&manifest.engine, &manifest.family);
        let operations = adapters::operation_manifests(&connection)?;
        assert!(
            !operations.is_empty(),
            "{} should expose at least baseline operations",
            manifest.engine
        );

        let mut ids = BTreeSet::new();
        for operation in &operations {
            assert!(
                ids.insert(operation.id.clone()),
                "{} has duplicate operation id {}",
                manifest.engine,
                operation.id
            );
            assert_eq!(operation.engine, manifest.engine);
            assert_eq!(operation.family, manifest.family);
            assert!(
                operation
                    .required_capabilities
                    .iter()
                    .all(|capability| manifest.capabilities.contains(capability)),
                "{} operation {} declares a capability missing from the manifest",
                manifest.engine,
                operation.id
            );
            assert!(
                !operation.supported_renderers.is_empty(),
                "{} operation {} needs at least one renderer",
                manifest.engine,
                operation.id
            );
        }

        let permissions = adapters::inspect_permissions(&connection).await?;
        assert_eq!(permissions.engine, manifest.engine);
        for unavailable in permissions.unavailable_actions {
            assert!(
                ids.contains(&unavailable.operation_id),
                "{} unavailable action references unknown operation {}",
                manifest.engine,
                unavailable.operation_id
            );
            assert!(!unavailable.reason.trim().is_empty());
        }
    }

    Ok(())
}

#[tokio::test]
async fn guarded_operation_plans_include_confirmation_and_permission_warnings(
) -> Result<(), CommandError> {
    for (engine, family, operation_id) in [
        ("postgresql", "sql", "postgresql.object.drop"),
        ("cockroachdb", "sql", "cockroachdb.query.profile"),
        ("mongodb", "document", "mongodb.object.drop"),
        ("bigquery", "warehouse", "bigquery.data.import-export"),
    ] {
        let connection = resolved_connection(engine, family);
        let plan = adapters::plan_operation(&connection, operation_id, None, None).await?;

        assert_eq!(plan.engine, engine);
        assert!(
            plan.confirmation_text.is_some(),
            "{operation_id} should require confirmation for read-only/costly/destructive profiles"
        );
        assert!(
            !plan.required_permissions.is_empty(),
            "{operation_id} should tell the UI which permissions are required"
        );
        assert!(
            !plan.warnings.is_empty(),
            "{operation_id} should surface user-facing warnings"
        );
    }

    Ok(())
}

#[test]
fn manifests_register_cockroach_and_beta_adapters() {
    let manifests = adapters::manifests();
    assert!(
        manifests
            .iter()
            .all(|manifest| manifest.maturity == "mvp" || manifest.maturity == "beta"),
        "runtime registry should not emit generic planned manifests after concrete adapter promotion"
    );
    let cockroach = manifests
        .iter()
        .find(|manifest| manifest.engine == "cockroachdb")
        .expect("cockroachdb manifest");

    assert_eq!(cockroach.maturity, "mvp");
    assert_eq!(cockroach.family, "sql");
    assert_eq!(cockroach.default_language, "sql");
    assert!(cockroach
        .capabilities
        .iter()
        .any(|capability| capability == "supports_cloud_iam"));

    for engine in [
        "oracle",
        "dynamodb",
        "cassandra",
        "cosmosdb",
        "litedb",
        "elasticsearch",
        "opensearch",
        "clickhouse",
        "valkey",
        "memcached",
        "duckdb",
        "snowflake",
        "bigquery",
    ] {
        let manifest = manifests
            .iter()
            .find(|manifest| manifest.engine == engine)
            .unwrap_or_else(|| panic!("{engine} manifest"));
        assert_eq!(manifest.maturity, "beta");
        assert!(!manifest.capabilities.is_empty());
    }
}

#[test]
fn core_popular_engines_have_datastore_experience_manifests() {
    let experiences = adapters::experience_manifests();

    for engine in [
        "postgresql",
        "cockroachdb",
        "sqlserver",
        "mysql",
        "mariadb",
        "sqlite",
        "mongodb",
        "redis",
        "valkey",
        "elasticsearch",
        "opensearch",
        "dynamodb",
        "cassandra",
    ] {
        let experience = experiences
            .iter()
            .find(|item| item.engine == engine)
            .unwrap_or_else(|| panic!("{engine} experience manifest"));
        assert!(
            !experience.object_kinds.is_empty(),
            "{engine} needs object kinds for context menus"
        );
        assert!(
            !experience.context_actions.is_empty(),
            "{engine} needs context actions"
        );
        assert!(
            !experience.diagnostics_tabs.is_empty(),
            "{engine} needs diagnostics tabs"
        );
        assert!(
            !experience.safety_rules.is_empty(),
            "{engine} needs safety rules"
        );
    }

    let mongodb = experiences
        .iter()
        .find(|item| item.engine == "mongodb")
        .expect("mongodb experience");
    assert!(mongodb
        .query_builders
        .iter()
        .any(|builder| builder.kind == "mongo-find"));
    assert!(mongodb
        .editable_scopes
        .iter()
        .any(|scope| scope.edit_kinds.iter().any(|kind| kind == "rename-field")));
    assert!(mongodb.editable_scopes.iter().any(|scope| {
        scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "set-field")
    }));

    let postgres = experiences
        .iter()
        .find(|item| item.engine == "postgresql")
        .expect("postgres experience");
    assert!(postgres
        .query_builders
        .iter()
        .any(|builder| builder.kind == "sql-select"));
    assert!(postgres.editable_scopes.iter().any(|scope| {
        scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "update-row")
    }));

    let cockroach = experiences
        .iter()
        .find(|item| item.engine == "cockroachdb")
        .expect("cockroachdb experience");
    assert!(cockroach.editable_scopes.iter().any(|scope| {
        scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "update-row")
    }));

    for engine in ["sqlserver", "mysql", "mariadb"] {
        let experience = experiences
            .iter()
            .find(|item| item.engine == engine)
            .unwrap_or_else(|| panic!("{engine} experience"));
        assert!(experience.editable_scopes.iter().any(|scope| {
            scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "update-row")
        }));
    }

    for engine in ["redis", "valkey"] {
        let experience = experiences
            .iter()
            .find(|item| item.engine == engine)
            .unwrap_or_else(|| panic!("{engine} experience"));
        assert!(experience.editable_scopes.iter().any(|scope| {
            scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "set-key-value")
        }));
    }

    let dynamodb = experiences
        .iter()
        .find(|item| item.engine == "dynamodb")
        .expect("dynamodb experience");
    assert!(dynamodb.editable_scopes.iter().any(|scope| {
        scope.live_execution && scope.edit_kinds.iter().any(|kind| kind == "update-item")
    }));

    for engine in ["elasticsearch", "opensearch"] {
        let experience = experiences
            .iter()
            .find(|item| item.engine == engine)
            .unwrap_or_else(|| panic!("{engine} experience"));
        assert!(experience.editable_scopes.iter().any(|scope| {
            scope.live_execution
                && scope
                    .edit_kinds
                    .iter()
                    .any(|kind| kind == "update-document")
        }));
    }
}

#[tokio::test]
async fn data_edit_plans_are_guarded_and_engine_specific() -> Result<(), CommandError> {
    let connection = ResolvedConnectionProfile {
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: true,
        ..resolved_connection("mongodb", "document")
    };
    let request = DataEditPlanRequest {
        connection_id: connection.id.clone(),
        environment_id: "env-dev".into(),
        edit_kind: "rename-field".into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            collection: Some("products".into()),
            document_id: Some(json!("item-1")),
            ..Default::default()
        },
        changes: vec![DataEditChange {
            field: Some("sku".into()),
            new_name: Some("stockKeepingUnit".into()),
            ..Default::default()
        }],
    };

    let plan = adapters::plan_data_edit(&connection, &request).await?;
    assert_eq!(plan.execution_support, "plan-only");
    assert_eq!(plan.plan.request_language, "mongodb");
    assert!(plan.plan.generated_request.contains("\"$rename\""));
    assert!(plan.plan.confirmation_text.is_some());

    let execution = adapters::execute_data_edit(
        &connection,
        &datapadplusplus_desktop_lib::domain::models::DataEditExecutionRequest {
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            edit_kind: request.edit_kind,
            target: request.target,
            changes: request.changes,
            confirmation_text: None,
        },
    )
    .await?;
    assert!(!execution.executed);
    assert!(execution
        .warnings
        .iter()
        .any(|warning| warning.contains("read-only")));

    Ok(())
}

#[tokio::test]
async fn sql_data_edit_plan_requires_primary_key_for_updates() -> Result<(), CommandError> {
    let connection = resolved_connection("postgresql", "sql");
    let request = DataEditPlanRequest {
        connection_id: connection.id.clone(),
        environment_id: "env-dev".into(),
        edit_kind: "update-row".into(),
        target: DataEditTarget {
            object_kind: "row".into(),
            schema: Some("public".into()),
            table: Some("accounts".into()),
            primary_key: Some(HashMap::from([("id".into(), json!(1))])),
            ..Default::default()
        },
        changes: vec![DataEditChange {
            field: Some("name".into()),
            value: Some(json!("DataPad++ Labs")),
            value_type: Some("string".into()),
            ..Default::default()
        }],
    };

    let plan = adapters::plan_data_edit(&connection, &request).await?;
    assert_eq!(plan.plan.request_language, "sql");
    assert!(plan
        .plan
        .generated_request
        .contains("update \"public\".\"accounts\" set \"name\" = $1 where \"id\" = $2;"));
    assert!(plan
        .plan
        .estimated_scan_impact
        .as_deref()
        .unwrap_or_default()
        .contains("Single object"));

    Ok(())
}

#[tokio::test]
async fn beta_adapter_contract_surfaces_operations_permissions_and_diagnostics(
) -> Result<(), CommandError> {
    let connection = resolved_connection("bigquery", "warehouse");
    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let explorer = adapters::list_explorer_nodes(
        &connection,
        &ExplorerRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            limit: Some(20),
            scope: None,
        },
    )
    .await?;
    assert!(!explorer.nodes.is_empty());

    let operations = adapters::operation_manifests(&connection)?;
    assert!(operations
        .iter()
        .any(|operation| operation.id == "bigquery.diagnostics.metrics"));

    let permissions = adapters::inspect_permissions(&connection).await?;
    assert!(!permissions.unavailable_actions.is_empty());

    let diagnostics = adapters::collect_diagnostics(&connection, None).await?;
    assert!(!diagnostics.metrics.is_empty());
    assert!(!diagnostics.cost_estimates.is_empty());

    let result = adapters::execute(
        &connection,
        &execution_request(&connection.id, "env-dev", "google-sql", "select 1;"),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "bigquery");
    assert!(result.payloads.iter().any(|payload| payload
        .get("renderer")
        .and_then(|value| value.as_str())
        == Some("costEstimate")));

    let mut large_limit_request =
        execution_request(&connection.id, "env-dev", "google-sql", "select 1;");
    large_limit_request.row_limit = Some(99_999);
    let large_limit_result =
        adapters::execute(&connection, &large_limit_request, Vec::new()).await?;
    assert_eq!(
        large_limit_result
            .page_info
            .expect("beta result page info")
            .page_size,
        5_000
    );
    Ok(())
}

#[tokio::test]
async fn concrete_preview_adapters_surface_contract_without_live_fixture(
) -> Result<(), CommandError> {
    let manifests = adapters::manifests();

    for (engine, family, maturity) in [
        ("timescaledb", "timeseries", "beta"),
        ("oracle", "sql", "beta"),
        ("bigquery", "warehouse", "beta"),
        ("clickhouse", "warehouse", "beta"),
        ("cosmosdb", "document", "beta"),
        ("cassandra", "widecolumn", "beta"),
        ("litedb", "document", "beta"),
        ("duckdb", "embedded-olap", "beta"),
        ("dynamodb", "widecolumn", "beta"),
        ("snowflake", "warehouse", "beta"),
        ("elasticsearch", "search", "beta"),
        ("opensearch", "search", "beta"),
        ("arango", "graph", "beta"),
        ("neo4j", "graph", "beta"),
        ("janusgraph", "graph", "beta"),
        ("neptune", "graph", "beta"),
        ("prometheus", "timeseries", "beta"),
        ("opentsdb", "timeseries", "beta"),
        ("influxdb", "timeseries", "beta"),
        ("valkey", "keyvalue", "beta"),
        ("memcached", "keyvalue", "beta"),
    ] {
        let manifest = manifests
            .iter()
            .find(|manifest| manifest.engine == engine)
            .unwrap_or_else(|| panic!("{engine} manifest"));
        assert_eq!(manifest.family, family);
        assert_eq!(manifest.maturity, maturity);
        assert!(!manifest.capabilities.is_empty());

        let connection = resolved_connection(engine, family);
        let capabilities = adapters::execution_capabilities(engine);
        assert!(capabilities.supports_live_metadata);

        let operations = adapters::operation_manifests(&connection)?;
        assert!(operations
            .iter()
            .any(|operation| operation.id == format!("{engine}.diagnostics.metrics")));
        if maturity == "beta" {
            assert!(operations
                .iter()
                .filter(|operation| matches!(operation.risk.as_str(), "write" | "destructive"))
                .all(|operation| operation.preview_only == Some(true)));
        }

        let permissions = adapters::inspect_permissions(&connection).await?;
        assert_eq!(permissions.engine, engine);
        assert!(!permissions.unavailable_actions.is_empty());

        if engine == "valkey" && !fixture_profile_enabled("cache") {
            continue;
        }

        let diagnostics = adapters::collect_diagnostics(&connection, None).await?;
        assert_eq!(diagnostics.engine, engine);
        assert!(!diagnostics.metrics.is_empty());
    }

    Ok(())
}

#[tokio::test]
async fn preview_adapters_fail_safely_before_network_for_invalid_or_risky_commands(
) -> Result<(), CommandError> {
    let memcached = resolved_connection("memcached", "keyvalue");
    let memcached_result = adapters::execute(
        &memcached,
        &execution_request(
            &memcached.id,
            "env-dev",
            "plaintext",
            "set sample 0 60 5\r\nvalue",
        ),
        Vec::new(),
    )
    .await;
    let memcached_error = match memcached_result {
        Ok(_) => panic!("memcached writes must be preview-only"),
        Err(error) => error,
    };
    assert_eq!(memcached_error.code, "memcached-write-preview-only");

    let redis = resolved_connection("redis", "keyvalue");
    let redis_write_result = adapters::execute(
        &redis,
        &execution_request(&redis.id, "env-dev", "redis", "SET sample value"),
        Vec::new(),
    )
    .await;
    let redis_write_error = match redis_write_result {
        Ok(_) => panic!("redis writes must be preview-only"),
        Err(error) => error,
    };
    assert_eq!(redis_write_error.code, "redis-write-preview-only");

    let redis_unsupported_result = adapters::execute(
        &redis,
        &execution_request(
            &redis.id,
            "env-dev",
            "redis",
            "GEOSEARCH sample FROMLONLAT 0 0 BYRADIUS 1 km",
        ),
        Vec::new(),
    )
    .await;
    let redis_unsupported_error = match redis_unsupported_result {
        Ok(_) => panic!("unsupported redis commands must fail before network use"),
        Err(error) => error,
    };
    assert_eq!(redis_unsupported_error.code, "redis-command-unsupported");

    let clickhouse = resolved_connection("clickhouse", "warehouse");
    let clickhouse_result = adapters::execute(
        &clickhouse,
        &execution_request(&clickhouse.id, "env-dev", "clickhouse-sql", "   "),
        Vec::new(),
    )
    .await;
    let clickhouse_error = match clickhouse_result {
        Ok(_) => panic!("empty ClickHouse query must fail before network"),
        Err(error) => error,
    };
    assert_eq!(clickhouse_error.code, "clickhouse-query-missing");

    Ok(())
}

#[tokio::test]
async fn concrete_preview_adapters_return_safe_non_cursor_page_responses(
) -> Result<(), CommandError> {
    for (engine, family, language) in [
        ("bigquery", "warehouse", "google-sql"),
        ("oracle", "sql", "sql"),
        ("clickhouse", "warehouse", "clickhouse-sql"),
        ("cosmosdb", "document", "sql"),
        ("cassandra", "widecolumn", "cql"),
        ("litedb", "document", "json"),
        ("duckdb", "embedded-olap", "sql"),
        ("dynamodb", "widecolumn", "json"),
        ("snowflake", "warehouse", "snowflake-sql"),
        ("elasticsearch", "search", "query-dsl"),
        ("opensearch", "search", "query-dsl"),
        ("arango", "graph", "aql"),
        ("neo4j", "graph", "cypher"),
        ("janusgraph", "graph", "gremlin"),
        ("neptune", "graph", "gremlin"),
        ("prometheus", "timeseries", "promql"),
        ("opentsdb", "timeseries", "opentsdb"),
        ("influxdb", "timeseries", "influxql"),
        ("memcached", "keyvalue", "plaintext"),
    ] {
        let connection = resolved_connection(engine, family);
        let response = adapters::fetch_result_page(
            &connection,
            &result_page_request(&connection.id, "env-dev", language, "select 1"),
        )
        .await?;

        assert_eq!(response.tab_id, format!("tab-{}", connection.id));
        assert!(!response.page_info.has_more);
        assert_eq!(
            response
                .payload
                .get("renderer")
                .and_then(|value| value.as_str()),
            Some("raw")
        );
        assert!(response
            .notices
            .iter()
            .any(|notice| notice.contains("non-cursor result")));
    }

    Ok(())
}

#[tokio::test]
async fn cockroach_operation_plans_include_cluster_specific_templates() -> Result<(), CommandError>
{
    let connection = resolved_connection("cockroachdb", "sql");
    let operations = adapters::operation_manifests(&connection)?;
    assert!(operations
        .iter()
        .any(|operation| operation.id == "cockroachdb.cockroach.contention"));

    let plan =
        adapters::plan_operation(&connection, "cockroachdb.cockroach.contention", None, None)
            .await?;
    assert!(plan.generated_request.contains("show sessions"));
    assert!(plan
        .estimated_scan_impact
        .as_deref()
        .unwrap_or_default()
        .contains("crdb_internal"));
    Ok(())
}

#[tokio::test]
async fn postgres_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    if !fixtures_enabled() {
        return Ok(());
    }

    let connection = ResolvedConnectionProfile {
        id: "conn-postgres".into(),
        name: "Fixture Postgres".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        host: env_or("DATAPADPLUSPLUS_POSTGRES_HOST", "127.0.0.1"),
        port: Some(
            env_or("DATAPADPLUSPLUS_POSTGRES_PORT", "54329")
                .parse()
                .unwrap_or(54329),
        ),
        database: Some(env_or("DATAPADPLUSPLUS_POSTGRES_DB", "datapadplusplus")),
        username: Some(env_or("DATAPADPLUSPLUS_POSTGRES_USER", "datapadplusplus")),
        password: Some(env_or(
            "DATAPADPLUSPLUS_POSTGRES_PASSWORD",
            "datapadplusplus",
        )),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let test_result = adapters::test_connection(&connection, Vec::new())
        .await
        .map_err(|error| CommandError::new("sqlite-test-connection", error.message))?;
    assert!(test_result.ok);

    let explorer = adapters::list_explorer_nodes(
        &connection,
        &ExplorerRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            limit: Some(20),
            scope: None,
        },
    )
    .await
    .map_err(|error| CommandError::new("sqlite-test-explorer", error.message))?;
    assert!(!explorer.nodes.is_empty());

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select table_name from observability.table_health order by rows_estimate desc limit 2;",
        ),
        Vec::new(),
    )
    .await
    .map_err(|error| CommandError::new("sqlite-test-execution", error.message))?;
    assert_eq!(result.engine, "postgresql");
    assert!(!result.payloads.is_empty());

    let edit = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                schema: Some("observability".into()),
                table: Some("table_health".into()),
                primary_key: Some(HashMap::from([("table_name".into(), json!("alerts"))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("rows_estimate".into()),
                value: Some(json!(441)),
                value_type: Some("number".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(edit.executed);
    assert_eq!(
        edit.metadata
            .as_ref()
            .and_then(|value| value.get("rowsAffected"))
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );

    let scalar_result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select '2024-01-02 03:04:05+00'::timestamptz as ts_tz, timestamp '2024-01-02 03:04:05' as ts, date '2024-01-02' as date_value, time '03:04:05' as time_value, 123.45::numeric as amount, '00000000-0000-0000-0000-000000000001'::uuid as uuid_value, jsonb_build_object('ok', true) as json_value;",
        ),
        Vec::new(),
    )
    .await?;
    let row = scalar_result.payloads[0]
        .get("rows")
        .and_then(|value| value.as_array())
        .and_then(|rows| rows.first())
        .and_then(|value| value.as_array())
        .expect("scalar result row");
    let cells = row
        .iter()
        .map(|value| value.as_str().unwrap_or_default())
        .collect::<Vec<_>>();

    assert_eq!(cells[0], "2024-01-02T03:04:05+00:00");
    assert_eq!(cells[1], "2024-01-02 03:04:05");
    assert_eq!(cells[2], "2024-01-02");
    assert_eq!(cells[3], "03:04:05");
    assert_eq!(
        cells[4].trim_end_matches('0').trim_end_matches('.'),
        "123.45"
    );
    assert_eq!(cells[5], "00000000-0000-0000-0000-000000000001");
    assert_eq!(cells[6], "{\"ok\":true}");
    assert!(
        cells.iter().all(|cell| !cell.starts_with('<')),
        "known PostgreSQL scalar types should not render as placeholders: {cells:?}"
    );
    Ok(())
}

#[tokio::test]
async fn sqlserver_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    if !fixtures_enabled() {
        return Ok(());
    }

    let connection = ResolvedConnectionProfile {
        id: "conn-sqlserver".into(),
        name: "Fixture SQL Server".into(),
        engine: "sqlserver".into(),
        family: "sql".into(),
        host: env_or("DATAPADPLUSPLUS_SQLSERVER_HOST", "127.0.0.1"),
        port: Some(
            env_or("DATAPADPLUSPLUS_SQLSERVER_PORT", "14333")
                .parse()
                .unwrap_or(14333),
        ),
        database: Some(env_or("DATAPADPLUSPLUS_SQLSERVER_DB", "datapadplusplus")),
        username: Some(env_or("DATAPADPLUSPLUS_SQLSERVER_USER", "sa")),
        password: Some(env_or(
            "DATAPADPLUSPLUS_SQLSERVER_PASSWORD",
            "DataPadPlusPlus_pwd_123",
        )),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select top 2 order_id, status from dbo.orders order by updated_at desc;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "sqlserver");
    assert!(!result.payloads.is_empty());

    let edit = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                schema: Some("dbo".into()),
                table: Some("orders".into()),
                primary_key: Some(HashMap::from([("order_id".into(), json!(103))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("status".into()),
                value: Some(json!("review")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(edit.executed);
    assert_eq!(
        edit.metadata
            .as_ref()
            .and_then(|value| value.get("rowsAffected"))
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );

    Ok(())
}

#[tokio::test]
async fn mysql_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    if !fixtures_enabled() {
        return Ok(());
    }

    let connection = ResolvedConnectionProfile {
        id: "conn-mysql".into(),
        name: "Fixture MySQL".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        host: env_or("DATAPADPLUSPLUS_MYSQL_HOST", "127.0.0.1"),
        port: Some(
            env_or("DATAPADPLUSPLUS_MYSQL_PORT", "33060")
                .parse()
                .unwrap_or(33060),
        ),
        database: Some(env_or("DATAPADPLUSPLUS_MYSQL_DB", "commerce")),
        username: Some(env_or("DATAPADPLUSPLUS_MYSQL_USER", "datapadplusplus")),
        password: Some(env_or("DATAPADPLUSPLUS_MYSQL_PASSWORD", "datapadplusplus")),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select sku, inventory_available from inventory_items order by updated_at desc limit 2;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "mysql");
    assert!(!result.payloads.is_empty());

    let id_result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select id from inventory_items where sku = 'luna-lamp' order by id desc limit 1;",
        ),
        Vec::new(),
    )
    .await?;
    let item_id = id_result.payloads[0]
        .get("rows")
        .and_then(|value| value.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<i64>().ok())
        .expect("fixture inventory item id");
    let edit = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("inventory_items".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(item_id))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("inventory_available".into()),
                value: Some(json!(19)),
                value_type: Some("number".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(edit.executed);
    assert_eq!(
        edit.metadata
            .as_ref()
            .and_then(|value| value.get("rowsAffected"))
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );

    Ok(())
}

#[tokio::test]
async fn sqlite_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    let sqlite_url = "sqlite://file:datapadplusplus-fixture?mode=memory&cache=shared".to_string();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&sqlite_url)
        .await?;
    pool.execute("create table if not exists users (id integer primary key, email text not null);")
        .await?;
    pool.execute(
        "create table if not exists organizations (id integer primary key, name text not null);",
    )
    .await?;
    pool.execute("delete from users;").await?;
    pool.execute("delete from organizations;").await?;
    pool.execute(
        "insert into users (id, email) values (1, 'first@example.com'), (2, 'second@example.com');",
    )
    .await?;

    let connection = ResolvedConnectionProfile {
        id: "conn-sqlite".into(),
        name: "Fixture SQLite".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: "file:datapadplusplus-fixture".into(),
        port: None,
        database: Some("file:datapadplusplus-fixture".into()),
        username: None,
        password: None,
        connection_string: Some(sqlite_url),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let explorer = adapters::list_explorer_nodes(
        &connection,
        &ExplorerRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            limit: Some(20),
            scope: None,
        },
    )
    .await?;
    assert!(!explorer.nodes.is_empty());

    let limited_explorer = adapters::list_explorer_nodes(
        &connection,
        &ExplorerRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            limit: Some(1),
            scope: None,
        },
    )
    .await?;
    assert_eq!(limited_explorer.nodes.len(), 1);

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "sql",
            "select email from users order by id;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "sqlite");
    assert!(!result.payloads.is_empty());

    let update = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("users".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(1))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("email".into()),
                value: Some(json!("updated@example.com")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(update.executed);
    assert_eq!(
        update
            .metadata
            .as_ref()
            .and_then(|value| value.get("rowsAffected"))
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );
    let updated_email: String = sqlx::query_scalar("select email from users where id = 1;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(updated_email, "updated@example.com");

    let insert = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "insert-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("organizations".into()),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("name".into()),
                value: Some(json!("DataPad++ Labs")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(insert.executed);
    let organization_count: i64 =
        sqlx::query_scalar("select count(*) from organizations where name = 'DataPad++ Labs';")
            .fetch_one(&pool)
            .await?;
    assert_eq!(organization_count, 1);

    let blocked_delete = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "delete-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("users".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(2))])),
                ..Default::default()
            },
            changes: Vec::new(),
            confirmation_text: None,
        },
    )
    .await?;
    assert!(!blocked_delete.executed);
    assert!(blocked_delete
        .warnings
        .iter()
        .any(|warning| warning.contains("needs confirmation before it can run")));

    let delete = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "delete-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("users".into()),
                primary_key: Some(HashMap::from([("id".into(), json!(2))])),
                ..Default::default()
            },
            changes: Vec::new(),
            confirmation_text: Some("CONFIRM SQLITE DELETE-ROW".into()),
        },
    )
    .await?;
    assert!(delete.executed);
    let remaining_user_count: i64 = sqlx::query_scalar("select count(*) from users where id = 2;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(remaining_user_count, 0);

    pool.close().await;
    Ok(())
}

#[tokio::test]
async fn mongodb_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    if !fixtures_enabled() {
        return Ok(());
    }

    let connection = ResolvedConnectionProfile {
        id: "conn-mongodb".into(),
        name: "Fixture MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: env_or("DATAPADPLUSPLUS_MONGODB_HOST", "127.0.0.1"),
        port: Some(
            env_or("DATAPADPLUSPLUS_MONGODB_PORT", "27018")
                .parse()
                .unwrap_or(27018),
        ),
        database: Some(env_or("DATAPADPLUSPLUS_MONGODB_DB", "catalog")),
        username: Some(env_or("DATAPADPLUSPLUS_MONGODB_USER", "datapadplusplus")),
        password: Some(env_or(
            "DATAPADPLUSPLUS_MONGODB_PASSWORD",
            "datapadplusplus",
        )),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "mongodb",
            "{\n  \"collection\": \"products\",\n  \"filter\": {},\n  \"limit\": 10\n}",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "mongodb");
    assert!(!result.payloads.is_empty());
    let document_payload = result
        .payloads
        .iter()
        .find(|payload| {
            payload.get("renderer").and_then(|value| value.as_str()) == Some("document")
        })
        .expect("document payload");
    let json_payload = result
        .payloads
        .iter()
        .find(|payload| payload.get("renderer").and_then(|value| value.as_str()) == Some("json"))
        .expect("json payload");
    let raw_payload = result
        .payloads
        .iter()
        .find(|payload| payload.get("renderer").and_then(|value| value.as_str()) == Some("raw"))
        .expect("raw payload");
    let documents = document_payload
        .get("documents")
        .and_then(|value| value.as_array())
        .expect("document rows");
    let json_documents = json_payload
        .get("value")
        .and_then(|value| value.as_array())
        .expect("json document rows");
    let raw_text = raw_payload
        .get("text")
        .and_then(|value| value.as_str())
        .expect("raw document text");

    assert!(!documents.is_empty());
    assert_eq!(json_documents.len(), documents.len());
    assert!(raw_text.contains("sku") || raw_text.contains("_id"));
    assert!(!raw_text.contains("\"collection\": \"products\""));

    let target_document = documents
        .iter()
        .find(|document| document.get("sku").and_then(|value| value.as_str()) == Some("luna-lamp"))
        .or_else(|| documents.first())
        .expect("seeded product document");
    let document_id = target_document
        .get("_id")
        .cloned()
        .expect("seeded product id");
    let edit_result = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "set-field".into(),
            target: DataEditTarget {
                object_kind: "document".into(),
                collection: Some("products".into()),
                document_id: Some(document_id.clone()),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                path: Some(vec!["datapadplusplusLiveEdit".into()]),
                value: Some(json!("ok")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(edit_result.executed);
    assert_eq!(edit_result.execution_support, "live");
    assert!(
        edit_result
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("matchedCount"))
            .and_then(|value| value.as_u64())
            .unwrap_or_default()
            >= 1
    );

    let edited_result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-dev",
            "mongodb",
            "{\n  \"collection\": \"products\",\n  \"filter\": { \"sku\": \"luna-lamp\" },\n  \"limit\": 1\n}",
        ),
        Vec::new(),
    )
    .await?;
    let edited_payload = edited_result
        .payloads
        .iter()
        .find(|payload| {
            payload.get("renderer").and_then(|value| value.as_str()) == Some("document")
        })
        .expect("edited document payload");
    let edited_documents = edited_payload
        .get("documents")
        .and_then(|value| value.as_array())
        .expect("edited document rows");
    assert_eq!(
        edited_documents
            .first()
            .and_then(|document| document.get("datapadplusplusLiveEdit"))
            .and_then(|value| value.as_str()),
        Some("ok")
    );

    let cleanup_result = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "unset-field".into(),
            target: DataEditTarget {
                object_kind: "document".into(),
                collection: Some("products".into()),
                document_id: Some(document_id),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                path: Some(vec!["datapadplusplusLiveEdit".into()]),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(cleanup_result.executed);
    Ok(())
}

#[tokio::test]
async fn redis_adapter_fixture_roundtrip() -> Result<(), CommandError> {
    if !fixtures_enabled() {
        return Ok(());
    }

    let connection = ResolvedConnectionProfile {
        id: "conn-redis".into(),
        name: "Fixture Redis".into(),
        engine: "redis".into(),
        family: "keyvalue".into(),
        host: env_or("DATAPADPLUSPLUS_REDIS_HOST", "127.0.0.1"),
        port: Some(
            env_or("DATAPADPLUSPLUS_REDIS_PORT", "6380")
                .parse()
                .unwrap_or(6380),
        ),
        database: Some("0".into()),
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };

    let client = redis::Client::open(format!(
        "redis://{}:{}/{}",
        connection.host,
        connection.port.unwrap_or(6380),
        connection.database.clone().unwrap_or_else(|| "0".into())
    ))?;
    let mut redis = client.get_multiplexed_async_connection().await?;
    let _: () = redis::cmd("HSET")
        .arg("session:9f2d7e1a")
        .arg("userId")
        .arg("a1b2c3")
        .arg("region")
        .arg("eu-west-1")
        .query_async(&mut redis)
        .await?;
    let _: () = redis::cmd("EXPIRE")
        .arg("session:9f2d7e1a")
        .arg(1800)
        .query_async(&mut redis)
        .await?;

    let test_result = adapters::test_connection(&connection, Vec::new()).await?;
    assert!(test_result.ok);

    let result = adapters::execute(
        &connection,
        &execution_request(
            &connection.id,
            "env-prod",
            "redis",
            "HGETALL session:9f2d7e1a",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(result.engine, "redis");
    assert!(!result.payloads.is_empty());

    let edit = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-prod".into(),
            edit_kind: "set-key-value".into(),
            target: DataEditTarget {
                object_kind: "key".into(),
                key: Some("datapadplusplus:live-edit".into()),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                value: Some(json!("ok")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(edit.executed);
    assert_eq!(edit.execution_support, "live");

    let ttl = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-prod".into(),
            edit_kind: "set-ttl".into(),
            target: DataEditTarget {
                object_kind: "key".into(),
                key: Some("datapadplusplus:live-edit".into()),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                value: Some(json!(60)),
                value_type: Some("number".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(ttl.executed);

    let delete_without_confirmation = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-prod".into(),
            edit_kind: "delete-key".into(),
            target: DataEditTarget {
                object_kind: "key".into(),
                key: Some("datapadplusplus:live-edit".into()),
                ..Default::default()
            },
            changes: vec![],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(!delete_without_confirmation.executed);
    assert!(delete_without_confirmation
        .warnings
        .iter()
        .any(|warning| warning.contains("needs confirmation before it can run")));

    let deleted = adapters::execute_data_edit(
        &connection,
        &DataEditExecutionRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-prod".into(),
            edit_kind: "delete-key".into(),
            target: DataEditTarget {
                object_kind: "key".into(),
                key: Some("datapadplusplus:live-edit".into()),
                ..Default::default()
            },
            changes: vec![],
            confirmation_text: Some("CONFIRM REDIS DELETE-KEY".into()),
        },
    )
    .await?;
    assert!(deleted.executed);
    Ok(())
}

#[tokio::test]
async fn cache_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("cache") {
        return Ok(());
    }

    for (engine, port, query) in [
        ("valkey", 6381, "HGETALL session:9f2d7e1a"),
        ("memcached", 11212, "get cache:feature-flags"),
    ] {
        let connection = ResolvedConnectionProfile {
            id: format!("conn-{engine}"),
            name: format!("Fixture {engine}"),
            engine: engine.into(),
            family: "keyvalue".into(),
            host: "127.0.0.1".into(),
            port: Some(port),
            database: Some("0".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        };

        let test_result = adapters::test_connection(&connection, Vec::new()).await?;
        assert!(test_result.ok);

        let result = adapters::execute(
            &connection,
            &execution_request(&connection.id, "env-dev", "redis", query),
            Vec::new(),
        )
        .await?;
        assert_eq!(result.engine, engine);
        assert!(!result.payloads.is_empty());

        let edit = adapters::execute_data_edit(
            &connection,
            &DataEditExecutionRequest {
                connection_id: connection.id.clone(),
                environment_id: "env-dev".into(),
                edit_kind: "update-document".into(),
                target: DataEditTarget {
                    object_kind: "document".into(),
                    table: Some("orders".into()),
                    document_id: Some(json!("101")),
                    ..Default::default()
                },
                changes: vec![DataEditChange {
                    field: Some("status".into()),
                    value: Some(json!("fulfilled")),
                    value_type: Some("string".into()),
                    ..Default::default()
                }],
                confirmation_text: None,
            },
        )
        .await?;
        assert!(edit.executed);
        assert_eq!(
            edit.metadata
                .as_ref()
                .and_then(|value| value.get("path"))
                .and_then(serde_json::Value::as_str),
            Some("/orders/_update/101?refresh=true")
        );
    }

    Ok(())
}

#[tokio::test]
async fn sqlplus_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("sqlplus") {
        return Ok(());
    }

    let mariadb = ResolvedConnectionProfile {
        id: "conn-mariadb".into(),
        name: "Fixture MariaDB".into(),
        engine: "mariadb".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(33061),
        database: Some("commerce".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let mariadb_result = adapters::execute(
        &mariadb,
        &execution_request(
            &mariadb.id,
            "env-dev",
            "sql",
            "select order_id, status from orders order by order_id limit 2;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(mariadb_result.engine, "mariadb");
    assert!(!mariadb_result.payloads.is_empty());

    let mariadb_edit = adapters::execute_data_edit(
        &mariadb,
        &DataEditExecutionRequest {
            connection_id: mariadb.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-row".into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                table: Some("orders".into()),
                primary_key: Some(HashMap::from([("order_id".into(), json!(103))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("status".into()),
                value: Some(json!("review")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(mariadb_edit.executed);

    let timescale = ResolvedConnectionProfile {
        id: "conn-timescaledb".into(),
        name: "Fixture TimescaleDB".into(),
        engine: "timescaledb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: Some(54330),
        database: Some("metrics".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let test_result = adapters::test_connection(&timescale, Vec::new()).await?;
    assert!(test_result.ok);
    let timescale_result = adapters::execute(
        &timescale,
        &execution_request(
            &timescale.id,
            "env-dev",
            "sql",
            "select region, orders from order_metrics order by time limit 2;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(timescale_result.engine, "timescaledb");
    assert!(!timescale_result.payloads.is_empty());

    let cockroach = ResolvedConnectionProfile {
        id: "conn-cockroachdb".into(),
        name: "Fixture CockroachDB".into(),
        engine: "cockroachdb".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(26257),
        database: Some("datapadplusplus".into()),
        username: Some("root".into()),
        password: Some(String::new()),
        connection_string: Some("postgres://root@127.0.0.1:26257/datapadplusplus".into()),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let cockroach_result = adapters::execute(
        &cockroach,
        &execution_request(
            &cockroach.id,
            "env-dev",
            "sql",
            "select transaction_id, status from transactions order by transaction_id limit 2;",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(cockroach_result.engine, "cockroachdb");
    assert!(!cockroach_result.payloads.is_empty());

    Ok(())
}

#[tokio::test]
async fn analytics_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("analytics") {
        return Ok(());
    }

    let clickhouse = ResolvedConnectionProfile {
        id: "conn-clickhouse".into(),
        name: "Fixture ClickHouse".into(),
        engine: "clickhouse".into(),
        family: "warehouse".into(),
        host: "127.0.0.1".into(),
        port: Some(8124),
        database: Some("analytics".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let clickhouse_result = adapters::execute(
        &clickhouse,
        &execution_request(
            &clickhouse.id,
            "env-dev",
            "clickhouse-sql",
            "select event_type from events order by event_time limit 2",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(clickhouse_result.engine, "clickhouse");
    assert!(!clickhouse_result.payloads.is_empty());

    let influxdb = ResolvedConnectionProfile {
        id: "conn-influxdb".into(),
        name: "Fixture InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: Some(8087),
        database: Some("metrics".into()),
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let influx_result = adapters::execute(
        &influxdb,
        &execution_request(
            &influxdb.id,
            "env-dev",
            "influxql",
            "select * from order_latency limit 2",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(influx_result.engine, "influxdb");
    assert!(!influx_result.payloads.is_empty());

    let prometheus = ResolvedConnectionProfile {
        id: "conn-prometheus".into(),
        name: "Fixture Prometheus".into(),
        engine: "prometheus".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: Some(9091),
        database: None,
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let prom_result = adapters::execute(
        &prometheus,
        &execution_request(&prometheus.id, "env-dev", "promql", "up"),
        Vec::new(),
    )
    .await?;
    assert_eq!(prom_result.engine, "prometheus");
    assert!(!prom_result.payloads.is_empty());

    Ok(())
}

#[tokio::test]
async fn search_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("search") {
        return Ok(());
    }

    for (engine, port) in [("opensearch", 9201), ("elasticsearch", 9202)] {
        let connection = ResolvedConnectionProfile {
            id: format!("conn-{engine}"),
            name: format!("Fixture {engine}"),
            engine: engine.into(),
            family: "search".into(),
            host: "127.0.0.1".into(),
            port: Some(port),
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        };
        let result = adapters::execute(
            &connection,
            &execution_request(
                &connection.id,
                "env-dev",
                "query-dsl",
                r#"{ "index": "orders", "body": { "query": { "match_all": {} } } }"#,
            ),
            Vec::new(),
        )
        .await?;
        assert_eq!(result.engine, engine);
        assert!(!result.payloads.is_empty());
    }

    Ok(())
}

#[tokio::test]
async fn graph_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("graph") {
        return Ok(());
    }

    let neo4j = ResolvedConnectionProfile {
        id: "conn-neo4j".into(),
        name: "Fixture Neo4j".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(7475),
        database: Some("neo4j".into()),
        username: Some("neo4j".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let neo4j_result = adapters::execute(
        &neo4j,
        &execution_request(
            &neo4j.id,
            "env-dev",
            "cypher",
            "MATCH (a:Account)-[:PLACED]->(o:Order) RETURN a, o LIMIT 2",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(neo4j_result.engine, "neo4j");
    assert!(!neo4j_result.payloads.is_empty());

    let arango = ResolvedConnectionProfile {
        id: "conn-arango".into(),
        name: "Fixture ArangoDB".into(),
        engine: "arango".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(8529),
        database: Some("datapadplusplus".into()),
        username: Some("root".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let arango_result = adapters::execute(
        &arango,
        &execution_request(
            &arango.id,
            "env-dev",
            "aql",
            "FOR account IN accounts LIMIT 2 RETURN account",
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(arango_result.engine, "arango");
    assert!(!arango_result.payloads.is_empty());

    Ok(())
}

#[tokio::test]
async fn cloud_contract_profile_fixture_roundtrips() -> Result<(), CommandError> {
    if !fixtures_enabled() || !fixture_profile_enabled("cloud-contract") {
        return Ok(());
    }

    let dynamodb = ResolvedConnectionProfile {
        id: "conn-dynamodb".into(),
        name: "Fixture DynamoDB Local".into(),
        engine: "dynamodb".into(),
        family: "widecolumn".into(),
        host: "127.0.0.1".into(),
        port: Some(8001),
        database: None,
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let dynamodb_result = adapters::execute(
        &dynamodb,
        &execution_request(
            &dynamodb.id,
            "env-dev",
            "json",
            r#"{ "operation": "Scan", "TableName": "orders", "Limit": 5 }"#,
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(dynamodb_result.engine, "dynamodb");
    assert!(!dynamodb_result.payloads.is_empty());

    let dynamodb_edit = adapters::execute_data_edit(
        &dynamodb,
        &DataEditExecutionRequest {
            connection_id: dynamodb.id.clone(),
            environment_id: "env-dev".into(),
            edit_kind: "update-item".into(),
            target: DataEditTarget {
                object_kind: "item".into(),
                table: Some("orders".into()),
                item_key: Some(HashMap::from([("order_id".into(), json!("101"))])),
                ..Default::default()
            },
            changes: vec![DataEditChange {
                field: Some("status".into()),
                value: Some(json!("fulfilled")),
                value_type: Some("string".into()),
                ..Default::default()
            }],
            confirmation_text: None,
        },
    )
    .await?;
    assert!(dynamodb_edit.executed);
    assert_eq!(
        dynamodb_edit
            .metadata
            .as_ref()
            .and_then(|value| value.get("operation"))
            .and_then(serde_json::Value::as_str),
        Some("UpdateItem")
    );

    let bigquery = ResolvedConnectionProfile {
        id: "conn-bigquery".into(),
        name: "Fixture BigQuery Mock".into(),
        engine: "bigquery".into(),
        family: "warehouse".into(),
        host: "127.0.0.1".into(),
        port: Some(19050),
        database: Some("analytics".into()),
        username: Some("datapadplusplus-project".into()),
        password: Some("fixture-token".into()),
        connection_string: Some("http://127.0.0.1:19050".into()),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let bigquery_result = adapters::execute(
        &bigquery,
        &execution_request(&bigquery.id, "env-dev", "google-sql", "select 1"),
        Vec::new(),
    )
    .await?;
    assert_eq!(bigquery_result.engine, "bigquery");
    assert!(bigquery_result.payloads.iter().any(|payload| payload
        .get("renderer")
        .and_then(|value| value.as_str())
        == Some("costEstimate")));

    let snowflake = ResolvedConnectionProfile {
        id: "conn-snowflake".into(),
        name: "Fixture Snowflake Mock".into(),
        engine: "snowflake".into(),
        family: "warehouse".into(),
        host: "127.0.0.1".into(),
        port: Some(19060),
        database: Some("DATAPADPLUSPLUS".into()),
        username: Some("PUBLIC".into()),
        password: Some("fixture-token".into()),
        connection_string: Some("http://127.0.0.1:19060".into()),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let snowflake_result = adapters::execute(
        &snowflake,
        &execution_request(&snowflake.id, "env-dev", "snowflake-sql", "select 1"),
        Vec::new(),
    )
    .await?;
    assert_eq!(snowflake_result.engine, "snowflake");
    assert!(!snowflake_result.payloads.is_empty());

    let cosmosdb = ResolvedConnectionProfile {
        id: "conn-cosmosdb".into(),
        name: "Fixture Cosmos DB Mock".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: Some(19070),
        database: Some("datapadplusplus".into()),
        username: None,
        password: Some("fixture-token".into()),
        connection_string: Some("http://127.0.0.1:19070".into()),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let cosmos_result = adapters::execute(
        &cosmosdb,
        &execution_request(
            &cosmosdb.id,
            "env-dev",
            "sql",
            r#"{ "operation": "QueryDocuments", "database": "datapadplusplus", "container": "orders", "query": "SELECT * FROM c" }"#,
        ),
        Vec::new(),
    )
    .await?;
    assert_eq!(cosmos_result.engine, "cosmosdb");
    assert!(!cosmos_result.payloads.is_empty());

    let neptune = ResolvedConnectionProfile {
        id: "conn-neptune".into(),
        name: "Fixture Neptune Mock".into(),
        engine: "neptune".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(19080),
        database: None,
        username: None,
        password: None,
        connection_string: Some("http://127.0.0.1:19080".into()),
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
    };
    let neptune_result = adapters::execute(
        &neptune,
        &execution_request(&neptune.id, "env-dev", "gremlin", "g.V().limit(1)"),
        Vec::new(),
    )
    .await?;
    assert_eq!(neptune_result.engine, "neptune");
    assert!(!neptune_result.payloads.is_empty());

    Ok(())
}
