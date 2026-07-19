struct ProjectResourceModelContext<'a> {
    config: &'a DatastoreApiServerConfig,
    provider: ExportProvider,
    connection: &'a crate::domain::models::ConnectionProfile,
    environment: &'a crate::domain::models::EnvironmentProfile,
    resolved_connection: &'a crate::domain::models::ResolvedConnectionProfile,
    resolved_environment: &'a crate::domain::models::ResolvedEnvironment,
    safe_mode_enabled: bool,
    nodes: &'a [StructureNode],
    warnings: &'a mut Vec<String>,
}

async fn project_resource_model(
    context: &mut ProjectResourceModelContext<'_>,
    resource: &DatastoreApiServerResourceConfig,
) -> Result<ProjectResourceModel, CommandError> {
    let provider = context.provider;
    let schema = match project_resource_schema(provider, resource, context.nodes) {
        Ok(schema) => schema,
        Err(error) => match live_sample_schema(
            provider,
            context.connection,
            context.environment,
            context.resolved_connection,
            context.resolved_environment,
            context.safe_mode_enabled,
            resource,
        )
        .await?
        .or_else(|| resource_shape_schema(provider, resource))
        {
            Some(schema) => schema,
            None => return Err(error),
        },
    };
    context.warnings.extend(schema.warnings.iter().cloned());
    let field_models = project_field_models(provider, &schema.fields);
    let primary_fields = field_models
        .iter()
        .filter(|field| field.primary)
        .map(|field| field.source_name.clone())
        .collect::<Vec<_>>();
    Ok(ProjectResourceModel {
        label: resource.label.clone(),
        kind: resource.kind.clone(),
        endpoint_slug: resource.endpoint_slug.clone(),
        endpoint_path: configured_resource_endpoint(context.config, resource),
        model_name: pascal_case(&resource.endpoint_slug),
        schema_source: schema.source.id().into(),
        schema_source_label: schema.source.label().into(),
        fields: field_models,
        primary_fields,
    })
}

fn project_resource_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
    nodes: &[StructureNode],
) -> Result<ProjectResourceSchema, CommandError> {
    if let Some(schema) = matching_structure_node(resource, nodes)
        .and_then(|node| structure_node_schema(provider, resource, node))
    {
        return Ok(schema);
    }
    if let Some(schema) = declared_metadata_schema(provider, resource) {
        return Ok(schema);
    }
    if let Some(schema) = sample_metadata_schema(provider, resource) {
        return Ok(schema);
    }
    if provider == ExportProvider::Redis {
        if let Some(schema) = resource_shape_schema(provider, resource) {
            return Ok(schema);
        }
    }
    Err(missing_project_schema_error(provider, resource))
}

fn structure_node_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
    node: &StructureNode,
) -> Option<ProjectResourceSchema> {
    if provider == ExportProvider::Redis {
        return resource_shape_schema(provider, resource);
    }
    let mut fields = clean_schema_fields(node.fields.clone());
    if fields.is_empty() && matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
        if let Some(sample) = node.sample.as_ref().and_then(Value::as_object) {
            let samples = vec![sample];
            fields = infer_fields_from_json_objects(&samples, "_id", Some(1));
        }
    }
    if fields.is_empty() {
        return None;
    }
    normalize_schema_field_identities(provider, &mut fields);
    let source = match provider {
        ExportProvider::DynamoDb => ProjectSchemaSource::DeclaredSchema,
        ExportProvider::LiteDb | ExportProvider::MongoDb => ProjectSchemaSource::Sample,
        ExportProvider::Search => ProjectSchemaSource::Mapping,
        ExportProvider::Sql => ProjectSchemaSource::Catalog,
        ExportProvider::Redis => ProjectSchemaSource::ResourceShape,
    };
    let mut warnings = Vec::new();
    if matches!(source, ProjectSchemaSource::Sample) {
        warnings.push(format!(
            "Model `{}` is inferred from sampled {} metadata.",
            resource.label,
            provider_label(provider)
        ));
    }
    Some(ProjectResourceSchema {
        fields,
        source,
        warnings,
    })
}

fn declared_metadata_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    match provider {
        ExportProvider::MongoDb | ExportProvider::LiteDb => {
            let schema = metadata_json_schema(&resource.metadata)?;
            let mut fields = json_schema_fields(schema)?;
            normalize_schema_field_identities(provider, &mut fields);
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::DeclaredSchema,
                warnings: Vec::new(),
            })
        }
        ExportProvider::Search => {
            let mapping = metadata_search_mapping(&resource.metadata)?;
            let mut fields = search_mapping_fields(mapping)?;
            normalize_schema_field_identities(provider, &mut fields);
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::Mapping,
                warnings: Vec::new(),
            })
        }
        ExportProvider::DynamoDb => {
            let mut fields = dynamodb_metadata_fields(&resource.metadata)?;
            normalize_schema_field_identities(provider, &mut fields);
            let warnings = if fields.iter().all(|field| field.primary.unwrap_or(false)) {
                vec![format!(
                    "DynamoDB table `{}` exported with key schema only; no sampled non-key attributes were available.",
                    resource.label
                )]
            } else {
                Vec::new()
            };
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::DeclaredSchema,
                warnings,
            })
        }
        ExportProvider::Redis | ExportProvider::Sql => None,
    }
}

fn sample_metadata_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    let sample_values = metadata_sample_values(&resource.metadata);
    if sample_values.is_empty() {
        return None;
    }
    let sample_objects = sample_values
        .iter()
        .filter_map(|value| value.as_object())
        .collect::<Vec<_>>();
    if sample_objects.is_empty() {
        return None;
    }
    let primary_field = match provider {
        ExportProvider::DynamoDb => "id",
        ExportProvider::Search | ExportProvider::MongoDb | ExportProvider::LiteDb => "_id",
        ExportProvider::Redis | ExportProvider::Sql => "id",
    };
    let mut fields = infer_fields_from_json_objects(
        &sample_objects,
        primary_field,
        Some(sample_objects.len().min(50)),
    );
    if fields.is_empty() {
        return None;
    }
    normalize_schema_field_identities(provider, &mut fields);
    Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::Sample,
        warnings: vec![format!(
            "Model `{}` inferred from {} sampled {} record(s).",
            resource.label,
            sample_objects.len().min(50),
            provider_label(provider)
        )],
    })
}

async fn live_sample_schema(
    provider: ExportProvider,
    connection: &crate::domain::models::ConnectionProfile,
    environment: &crate::domain::models::EnvironmentProfile,
    resolved_connection: &crate::domain::models::ResolvedConnectionProfile,
    resolved_environment: &crate::domain::models::ResolvedEnvironment,
    safe_mode_enabled: bool,
    resource: &DatastoreApiServerResourceConfig,
) -> Result<Option<ProjectResourceSchema>, CommandError> {
    if matches!(provider, ExportProvider::Sql | ExportProvider::Redis) {
        return Ok(None);
    }
    let target = ResourceRouteTarget::from_resource(resource);
    let query_template = read_query_for(&connection.family, &connection.engine, &target, 50, None)
        .map_err(|error| {
            CommandError::new(
                "api-server-export-schema-sample-query",
                format!(
                    "Could not build a bounded sample query for `{}`: {}",
                    resource.label, error.message
                ),
            )
        })?;
    let query_text = resolve_string_template(&query_template, &resolved_environment.variables)?;
    let guardrail = security::evaluate_guardrails(
        connection,
        environment,
        resolved_environment,
        &query_text,
        safe_mode_enabled,
    );
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(CommandError::new(
            "api-server-export-schema-sample-blocked",
            format!(
                "Schema sampling for `{}` was blocked by datastore guardrails: {}",
                resource.label,
                guardrail.reasons.join(" ")
            ),
        ));
    }

    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("api-export-schema")),
        tab_id: format!("api-export-schema-{}", resource.id),
        connection_id: connection.id.clone(),
        environment_id: environment.id.clone(),
        language: language_for(connection),
        query_text: query_text.clone(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(50),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
    };
    let result = adapters::execute(
        resolved_connection,
        &execution_request,
        vec![QueryExecutionNotice {
            code: "api-server-export-schema-sample".into(),
            level: "info".into(),
            message: "Executed by API server project export schema inference.".into(),
        }],
    )
    .await
    .map_err(|error| {
        CommandError::new(
            "api-server-export-schema-sample-failed",
            format!(
                "Could not sample `{}` to infer a typed model: {}",
                resource.label, error.message
            ),
        )
    })?;
    let result = redact_execution_result_for_environment(result, resolved_environment);
    let data = api_read_payload(&result, false);
    let samples = match data {
        Value::Array(values) => values,
        object @ Value::Object(_) => vec![object],
        _ => Vec::new(),
    };
    let sample_objects = samples
        .iter()
        .filter_map(|value| value.as_object())
        .collect::<Vec<_>>();
    if sample_objects.is_empty() {
        return Ok(None);
    }
    let primary_field = match provider {
        ExportProvider::DynamoDb => "id",
        ExportProvider::Search | ExportProvider::MongoDb | ExportProvider::LiteDb => "_id",
        ExportProvider::Redis | ExportProvider::Sql => "id",
    };
    let mut fields = infer_fields_from_json_objects(&sample_objects, primary_field, Some(50));
    if fields.is_empty() {
        return Ok(None);
    }
    normalize_schema_field_identities(provider, &mut fields);
    Ok(Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::Sample,
        warnings: vec![format!(
            "Model `{}` inferred from {} bounded live {} sample(s).",
            resource.label,
            sample_objects.len().min(50),
            provider_label(provider)
        )],
    }))
}

fn resource_shape_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    let (fields, warning) = match provider {
        ExportProvider::MongoDb => (
            vec![schema_field(
                "_id",
                "objectId",
                Some(false),
                Some(true),
                Some(0),
            )],
            format!(
                "MongoDB collection `{}` had no `$jsonSchema` validator and no sampled documents; exported an identity-only model.",
                resource.label
            ),
        ),
        ExportProvider::LiteDb => (
            vec![schema_field("_id", "value", Some(false), Some(true), Some(0))],
            format!(
                "LiteDB collection `{}` had no sampled documents; exported an identity-only model.",
                resource.label
            ),
        ),
        ExportProvider::Redis => redis_resource_shape_fields(resource),
        ExportProvider::Search => (
            vec![
                schema_field("_id", "string", Some(false), Some(true), Some(0)),
                schema_field("source", "document", Some(false), Some(false), Some(1)),
            ],
            format!(
                "Search index `{}` exported as a typed document wrapper because mappings were not available.",
                resource.label
            ),
        ),
        ExportProvider::DynamoDb => (
            vec![
                schema_field("key", "document", Some(false), Some(true), Some(0)),
                schema_field("item", "document", Some(false), Some(false), Some(1)),
            ],
            format!(
                "DynamoDB table `{}` exported as a key/item wrapper because table metadata was not available.",
                resource.label
            ),
        ),
        _ => return None,
    };
    Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::ResourceShape,
        warnings: vec![warning],
    })
}

fn redis_resource_shape_fields(
    resource: &DatastoreApiServerResourceConfig,
) -> (Vec<StructureField>, String) {
    let redis_type = resource
        .metadata
        .get("redisType")
        .or_else(|| resource.metadata.get("type"))
        .and_then(Value::as_str)
        .or(resource.detail.as_deref())
        .unwrap_or("key")
        .to_ascii_lowercase();
    let value_type = if redis_type.contains("json") || redis_type.contains("hash") {
        "document"
    } else if redis_type.contains("list")
        || redis_type.contains("set")
        || redis_type.contains("zset")
        || redis_type.contains("stream")
        || redis_type.contains("timeseries")
    {
        "array"
    } else {
        "string"
    };
    (
        vec![
            schema_field("key", "string", Some(false), Some(true), Some(0)),
            schema_field("kind", "string", Some(false), Some(false), Some(1)),
            schema_field("ttlSeconds", "int64", Some(true), Some(false), Some(2)),
            schema_field("value", value_type, Some(true), Some(false), Some(3)),
        ],
        format!(
            "Redis/Valkey key `{}` exported as a typed `{}` wrapper.",
            resource.label, redis_type
        ),
    )
}

fn missing_project_schema_error(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> CommandError {
    let message = match provider {
        ExportProvider::MongoDb => format!(
            "No MongoDB documents or `$jsonSchema` validator were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::LiteDb => format!(
            "No LiteDB documents or declared schema metadata were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Search => format!(
            "No Elasticsearch/OpenSearch mappings were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::DynamoDb => format!(
            "No DynamoDB key schema or sampled item attributes were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Redis => format!(
            "No Redis/Valkey key shape metadata was available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Sql => format!(
            "No catalog columns were available to infer `{}`. Refresh structure metadata for this table.",
            resource.label
        ),
    };
    CommandError::new("api-server-export-schema-missing", message)
}

fn clean_schema_fields(mut fields: Vec<StructureField>) -> Vec<StructureField> {
    fields.retain(|field| !field.name.trim().is_empty());
    fields.sort_by(|left, right| {
        left.ordinal
            .unwrap_or(u32::MAX)
            .cmp(&right.ordinal.unwrap_or(u32::MAX))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    fields
}

fn normalize_schema_field_identities(provider: ExportProvider, fields: &mut [StructureField]) {
    if matches!(
        provider,
        ExportProvider::MongoDb | ExportProvider::LiteDb | ExportProvider::Search
    ) {
        for field in fields {
            if field.name == "_id" {
                field.primary = Some(true);
                field.nullable = Some(false);
            }
        }
    }
}

fn schema_field(
    name: &str,
    data_type: &str,
    nullable: Option<bool>,
    primary: Option<bool>,
    ordinal: Option<u32>,
) -> StructureField {
    StructureField {
        name: name.into(),
        data_type: data_type.into(),
        detail: None,
        nullable,
        primary,
        ordinal,
        indexed: None,
    }
}

#[derive(Default)]
struct InferredFieldSummary {
    data_type: Option<String>,
    present_count: usize,
    nullable: bool,
}

fn infer_fields_from_json_objects(
    samples: &[&serde_json::Map<String, Value>],
    primary_field: &str,
    limit: Option<usize>,
) -> Vec<StructureField> {
    let sample_count = limit.unwrap_or(samples.len()).min(samples.len());
    if sample_count == 0 {
        return Vec::new();
    }
    let mut summaries = BTreeMap::<String, InferredFieldSummary>::new();
    for sample in samples.iter().take(sample_count) {
        for (name, value) in sample.iter() {
            let summary = summaries.entry(name.clone()).or_default();
            summary.present_count += 1;
            if value.is_null() {
                summary.nullable = true;
            }
            let next_type = json_value_data_type(value);
            summary.data_type = Some(merge_data_types(summary.data_type.as_deref(), &next_type));
        }
    }
    summaries
        .into_iter()
        .enumerate()
        .map(|(index, (name, summary))| {
            let primary = name == primary_field;
            schema_field(
                &name,
                summary.data_type.as_deref().unwrap_or("value"),
                Some(summary.nullable || summary.present_count < sample_count),
                Some(primary),
                Some(index as u32),
            )
        })
        .collect()
}

fn json_value_data_type(value: &Value) -> String {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "int64",
        Value::Number(_) => "double",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(object) if object.contains_key("$oid") => "objectId",
        Value::Object(object) if object.contains_key("$date") => "dateTime",
        Value::Object(_) => "document",
    }
    .into()
}

fn merge_data_types(existing: Option<&str>, next: &str) -> String {
    let next = normalize_schema_data_type(next);
    if next == "null" {
        return existing.unwrap_or("value").into();
    }
    let Some(existing) = existing.map(normalize_schema_data_type) else {
        return next;
    };
    if existing == next {
        return existing;
    }
    if existing == "null" {
        return next;
    }
    if matches!(
        (existing.as_str(), next.as_str()),
        ("int32", "int64") | ("int64", "int32")
    ) {
        return "int64".into();
    }
    if matches!(
        (existing.as_str(), next.as_str()),
        ("int32", "double") | ("int64", "double") | ("double", "int32") | ("double", "int64")
    ) {
        return "double".into();
    }
    "value".into()
}

fn normalize_schema_data_type(data_type: &str) -> String {
    match data_type.trim().to_ascii_lowercase().as_str() {
        "bool" => "boolean",
        "integer" => "int32",
        "long" => "int64",
        "number" | "float" | "decimal" => "double",
        "object" | "json" => "document",
        "mixed" | "unknown" => "value",
        other => other,
    }
    .into()
}

fn metadata_json_schema(metadata: &HashMap<String, Value>) -> Option<&Value> {
    metadata
        .get("$jsonSchema")
        .or_else(|| metadata.get("jsonSchema"))
        .or_else(|| {
            metadata
                .get("schema")
                .and_then(|value| value.get("$jsonSchema"))
        })
        .or_else(|| {
            metadata
                .get("validator")
                .and_then(|value| value.get("$jsonSchema"))
        })
        .or_else(|| {
            metadata
                .get("options")
                .and_then(|value| value.get("validator"))
                .and_then(|value| value.get("$jsonSchema"))
        })
}

fn json_schema_fields(schema: &Value) -> Option<Vec<StructureField>> {
    let properties = schema.get("properties")?.as_object()?;
    if properties.is_empty() {
        return None;
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let fields = properties
        .iter()
        .enumerate()
        .map(|(index, (name, value))| {
            let (data_type, allows_null) = json_schema_data_type(value);
            schema_field(
                name,
                &data_type,
                Some(allows_null || !required.contains(name)),
                Some(name == "_id"),
                Some(index as u32),
            )
        })
        .collect::<Vec<_>>();
    (!fields.is_empty()).then_some(fields)
}

fn json_schema_data_type(schema: &Value) -> (String, bool) {
    let raw = schema
        .get("bsonType")
        .or_else(|| schema.get("type"))
        .cloned()
        .unwrap_or(Value::String("value".into()));
    match raw {
        Value::String(value) => (normalize_schema_data_type(&value), value == "null"),
        Value::Array(values) => {
            let mut allows_null = false;
            let mut data_type: Option<String> = None;
            for value in values.iter().filter_map(Value::as_str) {
                if value == "null" {
                    allows_null = true;
                    continue;
                }
                data_type = Some(merge_data_types(data_type.as_deref(), value));
            }
            (data_type.unwrap_or_else(|| "value".into()), allows_null)
        }
        _ => {
            if schema.get("properties").is_some() {
                ("document".into(), false)
            } else if schema.get("items").is_some() {
                ("array".into(), false)
            } else {
                ("value".into(), false)
            }
        }
    }
}

fn metadata_search_mapping(metadata: &HashMap<String, Value>) -> Option<&Value> {
    metadata
        .get("mapping")
        .or_else(|| metadata.get("mappings"))
        .or_else(|| metadata.get("properties"))
        .or_else(|| metadata.get("indexMapping"))
}

fn search_mapping_fields(mapping: &Value) -> Option<Vec<StructureField>> {
    let properties = search_mapping_properties(mapping).or_else(|| mapping.as_object())?;
    let mut fields = Vec::new();
    collect_search_mapping_fields("", properties, &mut fields);
    (!fields.is_empty()).then_some(fields)
}

fn search_mapping_properties(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value
        .get("properties")
        .and_then(Value::as_object)
        .or_else(|| {
            value
                .pointer("/mappings/properties")
                .and_then(Value::as_object)
        })
        .or_else(|| {
            value.as_object().and_then(|object| {
                object.values().find_map(|child| {
                    child
                        .pointer("/mappings/properties")
                        .and_then(Value::as_object)
                })
            })
        })
}

fn collect_search_mapping_fields(
    prefix: &str,
    properties: &serde_json::Map<String, Value>,
    fields: &mut Vec<StructureField>,
) {
    for (name, value) in properties {
        let field_name = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        if let Some(nested) = value.get("properties").and_then(Value::as_object) {
            collect_search_mapping_fields(&field_name, nested, fields);
            continue;
        }
        let data_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("document");
        fields.push(schema_field(
            &field_name,
            data_type,
            Some(true),
            Some(field_name == "_id"),
            Some(fields.len() as u32),
        ));
    }
}

fn dynamodb_metadata_fields(metadata: &HashMap<String, Value>) -> Option<Vec<StructureField>> {
    let table = metadata
        .get("Table")
        .or_else(|| metadata.get("table"))
        .or_else(|| metadata.get("tableDescription"));
    let key_schema = table
        .and_then(|value| value.get("KeySchema").or_else(|| value.get("keySchema")))
        .or_else(|| metadata.get("KeySchema"))
        .or_else(|| metadata.get("keySchema"))?
        .as_array()?;
    let attributes = table
        .and_then(|value| {
            value
                .get("AttributeDefinitions")
                .or_else(|| value.get("attributeDefinitions"))
        })
        .or_else(|| metadata.get("AttributeDefinitions"))
        .or_else(|| metadata.get("attributeDefinitions"))
        .and_then(Value::as_array);
    let attribute_types = attributes
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let name = value
                        .get("AttributeName")
                        .or_else(|| value.get("attributeName"))
                        .and_then(Value::as_str)?;
                    let data_type = value
                        .get("AttributeType")
                        .or_else(|| value.get("attributeType"))
                        .and_then(Value::as_str)
                        .unwrap_or("S");
                    Some((name.to_string(), dynamodb_attribute_type(data_type)))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let mut fields = key_schema
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let name = value
                .get("AttributeName")
                .or_else(|| value.get("attributeName"))
                .and_then(Value::as_str)?;
            Some(schema_field(
                name,
                attribute_types
                    .get(name)
                    .map(String::as_str)
                    .unwrap_or("string"),
                Some(false),
                Some(true),
                Some(index as u32),
            ))
        })
        .collect::<Vec<_>>();
    if let Some(samples) = metadata.get("samples").or_else(|| metadata.get("items")) {
        let sample_values = sample_values_from_value(samples);
        let sample_objects = sample_values
            .iter()
            .filter_map(|value| value.as_object())
            .collect::<Vec<_>>();
        let sampled = infer_fields_from_json_objects(&sample_objects, "id", Some(50));
        for field in sampled {
            if !fields.iter().any(|existing| existing.name == field.name) {
                fields.push(field);
            }
        }
    }
    (!fields.is_empty()).then_some(clean_schema_fields(fields))
}

fn dynamodb_attribute_type(data_type: &str) -> String {
    match data_type {
        "N" => "double",
        "B" => "binary",
        "BOOL" => "boolean",
        "L" | "SS" | "NS" | "BS" => "array",
        "M" => "document",
        _ => "string",
    }
    .into()
}

fn metadata_sample_values(metadata: &HashMap<String, Value>) -> Vec<&Value> {
    let mut values = Vec::new();
    for key in ["samples", "sample", "documents", "items", "records"] {
        if let Some(value) = metadata.get(key) {
            values.extend(sample_values_from_value(value));
        }
    }
    values
}

fn sample_values_from_value(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(values) => values.iter().take(50).collect(),
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn project_field_models(
    provider: ExportProvider,
    fields: &[StructureField],
) -> Vec<ProjectFieldModel> {
    let mut seen_rust = HashMap::<String, usize>::new();
    let mut seen_csharp = HashMap::<String, usize>::new();
    fields
        .iter()
        .map(|field| {
            let source_name = field.name.trim().to_string();
            let rust_base = rust_type_for(provider, &field.data_type);
            let csharp_base = csharp_type_for(provider, &field.data_type);
            let nullable = field.nullable.unwrap_or(matches!(
                provider,
                ExportProvider::DynamoDb
                    | ExportProvider::LiteDb
                    | ExportProvider::MongoDb
                    | ExportProvider::Redis
                    | ExportProvider::Search
            ));
            let rust_name = unique_identifier(&mut seen_rust, snake_case(&source_name), "field");
            let csharp_name =
                unique_identifier(&mut seen_csharp, pascal_case(&source_name), "Field");
            ProjectFieldModel {
                source_name: source_name.clone(),
                rust_name,
                csharp_name,
                json_name: source_name,
                rust_type: if nullable {
                    format!("Option<{rust_base}>")
                } else {
                    rust_base
                },
                csharp_type: csharp_nullable_type(&csharp_base, nullable),
                data_type: field.data_type.clone(),
                nullable,
                primary: field.primary.unwrap_or(false),
            }
        })
        .collect()
}

fn project_custom_endpoint(
    config: &DatastoreApiServerConfig,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> Result<ProjectCustomEndpoint, CommandError> {
    Ok(ProjectCustomEndpoint {
        label: endpoint.label.clone(),
        method: endpoint.method.to_ascii_uppercase(),
        endpoint_path: configured_custom_endpoint_path(config, endpoint),
        function_name: snake_case(&endpoint.endpoint_slug),
        parameters: endpoint
            .parameters
            .iter()
            .map(|parameter| ProjectEndpointParameter {
                name: parameter.name.clone(),
                rust_type: custom_parameter_rust_type(&parameter.parameter_type),
                csharp_type: custom_parameter_csharp_type(&parameter.parameter_type),
                required: parameter.required,
            })
            .collect(),
    })
}

fn matching_structure_node<'a>(
    resource: &DatastoreApiServerResourceConfig,
    nodes: &'a [StructureNode],
) -> Option<&'a StructureNode> {
    let mut candidates = vec![
        resource.node_id.clone(),
        resource.label.clone(),
        resource.endpoint_slug.clone(),
    ];
    if let Some(detail) = &resource.detail {
        candidates.push(detail.clone());
    }
    if let Some(scope) = &resource.scope {
        candidates.push(scope.clone());
        candidates.extend(scope.split(':').map(str::to_string));
    }
    candidates.extend(resource.path.iter().cloned());
    let candidates = candidates
        .into_iter()
        .map(|value| structure_match_key(&value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    nodes.iter().find(|node| {
        let node_keys = [
            structure_match_key(&node.id),
            structure_match_key(&node.label),
            structure_match_key(node.object_name.as_deref().unwrap_or_default()),
            structure_match_key(node.qualified_name.as_deref().unwrap_or_default()),
            structure_match_key(node.detail.as_deref().unwrap_or_default()),
        ];
        candidates.iter().any(|candidate| {
            node_keys.iter().any(|node_key| {
                !node_key.is_empty()
                    && (node_key == candidate
                        || node_key.ends_with(candidate)
                        || candidate.ends_with(node_key))
            })
        })
    })
}

fn structure_match_key(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '.' {
                ch.to_ascii_lowercase()
            } else {
                '.'
            }
        })
        .collect::<String>()
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn rust_type_for(provider: ExportProvider, data_type: &str) -> String {
    let normalized = data_type.to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "array" | "document" | "object" | "value"
    ) || normalized.contains("json")
    {
        return "serde_json::Value".into();
    }
    if matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
        return match normalized.as_str() {
            "boolean" | "bool" => "bool",
            "double" => "f64",
            "int32" => "i32",
            "int64" => "i64",
            _ => "String",
        }
        .into();
    }
    if normalized.contains("bigint") {
        "i64".into()
    } else if normalized.contains("smallint") {
        "i16".into()
    } else if normalized.contains("int") {
        "i32".into()
    } else if normalized.contains("bool") || normalized == "bit" {
        "bool".into()
    } else if normalized.contains("double")
        || normalized.contains("float")
        || normalized.contains("real")
    {
        "f64".into()
    } else if normalized.contains("binary") || normalized.contains("blob") {
        "Vec<u8>".into()
    } else {
        "String".into()
    }
}

fn csharp_type_for(provider: ExportProvider, data_type: &str) -> String {
    let normalized = data_type.to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "array" | "document" | "object" | "value"
    ) || normalized.contains("json")
    {
        return "JsonElement".into();
    }
    if matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
        return match normalized.as_str() {
            "boolean" | "bool" => "bool",
            "double" => "double",
            "int32" => "int",
            "int64" => "long",
            _ => "string",
        }
        .into();
    }
    if normalized.contains("bigint") {
        "long".into()
    } else if normalized.contains("smallint") {
        "short".into()
    } else if normalized.contains("int") {
        "int".into()
    } else if normalized.contains("bool") || normalized == "bit" {
        "bool".into()
    } else if normalized.contains("double")
        || normalized.contains("float")
        || normalized.contains("real")
    {
        "double".into()
    } else if normalized.contains("decimal") || normalized.contains("numeric") {
        "decimal".into()
    } else if normalized.contains("binary") || normalized.contains("blob") {
        "byte[]".into()
    } else if normalized.contains("date") || normalized.contains("time") {
        "DateTimeOffset".into()
    } else {
        "string".into()
    }
}

fn csharp_nullable_type(base: &str, nullable: bool) -> String {
    if !nullable {
        return base.into();
    }
    if base.ends_with("[]") {
        base.into()
    } else {
        format!("{base}?")
    }
}

fn custom_parameter_rust_type(parameter_type: &str) -> String {
    match parameter_type {
        "number" => "f64",
        "boolean" => "bool",
        "json" => "serde_json::Value",
        _ => "String",
    }
    .into()
}

fn custom_parameter_csharp_type(parameter_type: &str) -> String {
    match parameter_type {
        "number" => "double",
        "boolean" => "bool",
        "json" => "JsonElement",
        _ => "string",
    }
    .into()
}

