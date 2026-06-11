use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{dynamodb_auth_evidence_payload, dynamodb_call};

pub(super) async fn collect_dynamodb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let tables = optional_dynamodb_call(connection, "ListTables", &json!({})).await;
    let limits = optional_dynamodb_call(connection, "DescribeLimits", &json!({})).await;
    let auth_evidence = dynamodb_auth_evidence_payload(connection);

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "dynamodb.api.reachable",
            "value": if tables.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "ListTables" }
        },
        {
            "name": "dynamodb.tables.count",
            "value": table_count(tables.as_ref()),
            "unit": "tables",
            "labels": { "source": "ListTables" }
        },
        {
            "name": "dynamodb.account.max_read_capacity_units",
            "value": account_capacity_limit(limits.as_ref(), "AccountMaxReadCapacityUnits"),
            "unit": "capacity-units",
            "labels": { "source": "DescribeLimits", "evidence": if limits.is_some() { "live-or-local" } else { "unavailable" } }
        },
        {
            "name": "dynamodb.account.max_write_capacity_units",
            "value": account_capacity_limit(limits.as_ref(), "AccountMaxWriteCapacityUnits"),
            "unit": "capacity-units",
            "labels": { "source": "DescribeLimits", "evidence": if limits.is_some() { "live-or-local" } else { "unavailable" } }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "DynamoDB SigV4, IAM, and capacity diagnostics evidence.",
        json!({
            "authEvidence": auth_evidence,
            "capacityEvidence": {
                "listTables": evidence_status(tables.as_ref()),
                "describeLimits": evidence_status(limits.as_ref()),
                "returnConsumedCapacity": "requested by Query, Scan, GetItem, ExecuteStatement, and item-edit requests",
                "cloudWatch": {
                    "operation": "CloudWatch.GetMetricData",
                    "namespace": "AWS/DynamoDB",
                    "executionSupport": "plan-only",
                    "disabledReason": "CloudWatch account/table metrics require live AWS credentials outside default CI."
                }
            },
            "requestPlan": dynamodb_diagnostics_request_plan(scope),
        }),
    ));
    diagnostics.cost_estimates.push(payload_cost_estimate(json!({
        "engine": "dynamodb",
        "basis": "ConsumedCapacity is requested on item and read operations; account limits come from DescribeLimits when the endpoint supports it.",
        "liveCosting": false,
        "cloudCosting": {
            "operation": "CloudWatch.GetMetricData",
            "status": "plan-only",
            "disabledReason": "CloudWatch billing/capacity correlation is not run without optional AWS credentials."
        }
    })));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "dynamodb",
        "authEvidence": auth_evidence,
        "templates": [
            { "operation": "ListTables" },
            { "operation": "DescribeLimits" },
            { "operation": "DescribeTable", "tableName": "TableName" },
            { "operation": "DescribeTimeToLive", "tableName": "TableName" },
            { "operation": "DescribeContinuousBackups", "tableName": "TableName" },
            { "operation": "Query", "tableName": "TableName", "keyConditionExpression": "#pk = :pk" },
            { "operation": "Scan", "tableName": "TableName", "limit": 100 }
        ],
        "tables": tables,
        "limits": limits,
    })));
    diagnostics.warnings.push(
        "DynamoDB Scan can consume significant capacity; use key-condition Query, limits, and ReturnConsumedCapacity before dashboarding."
            .into(),
    );
    diagnostics.warnings.push(
        "DynamoDB CloudWatch, IAM policy simulation, S3 import/export, and managed backup validation remain preview-first unless optional AWS credentials are configured."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_dynamodb_call(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    body: &Value,
) -> Option<Value> {
    dynamodb_call(connection, operation, body).await.ok()
}

pub(crate) fn table_count(value: Option<&Value>) -> usize {
    value
        .and_then(|value| value.get("TableNames"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default()
}

pub(crate) fn account_capacity_limit(value: Option<&Value>, field: &str) -> u64 {
    value
        .and_then(|value| value.get(field))
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn evidence_status(value: Option<&Value>) -> &'static str {
    if value.is_some() {
        "available"
    } else {
        "unavailable"
    }
}

fn dynamodb_diagnostics_request_plan(scope: Option<&str>) -> Value {
    let table_name = scope
        .and_then(|scope| scope.strip_prefix("table:").or(Some(scope)))
        .filter(|scope| !scope.starts_with("dynamodb:"))
        .unwrap_or("TableName");

    json!([
        { "operation": "DynamoDB.ListTables", "evidence": "live-local-or-cloud" },
        { "operation": "DynamoDB.DescribeLimits", "evidence": "live-local-or-cloud-if-supported" },
        { "operation": "DynamoDB.DescribeTable", "tableName": table_name, "evidence": "live-local-or-cloud" },
        { "operation": "DynamoDB.DescribeTimeToLive", "tableName": table_name, "evidence": "live-local-or-cloud-if-supported" },
        { "operation": "DynamoDB.DescribeContinuousBackups", "tableName": table_name, "evidence": "cloud-or-local-if-supported" },
        { "operation": "CloudWatch.GetMetricData", "namespace": "AWS/DynamoDB", "evidence": "plan-only-with-disabled-reason" },
        { "operation": "IAM.SimulatePrincipalPolicy", "evidence": "plan-only-with-disabled-reason" }
    ])
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/diagnostics_tests.rs"]
mod tests;
