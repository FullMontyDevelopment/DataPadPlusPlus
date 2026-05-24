use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    Database,
};
use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::mongodb_execution_capabilities;
use super::connection::{mongodb_client, mongodb_database_name, mongodb_selected_database_name};

const SYSTEM_DATABASES: &[&str] = &["admin", "config", "local"];

struct MongoCollectionInfo {
    name: String,
    collection_type: String,
    options: Document,
}

impl MongoCollectionInfo {
    fn is_time_series(&self) -> bool {
        self.options.contains_key("timeseries")
    }

    fn is_capped(&self) -> bool {
        self.options.get_bool("capped").unwrap_or(false)
    }
}

pub(super) async fn list_mongodb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let client = mongodb_client(connection).await?;
    let limit = bounded_page_size(request.limit.or(Some(100))) as usize;
    let fallback_database = mongodb_database_name(connection);
    let nodes = match request.scope.as_deref() {
        Some(scope) if scope.starts_with("database:") => {
            let database_name = scoped_database(scope, "database:", &fallback_database);
            mongodb_database_children(connection, &database_name)
        }
        Some("databases") => {
            let database_names = client.list_database_names().await?;
            mongodb_database_group_nodes(connection, database_names, limit, false)
        }
        Some("system-databases") => {
            let database_names = client.list_database_names().await?;
            mongodb_database_group_nodes(connection, database_names, limit, true)
        }
        Some(scope) if scope.starts_with("collections:") => {
            let database_name = scoped_database(scope, "collections:", &fallback_database);
            let database = client.database(&database_name);
            let infos = list_collection_infos(&database).await?;
            infos
                .into_iter()
                .filter(|info| {
                    info.collection_type != "view" && !info.is_time_series() && !info.is_capped()
                })
                .take(limit)
                .map(|info| {
                    mongodb_collection_node_for_database(connection, &database_name, &info.name)
                })
                .collect()
        }
        Some(scope) if scope.starts_with("time-series-collections:") => {
            let database_name =
                scoped_database(scope, "time-series-collections:", &fallback_database);
            list_collection_infos(&client.database(&database_name))
                .await?
                .into_iter()
                .filter(MongoCollectionInfo::is_time_series)
                .take(limit)
                .map(|info| {
                    mongodb_collection_node_for_database(connection, &database_name, &info.name)
                })
                .collect()
        }
        Some(scope) if scope.starts_with("capped-collections:") => {
            let database_name = scoped_database(scope, "capped-collections:", &fallback_database);
            list_collection_infos(&client.database(&database_name))
                .await?
                .into_iter()
                .filter(MongoCollectionInfo::is_capped)
                .take(limit)
                .map(|info| {
                    mongodb_collection_node_for_database(connection, &database_name, &info.name)
                })
                .collect()
        }
        Some(scope) if scope.starts_with("views:") => {
            let database_name = scoped_database(scope, "views:", &fallback_database);
            let database = client.database(&database_name);
            let infos = list_collection_infos(&database).await?;
            infos
                .into_iter()
                .filter(|info| info.collection_type == "view")
                .take(limit)
                .map(|info| mongodb_view_node(connection, &database_name, &info))
                .collect()
        }
        Some(scope) if scope.starts_with("collection:") => {
            let (database_name, collection_name) =
                scoped_database_collection(scope, "collection:", &fallback_database);
            mongodb_collection_children(connection, &database_name, &collection_name)
        }
        Some(scope) if scope.starts_with("view:") => {
            let (database_name, view_name) =
                scoped_database_collection(scope, "view:", &fallback_database);
            mongodb_view_children(connection, &database_name, &view_name)
        }
        Some(scope) if scope.starts_with("indexes:") => {
            let (database_name, collection_name) =
                scoped_database_collection(scope, "indexes:", &fallback_database);
            let collection = client
                .database(&database_name)
                .collection::<Document>(&collection_name);
            collection
                .list_index_names()
                .await?
                .into_iter()
                .take(limit)
                .map(|index_name| mongodb_index_node(&database_name, &collection_name, &index_name))
                .collect()
        }
        Some(scope) if scope.starts_with("gridfs:") => {
            let database_name = scoped_database(scope, "gridfs:", &fallback_database);
            mongodb_gridfs_children(connection, &database_name)
        }
        Some(scope) if scope.starts_with("gridfs-buckets:") => {
            let database_name = scoped_database(scope, "gridfs-buckets:", &fallback_database);
            list_gridfs_bucket_nodes(connection, &client.database(&database_name), &database_name)
                .await
        }
        Some(scope) if scope.starts_with("search-indexes:") => {
            let database_name = scoped_database(scope, "search-indexes:", &fallback_database);
            mongo_unavailable_node(
                &database_name,
                "Search Indexes",
                "Atlas Search index metadata is available through Atlas APIs or `$listSearchIndexes` on supported clusters.",
            )
        }
        Some(scope) if scope.starts_with("vector-indexes:") => {
            let database_name = scoped_database(scope, "vector-indexes:", &fallback_database);
            mongo_unavailable_node(
                &database_name,
                "Vector Indexes",
                "Vector search indexes are listed when the connected MongoDB deployment exposes Atlas Search metadata.",
            )
        }
        Some(scope) if scope.starts_with("users:") => {
            let database_name = scoped_database(scope, "users:", &fallback_database);
            list_user_nodes(&client.database(&database_name), &database_name, limit).await
        }
        Some(scope) if scope.starts_with("roles:") => {
            let database_name = scoped_database(scope, "roles:", &fallback_database);
            list_role_nodes(&client.database(&database_name), &database_name, limit).await
        }
        Some(_) => Vec::new(),
        None => {
            let selected_database = mongodb_selected_database_name(connection);
            match selected_database {
                Some(database_name) => {
                    vec![mongodb_database_node(connection, &database_name, None)]
                }
                None => mongodb_root_sections(),
            }
        }
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} MongoDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: mongodb_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_mongodb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let client = mongodb_client(connection).await?;
    let fallback_database = mongodb_database_name(connection);
    let node_id = request.node_id.as_str();

    if let Some(rest) = node_id.strip_prefix("schema-preview:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let collection = client
            .database(&database_name)
            .collection::<Document>(&collection_name);
        let documents = collection
            .find(doc! {})
            .limit(25)
            .await?
            .try_collect::<Vec<Document>>()
            .await?;

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Schema preview ready for {database_name}.{collection_name}."),
            query_template: Some(mongodb_find_query_template_for_database(
                &database_name,
                &collection_name,
                20,
            )),
            payload: Some(json!({
                "database": database_name,
                "collection": collection_name,
                "sampleSize": documents.len(),
                "fields": infer_schema_fields(&documents),
            })),
        });
    }

    if let Some(rest) = node_id.strip_prefix("indexes:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let indexes = client
            .database(&database_name)
            .run_command(doc! { "listIndexes": &collection_name })
            .await?;

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Index list ready for {database_name}.{collection_name}."),
            query_template: Some(mongodb_command_query_template(
                &database_name,
                doc! { "listIndexes": &collection_name },
            )),
            payload: Some(json!({
                "database": database_name,
                "collection": collection_name,
                "indexes": indexes,
            })),
        });
    }

    if let Some(rest) = node_id.strip_prefix("collection-statistics:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let stats = client
            .database(&database_name)
            .run_command(doc! { "collStats": &collection_name, "scale": 1 })
            .await;

        return Ok(inspection_with_command_result(
            request,
            format!("Collection statistics ready for {database_name}.{collection_name}."),
            &database_name,
            doc! { "collStats": &collection_name, "scale": 1 },
            stats,
        ));
    }

    if let Some(database_name) = node_id.strip_prefix("database-statistics:") {
        let stats = client
            .database(database_name)
            .run_command(doc! { "dbStats": 1, "scale": 1 })
            .await;

        return Ok(inspection_with_command_result(
            request,
            format!("Database statistics ready for {database_name}."),
            database_name,
            doc! { "dbStats": 1, "scale": 1 },
            stats,
        ));
    }

    if let Some(database_name) = node_id.strip_suffix(":database-statistics") {
        let stats = client
            .database(database_name)
            .run_command(doc! { "dbStats": 1, "scale": 1 })
            .await;

        return Ok(inspection_with_command_result(
            request,
            format!("Database statistics ready for {database_name}."),
            database_name,
            doc! { "dbStats": 1, "scale": 1 },
            stats,
        ));
    }

    if let Some(rest) = node_id.strip_prefix("collection-permissions:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let permissions = client
            .database(&database_name)
            .run_command(doc! { "usersInfo": 1, "showPrivileges": true })
            .await;

        return Ok(inspection_with_command_result(
            request,
            format!("Permission metadata ready for {database_name}.{collection_name}."),
            &database_name,
            doc! { "usersInfo": 1, "showPrivileges": true },
            permissions,
        ));
    }

    if let Some(rest) = node_id.strip_prefix("collection-scripts:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Script templates ready for {database_name}.{collection_name}."),
            query_template: Some(format!("db.{collection_name}.find({{}}).limit(20)")),
            payload: Some(json!({
                "database": database_name,
                "collection": collection_name,
                "scripts": [
                    format!("db.{collection_name}.find({{}}).limit(20)"),
                    format!("db.{collection_name}.aggregate([{{ $match: {{}} }}, {{ $limit: 20 }}])"),
                    format!("db.{collection_name}.countDocuments({{}})")
                ]
            })),
        });
    }

    if let Some(rest) = node_id.strip_prefix("validation-rules:") {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let info =
            collection_info_by_name(&client.database(&database_name), &collection_name).await?;
        let validator = info.and_then(|item| item.options.get_document("validator").ok().cloned());

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Validation rules ready for {database_name}.{collection_name}."),
            query_template: Some(mongodb_command_query_template(
                &database_name,
                doc! { "listCollections": 1, "filter": { "name": &collection_name } },
            )),
            payload: Some(json!({
                "database": database_name,
                "collection": collection_name,
                "validator": validator,
            })),
        });
    }

    if let Some(rest) = node_id.strip_prefix("view-pipeline:") {
        let (database_name, view_name) = split_database_collection(rest, &fallback_database);
        let info = collection_info_by_name(&client.database(&database_name), &view_name).await?;
        let pipeline = info
            .and_then(|item| item.options.get_array("pipeline").ok().cloned())
            .unwrap_or_default();

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("View pipeline ready for {database_name}.{view_name}."),
            query_template: Some(mongodb_find_query_template_for_database(
                &database_name,
                &view_name,
                20,
            )),
            payload: Some(json!({
                "database": database_name,
                "view": view_name,
                "pipeline": pipeline,
            })),
        });
    }

    if let Some(database_name) = node_id.strip_prefix("users:") {
        return Ok(inspect_users_or_roles(
            &client.database(database_name),
            request,
            database_name,
            true,
        )
        .await);
    }

    if let Some(database_name) = node_id.strip_prefix("roles:") {
        return Ok(inspect_users_or_roles(
            &client.database(database_name),
            request,
            database_name,
            false,
        )
        .await);
    }

    if let Some(database_name) = node_id.strip_prefix("database:") {
        let database = client.database(database_name);
        let infos = list_collection_infos(&database).await?;
        let stats = database
            .run_command(doc! { "dbStats": 1, "scale": 1 })
            .await;
        let gridfs_buckets = gridfs_buckets_from_infos(&infos);

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Database overview ready for {database_name}."),
            query_template: Some(mongodb_command_query_template(
                database_name,
                doc! { "dbStats": 1, "scale": 1 },
            )),
            payload: Some(json!({
                "database": database_name,
                "collections": infos.iter()
                    .filter(|item| item.collection_type == "collection" && !item.is_time_series() && !item.is_capped() && !is_gridfs_collection(&item.name))
                    .map(collection_info_payload)
                    .collect::<Vec<_>>(),
                "views": infos.iter()
                    .filter(|item| item.collection_type == "view")
                    .map(collection_info_payload)
                    .collect::<Vec<_>>(),
                "timeSeriesCollections": infos.iter()
                    .filter(|item| item.is_time_series())
                    .map(collection_info_payload)
                    .collect::<Vec<_>>(),
                "cappedCollections": infos.iter()
                    .filter(|item| item.is_capped())
                    .map(collection_info_payload)
                    .collect::<Vec<_>>(),
                "gridfsBuckets": gridfs_buckets,
                "statistics": stats.ok(),
            })),
        });
    }

    if let Some(rest) = node_id
        .strip_prefix("collection:")
        .or_else(|| node_id.strip_prefix("documents:"))
    {
        let (database_name, collection_name) = split_database_collection(rest, &fallback_database);
        let collection = client
            .database(&database_name)
            .collection::<Document>(&collection_name);
        let sample_documents = collection
            .find(doc! {})
            .limit(3)
            .await?
            .try_collect::<Vec<Document>>()
            .await?;
        let indexes = client
            .database(&database_name)
            .run_command(doc! { "listIndexes": &collection_name })
            .await
            .ok();
        let info =
            collection_info_by_name(&client.database(&database_name), &collection_name).await?;
        let validator = info.and_then(|item| item.options.get_document("validator").ok().cloned());
        let statistics = client
            .database(&database_name)
            .run_command(doc! { "collStats": &collection_name, "scale": 1 })
            .await
            .ok();

        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Inspection ready for {database_name}.{collection_name}."),
            query_template: Some(mongodb_find_query_template_for_database(
                &database_name,
                &collection_name,
                20,
            )),
            payload: Some(json!({
                "database": database_name,
                "collection": collection_name,
                "indexes": indexes,
                "validator": validator,
                "statistics": statistics,
                "sampleDocuments": sample_documents,
            })),
        });
    }

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "MongoDB inspection metadata is not available for {}.",
            request.node_id
        ),
        query_template: Some("{}".into()),
        payload: Some(json!({ "nodeId": request.node_id })),
    })
}

#[cfg(test)]
fn mongodb_collection_node(
    connection: &ResolvedConnectionProfile,
    collection_name: &str,
) -> ExplorerNode {
    let database_name = mongodb_database_name(connection);
    mongodb_collection_node_for_database(connection, &database_name, collection_name)
}

#[cfg(test)]
fn mongodb_root_database_nodes(
    connection: &ResolvedConnectionProfile,
    database_names: Vec<String>,
    limit: usize,
) -> Vec<ExplorerNode> {
    let mut user_databases = Vec::new();
    let mut system_databases = Vec::new();

    for database_name in database_names.into_iter().take(limit) {
        if SYSTEM_DATABASES.contains(&database_name.as_str()) {
            system_databases.push(mongodb_database_node(
                connection,
                &database_name,
                Some(vec!["System Databases".into()]),
            ));
        } else {
            user_databases.push(mongodb_database_node(connection, &database_name, None));
        }
    }

    user_databases.extend(system_databases);
    user_databases
}

fn mongodb_root_sections() -> Vec<ExplorerNode> {
    vec![
        ExplorerNode {
            id: "mongodb-databases".into(),
            family: "document".into(),
            label: "Databases".into(),
            kind: "databases".into(),
            detail: "User MongoDB databases".into(),
            scope: Some("databases".into()),
            path: None,
            query_template: None,
            expandable: Some(true),
        },
        ExplorerNode {
            id: "mongodb-system-databases".into(),
            family: "document".into(),
            label: "System Databases".into(),
            kind: "system-databases".into(),
            detail: "admin, config, and local".into(),
            scope: Some("system-databases".into()),
            path: None,
            query_template: None,
            expandable: Some(true),
        },
    ]
}

fn mongodb_database_group_nodes(
    connection: &ResolvedConnectionProfile,
    database_names: Vec<String>,
    limit: usize,
    system: bool,
) -> Vec<ExplorerNode> {
    database_names
        .into_iter()
        .filter(|database_name| SYSTEM_DATABASES.contains(&database_name.as_str()) == system)
        .take(limit)
        .map(|database_name| {
            mongodb_database_node(
                connection,
                &database_name,
                Some(vec![if system {
                    "System Databases".into()
                } else {
                    "Databases".into()
                }]),
            )
        })
        .collect()
}

fn mongodb_database_children(
    connection: &ResolvedConnectionProfile,
    database_name: &str,
) -> Vec<ExplorerNode> {
    vec![
        mongodb_section_node(
            connection,
            database_name,
            "Collections",
            "collections",
            "Document collections",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Views",
            "views",
            "Read-only collection views",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Time Series Collections",
            "time-series-collections",
            "Time-series optimized collections",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Capped Collections",
            "capped-collections",
            "Fixed-size capped collections",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "GridFS",
            "gridfs",
            "GridFS files and chunks collections",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Search Indexes",
            "search-indexes",
            "Atlas Search indexes where supported",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Vector Indexes",
            "vector-indexes",
            "Vector search indexes where supported",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Users",
            "users",
            "Database users",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Roles",
            "roles",
            "Database roles",
        ),
        mongodb_section_node(
            connection,
            database_name,
            "Database Statistics",
            "database-statistics",
            "Database storage and collection statistics",
        ),
    ]
}

fn mongodb_collection_children(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
    collection_name: &str,
) -> Vec<ExplorerNode> {
    let path = vec![
        database_name.into(),
        "Collections".into(),
        collection_name.into(),
    ];

    vec![
        ExplorerNode {
            id: format!("documents:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Documents".into(),
            kind: "documents".into(),
            detail: "Open collection documents".into(),
            scope: Some(format!("collection:{database_name}:{collection_name}")),
            path: Some(path.clone()),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                collection_name,
                20,
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("schema-preview:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Schema Preview".into(),
            kind: "schema-preview".into(),
            detail: "Inferred fields and BSON types".into(),
            scope: None,
            path: Some(path.clone()),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                collection_name,
                20,
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("indexes:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Indexes".into(),
            kind: "indexes".into(),
            detail: "Collection index definitions".into(),
            scope: Some(format!("indexes:{database_name}:{collection_name}")),
            path: Some(path.clone()),
            query_template: Some(mongodb_command_query_template(
                database_name,
                doc! { "listIndexes": collection_name },
            )),
            expandable: Some(true),
        },
        ExplorerNode {
            id: format!("validation-rules:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Validation Rules".into(),
            kind: "validation-rules".into(),
            detail: "Collection validator JSON".into(),
            scope: None,
            path: Some(path.clone()),
            query_template: Some(mongodb_command_query_template(
                database_name,
                doc! { "listCollections": 1, "filter": { "name": collection_name } },
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("aggregations:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Aggregations".into(),
            kind: "aggregations".into(),
            detail: "Aggregation pipeline workspace".into(),
            scope: Some(format!("collection:{database_name}:{collection_name}")),
            path: Some(path),
            query_template: Some(mongodb_aggregation_query_template(
                database_name,
                collection_name,
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("collection-statistics:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Statistics".into(),
            kind: "collection-statistics".into(),
            detail: "Collection size, count, and storage statistics".into(),
            scope: None,
            path: Some(vec![
                database_name.into(),
                "Collections".into(),
                collection_name.into(),
            ]),
            query_template: Some(mongodb_command_query_template(
                database_name,
                doc! { "collStats": collection_name, "scale": 1 },
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("collection-permissions:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Permissions".into(),
            kind: "permissions".into(),
            detail: "Roles and actions that affect this collection".into(),
            scope: None,
            path: Some(vec![
                database_name.into(),
                "Collections".into(),
                collection_name.into(),
            ]),
            query_template: Some(mongodb_command_query_template(
                database_name,
                doc! { "usersInfo": 1, "showPrivileges": true },
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("collection-scripts:{database_name}:{collection_name}"),
            family: "document".into(),
            label: "Scripts".into(),
            kind: "scripts".into(),
            detail: "Collection-scoped script templates".into(),
            scope: None,
            path: Some(vec![
                database_name.into(),
                "Collections".into(),
                collection_name.into(),
            ]),
            query_template: Some(format!("db.{collection_name}.find({{}}).limit(20)")),
            expandable: Some(false),
        },
    ]
}

fn mongodb_view_children(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
    view_name: &str,
) -> Vec<ExplorerNode> {
    let path = vec![database_name.into(), "Views".into(), view_name.into()];

    vec![
        ExplorerNode {
            id: format!("view-pipeline:{database_name}:{view_name}"),
            family: "document".into(),
            label: "Pipeline".into(),
            kind: "pipeline".into(),
            detail: "View backing aggregation pipeline".into(),
            scope: None,
            path: Some(path.clone()),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                view_name,
                20,
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("view-sample-results:{database_name}:{view_name}"),
            family: "document".into(),
            label: "Sample Results".into(),
            kind: "sample-results".into(),
            detail: "Open a query against this view".into(),
            scope: Some(format!("collection:{database_name}:{view_name}")),
            path: Some(path),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                view_name,
                20,
            )),
            expandable: Some(false),
        },
    ]
}

fn mongodb_gridfs_children(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
) -> Vec<ExplorerNode> {
    vec![
        ExplorerNode {
            id: format!("gridfs-buckets:{database_name}"),
            family: "document".into(),
            label: "Buckets".into(),
            kind: "gridfs-buckets".into(),
            detail: "GridFS bucket prefixes".into(),
            scope: Some(format!("gridfs-buckets:{database_name}")),
            path: Some(vec![database_name.into(), "GridFS".into()]),
            query_template: None,
            expandable: Some(true),
        },
        ExplorerNode {
            id: format!("gridfs-files:{database_name}"),
            family: "document".into(),
            label: "Files".into(),
            kind: "gridfs-files".into(),
            detail: "Files metadata across GridFS buckets".into(),
            scope: Some(format!("collection:{database_name}:fs.files")),
            path: Some(vec![database_name.into(), "GridFS".into()]),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                "fs.files",
                20,
            )),
            expandable: Some(false),
        },
        ExplorerNode {
            id: format!("gridfs-chunks:{database_name}"),
            family: "document".into(),
            label: "Chunks".into(),
            kind: "gridfs-chunks".into(),
            detail: "Chunk documents across GridFS buckets".into(),
            scope: Some(format!("collection:{database_name}:fs.chunks")),
            path: Some(vec![database_name.into(), "GridFS".into()]),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                "fs.chunks",
                20,
            )),
            expandable: Some(false),
        },
    ]
}

async fn list_gridfs_bucket_nodes(
    _connection: &ResolvedConnectionProfile,
    database: &Database,
    database_name: &str,
) -> Vec<ExplorerNode> {
    let Ok(collection_names) = database.list_collection_names().await else {
        return mongo_unavailable_node(
            database_name,
            "GridFS",
            "GridFS buckets could not be listed with the current permissions.",
        );
    };

    let mut bucket_names = collection_names
        .iter()
        .filter_map(|name| name.strip_suffix(".files"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    bucket_names.sort();
    bucket_names.dedup();

    bucket_names
        .into_iter()
        .map(|bucket| ExplorerNode {
            id: format!("gridfs-bucket:{database_name}:{bucket}"),
            family: "document".into(),
            label: bucket.clone(),
            kind: "gridfs-bucket".into(),
            detail: "GridFS bucket".into(),
            scope: Some(format!("collection:{database_name}:{bucket}.files")),
            path: Some(vec![
                database_name.into(),
                "GridFS".into(),
                "Buckets".into(),
            ]),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                &format!("{bucket}.files"),
                20,
            )),
            expandable: Some(false),
        })
        .collect()
}

fn mongo_unavailable_node(database_name: &str, section: &str, detail: &str) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: format!("unavailable:{database_name}:{section}"),
        family: "document".into(),
        label: "Unavailable".into(),
        kind: "unavailable".into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![database_name.into(), section.into()]),
        query_template: None,
        expandable: Some(false),
    }]
}

#[allow(dead_code)]
fn mongodb_legacy_gridfs_collection_nodes(database_name: &str) -> Vec<ExplorerNode> {
    ["fs.files", "fs.chunks"]
        .iter()
        .map(|collection_name| ExplorerNode {
            id: format!("gridfs:{database_name}:{collection_name}"),
            family: "document".into(),
            label: (*collection_name).into(),
            kind: "gridfs-collection".into(),
            detail: "GridFS backing collection".into(),
            scope: Some(format!("collection:{database_name}:{collection_name}")),
            path: Some(vec![database_name.into(), "GridFS".into()]),
            query_template: Some(mongodb_find_query_template_for_database(
                database_name,
                collection_name,
                20,
            )),
            expandable: Some(false),
        })
        .collect::<Vec<_>>()
}

fn mongodb_database_node(
    connection: &ResolvedConnectionProfile,
    database_name: &str,
    path: Option<Vec<String>>,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("database:{database_name}"),
        family: "document".into(),
        label: database_name.into(),
        kind: "database".into(),
        detail: format!("{} database", connection.engine),
        scope: Some(format!("database:{database_name}")),
        path,
        query_template: None,
        expandable: Some(true),
    }
}

fn mongodb_section_node(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
    label: &str,
    scope_prefix: &str,
    detail: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("{database_name}:{scope_prefix}"),
        family: "document".into(),
        label: label.into(),
        kind: scope_prefix.into(),
        detail: detail.into(),
        scope: Some(format!("{scope_prefix}:{database_name}")),
        path: Some(vec![database_name.into()]),
        query_template: None,
        expandable: Some(true),
    }
}

fn mongodb_collection_node_for_database(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
    collection_name: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("collection:{database_name}:{collection_name}"),
        family: "document".into(),
        label: collection_name.into(),
        kind: "collection".into(),
        detail: "Documents, schema, indexes, validation, and aggregations".into(),
        scope: Some(format!("collection:{database_name}:{collection_name}")),
        path: Some(vec![database_name.into(), "Collections".into()]),
        query_template: Some(mongodb_find_query_template_for_database(
            database_name,
            collection_name,
            20,
        )),
        expandable: Some(true),
    }
}

fn mongodb_view_node(
    _connection: &ResolvedConnectionProfile,
    database_name: &str,
    info: &MongoCollectionInfo,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("view:{database_name}:{}", info.name),
        family: "document".into(),
        label: info.name.clone(),
        kind: "view".into(),
        detail: "MongoDB collection view".into(),
        scope: Some(format!("view:{database_name}:{}", info.name)),
        path: Some(vec![database_name.into(), "Views".into()]),
        query_template: Some(mongodb_find_query_template_for_database(
            database_name,
            &info.name,
            20,
        )),
        expandable: Some(true),
    }
}

fn mongodb_index_node(
    database_name: &str,
    collection_name: &str,
    index_name: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("index:{database_name}:{collection_name}:{index_name}"),
        family: "document".into(),
        label: index_name.into(),
        kind: "index".into(),
        detail: format!("Index on {collection_name}"),
        scope: None,
        path: Some(vec![
            database_name.into(),
            "Collections".into(),
            collection_name.into(),
            "Indexes".into(),
        ]),
        query_template: Some(mongodb_command_query_template(
            database_name,
            doc! { "listIndexes": collection_name },
        )),
        expandable: Some(false),
    }
}

async fn list_user_nodes(
    database: &Database,
    database_name: &str,
    limit: usize,
) -> Vec<ExplorerNode> {
    match database.run_command(doc! { "usersInfo": 1 }).await {
        Ok(response) => response
            .get_array("users")
            .map(|users| {
                users
                    .iter()
                    .filter_map(|item| item.as_document())
                    .filter_map(|user| user.get_str("user").ok())
                    .take(limit)
                    .map(|user| ExplorerNode {
                        id: format!("user:{database_name}:{user}"),
                        family: "document".into(),
                        label: user.into(),
                        kind: "user".into(),
                        detail: "MongoDB database user".into(),
                        scope: None,
                        path: Some(vec![database_name.into(), "Users".into()]),
                        query_template: None,
                        expandable: Some(false),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        Err(error) => vec![permission_warning_node(
            database_name,
            "Users",
            format!("Users unavailable: {error}"),
        )],
    }
}

async fn list_role_nodes(
    database: &Database,
    database_name: &str,
    limit: usize,
) -> Vec<ExplorerNode> {
    match database.run_command(doc! { "rolesInfo": 1 }).await {
        Ok(response) => response
            .get_array("roles")
            .map(|roles| {
                roles
                    .iter()
                    .filter_map(|item| item.as_document())
                    .filter_map(|role| role.get_str("role").ok())
                    .take(limit)
                    .map(|role| ExplorerNode {
                        id: format!("role:{database_name}:{role}"),
                        family: "document".into(),
                        label: role.into(),
                        kind: "role".into(),
                        detail: "MongoDB database role".into(),
                        scope: None,
                        path: Some(vec![database_name.into(), "Roles".into()]),
                        query_template: None,
                        expandable: Some(false),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        Err(error) => vec![permission_warning_node(
            database_name,
            "Roles",
            format!("Roles unavailable: {error}"),
        )],
    }
}

fn permission_warning_node(database_name: &str, section: &str, detail: String) -> ExplorerNode {
    ExplorerNode {
        id: format!("permission-warning:{database_name}:{section}"),
        family: "document".into(),
        label: "Permission required".into(),
        kind: "permission".into(),
        detail,
        scope: None,
        path: Some(vec![database_name.into(), section.into()]),
        query_template: None,
        expandable: Some(false),
    }
}

async fn inspect_users_or_roles(
    database: &Database,
    request: &ExplorerInspectRequest,
    database_name: &str,
    users: bool,
) -> ExplorerInspectResponse {
    let command = if users {
        doc! { "usersInfo": 1 }
    } else {
        doc! { "rolesInfo": 1 }
    };
    let label = if users { "users" } else { "roles" };
    let query_command = command.clone();

    match database.run_command(command).await {
        Ok(payload) => ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("MongoDB {label} loaded for {database_name}."),
            query_template: Some(mongodb_command_query_template(database_name, query_command)),
            payload: Some(json!({
                "database": database_name,
                label: payload.get_array(label).cloned().unwrap_or_default(),
            })),
        },
        Err(error) => ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("MongoDB {label} are unavailable for {database_name}."),
            query_template: None,
            payload: Some(json!({
                "database": database_name,
                "warning": error.to_string(),
            })),
        },
    }
}

fn inspection_with_command_result(
    request: &ExplorerInspectRequest,
    summary: String,
    database_name: &str,
    command: Document,
    result: Result<Document, mongodb::error::Error>,
) -> ExplorerInspectResponse {
    match result {
        Ok(payload) => ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary,
            query_template: Some(mongodb_command_query_template(database_name, command)),
            payload: Some(json!({
                "database": database_name,
                "result": payload,
            })),
        },
        Err(error) => ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("MongoDB metadata is unavailable for {}.", request.node_id),
            query_template: Some(mongodb_command_query_template(database_name, command)),
            payload: Some(json!({
                "database": database_name,
                "warning": error.to_string(),
            })),
        },
    }
}

async fn list_collection_infos(
    database: &Database,
) -> Result<Vec<MongoCollectionInfo>, CommandError> {
    let response = database
        .run_command(doc! { "listCollections": 1, "cursor": {} })
        .await?;
    let Some(cursor) = response.get_document("cursor").ok() else {
        return Ok(Vec::new());
    };
    let Some(first_batch) = cursor.get_array("firstBatch").ok() else {
        return Ok(Vec::new());
    };

    Ok(first_batch
        .iter()
        .filter_map(|item| item.as_document())
        .filter_map(|document| {
            let name = document.get_str("name").ok()?.to_string();
            let collection_type = document.get_str("type").unwrap_or("collection").to_string();
            let options = document
                .get_document("options")
                .ok()
                .cloned()
                .unwrap_or_default();

            Some(MongoCollectionInfo {
                name,
                collection_type,
                options,
            })
        })
        .collect())
}

async fn collection_info_by_name(
    database: &Database,
    collection_name: &str,
) -> Result<Option<MongoCollectionInfo>, CommandError> {
    Ok(list_collection_infos(database)
        .await?
        .into_iter()
        .find(|item| item.name == collection_name))
}

fn collection_info_payload(info: &MongoCollectionInfo) -> Value {
    json!({
        "name": info.name,
        "type": info.collection_type,
        "options": info.options,
        "pipeline": info.options.get_array("pipeline").cloned().unwrap_or_default(),
    })
}

fn is_gridfs_collection(collection_name: &str) -> bool {
    collection_name.ends_with(".files") || collection_name.ends_with(".chunks")
}

fn gridfs_buckets_from_infos(infos: &[MongoCollectionInfo]) -> Vec<Value> {
    let mut buckets = infos
        .iter()
        .filter_map(|info| info.name.strip_suffix(".files"))
        .map(|bucket| {
            json!({
                "name": bucket,
                "filesCollection": format!("{bucket}.files"),
                "chunksCollection": format!("{bucket}.chunks"),
            })
        })
        .collect::<Vec<_>>();
    buckets.sort_by_key(|item| item["name"].as_str().unwrap_or_default().to_string());
    buckets
}

#[derive(Default)]
struct SchemaFieldSummary {
    count: usize,
    type_distribution: BTreeMap<String, usize>,
    examples: Vec<Value>,
}

fn infer_schema_fields(documents: &[Document]) -> Vec<Value> {
    let mut fields = BTreeMap::<String, SchemaFieldSummary>::new();

    for document in documents {
        collect_document_fields("", document, &mut fields);
    }

    fields
        .into_iter()
        .map(|(path, summary)| {
            let primary_type = summary
                .type_distribution
                .iter()
                .max_by_key(|(_, count)| *count)
                .map(|(bson_type, _)| bson_type.clone())
                .unwrap_or_else(|| "unknown".into());
            json!({
                "path": path,
                "type": primary_type,
                "types": summary.type_distribution.keys().cloned().collect::<Vec<_>>(),
                "typeDistribution": summary.type_distribution,
                "count": summary.count,
                "presenceCount": summary.count,
                "examples": summary.examples,
            })
        })
        .collect()
}

fn collect_document_fields(
    prefix: &str,
    document: &Document,
    fields: &mut BTreeMap<String, SchemaFieldSummary>,
) {
    for (key, value) in document {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        let entry = fields.entry(path.clone()).or_default();
        entry.count += 1;
        *entry
            .type_distribution
            .entry(bson_type_name(value).into())
            .or_default() += 1;
        if entry.examples.len() < 3 && !matches!(value, Bson::Document(_)) {
            entry
                .examples
                .push(serde_json::to_value(value).unwrap_or_else(|_| json!(bson_type_name(value))));
        }

        if let Bson::Document(child) = value {
            collect_document_fields(&path, child, fields);
        }
    }
}

fn scoped_database(scope: &str, prefix: &str, fallback_database: &str) -> String {
    scope
        .strip_prefix(prefix)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_database)
        .to_string()
}

fn scoped_database_collection(
    scope: &str,
    prefix: &str,
    fallback_database: &str,
) -> (String, String) {
    let rest = scope.strip_prefix(prefix).unwrap_or_default();
    split_database_collection(rest, fallback_database)
}

fn split_database_collection(rest: &str, fallback_database: &str) -> (String, String) {
    match rest.split_once(':') {
        Some((database_name, collection_name)) => {
            (database_name.to_string(), collection_name.to_string())
        }
        None => (fallback_database.to_string(), rest.to_string()),
    }
}

fn bson_type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "document",
        Bson::Boolean(_) => "boolean",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) => "javascript",
        Bson::JavaScriptCodeWithScope(_) => "javascriptWithScope",
        Bson::Int32(_) => "int32",
        Bson::Int64(_) => "int64",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "dateTime",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binary",
        Bson::Decimal128(_) => "decimal128",
        _ => "value",
    }
}

fn mongodb_find_query_template_for_database(
    database_name: &str,
    collection_name: &str,
    limit: u32,
) -> String {
    serde_json::to_string_pretty(&json!({
        "database": database_name,
        "collection": collection_name,
        "filter": {},
        "limit": limit,
    }))
    .unwrap_or_else(|_| {
        format!(
            "{{\n  \"database\": \"{database_name}\",\n  \"collection\": \"{collection_name}\",\n  \"filter\": {{}},\n  \"limit\": {limit}\n}}"
        )
    })
}

fn mongodb_aggregation_query_template(database_name: &str, collection_name: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "database": database_name,
        "collection": collection_name,
        "pipeline": [
            { "$match": {} },
            { "$limit": 20 }
        ]
    }))
    .unwrap_or_default()
}

fn mongodb_command_query_template(database_name: &str, command: Document) -> String {
    serde_json::to_string_pretty(&json!({
        "database": database_name,
        "command": command,
    }))
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        collection_info_payload, gridfs_buckets_from_infos, infer_schema_fields,
        is_gridfs_collection, mongodb_collection_children, mongodb_collection_node,
        mongodb_database_children, mongodb_root_database_nodes, MongoCollectionInfo,
    };
    use crate::domain::models::ResolvedConnectionProfile;
    use mongodb::bson::doc;

    #[test]
    fn mongodb_root_nodes_separate_user_and_system_databases() {
        let connection = resolved_connection(None);
        let nodes = mongodb_root_database_nodes(
            &connection,
            vec!["admin".into(), "catalog".into(), "local".into()],
            100,
        );

        assert_eq!(nodes[0].label, "catalog");
        assert_eq!(nodes[0].scope.as_deref(), Some("database:catalog"));
        assert_eq!(nodes[1].label, "admin");
        assert_eq!(
            nodes[1].path.as_ref().unwrap(),
            &vec!["System Databases".to_string()]
        );
    }

    #[test]
    fn mongodb_database_children_use_native_mongo_sections() {
        let connection = resolved_connection(Some("catalog"));
        let nodes = mongodb_database_children(&connection, "catalog");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Collections",
                "Views",
                "Time Series Collections",
                "Capped Collections",
                "GridFS",
                "Search Indexes",
                "Vector Indexes",
                "Users",
                "Roles",
                "Database Statistics",
            ]
        );
        assert_eq!(nodes[0].scope.as_deref(), Some("collections:catalog"));
    }

    #[test]
    fn mongodb_collection_children_expose_documents_schema_indexes_validation_and_aggregations() {
        let connection = resolved_connection(Some("catalog"));
        let nodes = mongodb_collection_children(&connection, "catalog", "products");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Documents",
                "Schema Preview",
                "Indexes",
                "Validation Rules",
                "Aggregations",
                "Statistics",
                "Permissions",
                "Scripts",
            ]
        );
        assert_eq!(
            nodes[0].scope.as_deref(),
            Some("collection:catalog:products")
        );
        assert!(nodes[0]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("\"database\": \"catalog\""));
        let validation_template = nodes
            .iter()
            .find(|node| node.kind == "validation-rules")
            .and_then(|node| node.query_template.as_deref())
            .unwrap_or_default();
        assert!(validation_template.contains("listCollections"));
        assert!(!validation_template.contains("collMod"));
    }

    #[test]
    fn mongodb_collection_nodes_have_database_scoped_queries() {
        let connection = resolved_connection(Some("catalog"));
        let node = mongodb_collection_node(&connection, "products");
        assert_eq!(node.scope.as_deref(), Some("collection:catalog:products"));
        assert_eq!(node.expandable, Some(true));
        assert!(node
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("\"collection\": \"products\""));
    }

    #[test]
    fn mongodb_schema_preview_infers_nested_bson_fields() {
        let fields = infer_schema_fields(&[
            doc! {
                "_id": "p1",
                "sku": "luna-lamp",
                "inventory": { "available": 3_i32 },
            },
            doc! {
                "_id": "p2",
                "sku": "aurora-desk",
                "inventory": { "available": 8_i64 },
            },
        ]);
        let paths = fields
            .iter()
            .map(|field| field["path"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();

        assert!(paths.contains(&"_id"));
        assert!(paths.contains(&"inventory"));
        assert!(paths.contains(&"inventory.available"));
        let inventory = fields
            .iter()
            .find(|field| field["path"] == "inventory.available")
            .unwrap();
        assert_eq!(inventory["presenceCount"], 2);
        assert_eq!(inventory["typeDistribution"]["int32"], 1);
        assert_eq!(inventory["typeDistribution"]["int64"], 1);
        let sku = fields.iter().find(|field| field["path"] == "sku").unwrap();
        assert_eq!(sku["examples"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn mongodb_database_overview_helpers_classify_collections() {
        let infos = vec![
            MongoCollectionInfo {
                name: "products".into(),
                collection_type: "collection".into(),
                options: doc! {},
            },
            MongoCollectionInfo {
                name: "fs.files".into(),
                collection_type: "collection".into(),
                options: doc! {},
            },
            MongoCollectionInfo {
                name: "active_products".into(),
                collection_type: "view".into(),
                options: doc! { "pipeline": [{ "$match": { "active": true } }] },
            },
        ];

        assert!(!is_gridfs_collection(&infos[0].name));
        assert!(is_gridfs_collection(&infos[1].name));
        assert_eq!(gridfs_buckets_from_infos(&infos)[0]["name"], "fs");
        let view = collection_info_payload(&infos[2]);
        assert_eq!(view["name"], "active_products");
        assert_eq!(view["pipeline"].as_array().unwrap().len(), 1);
    }

    fn resolved_connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-mongo".into(),
            name: "Mongo".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            host: "127.0.0.1".into(),
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
}
