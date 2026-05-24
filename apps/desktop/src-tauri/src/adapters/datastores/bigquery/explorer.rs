use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::bigquery_execution_capabilities;
use super::connection::{
    bigquery_dataset_id, bigquery_get, bigquery_project_id, has_http_endpoint, has_live_auth,
    parse_bigquery_json,
};

const BIGQUERY_KIND_TABLE: &str = "TABLE";
const BIGQUERY_KIND_VIEW: &str = "VIEW";
const BIGQUERY_KIND_MATERIALIZED_VIEW: &str = "MATERIALIZED_VIEW";
const BIGQUERY_KIND_EXTERNAL: &str = "EXTERNAL";

pub(super) async fn list_bigquery_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("bigquery:datasets") => dataset_nodes(connection, request.limit).await?,
        Some(scope) if scope.starts_with("bigquery:dataset:") => {
            dataset_scope_nodes(connection, scope, request.limit).await?
        }
        Some("bigquery:jobs") => job_template_nodes(connection),
        Some("bigquery:reservations") => reservations_nodes(connection),
        Some("bigquery:security") => security_nodes(connection),
        Some("bigquery:diagnostics") => diagnostics_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} BigQuery explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: bigquery_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_bigquery_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let project = bigquery_project_id(connection);
    let object_view = bigquery_object_view_kind(&request.node_id);
    let query_template = request
        .node_id
        .strip_prefix("bigquery-table:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(dataset, table)| bigquery_table_query(&project, dataset, table))
        .unwrap_or_else(|| match request.node_id.as_str() {
            "bigquery-datasets" => format!("-- GET /bigquery/v2/projects/{project}/datasets"),
            "bigquery-jobs" => {
                "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT limit 100".into()
            }
            "bigquery-reservations" | "bigquery-reservations-overview" => {
                "select * from region-us.INFORMATION_SCHEMA.RESERVATIONS_BY_PROJECT limit 100"
                    .into()
            }
            "bigquery-diagnostics" | "bigquery-diagnostics-overview" => {
                "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT order by creation_time desc limit 100"
                    .into()
            }
            _ => "select 1".into(),
        });
    let mut payload = bigquery_base_payload(connection, &request.node_id, object_view);

    if has_live_auth(connection) && has_http_endpoint(connection) {
        enrich_live_inspection(connection, &request.node_id, &mut payload).await?;
    } else {
        payload["warnings"] = json!([if has_live_auth(connection) {
            "Live BigQuery metadata requires an HTTP BigQuery-compatible endpoint."
        } else {
            "Live BigQuery metadata requires OAuth/ADC credentials; no placeholder objects are shown."
        }]);
    }

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "BigQuery {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let project = bigquery_project_id(connection);
    [
        (
            "bigquery-datasets",
            "Datasets",
            "datasets",
            "Datasets, tables, views, routines, models, and access",
            "bigquery:datasets",
            format!("-- GET /bigquery/v2/projects/{project}/datasets"),
        ),
        (
            "bigquery-jobs",
            "Jobs",
            "jobs",
            "Query history, dry-run estimates, and job diagnostics",
            "bigquery:jobs",
            "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT limit 100".into(),
        ),
        (
            "bigquery-reservations",
            "Reservations",
            "warehouses",
            "Slots, reservations, assignments, and capacity posture",
            "bigquery:reservations",
            "select * from region-us.INFORMATION_SCHEMA.RESERVATIONS_BY_PROJECT limit 100"
                .into(),
        ),
        (
            "bigquery-security",
            "Access",
            "security",
            "Dataset IAM, authorized views, and policy tags",
            "bigquery:security",
            format!("-- Review IAM and dataset access for project {project}"),
        ),
        (
            "bigquery-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Cost, failed jobs, broad scans, and metadata warnings",
            "bigquery:diagnostics",
            "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT where state = 'DONE' limit 100"
                .into(),
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "BigQuery".into()]),
        query_template: Some(query),
        expandable: Some(true),
    })
    .collect()
}

async fn dataset_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let project = bigquery_project_id(connection);
        let response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets?maxResults=100"),
        )
        .await?;
        let value = parse_bigquery_json(&response.body)?;
        return Ok(bigquery_dataset_nodes_from_value(connection, &value, limit));
    }

    Ok(configured_dataset_node(connection).into_iter().collect())
}

async fn dataset_scope_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some(dataset_scope) = scope.strip_prefix("bigquery:dataset:") else {
        return Ok(Vec::new());
    };
    let mut parts = dataset_scope.split(':');
    let dataset = parts.next().unwrap_or_default();
    let child_scope = parts.next();

    if child_scope.is_none() {
        return Ok(dataset_child_sections(connection, dataset));
    }

    match child_scope.unwrap_or_default() {
        "tables" => table_nodes(connection, dataset, Some(BIGQUERY_KIND_TABLE), limit).await,
        "views" => table_nodes(connection, dataset, Some(BIGQUERY_KIND_VIEW), limit).await,
        "materialized-views" => {
            table_nodes(
                connection,
                dataset,
                Some(BIGQUERY_KIND_MATERIALIZED_VIEW),
                limit,
            )
            .await
        }
        "external-tables" => {
            table_nodes(connection, dataset, Some(BIGQUERY_KIND_EXTERNAL), limit).await
        }
        "routines" => routine_nodes(connection, dataset, limit).await,
        "models" => model_nodes(connection, dataset, limit).await,
        "jobs" => Ok(job_template_nodes(connection)),
        "security" => Ok(dataset_security_nodes(connection, dataset)),
        "statistics" => Ok(dataset_statistics_nodes(connection, dataset)),
        _ => Ok(Vec::new()),
    }
}

async fn table_nodes(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
    table_type: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let project = bigquery_project_id(connection);
        let response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/tables?maxResults=100"),
        )
        .await?;
        let value = parse_bigquery_json(&response.body)?;
        return Ok(bigquery_table_nodes_from_value(
            connection, &project, dataset, &value, table_type, limit,
        ));
    }

    Ok(Vec::new())
}

fn job_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "bigquery-jobs-by-project".into(),
        family: "warehouse".into(),
        label: "Jobs By Project".into(),
        kind: "job".into(),
        detail: "INFORMATION_SCHEMA job history query".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Jobs".into()]),
        query_template: Some(
            "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT limit 100".into(),
        ),
        expandable: Some(false),
    }]
}

fn reservations_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "bigquery-reservations-overview".into(),
        family: "warehouse".into(),
        label: "Reservation Overview".into(),
        kind: "warehouse".into(),
        detail: "Slot commitments, assignments, and capacity checks".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Reservations".into()]),
        query_template: Some(
            "select * from region-us.INFORMATION_SCHEMA.RESERVATIONS_BY_PROJECT limit 100".into(),
        ),
        expandable: Some(false),
    }]
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "bigquery-access-overview".into(),
        family: "warehouse".into(),
        label: "Access Overview".into(),
        kind: "security".into(),
        detail: "Dataset IAM, authorized views, policy tags, and grants".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Access".into()]),
        query_template: None,
        expandable: Some(false),
    }]
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "bigquery-diagnostics-overview".into(),
        family: "warehouse".into(),
        label: "Cost and Job Health".into(),
        kind: "diagnostics".into(),
        detail: "Failed jobs, broad scan risk, bytes processed, and dry-run guidance".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
        query_template: Some(
            "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT order by creation_time desc limit 100".into(),
        ),
        expandable: Some(false),
    }]
}

pub(crate) fn bigquery_dataset_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("datasets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|dataset| {
            dataset
                .pointer("/datasetReference/datasetId")
                .and_then(Value::as_str)
        })
        .map(|dataset| ExplorerNode {
            id: format!("bigquery-dataset:{dataset}"),
            family: "warehouse".into(),
            label: dataset.into(),
            kind: "dataset".into(),
            detail: "Tables, views, routines, jobs, access, and statistics".into(),
            scope: Some(format!("bigquery:dataset:{dataset}")),
            path: Some(vec![connection.name.clone(), "Datasets".into()]),
            query_template: None,
            expandable: Some(true),
        })
        .collect()
}

fn configured_dataset_node(connection: &ResolvedConnectionProfile) -> Option<ExplorerNode> {
    let dataset = connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(ExplorerNode {
        id: format!("bigquery-dataset:{dataset}"),
        family: "warehouse".into(),
        label: dataset.into(),
        kind: "dataset".into(),
        detail: "Configured dataset scope; refresh with live credentials to list objects".into(),
        scope: Some(format!("bigquery:dataset:{dataset}")),
        path: Some(vec![connection.name.clone(), "Datasets".into()]),
        query_template: None,
        expandable: Some(true),
    })
}

fn dataset_child_sections(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
) -> Vec<ExplorerNode> {
    [
        (
            "tables",
            "Tables",
            "tables",
            "Native BigQuery tables and partitions",
            "bigquery:dataset:{dataset}:tables",
        ),
        (
            "views",
            "Views",
            "views",
            "Logical views and authorized view entry points",
            "bigquery:dataset:{dataset}:views",
        ),
        (
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Persisted analytical views and refresh metadata",
            "bigquery:dataset:{dataset}:materialized-views",
        ),
        (
            "external-tables",
            "External Tables",
            "stages",
            "External table definitions and linked storage",
            "bigquery:dataset:{dataset}:external-tables",
        ),
        (
            "routines",
            "Routines",
            "functions",
            "User-defined functions and procedures",
            "bigquery:dataset:{dataset}:routines",
        ),
        (
            "models",
            "Models",
            "models",
            "BigQuery ML models and training metadata",
            "bigquery:dataset:{dataset}:models",
        ),
        (
            "jobs",
            "Jobs",
            "jobs",
            "Recent work scoped to this dataset",
            "bigquery:dataset:{dataset}:jobs",
        ),
        (
            "security",
            "Access",
            "security",
            "Dataset IAM, authorized views, and row policies",
            "bigquery:dataset:{dataset}:security",
        ),
        (
            "statistics",
            "Statistics",
            "diagnostics",
            "Storage, object counts, partitioning, and scan posture",
            "bigquery:dataset:{dataset}:statistics",
        ),
    ]
    .into_iter()
    .map(|(suffix, label, kind, detail, scope)| ExplorerNode {
        id: format!("bigquery-{suffix}:{dataset}"),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.replace("{dataset}", dataset)),
        path: Some(vec![
            connection.name.clone(),
            "Datasets".into(),
            dataset.into(),
        ]),
        query_template: None,
        expandable: Some(true),
    })
    .collect()
}

fn bigquery_table_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    project: &str,
    dataset: &str,
    value: &Value,
    table_type: Option<&str>,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("tables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|table| {
            let table_id = table
                .pointer("/tableReference/tableId")
                .and_then(Value::as_str)?;
            let raw_type = table
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or(BIGQUERY_KIND_TABLE);

            if table_type.is_some_and(|expected| expected != raw_type) {
                return None;
            }

            Some(ExplorerNode {
                id: format!("bigquery-table:{dataset}:{table_id}"),
                family: "warehouse".into(),
                label: table_id.into(),
                kind: bigquery_table_kind(Some(raw_type)).into(),
                detail: bigquery_table_detail(raw_type).into(),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    dataset.into(),
                    bigquery_table_category(raw_type).into(),
                ]),
                query_template: Some(bigquery_table_query(project, dataset, table_id)),
                expandable: Some(false),
            })
        })
        .collect()
}

async fn routine_nodes(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if !(has_live_auth(connection) && has_http_endpoint(connection)) {
        return Ok(Vec::new());
    }

    let project = bigquery_project_id(connection);
    let response = bigquery_get(
        connection,
        &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/routines?maxResults=100"),
    )
    .await?;
    let value = parse_bigquery_json(&response.body)?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(value
        .get("routines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|routine| {
            routine
                .pointer("/routineReference/routineId")
                .and_then(Value::as_str)
                .map(|routine_id| ExplorerNode {
                    id: format!("bigquery-routine:{dataset}:{routine_id}"),
                    family: "warehouse".into(),
                    label: routine_id.into(),
                    kind: "function".into(),
                    detail: routine
                        .get("routineType")
                        .and_then(Value::as_str)
                        .unwrap_or("BigQuery routine")
                        .into(),
                    scope: None,
                    path: Some(vec![
                        connection.name.clone(),
                        dataset.into(),
                        "Routines".into(),
                    ]),
                    query_template: None,
                    expandable: Some(false),
                })
        })
        .collect())
}

async fn model_nodes(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if !(has_live_auth(connection) && has_http_endpoint(connection)) {
        return Ok(Vec::new());
    }

    let project = bigquery_project_id(connection);
    let response = bigquery_get(
        connection,
        &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/models?maxResults=100"),
    )
    .await?;
    let value = parse_bigquery_json(&response.body)?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(value
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|model| {
            model
                .pointer("/modelReference/modelId")
                .and_then(Value::as_str)
                .map(|model_id| ExplorerNode {
                    id: format!("bigquery-model:{dataset}:{model_id}"),
                    family: "warehouse".into(),
                    label: model_id.into(),
                    kind: "model".into(),
                    detail: model
                        .get("modelType")
                        .and_then(Value::as_str)
                        .unwrap_or("BigQuery ML model")
                        .into(),
                    scope: None,
                    path: Some(vec![
                        connection.name.clone(),
                        dataset.into(),
                        "Models".into(),
                    ]),
                    query_template: None,
                    expandable: Some(false),
                })
        })
        .collect())
}

fn dataset_security_nodes(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: format!("bigquery-dataset-access:{dataset}"),
        family: "warehouse".into(),
        label: "Dataset Access".into(),
        kind: "security".into(),
        detail: "IAM bindings, authorized views, policy tags, and row access policies".into(),
        scope: None,
        path: Some(vec![
            connection.name.clone(),
            dataset.into(),
            "Access".into(),
        ]),
        query_template: None,
        expandable: Some(false),
    }]
}

fn dataset_statistics_nodes(
    connection: &ResolvedConnectionProfile,
    dataset: &str,
) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: format!("bigquery-dataset-statistics:{dataset}"),
        family: "warehouse".into(),
        label: "Dataset Statistics".into(),
        kind: "diagnostics".into(),
        detail: "Table count, storage bytes, freshness, partitioning, and scan posture".into(),
        scope: None,
        path: Some(vec![
            connection.name.clone(),
            dataset.into(),
            "Statistics".into(),
        ]),
        query_template: None,
        expandable: Some(false),
    }]
}

fn bigquery_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    let project = bigquery_project_id(connection);
    let dataset =
        bigquery_dataset_from_node_id(node_id).unwrap_or_else(|| bigquery_dataset_id(connection));
    let datasets = configured_dataset_node(connection)
        .map(|node| {
            vec![json!({
                "name": node.label,
                "location": "configured",
                "tables": "-",
                "views": "-",
                "owner": "connection profile"
            })]
        })
        .unwrap_or_default();

    json!({
        "engine": "bigquery",
        "nodeId": node_id,
        "objectView": object_view,
        "project": project,
        "dataset": dataset,
        "datasets": datasets,
        "tables": [],
        "views": [],
        "materializedViews": [],
        "stages": [],
        "jobs": [],
        "security": [],
        "diagnostics": [
            {
                "signal": "Live metadata",
                "value": if has_live_auth(connection) && has_http_endpoint(connection) { "enabled" } else { "not configured" },
                "status": if has_live_auth(connection) && has_http_endpoint(connection) { "ready" } else { "setup required" },
                "guidance": "Add OAuth credentials and a BigQuery-compatible endpoint to list live objects."
            }
        ]
    })
}

async fn enrich_live_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) -> Result<(), CommandError> {
    let project = bigquery_project_id(connection);

    if let Some((dataset, table)) = bigquery_table_from_node_id(node_id) {
        let response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/tables/{table}"),
        )
        .await?;
        let value = parse_bigquery_json(&response.body)?;
        payload["tables"] = json!([bigquery_table_metadata_row(&value)]);
        payload["columns"] = json!(bigquery_columns_from_table_metadata(&value));
        payload["diagnostics"] = json!(bigquery_table_diagnostics(&value));
        return Ok(());
    }

    if let Some(dataset) = bigquery_dataset_from_node_id(node_id) {
        let response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets/{dataset}"),
        )
        .await?;
        let dataset_value = parse_bigquery_json(&response.body)?;
        payload["datasets"] = json!([bigquery_dataset_metadata_row(&dataset_value)]);
        payload["security"] = json!(bigquery_dataset_access_rows(&dataset_value));

        let table_response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/tables?maxResults=100"),
        )
        .await?;
        let table_value = parse_bigquery_json(&table_response.body)?;
        let tables = bigquery_table_rows_from_value(&table_value, Some(BIGQUERY_KIND_TABLE));
        let views = bigquery_table_rows_from_value(&table_value, Some(BIGQUERY_KIND_VIEW));
        let materialized_views =
            bigquery_table_rows_from_value(&table_value, Some(BIGQUERY_KIND_MATERIALIZED_VIEW));
        let external_tables =
            bigquery_table_rows_from_value(&table_value, Some(BIGQUERY_KIND_EXTERNAL));
        payload["tableCount"] = json!(tables.len());
        payload["viewCount"] = json!(views.len());
        payload["tables"] = json!(tables);
        payload["views"] = json!(views);
        payload["materializedViews"] = json!(materialized_views);
        payload["stages"] = json!(external_tables);
        payload["diagnostics"] = json!(vec![json!({
            "signal": "Dataset objects",
            "value": payload["tableCount"].clone(),
            "status": "ready",
            "guidance": "Live table metadata was loaded from BigQuery REST."
        })]);
    }

    Ok(())
}

fn bigquery_dataset_metadata_row(value: &Value) -> Value {
    json!({
        "name": value.pointer("/datasetReference/datasetId").and_then(Value::as_str).unwrap_or("-"),
        "location": value.get("location").and_then(Value::as_str).unwrap_or("-"),
        "tables": "-",
        "views": "-",
        "defaultTtl": value.get("defaultTableExpirationMs").and_then(Value::as_str).unwrap_or("-"),
        "owner": value.get("etag").and_then(Value::as_str).unwrap_or("-")
    })
}

fn bigquery_table_metadata_row(value: &Value) -> Value {
    let raw_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(BIGQUERY_KIND_TABLE);
    json!({
        "name": value.pointer("/tableReference/tableId").and_then(Value::as_str).unwrap_or("-"),
        "schema": value.pointer("/tableReference/datasetId").and_then(Value::as_str).unwrap_or("-"),
        "rows": value.get("numRows").and_then(Value::as_str).unwrap_or("-"),
        "size": value.get("numBytes").and_then(Value::as_str).map(human_bytes_from_str).unwrap_or_else(|| "-".into()),
        "partitioning": value.get("timePartitioning").map(|partition| partition.to_string()).unwrap_or_else(|| "-".into()),
        "clustering": value.get("clustering").map(|clustering| clustering.to_string()).unwrap_or_else(|| "-".into()),
        "freshness": value.get("lastModifiedTime").and_then(Value::as_str).unwrap_or("-"),
        "type": bigquery_table_kind(Some(raw_type))
    })
}

fn bigquery_columns_from_table_metadata(value: &Value) -> Vec<Value> {
    value
        .pointer("/schema/fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            Some(json!({
                "name": field.get("name").and_then(Value::as_str)?,
                "type": field.get("type").and_then(Value::as_str).unwrap_or("-"),
                "mode": field.get("mode").and_then(Value::as_str).unwrap_or("NULLABLE"),
                "nullable": field.get("mode").and_then(Value::as_str).unwrap_or("NULLABLE") != "REQUIRED",
                "description": field.get("description").and_then(Value::as_str).unwrap_or("-")
            }))
        })
        .collect()
}

fn bigquery_dataset_access_rows(value: &Value) -> Vec<Value> {
    value
        .get("access")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|entry| {
            json!({
                "principal": entry.get("userByEmail")
                    .or_else(|| entry.get("groupByEmail"))
                    .or_else(|| entry.get("domain"))
                    .or_else(|| entry.get("specialGroup"))
                    .and_then(Value::as_str)
                    .unwrap_or("authorized view or routine"),
                "role": entry.get("role").and_then(Value::as_str).unwrap_or("-"),
                "privilege": entry.get("role").and_then(Value::as_str).unwrap_or("-"),
                "object": value.pointer("/datasetReference/datasetId").and_then(Value::as_str).unwrap_or("-"),
                "effect": "allow"
            })
        })
        .collect()
}

fn bigquery_table_rows_from_value(value: &Value, table_type: Option<&str>) -> Vec<Value> {
    value
        .get("tables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|table| {
            let raw_type = table
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or(BIGQUERY_KIND_TABLE);
            if table_type.is_some_and(|expected| expected != raw_type) {
                return None;
            }

            Some(json!({
                "name": table.pointer("/tableReference/tableId").and_then(Value::as_str).unwrap_or("-"),
                "schema": table.pointer("/tableReference/datasetId").and_then(Value::as_str).unwrap_or("-"),
                "rows": "-",
                "size": "-",
                "partitioning": "-",
                "clustering": "-",
                "freshness": "-",
                "type": bigquery_table_kind(Some(raw_type))
            }))
        })
        .collect()
}

fn bigquery_table_diagnostics(value: &Value) -> Vec<Value> {
    vec![
        json!({
            "signal": "Rows",
            "value": value.get("numRows").and_then(Value::as_str).unwrap_or("-"),
            "status": "info",
            "guidance": "Use dry-run before broad reads from large tables."
        }),
        json!({
            "signal": "Storage",
            "value": value.get("numBytes").and_then(Value::as_str).map(human_bytes_from_str).unwrap_or_else(|| "-".into()),
            "status": "info",
            "guidance": "Partition and cluster broad analytical tables to reduce scanned bytes."
        }),
    ]
}

fn bigquery_dataset_from_node_id(node_id: &str) -> Option<String> {
    if let Some(dataset) = node_id.strip_prefix("bigquery-dataset:") {
        return Some(dataset.into());
    }
    for prefix in [
        "bigquery-tables:",
        "bigquery-views:",
        "bigquery-materialized-views:",
        "bigquery-external-tables:",
        "bigquery-routines:",
        "bigquery-models:",
        "bigquery-dataset-access:",
        "bigquery-dataset-statistics:",
    ] {
        if let Some(dataset) = node_id.strip_prefix(prefix) {
            return Some(dataset.into());
        }
    }
    bigquery_table_from_node_id(node_id).map(|(dataset, _)| dataset)
}

fn bigquery_table_from_node_id(node_id: &str) -> Option<(String, String)> {
    let rest = node_id.strip_prefix("bigquery-table:")?;
    let (dataset, table) = rest.split_once(':')?;
    Some((dataset.into(), table.into()))
}

fn bigquery_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "bigquery-datasets" {
        return "datasets";
    }
    if node_id == "bigquery-jobs" || node_id.starts_with("bigquery-jobs") {
        return "jobs";
    }
    if node_id.contains("reservation") {
        return "warehouses";
    }
    if node_id.contains("security") || node_id.contains("access") {
        return "security";
    }
    if node_id.contains("diagnostics") || node_id.contains("statistics") {
        return "diagnostics";
    }
    if node_id.contains("materialized-views") {
        return "materialized-views";
    }
    if node_id.contains("external-tables") {
        return "stages";
    }
    if node_id.contains("routines") {
        return "tasks";
    }
    if node_id.contains("models") {
        return "tasks";
    }
    if node_id.starts_with("bigquery-table:") {
        return "table";
    }
    if node_id.starts_with("bigquery-dataset:") {
        return "dataset";
    }
    if node_id.contains("views") {
        return "views";
    }
    if node_id.contains("tables") {
        return "tables";
    }

    "diagnostics"
}

fn bigquery_table_kind(raw_type: Option<&str>) -> &'static str {
    match raw_type {
        Some(BIGQUERY_KIND_VIEW) => "view",
        Some(BIGQUERY_KIND_MATERIALIZED_VIEW) => "materialized-view",
        Some(BIGQUERY_KIND_EXTERNAL) => "stage",
        _ => "table",
    }
}

fn bigquery_table_category(raw_type: &str) -> &'static str {
    match raw_type {
        BIGQUERY_KIND_VIEW => "Views",
        BIGQUERY_KIND_MATERIALIZED_VIEW => "Materialized Views",
        BIGQUERY_KIND_EXTERNAL => "External Tables",
        _ => "Tables",
    }
}

fn bigquery_table_detail(raw_type: &str) -> &'static str {
    match raw_type {
        BIGQUERY_KIND_VIEW => "BigQuery logical view",
        BIGQUERY_KIND_MATERIALIZED_VIEW => "BigQuery materialized view",
        BIGQUERY_KIND_EXTERNAL => "BigQuery external table",
        _ => "BigQuery native table",
    }
}

fn human_bytes_from_str(value: &str) -> String {
    value
        .parse::<u64>()
        .map(human_bytes)
        .unwrap_or_else(|_| value.into())
}

fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{bytes:.0} B")
    }
}

pub(crate) fn bigquery_table_query(project: &str, dataset: &str, table: &str) -> String {
    format!("select * from `{project}.{dataset}.{table}` limit 100")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        bigquery_base_payload, bigquery_dataset_nodes_from_value, bigquery_table_nodes_from_value,
        bigquery_table_query, dataset_child_sections, dataset_scope_nodes, root_nodes,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-bigquery".into(),
            name: "BigQuery".into(),
            engine: "bigquery".into(),
            family: "warehouse".into(),
            host: "project".into(),
            port: None,
            database: database.map(str::to_string),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        }
    }

    #[test]
    fn bigquery_table_query_quotes_fully_qualified_table() {
        assert_eq!(
            bigquery_table_query("project", "dataset", "orders"),
            "select * from `project.dataset.orders` limit 100"
        );
    }

    #[test]
    fn bigquery_dataset_nodes_read_rest_shape() {
        let connection = connection(Some("dataset"));
        let nodes = bigquery_dataset_nodes_from_value(
            &connection,
            &json!({
                "datasets": [{
                    "datasetReference": { "datasetId": "analytics" }
                }]
            }),
            Some(10),
        );

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].label, "analytics");
    }

    #[test]
    fn bigquery_root_uses_native_major_sections() {
        let connection = connection(Some("analytics"));
        let labels = root_nodes(&connection)
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec!["Datasets", "Jobs", "Reservations", "Access", "Diagnostics"]
        );
    }

    #[test]
    fn bigquery_dataset_children_are_native_sections_without_table_placeholder() {
        let connection = connection(Some("analytics"));
        let nodes = dataset_child_sections(&connection, "analytics");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Views"));
        assert!(labels.contains(&"Routines"));
        assert!(!labels.contains(&"table"));
        assert!(nodes
            .iter()
            .all(|node| node.detail != "Configured table placeholder"));
    }

    #[tokio::test]
    async fn bigquery_table_scope_without_live_auth_does_not_invent_table_leaf() {
        let connection = connection(Some("analytics"));
        let nodes =
            dataset_scope_nodes(&connection, "bigquery:dataset:analytics:tables", Some(100))
                .await
                .unwrap();

        assert!(nodes.is_empty());
    }

    #[test]
    fn bigquery_table_nodes_split_tables_and_views() {
        let connection = connection(Some("analytics"));
        let value = json!({
            "tables": [
                { "type": "TABLE", "tableReference": { "tableId": "orders" } },
                { "type": "VIEW", "tableReference": { "tableId": "orders_v" } },
                { "type": "MATERIALIZED_VIEW", "tableReference": { "tableId": "orders_mv" } }
            ]
        });

        let tables = bigquery_table_nodes_from_value(
            &connection,
            "project",
            "analytics",
            &value,
            Some("TABLE"),
            Some(100),
        );
        let views = bigquery_table_nodes_from_value(
            &connection,
            "project",
            "analytics",
            &value,
            Some("VIEW"),
            Some(100),
        );

        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].label, "orders");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].kind, "view");
    }

    #[test]
    fn bigquery_inspection_payload_is_view_friendly() {
        let connection = connection(Some("analytics"));
        let payload = bigquery_base_payload(&connection, "bigquery-dataset:analytics", "dataset");

        assert_eq!(payload["objectView"], "dataset");
        assert!(payload.get("api").is_none());
        assert!(payload["datasets"].is_array());
        assert!(payload["diagnostics"].is_array());
    }
}
