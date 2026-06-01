use serde_json::{json, Map, Value};
use sqlx::{
    postgres::{PgPool, PgRow},
    Column, Row,
};

use super::super::super::*;
use super::normalizers::*;

pub(super) async fn cockroach_live_payload(kind: &str, pool: &PgPool) -> Result<Value, String> {
    match kind {
        "jobs" => jobs_payload(pool).await,
        "security" => security_payload(pool).await,
        "grants" => grants_payload(pool).await,
        "regions" | "localities" => regions_payload(pool).await,
        "ranges" => ranges_payload(pool).await,
        "sessions" => sessions_payload(pool).await,
        "contention" | "locks" | "statements" | "transactions" => activity_payload(pool).await,
        "cluster" | "nodes" | "cluster-settings" => cluster_payload(pool).await,
        "zone-configurations" => zone_configuration_payload(pool).await,
        "certificates" => certificates_payload(pool).await,
        "statistics" => statistics_payload(pool).await,
        _ => Ok(json!({})),
    }
}

async fn jobs_payload(pool: &PgPool) -> Result<Value, String> {
    let jobs = normalize_jobs(query_records(pool, "show jobs", 100).await?);
    Ok(json!({ "jobs": jobs }))
}

async fn security_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let roles =
        normalize_roles(optional_records(pool, "show roles", 200, "roles", &mut warnings).await);
    let grants =
        normalize_grants(optional_records(pool, "show grants", 200, "grants", &mut warnings).await);
    let default_privileges = normalize_grants(
        optional_records(
            pool,
            "show default privileges",
            200,
            "default privileges",
            &mut warnings,
        )
        .await,
    );

    Ok(json!({
        "roles": roles,
        "grants": grants,
        "permissions": grants,
        "defaultPrivileges": default_privileges,
        "warnings": warnings,
    }))
}

async fn grants_payload(pool: &PgPool) -> Result<Value, String> {
    let grants = normalize_grants(query_records(pool, "show default privileges", 200).await?);
    Ok(json!({ "grants": grants, "permissions": grants }))
}

async fn regions_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let regions = normalize_regions(
        optional_records(pool, "show regions", 100, "regions", &mut warnings).await,
    );
    let nodes = normalize_nodes(
        optional_records(
            pool,
            "select * from crdb_internal.gossip_nodes limit 100",
            100,
            "node localities",
            &mut warnings,
        )
        .await,
    );
    let node_count = nodes.len();
    let region_count = regions.len();

    Ok(json!({
        "regions": regions,
        "nodes": nodes,
        "nodeCount": node_count,
        "regionCount": region_count,
        "warnings": warnings,
    }))
}

async fn ranges_payload(pool: &PgPool) -> Result<Value, String> {
    let ranges = normalize_ranges(
        query_records(
            pool,
            "select * from crdb_internal.ranges_no_leases limit 100",
            100,
        )
        .await?,
    );
    let range_count = ranges.len();

    Ok(json!({ "ranges": ranges, "rangeCount": range_count }))
}

async fn sessions_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let sessions = normalize_sessions(
        optional_records(pool, "show sessions", 100, "sessions", &mut warnings).await,
    );
    let transactions = normalize_transactions(
        optional_records(
            pool,
            "select * from crdb_internal.cluster_transactions limit 100",
            100,
            "transactions",
            &mut warnings,
        )
        .await,
    );
    let active_sessions = sessions.len();

    Ok(json!({
        "sessions": sessions,
        "transactions": transactions,
        "activeSessions": active_sessions,
        "warnings": warnings,
    }))
}

async fn activity_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let locks = normalize_locks(
        optional_records(
            pool,
            "select * from crdb_internal.cluster_locks limit 100",
            100,
            "locks",
            &mut warnings,
        )
        .await,
    );
    let contention = normalize_contention(
        optional_records(
            pool,
            "select * from crdb_internal.cluster_contention_events limit 100",
            100,
            "contention",
            &mut warnings,
        )
        .await,
    );
    let statements = normalize_statements(
        optional_records(
            pool,
            "select * from crdb_internal.node_statement_statistics limit 100",
            100,
            "statement stats",
            &mut warnings,
        )
        .await,
    );
    let transactions = normalize_transactions(
        optional_records(
            pool,
            "select * from crdb_internal.cluster_transactions limit 100",
            100,
            "transactions",
            &mut warnings,
        )
        .await,
    );
    let blocked_sessions = locks
        .iter()
        .filter(|row| !field_truthy(row, "granted"))
        .count();

    Ok(json!({
        "locks": locks,
        "contention": contention,
        "statements": statements,
        "transactions": transactions,
        "blockedSessions": blocked_sessions,
        "warnings": warnings,
    }))
}

async fn cluster_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let nodes = normalize_nodes(
        optional_records(
            pool,
            "select * from crdb_internal.gossip_nodes limit 100",
            100,
            "nodes",
            &mut warnings,
        )
        .await,
    );
    let settings = normalize_settings(
        optional_records(
            pool,
            "show cluster settings",
            200,
            "cluster settings",
            &mut warnings,
        )
        .await,
    );
    let regions = normalize_regions(
        optional_records(pool, "show regions", 100, "regions", &mut warnings).await,
    );
    let node_count = nodes.len();
    let region_count = regions.len();

    Ok(json!({
        "nodes": nodes,
        "clusterSettings": settings,
        "regions": regions,
        "nodeCount": node_count,
        "regionCount": region_count,
        "warnings": warnings,
    }))
}

async fn zone_configuration_payload(pool: &PgPool) -> Result<Value, String> {
    let zones =
        normalize_zone_configurations(query_records(pool, "show zone configurations", 200).await?);
    Ok(json!({ "zoneConfigurations": zones }))
}

async fn certificates_payload(pool: &PgPool) -> Result<Value, String> {
    let certificates = normalize_certificates(
        query_records(
            pool,
            "select * from crdb_internal.cluster_certificates limit 100",
            100,
        )
        .await?,
    );
    Ok(json!({ "certificates": certificates }))
}

async fn statistics_payload(pool: &PgPool) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let statistics = normalize_statistics(
        optional_records(
            pool,
            "select * from crdb_internal.table_spans limit 100",
            100,
            "table spans",
            &mut warnings,
        )
        .await,
    );
    let statements = normalize_statements(
        optional_records(
            pool,
            "select * from crdb_internal.node_statement_statistics limit 100",
            100,
            "statement stats",
            &mut warnings,
        )
        .await,
    );

    Ok(json!({
        "statistics": statistics,
        "statements": statements,
        "warnings": warnings,
    }))
}

async fn optional_records(
    pool: &PgPool,
    query: &str,
    limit: usize,
    label: &str,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match query_records(pool, query, limit).await {
        Ok(records) => records,
        Err(error) => {
            warnings.push(format!("{label} metadata is unavailable: {error}"));
            Vec::new()
        }
    }
}

async fn query_records(pool: &PgPool, query: &str, limit: usize) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|error| compact_error(&error.to_string()))?;

    Ok(rows
        .into_iter()
        .take(limit)
        .map(|row| record_from_row(&row))
        .collect())
}

fn record_from_row(row: &PgRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let name = column.name();
        let value = stringify_pg_cell(row, index);
        object.insert(name.to_string(), json!(value));
        let camel = camel_case_column(name);
        if camel != name {
            object.entry(camel).or_insert_with(|| json!(value));
        }
    }
    Value::Object(object)
}

fn camel_case_column(name: &str) -> String {
    let mut result = String::new();
    let mut upper_next = false;
    for character in name.chars() {
        if character == '_' || character == ' ' || character == '-' {
            upper_next = true;
        } else if upper_next {
            result.extend(character.to_uppercase());
            upper_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

fn compact_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}
