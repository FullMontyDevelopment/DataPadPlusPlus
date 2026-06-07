use serde_json::json;

use super::super::*;
use super::query_request::postgres_query_request;
use super::query_results::{
    postgres_explain_payload, postgres_explain_text, postgres_profile_payload,
    postgres_profile_plan_payload, query_postgres_rows,
};
use super::PostgresAdapter;

pub(super) async fn execute_postgres_query(
    adapter: &PostgresAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request);
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let statements = if matches!(execute_mode(request), "explain" | "profile") {
        single_statement_batch(statement)
    } else {
        split_sql_batch(statement, SqlBatchDialect::Postgres)
    };

    if statements.len() > 1 {
        let query_requests = statements
            .iter()
            .map(|statement| postgres_query_request(&statement.text, "full"))
            .collect::<Result<Vec<_>, _>>()?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&postgres_dsn(connection))
            .await?;
        let mut sections = Vec::new();
        let mut total_rows = 0u32;
        let mut truncated = false;

        for (index, query_request) in query_requests.iter().enumerate() {
            let statement_started = Instant::now();
            match query_postgres_rows(&pool, &query_request.wire_statement, row_limit).await {
                Ok(result) => {
                    total_rows = total_rows.saturating_add(result.total_rows);
                    truncated |= result.truncated;
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("postgres-statement-{}", index + 1),
                        label: format!("Result {}", index + 1),
                        statement: Some(query_request.statement.clone()),
                        status: "success",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: Some(result.rows.len()),
                        default_renderer: "table".into(),
                        renderer_modes: vec!["table".into()],
                        payloads: vec![payload_table(result.columns, result.rows)],
                        notices: Vec::new(),
                    }));
                }
                Err(error) => {
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("postgres-statement-{}", index + 1),
                        label: format!("Command {} failed", index + 1),
                        statement: Some(query_request.statement.clone()),
                        status: "error",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: None,
                        default_renderer: "raw".into(),
                        renderer_modes: vec!["raw".into()],
                        payloads: vec![payload_raw(error.message)],
                        notices: vec![json!({
                            "code": "postgres-batch-statement-failed",
                            "level": "error",
                            "message": "PostgreSQL stopped the batch at the first failing statement.",
                        })],
                    }));
                    break;
                }
            }
        }
        pool.close().await;

        return Ok(build_result(ResultEnvelopeInput {
            engine: &connection.engine,
            summary: format!(
                "PostgreSQL batch returned {total_rows} row(s) from {}.",
                connection.name
            ),
            default_renderer: "batch",
            renderer_modes: vec!["batch", "json", "raw"],
            payloads: vec![
                payload_batch(
                    sections,
                    format!("PostgreSQL batch returned {total_rows} row(s)."),
                ),
                payload_json(json!({
                    "engine": connection.engine,
                    "rowCount": total_rows,
                    "rowLimit": row_limit,
                    "statementCount": statements.len(),
                })),
                payload_raw(statement.to_string()),
            ],
            notices,
            duration_ms: duration_ms(started),
            row_limit: Some(row_limit),
            truncated,
            explain_payload: None,
        }));
    }

    let query_request = postgres_query_request(statement, execute_mode(request))?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let result = query_postgres_rows(&pool, &query_request.wire_statement, row_limit).await;
    pool.close().await;
    let result = result?;
    let table_payload = payload_table(result.columns.clone(), result.rows.clone());
    let profile_payload = (query_request.mode == "profile")
        .then(|| postgres_profile_payload(&result.columns, &result.rows));
    let plan_payload = match query_request.mode {
        "explain" => Some(postgres_explain_payload(
            &query_request.wire_statement,
            &result.columns,
            &result.rows,
        )),
        "profile" => Some(postgres_profile_plan_payload(
            &query_request.wire_statement,
            &result.columns,
            &result.rows,
        )),
        _ => None,
    };
    let mut notices = sql_history_notice(notices);
    if query_request.mode == "profile" {
        notices.push(QueryExecutionNotice {
            code: "postgres-profile-executed".into(),
            level: "warning".into(),
            message:
                "PostgreSQL EXPLAIN ANALYZE executed the read statement to collect profile metrics."
                    .into(),
        });
    }
    if result.truncated {
        notices.push(QueryExecutionNotice {
            code: "postgres-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "PostgreSQL returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    let metadata_payload = payload_json(json!({
        "engine": connection.engine,
        "rowCount": result.rows.len(),
        "totalRows": result.total_rows,
        "rowLimit": row_limit,
        "truncated": result.truncated,
        "mode": query_request.mode,
    }));
    let metrics_payload = payload_metrics(json!([{
        "name": "postgres.rows.displayed",
        "value": result.rows.len(),
        "unit": "rows",
        "labels": {
            "mode": query_request.mode,
            "statement": query_request.statement.clone()
        }
    }]));
    let payloads = if let Some(profile_payload) = profile_payload {
        let mut payloads = vec![profile_payload];
        if let Some(plan_payload) = plan_payload.clone() {
            payloads.push(plan_payload);
        }
        payloads.extend([
            table_payload,
            metadata_payload,
            metrics_payload,
            payload_raw(postgres_explain_text(&result.columns, &result.rows)),
        ]);
        payloads
    } else if let Some(plan_payload) = plan_payload.clone() {
        vec![
            plan_payload,
            table_payload,
            metadata_payload,
            metrics_payload,
            payload_raw(postgres_explain_text(&result.columns, &result.rows)),
        ]
    } else {
        vec![
            table_payload,
            metadata_payload,
            metrics_payload,
            payload_raw(query_request.statement.clone()),
        ]
    };
    let profile_mode = query_request.mode == "profile";
    let explain_mode = query_request.mode == "explain";

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if profile_mode {
            format!(
                "PostgreSQL profile returned {} plan row(s) from {}.",
                result.total_rows, connection.name
            )
        } else if result.truncated {
            format!(
                "{} row(s) loaded from {} out of at least {}.",
                result.rows.len(),
                connection.name,
                result.total_rows
            )
        } else {
            format!(
                "{} row(s) returned from {}.",
                result.total_rows, connection.name
            )
        },
        default_renderer: if profile_mode {
            "profile"
        } else if explain_mode {
            "plan"
        } else {
            "table"
        },
        renderer_modes: if profile_mode {
            vec!["profile", "plan", "table", "json", "raw"]
        } else if explain_mode {
            vec!["plan", "table", "json", "raw"]
        } else {
            vec!["table", "json", "raw"]
        },
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: result.truncated,
        explain_payload: plan_payload,
    }))
}
