use std::fmt::Write as _;

use super::*;

pub(crate) static RENDERER: ProjectExportFrameworkRenderer = ProjectExportFrameworkRenderer {
    framework: "rust",
    dependencies,
    render,
};

fn dependencies(spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    let mut dependencies = vec![
        dependency("axum", "0.8.9", "axum = \"=0.8.9\""),
        dependency(
            "base64",
            "0.22.1",
            "base64 = \"=0.22.1\"",
        ),
        dependency(
            "chrono",
            "0.4.44",
            "chrono = { version = \"=0.4.44\", features = [\"serde\"] }",
        ),
        dependency(
            "serde",
            "1.0.228",
            "serde = { version = \"=1.0.228\", features = [\"derive\"] }",
        ),
        dependency("serde_json", "1.0.149", "serde_json = \"=1.0.149\""),
        dependency(
            "tokio",
            "1.52.1",
            "tokio = { version = \"=1.52.1\", features = [\"macros\", \"rt-multi-thread\", \"net\"] }",
        ),
        dependency("tracing", "0.1.44", "tracing = \"=0.1.44\""),
        dependency(
            "tracing-subscriber",
            "0.3.22",
            "tracing-subscriber = { version = \"=0.3.22\", features = [\"env-filter\"] }",
        ),
        dependency(
            "uuid",
            "1.23.1",
            "uuid = { version = \"=1.23.1\", features = [\"serde\"] }",
        ),
    ];
    if spec.protocol == "graphql" {
        dependencies.push(dependency(
            "async-graphql",
            "7.2.1",
            "async-graphql = \"=7.2.1\"",
        ));
        dependencies.push(dependency(
            "async-graphql-axum",
            "7.2.1",
            "async-graphql-axum = \"=7.2.1\"",
        ));
    }
    if spec.protocol == "grpc" {
        dependencies.push(dependency("prost", "0.13.5", "prost = \"=0.13.5\""));
        dependencies.push(dependency("tonic", "0.12.3", "tonic = \"=0.12.3\""));
        dependencies.push(ProjectDependency {
            package: "tonic-build".into(),
            version: "0.12.3".into(),
            declaration: "tonic-build = \"=0.12.3\"".into(),
            build: true,
        });
        dependencies.push(ProjectDependency {
            package: "protoc-bin-vendored".into(),
            version: "3.2.0".into(),
            declaration: "protoc-bin-vendored = \"=3.2.0\"".into(),
            build: true,
        });
    }
    dependencies
}

fn dependency(package: &str, version: &str, declaration: &str) -> ProjectDependency {
    ProjectDependency {
        package: package.into(),
        version: version.into(),
        declaration: declaration.into(),
        build: false,
    }
}

fn render(spec: &ProjectExportSpec, adapter: &ProjectExportClientAdapter) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    let mut files = vec![
        project_file(&root, "Cargo.toml", cargo_toml(spec)),
        project_file(&root, ".env.example", common::env_example(spec)),
        project_file(&root, "README.md", common::project_readme(spec)),
        project_file(
            &root,
            "datapad-api-export.json",
            common::project_manifest(spec),
        ),
        project_file(&root, "src/models.rs", models(spec)),
        project_file(&root, "src/main.rs", main_source(spec)),
    ];
    files.extend((adapter.render_client_files)(spec, adapter));
    if spec.protocol == "grpc" {
        files.push(project_file(&root, "build.rs", grpc_build()));
        files.push(project_file(
            &root,
            "proto/datapad_api.proto",
            common::grpc_proto(spec),
        ));
    }
    files
}

fn cargo_toml(spec: &ProjectExportSpec) -> String {
    let dependencies = spec
        .dependencies
        .iter()
        .filter(|dependency| !dependency.build)
        .map(|dependency| dependency.declaration.clone())
        .collect::<Vec<_>>()
        .join("\n");
    let build_dependencies = spec
        .dependencies
        .iter()
        .filter(|dependency| dependency.build)
        .map(|dependency| dependency.declaration.clone())
        .collect::<Vec<_>>();
    let build_dependencies = if build_dependencies.is_empty() {
        String::new()
    } else {
        format!(
            "\n[build-dependencies]\n{}\n",
            build_dependencies.join("\n")
        )
    };
    format!(
        "[package]\nname = \"{}\"\nversion = \"0.1.0\"\nedition = \"2021\"\nrust-version = \"{}\"\n\n[dependencies]\n{}\n{}",
        spec.package_name, spec.rust_version, dependencies, build_dependencies
    )
}

fn models(spec: &ProjectExportSpec) -> String {
    let mut output = String::from("use serde::{Deserialize, Serialize};\n\n");
    for resource in &spec.resources {
        if resource.shape.is_document() {
            output.push_str(&document_model(resource, &spec.protocol));
            continue;
        }
        if spec.protocol == "graphql" {
            output.push_str(
                "#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, async_graphql::SimpleObject)]\n",
            );
        } else {
            output.push_str("#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]\n");
        }
        let _ = writeln!(output, "pub struct {} {{", resource.model_name);
        for field in &resource.fields {
            let _ = writeln!(
                output,
                "    #[serde(rename = {})]\n    #[sqlx(rename = {})]\n    pub {}: {},",
                rust_string_literal(&field.json_name),
                rust_string_literal(&field.rust_name),
                field.rust_name,
                field.rust_type
            );
        }
        output.push_str("}\n\n");

        if spec.protocol == "graphql" && resource.mode == ProjectResourceMode::Crud {
            output.push_str(
                "#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::InputObject)]\n",
            );
            let _ = writeln!(output, "pub struct {}Input {{", resource.model_name);
            for field in &resource.fields {
                let input_type = if field.rust_type.starts_with("Option<") {
                    field.rust_type.clone()
                } else {
                    format!("Option<{}>", field.rust_base_type)
                };
                let _ = writeln!(
                    output,
                    "    #[serde(rename = {}, skip_serializing_if = \"Option::is_none\")]\n    pub {}: {},",
                    rust_string_literal(&field.json_name),
                    field.rust_name,
                    input_type
                );
            }
            output.push_str("}\n\n");
        }
    }
    output
}

fn document_model(resource: &ProjectResourceModel, protocol: &str) -> String {
    let mut output = String::new();
    if protocol == "graphql" {
        output.push_str(
            "#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]\n",
        );
    } else {
        output.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
    }
    let _ = writeln!(output, "pub struct {} {{", resource.model_name);
    if protocol == "graphql" {
        output.push_str("    pub document: async_graphql::Json<serde_json::Value>,\n");
        for field in &resource.fields {
            let _ = writeln!(
                output,
                "    #[serde(rename = {})]\n    pub {}: {},",
                rust_string_literal(&field.json_name),
                field.rust_name,
                field.rust_type
            );
        }
    } else {
        output.push_str("    pub document: serde_json::Value,\n");
    }
    output.push_str("}\n\n");
    if protocol == "graphql" {
        let _ = writeln!(
            output,
            "impl {} {{\n    pub fn from_document(document: serde_json::Value) -> Self {{",
            resource.model_name
        );
        for field in &resource.fields {
            let value = document_field_projection(field);
            let _ = writeln!(output, "        let {} = {};\n", field.rust_name, value);
        }
        output.push_str("        Self {\n            document: async_graphql::Json(document),\n");
        for field in &resource.fields {
            let _ = writeln!(output, "            {},", field.rust_name);
        }
        output.push_str("        }\n    }\n}\n\n");
        if resource.mode == ProjectResourceMode::Crud {
            output.push_str(
                "#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::InputObject)]\n",
            );
            let _ = writeln!(
                output,
                "pub struct {}Input {{\n    pub document: async_graphql::Json<serde_json::Value>,\n}}\n",
                resource.model_name
            );
        }
    }
    output
}

fn document_field_projection(field: &ProjectFieldModel) -> String {
    let name = rust_string_literal(&field.json_name);
    match field.rust_base_type.as_str() {
        "String" => format!(
            "document.get({name}).and_then(serde_json::Value::as_str).map(str::to_string)"
        ),
        "bool" => {
            format!("document.get({name}).and_then(serde_json::Value::as_bool)")
        }
        "i32" => format!(
            "document.get({name}).and_then(serde_json::Value::as_i64).and_then(|value| i32::try_from(value).ok())"
        ),
        "i64" => {
            format!("document.get({name}).and_then(serde_json::Value::as_i64)")
        }
        "f64" => {
            format!("document.get({name}).and_then(serde_json::Value::as_f64)")
        }
        _ => format!(
            "document.get({name}).cloned().map(async_graphql::Json)"
        ),
    }
}

fn main_source(spec: &ProjectExportSpec) -> String {
    match spec.protocol.as_str() {
        "graphql" => graphql_main(spec),
        "grpc" => grpc_main(spec),
        _ => rest_main(spec),
    }
}

fn rest_main(spec: &ProjectExportSpec) -> String {
    let mut routes = String::new();
    let mut handlers = String::new();
    for resource in &spec.resources {
        let function = snake_case(&resource.endpoint_slug);
        let collection_route = if resource.mode == ProjectResourceMode::Crud {
            format!("get(search_{function}).post(create_{function})")
        } else {
            format!("get(search_{function})")
        };
        let _ = writeln!(
            routes,
            "        .route({}, {})",
            rust_string_literal(&resource.endpoint_path),
            collection_route
        );
        if !resource.primary_fields.is_empty() {
            let detail_route = if resource.mode == ProjectResourceMode::Crud {
                format!("get(get_{function}).patch(update_{function}).delete(delete_{function})")
            } else {
                format!("get(get_{function})")
            };
            let _ = writeln!(
                routes,
                "        .route({}, {})",
                rust_string_literal(&format!("{}/{{identity}}", resource.endpoint_path)),
                detail_route
            );
        }
        handlers.push_str(&rest_handlers(resource));
    }
    for endpoint in &spec.custom_endpoints {
        let method = if endpoint.method == "POST" {
            "axum::routing::post"
        } else {
            "get"
        };
        let _ = writeln!(
            routes,
            "        .route({}, {method}(run_{}))",
            rust_string_literal(&endpoint.endpoint_path),
            endpoint.function_name
        );
        handlers.push_str(&custom_handler(endpoint));
    }
    format!(
        r#"mod models;
mod repository;

use std::{{net::SocketAddr, sync::Arc}};
use axum::{{
    extract::{{Path, Query, State}},
    http::StatusCode,
    routing::get,
    Json, Router,
}};
use serde::Deserialize;
use serde_json::{{json, Value}};
use repository::{{DatastoreRepository, RepositoryError}};

#[derive(Clone)]
struct AppState {{
    repository: Arc<DatastoreRepository>,
}}

#[derive(Deserialize)]
struct SearchQuery {{
    limit: Option<u32>,
}}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MutationBody {{
    values: Option<Value>,
    identity: Option<Value>,
    changes: Option<Vec<Value>>,
    #[serde(rename = "confirmationText")]
    confirmation_text: Option<String>,
}}

#[tokio::main]
async fn main() {{
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let repository = DatastoreRepository::from_env()
        .await
        .expect("connect to configured datastore");
    repository
        .ping()
        .await
        .expect("validate configured datastore");
    let state = AppState {{ repository: Arc::new(repository) }};
    let app = Router::new()
{routes}        .route("/health", get(health))
        .with_state(state);
    let address = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind API listener");
    axum::serve(listener, app).await.expect("serve API");
}}

async fn health(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{
    state.repository.ping().await.map_err(api_error)?;
    Ok(Json(json!({{ "ok": true, "datastoreConnected": true }})))
}}

fn api_error(error: RepositoryError) -> (StatusCode, Json<Value>) {{
    let status = match error.kind {{
        "invalid" => StatusCode::BAD_REQUEST,
        "not-found" => StatusCode::NOT_FOUND,
        "unavailable" => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }};
    (status, Json(json!({{ "type": error.kind, "title": error.message, "status": status.as_u16() }})))
}}

{handlers}"#,
        routes = routes,
        handlers = handlers,
    )
}

fn rest_handlers(resource: &ProjectResourceModel) -> String {
    let function = snake_case(&resource.endpoint_slug);
    let result_type = if resource.shape.is_document() {
        "Value".to_string()
    } else {
        format!("models::{}", resource.model_name)
    };
    let mut output = format!(
        r#"async fn search_{function}(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<{result_type}>>, (StatusCode, Json<Value>)> {{
    state.repository
        .search_{function}(query.limit.unwrap_or(100))
        .await
        .map(Json)
        .map_err(api_error)
}}

"#,
        function = function,
        result_type = result_type,
    );
    if !resource.primary_fields.is_empty() {
        let _ = write!(
            output,
            r#"async fn get_{function}(
    State(state): State<AppState>,
    Path(identity): Path<String>,
) -> Result<Json<{result_type}>, (StatusCode, Json<Value>)> {{
    state.repository.get_{function}(identity).await.map(Json).map_err(api_error)
}}

"#,
            function = function,
            result_type = result_type,
        );
    }
    if resource.mode == ProjectResourceMode::Crud {
        let _ = write!(
            output,
            r#"async fn create_{function}(
    State(state): State<AppState>,
    Json(body): Json<MutationBody>,
) -> Result<Json<{result_type}>, (StatusCode, Json<Value>)> {{
    state.repository
        .create_{function}(body.values.unwrap_or_else(|| json!({{}})))
        .await
        .map(Json)
        .map_err(api_error)
}}

async fn update_{function}(
    State(state): State<AppState>,
    Path(identity): Path<String>,
    Json(body): Json<MutationBody>,
) -> Result<Json<{result_type}>, (StatusCode, Json<Value>)> {{
    state.repository
        .update_{function}(identity, body.values.unwrap_or_else(|| json!({{}})))
        .await
        .map(Json)
        .map_err(api_error)
}}

async fn delete_{function}(
    State(state): State<AppState>,
    Path(identity): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{
    state.repository.delete_{function}(identity).await.map(Json).map_err(api_error)
}}

"#,
            function = function,
            result_type = result_type,
        );
    }
    output
}

fn custom_handler(endpoint: &ProjectCustomEndpoint) -> String {
    if endpoint.method == "POST" {
        format!(
            r#"async fn run_{function}(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{
    state.repository.run_{function}(body).await.map(Json).map_err(api_error)
}}

"#,
            function = endpoint.function_name
        )
    } else {
        format!(
            r#"async fn run_{function}(
    State(state): State<AppState>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{
    state.repository
        .run_{function}(json!(query))
        .await
        .map(Json)
        .map_err(api_error)
}}

"#,
            function = endpoint.function_name
        )
    }
}

fn graphql_main(spec: &ProjectExportSpec) -> String {
    let mut query_methods = String::new();
    let mut mutation_methods = String::new();
    for resource in &spec.resources {
        let function = snake_case(&resource.endpoint_slug);
        let _ = write!(
            query_methods,
            r#"    async fn {function}(
        &self,
        context: &async_graphql::Context<'_>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<models::{model}>> {{
        let repository = context.data::<Arc<DatastoreRepository>>()?;
        Ok(repository.search_{function}(limit.unwrap_or(100).max(1) as u32).await?)
    }}

"#,
            function = function,
            model = resource.model_name,
        );
        if resource.mode == ProjectResourceMode::Crud {
            let create_value = if resource.shape.is_document() {
                "values.document.0".to_string()
            } else {
                "serde_json::to_value(values)?".to_string()
            };
            let _ = write!(
                mutation_methods,
                r#"    async fn create_{function}(
        &self,
        context: &async_graphql::Context<'_>,
        values: models::{model}Input,
    ) -> async_graphql::Result<models::{model}> {{
        let repository = context.data::<Arc<DatastoreRepository>>()?;
        Ok(repository.create_{function}({create_value}).await?)
    }}

"#,
                function = function,
                model = resource.model_name,
                create_value = create_value,
            );
        }
    }
    let (mutation_declaration, mutation_root) = if mutation_methods.is_empty() {
        (String::new(), "async_graphql::EmptyMutation".to_string())
    } else {
        (
            format!(
                "struct MutationRoot;\n\n#[Object]\nimpl MutationRoot {{\n{mutation_methods}}}\n"
            ),
            "MutationRoot".to_string(),
        )
    };
    format!(
        r#"mod models;
mod repository;

use std::sync::Arc;
use async_graphql::{{EmptySubscription, Object, Schema}};
use async_graphql_axum::GraphQL;
use axum::{{
    extract::State,
    http::StatusCode,
    response::Html,
    routing::get,
    Json,
    Router,
}};
use serde_json::{{json, Value}};
use repository::DatastoreRepository;

struct QueryRoot;

#[Object]
impl QueryRoot {{
{query_methods}}}

{mutation_declaration}

#[tokio::main]
async fn main() {{
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let repository = Arc::new(
        DatastoreRepository::from_env()
            .await
            .expect("connect to configured datastore"),
    );
    repository
        .ping()
        .await
        .expect("validate configured datastore");
    let schema = Schema::build(QueryRoot, {mutation_root}, EmptySubscription)
        .data(repository.clone())
        .finish();
    let app = Router::new()
        .route("/", get(|| async {{ Html("GraphQL endpoint: /graphql") }}))
        .route_service("/graphql", GraphQL::new(schema))
        .route("/health", get(health))
        .with_state(repository);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("bind API listener");
    axum::serve(listener, app).await.expect("serve API");
}}

async fn health(
    State(repository): State<Arc<DatastoreRepository>>,
) -> Result<Json<Value>, (StatusCode, String)> {{
    repository
        .ping()
        .await
        .map_err(|error| (StatusCode::SERVICE_UNAVAILABLE, error.to_string()))?;
    Ok(Json(json!({{ "ok": true, "datastoreConnected": true }})))
}}
"#,
        query_methods = query_methods,
        mutation_declaration = mutation_declaration,
        mutation_root = mutation_root,
    )
}

fn grpc_main(spec: &ProjectExportSpec) -> String {
    let mut services = String::new();
    let mut add_services = String::new();
    for resource in &spec.resources {
        let service = format!("{}Service", resource.model_name);
        let module = snake_case(&service);
        let server = format!("{}Server", service);
        let function = snake_case(&resource.endpoint_slug);
        let _ = write!(
            services,
            r#"pub struct {service}Impl {{
    repository: Arc<DatastoreRepository>,
}}

#[tonic::async_trait]
impl api::{module}_server::{service} for {service}Impl {{
    async fn search(
        &self,
        request: tonic::Request<api::SearchRequest>,
    ) -> Result<tonic::Response<api::JsonResponse>, tonic::Status> {{
        let rows = self.repository
            .search_{function}(request.into_inner().limit.max(1))
            .await
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        let json = serde_json::to_string(&rows)
            .map_err(|error| tonic::Status::internal(error.to_string()))?;
        Ok(tonic::Response::new(api::JsonResponse {{ json }}))
    }}
}}

"#,
            service = service,
            module = module,
            function = function,
        );
        let _ = writeln!(
            add_services,
            "        .add_service(api::{module}_server::{server}::new({service}Impl {{ repository: repository.clone() }}))",
            module = module,
            server = server,
            service = service
        );
    }
    format!(
        r#"mod models;
mod repository;

use std::sync::Arc;
use repository::DatastoreRepository;

pub mod api {{
    tonic::include_proto!("datapad.api");
}}

{services}#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {{
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let repository = Arc::new(DatastoreRepository::from_env().await?);
    repository.ping().await?;
    tonic::transport::Server::builder()
{add_services}        .serve("0.0.0.0:8080".parse()?)
        .await?;
    Ok(())
}}
"#,
        services = services,
        add_services = add_services,
    )
}

fn grpc_build() -> String {
    "fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let protoc = protoc_bin_vendored::protoc_bin_path()?;\n    std::env::set_var(\"PROTOC\", protoc);\n    tonic_build::compile_protos(\"proto/datapad_api.proto\")?;\n    Ok(())\n}\n".into()
}
