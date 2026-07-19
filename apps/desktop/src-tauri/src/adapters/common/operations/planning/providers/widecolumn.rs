use super::super::*;

pub(super) fn widecolumn_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    if manifest.engine == "dynamodb" {
        return dynamodb_operation_request(operation_id, object_name, parameters);
    }

    if manifest.engine == "cassandra" {
        return cassandra_operation_request(operation_id, object_name, parameters);
    }

    match manifest.default_language.as_str() {
        "cql" => format!("select * from {object_name} limit 100;"),
        _ => format!("{{\n  \"TableName\": \"{object_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\",\n  \"Parameters\": {parameter_json}\n}}"),
    }
}

fn dynamodb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let table_name = parameter("tableName")
        .and_then(Value::as_str)
        .unwrap_or(object_name);
    let index_name = parameter("indexName")
        .and_then(Value::as_str)
        .unwrap_or("<index>");
    let region = parameter("region")
        .and_then(Value::as_str)
        .unwrap_or("local");

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "CloudWatch.GetMetricData",
            "namespace": "AWS/DynamoDB",
            "region": region,
            "tableName": table_name,
            "metrics": [
                "ConsumedReadCapacityUnits",
                "ConsumedWriteCapacityUnits",
                "ReadThrottleEvents",
                "WriteThrottleEvents",
                "SuccessfulRequestLatency"
            ],
            "period": "5m",
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "requests": [
                { "operation": "DynamoDB.ListTables" },
                { "operation": "DynamoDB.DescribeLimits" },
                { "operation": "DynamoDB.DescribeTable", "tableName": table_name },
                { "operation": "DynamoDB.DescribeTimeToLive", "tableName": table_name },
                { "operation": "DynamoDB.DescribeContinuousBackups", "tableName": table_name },
                { "operation": "CloudWatch.GetMetricData", "namespace": "AWS/DynamoDB" }
            ],
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "IAM.SimulatePrincipalPolicy",
            "tableName": table_name,
            "resourceArn": format!("arn:aws:dynamodb:<region>:<account>:table/{table_name}"),
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "evaluation": "plan-only-with-disabled-reason",
            "actions": [
                "dynamodb:DescribeTable",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem"
            ],
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.create") {
        let partition_key = parameter("partitionKey")
            .and_then(Value::as_str)
            .unwrap_or("pk");
        let sort_key = parameter("sortKey").and_then(Value::as_str);
        let mut key_schema = vec![serde_json::json!({
            "attributeName": partition_key,
            "keyType": "HASH"
        })];
        if let Some(sort_key) = sort_key.filter(|value| !value.trim().is_empty()) {
            key_schema.push(serde_json::json!({
                "attributeName": sort_key,
                "keyType": "RANGE"
            }));
        }

        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "globalSecondaryIndexUpdates": [{
                "create": {
                    "indexName": index_name,
                    "keySchema": key_schema,
                    "projection": {
                        "projectionType": parameter("projection")
                            .and_then(Value::as_str)
                            .unwrap_or("ALL")
                    },
                    "billingMode": "matches-table"
                }
            }]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("index.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "globalSecondaryIndexUpdates": [{
                "delete": {
                    "indexName": index_name
                }
            }]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("capacity.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "billingMode": parameter("billingMode")
                .and_then(Value::as_str)
                .unwrap_or("PAY_PER_REQUEST"),
            "provisionedThroughput": {
                "readCapacityUnits": parameter("readCapacityUnits")
                    .and_then(Value::as_u64)
                    .unwrap_or(100),
                "writeCapacityUnits": parameter("writeCapacityUnits")
                    .and_then(Value::as_u64)
                    .unwrap_or(50)
            },
            "preflight": ["DescribeTable", "CheckAutoScalingPolicies", "EstimateCost"],
            "authEvidence": dynamodb_contract_auth_evidence(region)
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("ttl.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTimeToLive",
            "tableName": table_name,
            "timeToLiveSpecification": {
                "enabled": parameter("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                "attributeName": parameter("ttlAttribute")
                    .and_then(Value::as_str)
                    .unwrap_or("expiresAt")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("streams.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.UpdateTable",
            "tableName": table_name,
            "streamSpecification": {
                "streamEnabled": parameter("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                "streamViewType": parameter("streamViewType")
                    .and_then(Value::as_str)
                    .unwrap_or("NEW_AND_OLD_IMAGES")
            },
            "preflight": ["DescribeTable", "CheckLambdaEventSourceMappings"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("backup.create") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.CreateBackup",
            "tableName": table_name,
            "backupName": parameter("backupName")
                .and_then(Value::as_str)
                .unwrap_or("manual-backup"),
            "preflight": ["DescribeTable", "ListBackups"],
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("backup.restore") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.RestoreTableFromBackup",
            "sourceBackupArn": parameter("sourceBackupArn")
                .and_then(Value::as_str)
                .unwrap_or("<selected-backup-arn>"),
            "targetTableName": parameter("targetTableName")
                .and_then(Value::as_str)
                .unwrap_or("<restored-table>"),
            "validation": "restore-preview",
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": if mode == "import" { "DynamoDB.ImportTable" } else { "DynamoDB.ExportTableToPointInTime" },
            "tableName": table_name,
            "format": parameter("format")
                .and_then(Value::as_str)
                .unwrap_or("dynamodb-json"),
            "s3Bucket": parameter("s3Bucket")
                .and_then(Value::as_str)
                .unwrap_or("<selected-bucket>"),
            "s3Prefix": parameter("s3Prefix")
                .and_then(Value::as_str)
                .unwrap_or(table_name),
            "validation": if mode == "import" { "validate-before-write" } else { "point-in-time-export" },
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "DynamoDB.DeleteTable",
            "tableName": table_name,
            "preflight": ["DescribeTable", "ListBackups", "CheckDeletionProtection"],
            "authEvidence": dynamodb_contract_auth_evidence(region),
            "disabledReasons": dynamodb_cloud_disabled_reasons()
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{{\n  \"TableName\": \"{table_name}\",\n  \"Limit\": 100,\n  \"Operation\": \"{operation_id}\"\n}}")
}

fn dynamodb_contract_auth_evidence(region: &str) -> Value {
    let signing_region = if region.trim().is_empty() || region == "local" {
        "us-east-1"
    } else {
        region
    };

    serde_json::json!({
        "scheme": "AWS4-HMAC-SHA256",
        "service": "dynamodb",
        "connectMode": "connection-profile",
        "credentialsProvider": "connection-profile",
        "signingRegion": signing_region,
        "endpointMode": "local-http-or-aws-cloud-contract",
        "signedJsonHttp": true,
        "liveCloudRuntime": false,
        "signedHeaders": ["content-type", "host", "x-amz-date", "x-amz-target"],
        "credentialScope": format!("20260101/{signing_region}/dynamodb/aws4_request"),
        "credentialMaterial": "Secret values stay in the desktop secret/profile resolver."
    })
}

fn dynamodb_cloud_disabled_reasons() -> Vec<&'static str> {
    vec![
        "AWS profile, STS AssumeRole, web identity, ECS task, EC2 metadata, and static secret-key resolution are contract-mode in default CI.",
        "CloudWatch account/table metrics, IAM policy simulation, S3 export/import, and cloud backup validation stay preview-first without optional AWS credentials.",
    ]
}

fn cassandra_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let keyspace = parameter("keyspace")
        .and_then(Value::as_str)
        .or_else(|| cassandra_keyspace_from_object_name(object_name))
        .unwrap_or("app");
    let table_name = parameter("tableName")
        .and_then(Value::as_str)
        .or_else(|| cassandra_table_from_object_name(object_name))
        .unwrap_or("<table>");
    let index_name = parameter("indexName")
        .and_then(Value::as_str)
        .unwrap_or("<index>");
    let column_name = parameter("columnName")
        .and_then(Value::as_str)
        .unwrap_or("column_name");

    if operation_id.ends_with("query.profile") {
        return format!(
            "tracing on;\nselect * from \"{keyspace}\".\"{table_name}\" limit 100;\ntracing off;\nselect * from system_traces.sessions limit 20;\nselect * from system_traces.events limit 100;"
        );
    }

    if operation_id.ends_with("security.inspect") {
        return format!("list all permissions on keyspace \"{keyspace}\";\nlist roles;");
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return format!(
            "select * from system.local;\nselect * from system.peers;\nselect * from system_schema.tables where keyspace_name = '{}';\n-- Add nodetool/JMX-backed compaction, repair, and latency metrics when the adapter has live access.",
            keyspace.replace('\'', "''")
        );
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        let format = parameter("format").and_then(Value::as_str).unwrap_or("csv");
        let direction = if mode == "import" { "from" } else { "to" };
        let with_clause = if format.eq_ignore_ascii_case("json") {
            "with header = true and null = '<null>'"
        } else {
            "with header = true"
        };
        return format!(
            "-- Cassandra {mode} plan for {keyspace}.{table_name}.\n-- cqlsh COPY is contract-only here; use live execution only after driver/tooling validation.\ncopy \"{}\".\"{}\" {direction} '<selected-file>.{format}' {with_clause};",
            escape_double_quoted(keyspace),
            escape_double_quoted(table_name)
        );
    }

    if operation_id.ends_with("data.backup-restore") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("backup");
        let snapshot_name = parameter("snapshotName")
            .and_then(Value::as_str)
            .unwrap_or("datapad_snapshot");
        if mode == "restore" {
            return format!(
                "-- Cassandra restore plan for {keyspace}.{table_name}.\n-- Stop writes, clear target SSTables only after backup verification, then stream validated SSTables.\nsstableloader -d <contact-points> '<snapshot-dir>/{}.{}/{}';",
                escape_double_quoted(keyspace),
                escape_double_quoted(table_name),
                escape_single_quoted(snapshot_name)
            );
        }

        return format!(
            "-- Cassandra backup plan for {keyspace}.{table_name}.\nnodetool snapshot --tag {} --table \"{}\" \"{}\";\n-- Record schema with: describe table \"{}\".\"{}\";",
            escape_single_quoted(snapshot_name),
            escape_double_quoted(table_name),
            escape_double_quoted(keyspace),
            escape_double_quoted(keyspace),
            escape_double_quoted(table_name)
        );
    }

    if operation_id.ends_with("index.create") {
        return format!(
            "create custom index if not exists \"{index_name}\" on \"{keyspace}\".\"{table_name}\" (\"{column_name}\") using 'StorageAttachedIndex';"
        );
    }

    if operation_id.ends_with("index.drop") {
        return format!("drop index if exists \"{keyspace}\".\"{index_name}\";");
    }

    if operation_id.ends_with("object.drop") {
        return format!(
            "-- Review dependencies before running.\ndrop {} if exists {object_name};",
            cassandra_object_kind(parameter("objectKind").and_then(Value::as_str))
        );
    }

    format!("select * from \"{keyspace}\".\"{table_name}\" limit 100;")
}

fn cassandra_keyspace_from_object_name(object_name: &str) -> Option<&str> {
    let mut parts = object_name.trim_matches('"').split("\".\"");
    let keyspace = parts.next()?;
    parts.next().map(|_| keyspace)
}

fn cassandra_table_from_object_name(object_name: &str) -> Option<&str> {
    object_name.trim_matches('"').split("\".\"").nth(1)
}

fn cassandra_object_kind(kind: Option<&str>) -> &'static str {
    match kind.unwrap_or_default().replace('-', " ").as_str() {
        "materialized view" => "materialized view",
        "type" => "type",
        "function" => "function",
        "aggregate" => "aggregate",
        _ => "table",
    }
}
