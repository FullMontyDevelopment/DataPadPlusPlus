use std::collections::HashSet;

use serde_json::json;

use super::super::super::*;
use super::catalog::oracle_execution_capabilities;
use super::connection::{oracle_service_name, oracle_sqlplus_path};
use super::query::{oracle_sqlplus_script, parse_oracle_sqlplus_csv, run_oracle_sqlplus_script};
use super::session::{
    load_oracle_session_context, oracle_managed_response_rows, OracleSessionContext,
    ORACLE_SESSION_CONTEXT_QUERY,
};
use super::sidecar::{execute_oracle_managed_read, oracle_execution_runtime};

const ORACLE_OBJECT_CATEGORIES: [(&str, &str, &str); 12] = [
    ("tables", "Tables", "Base tables."),
    ("views", "Views", "Stored query projections."),
    (
        "materialized-views",
        "Materialized Views",
        "Refreshable persisted query results.",
    ),
    ("synonyms", "Synonyms", "Object aliases."),
    ("sequences", "Sequences", "Generated numeric sequences."),
    ("functions", "Functions", "Standalone PL/SQL functions."),
    ("procedures", "Procedures", "Standalone PL/SQL procedures."),
    (
        "packages",
        "Packages",
        "PL/SQL package specifications and bodies.",
    ),
    (
        "types",
        "Types",
        "Object, collection, and user-defined types.",
    ),
    (
        "json-collections",
        "JSON Collections",
        "Tables with visible JSON columns.",
    ),
    (
        "external-tables",
        "External Tables",
        "External file-backed tables.",
    ),
    (
        "database-links",
        "Database Links",
        "Remote database link definitions.",
    ),
];

pub(super) async fn list_oracle_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("oracle:containers") => container_nodes(connection).await,
        Some(scope) if scope.starts_with("oracle:container:") => {
            container_child_nodes(connection, scope).await
        }
        Some("oracle:schemas") => schema_nodes(connection, request.limit.unwrap_or(250)).await,
        Some(scope) if scope.starts_with("oracle:schema:") => schema_child_nodes(connection, scope),
        Some(scope) if scope.starts_with("oracle:category:") => {
            category_object_nodes(connection, scope, request.limit.unwrap_or(100)).await
        }
        Some(scope) if scope.starts_with("oracle:object:") => {
            object_child_nodes(connection, scope, request.limit.unwrap_or(250)).await
        }
        Some("oracle:security") => security_nodes(connection),
        Some("oracle:storage") => storage_nodes(connection),
        Some("oracle:performance") => performance_nodes(connection),
        Some("oracle:scheduler") => scheduler_nodes(connection),
        Some("oracle:queues") => queue_nodes(connection),
        Some("oracle:replication") => replication_nodes(connection),
        Some("oracle:data-guard") => data_guard_nodes(connection),
        Some("oracle:rac") => rac_nodes(connection),
        Some("oracle:flashback") => flashback_nodes(connection),
        Some("oracle:diagnostics") => diagnostics_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection).await,
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Oracle explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: oracle_execution_capabilities(),
        nodes,
    })
}

pub(super) fn inspect_oracle_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let (query_template, payload) = inspect_payload(connection, &request.node_id);

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Oracle view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    }
}

async fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let mut nodes = container_nodes(connection).await;

    nodes.extend(
        [
            section(
                "oracle-schemas",
                "Schemas",
                "schemas",
                "Users and object schemas.",
                "oracle:schemas",
                "select owner, count(*) object_count from all_objects group by owner order by case when owner = sys_context('USERENV', 'CURRENT_SCHEMA') then 0 else 1 end, owner",
            ),
            section(
                "oracle-security",
                "Security",
                "security",
                "Users, roles, profiles, privileges, and grants.",
                "oracle:security",
                "select * from session_privs",
            ),
            section(
                "oracle-storage",
                "Storage",
                "storage",
                "Tablespaces, files, quotas, and segment storage.",
                "oracle:storage",
                "select tablespace_name, status from user_tablespaces order by tablespace_name",
            ),
            section(
                "oracle-performance",
                "Performance",
                "performance",
                "Sessions, waits, SQL Monitor, and lock diagnostics.",
                "oracle:performance",
                "select * from v$session where rownum <= 100",
            ),
            section(
                "oracle-diagnostics",
                "Diagnostics",
                "diagnostics",
                "Plans, locks, waits, and database health.",
                "oracle:diagnostics",
                "select * from table(dbms_xplan.display)",
            ),
        ]
        .into_iter()
        .map(|definition| definition.into_node(connection, vec![connection.name.clone()])),
    );

    nodes
}

async fn container_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    match load_oracle_session_context(connection).await {
        Ok(context) => vec![oracle_database_node(connection, &context)],
        Err(error) => vec![oracle_session_context_notice_node(connection, &error)],
    }
}

async fn container_child_nodes(
    connection: &ResolvedConnectionProfile,
    _scope: &str,
) -> Vec<ExplorerNode> {
    match load_oracle_session_context(connection).await {
        Ok(context) => schema_section_nodes(
            connection,
            &OracleObjectContext::database(
                connection,
                context.database_label().to_string(),
                context.current_schema,
            ),
        ),
        Err(error) => vec![oracle_session_context_notice_node(connection, &error)],
    }
}

async fn schema_nodes(connection: &ResolvedConnectionProfile, limit: u32) -> Vec<ExplorerNode> {
    let query = oracle_schema_discovery_query();
    let runtime = oracle_execution_runtime(connection);
    let loaded = match runtime {
        "managed" => execute_oracle_managed_read(connection, &query, limit)
            .await
            .and_then(|response| oracle_managed_response_rows(&response)),
        "sqlplus" => {
            let path = oracle_sqlplus_path(connection).unwrap_or_else(|| "sqlplus".into());
            load_oracle_category_rows(connection, &path, &query, limit).await
        }
        "contract" => Ok(vec![vec![
            OracleSessionContext::contract(connection).current_schema,
            "0".into(),
        ]]),
        unsupported => Err(CommandError::new(
            "oracle-runtime-unsupported",
            format!("Oracle execution runtime '{unsupported}' is not supported."),
        )),
    };

    match loaded {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|row| {
                let schema = row.first()?.trim();
                if schema.is_empty() {
                    return None;
                }
                Some(ExplorerNode {
                    id: format!("oracle-schema:{}", encode_scope_component(schema)),
                    family: "sql".into(),
                    label: schema.into(),
                    kind: "schema".into(),
                    detail: row
                        .get(1)
                        .filter(|value| !value.trim().is_empty())
                        .map(|count| format!("Oracle schema / {count} visible object(s)."))
                        .unwrap_or_else(|| "Oracle object schema.".into()),
                    scope: Some(format!(
                        "oracle:schema:{}",
                        encode_scope_component(schema)
                    )),
                    path: Some(vec![connection.name.clone(), "Schemas".into()]),
                    query_template: Some(format!(
                        "select object_type, count(*) from all_objects where owner = '{}' group by object_type order by object_type",
                        sql_literal(schema)
                    )),
                    expandable: Some(true),
                })
            })
            .collect(),
        Err(error) => vec![ExplorerNode {
            id: "oracle-schemas-metadata-unavailable".into(),
            family: "sql".into(),
            label: "Schema metadata unavailable".into(),
            kind: "warning".into(),
            detail: error.message,
            scope: None,
            path: Some(vec![connection.name.clone(), "Schemas".into()]),
            query_template: None,
            expandable: Some(false),
        }],
    }
}

fn schema_child_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let Some(schema) = decode_scope_component(scope.trim_start_matches("oracle:schema:")) else {
        return Vec::new();
    };
    schema_section_nodes(connection, &OracleObjectContext::schema(connection, schema))
}

fn schema_section_nodes(
    connection: &ResolvedConnectionProfile,
    context: &OracleObjectContext,
) -> Vec<ExplorerNode> {
    ORACLE_OBJECT_CATEGORIES
        .into_iter()
        .map(|(kind, label, detail)| {
            object_category(
                context,
                label,
                kind,
                detail,
                oracle_category_query(kind, &context.schema),
            )
            .into_node(connection, context.base_path.clone())
        })
        .collect()
}

#[derive(Clone)]
struct OracleObjectContext {
    key: String,
    schema: String,
    base_path: Vec<String>,
    origin: OracleObjectOrigin,
}

#[derive(Clone)]
enum OracleObjectOrigin {
    Database { container: String },
    Schema,
}

impl OracleObjectContext {
    fn database(connection: &ResolvedConnectionProfile, service: String, schema: String) -> Self {
        Self {
            key: format!(
                "database:{}:{}",
                encode_scope_component(&service),
                encode_scope_component(&schema)
            ),
            schema,
            base_path: vec![connection.name.clone(), "Databases".into(), service.clone()],
            origin: OracleObjectOrigin::Database { container: service },
        }
    }

    fn schema(connection: &ResolvedConnectionProfile, schema: String) -> Self {
        Self {
            key: format!("schema:{}", encode_scope_component(&schema)),
            schema: schema.clone(),
            base_path: vec![connection.name.clone(), "Schemas".into(), schema],
            origin: OracleObjectOrigin::Schema,
        }
    }

    fn from_category_scope(
        connection: &ResolvedConnectionProfile,
        scope: &str,
    ) -> Option<(Self, String)> {
        let parts = scope
            .strip_prefix("oracle:category:")?
            .split(':')
            .collect::<Vec<_>>();

        match parts.as_slice() {
            ["database", service, schema, category] => Some((
                Self::database(
                    connection,
                    decode_scope_component(service)?,
                    decode_scope_component(schema)?,
                ),
                (*category).into(),
            )),
            ["schema", schema, category] => Some((
                Self::schema(connection, decode_scope_component(schema)?),
                (*category).into(),
            )),
            _ => None,
        }
    }

    fn category_id(&self, category: &str) -> String {
        format!("oracle-{category}:{}", self.key)
    }

    fn category_scope(&self, category: &str) -> String {
        format!("oracle:category:{}:{category}", self.key)
    }

    fn object_id(&self, kind: &str, object_name: &str) -> String {
        format!(
            "oracle-{kind}:{}:{}",
            self.key,
            encode_scope_component(object_name)
        )
    }

    fn object_scope(&self, kind: &str, object_name: &str) -> String {
        let object_name = encode_scope_component(object_name);
        let schema = encode_scope_component(&self.schema);
        match &self.origin {
            OracleObjectOrigin::Database { container } => format!(
                "oracle:object:{kind}:database:{}:{schema}:{object_name}",
                encode_scope_component(container)
            ),
            OracleObjectOrigin::Schema => {
                format!("oracle:object:{kind}:schema:{schema}:{object_name}")
            }
        }
    }

    fn from_object_scope(
        connection: &ResolvedConnectionProfile,
        scope: &str,
    ) -> Option<(Self, String, String)> {
        let parts = scope
            .strip_prefix("oracle:object:")?
            .split(':')
            .collect::<Vec<_>>();
        match parts.as_slice() {
            [kind, "database", container, schema, object_name] => Some((
                Self::database(
                    connection,
                    decode_scope_component(container)?,
                    decode_scope_component(schema)?,
                ),
                (*kind).into(),
                decode_scope_component(object_name)?,
            )),
            [kind, "schema", schema, object_name] => Some((
                Self::schema(connection, decode_scope_component(schema)?),
                (*kind).into(),
                decode_scope_component(object_name)?,
            )),
            [kind, schema, object_name] => Some((
                Self::schema(connection, decode_scope_component(schema)?),
                (*kind).into(),
                decode_scope_component(object_name)?,
            )),
            _ => None,
        }
    }

    fn category_path(&self, label: &str) -> Vec<String> {
        let mut path = self.base_path.clone();
        path.push(label.into());
        path
    }

    fn object_path(&self, kind: &str, object_name: &str) -> Vec<String> {
        let mut path = self.category_path(oracle_object_category_label(kind));
        path.push(object_name.into());
        path
    }
}

async fn category_object_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: u32,
) -> Vec<ExplorerNode> {
    let Some((context, category)) = OracleObjectContext::from_category_scope(connection, scope)
    else {
        return Vec::new();
    };
    let Some((_, label, _)) = ORACLE_OBJECT_CATEGORIES
        .iter()
        .find(|(kind, _, _)| *kind == category)
    else {
        return Vec::new();
    };

    let query = oracle_category_query(&category, &context.schema);
    let runtime = oracle_execution_runtime(connection);
    let loaded = match runtime {
        "managed" => execute_oracle_managed_read(connection, &query, limit)
            .await
            .and_then(|response| oracle_managed_response_rows(&response)),
        "sqlplus" => {
            let sqlplus_path = oracle_sqlplus_path(connection).unwrap_or_else(|| "sqlplus".into());
            load_oracle_category_rows(connection, &sqlplus_path, &query, limit).await
        }
        "contract" => Ok(oracle_contract_category_rows(&category, &context.schema)),
        unsupported => Err(CommandError::new(
            "oracle-runtime-unsupported",
            format!("Oracle execution runtime '{unsupported}' is not supported."),
        )),
    };
    let rows = match loaded {
        Ok(rows) => rows,
        Err(error) => return vec![oracle_metadata_notice_node(&context, label, &query, &error)],
    };

    let nodes =
        oracle_object_nodes_from_rows(&context, &category, label, rows, runtime == "contract");
    if nodes.is_empty() {
        vec![oracle_empty_category_node(
            &context, &category, label, &query,
        )]
    } else {
        nodes
    }
}

async fn load_oracle_category_rows(
    connection: &ResolvedConnectionProfile,
    sqlplus_path: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<Vec<String>>, CommandError> {
    let script = oracle_sqlplus_script(connection, query, limit, false)?;
    let output = run_oracle_sqlplus_script(connection, sqlplus_path, &script).await?;
    if output.to_lowercase().contains("no rows selected") {
        return Ok(Vec::new());
    }

    let (_, rows) = parse_oracle_sqlplus_csv(&output, limit)?;
    Ok(rows)
}

fn oracle_object_nodes_from_rows(
    context: &OracleObjectContext,
    category: &str,
    category_label: &str,
    rows: Vec<Vec<String>>,
    contract_preview: bool,
) -> Vec<ExplorerNode> {
    let object_kind = oracle_category_object_kind(category);
    let mut seen = HashSet::new();

    rows.into_iter()
        .filter_map(|row| {
            let object_name = row.get(1)?.trim();
            if object_name.is_empty() || !seen.insert(object_name.to_string()) {
                return None;
            }

            let expandable = !contract_preview && oracle_object_expandable(object_kind);
            Some(ExplorerNode {
                id: context.object_id(object_kind, object_name),
                family: "sql".into(),
                label: object_name.into(),
                kind: object_kind.into(),
                detail: oracle_object_detail(category, &row, contract_preview),
                scope: expandable.then(|| context.object_scope(object_kind, object_name)),
                path: Some(context.category_path(category_label)),
                query_template: Some(oracle_object_query(category, &context.schema, object_name)),
                expandable: Some(expandable),
            })
        })
        .collect()
}

fn oracle_object_expandable(kind: &str) -> bool {
    matches!(
        kind,
        "table"
            | "view"
            | "materialized-view"
            | "external-table"
            | "json-collection"
            | "package"
            | "procedure"
            | "function"
            | "type"
    )
}

async fn object_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: u32,
) -> Vec<ExplorerNode> {
    let Some((context, kind, object_name)) =
        OracleObjectContext::from_object_scope(connection, scope)
    else {
        return Vec::new();
    };
    let schema = context.schema.as_str();
    let Some(query) = oracle_object_children_query(&kind, schema, &object_name) else {
        return Vec::new();
    };
    let runtime = oracle_execution_runtime(connection);
    let loaded = match runtime {
        "managed" => execute_oracle_managed_read(connection, &query, limit)
            .await
            .and_then(|response| oracle_managed_response_rows(&response)),
        "sqlplus" => {
            let path = oracle_sqlplus_path(connection).unwrap_or_else(|| "sqlplus".into());
            load_oracle_category_rows(connection, &path, &query, limit).await
        }
        "contract" => Ok(Vec::new()),
        unsupported => Err(CommandError::new(
            "oracle-runtime-unsupported",
            format!("Oracle execution runtime '{unsupported}' is not supported."),
        )),
    };
    let rows = match loaded {
        Ok(rows) => rows,
        Err(error) => {
            return vec![ExplorerNode {
                id: format!(
                    "oracle-object-metadata-unavailable:{}:{}",
                    context.key,
                    encode_scope_component(&object_name)
                ),
                family: "sql".into(),
                label: "Object metadata unavailable".into(),
                kind: "warning".into(),
                detail: error.message,
                scope: None,
                path: Some(context.object_path(&kind, &object_name)),
                query_template: None,
                expandable: Some(false),
            }]
        }
    };

    rows.into_iter()
        .filter_map(|row| {
            let name = row.first()?.trim();
            if name.is_empty() {
                return None;
            }
            let child_kind = row
                .get(1)
                .map(String::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("object");
            let detail = row
                .iter()
                .skip(2)
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join(" / ");
            Some(ExplorerNode {
                id: format!(
                    "oracle-{child_kind}:{}:{}:{}",
                    context.key,
                    encode_scope_component(&object_name),
                    encode_scope_component(name)
                ),
                family: "sql".into(),
                label: name.into(),
                kind: child_kind.into(),
                detail,
                scope: None,
                path: Some(context.object_path(&kind, &object_name)),
                query_template: oracle_child_query(&kind, child_kind, schema, &object_name, name),
                expandable: Some(false),
            })
        })
        .collect()
}

fn oracle_object_children_query(kind: &str, schema: &str, object_name: &str) -> Option<String> {
    let owner = sql_literal(schema);
    let object = sql_literal(object_name);
    match kind {
        "table" => Some(format!(
            "select column_name, 'column', data_type || case when data_type in ('VARCHAR2','CHAR','NVARCHAR2','NCHAR','RAW') then '(' || data_length || ')' when data_type = 'NUMBER' and data_precision is not null then '(' || data_precision || nvl2(data_scale, ',' || data_scale, '') || ')' else '' end, case nullable when 'N' then 'NOT NULL' else 'NULL' end from all_tab_columns where owner = '{owner}' and table_name = '{object}' union all select constraint_name, 'constraint', constraint_type, status from all_constraints where owner = '{owner}' and table_name = '{object}' union all select index_name, 'index', uniqueness, status from all_indexes where owner = '{owner}' and table_name = '{object}' union all select trigger_name, 'trigger', trigger_type, status from all_triggers where table_owner = '{owner}' and table_name = '{object}' order by 2, 1"
        )),
        "view" | "materialized-view" | "external-table" | "json-collection" => Some(format!(
            "select column_name, 'column', data_type || case when data_type in ('VARCHAR2','CHAR','NVARCHAR2','NCHAR','RAW') then '(' || data_length || ')' when data_type = 'NUMBER' and data_precision is not null then '(' || data_precision || nvl2(data_scale, ',' || data_scale, '') || ')' else '' end, case nullable when 'N' then 'NOT NULL' else 'NULL' end from all_tab_columns where owner = '{owner}' and table_name = '{object}' order by column_id"
        )),
        "package" => Some(format!(
            "select procedure_name, case when procedure_name is null then 'package' when object_type = 'PACKAGE' then 'procedure' else lower(object_type) end, nvl(overload, '-'), object_type from all_procedures where owner = '{owner}' and object_name = '{object}' and procedure_name is not null order by subprogram_id"
        )),
        "procedure" | "function" => Some(format!(
            "select nvl(argument_name, 'RETURN_VALUE'), 'argument', nvl(data_type, type_name), in_out from all_arguments where owner = '{owner}' and object_name = '{object}' order by overload, sequence"
        )),
        "type" => Some(format!(
            "select attr_name, 'attribute', attr_type_name, to_char(attr_no) from all_type_attrs where owner = '{owner}' and type_name = '{object}' union all select method_name, 'method', method_type, to_char(parameters) from all_type_methods where owner = '{owner}' and type_name = '{object}' order by 2, 1"
        )),
        _ => None,
    }
}

fn quoted_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn oracle_child_query(
    parent_kind: &str,
    child_kind: &str,
    schema: &str,
    object_name: &str,
    child_name: &str,
) -> Option<String> {
    match child_kind {
        "column"
            if matches!(
                parent_kind,
                "table" | "view" | "materialized-view" | "external-table" | "json-collection"
            ) =>
        {
            Some(format!(
                "select {} from {}.{} fetch first 100 rows only",
                quoted_identifier(child_name),
                quoted_identifier(schema),
                quoted_identifier(object_name)
            ))
        }
        "procedure" | "function" if parent_kind == "package" => Some(format!(
            "begin {}.{}.{}; end;",
            quoted_identifier(schema),
            quoted_identifier(object_name),
            quoted_identifier(child_name)
        )),
        _ => None,
    }
}

fn oracle_metadata_notice_node(
    context: &OracleObjectContext,
    category_label: &str,
    query: &str,
    error: &CommandError,
) -> ExplorerNode {
    let label = match error.code.as_str() {
        "oracle-sidecar-blocked" => "Oracle runtime blocked by device policy",
        "oracle-sidecar-startup-failed" => "Oracle runtime could not start",
        "oracle-sidecar-not-found" | "oracle-sidecar-unavailable" => {
            "Bundled Oracle runtime unavailable"
        }
        "ORA-01017" | "oracle-authentication-failed" => "Oracle authentication failed",
        "ORA-01031" | "oracle-insufficient-privileges" => "Metadata access restricted",
        _ => "Oracle metadata query failed",
    };
    ExplorerNode {
        id: format!(
            "oracle-metadata-unavailable:{}:{category_label}",
            context.key
        ),
        family: "sql".into(),
        label: label.into(),
        kind: "warning".into(),
        detail: format!("{}: {}", error.code, error.message),
        scope: None,
        path: Some(context.category_path(category_label)),
        query_template: Some(query.into()),
        expandable: Some(false),
    }
}

fn oracle_category_query(category: &str, schema: &str) -> String {
    match category {
        "tables" => oracle_tables_query(schema),
        "views" => oracle_views_query(schema),
        "materialized-views" => format!(
            "select owner, mview_name, refresh_mode, refresh_method from all_mviews where owner = '{}' order by mview_name",
            sql_literal(schema)
        ),
        "synonyms" => format!(
            "select owner, synonym_name, table_owner, table_name from all_synonyms where owner = '{}' order by synonym_name",
            sql_literal(schema)
        ),
        "sequences" => format!(
            "select sequence_owner, sequence_name, min_value, max_value, increment_by, cache_size from all_sequences where sequence_owner = '{}' order by sequence_name",
            sql_literal(schema)
        ),
        "functions" => oracle_objects_query(schema, &["FUNCTION"]),
        "procedures" => oracle_objects_query(schema, &["PROCEDURE"]),
        "packages" => oracle_objects_query(schema, &["PACKAGE", "PACKAGE BODY"]),
        "types" => oracle_objects_query(schema, &["TYPE", "TYPE BODY"]),
        "json-collections" => oracle_json_query(schema),
        "external-tables" => format!(
            "select owner, table_name, type_name from all_external_tables where owner = '{}' order by table_name",
            sql_literal(schema)
        ),
        "database-links" => format!(
            "select owner, db_link, username, host from all_db_links where owner = '{}' order by db_link",
            sql_literal(schema)
        ),
        _ => oracle_objects_query(schema, &["TABLE"]),
    }
}

fn oracle_category_object_kind(category: &str) -> &str {
    match category {
        "tables" => "table",
        "views" => "view",
        "materialized-views" => "materialized-view",
        "synonyms" => "synonym",
        "sequences" => "sequence",
        "functions" => "function",
        "procedures" => "procedure",
        "packages" => "package",
        "types" => "type",
        "json-collections" => "json-collection",
        "external-tables" => "external-table",
        "database-links" => "database-link",
        _ => "object",
    }
}

fn oracle_object_query(category: &str, schema: &str, object_name: &str) -> String {
    match category {
        "tables" | "views" | "materialized-views" | "json-collections"
        | "external-tables" => oracle_table_query(schema, object_name),
        "synonyms" => format!(
            "select owner, synonym_name, table_owner, table_name, db_link from all_synonyms where owner = '{}' and synonym_name = '{}'",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        "sequences" => format!(
            "select sequence_owner, sequence_name, min_value, max_value, increment_by, cache_size, cycle_flag, order_flag from all_sequences where sequence_owner = '{}' and sequence_name = '{}'",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        "functions" | "procedures" | "packages" | "types" => format!(
            "select owner, name, type, line, text from all_source where owner = '{}' and name = '{}' order by type, line",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        "database-links" => format!(
            "select owner, db_link, username, host from all_db_links where owner = '{}' and db_link = '{}'",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        _ => oracle_objects_query(schema, &["TABLE"]),
    }
}

fn oracle_object_detail(category: &str, row: &[String], contract_preview: bool) -> String {
    let values = match category {
        "tables" => vec![row_value(row, 3), row_value(row, 2)],
        "views" => vec![format!("Definition length {}", row_value(row, 2))],
        "materialized-views" => vec![format!("{} refresh", row_value(row, 2)), row_value(row, 3)],
        "synonyms" => vec![format!(
            "Target {}.{}",
            row_value(row, 2),
            row_value(row, 3)
        )],
        "sequences" => vec![
            format!("Increment {}", row_value(row, 4)),
            format!("Cache {}", row_value(row, 5)),
        ],
        "functions" | "procedures" | "packages" | "types" => {
            vec![row_value(row, 2), row_value(row, 3)]
        }
        "json-collections" => vec![format!("JSON column {}", row_value(row, 2))],
        "external-tables" => vec![format!("Access type {}", row_value(row, 2))],
        "database-links" => vec![
            format!("User {}", row_value(row, 2)),
            format!("Host {}", row_value(row, 3)),
        ],
        _ => Vec::new(),
    };
    let mut detail = values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    if contract_preview {
        if !detail.is_empty() {
            detail.push_str(" | ");
        }
        detail
            .push_str("Preview-only metadata; use the desktop built-in runtime for live objects.");
    }
    detail
}

fn row_value(row: &[String], index: usize) -> String {
    row.get(index)
        .map_or_else(String::new, |value| value.trim().into())
}

fn oracle_contract_category_rows(category: &str, schema: &str) -> Vec<Vec<String>> {
    let rows: Vec<Vec<&str>> = match category {
        "tables" => vec![
            vec![schema, "ACCOUNTS", "USERS", "VALID"],
            vec![schema, "ORDERS", "USERS", "VALID"],
            vec![schema, "ORDER_ITEMS", "USERS", "VALID"],
            vec![schema, "SUPPORT_TICKETS", "USERS", "VALID"],
        ],
        "views" => vec![vec![schema, "ORDER_FULFILLMENT_SUMMARY", "482"]],
        "materialized-views" => vec![vec![schema, "ACCOUNT_BALANCES_MV", "DEMAND", "COMPLETE"]],
        "synonyms" => vec![vec![schema, "CUSTOMERS", schema, "ACCOUNTS"]],
        "sequences" => vec![
            vec![schema, "ACCOUNTS_SEQ", "1", "999999999", "1", "20"],
            vec![schema, "ORDERS_SEQ", "1", "999999999", "1", "50"],
        ],
        "functions" => vec![vec![schema, "ACCOUNT_STATUS", "FUNCTION", "VALID"]],
        "procedures" => vec![vec![schema, "REFRESH_ACCOUNT_CACHE", "PROCEDURE", "VALID"]],
        "packages" => vec![
            vec![schema, "ACCOUNT_API", "PACKAGE", "VALID"],
            vec![schema, "ACCOUNT_API", "PACKAGE BODY", "VALID"],
            vec![schema, "ORDER_API", "PACKAGE", "VALID"],
            vec![schema, "ORDER_API", "PACKAGE BODY", "INVALID"],
        ],
        "types" => vec![vec![schema, "ACCOUNT_ROW_T", "TYPE", "VALID"]],
        "json-collections" => vec![vec![schema, "ACCOUNT_DOCUMENTS", "DOCUMENT"]],
        "external-tables" => vec![vec![schema, "IMPORT_TRANSACTIONS", "ORACLE_LOADER"]],
        "database-links" => vec![vec![
            schema,
            "REPORTING_DB",
            "REPORTING",
            "reporting.internal",
        ]],
        _ => Vec::new(),
    };

    rows.into_iter()
        .map(|row| row.into_iter().map(str::to_string).collect())
        .collect()
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        object_section(
            "SECURITY",
            "Users",
            "users",
            "Database users.",
            "select username, user_id, created, common, oracle_maintained from all_users order by username"
                .into(),
        ),
        object_section(
            "SECURITY",
            "Roles",
            "roles",
            "Granted roles.",
            "select * from session_roles order by role".into(),
        ),
        object_section(
            "SECURITY",
            "Profiles",
            "profiles",
            "Password and resource profiles.",
            "select * from dba_profiles where rownum <= 100".into(),
        ),
        object_section(
            "SECURITY",
            "Privileges",
            "privileges",
            "Effective system and object privileges.",
            "select * from session_privs union all select * from session_roles".into(),
        ),
    ]
    .into_iter()
    .map(|definition| {
        definition.into_node(connection, vec![connection.name.clone(), "Security".into()])
    })
    .collect()
}

fn storage_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Storage", [
        ("oracle-tablespaces", "Tablespaces", "tablespaces", "Tablespace status and allocation.", "select tablespace_name, status from user_tablespaces order by tablespace_name"),
        ("oracle-data-files", "Data Files", "files", "Data file metadata where granted.", "select file_name, tablespace_name, bytes from dba_data_files where rownum <= 100"),
        ("oracle-segments", "Segments", "segments", "Segment sizes and owners.", "select owner, segment_name, segment_type, bytes from dba_segments where rownum <= 100"),
        ("oracle-quotas", "Quotas", "quotas", "User tablespace quotas.", "select * from user_ts_quotas"),
    ])
}

fn performance_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Performance",
        [
            (
                "oracle-sessions",
                "Sessions",
                "sessions",
                "Active sessions.",
                "select * from v$session where rownum <= 100",
            ),
            (
                "oracle-waits",
                "Waits",
                "waits",
                "Session wait classes.",
                "select * from v$session_wait where rownum <= 100",
            ),
            (
                "oracle-top-sql",
                "Top SQL",
                "sql-monitor",
                "High activity SQL.",
                "select * from v$sql where rownum <= 100",
            ),
        ],
    )
}

fn scheduler_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Scheduler", [
        ("oracle-scheduler-jobs", "Jobs", "jobs", "Scheduler jobs.", "select owner, job_name, enabled, state from all_scheduler_jobs order by owner, job_name"),
        ("oracle-scheduler-programs", "Programs", "programs", "Scheduler programs.", "select owner, program_name, enabled from all_scheduler_programs order by owner, program_name"),
        ("oracle-scheduler-chains", "Chains", "chains", "Scheduler chains.", "select owner, chain_name, enabled from all_scheduler_chains order by owner, chain_name"),
        ("oracle-scheduler-windows", "Windows", "windows", "Scheduler windows.", "select window_name, enabled from all_scheduler_windows order by window_name"),
    ])
}

fn queue_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Queues",
        [
            (
                "oracle-queues-list",
                "Queues",
                "queues",
                "Advanced Queuing queues.",
                "select owner, queue_name, queue_table from all_queues order by owner, queue_name",
            ),
            (
                "oracle-queue-tables",
                "Queue Tables",
                "queue-tables",
                "Advanced Queuing tables.",
                "select owner, queue_table, type from all_queue_tables order by owner, queue_table",
            ),
        ],
    )
}

fn replication_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Replication",
        [
            (
                "oracle-registered-mviews",
                "Registered Materialized Views",
                "materialized-views",
                "Replication materialized views.",
                "select * from all_registered_mviews where rownum <= 100",
            ),
            (
                "oracle-goldengate",
                "GoldenGate",
                "replication",
                "GoldenGate status templates where views exist.",
                "select * from dba_goldengate_support_mode where rownum <= 100",
            ),
        ],
    )
}

fn data_guard_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Data Guard", [
        ("oracle-database-role", "Database Role", "data-guard", "Data Guard role and protection mode.", "select database_role, protection_mode, open_mode from v$database"),
        ("oracle-archive-dest", "Archive Destinations", "archive-destinations", "Archive destination status.", "select dest_id, status, destination, error from v$archive_dest where rownum <= 100"),
    ])
}

fn rac_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "RAC",
        [
            (
                "oracle-instances",
                "Instances",
                "instances",
                "RAC/GV$ instance status.",
                "select inst_id, instance_name, status from gv$instance",
            ),
            (
                "oracle-services",
                "Services",
                "services",
                "Cluster services.",
                "select inst_id, name, network_name from gv$services",
            ),
        ],
    )
}

fn flashback_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Flashback",
        [
            (
                "oracle-restore-points",
                "Restore Points",
                "restore-points",
                "Restore point metadata.",
                "select name, time, guarantee_flashback_database from v$restore_point",
            ),
            (
                "oracle-recyclebin",
                "Recycle Bin",
                "recycle-bin",
                "Dropped objects available for flashback.",
                "select object_name, original_name, type, droptime from user_recyclebin",
            ),
        ],
    )
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Diagnostics", [
        ("oracle-explain-plan", "Execution Plan", "execution-plan", "DBMS_XPLAN output for the last explained statement.", "select * from table(dbms_xplan.display)"),
        ("oracle-sql-monitor", "SQL Monitor", "sql-monitor", "SQL Monitor reports where licensed/granted.", "select * from v$sql_monitor where rownum <= 100"),
        ("oracle-locks", "Locks", "locks", "Lock and blocking session metadata.", "select * from v$lock where rownum <= 100"),
        ("oracle-invalid-objects", "Invalid Objects", "invalid-objects", "Invalid objects and compilation status.", "select owner, object_name, object_type, status from all_objects where status <> 'VALID' order by owner, object_name"),
    ])
}

fn inspect_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> (String, serde_json::Value) {
    let schema = configured_schema(connection);

    for (prefix, kind, category) in [
        ("oracle-table:", "table", "tables"),
        ("oracle-view:", "view", "views"),
        (
            "oracle-materialized-view:",
            "materialized-view",
            "materialized-views",
        ),
        ("oracle-synonym:", "synonym", "synonyms"),
        ("oracle-sequence:", "sequence", "sequences"),
        ("oracle-function:", "function", "functions"),
        ("oracle-procedure:", "procedure", "procedures"),
        ("oracle-package:", "package", "packages"),
        ("oracle-type:", "type", "types"),
        (
            "oracle-json-collection:",
            "json-collection",
            "json-collections",
        ),
        (
            "oracle-external-table:",
            "external-table",
            "external-tables",
        ),
        ("oracle-database-link:", "database-link", "database-links"),
    ] {
        if let Some((schema, object_name)) = oracle_object_target(node_id, prefix) {
            return (
                oracle_object_query(category, &schema, &object_name),
                object_view_payload(connection, kind, &schema, &object_name),
            );
        }
    }

    if node_id.starts_with("oracle-container:")
        || node_id == "oracle-schemas"
        || node_id.starts_with("oracle-schema:")
    {
        return (
            "select owner, object_type, count(*) from all_objects group by owner, object_type"
                .into(),
            oracle_schema_overview_payload(connection, &schema, node_id),
        );
    }

    let query = oracle_query_for_node(node_id, &schema);
    (query, oracle_payload_for_node(connection, &schema, node_id))
}

fn object_view_payload(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    schema: &str,
    object_name: &str,
) -> serde_json::Value {
    let mut payload = json!({
        "engine": "oracle",
        "kind": kind,
        "schema": schema,
        "objectName": object_name,
        "service": oracle_service_name(connection),
        "objects": [{
            "owner": schema,
            "name": object_name,
            "type": kind.replace('-', " ").to_uppercase(),
            "status": "VALID"
        }]
    });

    if kind == "table" {
        payload["rowCount"] = json!(128);
        payload["blocks"] = json!(24);
        payload["avgRowLength"] = json!(128);
        payload["lastAnalyzed"] = json!("2026-05-10");
        payload["columns"] = json!([
            {"name": "ID", "type": "NUMBER(19)", "nullable": "NO", "default": ""},
            {"name": "ACCOUNT_NAME", "type": "VARCHAR2(200)", "nullable": "NO", "default": ""},
            {"name": "STATUS", "type": "VARCHAR2(40)", "nullable": "YES", "default": "'ACTIVE'"},
            {"name": "CREATED_AT", "type": "TIMESTAMP WITH TIME ZONE", "nullable": "NO", "default": "SYSTIMESTAMP"}
        ]);
        payload["indexes"] = json!([
            {"name": format!("{object_name}_PK"), "uniqueness": "UNIQUE", "status": "VALID", "visibility": "VISIBLE"},
            {"name": format!("{object_name}_STATUS_IX"), "uniqueness": "NONUNIQUE", "status": "VALID", "visibility": "VISIBLE"}
        ]);
        payload["constraints"] = json!([
            {"name": format!("{object_name}_PK"), "type": "PRIMARY KEY", "status": "ENABLED", "columns": "ID"},
            {"name": format!("{object_name}_STATUS_CK"), "type": "CHECK", "status": "ENABLED", "columns": "STATUS"}
        ]);
        payload["triggers"] = json!([
            {"name": format!("{object_name}_BI"), "timing": "BEFORE EACH ROW", "event": "INSERT", "status": "ENABLED"}
        ]);
        payload["grants"] = json!([
            {"grantee": "REPORTING", "privilege": "SELECT", "objectName": object_name, "grantable": "NO"}
        ]);
    }

    payload
}

fn oracle_object_target(node_id: &str, prefix: &str) -> Option<(String, String)> {
    let mut parts = node_id.strip_prefix(prefix)?.rsplit(':');
    let object_name = decode_scope_component(parts.next()?.trim())?;
    let schema = decode_scope_component(parts.next()?.trim())?;
    if schema.is_empty() || object_name.is_empty() {
        return None;
    }

    Some((schema, object_name))
}

fn oracle_schema_overview_payload(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    node_id: &str,
) -> serde_json::Value {
    json!({
        "engine": "oracle",
        "nodeId": node_id,
        "service": oracle_service_name(connection),
        "schema": schema,
        "openMode": "READ WRITE",
        "objectCounts": [
            {"type": "TABLE", "count": 4, "status": "Visible"},
            {"type": "VIEW", "count": 1, "status": "Visible"},
            {"type": "PACKAGE", "count": 2, "status": "Visible"},
            {"type": "SEQUENCE", "count": 2, "status": "Visible"}
        ],
        "invalidObjects": [
            {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID"}
        ],
        "grants": [
            {"grantee": schema, "privilege": "CREATE SESSION", "objectName": "", "grantable": "NO"}
        ]
    })
}

fn oracle_payload_for_node(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    node_id: &str,
) -> serde_json::Value {
    let base = json!({
        "engine": "oracle",
        "nodeId": node_id,
        "service": oracle_service_name(connection),
        "schema": schema
    });

    match node_id {
        id if id.starts_with("oracle-tables:") => merge_json(
            base,
            json!({
                "tables": [
                    {"owner": schema, "name": "ACCOUNTS", "status": "VALID", "tablespace": "USERS", "rows": 128},
                    {"owner": schema, "name": "ORDERS", "status": "VALID", "tablespace": "USERS", "rows": 348},
                    {"owner": schema, "name": "ORDER_ITEMS", "status": "VALID", "tablespace": "USERS", "rows": 75000},
                    {"owner": schema, "name": "SUPPORT_TICKETS", "status": "VALID", "tablespace": "USERS", "rows": 5000}
                ]
            }),
        ),
        id if id.starts_with("oracle-views:") => merge_json(
            base,
            json!({
                "views": [
                    {"owner": schema, "name": "ORDER_FULFILLMENT_SUMMARY", "textLength": 482, "status": "VALID"}
                ]
            }),
        ),
        id if id.starts_with("oracle-materialized-views:") || id.starts_with("oracle-mviews:") => {
            merge_json(
                base,
                json!({
                    "materializedViews": [
                        {"owner": schema, "name": "ACCOUNT_BALANCES_MV", "refreshMode": "DEMAND", "status": "VALID"}
                    ]
                }),
            )
        }
        id if id.starts_with("oracle-sequences:") => merge_json(
            base,
            json!({
                "sequences": [
                    {"owner": schema, "name": "ACCOUNTS_SEQ", "increment": 1, "cache": 20},
                    {"owner": schema, "name": "ORDERS_SEQ", "increment": 1, "cache": 50}
                ]
            }),
        ),
        id if id.starts_with("oracle-synonyms:") => merge_json(
            base,
            json!({
                "synonyms": [
                    {"owner": schema, "name": "CUSTOMERS", "targetOwner": schema, "targetObject": "ACCOUNTS"}
                ]
            }),
        ),
        id if id.starts_with("oracle-packages:") => merge_json(
            base,
            json!({
                "packages": [
                    {"owner": schema, "name": "ACCOUNT_API", "type": "PACKAGE", "status": "VALID", "lastDdlTime": "2026-05-01"},
                    {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID", "lastDdlTime": "2026-05-06"}
                ]
            }),
        ),
        id if id.starts_with("oracle-procedures:") => merge_json(
            base,
            json!({
                "procedures": [
                    {"owner": schema, "name": "REFRESH_ACCOUNT_CACHE", "status": "VALID", "lastDdlTime": "2026-05-02"}
                ]
            }),
        ),
        id if id.starts_with("oracle-functions:") => merge_json(
            base,
            json!({
                "functions": [
                    {"owner": schema, "name": "ACCOUNT_STATUS", "status": "VALID", "lastDdlTime": "2026-05-02"}
                ]
            }),
        ),
        id if id.starts_with("oracle-types:") => merge_json(
            base,
            json!({
                "types": [
                    {"owner": schema, "name": "ACCOUNT_ROW_T", "type": "OBJECT", "status": "VALID"}
                ]
            }),
        ),
        id if id.starts_with("oracle-json-collections:") || id.starts_with("oracle-json:") => {
            merge_json(
                base,
                json!({
                    "jsonCollections": [
                        {"owner": schema, "name": "ACCOUNT_DOCUMENTS", "column": "DOCUMENT", "status": "VALID"}
                    ]
                }),
            )
        }
        id if id.starts_with("oracle-external-tables:") || id.starts_with("oracle-external:") => {
            merge_json(
                base,
                json!({
                    "externalTables": [
                        {"owner": schema, "name": "IMPORT_TRANSACTIONS", "type": "ORACLE_LOADER", "status": "VALID"}
                    ]
                }),
            )
        }
        id if id.starts_with("oracle-database-links:") || id.starts_with("oracle-dblinks:") => {
            merge_json(
                base,
                json!({
                    "databaseLinks": [
                        {"owner": schema, "name": "REPORTING_DB", "username": "REPORTING", "host": "reporting.internal"}
                    ]
                }),
            )
        }
        "oracle-security" | "oracle-users" => merge_json(
            base,
            json!({
                "users": [
                    {"username": schema, "accountStatus": "OPEN", "defaultTablespace": "USERS", "profile": "DEFAULT"}
                ],
                "warnings": ["DBA_USERS may require elevated privileges; showing visible user metadata."]
            }),
        ),
        "oracle-roles" => merge_json(
            base,
            json!({
                "roles": [
                    {"role": "CONNECT", "source": "SESSION_ROLES", "defaultRole": "YES", "adminOption": "NO"},
                    {"role": "RESOURCE", "source": "SESSION_ROLES", "defaultRole": "YES", "adminOption": "NO"}
                ]
            }),
        ),
        "oracle-profiles" => merge_json(
            base,
            json!({
                "profiles": [
                    {"profile": "DEFAULT", "resourceName": "FAILED_LOGIN_ATTEMPTS", "limit": "10", "resourceType": "PASSWORD"}
                ],
                "warnings": ["Profile details may be partial without DBA_PROFILES access."]
            }),
        ),
        "oracle-privileges" => merge_json(
            base,
            json!({
                "grants": [
                    {"grantee": schema, "privilege": "CREATE SESSION", "objectName": "", "grantable": "NO"},
                    {"grantee": schema, "privilege": "SELECT", "objectName": "ACCOUNTS", "grantable": "NO"}
                ]
            }),
        ),
        "oracle-storage" | "oracle-tablespaces" => merge_json(
            base,
            json!({
                "allocatedBytes": 536870912,
                "usedBytes": 167772160,
                "freeBytes": 369098752,
                "tablespaces": [
                    {"name": "USERS", "status": "ONLINE", "contents": "PERMANENT", "extentManagement": "LOCAL"},
                    {"name": "TEMP", "status": "ONLINE", "contents": "TEMPORARY", "extentManagement": "LOCAL"}
                ]
            }),
        ),
        "oracle-data-files" => merge_json(
            base,
            json!({
                "dataFiles": [
                    {"tablespaceName": "USERS", "fileName": "users01.dbf", "bytes": 536870912, "status": "AVAILABLE"}
                ],
                "warnings": ["Data file details require DBA_DATA_FILES access on live Oracle connections."]
            }),
        ),
        "oracle-segments" => merge_json(
            base,
            json!({
                "segments": [
                    {"owner": schema, "name": "ACCOUNTS", "type": "TABLE", "bytes": 8388608},
                    {"owner": schema, "name": "ACCOUNTS_PK", "type": "INDEX", "bytes": 1048576}
                ]
            }),
        ),
        "oracle-quotas" => merge_json(
            base,
            json!({
                "quotas": [
                    {"tablespaceName": "USERS", "bytes": 167772160, "maxBytes": 1073741824, "blocks": 20480}
                ]
            }),
        ),
        "oracle-performance" | "oracle-sessions" => merge_json(
            base,
            json!({
                "activeSessions": 3,
                "blockedSessions": 0,
                "sessions": [
                    {"sid": 42, "username": schema, "status": "ACTIVE", "waitClass": "CPU"},
                    {"sid": 84, "username": "SYS", "status": "INACTIVE", "waitClass": "Idle"}
                ],
                "warnings": ["Session diagnostics may be partial without V$SESSION privileges."]
            }),
        ),
        "oracle-locks" => merge_json(
            base,
            json!({
                "blockedSessions": 0,
                "locks": [
                    {"sid": 42, "type": "TX", "modeHeld": "ROW-X", "request": "NONE", "blocking": "NO"}
                ]
            }),
        ),
        "oracle-top-sql" | "oracle-sql-monitor" => merge_json(
            base,
            json!({
                "topSql": [
                    {"sqlId": "9xv6b7p1", "status": "DONE", "elapsedMs": 18, "sqlText": "select * from APP.ACCOUNTS where rownum <= 100"}
                ]
            }),
        ),
        "oracle-explain-plan" => merge_json(
            base,
            json!({
                "elapsedMs": 12,
                "planLines": [
                    {"id": 0, "operation": "SELECT STATEMENT", "objectName": "", "rows": 100, "cost": 4},
                    {"id": 1, "operation": "TABLE ACCESS FULL", "objectName": "ACCOUNTS", "rows": 100, "cost": 4}
                ]
            }),
        ),
        "oracle-diagnostics" | "oracle-invalid-objects" => merge_json(
            base,
            json!({
                "invalidObjects": [
                    {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID"}
                ],
                "warnings": ["Diagnostics are limited to dictionary metadata available to this user."]
            }),
        ),
        _ => merge_json(
            base,
            json!({
                "objects": [
                    {"owner": schema, "name": "ACCOUNTS", "type": "TABLE", "status": "VALID"},
                    {"owner": schema, "name": "ACCOUNT_API", "type": "PACKAGE", "status": "VALID"}
                ]
            }),
        ),
    }
}

fn oracle_query_for_node(node_id: &str, schema: &str) -> String {
    match node_id {
        "oracle-security" | "oracle-users" => {
            "select username, user_id, created, common, oracle_maintained from all_users order by username"
                .into()
        }
        "oracle-roles" => "select * from session_roles order by role".into(),
        "oracle-profiles" => "select * from dba_profiles where rownum <= 100".into(),
        "oracle-privileges" => "select * from session_privs".into(),
        "oracle-storage" | "oracle-tablespaces" => {
            "select tablespace_name, status from user_tablespaces order by tablespace_name".into()
        }
        "oracle-data-files" => "select file_name, tablespace_name, bytes from dba_data_files where rownum <= 100".into(),
        "oracle-segments" => "select owner, segment_name, segment_type, bytes from dba_segments where rownum <= 100".into(),
        "oracle-quotas" => "select * from user_ts_quotas".into(),
        "oracle-performance" | "oracle-sessions" => {
            "select * from v$session where rownum <= 100".into()
        }
        "oracle-locks" => "select * from v$lock where rownum <= 100".into(),
        "oracle-top-sql" | "oracle-sql-monitor" => "select * from v$sql where rownum <= 100".into(),
        "oracle-explain-plan" => "select * from table(dbms_xplan.display)".into(),
        "oracle-diagnostics" | "oracle-invalid-objects" => {
            "select owner, object_name, object_type, status from all_objects where status <> 'VALID' order by owner, object_name".into()
        }
        id if id.starts_with("oracle-tables:") => oracle_tables_query(schema),
        id if id.starts_with("oracle-views:") => oracle_views_query(schema),
        id if id.starts_with("oracle-packages:") => oracle_objects_query(schema, &["PACKAGE", "PACKAGE BODY"]),
        id if id.starts_with("oracle-procedures:") => oracle_objects_query(schema, &["PROCEDURE"]),
        id if id.starts_with("oracle-functions:") => oracle_objects_query(schema, &["FUNCTION"]),
        id if id.starts_with("oracle-types:") => oracle_objects_query(schema, &["TYPE", "TYPE BODY"]),
        _ => "select owner, object_name, object_type, status from all_objects where rownum <= 100".into(),
    }
}

fn merge_json(mut base: serde_json::Value, extra: serde_json::Value) -> serde_json::Value {
    if let (Some(base_object), Some(extra_object)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_object {
            base_object.insert(key.clone(), value.clone());
        }
    }

    base
}

fn section(
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    detail: &'static str,
    scope: &'static str,
    query: &'static str,
) -> NodeDefinition {
    NodeDefinition {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        query_template: Some(query.into()),
        expandable: true,
    }
}

fn object_section(
    schema: &str,
    label: &str,
    kind: &str,
    detail: &str,
    query_template: String,
) -> NodeDefinition {
    NodeDefinition {
        id: format!("oracle-{kind}:{schema}"),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        query_template: Some(query_template),
        expandable: false,
    }
}

fn object_category(
    context: &OracleObjectContext,
    label: &str,
    kind: &str,
    detail: &str,
    query_template: String,
) -> NodeDefinition {
    NodeDefinition {
        id: context.category_id(kind),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(context.category_scope(kind)),
        query_template: Some(query_template),
        expandable: true,
    }
}

fn simple_nodes<const N: usize>(
    connection: &ResolvedConnectionProfile,
    root: &str,
    definitions: [(&str, &str, &str, &str, &str); N],
) -> Vec<ExplorerNode> {
    definitions
        .into_iter()
        .map(|(id, label, kind, detail, query)| {
            NodeDefinition {
                id: id.into(),
                label: label.into(),
                kind: kind.into(),
                detail: detail.into(),
                scope: None,
                query_template: Some(query.into()),
                expandable: false,
            }
            .into_node(connection, vec![connection.name.clone(), root.into()])
        })
        .collect()
}

struct NodeDefinition {
    id: String,
    label: String,
    kind: String,
    detail: String,
    scope: Option<String>,
    query_template: Option<String>,
    expandable: bool,
}

impl NodeDefinition {
    fn into_node(self, _connection: &ResolvedConnectionProfile, path: Vec<String>) -> ExplorerNode {
        ExplorerNode {
            id: self.id,
            family: "sql".into(),
            label: self.label,
            kind: self.kind,
            detail: self.detail,
            scope: self.scope,
            path: Some(path),
            query_template: self.query_template,
            expandable: Some(self.expandable),
        }
    }
}

pub(crate) fn oracle_table_query(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} fetch first 100 rows only",
        quote_identifier(schema),
        quote_identifier(table)
    )
}

fn configured_schema(connection: &ResolvedConnectionProfile) -> String {
    connection
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("APP")
        .to_string()
}

fn oracle_database_node(
    connection: &ResolvedConnectionProfile,
    context: &OracleSessionContext,
) -> ExplorerNode {
    let database = context.database_label();
    ExplorerNode {
        id: format!("oracle-container:{}", encode_scope_component(database)),
        family: "sql".into(),
        label: database.into(),
        kind: "database".into(),
        detail: context.detail(),
        scope: Some(format!(
            "oracle:container:{}",
            encode_scope_component(database)
        )),
        path: Some(vec![connection.name.clone(), "Databases".into()]),
        query_template: Some(ORACLE_SESSION_CONTEXT_QUERY.into()),
        expandable: Some(true),
    }
}

fn oracle_session_context_notice_node(
    connection: &ResolvedConnectionProfile,
    error: &CommandError,
) -> ExplorerNode {
    ExplorerNode {
        id: "oracle-session-context-unavailable".into(),
        family: "sql".into(),
        label: "Oracle database metadata unavailable".into(),
        kind: "warning".into(),
        detail: format!("{}: {}", error.code, error.message),
        scope: None,
        path: Some(vec![connection.name.clone(), "Databases".into()]),
        query_template: Some(ORACLE_SESSION_CONTEXT_QUERY.into()),
        expandable: Some(false),
    }
}

fn oracle_schema_discovery_query() -> String {
    let supported_types = "'TABLE','VIEW','MATERIALIZED VIEW','SYNONYM','SEQUENCE','FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TYPE','TYPE BODY','DATABASE LINK'";
    format!(
        "select owner, object_count from (select owner, count(*) object_count from all_objects where object_type in ({supported_types}) group by owner union all select sys_context('USERENV', 'CURRENT_SCHEMA') owner, 0 object_count from dual where not exists (select 1 from all_objects where owner = sys_context('USERENV', 'CURRENT_SCHEMA') and object_type in ({supported_types}))) order by case when owner = sys_context('USERENV', 'CURRENT_SCHEMA') then 0 else 1 end, owner"
    )
}

fn oracle_empty_category_node(
    context: &OracleObjectContext,
    category: &str,
    category_label: &str,
    query: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("oracle-empty-{category}:{}", context.key),
        family: "sql".into(),
        label: format!("No {} visible", category_label.to_lowercase()),
        kind: "info".into(),
        detail: format!(
            "Oracle returned no permission-visible {category_label} for schema {}.",
            context.schema
        ),
        scope: None,
        path: Some(context.category_path(category_label)),
        query_template: Some(query.into()),
        expandable: Some(false),
    }
}

fn oracle_object_category_label(kind: &str) -> &'static str {
    match kind {
        "table" => "Tables",
        "view" => "Views",
        "materialized-view" => "Materialized Views",
        "synonym" => "Synonyms",
        "sequence" => "Sequences",
        "function" => "Functions",
        "procedure" => "Procedures",
        "package" => "Packages",
        "type" => "Types",
        "json-collection" => "JSON Collections",
        "external-table" => "External Tables",
        "database-link" => "Database Links",
        _ => "Objects",
    }
}

fn encode_scope_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_graphic() && byte != b'%' && byte != b':' {
            encoded.push(char::from(byte));
        } else if byte == b' ' {
            encoded.push(' ');
        } else {
            const HEX: &[u8; 16] = b"0123456789ABCDEF";
            encoded.push('%');
            encoded.push(char::from(HEX[(byte >> 4) as usize]));
            encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }
    encoded
}

fn decode_scope_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let hex = bytes.get(index + 1..index + 3)?;
        let hex = std::str::from_utf8(hex).ok()?;
        decoded.push(u8::from_str_radix(hex, 16).ok()?);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn oracle_tables_query(schema: &str) -> String {
    format!(
        "select owner, table_name, tablespace_name, status from all_tables where owner = '{}' order by table_name",
        sql_literal(schema)
    )
}

fn oracle_views_query(schema: &str) -> String {
    format!(
        "select owner, view_name, text_length from all_views where owner = '{}' order by view_name",
        sql_literal(schema)
    )
}

fn oracle_objects_query(schema: &str, object_types: &[&str]) -> String {
    let quoted_types = object_types
        .iter()
        .map(|value| format!("'{}'", sql_literal(value)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "select owner, object_name, object_type, status from all_objects where owner = '{}' and object_type in ({quoted_types}) order by object_name, object_type",
        sql_literal(schema)
    )
}

fn oracle_json_query(schema: &str) -> String {
    format!(
        "select owner, table_name, column_name from all_json_columns where owner = '{}' order by table_name, column_name",
        sql_literal(schema)
    )
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/explorer_tests.rs"]
mod tests;
