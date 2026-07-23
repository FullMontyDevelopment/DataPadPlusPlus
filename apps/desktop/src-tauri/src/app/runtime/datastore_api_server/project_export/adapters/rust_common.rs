use std::fmt::Write as _;

use super::*;

pub(super) struct SqlxClientProfile {
    pub(super) database_type: &'static str,
    pub(super) pool_type: &'static str,
    pub(super) pool_options_type: &'static str,
    pub(super) row_type: &'static str,
}

pub(super) fn render_client_files(
    spec: &ProjectExportSpec,
    adapter: &ProjectExportClientAdapter,
    profile: SqlxClientProfile,
) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    vec![project_file(
        &root,
        "src/repository.rs",
        rust_repository(spec, adapter, &profile),
    )]
}

fn rust_repository(
    spec: &ProjectExportSpec,
    adapter: &ProjectExportClientAdapter,
    profile: &SqlxClientProfile,
) -> String {
    let mut methods = String::new();
    for resource in &spec.resources {
        methods.push_str(&rust_resource_methods(
            resource,
            adapter,
            profile,
            &spec.protocol,
        ));
    }
    for endpoint in &spec.custom_endpoints {
        methods.push_str(&rust_custom_endpoint_method(endpoint));
    }

    format!(
        r#"use crate::models::*;
use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde_json::{{json, Map, Value}};
use sqlx::{{Column, QueryBuilder, Row}};

#[derive(Debug)]
pub struct RepositoryError {{
    #[allow(dead_code)]
    pub kind: &'static str,
    pub message: String,
}}

impl RepositoryError {{
    fn invalid(message: impl Into<String>) -> Self {{
        Self {{ kind: "invalid", message: message.into() }}
    }}

    #[allow(dead_code)]
    fn not_found(message: impl Into<String>) -> Self {{
        Self {{ kind: "not-found", message: message.into() }}
    }}

    fn unavailable(message: impl Into<String>) -> Self {{
        Self {{ kind: "unavailable", message: message.into() }}
    }}

    fn datastore(message: impl Into<String>) -> Self {{
        Self {{ kind: "datastore", message: message.into() }}
    }}
}}

impl std::fmt::Display for RepositoryError {{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {{
        formatter.write_str(&self.message)
    }}
}}

impl std::error::Error for RepositoryError {{}}

#[derive(Clone)]
pub struct DatastoreRepository {{
    pool: {pool_type},
}}

impl DatastoreRepository {{
    pub async fn from_env() -> Result<Self, RepositoryError> {{
        let connection_string = std::env::var({configuration_key})
            .map_err(|_| RepositoryError::unavailable({configuration_message}))?;
        if connection_string.trim().is_empty() {{
            return Err(RepositoryError::unavailable({configuration_message}));
        }}
        let pool = {pool_options_type}::new()
            .max_connections(10)
            .connect(&connection_string)
            .await
            .map_err(|error| RepositoryError::unavailable(format!("Datastore connection failed: {{error}}")))?;
        Ok(Self {{ pool }})
    }}

    pub async fn ping(&self) -> Result<(), RepositoryError> {{
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| RepositoryError::unavailable(format!("Datastore health check failed: {{error}}")))
    }}
{methods}}}

#[allow(dead_code)]
fn parse_identity(raw: &str, composite: bool) -> Result<Value, RepositoryError> {{
    if composite {{
        let value = serde_json::from_str::<Value>(raw)
            .map_err(|error| RepositoryError::invalid(format!("Composite identity must be a JSON object: {{error}}")))?;
        if !value.is_object() {{
            return Err(RepositoryError::invalid("Composite identity must be a JSON object."));
        }}
        Ok(value)
    }} else {{
        Ok(serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string())))
    }}
}}

#[allow(dead_code)]
fn identity_component<'a>(
    identity: &'a Value,
    field: &str,
    composite: bool,
) -> Result<&'a Value, RepositoryError> {{
    if composite {{
        identity
            .get(field)
            .ok_or_else(|| RepositoryError::invalid(format!("Composite identity is missing `{{field}}`.")))
    }} else {{
        Ok(identity)
    }}
}}

fn json_value<T>(value: &Value, field: &str) -> Result<T, RepositoryError>
where
    T: DeserializeOwned + std::str::FromStr,
    <T as std::str::FromStr>::Err: std::fmt::Display,
{{
    if let Some(text) = value.as_str() {{
        return text.parse::<T>().map_err(|error| {{
            RepositoryError::invalid(format!("Field `{{field}}` is invalid: {{error}}"))
        }});
    }}
    serde_json::from_value(value.clone()).map_err(|error| {{
        RepositoryError::invalid(format!("Field `{{field}}` is invalid: {{error}}"))
    }})
}}

#[allow(dead_code)]
fn custom_parameter<T>(
    parameters: &Value,
    name: &str,
    required: bool,
) -> Result<Option<T>, RepositoryError>
where
    T: DeserializeOwned + std::str::FromStr,
    <T as std::str::FromStr>::Err: std::fmt::Display,
{{
    let value = parameters.get(name);
    match value {{
        Some(Value::Null) | None if required => Err(RepositoryError::invalid(format!(
            "Custom endpoint parameter `{{name}}` is required."
        ))),
        Some(Value::Null) | None => Ok(None),
        Some(value) => json_value::<T>(value, name).map(Some),
    }}
}}

#[allow(dead_code)]
fn ensure_known_fields(
    values: &Map<String, Value>,
    allowed: &[&str],
) -> Result<(), RepositoryError> {{
    if let Some(field) = values.keys().find(|field| !allowed.contains(&field.as_str())) {{
        return Err(RepositoryError::invalid(format!("Field `{{field}}` is not writable.")));
    }}
    Ok(())
}}

#[allow(dead_code)]
fn row_to_json(row: &{row_type}) -> Value {{
    let mut object = Map::new();
    for column in row.columns() {{
        object.insert(column.name().to_string(), row_value(row, column.ordinal()));
    }}
    Value::Object(object)
}}

#[allow(dead_code)]
fn row_value(row: &{row_type}, index: usize) -> Value {{
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {{
        return value.map(Value::Bool).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<i16>, _>(index) {{
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {{
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {{
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {{
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {{
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {{
        return value.map(Value::String).unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {{
        return value
            .map(|item| Value::String(base64::engine::general_purpose::STANDARD.encode(item)))
            .unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<uuid::Uuid>, _>(index) {{
        return value
            .map(|item| Value::String(item.to_string()))
            .unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {{
        return value
            .map(|item| Value::String(item.to_string()))
            .unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {{
        return value
            .map(|item| Value::String(item.to_string()))
            .unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {{
        return value
            .map(|item| Value::String(item.to_rfc3339()))
            .unwrap_or(Value::Null);
    }}
    if let Ok(value) = row.try_get::<Option<Value>, _>(index) {{
        return value.unwrap_or(Value::Null);
    }}
    Value::Null
}}
"#,
        pool_options_type = profile.pool_options_type,
        pool_type = profile.pool_type,
        row_type = profile.row_type,
        configuration_key = rust_string_literal(&spec.configuration_key),
        configuration_message = rust_string_literal(&format!(
            "Set {} before starting the API.",
            spec.configuration_key
        )),
        methods = methods,
    )
}

fn rust_resource_methods(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    profile: &SqlxClientProfile,
    protocol: &str,
) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let select = rust_select_list(resource, adapter);
    let mut output = format!(
        r#"
    pub async fn search_{function}(&self, limit: u32) -> Result<Vec<{model}>, RepositoryError> {{
        let mut query = QueryBuilder::<{database_type}>::new({search_prefix});
        query.push_bind(i64::from(limit.clamp(1, 500)));
        query
            .build_query_as::<{model}>()
            .fetch_all(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))
    }}
"#,
        function = function,
        model = resource.model_name,
        database_type = profile.database_type,
        search_prefix = rust_string_literal(&format!(
            "SELECT {select} FROM {} LIMIT ",
            resource.qualified_target
        )),
    );

    if protocol == "rest" && !resource.primary_fields.is_empty() {
        let identity_where = rust_identity_where(resource, adapter, "query");
        let _ = write!(
            output,
            r#"
    pub async fn get_{function}(&self, identity: String) -> Result<{model}, RepositoryError> {{
        let identity = parse_identity(&identity, {composite})?;
        let mut query = QueryBuilder::<{database_type}>::new({query_prefix});
{identity_where}
        query
            .build_query_as::<{model}>()
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))?
            .ok_or_else(|| RepositoryError::not_found("The requested resource was not found."))
    }}
"#,
            function = function,
            model = resource.model_name,
            composite = resource.primary_fields.len() > 1,
            database_type = profile.database_type,
            query_prefix = rust_string_literal(&format!(
                "SELECT {select} FROM {} WHERE ",
                resource.qualified_target
            )),
            identity_where = identity_where,
        );
    }

    if resource.mode == ProjectResourceMode::Crud && protocol != "grpc" {
        output.push_str(&rust_create_method(resource, adapter, profile));
    }
    if resource.mode == ProjectResourceMode::Crud && protocol == "rest" {
        output.push_str(&rust_update_method(resource, adapter, profile));
        output.push_str(&rust_delete_method(resource, adapter, profile));
    }
    output
}

fn rust_create_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    profile: &SqlxClientProfile,
) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let allowed = rust_string_slice(resource.fields.iter().map(|field| field.json_name.as_str()));
    let columns = resource
        .fields
        .iter()
        .map(|field| {
            format!(
                "            if object.contains_key({json}) {{ columns.push({column}); }}\n",
                json = rust_string_literal(&field.json_name),
                column = rust_string_literal(
                    &(adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                        .unwrap_or_default()
                )
            )
        })
        .collect::<String>();
    let values = resource
        .fields
        .iter()
        .map(|field| {
            let mut block = format!(
                "            if let Some(value) = object.get({}) {{\n",
                rust_string_literal(&field.json_name)
            );
            block.push_str(&rust_json_bind("values_sql", field, "value", 16));
            block.push_str("            }\n");
            block
        })
        .collect::<String>();
    format!(
        r#"
    pub async fn create_{function}(&self, values: Value) -> Result<{model}, RepositoryError> {{
        let object = values
            .as_object()
            .ok_or_else(|| RepositoryError::invalid("Mutation values must be a JSON object."))?;
        ensure_known_fields(object, {allowed})?;
        let mut query = QueryBuilder::<{database_type}>::new({insert_prefix});
        if object.is_empty() {{
            query.push(" DEFAULT VALUES");
        }} else {{
            query.push(" (");
            let mut columns = query.separated(", ");
{columns}            drop(columns);
            query.push(") VALUES (");
            let mut values_sql = query.separated(", ");
{values}            drop(values_sql);
            query.push(")");
        }}
        query.push({returning});
        query
            .build_query_as::<{model}>()
            .fetch_one(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))
    }}
"#,
        function = function,
        model = resource.model_name,
        allowed = allowed,
        database_type = profile.database_type,
        insert_prefix = rust_string_literal(&format!("INSERT INTO {}", resource.qualified_target)),
        columns = columns,
        values = values,
        returning = rust_string_literal(&format!(
            " RETURNING {}",
            rust_select_list(resource, adapter)
        )),
    )
}

fn rust_update_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    profile: &SqlxClientProfile,
) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let writable_fields = resource
        .fields
        .iter()
        .filter(|field| !field.primary)
        .collect::<Vec<_>>();
    let allowed = rust_string_slice(writable_fields.iter().map(|field| field.json_name.as_str()));
    let assignments = writable_fields
        .iter()
        .map(|field| {
            let mut block = format!(
                "        if let Some(value) = object.get({json}) {{\n            if assignment_count > 0 {{ query.push(\", \"); }}\n            assignment_count += 1;\n            query.push({assignment});\n",
                json = rust_string_literal(&field.json_name),
                assignment = rust_string_literal(
                    &format!(
                        "{} = ",
                        (adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                            .unwrap_or_default()
                    )
                )
            );
            block.push_str(&rust_json_bind("query", field, "value", 12));
            block.push_str("        }\n");
            block
        })
        .collect::<String>();
    let identity_where = rust_identity_where(resource, adapter, "query");
    format!(
        r#"
    pub async fn update_{function}(
        &self,
        identity: String,
        values: Value,
    ) -> Result<{model}, RepositoryError> {{
        let object = values
            .as_object()
            .ok_or_else(|| RepositoryError::invalid("Mutation values must be a JSON object."))?;
        ensure_known_fields(object, {allowed})?;
        if object.is_empty() {{
            return Err(RepositoryError::invalid("PATCH requires at least one writable field."));
        }}
        let identity = parse_identity(&identity, {composite})?;
        let mut query = QueryBuilder::<{database_type}>::new({update_prefix});
        let mut assignment_count = 0_usize;
{assignments}        debug_assert!(assignment_count > 0);
        query.push(" WHERE ");
{identity_where}
        query.push({returning});
        query
            .build_query_as::<{model}>()
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))?
            .ok_or_else(|| RepositoryError::not_found("The requested resource was not found."))
    }}
"#,
        function = function,
        model = resource.model_name,
        allowed = allowed,
        composite = resource.primary_fields.len() > 1,
        database_type = profile.database_type,
        update_prefix = rust_string_literal(&format!("UPDATE {} SET ", resource.qualified_target)),
        assignments = assignments,
        identity_where = identity_where,
        returning = rust_string_literal(&format!(
            " RETURNING {}",
            rust_select_list(resource, adapter)
        )),
    )
}

fn rust_delete_method(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    profile: &SqlxClientProfile,
) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let identity_where = rust_identity_where(resource, adapter, "query");
    format!(
        r#"
    pub async fn delete_{function}(&self, identity: String) -> Result<Value, RepositoryError> {{
        let identity_value = parse_identity(&identity, {composite})?;
        let mut query = QueryBuilder::<{database_type}>::new({delete_prefix});
{identity_where}
        let deleted = query
            .build()
            .execute(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))?
            .rows_affected();
        if deleted == 0 {{
            return Err(RepositoryError::not_found("The requested resource was not found."));
        }}
        Ok(json!({{ "deleted": true, "identity": identity }}))
    }}
"#,
        function = function,
        composite = resource.primary_fields.len() > 1,
        database_type = profile.database_type,
        delete_prefix =
            rust_string_literal(&format!("DELETE FROM {} WHERE ", resource.qualified_target)),
        identity_where = identity_where.replace("&identity", "&identity_value"),
    )
}

fn rust_custom_endpoint_method(endpoint: &ProjectCustomEndpoint) -> String {
    let binds = endpoint
        .parameters
        .iter()
        .map(|parameter| {
            format!(
                "            .bind(custom_parameter::<{}>(&parameters, {}, {})?)\n",
                parameter.rust_type,
                rust_string_literal(&parameter.name),
                parameter.required
            )
        })
        .collect::<String>();
    format!(
        r#"
    pub async fn run_{function}(&self, parameters: Value) -> Result<Value, RepositoryError> {{
        let rows = sqlx::query({query})
{binds}            .fetch_all(&self.pool)
            .await
            .map_err(|error| RepositoryError::datastore(error.to_string()))?;
        Ok(Value::Array(rows.iter().map(row_to_json).collect()))
    }}
"#,
        function = endpoint.function_name,
        query = rust_string_literal(&endpoint.parameterized_query),
        binds = binds,
    )
}

fn rust_select_list(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
) -> String {
    resource
        .fields
        .iter()
        .map(|field| {
            (adapter.sql.expect("SQL adapter").select_expression)(
                &field.source_name,
                &field.rust_name,
                field.writable,
            )
            .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn rust_identity_where(
    resource: &ProjectResourceModel,
    adapter: &ProjectExportClientAdapter,
    query_name: &str,
) -> String {
    let composite = resource.primary_fields.len() > 1;
    resource
        .primary_fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let conjunction = if index == 0 { "" } else { "        query.push(\" AND \");\n" };
            format!(
                "{conjunction}        {query_name}.push({column}).push_bind(json_value::<{field_type}>(identity_component(&identity, {field_name}, {composite})?, {field_name})?);\n",
                column = rust_string_literal(
                    &format!(
                        "{} = ",
                        (adapter.sql.expect("SQL adapter").quote_identifier)(&field.source_name)
                            .unwrap_or_default()
                    )
                ),
                field_type = field.rust_base_type,
                field_name = rust_string_literal(&field.source_name),
            )
        })
        .collect()
}

fn rust_json_bind(
    separated_name: &str,
    field: &ProjectFieldModel,
    value_name: &str,
    indent: usize,
) -> String {
    let prefix = " ".repeat(indent);
    if field.nullable {
        format!(
            "{prefix}if {value_name}.is_null() {{\n{prefix}    {separated_name}.push_bind(Option::<{field_type}>::None);\n{prefix}}} else {{\n{prefix}    {separated_name}.push_bind(Some(json_value::<{field_type}>({value_name}, {field_name})?));\n{prefix}}}\n",
            field_type = field.rust_base_type,
            field_name = rust_string_literal(&field.json_name),
        )
    } else {
        format!(
            "{prefix}if {value_name}.is_null() {{\n{prefix}    return Err(RepositoryError::invalid({null_message}));\n{prefix}}}\n{prefix}{separated_name}.push_bind(json_value::<{field_type}>({value_name}, {field_name})?);\n",
            null_message = rust_string_literal(&format!(
                "Field `{}` cannot be null.",
                field.json_name
            )),
            field_type = field.rust_base_type,
            field_name = rust_string_literal(&field.json_name),
        )
    }
}

fn rust_string_slice<'a>(values: impl Iterator<Item = &'a str>) -> String {
    format!(
        "&[{}]",
        values
            .map(rust_string_literal)
            .collect::<Vec<_>>()
            .join(", ")
    )
}
