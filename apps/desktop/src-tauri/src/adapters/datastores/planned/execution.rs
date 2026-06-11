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
#[path = "../../../../tests/unit/adapters/datastores/planned/execution_tests.rs"]
mod tests;
