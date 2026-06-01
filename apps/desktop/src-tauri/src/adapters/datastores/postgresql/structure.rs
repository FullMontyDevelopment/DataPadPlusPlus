use std::collections::BTreeMap;

use sqlx::Row;

use super::super::super::*;
use super::connection::postgres_dsn;

pub(crate) async fn load_postgres_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let node_limit = structure_node_limit(request, 320);
    let edge_limit = structure_edge_limit(request, 1_000);
    let include_system = request.include_system_objects.unwrap_or(false);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let system_filter = if include_system {
        ""
    } else {
        "where t.table_schema not in ('information_schema', 'pg_catalog', 'pg_toast')"
    };
    let table_rows = sqlx::query(&format!(
        "select t.table_schema, t.table_name, t.table_type
         from information_schema.tables t
         {system_filter}
         order by t.table_schema, t.table_name
         limit {}",
        node_limit + 1
    ))
    .fetch_all(&pool)
    .await?;
    let table_pairs = table_rows
        .iter()
        .take(node_limit as usize)
        .map(|row| {
            (
                row.get::<String, _>("table_schema"),
                row.get::<String, _>("table_name"),
            )
        })
        .collect::<Vec<_>>();
    let table_filter = postgres_table_filter("c.table_schema", "c.table_name", &table_pairs);
    let rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        sqlx::query(&format!(
            "select c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable, c.ordinal_position
             from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             where {table_filter}
             order by c.table_schema, c.table_name, c.ordinal_position",
        ))
        .fetch_all(&pool)
        .await?
    };
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
    let fk_filter = postgres_table_filter("kcu.table_schema", "kcu.table_name", &table_pairs);
    let fk_rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        sqlx::query(&format!(
            "select tc.constraint_name,
                    kcu.table_schema,
                    kcu.table_name,
                    kcu.column_name,
                    ccu.table_schema as foreign_table_schema,
                    ccu.table_name as foreign_table_name,
                    ccu.column_name as foreign_column_name,
                    c.is_nullable,
                    rc.delete_rule,
                    rc.update_rule
             from information_schema.table_constraints tc
             join information_schema.key_column_usage kcu
               on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
             join information_schema.constraint_column_usage ccu
               on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
             left join information_schema.referential_constraints rc
               on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
             left join information_schema.columns c
               on c.table_schema = kcu.table_schema and c.table_name = kcu.table_name and c.column_name = kcu.column_name
             where tc.constraint_type = 'FOREIGN KEY' and ({fk_filter})
             limit {edge_limit}",
        ))
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };
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
    for row in table_rows.iter().take(node_limit as usize) {
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
        nodes.entry(node_id.clone()).or_insert(StructureNode {
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
            column_count: Some(0),
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
    }

    for row in rows {
        let schema = row.get::<String, _>("table_schema");
        let table = row.get::<String, _>("table_name");
        let node_id = format!("{schema}.{table}");
        let Some(node) = nodes.get_mut(&node_id) else {
            continue;
        };
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
                constraint_name: Some(row.get::<String, _>("constraint_name")),
                cardinality: Some(sql_relationship_cardinality(Some(
                    row.try_get::<String, _>("is_nullable")
                        .unwrap_or_else(|_| "YES".into())
                        == "YES",
                ))),
                delete_rule: row.try_get::<String, _>("delete_rule").ok(),
                update_rule: row.try_get::<String, _>("update_rule").ok(),
                confidence: Some(1.0),
            }
        })
        .collect::<Vec<StructureEdge>>();
    update_sql_relationship_counts(&mut nodes, &edges);

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
                nodes_count_hint(node_limit, table_rows.len()),
            )],
            truncated: table_rows.len() > node_limit as usize,
        },
    ))
}

fn postgres_table_filter(
    schema_expr: &str,
    table_expr: &str,
    table_pairs: &[(String, String)],
) -> String {
    if table_pairs.is_empty() {
        return "false".into();
    }

    table_pairs
        .iter()
        .map(|(schema, table)| {
            format!(
                "({schema_expr} = '{}' and {table_expr} = '{}')",
                sql_literal(schema),
                sql_literal(table)
            )
        })
        .collect::<Vec<_>>()
        .join(" or ")
}
