use std::collections::BTreeMap;

use sqlx::Row;

use super::super::super::*;
use super::connection::mysql_dsn;

pub(crate) async fn load_mysql_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let node_limit = structure_node_limit(request, 320);
    let edge_limit = structure_edge_limit(request, 1_000);
    let include_system = request.include_system_objects.unwrap_or(false);
    let schema = connection.database.clone().unwrap_or_default();
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
    let schema_filter = mysql_schema_filter("t.table_schema", &schema, include_system);
    let table_rows = sqlx::query(&format!(
        "select t.table_schema,
                t.table_name,
                t.table_type,
                t.table_rows,
                coalesce(s.index_count, 0) as index_count
         from information_schema.tables t
         left join (
           select table_schema, table_name, count(distinct index_name) as index_count
           from information_schema.statistics
           group by table_schema, table_name
         ) s on s.table_schema = t.table_schema and s.table_name = t.table_name
         where {schema_filter}
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
    let table_filter = mysql_table_filter("c.table_schema", "c.table_name", &table_pairs);
    let rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        sqlx::query(&format!(
            "select c.table_schema,
                    c.table_name,
                    t.table_type,
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.column_key,
                    c.ordinal_position,
                    max(case when s.index_name is null then 0 else 1 end) as is_indexed
             from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             left join information_schema.statistics s on s.table_schema = c.table_schema and s.table_name = c.table_name and s.column_name = c.column_name
             where {table_filter}
             group by c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable, c.column_key, c.ordinal_position
             order by c.table_schema, c.table_name, c.ordinal_position",
        ))
        .fetch_all(&pool)
        .await?
    };
    let fk_filter = mysql_table_filter("kcu.table_schema", "kcu.table_name", &table_pairs);
    let fk_rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        sqlx::query(&format!(
            "select kcu.constraint_name,
                    kcu.table_schema,
                    kcu.table_name,
                    kcu.column_name,
                    kcu.referenced_table_schema,
                    kcu.referenced_table_name,
                    kcu.referenced_column_name,
                    c.is_nullable,
                    rc.delete_rule,
                    rc.update_rule
             from information_schema.key_column_usage kcu
             left join information_schema.columns c
               on c.table_schema = kcu.table_schema and c.table_name = kcu.table_name and c.column_name = kcu.column_name
             left join information_schema.referential_constraints rc
               on rc.constraint_schema = kcu.table_schema and rc.constraint_name = kcu.constraint_name
             where kcu.referenced_table_name is not null and ({fk_filter})
             limit {edge_limit}",
        ))
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };
    pool.close().await;

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
            detail: Some(format!("{} schema", connection.engine)),
            color: None,
        });
        nodes.entry(node_id.clone()).or_insert(StructureNode {
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
            column_count: Some(0),
            relationship_count: None,
            row_count_estimate: row
                .try_get::<i64, _>("table_rows")
                .ok()
                .map(|value| value.max(0) as u64),
            index_count: row
                .try_get::<i64, _>("index_count")
                .ok()
                .map(|value| value.max(0) as u32),
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
        let node_id = format!(
            "{}.{}",
            row.get::<String, _>("table_schema"),
            row.get::<String, _>("table_name")
        );
        if let Some(node) = nodes.get_mut(&node_id) {
            node.fields.push(structure_field_with_flags(
                row.get::<String, _>("column_name"),
                row.get::<String, _>("data_type"),
                None,
                Some(row.get::<String, _>("is_nullable") == "YES"),
                Some(row.get::<String, _>("column_key") == "PRI"),
                row.try_get::<i64, _>("ordinal_position")
                    .ok()
                    .map(|value| value.max(0) as u32),
                Some(row.try_get::<i64, _>("is_indexed").unwrap_or_default() > 0),
            ));
        }
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
            summary: format!("Loaded {} {} object(s).", nodes.len(), connection.engine),
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

fn mysql_schema_filter(schema_expr: &str, schema: &str, include_system: bool) -> String {
    if !schema.trim().is_empty() {
        return format!("{schema_expr} = '{}'", sql_literal(schema));
    }

    if include_system {
        return "1 = 1".into();
    }

    format!("{schema_expr} not in ('information_schema', 'mysql', 'performance_schema', 'sys')")
}

fn mysql_table_filter(
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
