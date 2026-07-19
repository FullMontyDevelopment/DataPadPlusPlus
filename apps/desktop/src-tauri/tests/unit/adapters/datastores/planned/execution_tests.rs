use super::beta_execution_result;
use crate::domain::models::{ExecutionRequest, ResolvedConnectionProfile};

#[test]
fn beta_execution_clamps_large_requested_row_limits() {
    let spec = super::super::spec::BetaAdapterSpec {
        engine: "contractdb",
        family: "sql",
        label: "Contract adapter",
        default_language: "sql",
        capabilities: crate::adapters::SQL_PLANNED_CAPABILITIES,
    };
    let connection = ResolvedConnectionProfile {
        id: "conn-contractdb".into(),
        name: "Contract DB".into(),
        engine: "contractdb".into(),
        family: "sql".into(),
        host: "project".into(),
        port: None,
        database: None,
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
        read_only: true,
    };
    let request = ExecutionRequest {
        execution_id: None,
        tab_id: "tab".into(),
        connection_id: connection.id.clone(),
        environment_id: "env".into(),
        language: "snowflake-sql".into(),
        query_text: "select 1".into(),
        execution_input_mode: None,
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(99_999),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
    };

    let result = beta_execution_result(
        &spec,
        &connection,
        &request,
        Vec::new(),
        std::time::Instant::now(),
        1_000,
    );

    assert_eq!(result.page_info.expect("page info").page_size, 5_000);
}
