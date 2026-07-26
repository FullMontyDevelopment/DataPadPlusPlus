use serde_json::json;

use super::explorer_discovery::MongoCollectionInfo;
use crate::domain::models::ExplorerNode;

pub(super) fn collection_node(database_name: &str, collection_name: &str) -> ExplorerNode {
    collection_node_in_group(
        database_name,
        collection_name,
        "Collections",
        "Documents, schema, indexes, validation, and aggregations",
    )
}

pub(super) fn collection_node_in_group(
    database_name: &str,
    collection_name: &str,
    group: &str,
    detail: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("collection:{database_name}:{collection_name}"),
        family: "document".into(),
        label: collection_name.into(),
        kind: "collection".into(),
        detail: detail.into(),
        scope: Some(format!("collection:{database_name}:{collection_name}")),
        path: Some(vec![database_name.into(), group.into()]),
        query_template: Some(find_query_template(database_name, collection_name, 20)),
        expandable: Some(true),
    }
}

pub(super) fn view_node(database_name: &str, info: &MongoCollectionInfo) -> ExplorerNode {
    ExplorerNode {
        id: format!("view:{database_name}:{}", info.name),
        family: "document".into(),
        label: info.name.clone(),
        kind: "view".into(),
        detail: "MongoDB collection view".into(),
        scope: Some(format!("view:{database_name}:{}", info.name)),
        path: Some(vec![database_name.into(), "Views".into()]),
        query_template: Some(find_query_template(database_name, &info.name, 20)),
        expandable: Some(true),
    }
}

fn find_query_template(database_name: &str, collection_name: &str, limit: u32) -> String {
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
