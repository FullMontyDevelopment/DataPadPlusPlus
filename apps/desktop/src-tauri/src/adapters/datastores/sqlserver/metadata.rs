use std::collections::BTreeMap;

use super::super::super::*;
use super::connection::sqlserver_client;

pub(crate) async fn load_sqlserver_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(120);
    let mut client = sqlserver_client(connection).await?;
    let rows = client
        .simple_query(format!(
            "select top ({}) c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable
             from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             order by c.table_schema, c.table_name, c.ordinal_position",
            limit + 1
        ))
        .await?
        .into_first_result()
        .await?;
    let fk_rows = match client
        .simple_query(
            "select schema_name(fk.schema_id) as table_schema,
                    object_name(fkc.parent_object_id) as table_name,
                    col_name(fkc.parent_object_id, fkc.parent_column_id) as column_name,
                    schema_name(ro.schema_id) as foreign_table_schema,
                    object_name(fkc.referenced_object_id) as foreign_table_name,
                    col_name(fkc.referenced_object_id, fkc.referenced_column_id) as foreign_column_name
             from sys.foreign_key_columns fkc
             join sys.foreign_keys fk on fk.object_id = fkc.constraint_object_id
             join sys.objects ro on ro.object_id = fkc.referenced_object_id",
        )
        .await
    {
        Ok(stream) => stream.into_first_result().await.unwrap_or_default(),
        Err(_) => Vec::new(),
    };

    let mut groups = BTreeMap::<String, StructureGroup>::new();
    let mut nodes = BTreeMap::<String, StructureNode>::new();
    for row in rows.iter().take(limit as usize) {
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
        let node = nodes.entry(node_id.clone()).or_insert(StructureNode {
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
            column_count: None,
            relationship_count: None,
            row_count_estimate: None,
            index_count: None,
            is_system: Some(false),
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
        node.fields.push(structure_field(
            row.get::<&str, _>("column_name").unwrap_or_default(),
            row.get::<&str, _>("data_type").unwrap_or_default(),
            None,
            Some(row.get::<&str, _>("is_nullable").unwrap_or("YES") == "YES"),
            None,
        ));
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
            summary: format!("Loaded {} SQL Server object(s).", nodes.len()),
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
