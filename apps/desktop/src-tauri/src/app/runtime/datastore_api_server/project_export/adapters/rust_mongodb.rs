use std::fmt::Write as _;

use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "rust-mongodb-native",
    framework: "rust",
    engine: "mongodb",
    client_label: "MongoDB Rust Driver",
    configuration_key: "MONGODB_URI",
    configuration_example: "mongodb://localhost:27017",
    additional_configuration: &[],
    safety_note: "MongoDB identities are restricted to one exact _id value. Patches use $set with validated top-level field names and cannot change _id.",
    rust_version: "1.89",
    sql: None,
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![
        ProjectDependency {
            package: "mongodb".into(),
            version: "3.8.0".into(),
            declaration: "mongodb = \"=3.8.0\"".into(),
            build: false,
        },
        ProjectDependency {
            package: "futures-util".into(),
            version: "0.3.31".into(),
            declaration: "futures-util = \"=0.3.31\"".into(),
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
    let model_import = if spec.protocol == "graphql" {
        "use crate::models::*;\n"
    } else {
        ""
    };
    let database = spec
        .resources
        .iter()
        .find_map(|resource| resource.database_name.as_deref())
        .unwrap_or("admin");
    let methods = spec
        .resources
        .iter()
        .map(|resource| resource_methods(resource, &spec.protocol))
        .collect::<String>();
    format!(
        r#"{model_import}use futures_util::TryStreamExt;
use mongodb::{{
    bson::{{doc, Bson, Document}},
    options::ReturnDocument,
    Client,
}};
use serde_json::Value;

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
        Self {{ kind: "datastore", message: format!("MongoDB operation failed: {{error}}") }}
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
        let uri = std::env::var("MONGODB_URI")
            .map_err(|_| RepositoryError::unavailable("Set MONGODB_URI before starting the API."))?;
        if uri.trim().is_empty() {{
            return Err(RepositoryError::unavailable("Set MONGODB_URI before starting the API."));
        }}
        let client = Client::with_uri_str(&uri)
            .await
            .map_err(|error| RepositoryError::unavailable(format!("MongoDB connection failed: {{error}}")))?;
        Ok(Self {{ client }})
    }}

    pub async fn ping(&self) -> Result<(), RepositoryError> {{
        self.client
            .database({database})
            .run_command(doc! {{ "ping": 1 }})
            .await
            .map(|_| ())
            .map_err(|error| RepositoryError::unavailable(format!("MongoDB health check failed: {{error}}")))
    }}

{methods}}}

fn clamp_limit(limit: u32) -> i64 {{
    i64::from(limit.clamp(1, 1_000))
}}

fn document_to_json(document: Document) -> Result<Value, RepositoryError> {{
    serde_json::to_value(Bson::Document(document)).map_err(RepositoryError::datastore)
}}

fn json_to_document(value: Value) -> Result<Document, RepositoryError> {{
    match serde_json::from_value::<Bson>(value)
        .map_err(|error| RepositoryError::invalid(format!("Invalid MongoDB Extended JSON: {{error}}")))? {{
        Bson::Document(document) => Ok(document),
        _ => Err(RepositoryError::invalid("Mutation values must be a JSON object.")),
    }}
}}

fn exact_identity(raw: &str, object_id: bool) -> Result<Bson, RepositoryError> {{
    let parsed = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string()));
    let value = match parsed {{
        Value::Object(mut object) => {{
            if object.len() != 1 || !object.contains_key("_id") {{
                return Err(RepositoryError::invalid(
                    "MongoDB identity objects must contain exactly the _id field.",
                ));
            }}
            object.remove("_id").expect("checked _id")
        }}
        scalar => scalar,
    }};
    if let Some(oid) = value
        .as_object()
        .and_then(|object| object.get("$oid"))
        .and_then(Value::as_str)
    {{
        return mongodb::bson::oid::ObjectId::parse_str(oid)
            .map(Bson::ObjectId)
            .map_err(|error| RepositoryError::invalid(format!("Invalid ObjectId: {{error}}")));
    }}
    if object_id {{
        if let Some(oid) = value.as_str() {{
            return mongodb::bson::oid::ObjectId::parse_str(oid)
                .map(Bson::ObjectId)
                .map_err(|error| RepositoryError::invalid(format!("Invalid ObjectId: {{error}}")));
        }}
    }}
    serde_json::from_value::<Bson>(value)
        .map_err(|error| RepositoryError::invalid(format!("Invalid MongoDB identity: {{error}}")))
}}

fn validate_patch(document: &Document) -> Result<(), RepositoryError> {{
    if document.is_empty() {{
        return Err(RepositoryError::invalid("Patch values cannot be empty."));
    }}
    for name in document.keys() {{
        if name == "_id" {{
            return Err(RepositoryError::invalid("MongoDB patches cannot change _id."));
        }}
        if name.starts_with('$') || name.contains('.') {{
            return Err(RepositoryError::invalid(
                "MongoDB patch field names cannot start with $ or contain dots.",
            ));
        }}
    }}
    Ok(())
}}
"#,
        database = rust_string_literal(database),
        model_import = model_import,
        methods = methods,
    )
}

fn resource_methods(resource: &ProjectResourceModel, protocol: &str) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let model = &resource.model_name;
    let database = resource.database_name.as_deref().unwrap_or("admin");
    let collection = &resource.table_name;
    let object_id = resource
        .primary_fields
        .first()
        .is_some_and(|field| field.data_type.eq_ignore_ascii_case("objectId"));
    let output_type = if protocol == "graphql" {
        model.to_string()
    } else {
        "Value".into()
    };
    let map_value = if protocol == "graphql" {
        format!("{model}::from_document(document_to_json(document)?)")
    } else {
        "document_to_json(document)?".into()
    };
    let mut output = format!(
        r#"    pub async fn search_{function}(&self, limit: u32) -> Result<Vec<{output_type}>, RepositoryError> {{
        let collection = self.client.database({database}).collection::<Document>({collection});
        let documents = collection
            .find(doc! {{}})
            .limit(clamp_limit(limit))
            .await
            .map_err(RepositoryError::datastore)?
            .try_collect::<Vec<_>>()
            .await
            .map_err(RepositoryError::datastore)?;
        documents
            .into_iter()
            .map(|document| Ok({map_value}))
            .collect()
    }}

"#,
        function = function,
        output_type = output_type,
        database = rust_string_literal(database),
        collection = rust_string_literal(collection),
        map_value = map_value,
    );
    if resource.primary_fields.is_empty() {
        return output;
    }
    let found_value = if protocol == "graphql" {
        format!("{model}::from_document(document_to_json(document)?)")
    } else {
        "document_to_json(document)?".into()
    };
    let created_value = if protocol == "graphql" {
        format!("{model}::from_document(document_to_json(stored)?)")
    } else {
        "document_to_json(stored)?".into()
    };
    let _ = write!(
        output,
        r#"    pub async fn get_{function}(&self, identity: String) -> Result<{output_type}, RepositoryError> {{
        let identity = exact_identity(&identity, {object_id})?;
        let document = self.client
            .database({database})
            .collection::<Document>({collection})
            .find_one(doc! {{ "_id": identity }})
            .await
            .map_err(RepositoryError::datastore)?
            .ok_or_else(|| RepositoryError::not_found("MongoDB document was not found."))?;
        Ok({found_value})
    }}

"#,
        function = function,
        output_type = output_type,
        object_id = object_id,
        database = rust_string_literal(database),
        collection = rust_string_literal(collection),
        found_value = found_value,
    );
    if resource.mode != ProjectResourceMode::Crud {
        return output;
    }
    let _ = write!(
        output,
        r#"    pub async fn create_{function}(&self, values: Value) -> Result<{output_type}, RepositoryError> {{
        let mut document = json_to_document(values)?;
        let collection = self.client.database({database}).collection::<Document>({collection});
        let result = collection
            .insert_one(document.clone())
            .await
            .map_err(RepositoryError::datastore)?;
        document.insert("_id", result.inserted_id.clone());
        let stored = collection
            .find_one(doc! {{ "_id": result.inserted_id }})
            .await
            .map_err(RepositoryError::datastore)?
            .unwrap_or(document);
        Ok({created_value})
    }}

    pub async fn update_{function}(
        &self,
        identity: String,
        values: Value,
    ) -> Result<{output_type}, RepositoryError> {{
        let identity = exact_identity(&identity, {object_id})?;
        let changes = json_to_document(values)?;
        validate_patch(&changes)?;
        let document = self.client
            .database({database})
            .collection::<Document>({collection})
            .find_one_and_update(doc! {{ "_id": identity }}, doc! {{ "$set": changes }})
            .return_document(ReturnDocument::After)
            .await
            .map_err(RepositoryError::datastore)?
            .ok_or_else(|| RepositoryError::not_found("MongoDB document was not found."))?;
        Ok({updated_value})
    }}

    pub async fn delete_{function}(&self, identity: String) -> Result<Value, RepositoryError> {{
        let identity = exact_identity(&identity, {object_id})?;
        let document = self.client
            .database({database})
            .collection::<Document>({collection})
            .find_one_and_delete(doc! {{ "_id": identity }})
            .await
            .map_err(RepositoryError::datastore)?
            .ok_or_else(|| RepositoryError::not_found("MongoDB document was not found."))?;
        document_to_json(document)
    }}

"#,
        function = function,
        output_type = output_type,
        object_id = object_id,
        database = rust_string_literal(database),
        collection = rust_string_literal(collection),
        created_value = created_value,
        updated_value = found_value,
    );
    output
}
