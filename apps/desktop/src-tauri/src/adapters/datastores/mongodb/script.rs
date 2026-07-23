use std::{cell::RefCell, rc::Rc};

use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{mongodb_client, mongodb_database_name};
use super::script_operations::{MongoScriptHost, ScriptOperationRecord};
use super::script_runtime::execute_javascript;
use super::MongoDbAdapter;

struct ScriptRunOutput {
    value: Value,
    records: Vec<ScriptOperationRecord>,
    console: String,
    console_truncated: bool,
    truncated: bool,
    open_transaction_aborted: bool,
}

const MAX_CONSOLE_MESSAGE_BYTES: usize = 16 * 1024;

pub(super) async fn execute_mongodb_script(
    adapter: &MongoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let script = selected_query(request).trim();
    if script.is_empty() {
        return Err(CommandError::new(
            "mongodb-script-empty",
            "Enter a MongoDB script or select a statement to run.",
        ));
    }
    let analysis = crate::security::analyze_resolved_mongodb_script(script)?;
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let database = mongodb_database_name(connection);
    let engine = connection.engine.clone();
    let connection = connection.clone();
    let script = script.to_string();
    let database_for_runtime = database.clone();
    let cancellation_guard = super::script_cancellation::register(request.execution_id.as_deref());
    let cancellation = cancellation_guard.token();

    let run = tokio::task::spawn_blocking(move || {
        let _cancellation_guard = cancellation_guard;
        let async_runtime = Rc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| {
                    CommandError::new(
                        "mongodb-script-runtime",
                        format!("Could not start the MongoDB script I/O runtime: {error}"),
                    )
                })?,
        );
        let client = async_runtime.block_on(mongodb_client(&connection))?;
        let host = Rc::new(RefCell::new(MongoScriptHost::new(
            client,
            connection,
            row_limit,
            cancellation.clone(),
            analysis.looks_write,
        )));
        let callback_host = Rc::clone(&host);
        let callback_runtime = Rc::clone(&async_runtime);
        let execution = execute_javascript(
            &script,
            &database_for_runtime,
            cancellation.clone(),
            move |raw| {
                callback_runtime.block_on(callback_host.borrow_mut().execute_json_request(&raw))
            },
        );

        let mut host = host.borrow_mut();
        if let Err(mut error) = execution {
            let partial_mutations = host.completed_mutations();
            async_runtime.block_on(host.abort_open_transaction());
            if cancellation.is_cancelled() {
                return Err(CommandError::new(
                    "execution-cancelled",
                    "MongoDB script execution was cancelled.",
                ));
            }
            if partial_mutations > 0 {
                error.message.push_str(&format!(
                    " {partial_mutations} earlier non-transactional mutation(s) may already have completed; review the script results and database state before retrying."
                ));
            }
            return Err(error);
        }

        let open_transaction_aborted = host.transaction_open();
        if open_transaction_aborted {
            async_runtime.block_on(host.abort_open_transaction());
        }
        let execution = execution.expect("successful execution was checked");
        Ok(ScriptRunOutput {
            value: execution.value,
            records: host.records().to_vec(),
            console: host.console().to_string(),
            console_truncated: host.console_truncated(),
            truncated: host.truncated(),
            open_transaction_aborted,
        })
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "mongodb-script-runtime",
            format!("MongoDB script worker stopped unexpectedly: {error}"),
        )
    })??;

    if run.console_truncated {
        notices.push(QueryExecutionNotice {
            code: "mongodb-script-output-truncated".into(),
            level: "warning".into(),
            message: "MongoDB script console output was capped at 128 KiB.".into(),
        });
    }
    if !run.console.is_empty() {
        let console_preview = if run.console.len() > MAX_CONSOLE_MESSAGE_BYTES {
            let mut boundary = MAX_CONSOLE_MESSAGE_BYTES;
            while boundary > 0 && !run.console.is_char_boundary(boundary) {
                boundary -= 1;
            }
            format!(
                "{}\n[Messages preview capped at 16 KiB; open Raw for the remaining console output.]",
                &run.console[..boundary]
            )
        } else {
            run.console.clone()
        };
        notices.push(QueryExecutionNotice {
            code: "mongodb-script-console".into(),
            level: "info".into(),
            message: console_preview,
        });
    }
    if run.open_transaction_aborted {
        notices.push(QueryExecutionNotice {
            code: "mongodb-script-transaction-aborted".into(),
            level: "warning".into(),
            message: "The script ended with an open transaction, so DataPad++ aborted it.".into(),
        });
    }

    Ok(build_script_result(
        &engine, started, notices, row_limit, run,
    ))
}

fn build_script_result(
    engine: &str,
    started: Instant,
    notices: Vec<QueryExecutionNotice>,
    row_limit: u32,
    run: ScriptRunOutput,
) -> ExecutionResultEnvelope {
    let final_value = if run.value.is_null() {
        run.records
            .last()
            .map(|record| record.value.clone())
            .unwrap_or(Value::Null)
    } else {
        run.value.clone()
    };
    let documents = run
        .records
        .last()
        .and_then(|record| record.documents.clone())
        .or_else(|| documents_from_final_value(&final_value));
    let operations = run
        .records
        .iter()
        .map(operation_metadata)
        .collect::<Vec<_>>();
    let batch = (run.records.len() > 1).then(|| {
        let mut payload = payload_batch(
            run.records.iter().map(batch_record).collect(),
            format!(
                "{} MongoDB script operation(s) completed.",
                run.records.len()
            ),
        );
        if let Some(object) = payload.as_object_mut() {
            object.insert("console".into(), Value::String(run.console.clone()));
            object.insert(
                "metadata".into(),
                json!({ "operations": operations.clone() }),
            );
        }
        payload
    });
    let mut payloads = Vec::new();
    if let Some(batch) = batch.as_ref() {
        payloads.push(batch.clone());
    } else if let Some(documents) = documents.as_ref() {
        let mut payload = payload_document(Value::Array(documents.clone()));
        if let Some(object) = payload.as_object_mut() {
            object.insert("console".into(), Value::String(run.console.clone()));
            object.insert(
                "metadata".into(),
                json!({ "operations": operations.clone() }),
            );
        }
        payloads.push(payload);
    } else {
        payloads.push(payload_json(json!({
            "result": final_value.clone(),
            "operations": operations.clone(),
            "console": run.console.clone(),
        })));
    }

    let has_documents = documents.is_some();
    let has_console = !run.console.is_empty();
    let default_renderer = if batch.is_some() {
        "batch"
    } else if has_documents {
        "document"
    } else if has_console && final_value.is_null() {
        "raw"
    } else {
        "json"
    };
    let renderer_modes = if batch.is_some() && has_documents {
        vec!["batch", "document", "json", "table", "raw"]
    } else if batch.is_some() {
        vec!["batch", "json", "raw"]
    } else if has_documents {
        vec!["document", "json", "table", "raw"]
    } else {
        vec!["json", "raw"]
    };

    build_result(ResultEnvelopeInput {
        engine,
        summary: format!(
            "MongoDB script completed {} operation(s).",
            run.records.len()
        ),
        default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: run.truncated,
        explain_payload: None,
    })
}

fn batch_record(record: &ScriptOperationRecord) -> Value {
    let payloads = if let Some(documents) = record.documents.as_ref() {
        vec![payload_document(Value::Array(documents.clone()))]
    } else {
        vec![payload_json(record.value.clone())]
    };
    batch_section(BatchSectionPayload {
        id: format!("mongodb-script-{}", record.sequence),
        label: format!("{} {}", record.sequence, record.method),
        statement: Some(record.method.clone()),
        status: "success",
        duration_ms: Some(record.duration_ms),
        row_count: record.documents.as_ref().map(Vec::len).or(Some(1)),
        default_renderer: if record.documents.is_some() {
            "document".into()
        } else {
            "json".into()
        },
        renderer_modes: if record.documents.is_some() {
            vec!["document".into()]
        } else {
            vec!["json".into()]
        },
        payloads,
        notices: Vec::new(),
    })
}

fn operation_metadata(record: &ScriptOperationRecord) -> Value {
    json!({
        "sequence": record.sequence,
        "method": record.method,
        "database": record.database,
        "collection": record.collection,
        "mutation": record.mutation,
        "durationMs": record.duration_ms,
    })
}

fn documents_from_final_value(value: &Value) -> Option<Vec<Value>> {
    let values = value.as_array()?;
    values.iter().all(Value::is_object).then(|| values.clone())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/script_tests.rs"]
mod tests;
