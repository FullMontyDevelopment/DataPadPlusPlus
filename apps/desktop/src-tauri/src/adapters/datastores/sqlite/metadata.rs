use sqlx::Row;

use super::super::super::*;
use super::connection::sqlite_pool;

pub(crate) async fn load_sqlite_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(120);
    let pool = sqlite_pool(connection).await?;
    let objects = sqlx::query(&format!(
        "select name, type from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by name limit {}",
        limit + 1
    ))
    .fetch_all(&pool)
    .await?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for row in objects.iter().take(limit as usize) {
        let name = row.get::<String, _>("name");
        let object_type = row.get::<String, _>("type");
        let columns = sqlx::query(&format!("pragma table_info('{}')", sql_literal(&name)))
            .fetch_all(&pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|column| {
                structure_field(
                    column.get::<String, _>("name"),
                    column.get::<String, _>("type"),
                    None,
                    Some(column.try_get::<i64, _>("notnull").unwrap_or_default() == 0),
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
        {
            let target = fk.get::<String, _>("table");
            edges.push(StructureEdge {
                id: format!(
                    "{}:{}->{}:{}",
                    name,
                    fk.get::<String, _>("from"),
                    target,
                    fk.get::<String, _>("to")
                ),
                from: name.clone(),
                to: target,
                label: format!(
                    "{} -> {}",
                    fk.get::<String, _>("from"),
                    fk.get::<String, _>("to")
                ),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(fk.get::<String, _>("from")),
                to_field: Some(fk.get::<String, _>("to")),
                constraint_name: None,
                cardinality: Some("many-to-one".into()),
                delete_rule: None,
                update_rule: None,
                confidence: Some(1.0),
            });
        }
        nodes.push(StructureNode {
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
        });
    }
    pool.close().await;

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
            nodes,
            edges,
            metrics: vec![structure_metric(
                "Objects",
                nodes_count_hint(limit, objects.len()),
            )],
            truncated: objects.len() > limit as usize,
        },
    ))
}
