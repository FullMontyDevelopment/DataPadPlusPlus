use std::time::Instant;

use super::super::super::*;
use super::preview::beta_result_payloads;
use super::spec::BetaAdapterSpec;

pub(super) fn beta_execution_result(
    spec: &BetaAdapterSpec,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
    started: Instant,
    default_row_limit: u32,
) -> ExecutionResultEnvelope {
    notices.push(QueryExecutionNotice {
        code: "beta-adapter-preview".into(),
        level: "info".into(),
        message: format!(
            "{} is running through a beta request-builder adapter; live execution is enabled per engine as drivers/credentials are configured.",
            spec.label
        ),
    });

    let query_text = selected_query(request);
    let row_limit = bounded_page_size(request.row_limit.or(Some(default_row_limit)));
    let (default_renderer, renderer_modes, payloads) = beta_result_payloads(spec, query_text);

    build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "{} beta adapter normalized {} payload(s).",
            spec.label,
            payloads.len()
        ),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: None,
    })
}

#[cfg(test)]
mod tests {
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
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
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
}
