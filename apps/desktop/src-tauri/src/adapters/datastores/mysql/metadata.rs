use std::collections::BTreeMap;

use sqlx::Row;

use super::super::super::*;
use super::connection::mysql_dsn;

pub(crate) async fn load_mysql_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(120);
    let schema = connection.database.clone().unwrap_or_default();
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
    let rows = sqlx::query(&format!(
        "select c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable, c.column_key
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = '{}'
         order by c.table_schema, c.table_name, c.ordinal_position
         limit {}",
        sql_literal(&schema),
        limit + 1
    ))
    .fetch_all(&pool)
    .await?;
    let fk_rows = sqlx::query(&format!(
        "select table_schema, table_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name
         from information_schema.key_column_usage
         where table_schema = '{}' and referenced_table_name is not null",
        sql_literal(&schema)
    ))
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    pool.close().await;

    let mut groups = BTreeMap::<String, StructureGroup>::new();
    let mut nodes = BTreeMap::<String, StructureNode>::new();
    for row in rows.iter().take(limit as usize) {
        let schema = row.get::<String, _>("table_schema");
        let table = row.get::<String, _>("table_name");
        let node_id = format!("{schema}.{table}");
        groups.entry(schema.clone()).or_insert(StructureGroup {
            id: schema.clone(),
            label: schema.clone(),
            kind: "schema".into(),
            detail: Some(format!("{} schema", connection.engine)),
            color: None,
        });
        let node = nodes.entry(node_id.clone()).or_insert(StructureNode {
            id: node_id,
            family: "sql".into(),
            label: table.clone(),
            kind: row.get::<String, _>("table_type").to_lowercase(),
            group_id: Some(schema),
            detail: Some(table),
            database: connection.database.clone(),
            schema: Some(row.get::<String, _>("table_schema")),
            object_name: Some(row.get::<String, _>("table_name")),
            qualified_name: Some(format!(
                "{}.{}",
                row.get::<String, _>("table_schema"),
                row.get::<String, _>("table_name")
            )),
            column_count: None,
            relationship_count: None,
            row_count_estimate: None,
            index_count: None,
            is_system: Some(false),
            is_view: Some(
                row.get::<String, _>("table_type")
                    .to_lowercase()
                    .contains("view"),
            ),
            metrics: Vec::new(),
            fields: Vec::new(),
            sample: None,
        });
        node.fields.push(structure_field(
            row.get::<String, _>("column_name"),
            row.get::<String, _>("data_type"),
            None,
            Some(row.get::<String, _>("is_nullable") == "YES"),
            Some(row.get::<String, _>("column_key") == "PRI"),
        ));
    }
    let edges = fk_rows
        .into_iter()
        .map(|row| {
            let from = format!(
                "{}.{}",
                row.get::<String, _>("table_schema"),
                row.get::<String, _>("table_name")
            );
            let to = format!(
                "{}.{}",
                row.get::<String, _>("referenced_table_schema"),
                row.get::<String, _>("referenced_table_name")
            );
            StructureEdge {
                id: format!("{from}->{}", row.get::<String, _>("referenced_column_name")),
                from,
                to,
                label: format!(
                    "{} -> {}",
                    row.get::<String, _>("column_name"),
                    row.get::<String, _>("referenced_column_name")
                ),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(row.get::<String, _>("column_name")),
                to_field: Some(row.get::<String, _>("referenced_column_name")),
                constraint_name: None,
                cardinality: Some("many-to-one".into()),
                delete_rule: None,
                update_rule: None,
                confidence: Some(1.0),
            }
        })
        .collect();

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} {} object(s).", nodes.len(), connection.engine),
            groups: groups.into_values().collect(),
            nodes: nodes.into_values().collect(),
            edges,
            metrics: vec![structure_metric(
                "Objects",
                nodes_count_hint(limit, rows.len()),
            )],
            truncated: rows.len() > limit as usize,
        },
    ))
}
