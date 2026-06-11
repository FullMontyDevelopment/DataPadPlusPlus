use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::cosmosdb_execution_capabilities;
use super::connection::{cosmosdb_default_database, cosmosdb_get, parse_cosmosdb_json};

pub(super) async fn list_cosmosdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let api = cosmosdb_api(connection);
    if api != "nosql" {
        return Ok(ExplorerResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            scope: request.scope.clone(),
            summary: format!(
                "Loaded Cosmos DB {} API explorer nodes for {}.",
                cosmosdb_api_label(&api),
                connection.name
            ),
            capabilities: cosmosdb_execution_capabilities(),
            nodes: cosmosdb_api_nodes(connection, request.scope.as_deref(), &api),
        });
    }

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
        Some(scope) if scope.starts_with("cosmos:stored-procedures:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            script_child_nodes(
                connection,
                &database,
                &container,
                CosmosScriptBranch::stored_procedures(),
            )
            .await
        }
        Some(scope) if scope.starts_with("cosmos:triggers:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            script_child_nodes(
                connection,
                &database,
                &container,
                CosmosScriptBranch::triggers(),
            )
            .await
        }
        Some(scope) if scope.starts_with("cosmos:udfs:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            script_child_nodes(
                connection,
                &database,
                &container,
                CosmosScriptBranch::udfs(),
            )
            .await
        }
        Some(scope) if scope.starts_with("cosmos:conflicts:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            conflict_child_nodes(connection, &database, &container).await
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

fn cosmosdb_api_nodes(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
    api: &str,
) -> Vec<ExplorerNode> {
    match scope {
        Some("cosmos:account") | None => cosmosdb_api_root_nodes(connection, api),
        Some("cosmos:databases") | Some("cosmosdb:databases") => {
            cosmosdb_api_database_nodes(connection, api)
        }
        Some(scope) if scope.starts_with("cosmos:database:") => cosmosdb_api_database_child_nodes(
            connection,
            scope.trim_start_matches("cosmos:database:"),
            api,
        ),
        Some(scope) if scope.starts_with("cosmosdb:database:") => {
            cosmosdb_api_database_child_nodes(
                connection,
                scope.trim_start_matches("cosmosdb:database:"),
                api,
            )
        }
        Some(scope) if scope.starts_with("cosmos:containers:") => {
            let database = scope.trim_start_matches("cosmos:containers:");
            cosmosdb_api_object_nodes(connection, database, api)
        }
        Some(scope) if scope.starts_with("cosmos:container:") => {
            let (database, container) = cosmosdb_scope_parts(connection, scope);
            cosmosdb_api_object_child_nodes(connection, &database, &container, api)
        }
        Some(_) => Vec::new(),
    }
}

fn cosmosdb_api_root_nodes(connection: &ResolvedConnectionProfile, api: &str) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let label = cosmosdb_api_label(api);
    let object_label = cosmosdb_api_object_collection_label(api);
    vec![
        cosmos_node(
            "cosmos:account",
            &account,
            "account",
            &format!("Cosmos DB {label} API account overview"),
            Some("cosmos:account"),
            true,
            None,
            vec![account.clone()],
        ),
        cosmos_node(
            "cosmos:databases",
            cosmosdb_api_database_root_label(api),
            "databases",
            &format!("{label} API databases and {object_label}"),
            Some("cosmos:databases"),
            true,
            Some(json!({ "operation": "InspectApiDatabases", "api": api }).to_string()),
            vec![account.clone()],
        ),
        cosmos_node(
            "cosmos:regions",
            "Regions",
            "regions",
            "Read and write regions",
            Some("cosmos:regions"),
            false,
            None,
            vec![account.clone()],
        ),
        cosmos_node(
            "cosmos:security",
            "Security",
            "security",
            "Identity, keys, networking, and RBAC posture",
            Some("cosmos:security"),
            false,
            None,
            vec![account.clone()],
        ),
        cosmos_node(
            "cosmos:diagnostics",
            "Diagnostics",
            "diagnostics",
            "RU, latency, regional health, and capability signals",
            Some("cosmos:diagnostics"),
            false,
            None,
            vec![account],
        ),
    ]
}

fn cosmosdb_api_database_nodes(
    connection: &ResolvedConnectionProfile,
    api: &str,
) -> Vec<ExplorerNode> {
    let database = cosmosdb_default_database(connection);
    let account = cosmosdb_account_name(connection);
    vec![cosmos_node(
        &format!("cosmos:database:{database}"),
        &database,
        "database",
        &format!("Configured {} API database", cosmosdb_api_label(api)),
        Some(&format!("cosmos:database:{database}")),
        true,
        Some(
            json!({ "operation": "InspectApiDatabase", "api": api, "database": database })
                .to_string(),
        ),
        vec![account, cosmosdb_api_database_root_label(api).into()],
    )]
}

fn cosmosdb_api_database_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    api: &str,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let path = vec![
        account,
        cosmosdb_api_database_root_label(api).into(),
        database.into(),
    ];
    vec![
        cosmos_node(
            &format!("cosmos:containers:{database}"),
            cosmosdb_api_object_collection_label(api),
            cosmosdb_api_object_collection_kind(api),
            cosmosdb_api_object_collection_detail(api),
            Some(&format!("cosmos:containers:{database}")),
            true,
            Some(
                json!({ "operation": "InspectApiObjects", "api": api, "database": database })
                    .to_string(),
            ),
            path.clone(),
        ),
        cosmos_node(
            &format!("cosmos:throughput:{database}"),
            "Throughput",
            "throughput",
            "Database or account-level RU/s where visible",
            Some(&format!("cosmos:throughput:{database}")),
            false,
            None,
            path.clone(),
        ),
        cosmos_node(
            &format!("cosmos:security:{database}"),
            "Security",
            "security",
            "Database-level RBAC and access posture",
            Some(&format!("cosmos:security:{database}")),
            false,
            None,
            path,
        ),
    ]
}

fn cosmosdb_api_object_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    api: &str,
) -> Vec<ExplorerNode> {
    let configured = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.container_prefix.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(object_name) = configured else {
        return Vec::new();
    };
    let account = cosmosdb_account_name(connection);
    let path = vec![
        account,
        cosmosdb_api_database_root_label(api).into(),
        database.into(),
        cosmosdb_api_object_collection_label(api).into(),
    ];
    vec![cosmos_node(
        &format!("cosmos:container:{database}:{object_name}"),
        object_name,
        cosmosdb_api_object_kind(api),
        cosmosdb_api_object_detail(api),
        Some(&format!("cosmos:container:{database}:{object_name}")),
        true,
        Some(json!({ "operation": "InspectApiObject", "api": api, "database": database, "object": object_name }).to_string()),
        path,
    )]
}

fn cosmosdb_api_object_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    object_name: &str,
    api: &str,
) -> Vec<ExplorerNode> {
    let account = cosmosdb_account_name(connection);
    let path = vec![
        account,
        cosmosdb_api_database_root_label(api).into(),
        database.into(),
        cosmosdb_api_object_collection_label(api).into(),
        object_name.into(),
    ];

    cosmosdb_api_object_child_specs(api)
        .into_iter()
        .map(|(suffix, label, kind, detail)| {
            cosmos_node(
                &format!("cosmos:{suffix}:{database}:{object_name}"),
                label,
                kind,
                detail,
                Some(&format!("cosmos:{suffix}:{database}:{object_name}")),
                false,
                Some(
                    json!({
                        "operation": "InspectApiObject",
                        "api": api,
                        "database": database,
                        "object": object_name,
                        "section": suffix
                    })
                    .to_string(),
                ),
                path.clone(),
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
            true,
            None,
        ),
        (
            format!("cosmos:triggers:{database}:{container}"),
            "Triggers",
            "triggers",
            "Pre and post triggers",
            Some(format!("cosmos:triggers:{database}:{container}")),
            true,
            None,
        ),
        (
            format!("cosmos:udfs:{database}:{container}"),
            "User Defined Functions",
            "udfs",
            "Server-side JavaScript UDFs",
            Some(format!("cosmos:udfs:{database}:{container}")),
            true,
            None,
        ),
        (
            format!("cosmos:conflicts:{database}:{container}"),
            "Conflict Feed",
            "conflicts",
            "Multi-region conflict metadata",
            Some(format!("cosmos:conflicts:{database}:{container}")),
            true,
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

async fn script_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
    branch: CosmosScriptBranch,
) -> Vec<ExplorerNode> {
    named_script_values(
        connection,
        &format!("/dbs/{database}/colls/{container}/{}", branch.path_segment),
        branch.array_key,
    )
    .await
    .into_iter()
    .filter_map(|item| {
        let name = item.get("id").and_then(Value::as_str)?.to_string();
        Some(cosmos_node(
            &format!(
                "cosmos:{}:{database}:{container}:{name}",
                branch.node_prefix
            ),
            &name,
            branch.node_kind,
            branch.detail,
            Some(&format!(
                "cosmos:{}:{database}:{container}:{name}",
                branch.node_prefix
            )),
            false,
            None,
            cosmos_container_branch_path(connection, database, container, branch.label),
        ))
    })
    .collect()
}

async fn conflict_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Vec<ExplorerNode> {
    optional_cosmosdb_json(
        connection,
        &format!("/dbs/{database}/colls/{container}/conflicts"),
    )
    .await
    .and_then(|value| value.get("Conflicts").and_then(Value::as_array).cloned())
    .unwrap_or_default()
    .into_iter()
    .filter_map(|item| {
        let id = item.get("id").and_then(Value::as_str)?.to_string();
        Some(cosmos_node(
            &format!("cosmos:conflict:{database}:{container}:{id}"),
            &id,
            "conflict",
            item.get("operationType")
                .and_then(Value::as_str)
                .unwrap_or("conflict"),
            Some(&format!("cosmos:conflict:{database}:{container}:{id}")),
            false,
            None,
            cosmos_container_branch_path(connection, database, container, "Conflict Feed"),
        ))
    })
    .collect()
}

fn cosmos_container_branch_path(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
    branch: &str,
) -> Vec<String> {
    vec![
        cosmosdb_account_name(connection),
        "Databases".into(),
        database.into(),
        "Containers".into(),
        container.into(),
        branch.into(),
    ]
}

// Mirrors the ExplorerNode shape so Cosmos scopes stay readable at call sites.
#[allow(clippy::too_many_arguments)]
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
    let api = cosmosdb_api(connection);
    if api != "nosql" {
        return cosmosdb_api_inspect_payload(
            connection,
            node_id,
            &api,
            object_view,
            &database,
            &container,
        )
        .await;
    }
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
        | "change-feed" | "stored-procedures" | "stored-procedure" | "triggers" | "trigger"
        | "udfs" | "udf" | "conflicts" | "conflict" => {
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

async fn cosmosdb_api_inspect_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    api: &str,
    object_view: &str,
    database: &str,
    container: &str,
) -> Value {
    let api_label = cosmosdb_api_label(api);
    let mut payload = json!({
        "engine": "cosmosdb",
        "accountName": cosmosdb_account_name(connection),
        "api": api_label,
        "objectView": object_view,
        "database": database,
        "container": container,
        "databaseCount": if database.is_empty() { 0 } else { 1 },
        "containerCount": if container.is_empty() { 0 } else { 1 },
        "databases": cosmosdb_api_database_records(connection, api),
        "containers": cosmosdb_api_object_records(connection, database, api),
        "regions": cosmosdb_region_rows(connection),
        "consistency": cosmosdb_consistency_rows(connection),
        "throughput": cosmosdb_api_throughput_rows(database, container),
        "security": cosmosdb_api_security_rows(connection, database, container),
        "diagnostics": cosmosdb_api_diagnostic_rows(api, node_id),
        "warnings": [
            format!("This connection is configured for the Cosmos DB {api_label} API. DataPad++ hides SQL/NoSQL-only container scripts and uses API-specific native adapters for live object browsing."),
            format!("For live {api_label} object enumeration, use the matching native datastore adapter when available.")
        ]
    });

    if node_id.starts_with("cosmos:containers:") && container.is_empty() {
        payload["containers"] = json!([]);
    }
    if matches!(object_view, "regions") {
        clear_cosmos_payload_sections(
            &mut payload,
            &["databases", "containers", "throughput", "security"],
        );
    } else if matches!(object_view, "security") {
        clear_cosmos_payload_sections(
            &mut payload,
            &["databases", "containers", "throughput", "diagnostics"],
        );
    } else if matches!(object_view, "diagnostics" | "throughput") {
        clear_cosmos_payload_sections(&mut payload, &["databases", "containers", "security"]);
    } else if matches!(
        object_view,
        "container" | "items" | "partition-key" | "indexing-policy"
    ) {
        clear_cosmos_payload_sections(&mut payload, &["databases"]);
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

fn cosmosdb_api_database_records(connection: &ResolvedConnectionProfile, api: &str) -> Vec<Value> {
    let database = cosmosdb_default_database(connection);
    if database.trim().is_empty() {
        return Vec::new();
    }

    vec![json!({
        "name": database,
        "containers": cosmosdb_api_object_collection_label(api),
        "throughput": "account or database RU/s",
        "storage": "inspect with matching API"
    })]
}

fn cosmosdb_api_object_records(
    connection: &ResolvedConnectionProfile,
    database: &str,
    api: &str,
) -> Vec<Value> {
    let Some(object_name) = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.container_prefix.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };

    vec![json!({
        "name": object_name,
        "partitionKey": cosmosdb_api_partition_hint(api),
        "throughput": if database.is_empty() { "account RU/s" } else { "database RU/s" },
        "items": "inspect with matching API",
        "ttl": "-"
    })]
}

fn cosmosdb_region_rows(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    let options = connection.cosmos_db_options.as_ref();
    let write_region = options
        .and_then(|options| options.write_region.as_deref())
        .unwrap_or("-");
    let preferred = options
        .map(|options| options.preferred_regions.as_slice())
        .unwrap_or_default();

    let mut rows = Vec::new();
    if write_region != "-" {
        rows.push(json!({
            "name": write_region,
            "role": "write",
            "priority": 0,
            "status": "configured"
        }));
    }

    rows.extend(preferred.iter().enumerate().map(|(index, region)| {
        json!({
            "name": region,
            "role": if region == write_region { "write" } else { "preferred read" },
            "priority": index + 1,
            "status": "configured"
        })
    }));

    rows
}

fn cosmosdb_consistency_rows(connection: &ResolvedConnectionProfile) -> Vec<Value> {
    let options = connection.cosmos_db_options.as_ref();
    vec![
        json!({
            "setting": "Default consistency",
            "value": options.and_then(|options| options.consistency_level.as_deref()).unwrap_or("session"),
            "guidance": "Applied by this connection unless overridden by request options."
        }),
        json!({
            "setting": "Cross partition queries",
            "value": options.and_then(|options| options.enable_cross_partition_queries).unwrap_or(true),
            "guidance": "Disable only for strictly partition-key-scoped work."
        }),
        json!({
            "setting": "Request charge",
            "value": options.and_then(|options| options.return_request_charge).unwrap_or(true),
            "guidance": "Keep enabled to understand RU cost."
        }),
    ]
}

fn cosmosdb_api_throughput_rows(database: &str, object_name: &str) -> Vec<Value> {
    let scope = [database, object_name]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    vec![json!({
        "scope": if scope.is_empty() { "account" } else { scope.as_str() },
        "mode": "configured in Cosmos DB",
        "ruPerSecond": "-",
        "throttles": "-"
    })]
}

fn cosmosdb_api_security_rows(
    connection: &ResolvedConnectionProfile,
    database: &str,
    object_name: &str,
) -> Vec<Value> {
    let options = connection.cosmos_db_options.as_ref();
    let scope = [database, object_name]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    vec![
        json!({
            "name": options.and_then(|options| options.auth_mode.as_deref()).unwrap_or("configured auth"),
            "kind": "authentication",
            "scope": if scope.is_empty() { "account" } else { &scope },
            "status": "secret values stay in the secure store"
        }),
        json!({
            "name": options.and_then(|options| options.gateway_mode.as_deref()).unwrap_or("gateway"),
            "kind": "connectivity",
            "scope": "account",
            "status": if options.and_then(|options| options.use_tls).unwrap_or(true) { "TLS" } else { "TLS disabled" }
        }),
    ]
}

fn cosmosdb_api_diagnostic_rows(api: &str, node_id: &str) -> Vec<Value> {
    vec![
        json!({
            "signal": "Configured API",
            "value": cosmosdb_api_label(api),
            "status": "native routing",
            "guidance": "NoSQL-only metadata endpoints are hidden for this connection."
        }),
        json!({
            "signal": "Selected scope",
            "value": node_id,
            "status": "ready",
            "guidance": "Use the matching datastore adapter for live object enumeration and native query tooling."
        }),
    ]
}

fn clear_cosmos_payload_sections(payload: &mut Value, keys: &[&str]) {
    for key in keys {
        payload[*key] = json!([]);
    }
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
    named_script_values(connection, path, array_key)
        .await
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

async fn named_script_values(
    connection: &ResolvedConnectionProfile,
    path: &str,
    array_key: &str,
) -> Vec<Value> {
    optional_cosmosdb_json(connection, path)
        .await
        .and_then(|value| value.get(array_key).and_then(Value::as_array).cloned())
        .unwrap_or_default()
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

#[derive(Clone, Copy)]
struct CosmosScriptBranch {
    path_segment: &'static str,
    array_key: &'static str,
    node_prefix: &'static str,
    node_kind: &'static str,
    label: &'static str,
    detail: &'static str,
}

impl CosmosScriptBranch {
    fn stored_procedures() -> Self {
        Self {
            path_segment: "sprocs",
            array_key: "StoredProcedures",
            node_prefix: "stored-procedure",
            node_kind: "stored-procedure",
            label: "Stored Procedures",
            detail: "Stored procedure",
        }
    }

    fn triggers() -> Self {
        Self {
            path_segment: "triggers",
            array_key: "Triggers",
            node_prefix: "trigger",
            node_kind: "trigger",
            label: "Triggers",
            detail: "Trigger",
        }
    }

    fn udfs() -> Self {
        Self {
            path_segment: "udfs",
            array_key: "UserDefinedFunctions",
            node_prefix: "udf",
            node_kind: "udf",
            label: "User Defined Functions",
            detail: "User-defined function",
        }
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
    if node_id.starts_with("cosmos:stored-procedure:") {
        return "stored-procedure";
    }
    if node_id.starts_with("cosmos:triggers:") {
        return "triggers";
    }
    if node_id.starts_with("cosmos:trigger:") {
        return "trigger";
    }
    if node_id.starts_with("cosmos:udfs:") {
        return "udfs";
    }
    if node_id.starts_with("cosmos:udf:") {
        return "udf";
    }
    if node_id.starts_with("cosmos:conflicts:") {
        return "conflicts";
    }
    if node_id.starts_with("cosmos:conflict:") {
        return "conflict";
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
        | "stored-procedures" | "stored-procedure" | "triggers" | "trigger" | "udfs" | "udf"
        | "conflicts" | "conflict" => (
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

fn cosmosdb_api(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.api.as_deref())
        .map(|api| api.trim().to_ascii_lowercase())
        .filter(|api| !api.is_empty())
        .unwrap_or_else(|| "nosql".into())
}

fn cosmosdb_api_label(api: &str) -> &'static str {
    match api {
        "mongodb" => "MongoDB",
        "cassandra" => "Cassandra",
        "gremlin" => "Gremlin",
        "table" => "Table",
        _ => "NoSQL",
    }
}

fn cosmosdb_api_database_root_label(api: &str) -> &'static str {
    match api {
        "cassandra" => "Keyspaces",
        _ => "Databases",
    }
}

fn cosmosdb_api_object_collection_label(api: &str) -> &'static str {
    match api {
        "mongodb" => "Collections",
        "cassandra" => "Tables",
        "gremlin" => "Graphs",
        "table" => "Tables",
        _ => "Containers",
    }
}

fn cosmosdb_api_object_collection_kind(api: &str) -> &'static str {
    match api {
        "mongodb" => "collections",
        "cassandra" => "tables",
        "gremlin" => "graphs",
        "table" => "tables",
        _ => "containers",
    }
}

fn cosmosdb_api_object_kind(api: &str) -> &'static str {
    match api {
        "mongodb" => "collection",
        "cassandra" => "table",
        "gremlin" => "graph",
        "table" => "table",
        _ => "container",
    }
}

fn cosmosdb_api_object_collection_detail(api: &str) -> &'static str {
    match api {
        "mongodb" => "Mongo collections, indexes, and shard keys",
        "cassandra" => "Cassandra API tables and partition keys",
        "gremlin" => "Gremlin graphs, vertices, edges, and indexes",
        "table" => "Table API tables and entity partitions",
        _ => "Container inventory and partitioning",
    }
}

fn cosmosdb_api_object_detail(api: &str) -> &'static str {
    match api {
        "mongodb" => "MongoDB API collection",
        "cassandra" => "Cassandra API table",
        "gremlin" => "Gremlin graph",
        "table" => "Table API table",
        _ => "Cosmos DB container",
    }
}

fn cosmosdb_api_partition_hint(api: &str) -> &'static str {
    match api {
        "mongodb" => "shard key",
        "cassandra" => "partition key",
        "gremlin" => "partition key",
        "table" => "PartitionKey",
        _ => "/id",
    }
}

fn cosmosdb_api_object_child_specs(
    api: &str,
) -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    match api {
        "mongodb" => vec![
            (
                "items",
                "Documents",
                "items",
                "Open a bounded document query through the MongoDB API",
            ),
            (
                "partition-key",
                "Shard Key",
                "partition-key",
                "Shard key and distribution posture",
            ),
            (
                "indexing-policy",
                "Indexes",
                "indexing-policy",
                "MongoDB API index metadata",
            ),
            (
                "throughput",
                "Throughput",
                "throughput",
                "RU/s and throttling posture",
            ),
        ],
        "cassandra" => vec![
            (
                "items",
                "Rows",
                "items",
                "Open a partition-key-first row query through the Cassandra API",
            ),
            (
                "partition-key",
                "Partition Key",
                "partition-key",
                "Partition and clustering key posture",
            ),
            (
                "indexing-policy",
                "Indexes",
                "indexing-policy",
                "Secondary index metadata",
            ),
            (
                "throughput",
                "Throughput",
                "throughput",
                "RU/s and throttling posture",
            ),
        ],
        "gremlin" => vec![
            (
                "items",
                "Traversal",
                "items",
                "Open a graph traversal through the Gremlin API",
            ),
            (
                "partition-key",
                "Partition Key",
                "partition-key",
                "Graph partitioning posture",
            ),
            (
                "indexing-policy",
                "Indexes",
                "indexing-policy",
                "Graph index metadata",
            ),
            (
                "throughput",
                "Throughput",
                "throughput",
                "RU/s and throttling posture",
            ),
        ],
        "table" => vec![
            (
                "items",
                "Entities",
                "items",
                "Open a bounded entity query through the Table API",
            ),
            (
                "partition-key",
                "Partition Key",
                "partition-key",
                "PartitionKey and RowKey posture",
            ),
            (
                "indexing-policy",
                "Indexes",
                "indexing-policy",
                "Table API indexing posture",
            ),
            (
                "throughput",
                "Throughput",
                "throughput",
                "RU/s and throttling posture",
            ),
        ],
        _ => Vec::new(),
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/explorer_tests.rs"]
mod tests;
