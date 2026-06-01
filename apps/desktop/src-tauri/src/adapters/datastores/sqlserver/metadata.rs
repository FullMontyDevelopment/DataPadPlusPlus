use std::collections::BTreeMap;

use super::super::super::*;
use super::connection::sqlserver_client;

pub(crate) async fn load_sqlserver_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let node_limit = structure_node_limit(request, 320);
    let edge_limit = structure_edge_limit(request, 1_000);
    let include_system = request.include_system_objects.unwrap_or(false);
    let mut client = sqlserver_client(connection).await?;
    let system_filter = if include_system {
        ""
    } else {
        "and s.name <> 'sys' and o.is_ms_shipped = 0"
    };
    let table_rows = client
        .simple_query(format!(
            "select top ({}) s.name as table_schema,
                    o.name as table_name,
                    case when o.type = 'V' then 'view' else lower(replace(o.type_desc, '_', '-')) end as table_type,
                    cast(isnull(sum(case when p.index_id in (0, 1) then p.rows else 0 end), 0) as bigint) as row_count,
                    cast((select count(*) from sys.indexes i where i.object_id = o.object_id and i.name is not null) as int) as index_count,
                    case when s.name = 'sys' or o.is_ms_shipped = 1 then 'YES' else 'NO' end as is_system
             from sys.objects o
             join sys.schemas s on s.schema_id = o.schema_id
             left join sys.partitions p on p.object_id = o.object_id
             where o.type in ('U', 'V') {system_filter}
             group by s.name, o.name, o.type, o.type_desc, o.object_id, o.is_ms_shipped
             order by s.name, o.name",
            node_limit + 1
        ))
        .await?
        .into_first_result()
        .await?;

    let table_pairs = table_rows
        .iter()
        .take(node_limit as usize)
        .map(|row| {
            (
                row.get::<&str, _>("table_schema")
                    .unwrap_or("dbo")
                    .to_string(),
                row.get::<&str, _>("table_name")
                    .unwrap_or_default()
                    .to_string(),
            )
        })
        .collect::<Vec<_>>();
    let table_filter = sqlserver_table_filter("s", "o", &table_pairs);
    let column_rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        client
            .simple_query(format!(
                "select s.name as table_schema,
                        o.name as table_name,
                        c.name as column_name,
                        t.name as data_type,
                        case when c.is_nullable = 1 then 'YES' else 'NO' end as is_nullable,
                        c.column_id,
                        case when exists (
                          select 1
                          from sys.index_columns ic
                          join sys.indexes i on i.object_id = ic.object_id and i.index_id = ic.index_id
                          where ic.object_id = c.object_id and ic.column_id = c.column_id and i.is_primary_key = 1
                        ) then 1 else 0 end as is_primary,
                        case when exists (
                          select 1
                          from sys.index_columns ic
                          join sys.indexes i on i.object_id = ic.object_id and i.index_id = ic.index_id
                          where ic.object_id = c.object_id and ic.column_id = c.column_id and i.name is not null
                        ) then 1 else 0 end as is_indexed
                 from sys.columns c
                 join sys.types t on c.user_type_id = t.user_type_id
                 join sys.objects o on c.object_id = o.object_id
                 join sys.schemas s on o.schema_id = s.schema_id
                 where {table_filter}
                 order by s.name, o.name, c.column_id",
            ))
            .await?
            .into_first_result()
            .await?
    };
    let fk_filter = sqlserver_table_filter("ps", "po", &table_pairs);
    let fk_rows = if table_pairs.is_empty() {
        Vec::new()
    } else {
        match client
            .simple_query(format!(
                "select top ({edge_limit}) fk.name as constraint_name,
                        ps.name as table_schema,
                        po.name as table_name,
                        pc.name as column_name,
                        rs.name as foreign_table_schema,
                        ro.name as foreign_table_name,
                        rc.name as foreign_column_name,
                        case when pc.is_nullable = 1 then 'YES' else 'NO' end as is_nullable,
                        fk.delete_referential_action_desc,
                        fk.update_referential_action_desc
                 from sys.foreign_key_columns fkc
                 join sys.foreign_keys fk on fk.object_id = fkc.constraint_object_id
                 join sys.objects po on po.object_id = fkc.parent_object_id
                 join sys.schemas ps on ps.schema_id = po.schema_id
                 join sys.columns pc on pc.object_id = fkc.parent_object_id and pc.column_id = fkc.parent_column_id
                 join sys.objects ro on ro.object_id = fkc.referenced_object_id
                 join sys.schemas rs on rs.schema_id = ro.schema_id
                 join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
                 where {fk_filter}
                 order by ps.name, po.name, fk.name",
            ))
        .await
    {
        Ok(stream) => stream.into_first_result().await.unwrap_or_default(),
        Err(_) => Vec::new(),
    }
    };

    let mut groups = BTreeMap::<String, StructureGroup>::new();
    let mut nodes = BTreeMap::<String, StructureNode>::new();
    for row in table_rows.iter().take(node_limit as usize) {
        let schema = row
            .get::<&str, _>("table_schema")
            .unwrap_or("dbo")
            .to_string();
        let table = row
            .get::<&str, _>("table_name")
            .unwrap_or_default()
            .to_string();
        let node_id = format!("{schema}.{table}");
        groups.entry(schema.clone()).or_insert(StructureGroup {
            id: schema.clone(),
            label: schema.clone(),
            kind: "schema".into(),
            detail: Some("SQL Server schema".into()),
            color: None,
        });
        nodes.entry(node_id.clone()).or_insert(StructureNode {
            id: node_id,
            family: "sql".into(),
            label: table.clone(),
            kind: row
                .get::<&str, _>("table_type")
                .unwrap_or("table")
                .to_lowercase(),
            group_id: Some(schema),
            detail: Some(table),
            database: connection.database.clone(),
            schema: Some(
                row.get::<&str, _>("table_schema")
                    .unwrap_or("dbo")
                    .to_string(),
            ),
            object_name: Some(
                row.get::<&str, _>("table_name")
                    .unwrap_or_default()
                    .to_string(),
            ),
            qualified_name: Some(format!(
                "{}.{}",
                row.get::<&str, _>("table_schema").unwrap_or("dbo"),
                row.get::<&str, _>("table_name").unwrap_or_default()
            )),
            column_count: Some(0),
            relationship_count: None,
            row_count_estimate: Some(
                row.get::<i64, _>("row_count").unwrap_or_default().max(0) as u64
            ),
            index_count: Some(row.get::<i32, _>("index_count").unwrap_or_default().max(0) as u32),
            is_system: Some(row.get::<&str, _>("is_system").unwrap_or("NO") == "YES"),
            is_view: Some(
                row.get::<&str, _>("table_type")
                    .unwrap_or("table")
                    .to_lowercase()
                    .contains("view"),
            ),
            metrics: Vec::new(),
            fields: Vec::new(),
            sample: None,
        });
    }

    for row in column_rows {
        let node_id = format!(
            "{}.{}",
            row.get::<&str, _>("table_schema").unwrap_or("dbo"),
            row.get::<&str, _>("table_name").unwrap_or_default()
        );
        if let Some(node) = nodes.get_mut(&node_id) {
            node.fields.push(structure_field_with_flags(
                row.get::<&str, _>("column_name").unwrap_or_default(),
                row.get::<&str, _>("data_type").unwrap_or_default(),
                None,
                Some(row.get::<&str, _>("is_nullable").unwrap_or("YES") == "YES"),
                Some(row.get::<i32, _>("is_primary").unwrap_or_default() > 0),
                Some(row.get::<i32, _>("column_id").unwrap_or_default().max(0) as u32),
                Some(row.get::<i32, _>("is_indexed").unwrap_or_default() > 0),
            ));
        }
    }

    let edges = fk_rows
        .into_iter()
        .map(|row| {
            let from = format!(
                "{}.{}",
                row.get::<&str, _>("table_schema").unwrap_or("dbo"),
                row.get::<&str, _>("table_name").unwrap_or_default()
            );
            let to = format!(
                "{}.{}",
                row.get::<&str, _>("foreign_table_schema").unwrap_or("dbo"),
                row.get::<&str, _>("foreign_table_name").unwrap_or_default()
            );
            StructureEdge {
                id: format!(
                    "{from}:{}->{to}:{}",
                    row.get::<&str, _>("column_name").unwrap_or_default(),
                    row.get::<&str, _>("foreign_column_name")
                        .unwrap_or_default()
                ),
                from,
                to,
                label: format!(
                    "{} -> {}",
                    row.get::<&str, _>("column_name").unwrap_or_default(),
                    row.get::<&str, _>("foreign_column_name")
                        .unwrap_or_default()
                ),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(
                    row.get::<&str, _>("column_name")
                        .unwrap_or_default()
                        .to_string(),
                ),
                to_field: Some(
                    row.get::<&str, _>("foreign_column_name")
                        .unwrap_or_default()
                        .to_string(),
                ),
                constraint_name: Some(
                    row.get::<&str, _>("constraint_name")
                        .unwrap_or_default()
                        .to_string(),
                ),
                cardinality: Some(sql_relationship_cardinality(Some(
                    row.get::<&str, _>("is_nullable").unwrap_or("YES") == "YES",
                ))),
                delete_rule: Some(
                    row.get::<&str, _>("delete_referential_action_desc")
                        .unwrap_or_default()
                        .to_string(),
                ),
                update_rule: Some(
                    row.get::<&str, _>("update_referential_action_desc")
                        .unwrap_or_default()
                        .to_string(),
                ),
                confidence: Some(1.0),
            }
        })
        .collect::<Vec<StructureEdge>>();
    update_sql_relationship_counts(&mut nodes, &edges);

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} SQL Server object(s).", nodes.len()),
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

fn sqlserver_table_filter(
    schema_alias: &str,
    table_alias: &str,
    table_pairs: &[(String, String)],
) -> String {
    if table_pairs.is_empty() {
        return "1 = 0".into();
    }

    table_pairs
        .iter()
        .map(|(schema, table)| {
            format!(
                "({schema_alias}.name = '{}' and {table_alias}.name = '{}')",
                sql_literal(schema),
                sql_literal(table)
            )
        })
        .collect::<Vec<_>>()
        .join(" or ")
}
