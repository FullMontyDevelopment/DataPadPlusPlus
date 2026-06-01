use serde_json::{json, Map, Value};

pub(super) fn normalize_jobs(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "id": pick(&object, &["job_id", "jobId", "id"]),
                "type": pick(&object, &["job_type", "jobType", "type"]),
                "status": pick(&object, &["status"]),
                "fraction": pick(&object, &["fraction_completed", "fractionCompleted", "fraction"]),
                "user": pick(&object, &["user_name", "userName", "user"]),
                "description": pick(&object, &["description", "statement"]),
                "created": pick(&object, &["created", "created_time", "createdTime"]),
                "finished": pick(&object, &["finished", "finished_time", "finishedTime"]),
                "error": pick(&object, &["error", "error_message", "errorMessage"]),
            })
        })
        .collect()
}

pub(super) fn normalize_roles(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "name": pick(&object, &["role_name", "roleName", "name", "rolname"]),
                "login": pick(&object, &["can_login", "canLogin", "login", "rolcanlogin"]),
                "superuser": pick(&object, &["is_superuser", "isSuperuser", "superuser", "rolsuper"]),
                "memberships": pick(&object, &["member_of", "memberOf", "memberships"]),
                "options": pick(&object, &["options"]),
            })
        })
        .collect()
}

pub(super) fn normalize_grants(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let database = pick(&object, &["database_name", "databaseName", "database"]);
            let schema = pick(&object, &["schema_name", "schemaName", "schema"]);
            let object_name = pick(&object, &["object_name", "objectName", "object"]);
            json!({
                "principal": pick(&object, &["grantee", "role_name", "roleName", "principal"]),
                "privilege": pick(&object, &["privilege_type", "privilegeType", "privilege"]),
                "object": qualified_name(&[database, schema, object_name]),
                "state": pick(&object, &["is_grantable", "isGrantable", "state"]),
                "grantor": pick(&object, &["grantor"]),
            })
        })
        .collect()
}

pub(super) fn normalize_regions(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "region": pick(&object, &["region", "region_name", "regionName", "primary_region", "primaryRegion"]),
                "survivalGoal": pick(&object, &["survival_goal", "survivalGoal"]),
                "constraints": pick(&object, &["constraints", "zone_constraints", "zoneConstraints"]),
                "database": pick(&object, &["database", "database_name", "databaseName"]),
            })
        })
        .collect()
}

pub(super) fn normalize_nodes(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "nodeId": pick(&object, &["node_id", "nodeId", "id"]),
                "address": pick(&object, &["address", "host", "sql_address", "sqlAddress"]),
                "locality": pick(&object, &["locality"]),
                "status": pick(&object, &["is_live", "isLive", "liveness", "status"]),
                "ranges": pick(&object, &["ranges", "range_count", "rangeCount"]),
            })
        })
        .collect()
}

pub(super) fn normalize_ranges(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let database = pick(&object, &["database_name", "databaseName", "database"]);
            let schema = pick(&object, &["schema_name", "schemaName", "schema"]);
            let table = pick(&object, &["table_name", "tableName", "table"]);
            json!({
                "rangeId": pick(&object, &["range_id", "rangeId", "id"]),
                "table": qualified_name(&[database, schema, table]),
                "index": pick(&object, &["index_name", "indexName", "index"]),
                "replicas": pick(&object, &["replicas", "replica_localities", "replicaLocalities"]),
                "leaseholder": pick(&object, &["lease_holder", "leaseHolder", "leaseholder"]),
                "qps": pick(&object, &["queries_per_second", "queriesPerSecond", "qps"]),
                "size": pick(&object, &["range_size_mb", "rangeSizeMb", "size"]),
            })
        })
        .collect()
}

pub(super) fn normalize_sessions(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let active_queries = pick(&object, &["active_queries", "activeQueries"]);
            json!({
                "sessionId": pick(&object, &["session_id", "sessionId", "id"]),
                "user": pick(&object, &["user_name", "userName", "user"]),
                "database": pick(&object, &["database_name", "databaseName", "database"]),
                "state": if active_queries.is_empty() { pick(&object, &["state"]) } else { format!("{active_queries} active") },
                "client": pick(&object, &["client_address", "clientAddress", "client"]),
                "application": pick(&object, &["application_name", "applicationName", "application"]),
            })
        })
        .collect()
}

pub(super) fn normalize_transactions(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "transactionId": pick(&object, &["txn_id", "txnId", "transaction_id", "transactionId", "id"]),
                "user": pick(&object, &["user_name", "userName", "user"]),
                "state": pick(&object, &["state", "status"]),
                "age": pick(&object, &["age", "duration", "duration_ms", "durationMs"]),
                "priority": pick(&object, &["priority"]),
            })
        })
        .collect()
}

pub(super) fn normalize_locks(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "sessionId": pick(&object, &["session_id", "sessionId", "transaction_id", "transactionId"]),
                "object": pick(&object, &["table_name", "tableName", "object", "key"]),
                "mode": pick(&object, &["mode", "strength"]),
                "granted": pick(&object, &["granted", "is_granted", "isGranted"]),
                "blocking": pick(&object, &["blocking", "wait_policy", "waitPolicy"]),
            })
        })
        .collect()
}

pub(super) fn normalize_contention(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "table": pick(&object, &["table_name", "tableName", "object", "key"]),
                "durationMs": pick(&object, &["duration_ms", "durationMs", "contention_duration", "contentionDuration"]),
                "blockingTxn": pick(&object, &["blocking_txn_id", "blockingTxnId", "blocking_transaction", "blockingTransaction"]),
                "waitingTxn": pick(&object, &["waiting_txn_id", "waitingTxnId", "waiting_transaction", "waitingTransaction"]),
            })
        })
        .collect()
}

pub(super) fn normalize_statements(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "query": pick(&object, &["query", "statement", "fingerprint", "metadata"]),
                "meanMs": pick(&object, &["mean_ms", "meanMs", "mean_service_latency", "meanServiceLatency"]),
                "retries": pick(&object, &["retries", "retry_count", "retryCount"]),
                "rows": pick(&object, &["rows", "rows_read", "rowsRead", "rowsWritten"]),
            })
        })
        .collect()
}

pub(super) fn normalize_settings(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "name": pick(&object, &["variable", "name", "setting"]),
                "value": pick(&object, &["value"]),
                "type": pick(&object, &["type"]),
                "public": pick(&object, &["public"]),
            })
        })
        .collect()
}

pub(super) fn normalize_zone_configurations(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "target": pick(&object, &["target", "zone_name", "zoneName", "object"]),
                "numReplicas": pick(&object, &["num_replicas", "numReplicas"]),
                "constraints": pick(&object, &["constraints"]),
                "leasePreferences": pick(&object, &["lease_preferences", "leasePreferences"]),
                "gcTtl": pick(&object, &["gc_ttl_seconds", "gcTtlSeconds", "gcTtl"]),
            })
        })
        .collect()
}

pub(super) fn normalize_certificates(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "nodeId": pick(&object, &["node_id", "nodeId"]),
                "type": pick(&object, &["type", "usage"]),
                "subject": pick(&object, &["subject", "common_name", "commonName"]),
                "validFrom": pick(&object, &["valid_from", "validFrom", "not_before", "notBefore"]),
                "validUntil": pick(&object, &["valid_until", "validUntil", "not_after", "notAfter"]),
            })
        })
        .collect()
}

pub(super) fn normalize_statistics(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let database = pick(&object, &["database_name", "databaseName", "database"]);
            let schema = pick(&object, &["schema_name", "schemaName", "schema"]);
            let table = pick(&object, &["table_name", "tableName", "table"]);
            json!({
                "name": qualified_name(&[database, schema, table]),
                "rows": pick(&object, &["estimated_row_count", "estimatedRowCount", "rows"]),
                "ranges": pick(&object, &["range_count", "rangeCount", "ranges"]),
                "size": pick(&object, &["size", "bytes", "range_size_mb", "rangeSizeMb"]),
            })
        })
        .collect()
}

pub(super) fn field_truthy(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value.to_lowercase().as_str(), "true" | "yes" | "1"))
}

fn pick(object: &Map<String, Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() && value != "<VOID>" {
                return value.to_string();
            }
        }
    }
    String::new()
}

fn qualified_name(parts: &[String]) -> String {
    parts
        .iter()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cockroach_record_normalizers_produce_view_friendly_fields() {
        let jobs = normalize_jobs(vec![json!({
            "job_id": "1",
            "job_type": "SCHEMA CHANGE",
            "status": "running",
            "fraction_completed": "0.5"
        })]);
        assert_eq!(jobs[0]["type"], "SCHEMA CHANGE");

        let grants = normalize_grants(vec![json!({
            "database_name": "defaultdb",
            "schema_name": "public",
            "object_name": "accounts",
            "grantee": "app",
            "privilege_type": "SELECT"
        })]);
        assert_eq!(grants[0]["principal"], "app");
        assert_eq!(grants[0]["object"], "defaultdb.public.accounts");
    }
}
