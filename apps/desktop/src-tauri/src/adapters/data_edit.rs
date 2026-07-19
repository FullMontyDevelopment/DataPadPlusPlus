use std::collections::HashMap;

use crate::domain::error::redact_sensitive_text;

use super::*;

mod requests;
#[cfg(test)]
#[path = "../../tests/unit/adapters/data_edit_tests.rs"]
mod tests;

use requests::generated_edit_request;

pub(crate) fn affected_rows_edit_executed(edit_kind: &str, rows_affected: u64) -> bool {
    edit_kind != "delete-row" || rows_affected > 0
}

pub(crate) fn default_data_edit_plan(
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditPlanRequest,
) -> DataEditPlanResponse {
    let live_execution = !connection.read_only
        && experience.editable_scopes.iter().any(|scope| {
            scope
                .edit_kinds
                .iter()
                .any(|kind| kind == &request.edit_kind)
                && scope.live_execution
        });
    let validation_warnings = validate_edit_target(connection, request);
    let generated_request = redact_sensitive_text(&generated_edit_request(connection, request));
    let confirmation_text = confirmation_text(connection, request, live_execution);
    let mut warnings = vec![
        "Data edits are routed through guarded operation plans before any adapter may execute them."
            .into(),
    ];
    warnings.extend(validation_warnings);

    DataEditPlanResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: if live_execution { "live" } else { "plan-only" }.into(),
        plan: OperationPlan {
            operation_id: format!("{}.data-edit.{}", connection.engine, request.edit_kind),
            engine: connection.engine.clone(),
            summary: data_edit_summary(connection, request, live_execution),
            generated_request,
            request_language: data_edit_language(connection),
            destructive: is_destructive_data_edit(request),
            estimated_cost: Some(
                "Single-object edit; cost depends on the engine and indexes.".into(),
            ),
            estimated_scan_impact: Some(scan_impact(request)),
            required_permissions: required_permissions(connection, request),
            confirmation_text,
            warnings,
        },
    }
}

pub(crate) async fn default_data_edit_execution(
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live data edit execution was blocked because this connection is read-only.".into(),
        );
        return Ok(data_edit_execution_response(
            request, plan, false, messages, warnings,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This data edit needs confirmation before it can run.".into());
            return Ok(data_edit_execution_response(
                request, plan, false, messages, warnings,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe data-edit plan. Live execution is not enabled for this adapter yet."
                .into(),
        );
        return Ok(data_edit_execution_response(
            request, plan, false, messages, warnings,
        ));
    }

    warnings.push("No adapter-specific live data-edit executor is registered yet.".into());
    Ok(data_edit_execution_response(
        request, plan, false, messages, warnings,
    ))
}

fn data_edit_execution_response(
    request: &DataEditExecutionRequest,
    plan: DataEditPlanResponse,
    executed: bool,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> DataEditExecutionResponse {
    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan.execution_support,
        executed,
        plan: plan.plan,
        messages,
        warnings,
        result: None,
        metadata: None,
    }
}

fn validate_edit_target(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> Vec<String> {
    let mut warnings = Vec::new();

    if is_sql_row_edit_connection(connection) {
        validate_sql_row_edit_target(&mut warnings, request);
        if connection.engine == "timescaledb" {
            warnings.push(timescale_row_edit_evidence_warning());
        }
    } else {
        match connection.family.as_str() {
            "document" => {
                if request
                    .target
                    .collection
                    .as_deref()
                    .unwrap_or_default()
                    .is_empty()
                {
                    warnings.push("Document edits need a target collection.".into());
                }

                if request.edit_kind != "insert-document" && request.target.document_id.is_none() {
                    warnings.push("Document edits require a stable document id.".into());
                }
            }
            "keyvalue" => {
                if request.target.key.as_deref().unwrap_or_default().is_empty() {
                    warnings.push("Key/value edits need a single concrete key.".into());
                }
                if request.edit_kind == "stream-delete-entry"
                    && request.target.document_id.is_none()
                    && request.changes.iter().all(|change| {
                        change
                            .field
                            .as_deref()
                            .map(str::trim)
                            .unwrap_or_default()
                            .is_empty()
                            && change
                                .path
                                .as_ref()
                                .and_then(|path| path.first())
                                .map(String::as_str)
                                .map(str::trim)
                                .unwrap_or_default()
                                .is_empty()
                    })
                {
                    warnings.push("Stream entry deletes need a concrete entry id.".into());
                }
                if request.edit_kind == "timeseries-delete-sample"
                    && request.target.document_id.is_none()
                    && request.changes.iter().all(|change| {
                        change
                            .field
                            .as_deref()
                            .map(str::trim)
                            .unwrap_or_default()
                            .is_empty()
                            && change
                                .path
                                .as_ref()
                                .and_then(|path| path.first())
                                .map(String::as_str)
                                .map(str::trim)
                                .unwrap_or_default()
                                .is_empty()
                            && change.value.is_none()
                    })
                {
                    warnings.push(
                        "TimeSeries sample deletes need a concrete timestamp or range.".into(),
                    );
                }
                if request.edit_kind == "vector-remove-member"
                    && request.target.document_id.is_none()
                    && request.changes.iter().all(|change| {
                        change
                            .field
                            .as_deref()
                            .map(str::trim)
                            .unwrap_or_default()
                            .is_empty()
                            && change
                                .path
                                .as_ref()
                                .and_then(|path| path.first())
                                .map(String::as_str)
                                .map(str::trim)
                                .unwrap_or_default()
                                .is_empty()
                    })
                {
                    warnings.push("Vector member removal needs a concrete element name.".into());
                }
            }
            "widecolumn" => {
                let has_key = request
                    .target
                    .primary_key
                    .as_ref()
                    .or(request.target.item_key.as_ref())
                    .map(HashMap::is_empty)
                    .map(|empty| !empty)
                    .unwrap_or(false);

                if !has_key {
                    warnings.push("Wide-column edits require complete key conditions.".into());
                } else if connection.engine == "dynamodb" {
                    warnings.push(dynamodb_item_edit_evidence_warning());
                }
            }
            "search" => {
                if request
                    .target
                    .table
                    .as_deref()
                    .or(request.target.collection.as_deref())
                    .unwrap_or_default()
                    .is_empty()
                {
                    warnings.push("Search document edits need a target index.".into());
                }

                if matches!(
                    request.edit_kind.as_str(),
                    "index-document" | "update-document" | "delete-document"
                ) && request.target.document_id.is_none()
                    && request.target.key.as_deref().unwrap_or_default().is_empty()
                {
                    warnings.push("Search document edits require a stable document id.".into());
                }
            }
            _ => warnings.push("This datastore family has no live data-edit surface yet.".into()),
        }
    }

    if request.changes.is_empty()
        && !matches!(
            request.edit_kind.as_str(),
            "delete-row"
                | "delete-key"
                | "stream-delete-entry"
                | "timeseries-delete-sample"
                | "vector-remove-member"
                | "delete-item"
                | "delete-document"
        )
    {
        warnings.push("Data edits need at least one change.".into());
    }

    warnings
}

fn validate_sql_row_edit_target(warnings: &mut Vec<String>, request: &DataEditPlanRequest) {
    if request
        .target
        .table
        .as_deref()
        .unwrap_or_default()
        .is_empty()
    {
        warnings.push("SQL data edits need a target table.".into());
    }

    if matches!(request.edit_kind.as_str(), "update-row" | "delete-row")
        && request
            .target
            .primary_key
            .as_ref()
            .map(HashMap::is_empty)
            .unwrap_or(true)
    {
        warnings.push("SQL update/delete edits require a complete primary key predicate.".into());
    }
}

fn is_sql_row_edit_connection(connection: &ResolvedConnectionProfile) -> bool {
    matches!(connection.family.as_str(), "sql" | "embedded-olap")
        || connection.engine == "timescaledb"
}

fn timescale_row_edit_evidence_warning() -> String {
    "TimescaleDB row edits use PostgreSQL-wire primary-key prefetches and RETURNING * before/after evidence; chunk, compression, retention, and continuous aggregate policy changes stay in guarded operation previews."
        .into()
}

fn dynamodb_item_edit_evidence_warning() -> String {
    "DynamoDB item edits use consistent GetItem before/after evidence with ReturnConsumedCapacity when a complete item key is supplied."
        .into()
}

fn confirmation_text(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
    live_execution: bool,
) -> Option<String> {
    if !live_execution || connection.read_only || is_destructive_data_edit(request) {
        Some(format!(
            "CONFIRM {} {}",
            connection.engine.to_uppercase(),
            request.edit_kind.to_uppercase()
        ))
    } else {
        None
    }
}

fn is_destructive_data_edit(request: &DataEditPlanRequest) -> bool {
    request.edit_kind.contains("delete") || request.edit_kind == "vector-remove-member"
}

fn required_permissions(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> Vec<String> {
    if is_sql_row_edit_connection(connection) {
        return vec![format!("{} on table", request.edit_kind)];
    }

    match connection.family.as_str() {
        "document" if request.edit_kind == "insert-document" => {
            vec!["insert collection document".into()]
        }
        "document" => vec!["update collection document".into()],
        "keyvalue" => vec!["write concrete key".into()],
        "search" => vec!["write concrete index document".into()],
        "widecolumn" => vec!["write item/row with complete key".into()],
        _ => vec!["adapter-specific write permission".into()],
    }
}

fn scan_impact(request: &DataEditPlanRequest) -> String {
    if request.edit_kind == "insert-document" {
        return "Single collection insert; no scan should be required.".into();
    }

    if request
        .target
        .primary_key
        .as_ref()
        .is_some_and(|keys| !keys.is_empty())
        || request.target.document_id.is_some()
        || request.target.key.is_some()
        || request
            .target
            .item_key
            .as_ref()
            .is_some_and(|keys| !keys.is_empty())
    {
        "Single object/key predicate supplied; no broad scan should be required.".into()
    } else {
        "Target is not fully keyed yet; live execution must stay blocked until this is resolved."
            .into()
    }
}

fn data_edit_summary(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
    live_execution: bool,
) -> String {
    let support = if live_execution {
        "live-capable"
    } else {
        "plan-only"
    };

    format!(
        "{} data edit plan prepared for {} ({support}).",
        request.edit_kind, connection.name
    )
}

fn data_edit_language(connection: &ResolvedConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" => "mongodb",
        "litedb" => "json",
        "redis" | "valkey" => "redis",
        "dynamodb" => "json",
        "cassandra" => "cql",
        "elasticsearch" | "opensearch" => "query-dsl",
        "sqlserver" | "postgresql" | "cockroachdb" | "mysql" | "mariadb" | "sqlite"
        | "timescaledb" | "oracle" => "sql",
        _ => "text",
    }
    .into()
}
