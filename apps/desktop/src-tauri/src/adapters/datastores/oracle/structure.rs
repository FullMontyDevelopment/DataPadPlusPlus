use std::collections::{BTreeMap, HashSet};

use super::super::super::*;
use super::explorer::oracle_schema_from_scope;
use super::session::{load_oracle_session_context, oracle_managed_response_rows};
use super::sidecar::{execute_oracle_managed_read, oracle_execution_runtime};

pub(super) async fn load_oracle_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    if oracle_execution_runtime(connection) != "managed" {
        return Err(CommandError::new(
            "oracle-structure-managed-required",
            "Live Oracle IntelliSense metadata requires the built-in Oracle runtime.",
        ));
    }

    let node_limit = structure_node_limit(request, 320);
    let edge_limit = structure_edge_limit(request, 1_000);
    let session = load_oracle_session_context(connection).await?;
    let scoped_schema = request
        .scope
        .as_deref()
        .and_then(|scope| oracle_schema_from_scope(connection, scope));
    let primary_schema = scoped_schema.as_deref().unwrap_or(&session.current_schema);
    let mut object_rows =
        load_oracle_structure_objects(connection, primary_schema, node_limit + 1).await?;
    let load_secondary_schemas = scoped_schema.is_none()
        && request.mode.as_deref() == Some("relationships")
        && object_rows.len() <= node_limit as usize;
    if load_secondary_schemas {
        let remaining = node_limit + 1 - object_rows.len() as u32;
        object_rows.extend(
            load_oracle_secondary_structure_objects(
                connection,
                primary_schema,
                remaining,
                request.include_system_objects.unwrap_or(false),
            )
            .await?,
        );
    }
    let selected = object_rows
        .iter()
        .take(node_limit as usize)
        .filter_map(|row| Some((row.first()?.clone(), row.get(1)?.clone())))
        .collect::<Vec<_>>();
    let filter = oracle_object_filter("owner", "table_name", &selected);
    let column_rows = if selected.is_empty() {
        Vec::new()
    } else {
        let query = format!(
            "select owner, table_name, column_name, data_type || case when data_type in ('VARCHAR2','CHAR','NVARCHAR2','NCHAR','RAW') then '(' || data_length || ')' when data_type = 'NUMBER' and data_precision is not null then '(' || data_precision || nvl2(data_scale, ',' || data_scale, '') || ')' else '' end, nullable, column_id from all_tab_columns where {filter} order by owner, table_name, column_id"
        );
        oracle_managed_response_rows(
            &execute_oracle_managed_read(connection, &query, 10_000).await?,
        )?
    };
    let primary_key_rows = if selected.is_empty() {
        Vec::new()
    } else {
        let query = format!(
            "select c.owner, c.table_name, cc.column_name from all_constraints c join all_cons_columns cc on cc.owner = c.owner and cc.constraint_name = c.constraint_name and cc.table_name = c.table_name where c.constraint_type = 'P' and ({})",
            oracle_object_filter("c.owner", "c.table_name", &selected)
        );
        oracle_managed_response_rows(
            &execute_oracle_managed_read(connection, &query, 10_000).await?,
        )?
    };
    let foreign_key_rows = if selected.is_empty() {
        Vec::new()
    } else {
        let query = format!(
            "select c.owner, c.table_name, cc.column_name, c.constraint_name, r.owner, r.table_name, rcc.column_name, c.delete_rule from all_constraints c join all_cons_columns cc on cc.owner = c.owner and cc.constraint_name = c.constraint_name and cc.table_name = c.table_name join all_constraints r on r.owner = c.r_owner and r.constraint_name = c.r_constraint_name join all_cons_columns rcc on rcc.owner = r.owner and rcc.constraint_name = r.constraint_name and rcc.position = cc.position where c.constraint_type = 'R' and ({}) and rownum <= {edge_limit} order by c.owner, c.table_name, c.constraint_name, cc.position",
            oracle_object_filter("c.owner", "c.table_name", &selected)
        );
        oracle_managed_response_rows(
            &execute_oracle_managed_read(connection, &query, edge_limit).await?,
        )?
    };

    let primary_keys = primary_key_rows
        .into_iter()
        .filter_map(|row| Some(format!("{}.{}.{}", row.first()?, row.get(1)?, row.get(2)?)))
        .collect::<HashSet<_>>();
    let mut groups = BTreeMap::<String, StructureGroup>::new();
    let mut nodes = BTreeMap::<String, StructureNode>::new();
    for row in object_rows.iter().take(node_limit as usize) {
        let Some(owner) = row.first() else { continue };
        let Some(name) = row.get(1) else { continue };
        let object_type = row.get(2).cloned().unwrap_or_else(|| "TABLE".into());
        let id = format!("{owner}.{name}");
        groups.entry(owner.clone()).or_insert(StructureGroup {
            id: owner.clone(),
            label: owner.clone(),
            kind: "schema".into(),
            detail: Some("Oracle schema".into()),
            color: None,
        });
        nodes.insert(
            id.clone(),
            StructureNode {
                id: id.clone(),
                family: "sql".into(),
                label: name.clone(),
                kind: object_type.to_lowercase().replace(' ', "-"),
                group_id: Some(owner.clone()),
                detail: Some(id.clone()),
                database: Some(session.database_label().to_string()),
                schema: Some(owner.clone()),
                object_name: Some(name.clone()),
                qualified_name: Some(id),
                column_count: Some(0),
                relationship_count: None,
                row_count_estimate: None,
                index_count: None,
                is_system: Some(is_oracle_system_owner(owner)),
                is_view: Some(object_type.contains("VIEW")),
                metrics: Vec::new(),
                fields: Vec::new(),
                sample: None,
            },
        );
    }

    for row in column_rows {
        let (Some(owner), Some(table), Some(column), Some(data_type)) =
            (row.first(), row.get(1), row.get(2), row.get(3))
        else {
            continue;
        };
        let id = format!("{owner}.{table}");
        let Some(node) = nodes.get_mut(&id) else {
            continue;
        };
        node.fields.push(structure_field(
            column.clone(),
            data_type.clone(),
            None,
            Some(row.get(4).map(String::as_str) != Some("N")),
            Some(primary_keys.contains(&format!("{id}.{column}"))),
        ));
    }

    let edges = foreign_key_rows
        .into_iter()
        .filter_map(|row| {
            let from = format!("{}.{}", row.first()?, row.get(1)?);
            let from_field = row.get(2)?.clone();
            let constraint = row.get(3)?.clone();
            let to = format!("{}.{}", row.get(4)?, row.get(5)?);
            let to_field = row.get(6)?.clone();
            if !nodes.contains_key(&from) || !nodes.contains_key(&to) {
                return None;
            }
            Some(StructureEdge {
                id: format!("{from}:{from_field}->{to}:{to_field}"),
                from,
                to,
                label: format!("{from_field} -> {to_field}"),
                kind: "foreign-key".into(),
                inferred: Some(false),
                from_field: Some(from_field),
                to_field: Some(to_field),
                constraint_name: Some(constraint),
                cardinality: None,
                delete_rule: row.get(7).cloned(),
                update_rule: None,
                confidence: Some(1.0),
            })
        })
        .collect::<Vec<_>>();
    update_sql_relationship_counts(&mut nodes, &edges);
    let truncated = object_rows.len() > node_limit as usize;
    let object_count = nodes.len();
    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!(
                "Loaded {object_count} Oracle object(s) from container {} with current schema {}.",
                session.database_label(),
                session.current_schema
            ),
            groups: groups.into_values().collect(),
            nodes: nodes.into_values().collect(),
            edges,
            metrics: vec![structure_metric("Objects", object_count.to_string())],
            truncated,
        },
    ))
}

fn oracle_object_filter(
    owner_expression: &str,
    table_expression: &str,
    values: &[(String, String)],
) -> String {
    if values.is_empty() {
        return "1 = 0".into();
    }
    let mut by_owner = BTreeMap::<&str, Vec<&str>>::new();
    for (owner, table) in values {
        by_owner.entry(owner).or_default().push(table);
    }
    by_owner
        .into_iter()
        .map(|(owner, mut tables)| {
            tables.sort_unstable();
            tables.dedup();
            let tables = tables
                .into_iter()
                .map(|table| format!("'{}'", sql_literal(table)))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "({owner_expression} = '{}' and {table_expression} in ({tables}))",
                sql_literal(owner)
            )
        })
        .collect::<Vec<_>>()
        .join(" or ")
}

async fn load_oracle_structure_objects(
    connection: &ResolvedConnectionProfile,
    owner: &str,
    limit: u32,
) -> Result<Vec<Vec<String>>, CommandError> {
    let query = format!(
        "select owner, object_name, object_type from (select owner, object_name, object_type from all_objects where owner = '{}' and object_type in ('TABLE','VIEW','MATERIALIZED VIEW') order by object_name, object_type) where rownum <= {limit}",
        sql_literal(owner)
    );
    oracle_managed_response_rows(&execute_oracle_managed_read(connection, &query, limit).await?)
}

async fn load_oracle_secondary_structure_objects(
    connection: &ResolvedConnectionProfile,
    primary_owner: &str,
    limit: u32,
    include_system_objects: bool,
) -> Result<Vec<Vec<String>>, CommandError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let system_filter = if include_system_objects {
        String::new()
    } else {
        "and owner not in ('SYS','SYSTEM','OUTLN','DBSNMP','XDB','MDSYS','CTXSYS','ORDSYS','WMSYS','AUDSYS')".into()
    };
    let query = format!(
        "select owner, object_name, object_type from (select owner, object_name, object_type from all_objects where owner <> '{}' {system_filter} and object_type in ('TABLE','VIEW','MATERIALIZED VIEW') order by owner, object_name, object_type) where rownum <= {limit}",
        sql_literal(primary_owner)
    );
    oracle_managed_response_rows(&execute_oracle_managed_read(connection, &query, limit).await?)
}

fn is_oracle_system_owner(owner: &str) -> bool {
    matches!(
        owner,
        "SYS"
            | "SYSTEM"
            | "OUTLN"
            | "DBSNMP"
            | "XDB"
            | "MDSYS"
            | "CTXSYS"
            | "ORDSYS"
            | "WMSYS"
            | "AUDSYS"
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/structure_tests.rs"]
mod tests;
