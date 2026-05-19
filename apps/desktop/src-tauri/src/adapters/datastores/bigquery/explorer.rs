use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::bigquery_execution_capabilities;
use super::connection::{
    bigquery_dataset_id, bigquery_get, bigquery_project_id, has_http_endpoint, has_live_auth,
    parse_bigquery_json,
};

pub(super) async fn list_bigquery_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("bigquery:datasets") => dataset_nodes(connection, request.limit).await?,
        Some(scope) if scope.starts_with("bigquery:dataset:") => {
            table_nodes(connection, scope, request.limit).await?
        }
        Some("bigquery:jobs") => job_template_nodes(connection),
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

pub(super) fn inspect_bigquery_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let project = bigquery_project_id(connection);
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
            _ => "select 1".into(),
        });

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "BigQuery query template ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(json!({
            "engine": "bigquery",
            "nodeId": request.node_id,
            "project": project,
            "api": ["/bigquery/v2/projects/{project}/datasets", "/queries"]
        })),
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let project = bigquery_project_id(connection);
    [
        (
            "bigquery-datasets",
            "Datasets",
            "datasets",
            "Datasets, tables, views, and routines",
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

    let dataset = bigquery_dataset_id(connection);
    Ok(vec![ExplorerNode {
        id: format!("bigquery-dataset:{dataset}"),
        family: "warehouse".into(),
        label: dataset.clone(),
        kind: "dataset".into(),
        detail: "Configured dataset placeholder".into(),
        scope: Some(format!("bigquery:dataset:{dataset}")),
        path: Some(vec![connection.name.clone(), "Datasets".into()]),
        query_template: Some(format!("select * from `{dataset}.table` limit 100")),
        expandable: Some(true),
    }])
}

async fn table_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let dataset = scope.trim_start_matches("bigquery:dataset:");
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let project = bigquery_project_id(connection);
        let response = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets/{dataset}/tables?maxResults=100"),
        )
        .await?;
        let value = parse_bigquery_json(&response.body)?;
        return Ok(bigquery_table_nodes_from_value(
            connection, &project, dataset, &value, limit,
        ));
    }

    let project = bigquery_project_id(connection);
    Ok(vec![ExplorerNode {
        id: format!("bigquery-table:{dataset}:table"),
        family: "warehouse".into(),
        label: "table".into(),
        kind: "table".into(),
        detail: "Configured table placeholder".into(),
        scope: None,
        path: Some(vec![
            connection.name.clone(),
            dataset.into(),
            "Tables".into(),
        ]),
        query_template: Some(bigquery_table_query(&project, dataset, "table")),
        expandable: Some(false),
    }])
}

fn job_template_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "bigquery-jobs-by-project".into(),
        family: "warehouse".into(),
        label: "Jobs By Project".into(),
        kind: "query-template".into(),
        detail: "INFORMATION_SCHEMA job history query".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Jobs".into()]),
        query_template: Some(
            "select * from region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT limit 100".into(),
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
            detail: "BigQuery dataset".into(),
            scope: Some(format!("bigquery:dataset:{dataset}")),
            path: Some(vec![connection.name.clone(), "Datasets".into()]),
            query_template: Some(format!("select * from `{dataset}.table` limit 100")),
            expandable: Some(true),
        })
        .collect()
}

fn bigquery_table_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    project: &str,
    dataset: &str,
    value: &Value,
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
            table
                .pointer("/tableReference/tableId")
                .and_then(Value::as_str)
        })
        .map(|table| ExplorerNode {
            id: format!("bigquery-table:{dataset}:{table}"),
            family: "warehouse".into(),
            label: table.into(),
            kind: "table".into(),
            detail: "BigQuery table or view".into(),
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                dataset.into(),
                "Tables".into(),
            ]),
            query_template: Some(bigquery_table_query(project, dataset, table)),
            expandable: Some(false),
        })
        .collect()
}

pub(crate) fn bigquery_table_query(project: &str, dataset: &str, table: &str) -> String {
    format!("select * from `{project}.{dataset}.{table}` limit 100")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{bigquery_dataset_nodes_from_value, bigquery_table_query};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn bigquery_table_query_quotes_fully_qualified_table() {
        assert_eq!(
            bigquery_table_query("project", "dataset", "orders"),
            "select * from `project.dataset.orders` limit 100"
        );
    }

    #[test]
    fn bigquery_dataset_nodes_read_rest_shape() {
        let connection = ResolvedConnectionProfile {
            id: "conn-bigquery".into(),
            name: "BigQuery".into(),
            engine: "bigquery".into(),
            family: "warehouse".into(),
            host: "project".into(),
            port: None,
            database: Some("dataset".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        };
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
}
