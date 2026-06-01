use serde_json::{json, Map, Value};
use sqlx::{postgres::PgPool, Row};

use super::super::*;
use super::PostgresAdapter;

pub(super) async fn list_postgres_explorer_nodes(
    adapter: &PostgresAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let nodes = match request.scope.as_deref() {
        None => root_nodes(&pool, connection).await,
        Some(scope) => scoped_nodes(&pool, connection, scope).await,
    };
    pool.close().await;

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: adapter.execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_postgres_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = postgres_inspect_query_template(connection, &request.node_id);
    let payload = match sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await
    {
        Ok(pool) => {
            let payload = postgres_inspect_payload(&pool, connection, &request.node_id).await;
            pool.close().await;
            payload
        }
        Err(error) => postgres_offline_payload(connection, &request.node_id, &error.to_string()),
    };

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Inspection ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

async fn root_nodes(pool: &PgPool, connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let mut nodes = sqlx::query(
        "select schema_name
         from information_schema.schemata
         where schema_name not like 'pg_toast%'
         order by case
             when schema_name in ('information_schema', 'pg_catalog') or schema_name like 'pg_%' then 1
             else 0
         end, schema_name",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let schema = row.get::<String, _>("schema_name");
        schema_node(connection, &schema)
    })
    .collect::<Vec<_>>();

    nodes.push(postgres_node(
        connection,
        "postgres:security",
        "Security",
        "security",
        "Roles, grants, ownership, and row-level security metadata",
        Some("postgres:security".into()),
        vec!["Security".into()],
        true,
        None,
    ));
    nodes.push(postgres_node(
        connection,
        "postgres:diagnostics",
        "Diagnostics",
        "diagnostics",
        "Sessions, locks, relation statistics, and health signals",
        Some("postgres:diagnostics".into()),
        vec!["Diagnostics".into()],
        true,
        None,
    ));
    nodes
}

async fn scoped_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    if let Some(schema) = scope.strip_prefix("schema:") {
        return schema_section_nodes(pool, connection, schema).await;
    }

    if let Some(table) = scope.strip_prefix("table:") {
        let (schema, table_name) = parse_schema_object(table);
        return table_child_nodes(connection, &schema, &table_name);
    }

    if let Some(scope) = scope.strip_prefix("postgres:") {
        let parts = scope.split(':').collect::<Vec<_>>();
        match parts.as_slice() {
            ["security"] => return security_child_nodes(connection),
            ["diagnostics"] => return diagnostics_child_nodes(connection),
            [schema, section] => {
                return schema_objects_for_section(pool, connection, schema, section).await;
            }
            _ => {}
        }
    }

    Vec::new()
}

async fn schema_section_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    let counts = schema_counts(pool, schema).await;
    let path = schema_path(connection, schema);
    let mut nodes = Vec::new();
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "tables",
        "Tables",
        "tables",
        "Base, partitioned, and foreign tables",
        counts.tables,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "views",
        "Views",
        "views",
        "Stored SELECT projections",
        counts.views,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "materialized-views",
        "Materialized Views",
        "materialized-views",
        "Persisted query projections",
        counts.materialized_views,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "indexes",
        "Indexes",
        "indexes",
        "Schema-level indexes",
        counts.indexes,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "functions",
        "Functions",
        "functions",
        "Stored functions",
        counts.functions,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "procedures",
        "Procedures",
        "procedures",
        "Stored procedures",
        counts.procedures,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "sequences",
        "Sequences",
        "sequences",
        "Sequence generators",
        counts.sequences,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "types",
        "Types",
        "types",
        "Enum, composite, domain, and range types",
        counts.types,
    );
    push_schema_section(
        &mut nodes,
        connection,
        schema,
        &path,
        "extensions",
        "Extensions",
        "extensions",
        "Installed extension metadata",
        counts.extensions,
    );
    nodes
}

// Schema sections carry the full object-view metadata so callers stay declarative.
#[allow(clippy::too_many_arguments)]
fn push_schema_section(
    nodes: &mut Vec<ExplorerNode>,
    connection: &ResolvedConnectionProfile,
    schema: &str,
    path: &[String],
    section: &str,
    label: &str,
    kind: &str,
    detail: &str,
    count: i64,
) {
    if count <= 0 {
        return;
    }

    nodes.push(postgres_node(
        connection,
        &format!("postgres:{schema}:{section}"),
        label,
        kind,
        detail,
        Some(format!("postgres:{schema}:{section}")),
        path.to_vec(),
        true,
        None,
    ));
}

async fn schema_objects_for_section(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
    section: &str,
) -> Vec<ExplorerNode> {
    match section {
        "tables" => table_nodes(pool, connection, schema).await,
        "views" => view_nodes(pool, connection, schema, false).await,
        "materialized-views" => view_nodes(pool, connection, schema, true).await,
        "indexes" => index_nodes(pool, connection, schema).await,
        "functions" => routine_nodes(pool, connection, schema, "f").await,
        "procedures" => routine_nodes(pool, connection, schema, "p").await,
        "sequences" => sequence_nodes(pool, connection, schema).await,
        "types" => type_nodes(pool, connection, schema).await,
        "extensions" => extension_nodes(pool, connection, schema).await,
        _ => Vec::new(),
    }
}

async fn table_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select c.relname,
                case c.relkind
                    when 'p' then 'partitioned-table'
                    when 'f' then 'foreign-table'
                    else 'table'
                end as kind,
                coalesce(pg_total_relation_size(c.oid), 0)::bigint as bytes,
                coalesce(s.n_live_tup, c.reltuples)::bigint as estimated_rows
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_stat_user_tables s on s.relid = c.oid
         where n.nspname = $1 and c.relkind in ('r', 'p', 'f')
         order by c.relname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let table = row.get::<String, _>("relname");
        let kind = row.get::<String, _>("kind");
        let estimated_rows = row.get::<i64, _>("estimated_rows");
        let bytes = row.get::<i64, _>("bytes");
        postgres_node(
            connection,
            &format!("table:{schema}.{table}"),
            &table,
            &kind,
            &format!(
                "{estimated_rows} estimated row(s) / {}",
                format_bytes(bytes)
            ),
            Some(format!("table:{schema}.{table}")),
            section_path(connection, schema, "Tables"),
            true,
            Some(select_template(schema, &table)),
        )
    })
    .collect()
}

async fn view_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
    materialized: bool,
) -> Vec<ExplorerNode> {
    let query = if materialized {
        "select matviewname as name from pg_matviews where schemaname = $1 order by matviewname"
    } else {
        "select viewname as name from pg_views where schemaname = $1 order by viewname"
    };
    let section = if materialized {
        "Materialized Views"
    } else {
        "Views"
    };
    let kind = if materialized {
        "materialized-view"
    } else {
        "view"
    };

    sqlx::query(query)
        .bind(schema)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("name");
            postgres_node(
                connection,
                &format!("{kind}:{schema}:{name}"),
                &name,
                kind,
                if materialized {
                    "Materialized query projection"
                } else {
                    "Stored SELECT definition"
                },
                None,
                section_path(connection, schema, section),
                false,
                Some(select_template(schema, &name)),
            )
        })
        .collect()
}

async fn index_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select ci.relname as index_name,
                am.amname as access_method,
                i.indisunique,
                i.indisvalid,
                ct.relname as table_name
         from pg_index i
         join pg_class ci on ci.oid = i.indexrelid
         join pg_class ct on ct.oid = i.indrelid
         join pg_namespace n on n.oid = ci.relnamespace
         left join pg_am am on am.oid = ci.relam
         where n.nspname = $1
         order by ci.relname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let index = row.get::<String, _>("index_name");
        let access_method = row
            .try_get::<String, _>("access_method")
            .unwrap_or_default();
        let unique = row.get::<bool, _>("indisunique");
        let valid = row.get::<bool, _>("indisvalid");
        let table = row.get::<String, _>("table_name");
        postgres_node(
            connection,
            &format!("index:{schema}:{index}"),
            &index,
            "index",
            &format!(
                "{}{} / {}",
                if unique { "unique " } else { "" },
                access_method,
                if valid { table.as_str() } else { "invalid" }
            ),
            None,
            section_path(connection, schema, "Indexes"),
            false,
            None,
        )
    })
    .collect()
}

async fn routine_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
    prokind: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select p.proname,
                pg_get_function_arguments(p.oid) as arguments,
                l.lanname as language
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
         where n.nspname = $1 and p.prokind = $2
         order by p.proname",
    )
    .bind(schema)
    .bind(prokind)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let routine = row.get::<String, _>("proname");
        let arguments = row.try_get::<String, _>("arguments").unwrap_or_default();
        let language = row.try_get::<String, _>("language").unwrap_or_default();
        let (kind, section) = if prokind == "p" {
            ("procedure", "Procedures")
        } else {
            ("function", "Functions")
        };
        postgres_node(
            connection,
            &format!("{kind}:{schema}:{routine}"),
            &routine,
            kind,
            &format!("{language} / {arguments}"),
            None,
            section_path(connection, schema, section),
            false,
            None,
        )
    })
    .collect()
}

async fn sequence_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select sequence_name, data_type, increment
         from information_schema.sequences
         where sequence_schema = $1
         order by sequence_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let name = row.get::<String, _>("sequence_name");
        let data_type = row.try_get::<String, _>("data_type").unwrap_or_default();
        let increment = row.try_get::<String, _>("increment").unwrap_or_default();
        postgres_node(
            connection,
            &format!("sequence:{schema}:{name}"),
            &name,
            "sequence",
            &format!("{data_type} / increment {increment}"),
            None,
            section_path(connection, schema, "Sequences"),
            false,
            None,
        )
    })
    .collect()
}

async fn type_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select t.typname,
                case t.typtype
                    when 'e' then 'enum'
                    when 'c' then 'composite'
                    when 'd' then 'domain'
                    when 'r' then 'range'
                    else 'type'
                end as type_kind
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = $1
           and t.typtype in ('e', 'c', 'd', 'r')
         order by t.typname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let name = row.get::<String, _>("typname");
        let type_kind = row.get::<String, _>("type_kind");
        postgres_node(
            connection,
            &format!("type:{schema}:{name}"),
            &name,
            "type",
            &type_kind,
            None,
            section_path(connection, schema, "Types"),
            false,
            None,
        )
    })
    .collect()
}

async fn extension_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema: &str,
) -> Vec<ExplorerNode> {
    sqlx::query(
        "select e.extname, e.extversion
         from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
         where n.nspname = $1
         order by e.extname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let name = row.get::<String, _>("extname");
        let version = row.try_get::<String, _>("extversion").unwrap_or_default();
        postgres_node(
            connection,
            &format!("extension:{schema}:{name}"),
            &name,
            "extension",
            &version,
            None,
            section_path(connection, schema, "Extensions"),
            false,
            None,
        )
    })
    .collect()
}

fn table_child_nodes(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    table: &str,
) -> Vec<ExplorerNode> {
    let path = section_path(connection, schema, "Tables")
        .into_iter()
        .chain(std::iter::once(table.to_string()))
        .collect::<Vec<_>>();
    vec![
        postgres_node(
            connection,
            &format!("columns:{schema}:{table}"),
            "Columns",
            "columns",
            "Column definitions",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("indexes:{schema}:{table}"),
            "Indexes",
            "indexes",
            "Access paths and constraints",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("constraints:{schema}:{table}"),
            "Constraints",
            "constraints",
            "Primary, foreign, unique, check, and exclusion constraints",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("foreign-keys:{schema}:{table}"),
            "Foreign Keys",
            "foreign-keys",
            "Referenced tables, columns, and update/delete actions",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("triggers:{schema}:{table}"),
            "Triggers",
            "triggers",
            "Trigger timing, events, and functions",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("statistics:{schema}:{table}"),
            "Statistics",
            "statistics",
            "Rows, scans, vacuum, analyze, and size signals",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("permissions:{schema}:{table}"),
            "Permissions",
            "permissions",
            "Visible object grants",
            None,
            path.clone(),
            false,
            None,
        ),
        postgres_node(
            connection,
            &format!("ddl:{schema}:{table}"),
            "Definition",
            "ddl",
            "Object definition SQL",
            None,
            path,
            false,
            None,
        ),
    ]
}

fn security_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        postgres_node(
            connection,
            "postgres:security:roles",
            "Roles",
            "roles",
            "Login and group roles",
            None,
            vec!["Security".into()],
            false,
            None,
        ),
        postgres_node(
            connection,
            "postgres:security:permissions",
            "Permissions",
            "permissions",
            "Visible grants and privileges",
            None,
            vec!["Security".into()],
            false,
            None,
        ),
    ]
}

fn diagnostics_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        postgres_node(
            connection,
            "postgres:diagnostics:sessions",
            "Sessions",
            "sessions",
            "pg_stat_activity sessions",
            None,
            vec!["Diagnostics".into()],
            false,
            None,
        ),
        postgres_node(
            connection,
            "postgres:diagnostics:locks",
            "Locks",
            "locks",
            "pg_locks and blocking hints",
            None,
            vec!["Diagnostics".into()],
            false,
            None,
        ),
        postgres_node(
            connection,
            "postgres:diagnostics:statistics",
            "Statistics",
            "statistics",
            "pg_stat relation and database stats",
            None,
            vec!["Diagnostics".into()],
            false,
            None,
        ),
    ]
}

async fn postgres_inspect_payload(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Value {
    let target = PostgresObjectTarget::parse(connection, node_id);
    let base = base_payload(connection, node_id, &target, Vec::new());
    let details = match target.object_view.as_str() {
        "table" | "columns" | "indexes" | "constraints" | "foreign-keys" | "triggers"
        | "statistics" | "permissions" | "ddl" => {
            table_payload(pool, &target.schema, &target.object_name).await
        }
        "view" => view_payload(pool, &target.schema, &target.object_name, false).await,
        "materialized-view" => view_payload(pool, &target.schema, &target.object_name, true).await,
        "schema" | "tables" | "views" | "materialized-views" | "functions" | "procedures"
        | "sequences" | "types" | "extensions" => schema_payload(pool, &target.schema).await,
        "index" => index_payload(pool, &target.schema, &target.object_name).await,
        "function" | "procedure" => {
            routine_payload(
                pool,
                &target.schema,
                &target.object_name,
                &target.object_view,
            )
            .await
        }
        "security" | "roles" | "permissions-root" => security_payload(pool, &target.schema).await,
        "diagnostics" | "sessions" | "locks" => diagnostics_payload(pool, &target.schema).await,
        _ => json!({ "objects": visible_object_rows(&target) }),
    };

    merge_payload(base, details)
}

fn postgres_offline_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    error: &str,
) -> Value {
    let target = PostgresObjectTarget::parse(connection, node_id);
    base_payload(
        connection,
        node_id,
        &target,
        vec![format!(
            "Live PostgreSQL metadata is unavailable for this view: {}",
            compact_error(error)
        )],
    )
}

async fn schema_payload(pool: &PgPool, schema: &str) -> Value {
    let counts = schema_counts(pool, schema).await;
    json!({
        "schema": schema,
        "tableCount": counts.tables,
        "indexCount": counts.indexes,
        "tables": table_rows(pool, schema, None).await,
        "views": view_rows(pool, schema, false, None).await,
        "materializedViews": view_rows(pool, schema, true, None).await,
        "functions": routine_rows(pool, schema, "f", None).await,
        "procedures": routine_rows(pool, schema, "p", None).await,
        "sequences": sequence_rows(pool, schema, None).await,
        "types": type_rows(pool, schema, None).await,
        "extensions": extension_rows(pool, schema).await,
    })
}

async fn table_payload(pool: &PgPool, schema: &str, table: &str) -> Value {
    let statistics = relation_statistics(pool, schema, Some(table)).await;
    let row_count = statistics
        .first()
        .and_then(|row| row.get("rows"))
        .cloned()
        .unwrap_or(Value::Null);
    let size = statistics
        .first()
        .and_then(|row| row.get("size"))
        .cloned()
        .unwrap_or(Value::Null);

    json!({
        "schema": schema,
        "objectName": table,
        "rowCount": row_count,
        "size": size,
        "columns": column_rows(pool, schema, table).await,
        "indexes": index_rows(pool, schema, Some(table), None).await,
        "constraints": constraint_rows(pool, schema, table).await,
        "foreignKeys": foreign_key_rows(pool, schema, table).await,
        "triggers": trigger_rows(pool, schema, table).await,
        "statistics": statistics,
        "permissions": permission_rows(pool, schema, Some(table)).await,
    })
}

async fn view_payload(pool: &PgPool, schema: &str, view: &str, materialized: bool) -> Value {
    let views = view_rows(pool, schema, materialized, Some(view)).await;
    let definition = views
        .first()
        .and_then(|row| row.get("definition"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "schema": schema,
        "objectName": view,
        "definition": definition,
        "views": views,
        "columns": column_rows(pool, schema, view).await,
        "permissions": permission_rows(pool, schema, Some(view)).await,
    })
}

async fn index_payload(pool: &PgPool, schema: &str, index: &str) -> Value {
    json!({
        "schema": schema,
        "objectName": index,
        "indexes": index_rows(pool, schema, None, Some(index)).await,
        "statistics": relation_statistics(pool, schema, Some(index)).await,
    })
}

async fn routine_payload(pool: &PgPool, schema: &str, routine: &str, kind: &str) -> Value {
    let prokind = if kind == "procedure" { "p" } else { "f" };
    let routines = routine_rows(pool, schema, prokind, Some(routine)).await;
    let definition = routines
        .first()
        .and_then(|row| row.get("definition"))
        .cloned()
        .unwrap_or(Value::Null);

    json!({
        "schema": schema,
        "objectName": routine,
        "definition": definition,
        "routines": routines,
        "permissions": permission_rows(pool, schema, Some(routine)).await,
    })
}

async fn security_payload(pool: &PgPool, schema: &str) -> Value {
    json!({
        "schema": schema,
        "roles": role_rows(pool).await,
        "permissions": permission_rows(pool, schema, None).await,
    })
}

async fn diagnostics_payload(pool: &PgPool, schema: &str) -> Value {
    let sessions = session_rows(pool).await;
    let blocked_sessions = sessions
        .iter()
        .filter(|row| {
            row.get("blockedBy")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
        })
        .count();
    json!({
        "schema": schema,
        "activeSessions": sessions.len(),
        "blockedSessions": blocked_sessions,
        "sessions": sessions,
        "locks": lock_rows(pool).await,
        "statistics": relation_statistics(pool, schema, None).await,
        "warnings": ["Diagnostics are limited to catalog views available to the current role."],
    })
}

async fn table_rows(pool: &PgPool, schema: &str, table_filter: Option<&str>) -> Vec<Value> {
    let mut query = String::from(
        "select n.nspname as schema,
                c.relname as name,
                case c.relkind
                    when 'p' then 'partitioned table'
                    when 'f' then 'foreign table'
                    else 'base table'
                end as type,
                coalesce(s.n_live_tup, c.reltuples)::bigint as rows,
                pg_size_pretty(pg_total_relation_size(c.oid)) as size,
                pg_get_userbyid(c.relowner) as owner
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_stat_user_tables s on s.relid = c.oid
         where n.nspname = $1 and c.relkind in ('r', 'p', 'f')",
    );
    if table_filter.is_some() {
        query.push_str(" and c.relname = $2");
    }
    query.push_str(" order by c.relname limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(table) = table_filter {
        sql = sql.bind(table);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "schema": row.get::<String, _>("schema"),
                "name": row.get::<String, _>("name"),
                "type": row.get::<String, _>("type"),
                "rows": row.get::<i64, _>("rows"),
                "size": row.get::<String, _>("size"),
                "owner": row.get::<String, _>("owner"),
            })
        })
        .collect()
}

async fn view_rows(
    pool: &PgPool,
    schema: &str,
    materialized: bool,
    view_filter: Option<&str>,
) -> Vec<Value> {
    let mut query = if materialized {
        String::from(
            "select schemaname as schema, matviewname as name, definition, 'materialized' as status
             from pg_matviews
             where schemaname = $1",
        )
    } else {
        String::from(
            "select schemaname as schema, viewname as name, definition, 'valid' as status
             from pg_views
             where schemaname = $1",
        )
    };
    if view_filter.is_some() {
        query.push_str(if materialized {
            " and matviewname = $2"
        } else {
            " and viewname = $2"
        });
    }
    query.push_str(" order by name limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(view) = view_filter {
        sql = sql.bind(view);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "schema": row.get::<String, _>("schema"),
                "name": row.get::<String, _>("name"),
                "definition": row.get::<String, _>("definition"),
                "status": row.get::<String, _>("status"),
            })
        })
        .collect()
}

async fn column_rows(pool: &PgPool, schema: &str, table: &str) -> Vec<Value> {
    sqlx::query(
        "select column_name,
                data_type,
                is_nullable,
                column_default,
                is_identity,
                collation_name
         from information_schema.columns
         where table_schema = $1 and table_name = $2
         order by ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "name": row.get::<String, _>("column_name"),
            "type": row.get::<String, _>("data_type"),
            "nullable": row.get::<String, _>("is_nullable") == "YES",
            "default": row.try_get::<Option<String>, _>("column_default").unwrap_or_default().unwrap_or_default(),
            "identity": row.try_get::<String, _>("is_identity").unwrap_or_default() == "YES",
            "collation": row.try_get::<Option<String>, _>("collation_name").unwrap_or_default().unwrap_or_default(),
        })
    })
    .collect()
}

async fn index_rows(
    pool: &PgPool,
    schema: &str,
    table_filter: Option<&str>,
    index_filter: Option<&str>,
) -> Vec<Value> {
    let mut query = String::from(
        "select ci.relname as name,
                am.amname as type,
                ct.relname as table_name,
                i.indisunique,
                i.indisvalid,
                pg_size_pretty(pg_relation_size(ci.oid)) as size,
                pg_get_indexdef(i.indexrelid) as definition,
                coalesce(array_to_string(array(
                    select a.attname
                    from unnest(i.indkey) with ordinality as k(attnum, ord)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                    order by k.ord
                ), ', '), '') as columns
         from pg_index i
         join pg_class ci on ci.oid = i.indexrelid
         join pg_class ct on ct.oid = i.indrelid
         join pg_namespace n on n.oid = ci.relnamespace
         left join pg_am am on am.oid = ci.relam
         where n.nspname = $1",
    );
    if table_filter.is_some() {
        query.push_str(" and ct.relname = $2");
    }
    if index_filter.is_some() {
        query.push_str(if table_filter.is_some() {
            " and ci.relname = $3"
        } else {
            " and ci.relname = $2"
        });
    }
    query.push_str(" order by ci.relname limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(table) = table_filter {
        sql = sql.bind(table);
    }
    if let Some(index) = index_filter {
        sql = sql.bind(index);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "name": row.get::<String, _>("name"),
                "type": row.try_get::<String, _>("type").unwrap_or_default(),
                "table": row.get::<String, _>("table_name"),
                "columns": row.try_get::<String, _>("columns").unwrap_or_default(),
                "unique": row.get::<bool, _>("indisunique"),
                "valid": row.get::<bool, _>("indisvalid"),
                "size": row.get::<String, _>("size"),
                "definition": row.get::<String, _>("definition"),
            })
        })
        .collect()
}

async fn constraint_rows(pool: &PgPool, schema: &str, table: &str) -> Vec<Value> {
    sqlx::query(
        "select c.conname,
                case c.contype
                    when 'p' then 'PRIMARY KEY'
                    when 'f' then 'FOREIGN KEY'
                    when 'u' then 'UNIQUE'
                    when 'c' then 'CHECK'
                    when 'x' then 'EXCLUDE'
                    else c.contype::text
                end as type,
                pg_get_constraintdef(c.oid) as definition,
                c.convalidated
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         where n.nspname = $1 and t.relname = $2
         order by c.conname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "name": row.get::<String, _>("conname"),
            "type": row.get::<String, _>("type"),
            "columns": "",
            "status": if row.get::<bool, _>("convalidated") { "validated" } else { "not validated" },
            "definition": row.get::<String, _>("definition"),
        })
    })
    .collect()
}

async fn foreign_key_rows(pool: &PgPool, schema: &str, table: &str) -> Vec<Value> {
    sqlx::query(
        "select c.conname,
                rn.nspname as referenced_schema,
                rt.relname as referenced_table,
                pg_get_constraintdef(c.oid) as definition,
                case c.confupdtype
                    when 'a' then 'NO ACTION'
                    when 'r' then 'RESTRICT'
                    when 'c' then 'CASCADE'
                    when 'n' then 'SET NULL'
                    when 'd' then 'SET DEFAULT'
                    else c.confupdtype::text
                end as on_update,
                case c.confdeltype
                    when 'a' then 'NO ACTION'
                    when 'r' then 'RESTRICT'
                    when 'c' then 'CASCADE'
                    when 'n' then 'SET NULL'
                    when 'd' then 'SET DEFAULT'
                    else c.confdeltype::text
                end as on_delete,
                source_columns.columns as columns,
                referenced_columns.columns as referenced_columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_class rt on rt.oid = c.confrelid
         join pg_namespace rn on rn.oid = rt.relnamespace
         left join lateral (
             select string_agg(a.attname, ', ' order by k.ordinality) as columns
             from unnest(c.conkey) with ordinality as k(attnum, ordinality)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         ) source_columns on true
         left join lateral (
             select string_agg(a.attname, ', ' order by k.ordinality) as columns
             from unnest(c.confkey) with ordinality as k(attnum, ordinality)
             join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
         ) referenced_columns on true
         where n.nspname = $1 and t.relname = $2 and c.contype = 'f'
         order by c.conname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        let referenced_schema = row.get::<String, _>("referenced_schema");
        let referenced_table = row.get::<String, _>("referenced_table");
        let columns = row.try_get::<String, _>("columns").unwrap_or_default();
        let referenced_columns = row
            .try_get::<String, _>("referenced_columns")
            .unwrap_or_default();
        let referenced_name = if referenced_schema == schema {
            referenced_table.clone()
        } else {
            format!("{referenced_schema}.{referenced_table}")
        };

        json!({
            "id": row.get::<String, _>("conname"),
            "name": row.get::<String, _>("conname"),
            "from": relationship_endpoint(table, &columns),
            "table": table,
            "columns": columns,
            "to": relationship_endpoint(&referenced_name, &referenced_columns),
            "referencedSchema": referenced_schema,
            "referencedTable": referenced_table,
            "referencedColumns": referenced_columns,
            "onUpdate": row.get::<String, _>("on_update"),
            "onDelete": row.get::<String, _>("on_delete"),
            "definition": row.get::<String, _>("definition"),
        })
    })
    .collect()
}

async fn trigger_rows(pool: &PgPool, schema: &str, table: &str) -> Vec<Value> {
    sqlx::query(
        "select trigger_name,
                action_timing,
                string_agg(event_manipulation, ', ' order by event_manipulation) as events,
                action_statement
         from information_schema.triggers
         where trigger_schema = $1 and event_object_table = $2
         group by trigger_name, action_timing, action_statement
         order by trigger_name",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "name": row.get::<String, _>("trigger_name"),
            "timing": row.get::<String, _>("action_timing"),
            "event": row.try_get::<String, _>("events").unwrap_or_default(),
            "enabled": true,
            "function": row.get::<String, _>("action_statement"),
        })
    })
    .collect()
}

async fn routine_rows(
    pool: &PgPool,
    schema: &str,
    prokind: &str,
    routine_filter: Option<&str>,
) -> Vec<Value> {
    let mut query = String::from(
        "select n.nspname as schema,
                p.proname as name,
                pg_get_function_arguments(p.oid) as arguments,
                pg_get_function_result(p.oid) as returns,
                pg_get_functiondef(p.oid) as definition,
                l.lanname as language,
                case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end as volatility,
                case p.prosecdef when true then 'security definer' else 'security invoker' end as security
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
         where n.nspname = $1 and p.prokind = $2",
    );
    if routine_filter.is_some() {
        query.push_str(" and p.proname = $3");
    }
    query.push_str(" order by p.proname limit 200");

    let mut sql = sqlx::query(&query).bind(schema).bind(prokind);
    if let Some(routine) = routine_filter {
        sql = sql.bind(routine);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "schema": row.get::<String, _>("schema"),
                "name": row.get::<String, _>("name"),
                "type": if prokind == "p" { "procedure" } else { "function" },
                "arguments": row.try_get::<String, _>("arguments").unwrap_or_default(),
                "returns": row.try_get::<String, _>("returns").unwrap_or_default(),
                "definition": row.try_get::<String, _>("definition").unwrap_or_default(),
                "language": row.get::<String, _>("language"),
                "volatility": row.get::<String, _>("volatility"),
                "security": row.get::<String, _>("security"),
            })
        })
        .collect()
}

async fn sequence_rows(pool: &PgPool, schema: &str, sequence_filter: Option<&str>) -> Vec<Value> {
    let mut query = String::from(
        "select sequence_schema as schema,
                sequence_name as name,
                data_type,
                increment,
                start_value,
                minimum_value,
                maximum_value,
                cycle_option
         from information_schema.sequences
         where sequence_schema = $1",
    );
    if sequence_filter.is_some() {
        query.push_str(" and sequence_name = $2");
    }
    query.push_str(" order by sequence_name limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(sequence) = sequence_filter {
        sql = sql.bind(sequence);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "schema": row.get::<String, _>("schema"),
                "name": row.get::<String, _>("name"),
                "dataType": row.get::<String, _>("data_type"),
                "increment": row.get::<String, _>("increment"),
                "cache": "",
                "cycles": row.get::<String, _>("cycle_option") == "YES",
            })
        })
        .collect()
}

async fn type_rows(pool: &PgPool, schema: &str, type_filter: Option<&str>) -> Vec<Value> {
    let mut query = String::from(
        "select n.nspname as schema,
                t.typname as name,
                case t.typtype
                    when 'e' then 'enum'
                    when 'c' then 'composite'
                    when 'd' then 'domain'
                    when 'r' then 'range'
                    else 'type'
                end as type,
                pg_get_userbyid(t.typowner) as owner
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = $1 and t.typtype in ('e', 'c', 'd', 'r')",
    );
    if type_filter.is_some() {
        query.push_str(" and t.typname = $2");
    }
    query.push_str(" order by t.typname limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(type_name) = type_filter {
        sql = sql.bind(type_name);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "schema": row.get::<String, _>("schema"),
                "name": row.get::<String, _>("name"),
                "type": row.get::<String, _>("type"),
                "owner": row.get::<String, _>("owner"),
            })
        })
        .collect()
}

async fn extension_rows(pool: &PgPool, schema: &str) -> Vec<Value> {
    sqlx::query(
        "select e.extname, e.extversion, n.nspname as schema, d.description
         from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
         left join pg_description d on d.objoid = e.oid and d.objsubid = 0
         where n.nspname = $1
         order by e.extname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "name": row.get::<String, _>("extname"),
            "version": row.get::<String, _>("extversion"),
            "schema": row.get::<String, _>("schema"),
            "description": row.try_get::<Option<String>, _>("description").unwrap_or_default().unwrap_or_default(),
        })
    })
    .collect()
}

async fn relation_statistics(
    pool: &PgPool,
    schema: &str,
    relation_filter: Option<&str>,
) -> Vec<Value> {
    let mut query = String::from(
        "select schemaname as schema,
                relname as name,
                n_live_tup::bigint as rows,
                seq_scan + idx_scan as scans,
                last_vacuum::text as last_vacuum,
                last_analyze::text as last_analyze,
                pg_size_pretty(pg_total_relation_size(relid)) as size
         from pg_stat_user_tables
         where schemaname = $1",
    );
    if relation_filter.is_some() {
        query.push_str(" and relname = $2");
    }
    query.push_str(" order by relname limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(relation) = relation_filter {
        sql = sql.bind(relation);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "name": row.get::<String, _>("name"),
                "rows": row.get::<i64, _>("rows"),
                "scans": row.get::<i64, _>("scans"),
                "lastVacuum": row.try_get::<Option<String>, _>("last_vacuum").unwrap_or_default().unwrap_or_default(),
                "lastAnalyze": row.try_get::<Option<String>, _>("last_analyze").unwrap_or_default().unwrap_or_default(),
                "size": row.get::<String, _>("size"),
            })
        })
        .collect()
}

async fn permission_rows(pool: &PgPool, schema: &str, object_filter: Option<&str>) -> Vec<Value> {
    let mut query = String::from(
        "select grantee,
                privilege_type,
                table_schema || '.' || table_name as object,
                'granted' as state,
                grantor
         from information_schema.table_privileges
         where table_schema = $1",
    );
    if object_filter.is_some() {
        query.push_str(" and table_name = $2");
    }
    query.push_str(" order by table_name, grantee, privilege_type limit 200");

    let mut sql = sqlx::query(&query).bind(schema);
    if let Some(object) = object_filter {
        sql = sql.bind(object);
    }

    sql.fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "principal": row.get::<String, _>("grantee"),
                "privilege": row.get::<String, _>("privilege_type"),
                "object": row.get::<String, _>("object"),
                "state": row.get::<String, _>("state"),
                "grantor": row.get::<String, _>("grantor"),
            })
        })
        .collect()
}

async fn role_rows(pool: &PgPool) -> Vec<Value> {
    sqlx::query(
        "select rolname, rolcanlogin, rolsuper, rolinherit,
                coalesce(array_to_string(array(
                    select parent.rolname
                    from pg_auth_members m
                    join pg_roles parent on parent.oid = m.roleid
                    where m.member = r.oid
                    order by parent.rolname
                ), ', '), '') as memberships
         from pg_roles r
         order by rolname
         limit 200",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "name": row.get::<String, _>("rolname"),
            "login": row.get::<bool, _>("rolcanlogin"),
            "superuser": row.get::<bool, _>("rolsuper"),
            "inherit": row.get::<bool, _>("rolinherit"),
            "memberships": row.try_get::<String, _>("memberships").unwrap_or_default(),
        })
    })
    .collect()
}

async fn session_rows(pool: &PgPool) -> Vec<Value> {
    sqlx::query(
        "select pid,
                usename,
                datname,
                state,
                coalesce(wait_event_type || ':' || wait_event, '') as wait,
                coalesce(array_to_string(pg_blocking_pids(pid), ', '), '') as blocked_by
         from pg_stat_activity
         order by query_start desc nulls last
         limit 100",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "pid": row.get::<i32, _>("pid"),
            "user": row.try_get::<Option<String>, _>("usename").unwrap_or_default().unwrap_or_default(),
            "database": row.try_get::<Option<String>, _>("datname").unwrap_or_default().unwrap_or_default(),
            "state": row.try_get::<Option<String>, _>("state").unwrap_or_default().unwrap_or_default(),
            "wait": row.try_get::<Option<String>, _>("wait").unwrap_or_default().unwrap_or_default(),
            "blockedBy": row.try_get::<String, _>("blocked_by").unwrap_or_default(),
        })
    })
    .collect()
}

async fn lock_rows(pool: &PgPool) -> Vec<Value> {
    sqlx::query(
        "select pid,
                coalesce(relation::regclass::text, locktype) as object,
                mode,
                granted,
                case when granted then 'No' else 'Possible' end as blocking
         from pg_locks
         order by granted, pid
         limit 200",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| {
        json!({
            "pid": row.try_get::<Option<i32>, _>("pid").unwrap_or_default().unwrap_or_default(),
            "object": row.get::<String, _>("object"),
            "mode": row.get::<String, _>("mode"),
            "granted": row.get::<bool, _>("granted"),
            "blocking": row.get::<String, _>("blocking"),
        })
    })
    .collect()
}

#[derive(Default)]
struct SchemaCounts {
    tables: i64,
    views: i64,
    materialized_views: i64,
    indexes: i64,
    functions: i64,
    procedures: i64,
    sequences: i64,
    types: i64,
    extensions: i64,
}

async fn schema_counts(pool: &PgPool, schema: &str) -> SchemaCounts {
    SchemaCounts {
        tables: count_for_schema(pool, "select count(*)::bigint as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'p', 'f')", schema).await,
        views: count_for_schema(pool, "select count(*)::bigint as count from pg_views where schemaname = $1", schema).await,
        materialized_views: count_for_schema(pool, "select count(*)::bigint as count from pg_matviews where schemaname = $1", schema).await,
        indexes: count_for_schema(pool, "select count(*)::bigint as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'i'", schema).await,
        functions: count_for_schema(pool, "select count(*)::bigint as count from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.prokind = 'f'", schema).await,
        procedures: count_for_schema(pool, "select count(*)::bigint as count from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.prokind = 'p'", schema).await,
        sequences: count_for_schema(pool, "select count(*)::bigint as count from information_schema.sequences where sequence_schema = $1", schema).await,
        types: count_for_schema(pool, "select count(*)::bigint as count from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = $1 and t.typtype in ('e', 'c', 'd', 'r')", schema).await,
        extensions: count_for_schema(pool, "select count(*)::bigint as count from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = $1", schema).await,
    }
}

async fn count_for_schema(pool: &PgPool, query: &str, schema: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(query)
        .bind(schema)
        .fetch_one(pool)
        .await
        .unwrap_or_default()
}

#[derive(Debug, PartialEq, Eq)]
struct PostgresObjectTarget {
    object_view: String,
    schema: String,
    object_name: String,
}

impl PostgresObjectTarget {
    fn parse(connection: &ResolvedConnectionProfile, node_id: &str) -> Self {
        if let Some(value) = node_id.strip_prefix("table:") {
            let (schema, object_name) = parse_schema_object(value);
            return Self::new("table", schema, object_name);
        }

        if let Some(schema) = node_id.strip_prefix("schema:") {
            return Self::new("schema", schema.to_string(), String::new());
        }

        for prefix in [
            "view",
            "materialized-view",
            "index",
            "function",
            "procedure",
            "sequence",
            "type",
            "extension",
        ] {
            if let Some(rest) = node_id.strip_prefix(&format!("{prefix}:")) {
                let parts = rest.split(':').collect::<Vec<_>>();
                return Self::new(
                    prefix,
                    parts.first().copied().unwrap_or("public").to_string(),
                    parts.get(1).copied().unwrap_or_default().to_string(),
                );
            }
        }

        for prefix in [
            "columns",
            "indexes",
            "constraints",
            "foreign-keys",
            "triggers",
            "statistics",
            "permissions",
            "ddl",
        ] {
            if let Some(rest) = node_id.strip_prefix(&format!("{prefix}:")) {
                let parts = rest.split(':').collect::<Vec<_>>();
                return Self::new(
                    prefix,
                    parts.first().copied().unwrap_or("public").to_string(),
                    parts.get(1).copied().unwrap_or_default().to_string(),
                );
            }
        }

        if let Some(rest) = node_id.strip_prefix("postgres:") {
            let parts = rest.split(':').collect::<Vec<_>>();
            return match parts.as_slice() {
                ["security"] => Self::new("security", "public".into(), String::new()),
                ["security", "roles"] => Self::new("roles", "public".into(), String::new()),
                ["security", "permissions"] => {
                    Self::new("permissions-root", "public".into(), String::new())
                }
                ["diagnostics"] => Self::new("diagnostics", "public".into(), String::new()),
                ["diagnostics", "sessions"] => {
                    Self::new("sessions", "public".into(), String::new())
                }
                ["diagnostics", "locks"] => Self::new("locks", "public".into(), String::new()),
                ["diagnostics", "statistics"] => {
                    Self::new("statistics", "public".into(), String::new())
                }
                [schema, section] => Self::new(*section, (*schema).to_string(), String::new()),
                _ => Self::new(
                    "object",
                    connection
                        .database
                        .clone()
                        .unwrap_or_else(|| "public".into()),
                    String::new(),
                ),
            };
        }

        if node_id.contains('.') {
            let (schema, object_name) = parse_schema_object(node_id);
            return Self::new("table", schema, object_name);
        }

        Self::new(
            "object",
            connection
                .database
                .clone()
                .unwrap_or_else(|| "public".into()),
            String::new(),
        )
    }

    fn new(object_view: impl Into<String>, schema: String, object_name: String) -> Self {
        Self {
            object_view: object_view.into(),
            schema,
            object_name,
        }
    }
}

fn postgres_inspect_query_template(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> String {
    let target = PostgresObjectTarget::parse(connection, node_id);

    match target.object_view.as_str() {
        "table" | "columns" | "indexes" | "constraints" | "foreign-keys" | "triggers"
        | "statistics" | "permissions" | "ddl" | "view" | "materialized-view"
            if !target.object_name.is_empty() =>
        {
            select_template(&target.schema, &target.object_name)
        }
        "function" | "procedure" if !target.object_name.is_empty() => {
            format!(
                "select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '{}' and p.proname = '{}'{};",
                sql_literal(&target.schema),
                sql_literal(&target.object_name),
                if target.object_view == "procedure" {
                    " and p.prokind = 'p'"
                } else {
                    ""
                }
            )
        }
        "diagnostics" | "sessions" => "select pid, usename, datname, state, wait_event_type, wait_event from pg_stat_activity order by query_start desc nulls last limit 100;".into(),
        "locks" => "select locktype, mode, granted, relation::regclass::text as relation from pg_locks limit 100;".into(),
        "security" | "roles" | "permissions-root" => {
            "select rolname, rolcanlogin, rolsuper, rolinherit from pg_roles order by rolname;".into()
        }
        "schema" | "tables" | "views" | "materialized-views" | "functions" | "procedures" | "sequences" | "types" | "extensions" => {
            format!("select schemaname, tablename from pg_catalog.pg_tables where schemaname = '{}' order by tablename;", sql_literal(&target.schema))
        }
        _ => "select 1;".into(),
    }
}

fn base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    target: &PostgresObjectTarget,
    warnings: Vec<String>,
) -> Value {
    json!({
        "engine": connection.engine,
        "database": connection.database.clone().unwrap_or_else(|| connection.name.clone()),
        "schema": target.schema,
        "objectName": target.object_name,
        "objectView": target.object_view,
        "nodeId": node_id,
        "warnings": warnings,
    })
}

fn visible_object_rows(target: &PostgresObjectTarget) -> Vec<Value> {
    vec![json!({
        "schema": target.schema,
        "name": if target.object_name.is_empty() { target.schema.as_str() } else { target.object_name.as_str() },
        "type": target.object_view,
        "status": "visible",
    })]
}

fn merge_payload(mut base: Value, details: Value) -> Value {
    if let (Some(base), Some(details)) = (base.as_object_mut(), details.as_object()) {
        for (key, value) in details {
            if key == "warnings" {
                append_warnings(base, value);
            } else {
                base.insert(key.clone(), value.clone());
            }
        }
    }
    base
}

fn append_warnings(base: &mut Map<String, Value>, value: &Value) {
    let mut warnings = base
        .get("warnings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(items) = value.as_array() {
        warnings.extend(items.iter().cloned());
    }

    base.insert("warnings".into(), Value::Array(warnings));
}

fn schema_node(connection: &ResolvedConnectionProfile, schema: &str) -> ExplorerNode {
    postgres_node(
        connection,
        &format!("schema:{schema}"),
        schema,
        "schema",
        if is_postgres_system_schema(schema) {
            "System schema"
        } else {
            "User schema"
        },
        Some(format!("schema:{schema}")),
        schema_path(connection, schema),
        true,
        Some(format!(
            "select table_name from information_schema.tables where table_schema = '{}' order by table_name;",
            sql_literal(schema)
        )),
    )
}

// Mirrors the ExplorerNode shape so PostgreSQL scopes stay readable at call sites.
#[allow(clippy::too_many_arguments)]
fn postgres_node(
    _connection: &ResolvedConnectionProfile,
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<String>,
    path: Vec<String>,
    expandable: bool,
    query_template: Option<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope,
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

fn schema_path(connection: &ResolvedConnectionProfile, schema: &str) -> Vec<String> {
    vec![
        connection.name.clone(),
        if is_postgres_system_schema(schema) {
            "System Schemas".into()
        } else {
            "User Schemas".into()
        },
    ]
}

fn section_path(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    section: &str,
) -> Vec<String> {
    vec![
        connection.name.clone(),
        if is_postgres_system_schema(schema) {
            "System Schemas".into()
        } else {
            "User Schemas".into()
        },
        schema.into(),
        section.into(),
    ]
}

fn parse_schema_object(value: &str) -> (String, String) {
    value
        .split_once('.')
        .map(|(schema, object_name)| (schema.to_string(), object_name.to_string()))
        .unwrap_or_else(|| ("public".into(), value.to_string()))
}

fn select_template(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} limit 100;",
        quote_pg_identifier(schema),
        quote_pg_identifier(table)
    )
}

fn relationship_endpoint(object: &str, columns: &str) -> String {
    let columns = columns.trim();
    if columns.is_empty() {
        object.to_string()
    } else {
        format!("{object}.{columns}")
    }
}

fn quote_pg_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn is_postgres_system_schema(schema: &str) -> bool {
    let normalized = schema.trim().to_lowercase();
    normalized == "information_schema"
        || normalized == "pg_catalog"
        || normalized.starts_with("pg_")
}

fn format_bytes(bytes: i64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes.max(0) as f64;
    if value >= GB {
        format!("{:.1} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.1} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn compact_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_postgres_explorer_node_uses_select_1_for_unresolved_nodes() {
        let connection = connection();
        let query = postgres_inspect_query_template(&connection, "accounts");

        assert_eq!(query, "select 1;");
    }

    #[test]
    fn inspect_postgres_explorer_node_quotes_explicit_table_when_available() {
        let connection = connection();
        let query = postgres_inspect_query_template(&connection, "table:public.accounts");

        assert_eq!(query, "select * from \"public\".\"accounts\" limit 100;");
    }

    #[test]
    fn inspect_postgres_explorer_node_uses_table_query_for_table_feature_nodes() {
        let connection = connection();
        let query = postgres_inspect_query_template(&connection, "foreign-keys:app:orders");

        assert_eq!(query, "select * from \"app\".\"orders\" limit 100;");
    }

    #[test]
    fn inspect_postgres_explorer_node_uses_function_definition_for_routines() {
        let connection = connection();
        let function_query =
            postgres_inspect_query_template(&connection, "function:public:account_status");
        let procedure_query =
            postgres_inspect_query_template(&connection, "procedure:public:refresh_rollups");

        assert!(function_query.contains("pg_get_functiondef"));
        assert!(function_query.contains("p.proname = 'account_status'"));
        assert!(!function_query.contains("p.prokind = 'p'"));
        assert!(procedure_query.contains("pg_get_functiondef"));
        assert!(procedure_query.contains("p.proname = 'refresh_rollups'"));
        assert!(procedure_query.contains("p.prokind = 'p'"));
    }

    #[test]
    fn postgres_target_parses_native_object_view_nodes() {
        let connection = connection();

        assert_eq!(
            PostgresObjectTarget::parse(&connection, "postgres:public:tables"),
            PostgresObjectTarget::new("tables", "public".into(), String::new())
        );
        assert_eq!(
            PostgresObjectTarget::parse(&connection, "columns:app:orders"),
            PostgresObjectTarget::new("columns", "app".into(), "orders".into())
        );
        assert_eq!(
            PostgresObjectTarget::parse(&connection, "foreign-keys:app:orders"),
            PostgresObjectTarget::new("foreign-keys", "app".into(), "orders".into())
        );
        assert_eq!(
            PostgresObjectTarget::parse(&connection, "postgres:diagnostics:locks"),
            PostgresObjectTarget::new("locks", "public".into(), String::new())
        );
    }

    #[test]
    fn postgres_table_child_nodes_include_native_foreign_keys() {
        let connection = connection();
        let nodes = table_child_nodes(&connection, "public", "orders");
        let foreign_keys = nodes
            .iter()
            .find(|node| node.id == "foreign-keys:public:orders")
            .expect("foreign key child node");

        assert_eq!(foreign_keys.kind, "foreign-keys");
        assert_eq!(foreign_keys.label, "Foreign Keys");
        assert_eq!(
            foreign_keys.path.as_ref().unwrap().last().unwrap(),
            "orders"
        );
    }

    #[test]
    fn postgres_schema_section_nodes_hide_empty_sections() {
        let connection = connection();
        let mut nodes = Vec::new();
        let path = schema_path(&connection, "public");

        push_schema_section(
            &mut nodes,
            &connection,
            "public",
            &path,
            "tables",
            "Tables",
            "tables",
            "Base tables",
            0,
        );
        push_schema_section(
            &mut nodes,
            &connection,
            "public",
            &path,
            "views",
            "Views",
            "views",
            "Stored SELECT projections",
            2,
        );

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "postgres:public:views");
        assert_eq!(nodes[0].scope.as_deref(), Some("postgres:public:views"));
    }

    #[test]
    fn postgres_offline_payload_is_view_friendly_and_not_raw() {
        let connection = connection();
        let payload =
            postgres_offline_payload(&connection, "table:public.accounts", "connection refused");

        assert_eq!(payload["engine"], "postgresql");
        assert_eq!(payload["objectView"], "table");
        assert_eq!(payload["schema"], "public");
        assert_eq!(payload["objectName"], "accounts");
        assert!(payload.get("raw").is_none());
        assert!(payload["warnings"]
            .as_array()
            .is_some_and(|warnings| !warnings.is_empty()));
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn".into(),
            name: "Postgres".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("test_db".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}
