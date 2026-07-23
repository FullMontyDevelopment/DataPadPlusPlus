use std::fmt::Write as _;

use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "rust-dynamodb-native",
    framework: "rust",
    engine: "dynamodb",
    client_label: "AWS SDK for Rust / DynamoDB",
    configuration_key: "AWS_REGION",
    configuration_example: "us-east-1",
    additional_configuration: &[("DYNAMODB_ENDPOINT_URL", "http://127.0.0.1:8000")],
    safety_note: "DynamoDB writes use conditional expressions: creates cannot overwrite an item, patches cannot change keys, and updates/deletes require the target to exist. Scans are bounded but consume table capacity.",
    rust_version: "1.94.1",
    sql: None,
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![
        ProjectDependency {
            package: "aws-sdk-dynamodb".into(),
            version: "1.118.0".into(),
            declaration: "aws-sdk-dynamodb = \"=1.118.0\"".into(),
            build: false,
        },
        ProjectDependency {
            package: "aws-config".into(),
            version: "1.10.0".into(),
            declaration: "aws-config = \"=1.10.0\"".into(),
            build: false,
        },
    ]
}

fn render_client_files(
    spec: &ProjectExportSpec,
    _adapter: &ProjectExportClientAdapter,
) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    vec![project_file(
        &root,
        "src/repository.rs",
        repository_source(spec),
    )]
}

fn repository_source(spec: &ProjectExportSpec) -> String {
    let health_checks = spec
        .resources
        .iter()
        .map(|resource| {
            format!(
                "        self.client.describe_table().table_name({}).send().await\n            .map_err(|error| RepositoryError::unavailable(format!(\"DynamoDB health check failed: {{error}}\")))?;\n",
                rust_string_literal(&resource.table_name)
            )
        })
        .collect::<String>();
    let methods = spec
        .resources
        .iter()
        .map(|resource| resource_methods(resource, &spec.protocol))
        .collect::<String>();
    format!(
        r#"use crate::models::*;
use std::collections::HashMap;
use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::{{
    primitives::Blob,
    types::{{AttributeValue, ReturnValue}},
    Client,
}};
use base64::Engine as _;
use serde_json::{{json, Map, Value}};

#[derive(Debug)]
pub struct RepositoryError {{
    pub kind: &'static str,
    pub message: String,
}}

impl RepositoryError {{
    fn invalid(message: impl Into<String>) -> Self {{ Self {{ kind: "invalid", message: message.into() }} }}
    fn not_found(message: impl Into<String>) -> Self {{ Self {{ kind: "not-found", message: message.into() }} }}
    fn unavailable(message: impl Into<String>) -> Self {{ Self {{ kind: "unavailable", message: message.into() }} }}
    fn datastore(error: impl std::fmt::Display) -> Self {{
        Self {{ kind: "datastore", message: format!("DynamoDB operation failed: {{error}}") }}
    }}
    fn conditional(error: impl std::fmt::Display, message: &'static str) -> Self {{
        let rendered = error.to_string();
        if rendered.contains("ConditionalCheckFailed") {{
            Self::not_found(message)
        }} else {{
            Self::datastore(rendered)
        }}
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
    client: Client,
}}

impl DatastoreRepository {{
    pub async fn from_env() -> Result<Self, RepositoryError> {{
        let shared = aws_config::defaults(BehaviorVersion::latest()).load().await;
        let mut builder = aws_sdk_dynamodb::config::Builder::from(&shared);
        if let Ok(endpoint) = std::env::var("DYNAMODB_ENDPOINT_URL") {{
            if !endpoint.trim().is_empty() {{
                builder = builder.endpoint_url(endpoint);
            }}
        }}
        Ok(Self {{ client: Client::from_conf(builder.build()) }})
    }}

    pub async fn ping(&self) -> Result<(), RepositoryError> {{
{health_checks}        Ok(())
    }}

{methods}}}

fn clamp_limit(limit: u32) -> i32 {{
    i32::try_from(limit.clamp(1, 1_000)).expect("bounded limit")
}}

fn document_to_json(document: HashMap<String, AttributeValue>) -> Value {{
    Value::Object(document.into_iter().map(|(key, value)| (key, attribute_to_json(value))).collect())
}}

fn attribute_to_json(value: AttributeValue) -> Value {{
    match value {{
        AttributeValue::S(value) => Value::String(value),
        AttributeValue::N(value) => json!({{ "$number": value }}),
        AttributeValue::B(value) => json!({{ "$binary": base64::engine::general_purpose::STANDARD.encode(value.as_ref()) }}),
        AttributeValue::Bool(value) => Value::Bool(value),
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::M(value) => document_to_json(value),
        AttributeValue::L(values) => Value::Array(values.into_iter().map(attribute_to_json).collect()),
        AttributeValue::Ss(values) => json!({{ "$stringSet": values }}),
        AttributeValue::Ns(values) => json!({{ "$numberSet": values }}),
        AttributeValue::Bs(values) => json!({{
            "$binarySet": values.into_iter()
                .map(|value| base64::engine::general_purpose::STANDARD.encode(value.as_ref()))
                .collect::<Vec<_>>()
        }}),
        _ => Value::Null,
    }}
}}

fn json_to_document(value: Value) -> Result<HashMap<String, AttributeValue>, RepositoryError> {{
    let Value::Object(document) = value else {{
        return Err(RepositoryError::invalid("Mutation values must be a JSON object."));
    }};
    document.into_iter().map(|(key, value)| Ok((key, json_to_attribute(value)?))).collect()
}}

fn json_to_attribute(value: Value) -> Result<AttributeValue, RepositoryError> {{
    match value {{
        Value::Null => Ok(AttributeValue::Null(true)),
        Value::Bool(value) => Ok(AttributeValue::Bool(value)),
        Value::String(value) => Ok(AttributeValue::S(value)),
        Value::Number(value) => Ok(AttributeValue::N(value.to_string())),
        Value::Array(values) => values
            .into_iter()
            .map(json_to_attribute)
            .collect::<Result<Vec<_>, _>>()
            .map(AttributeValue::L),
        Value::Object(mut object) => {{
            if object.len() == 1 {{
                if let Some(value) = object.remove("$number") {{
                    return value.as_str().map(|value| AttributeValue::N(value.to_string()))
                        .ok_or_else(|| RepositoryError::invalid("$number must contain a string."));
                }}
                if let Some(value) = object.remove("$binary") {{
                    let value = value.as_str().ok_or_else(|| RepositoryError::invalid("$binary must contain a base64 string."))?;
                    let decoded = base64::engine::general_purpose::STANDARD.decode(value)
                        .map_err(|error| RepositoryError::invalid(format!("Invalid base64 binary value: {{error}}")))?;
                    return Ok(AttributeValue::B(Blob::new(decoded)));
                }}
                if let Some(value) = object.remove("$stringSet") {{
                    return string_array(value, "$stringSet").map(AttributeValue::Ss);
                }}
                if let Some(value) = object.remove("$numberSet") {{
                    return string_array(value, "$numberSet").map(AttributeValue::Ns);
                }}
                if let Some(value) = object.remove("$binarySet") {{
                    let values = string_array(value, "$binarySet")?;
                    let values = values.into_iter()
                        .map(|value| base64::engine::general_purpose::STANDARD.decode(value)
                            .map(Blob::new)
                            .map_err(|error| RepositoryError::invalid(format!("Invalid base64 binary set value: {{error}}"))))
                        .collect::<Result<Vec<_>, _>>()?;
                    return Ok(AttributeValue::Bs(values));
                }}
            }}
            object.into_iter()
                .map(|(key, value)| Ok((key, json_to_attribute(value)?)))
                .collect::<Result<HashMap<_, _>, _>>()
                .map(AttributeValue::M)
        }}
    }}
}}

fn string_array(value: Value, tag: &str) -> Result<Vec<String>, RepositoryError> {{
    let Value::Array(values) = value else {{
        return Err(RepositoryError::invalid(format!("{{tag}} must contain an array of strings.")));
    }};
    let values = values.into_iter()
        .map(|value| value.as_str().map(str::to_string)
            .ok_or_else(|| RepositoryError::invalid(format!("{{tag}} must contain only strings."))))
        .collect::<Result<Vec<_>, _>>()?;
    if values.is_empty() {{
        return Err(RepositoryError::invalid(format!("{{tag}} cannot be empty.")));
    }}
    Ok(values)
}}

fn exact_key(raw: &str, schema: &[(&str, &str)]) -> Result<HashMap<String, AttributeValue>, RepositoryError> {{
    let Value::Object(mut object) = serde_json::from_str::<Value>(raw)
        .map_err(|error| RepositoryError::invalid(format!("DynamoDB identity must be a JSON object: {{error}}")))? else {{
        return Err(RepositoryError::invalid("DynamoDB identity must be a JSON object."));
    }};
    if object.len() != schema.len() || schema.iter().any(|(name, _)| !object.contains_key(*name)) {{
        return Err(RepositoryError::invalid("DynamoDB identity must contain exactly the configured key fields."));
    }}
    schema.iter().map(|(name, expected)| {{
        let value = json_to_attribute(object.remove(*name).expect("validated key"))?;
        validate_key_type(name, expected, &value)?;
        Ok(((*name).to_string(), value))
    }}).collect()
}}

fn validate_key_type(name: &str, expected: &str, value: &AttributeValue) -> Result<(), RepositoryError> {{
    let valid = matches!((expected, value),
        ("S", AttributeValue::S(_)) | ("string", AttributeValue::S(_))
        | ("N", AttributeValue::N(_)) | ("number", AttributeValue::N(_))
        | ("B", AttributeValue::B(_)) | ("binary", AttributeValue::B(_)));
    if valid {{
        Ok(())
    }} else {{
        Err(RepositoryError::invalid(format!("DynamoDB key `{{name}}` has the wrong type.")))
    }}
}}
"#,
        health_checks = health_checks,
        methods = methods,
    )
}

fn resource_methods(resource: &ProjectResourceModel, protocol: &str) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let table = rust_string_literal(&resource.table_name);
    let output_type = if protocol == "graphql" {
        resource.model_name.clone()
    } else {
        "Value".into()
    };
    let convert = if protocol == "graphql" {
        format!(
            "{}::from_document(document_to_json(document))",
            resource.model_name
        )
    } else {
        "document_to_json(document)".into()
    };
    let schema = key_schema_rust(resource);
    let partition_key = resource
        .primary_fields
        .first()
        .map(|field| field.source_name.as_str())
        .unwrap_or("id");
    let mut output = format!(
        r#"    pub async fn search_{function}(&self, limit: u32) -> Result<Vec<{output_type}>, RepositoryError> {{
        let response = self.client.scan()
            .table_name({table})
            .limit(clamp_limit(limit))
            .consistent_read(false)
            .send()
            .await
            .map_err(RepositoryError::datastore)?;
        Ok(response.items.unwrap_or_default().into_iter().map(|document| {convert}).collect())
    }}

    pub async fn get_{function}(&self, identity: String) -> Result<{output_type}, RepositoryError> {{
        let key = exact_key(&identity, &{schema})?;
        let document = self.client.get_item()
            .table_name({table})
            .set_key(Some(key))
            .consistent_read(true)
            .send()
            .await
            .map_err(RepositoryError::datastore)?
            .item
            .ok_or_else(|| RepositoryError::not_found("DynamoDB item was not found."))?;
        Ok({convert})
    }}

"#,
        function = function,
        output_type = output_type,
        table = table,
        convert = convert,
        schema = schema,
    );
    if resource.mode != ProjectResourceMode::Crud {
        return output;
    }
    let create_convert = if protocol == "graphql" {
        format!(
            "{}::from_document(document_to_json(document))",
            resource.model_name
        )
    } else {
        "document_to_json(document)".into()
    };
    let _ = write!(
        output,
        r##"    pub async fn create_{function}(&self, values: Value) -> Result<{output_type}, RepositoryError> {{
        let document = json_to_document(values)?;
        for (name, expected) in {schema} {{
            let value = document.get(name)
                .ok_or_else(|| RepositoryError::invalid(format!("Missing DynamoDB key `{{name}}`.")))?;
            validate_key_type(name, expected, value)?;
        }}
        self.client.put_item()
            .table_name({table})
            .set_item(Some(document.clone()))
            .condition_expression("attribute_not_exists(#pk)")
            .expression_attribute_names("#pk", {partition_key})
            .send()
            .await
            .map_err(|error| {{
                if error.to_string().contains("ConditionalCheckFailed") {{
                    RepositoryError::invalid("A DynamoDB item with this key already exists.")
                }} else {{
                    RepositoryError::datastore(error)
                }}
            }})?;
        Ok({create_convert})
    }}

    pub async fn update_{function}(
        &self,
        identity: String,
        values: Value,
    ) -> Result<{output_type}, RepositoryError> {{
        let key = exact_key(&identity, &{schema})?;
        let mut changes = json_to_document(values)?;
        for (name, _) in {schema} {{
            if changes.remove(name).is_some() {{
                return Err(RepositoryError::invalid("DynamoDB patches cannot change key fields."));
            }}
        }}
        if changes.is_empty() {{
            return Err(RepositoryError::invalid("Patch values cannot be empty."));
        }}
        let mut names = HashMap::new();
        let mut values = HashMap::new();
        let mut assignments = Vec::new();
        for (index, (name, value)) in changes.into_iter().enumerate() {{
            let name_token = format!("#f{{index}}");
            let value_token = format!(":v{{index}}");
            names.insert(name_token.clone(), name);
            values.insert(value_token.clone(), value);
            assignments.push(format!("{{name_token}} = {{value_token}}"));
        }}
        names.insert("#pk".to_string(), {partition_key}.to_string());
        let response = self.client.update_item()
            .table_name({table})
            .set_key(Some(key))
            .update_expression(format!("SET {{}}", assignments.join(", ")))
            .condition_expression("attribute_exists(#pk)")
            .set_expression_attribute_names(Some(names))
            .set_expression_attribute_values(Some(values))
            .return_values(ReturnValue::AllNew)
            .send()
            .await
            .map_err(|error| RepositoryError::conditional(error, "DynamoDB item was not found."))?;
        let document = response.attributes
            .ok_or_else(|| RepositoryError::not_found("DynamoDB item was not found."))?;
        Ok({convert})
    }}

    pub async fn delete_{function}(&self, identity: String) -> Result<Value, RepositoryError> {{
        let key = exact_key(&identity, &{schema})?;
        let response = self.client.delete_item()
            .table_name({table})
            .set_key(Some(key))
            .condition_expression("attribute_exists(#pk)")
            .expression_attribute_names("#pk", {partition_key})
            .return_values(ReturnValue::AllOld)
            .send()
            .await
            .map_err(|error| RepositoryError::conditional(error, "DynamoDB item was not found."))?;
        response.attributes
            .map(document_to_json)
            .ok_or_else(|| RepositoryError::not_found("DynamoDB item was not found."))
    }}

"##,
        function = function,
        output_type = output_type,
        schema = schema,
        table = table,
        partition_key = rust_string_literal(partition_key),
        create_convert = create_convert,
        convert = convert,
    );
    output
}

fn key_schema_rust(resource: &ProjectResourceModel) -> String {
    format!(
        "[{}]",
        resource
            .primary_fields
            .iter()
            .map(|field| format!(
                "({}, {})",
                rust_string_literal(&field.source_name),
                rust_string_literal(&field.data_type)
            ))
            .collect::<Vec<_>>()
            .join(", ")
    )
}
