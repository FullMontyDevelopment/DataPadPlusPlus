use std::collections::BTreeMap;

use sqlx::Row;

use super::super::super::*;
use super::connection::sqlite_pool;

pub(crate) async fn load_sqlite_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let node_limit = structure_node_limit(request, 320);
    let edge_limit = structure_edge_limit(request, 1_000);
    let include_system = request.include_system_objects.unwrap_or(false);
    let pool = sqlite_pool(connection).await?;
    let system_filter = if include_system {
        ""
    } else {
        "and name not like 'sqlite_%'"
    };
    let objects = sqlx::query(&format!(
        "select name, type from sqlite_master where type in ('table', 'view') {system_filter} order by name limit {}",
        node_limit + 1
    ))
    .fetch_all(&pool)
    .await?;
    let mut nodes = BTreeMap::<String, StructureNode>::new();
    let mut edges = Vec::new();
    for row in objects.iter().take(node_limit as usize) {
        let name = row.get::<String, _>("name");
        let object_type = row.get::<String, _>("type");
        let columns = sqlx::query(&format!("pragma table_info('{}')", sql_literal(&name)))
            .fetch_all(&pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|column| {
                structure_field_with_flags(
                    column.get::<String, _>("name"),
                    column.get::<String, _>("type"),
                    None,
                    Some(column.try_get::<i64, _>("notnull").unwrap_or_default() == 0),
                    Some(column.try_get::<i64, _>("pk").unwrap_or_default() > 0),
                    column
                        .try_get::<i64, _>("cid")
                        .ok()
                        .map(|value| value.max(0) as u32),
                    Some(column.try_get::<i64, _>("pk").unwrap_or_default() > 0),
                )
            })
            .collect::<Vec<StructureField>>();
        for fk in sqlx::query(&format!(
            "pragma foreign_key_list('{}')",
            sql_literal(&name)
        ))
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .take(edge_limit as usize)
        {
            let target = fk.get::<String, _>("table");
            let from_field = fk.get::<String, _>("from");
            let nullable = columns
                .iter()
                .find(|column| column.name == from_field)
                .and_then(|column| column.nullable);
            edges.push(StructureEdge {
                id: format!(
                    "{}:{}->{}:{}",
                    name,
                    from_field,
                    target,
                    fk.get::<String, _>("to")
                ),
                from: name.clone(),
                to: target,
                label: format!("{} -> {}", from_field, fk.get::<String, _>("to")),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(from_field),
                to_field: Some(fk.get::<String, _>("to")),
                constraint_name: None,
                cardinality: Some(sql_relationship_cardinality(nullable)),
                delete_rule: fk.try_get::<String, _>("on_delete").ok(),
                update_rule: fk.try_get::<String, _>("on_update").ok(),
                confidence: Some(1.0),
            });
        }
        nodes.insert(
            name.clone(),
            StructureNode {
                id: name.clone(),
                family: "sql".into(),
                label: name.clone(),
                kind: object_type,
                group_id: Some("main".into()),
                detail: Some("SQLite object".into()),
                database: connection.database.clone(),
                schema: Some("main".into()),
                object_name: Some(name.clone()),
                qualified_name: Some(format!("main.{name}")),
                column_count: Some(columns.len() as u32),
                relationship_count: None,
                row_count_estimate: None,
                index_count: None,
                is_system: Some(false),
                is_view: None,
                metrics: Vec::new(),
                fields: columns,
                sample: None,
            },
        );
    }
    pool.close().await;
    update_sql_relationship_counts(&mut nodes, &edges);

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} SQLite object(s).", nodes.len()),
            groups: vec![StructureGroup {
                id: "main".into(),
                label: "main".into(),
                kind: "database".into(),
                detail: connection.database.clone(),
                color: None,
            }],
            nodes: nodes.into_values().collect(),
            edges,
            metrics: vec![structure_metric(
                "Objects",
                nodes_count_hint(node_limit, objects.len()),
            )],
            truncated: objects.len() > node_limit as usize,
        },
    ))
}
