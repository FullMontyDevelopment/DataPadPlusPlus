use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::cosmosdb_execution_capabilities;
use super::connection::{cosmosdb_default_database, cosmosdb_get, parse_cosmosdb_json};

pub(super) async fn list_cosmosdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("cosmos:account") => account_child_nodes(connection),
        Some("cosmos:databases") | Some("cosmosdb:databases") => {
            database_nodes(connection, request.limit).await?
        }
        Some(scope) if scope.starts_with("cosmos:database:") => {
            database_child_nodes(connection, scope.trim_start_matches("cosmos:database:"))
        }
        Some(scope) if scope.starts_with("cosmosdb:database:") => {
            database_child_nodes(connection, scope.trim_start_matches("cosmosdb:database:"))
        }
        Some(scope) if scope.starts_with("cosmos:containers:") => {
            container_nodes(
                connection,
                scope.trim_start_matches("cosmos:containers:"),
                request.limit,
            )
            .await?
        }
        Some(scope) if scope.starts_with("cosmos:container:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            container_child_nodes(connection, &database, &container)
        }
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Cosmos DB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: cosmosdb_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_cosmosdb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = cosmosdb_inspect_query_template(connection, &request.node_id);
    let payload = cosmosdb_inspect_payload(connection, &request.node_id).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Cosmos DB metadata view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let mut nodes = vec![cosmos_node(
        "cosmos:account",
        &account,
        "account",
        "Cosmos DB account overview",
        Some("cosmos:account"),
        true,
        None,
        vec![account.clone()],
    )];
    nodes.extend(account_child_nodes(connection));
    nodes
}

fn account_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    [
        (
            "cosmos:databases",
            "Databases",
            "databases",
            "Cosmos DB databases",
            Some("cosmos:databases"),
            true,
            Some(json!({ "operation": "ListDatabases" }).to_string()),
        ),
        (
            "cosmos:regions",
            "Regions",
            "regions",
            "Read and write regions",
            Some("cosmos:regions"),
            false,
            None,
        ),
        (
            "cosmos:consistency",
            "Consistency",
            "consistency",
            "Default consistency and session behavior",
            Some("cosmos:consistency"),
            false,
            None,
        ),
        (
            "cosmos:security",
            "Security",
            "security",
            "RBAC, keys, networking, and access posture",
            Some("cosmos:security"),
            false,
            None,
        ),
        (
            "cosmos:diagnostics",
            "Diagnostics",
            "diagnostics",
            "RU, throttles, latency, and storage signals",
            Some("cosmos:diagnostics"),
            false,
            None,
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, expandable, query)| {
        cosmos_node(
            id,
            label,
            kind,
            detail,
            scope,
            expandable,
            query,
            vec![account.clone()],
        )
    })
    .collect()
}

async fn database_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let response = cosmosdb_get(connection, "/dbs").await?;
    let value = parse_cosmosdb_json(&response.body)?;
    Ok(database_nodes_from_value(connection, &value, limit))
}

fn database_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("Databases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(|database| {
            cosmos_node(
                &format!("cosmos:database:{database}"),
                database,
                "database",
                "Cosmos DB database",
                Some(&format!("cosmos:database:{database}")),
                true,
                Some(json!({ "operation": "ListContainers", "database": database }).to_string()),
                vec![account.clone(), "Databases".into()],
            )
        })
        .collect()
}

fn database_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let path = vec![account, "Databases".into(), database.into()];
    [
        (
            format!("cosmos:containers:{database}"),
            "Containers",
            "containers",
            "Container inventory and partitioning",
            Some(format!("cosmos:containers:{database}")),
            true,
            Some(json!({ "operation": "ListContainers", "database": database }).to_string()),
        ),
        (
            format!("cosmos:throughput:{database}"),
            "Throughput",
            "throughput",
            "Shared database throughput where configured",
            Some(format!("cosmos:throughput:{database}")),
            false,
            None,
        ),
        (
            format!("cosmos:security:{database}"),
            "Security",
            "security",
            "Database users, roles, and access posture",
            Some(format!("cosmos:security:{database}")),
            false,
            None,
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, expandable, query)| {
        cosmos_node(
            &id,
            label,
            kind,
            detail,
            scope.as_deref(),
            expandable,
            query,
            path.clone(),
        )
    })
    .collect()
}

async fn container_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let response = cosmosdb_get(connection, &format!("/dbs/{database}/colls")).await?;
    let value = parse_cosmosdb_json(&response.body)?;
    Ok(container_nodes_from_value(
        connection, database, &value, limit,
    ))
}

fn container_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    database: &str,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("DocumentCollections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|container| (container, item))
        })
        .map(|(container, item)| {
            let partition_key = container_partition_key(item);
            let indexing_mode = item
                .pointer("/indexingPolicy/indexingMode")
                .and_then(Value::as_str)
                .unwrap_or("consistent");
            cosmos_node(
                &format!("cosmos:container:{database}:{container}"),
                container,
                "container",
                &format!("{partition_key} | {indexing_mode} indexing"),
                Some(&format!("cosmos:container:{database}:{container}")),
                true,
                Some(query_documents_template(database, container)),
                vec![
                    account.clone(),
                    "Databases".into(),
                    database.into(),
                    "Containers".into(),
                ],
            )
        })
        .collect()
}

fn container_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let path = vec![
        account,
        "Databases".into(),
        database.into(),
        "Containers".into(),
        container.into(),
    ];
    [
        (
            format!("cosmos:items:{database}:{container}"),
            "Items",
            "items",
            "Open a bounded item query",
            Some(format!("cosmos:items:{database}:{container}")),
            false,
            Some(query_documents_template(database, container)),
        ),
        (
            format!("cosmos:partition-key:{database}:{container}"),
            "Partition Key",
            "partition-key",
            "Partition path, routing, and hot key hints",
            Some(format!("cosmos:partition-key:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:indexing-policy:{database}:{container}"),
            "Indexing Policy",
            "indexing-policy",
            "Included, excluded, composite, and spatial paths",
            Some(format!("cosmos:indexing-policy:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:throughput:{database}:{container}"),
            "Throughput",
            "throughput",
            "Manual or autoscale RU/s and throttles",
            Some(format!("cosmos:throughput:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:change-feed:{database}:{container}"),
            "Change Feed",
            "change-feed",
            "Change feed processor readiness",
            Some(format!("cosmos:change-feed:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:stored-procedures:{database}:{container}"),
            "Stored Procedures",
            "stored-procedures",
            "Server-side JavaScript stored procedures",
            Some(format!("cosmos:stored-procedures:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:triggers:{database}:{container}"),
            "Triggers",
            "triggers",
            "Pre and post triggers",
            Some(format!("cosmos:triggers:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:udfs:{database}:{container}"),
            "User Defined Functions",
            "udfs",
            "Server-side JavaScript UDFs",
            Some(format!("cosmos:udfs:{database}:{container}")),
            false,
            None,
        ),
        (
            format!("cosmos:conflicts:{database}:{container}"),
            "Conflict Feed",
            "conflicts",
            "Multi-region conflict metadata",
            Some(format!("cosmos:conflicts:{database}:{container}")),
            false,
            None,
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, expandable, query)| {
        cosmos_node(
            &id,
            label,
            kind,
            detail,
            scope.as_deref(),
            expandable,
            query,
            path.clone(),
        )
    })
    .collect()
}

fn cosmos_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    query_template: Option<String>,
    path: Vec<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "document".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

fn cosmosdb_inspect_query_template(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> String {
    if node_id.starts_with("cosmos:container:") || node_id.starts_with("cosmos:items:") {
        let (database, container) = cosmosdb_scope_parts(connection, node_id);
        return query_documents_template(&database, &container);
    }

    if node_id == "cosmos:databases" || node_id == "cosmosdb-databases" {
        return json!({ "operation": "ListDatabases" }).to_string();
    }

    if node_id.starts_with("cosmos:database:") || node_id.starts_with("cosmos:containers:") {
        let database = node_id.split(':').next_back().unwrap_or("database");
        return json!({ "operation": "ListContainers", "database": database }).to_string();
    }

    json!({
        "operation": "InspectMetadata",
        "target": node_id
    })
    .to_string()
}

async fn cosmosdb_inspect_payload(connection: &ResolvedConnectionProfile, node_id: &str) -> Value {
    let object_view = cosmosdb_object_view(node_id);
    let (database, container) = cosmosdb_scope_parts(connection, node_id);
    let mut payload = json!({
        "engine": "cosmosdb",
        "accountName": cosmosdb_account_name(connection),
        "api": "NoSQL",
        "objectView": object_view,
        "database": database,
        "container": container,
        "warnings": [
            "Throughput, indexing, and delete operations are guarded operation previews."
        ]
    });

    match object_view {
        "account" | "databases" => {
            merge_cosmosdb_payload(&mut payload, account_payload(connection).await);
        }
        "database" | "containers" => {
            merge_cosmosdb_payload(&mut payload, database_payload(connection, &database).await);
        }
        "container" | "items" | "partition-key" | "indexing-policy" | "throughput"
        | "change-feed" | "stored-procedures" | "triggers" | "udfs" | "conflicts" => {
            merge_cosmosdb_payload(
                &mut payload,
                container_payload(connection, &database, &container, object_view).await,
            );
        }
        "security" => {
            merge_cosmosdb_payload(&mut payload, security_payload());
        }
        "diagnostics" => {
            merge_cosmosdb_payload(&mut payload, diagnostics_payload(connection).await);
        }
        _ => {}
    }

    payload
}

async fn account_payload(connection: &ResolvedConnectionProfile) -> Value {
    let databases = optional_cosmosdb_json(connection, "/dbs")
        .await
        .map(|value| database_records(&value))
        .unwrap_or_default();
    let throughput = offer_records(connection, None).await;

    json!({
        "databaseCount": databases.len(),
        "databases": databases,
        "throughput": throughput,
        "diagnostics": account_diagnostics(connection).await,
    })
}

async fn database_payload(connection: &ResolvedConnectionProfile, database: &str) -> Value {
    let containers = optional_cosmosdb_json(connection, &format!("/dbs/{database}/colls"))
        .await
        .map(|value| container_records(&value))
        .unwrap_or_default();
    let throughput = offer_records(connection, None).await;

    json!({
        "database": database,
        "containerCount": containers.len(),
        "containers": containers,
        "throughput": throughput,
    })
}

async fn container_payload(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
    object_view: &str,
) -> Value {
    let container_value =
        optional_cosmosdb_json(connection, &format!("/dbs/{database}/colls/{container}"))
            .await
            .unwrap_or_else(|| json!({ "id": container }));
    let partition_keys = partition_key_records(&container_value);
    let indexing_policy = indexing_policy_records(&container_value);
    let containers = container_record(&container_value)
        .into_iter()
        .collect::<Vec<_>>();
    let scripts = script_records(connection, database, container).await;
    let conflicts = conflict_records(connection, database, container).await;
    let diagnostics = if object_view == "conflicts" {
        conflicts.clone()
    } else {
        container_diagnostics(&container_value)
    };

    json!({
        "database": database,
        "container": container,
        "containerCount": containers.len(),
        "containers": containers,
        "partitionKeys": partition_keys,
        "indexingPolicy": indexing_policy,
        "throughput": offer_records(connection, container_value.get("_rid").and_then(Value::as_str)).await,
        "scripts": scripts,
        "diagnostics": diagnostics,
        "security": Vec::<Value>::new(),
        "conflicts": conflicts,
    })
}

async fn diagnostics_payload(connection: &ResolvedConnectionProfile) -> Value {
    json!({
        "diagnostics": account_diagnostics(connection).await,
        "throughput": offer_records(connection, None).await,
    })
}

fn security_payload() -> Value {
    json!({
        "security": Vec::<Value>::new(),
        "warnings": [
            "Cosmos DB SQL API security metadata is usually managed through Azure RBAC, keys, private endpoints, or account settings and may not be visible through this connection."
        ]
    })
}

async fn optional_cosmosdb_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = cosmosdb_get(connection, path).await.ok()?;
    parse_cosmosdb_json(&response.body).ok()
}

fn database_records(value: &Value) -> Vec<Value> {
    value
        .get("Databases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(|name| {
            json!({
                "name": name,
                "containers": "",
                "throughput": "",
                "storage": "",
            })
        })
        .collect()
}

fn container_records(value: &Value) -> Vec<Value> {
    value
        .get("DocumentCollections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(container_record)
        .collect()
}

fn container_record(value: &Value) -> Option<Value> {
    let name = value.get("id").and_then(Value::as_str)?;
    Some(json!({
        "name": name,
        "partitionKey": container_partition_key(value),
        "throughput": "",
        "items": "",
        "ttl": value.get("defaultTtl").map(value_to_string).unwrap_or_default(),
    }))
}

fn partition_key_records(container: &Value) -> Vec<Value> {
    container
        .pointer("/partitionKey/paths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|path| {
            json!({
                "path": path,
                "kind": container.pointer("/partitionKey/kind").and_then(Value::as_str).unwrap_or("Hash"),
                "hotPartitionRisk": "",
                "guidance": "Use this path in point reads and high-cardinality filters.",
            })
        })
        .collect()
}

fn indexing_policy_records(container: &Value) -> Vec<Value> {
    let mode = container
        .pointer("/indexingPolicy/indexingMode")
        .and_then(Value::as_str)
        .unwrap_or("consistent");
    let mut rows = Vec::new();

    rows.extend(indexing_path_records(
        container,
        "/indexingPolicy/includedPaths",
        mode,
        "included",
    ));
    rows.extend(indexing_path_records(
        container,
        "/indexingPolicy/excludedPaths",
        mode,
        "excluded",
    ));
    rows.extend(composite_index_records(container, mode));
    rows
}

fn indexing_path_records(container: &Value, pointer: &str, mode: &str, kind: &str) -> Vec<Value> {
    container
        .pointer(pointer)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| {
            json!({
                "path": item.get("path").and_then(Value::as_str).unwrap_or(""),
                "mode": mode,
                "kind": kind,
                "precision": item.get("indexes").and_then(Value::as_array).map(|indexes| indexes.len()).unwrap_or_default(),
            })
        })
        .collect()
}

fn composite_index_records(container: &Value, mode: &str) -> Vec<Value> {
    container
        .pointer("/indexingPolicy/compositeIndexes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, item)| {
            let path = item
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.get("path").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(", ");
            json!({
                "path": if path.is_empty() { format!("composite #{index}") } else { path },
                "mode": mode,
                "kind": "composite",
                "precision": "",
            })
        })
        .collect()
}

async fn offer_records(
    connection: &ResolvedConnectionProfile,
    resource_id: Option<&str>,
) -> Vec<Value> {
    optional_cosmosdb_json(connection, "/offers")
        .await
        .map(|value| offer_records_from_value(&value, resource_id))
        .unwrap_or_default()
}

fn offer_records_from_value(value: &Value, resource_id: Option<&str>) -> Vec<Value> {
    value
        .get("Offers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|offer| {
            resource_id
                .map(|id| offer.get("offerResourceId").and_then(Value::as_str) == Some(id))
                .unwrap_or(true)
        })
        .map(|offer| {
            let throughput = offer
                .pointer("/content/offerThroughput")
                .or_else(|| offer.pointer("/content/offerAutopilotSettings/maxThroughput"))
                .cloned()
                .unwrap_or(Value::Null);
            let mode = if offer
                .pointer("/content/offerAutopilotSettings/maxThroughput")
                .is_some()
            {
                "autoscale"
            } else {
                "manual"
            };
            json!({
                "scope": offer.get("offerResourceId").and_then(Value::as_str).unwrap_or("resource"),
                "mode": mode,
                "ruPerSecond": throughput,
                "throttles": "",
            })
        })
        .collect()
}

async fn script_records(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Vec<Value> {
    let mut rows = Vec::new();
    rows.extend(
        named_script_records(
            connection,
            &format!("/dbs/{database}/colls/{container}/sprocs"),
            "StoredProcedures",
            "stored procedure",
        )
        .await,
    );
    rows.extend(
        named_script_records(
            connection,
            &format!("/dbs/{database}/colls/{container}/triggers"),
            "Triggers",
            "trigger",
        )
        .await,
    );
    rows.extend(
        named_script_records(
            connection,
            &format!("/dbs/{database}/colls/{container}/udfs"),
            "UserDefinedFunctions",
            "udf",
        )
        .await,
    );
    rows
}

async fn named_script_records(
    connection: &ResolvedConnectionProfile,
    path: &str,
    array_key: &str,
    script_type: &str,
) -> Vec<Value> {
    optional_cosmosdb_json(connection, path)
        .await
        .and_then(|value| value.get(array_key).and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let name = item.get("id").and_then(Value::as_str)?.to_string();
            Some((name, item))
        })
        .map(|(name, item)| {
            json!({
                "type": script_type,
                "name": name,
                "operation": item.get("triggerOperation").and_then(Value::as_str).unwrap_or(""),
                "status": "visible",
            })
        })
        .collect()
}

async fn conflict_records(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Vec<Value> {
    optional_cosmosdb_json(
        connection,
        &format!("/dbs/{database}/colls/{container}/conflicts"),
    )
    .await
    .and_then(|value| value.get("Conflicts").and_then(Value::as_array).cloned())
    .unwrap_or_default()
    .into_iter()
    .map(|item| {
        json!({
            "signal": item.get("id").and_then(Value::as_str).unwrap_or("conflict"),
            "value": item.get("operationType").map(value_to_string).unwrap_or_default(),
            "status": item.get("resourceType").and_then(Value::as_str).unwrap_or("conflict"),
            "guidance": "Review conflict resolution before applying writes.",
        })
    })
    .collect()
}

async fn account_diagnostics(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    let database_count = optional_cosmosdb_json(connection, "/dbs")
        .await
        .map(|value| database_records(&value).len())
        .unwrap_or_default();
    let offer_count = optional_cosmosdb_json(connection, "/offers")
        .await
        .and_then(|value| value.get("Offers").and_then(Value::as_array).map(Vec::len))
        .unwrap_or_default();

    vec![
        json!({
            "signal": "Databases",
            "value": database_count,
            "status": "visible",
            "guidance": "Visible through the SQL API account metadata endpoint.",
        }),
        json!({
            "signal": "Throughput offers",
            "value": offer_count,
            "status": if offer_count > 0 { "visible" } else { "not visible" },
            "guidance": "Offer metadata may require additional permissions.",
        }),
    ]
}

fn container_diagnostics(container: &Value) -> Vec<Value> {
    vec![
        json!({
            "signal": "Indexing mode",
            "value": container.pointer("/indexingPolicy/indexingMode").and_then(Value::as_str).unwrap_or(""),
            "status": "configured",
            "guidance": "Consistent indexing gives predictable query behavior at RU cost.",
        }),
        json!({
            "signal": "Default TTL",
            "value": container.get("defaultTtl").map(value_to_string).unwrap_or_default(),
            "status": if container.get("defaultTtl").is_some() { "configured" } else { "not configured" },
            "guidance": "TTL deletes are automatic and should match retention expectations.",
        }),
    ]
}

fn merge_cosmosdb_payload(target: &mut Value, addition: Value) {
    let Some(target) = target.as_object_mut() else {
        return;
    };
    let Some(addition) = addition.as_object() else {
        return;
    };
    for (key, value) in addition {
        target.insert(key.clone(), value.clone());
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn cosmosdb_object_view(node_id: &str) -> &'static str {
    if node_id == "cosmos:account" {
        return "account";
    }
    if node_id == "cosmos:databases" {
        return "databases";
    }
    if node_id.starts_with("cosmos:database:") {
        return "database";
    }
    if node_id.starts_with("cosmos:containers:") {
        return "containers";
    }
    if node_id.starts_with("cosmos:container:") {
        return "container";
    }
    if node_id.starts_with("cosmos:items:") {
        return "items";
    }
    if node_id.starts_with("cosmos:partition-key:") {
        return "partition-key";
    }
    if node_id.starts_with("cosmos:indexing-policy:") {
        return "indexing-policy";
    }
    if node_id.starts_with("cosmos:throughput:") {
        return "throughput";
    }
    if node_id.starts_with("cosmos:change-feed:") {
        return "change-feed";
    }
    if node_id.starts_with("cosmos:stored-procedures:") {
        return "stored-procedures";
    }
    if node_id.starts_with("cosmos:triggers:") {
        return "triggers";
    }
    if node_id.starts_with("cosmos:udfs:") {
        return "udfs";
    }
    if node_id.starts_with("cosmos:conflicts:") {
        return "conflicts";
    }
    if node_id == "cosmos:regions" {
        return "regions";
    }
    if node_id == "cosmos:consistency" {
        return "consistency";
    }
    if node_id.starts_with("cosmos:security") {
        return "security";
    }
    "diagnostics"
}

fn query_documents_template(database: &str, container: &str) -> String {
    json!({
        "operation": "QueryDocuments",
        "database": database,
        "container": container,
        "query": "SELECT * FROM c",
        "limit": 20
    })
    .to_string()
}

fn container_partition_key(item: &Value) -> String {
    item.pointer("/partitionKey/paths/0")
        .and_then(Value::as_str)
        .unwrap_or("/id")
        .to_string()
}

fn cosmosdb_account_name(connection: &ResolvedConnectionProfile) -> String {
    let host_name = connection
        .host
        .split('.')
        .next()
        .filter(|value| !value.trim().is_empty());

    host_name.unwrap_or(&connection.name).to_string()
}

fn cosmosdb_scope_parts(connection: &ResolvedConnectionProfile, scope: &str) -> (String, String) {
    let parts = scope.split(':').collect::<Vec<_>>();
    let fallback_database = cosmosdb_default_database(connection);
    let Some(kind) = parts.get(1).copied() else {
        return (fallback_database, String::new());
    };

    match kind {
        "database" | "containers" | "throughput" | "security" => (
            parts
                .get(2)
                .filter(|value| !value.trim().is_empty())
                .copied()
                .map(str::to_string)
                .unwrap_or(fallback_database),
            parts
                .get(3)
                .copied()
                .map(str::to_string)
                .unwrap_or_default(),
        ),
        "container" | "items" | "partition-key" | "indexing-policy" | "change-feed"
        | "stored-procedures" | "triggers" | "udfs" | "conflicts" => (
            parts
                .get(2)
                .filter(|value| !value.trim().is_empty())
                .copied()
                .map(str::to_string)
                .unwrap_or_else(|| fallback_database.clone()),
            parts
                .get(3)
                .copied()
                .map(str::to_string)
                .unwrap_or_default(),
        ),
        _ => (fallback_database, String::new()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        container_child_nodes, container_nodes_from_value, container_record,
        database_nodes_from_value, indexing_policy_records, inspect_cosmosdb_explorer_node,
        offer_records_from_value, partition_key_records, query_documents_template, root_nodes,
    };
    use crate::domain::models::{ExplorerInspectRequest, ResolvedConnectionProfile};

    #[test]
    fn cosmosdb_query_template_targets_database_and_container() {
        let value: serde_json::Value =
            serde_json::from_str(&query_documents_template("app", "orders")).unwrap();
        assert_eq!(value["operation"], "QueryDocuments");
        assert_eq!(value["database"], "app");
        assert_eq!(value["container"], "orders");
        assert_eq!(value["limit"], 20);
    }

    #[test]
    fn cosmosdb_root_uses_account_and_native_sections() {
        let connection = connection();
        let nodes = root_nodes(&connection);
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"datapad-cosmos"));
        assert!(labels.contains(&"Databases"));
        assert!(labels.contains(&"Regions"));
        assert!(labels.contains(&"Consistency"));
        assert!(labels.contains(&"Security"));
        assert!(labels.contains(&"Diagnostics"));
        assert!(!labels.contains(&"Collections"));
    }

    #[test]
    fn cosmosdb_database_and_container_nodes_use_new_scopes() {
        let connection = connection();
        let database_nodes = database_nodes_from_value(
            &connection,
            &json!({ "Databases": [{ "id": "catalog" }] }),
            Some(10),
        );
        let container_nodes = container_nodes_from_value(
            &connection,
            "catalog",
            &json!({
                "DocumentCollections": [{
                    "id": "products",
                    "partitionKey": { "paths": ["/tenantId"] },
                    "indexingPolicy": { "indexingMode": "consistent" }
                }]
            }),
            Some(10),
        );

        assert_eq!(database_nodes[0].id, "cosmos:database:catalog");
        assert_eq!(
            database_nodes[0].scope.as_deref(),
            Some("cosmos:database:catalog")
        );
        assert_eq!(container_nodes[0].id, "cosmos:container:catalog:products");
        assert_eq!(container_nodes[0].detail, "/tenantId | consistent indexing");
    }

    #[test]
    fn cosmosdb_container_scope_returns_purpose_built_children() {
        let connection = connection();
        let nodes = container_child_nodes(&connection, "catalog", "products");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Items"));
        assert!(labels.contains(&"Partition Key"));
        assert!(labels.contains(&"Indexing Policy"));
        assert!(labels.contains(&"Stored Procedures"));
        assert!(labels.contains(&"Conflict Feed"));
    }

    #[tokio::test]
    async fn cosmosdb_inspection_payload_is_view_friendly() {
        let connection = connection();
        let response = inspect_cosmosdb_explorer_node(
            &connection,
            &ExplorerInspectRequest {
                connection_id: connection.id.clone(),
                environment_id: "env-local".into(),
                node_id: "cosmos:security:catalog".into(),
            },
        )
        .await
        .expect("inspection response");
        let payload = response.payload.expect("payload");

        assert_eq!(payload["objectView"], "security");
        assert_eq!(payload["database"], "catalog");
        assert_eq!(payload["container"], "");
        assert!(payload.get("raw").is_none());
        assert!(payload["security"].as_array().is_some());
    }

    #[test]
    fn cosmosdb_container_metadata_normalizes_partition_key_and_indexing_policy() {
        let container = json!({
            "id": "products",
            "_rid": "abc",
            "defaultTtl": 3600,
            "partitionKey": { "paths": ["/tenantId"], "kind": "Hash" },
            "indexingPolicy": {
                "indexingMode": "consistent",
                "includedPaths": [{ "path": "/*", "indexes": [{ "kind": "Range" }] }],
                "excludedPaths": [{ "path": "/largeBlob/?" }],
                "compositeIndexes": [[
                    { "path": "/tenantId", "order": "ascending" },
                    { "path": "/createdAt", "order": "descending" }
                ]]
            }
        });
        let container_rows = container_record(&container).expect("container row");
        let partition_rows = partition_key_records(&container);
        let indexing_rows = indexing_policy_records(&container);

        assert_eq!(container_rows["name"], "products");
        assert_eq!(container_rows["partitionKey"], "/tenantId");
        assert_eq!(container_rows["ttl"], "3600");
        assert_eq!(partition_rows[0]["path"], "/tenantId");
        assert_eq!(indexing_rows.len(), 3);
        assert_eq!(indexing_rows[0]["kind"], "included");
        assert_eq!(indexing_rows[1]["kind"], "excluded");
        assert_eq!(indexing_rows[2]["kind"], "composite");
    }

    #[test]
    fn cosmosdb_offer_records_extract_manual_and_autoscale_throughput() {
        let offers = json!({
            "Offers": [
                { "offerResourceId": "manual", "content": { "offerThroughput": 400 } },
                { "offerResourceId": "auto", "content": { "offerAutopilotSettings": { "maxThroughput": 4000 } } }
            ]
        });
        let rows = offer_records_from_value(&offers, None);

        assert_eq!(rows[0]["mode"], "manual");
        assert_eq!(rows[0]["ruPerSecond"], 400);
        assert_eq!(rows[1]["mode"], "autoscale");
        assert_eq!(rows[1]["ruPerSecond"], 4000);
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cosmos".into(),
            name: "Cosmos DB".into(),
            engine: "cosmosdb".into(),
            family: "document".into(),
            host: "datapad-cosmos.documents.azure.com".into(),
            port: None,
            database: Some("catalog".into()),
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
}
