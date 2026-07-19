use super::super::*;

pub(super) fn cosmosdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let database = string_parameter(parameters, "database").unwrap_or_else(|| "<database>".into());
    let container = string_parameter(parameters, "container")
        .or_else(|| string_parameter(parameters, "collection"))
        .unwrap_or_else(|| "<container>".into());
    let object_kind =
        string_parameter(parameters, "objectKind").unwrap_or_else(|| "container".into());

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": format!("/dbs/{database}/colls/{container}/docs"),
            "headers": {
                "x-ms-documentdb-isquery": true,
                "x-ms-documentdb-populatequerymetrics": true
            },
            "body": {
                "query": string_parameter(parameters, "query").unwrap_or_else(|| "select * from c where c.id != null".into()),
                "parameters": []
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "AzureMonitor.ListMetrics",
            "scope": object_name,
            "metrics": [
                "TotalRequestUnits",
                "NormalizedRUConsumption",
                "ThrottledRequests",
                "ServerSideLatency",
                "DataUsage"
            ],
            "granularity": "PT5M"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ReadAccessModel",
            "scope": object_name,
            "checks": [
                "sqlRoleDefinitions",
                "sqlRoleAssignments",
                "networkAclBypass",
                "publicNetworkAccess"
            ]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PATCH",
            "path": format!("/dbs/{database}/colls/{container}"),
            "body": {
                "indexingPolicy": {
                    "indexingMode": "consistent",
                    "automatic": true,
                    "includedPaths": [{ "path": string_parameter(parameters, "path").unwrap_or_else(|| "/*".into()) }],
                    "excludedPaths": [{ "path": "/\"_etag\"/?" }]
                },
                "validation": "replace-policy-after-diff-preview"
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("throughput.update") {
        let mode = string_parameter(parameters, "mode").unwrap_or_else(|| "autoscale".into());
        let scope = if object_kind == "database" {
            format!("/dbs/{database}")
        } else {
            format!("/dbs/{database}/colls/{container}")
        };
        let throughput_parameters = if mode == "autoscale" {
            serde_json::json!({
                "autoscaleSettings": {
                    "maxThroughput": numeric_parameter(parameters, "maxRuPerSecond").unwrap_or(4000)
                }
            })
        } else {
            serde_json::json!({
                "throughput": numeric_parameter(parameters, "ruPerSecond").unwrap_or(1000)
            })
        };

        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ReplaceOffer",
            "scope": scope,
            "throughputParameters": throughput_parameters,
            "preflight": ["ReadOffer", "EstimateMonthlyCost", "CheckThrottledRequests"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("consistency.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.UpdateAccountConsistency",
            "account": string_parameter(parameters, "account").unwrap_or_else(|| "<account>".into()),
            "consistencyPolicy": {
                "defaultConsistencyLevel": string_parameter(parameters, "consistencyLevel").unwrap_or_else(|| "Session".into())
            },
            "preflight": ["ReadAccount", "CheckMultiRegionWrites"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("regions.failover") {
        let write_region =
            string_parameter(parameters, "writeRegion").unwrap_or_else(|| "<write-region>".into());
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.FailoverPriorityChange",
            "account": string_parameter(parameters, "account").unwrap_or_else(|| "<account>".into()),
            "writeRegion": write_region,
            "failoverPolicies": [{
                "locationName": write_region,
                "failoverPriority": 0
            }],
            "preflight": ["ReadAccount", "CheckRegionalAvailability", "ConfirmApplicationImpact"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CosmosDB.ExportItems",
            "database": database,
            "container": container,
            "format": string_parameter(parameters, "format").unwrap_or_else(|| "json".into()),
            "mode": string_parameter(parameters, "mode").unwrap_or_else(|| "export".into()),
            "partitionKey": string_parameter(parameters, "partitionKey").unwrap_or_else(|| "<all-partitions>".into()),
            "consistency": "session"
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": cosmosdb_drop_path(&object_kind, &database, &container),
            "preflight": ["read-throughput", "check-change-feed-lag", "verify-rbac-scope"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    serde_json::to_string_pretty(&serde_json::json!({
        "operation": operation_id,
        "database": database,
        "container": container
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn cosmosdb_drop_path(object_kind: &str, database: &str, container: &str) -> String {
    if object_kind == "database" {
        return format!("/dbs/{database}");
    }

    if matches!(object_kind, "stored-procedures" | "triggers" | "udfs") {
        return format!("/dbs/{database}/colls/{container}/{object_kind}/<script-id>");
    }

    format!("/dbs/{database}/colls/{container}")
}
