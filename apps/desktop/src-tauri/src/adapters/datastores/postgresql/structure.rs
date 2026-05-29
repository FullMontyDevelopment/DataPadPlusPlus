use std::collections::BTreeMap;

use sqlx::Row;

use super::super::super::*;
use super::connection::postgres_dsn;

pub(crate) async fn load_postgres_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(120);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let rows = sqlx::query(&format!(
        "select c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema not in ('information_schema', 'pg_catalog')
         order by c.table_schema, c.table_name, c.ordinal_position
         limit {}",
        limit + 1
    ))
    .fetch_all(&pool)
    .await?;
    let pk_rows = sqlx::query(
        "select kcu.table_schema, kcu.table_name, kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
         where tc.constraint_type = 'PRIMARY KEY'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    let fk_rows = sqlx::query(
        "select kcu.table_schema, kcu.table_name, kcu.column_name,
                ccu.table_schema as foreign_table_schema,
                ccu.table_name as foreign_table_name,
                ccu.column_name as foreign_column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         where tc.constraint_type = 'FOREIGN KEY'",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    pool.close().await;

    let mut primary_keys = Vec::new();
    for row in pk_rows {
        primary_keys.push(format!(
            "{}.{}.{}",
            row.get::<String, _>("table_schema"),
            row.get::<String, _>("table_name"),
            row.get::<String, _>("column_name")
        ));
    }

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
            detail: Some("PostgreSQL schema".into()),
            color: None,
        });
        let node = nodes.entry(node_id.clone()).or_insert(StructureNode {
            id: node_id.clone(),
            family: "sql".into(),
            label: table.clone(),
            kind: row.get::<String, _>("table_type").to_lowercase(),
            group_id: Some(schema.clone()),
            detail: Some(format!("{schema}.{table}")),
            database: connection.database.clone(),
            schema: Some(schema.clone()),
            object_name: Some(table.clone()),
            qualified_name: Some(format!("{schema}.{table}")),
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
        let column = row.get::<String, _>("column_name");
        node.fields.push(structure_field(
            column.clone(),
            row.get::<String, _>("data_type"),
            None,
            Some(row.get::<String, _>("is_nullable") == "YES"),
            Some(primary_keys.contains(&format!("{node_id}.{column}"))),
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
                row.get::<String, _>("foreign_table_schema"),
                row.get::<String, _>("foreign_table_name")
            );
            StructureEdge {
                id: format!(
                    "{from}:{}->{to}:{}",
                    row.get::<String, _>("column_name"),
                    row.get::<String, _>("foreign_column_name")
                ),
                from,
                to,
                label: format!(
                    "{} -> {}",
                    row.get::<String, _>("column_name"),
                    row.get::<String, _>("foreign_column_name")
                ),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(row.get::<String, _>("column_name")),
                to_field: Some(row.get::<String, _>("foreign_column_name")),
                constraint_name: None,
                cardinality: Some("many-to-one".into()),
                delete_rule: None,
                update_rule: None,
                confidence: Some(1.0),
            }
        })
        .collect::<Vec<StructureEdge>>();

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} PostgreSQL object(s).", nodes.len()),
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
