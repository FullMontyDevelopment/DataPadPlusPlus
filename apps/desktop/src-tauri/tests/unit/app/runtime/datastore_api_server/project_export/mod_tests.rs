use super::*;

fn field(
    source_name: &str,
    rust_type: &str,
    csharp_type: &str,
    primary: bool,
) -> ProjectFieldModel {
    ProjectFieldModel {
        source_name: source_name.into(),
        rust_name: snake_case(source_name),
        csharp_name: pascal_case(source_name),
        json_name: source_name.into(),
        rust_base_type: rust_type.into(),
        rust_type: rust_type.into(),
        csharp_base_type: csharp_type.into(),
        csharp_type: csharp_type.into(),
        data_type: if rust_type == "i32" {
            "integer".into()
        } else {
            "text".into()
        },
        nullable: false,
        primary,
        writable: true,
    }
}

fn document_field(
    source_name: &str,
    rust_type: &str,
    csharp_type: &str,
    primary: bool,
) -> ProjectFieldModel {
    let mut field = field(source_name, rust_type, csharp_type, primary);
    field.rust_type = format!("Option<{rust_type}>");
    field.csharp_type = format!("{csharp_type}?");
    field.nullable = true;
    field
}

fn resource() -> ProjectResourceModel {
    let id = field("id", "i32", "int", true);
    ProjectResourceModel {
        id: "api-resource-users".into(),
        label: "users".into(),
        kind: "table".into(),
        endpoint_slug: "users".into(),
        endpoint_path: "/users".into(),
        model_name: "Users".into(),
        shape: ProjectResourceShape::Relational,
        schema_source: "catalog".into(),
        schema_source_label: "Datastore catalog".into(),
        database_name: None,
        schema_name: None,
        table_name: "users".into(),
        qualified_target: "\"users\"".into(),
        identity_format: "scalar".into(),
        json_format: None,
        sample_status: None,
        mode: ProjectResourceMode::Crud,
        capability_reason: None,
        fields: vec![id.clone(), field("email", "String", "string", false)],
        primary_fields: vec![id],
    }
}

fn mongodb_resource() -> ProjectResourceModel {
    let mut id = document_field("_id", "String", "string", true);
    id.data_type = "objectId".into();
    ProjectResourceModel {
        id: "api-resource-users".into(),
        label: "users".into(),
        kind: "collection".into(),
        endpoint_slug: "users".into(),
        endpoint_path: "/users".into(),
        model_name: "Users".into(),
        shape: ProjectResourceShape::Document,
        schema_source: "sample".into(),
        schema_source_label: "MongoDB bounded document sample".into(),
        database_name: Some("catalog".into()),
        schema_name: None,
        table_name: "accounts".into(),
        qualified_target: "catalog.accounts".into(),
        identity_format: "scalar-or-_id-object".into(),
        json_format: Some("mongodb-extended-json".into()),
        sample_status: Some("sampled".into()),
        mode: ProjectResourceMode::Crud,
        capability_reason: None,
        fields: vec![
            id.clone(),
            document_field("email", "String", "string", false),
        ],
        primary_fields: vec![id],
    }
}

fn dynamodb_resource() -> ProjectResourceModel {
    let mut tenant = document_field("pk", "String", "string", true);
    tenant.data_type = "S".into();
    let mut user = document_field("sk", "String", "string", true);
    user.data_type = "S".into();
    ProjectResourceModel {
        id: "api-resource-users".into(),
        label: "users".into(),
        kind: "item".into(),
        endpoint_slug: "users".into(),
        endpoint_path: "/users".into(),
        model_name: "Users".into(),
        shape: ProjectResourceShape::KeyedDocument,
        schema_source: "describe-table-and-sample".into(),
        schema_source_label: "DynamoDB key schema and bounded item sample".into(),
        database_name: None,
        schema_name: None,
        table_name: "order_events".into(),
        qualified_target: "order_events".into(),
        identity_format: "exact-key-object".into(),
        json_format: Some("dynamodb-lossless-document-json".into()),
        sample_status: Some("sampled".into()),
        mode: ProjectResourceMode::Crud,
        capability_reason: None,
        fields: vec![
            tenant.clone(),
            user.clone(),
            document_field("email", "String", "string", false),
        ],
        primary_fields: vec![tenant, user],
    }
}

fn spec(framework: &str, engine: &str, protocol: &str) -> ProjectExportSpec {
    let adapter = registry::client_adapter_for(framework, engine).unwrap();
    let renderer = registry::framework_renderer_for(framework).unwrap();
    let custom_endpoints = if protocol == "rest" && matches!(engine, "postgresql" | "sqlite") {
        vec![ProjectCustomEndpoint {
            id: "api-endpoint-users-by-email".into(),
            label: "Users by email".into(),
            method: "GET".into(),
            endpoint_path: "/users-by-email".into(),
            function_name: "users_by_email".into(),
            original_query: "SELECT id, email FROM users WHERE email = {{api.email}} LIMIT 100"
                .into(),
            parameterized_query: format!(
                "SELECT \"id\", \"email\" FROM \"users\" WHERE \"email\" = {} LIMIT 100",
                (adapter.sql.expect("SQL adapter").parameter_placeholder)(1)
            ),
            row_limit: 100,
            parameters: vec![ProjectEndpointParameter {
                name: "email".into(),
                parameter_type: "string".into(),
                rust_type: "String".into(),
                required: true,
            }],
        }]
    } else {
        Vec::new()
    };
    let mut spec = ProjectExportSpec {
        framework: framework.into(),
        project_name: "UsersApi".into(),
        namespace: "UsersApi".into(),
        package_name: "users_api".into(),
        protocol: protocol.into(),
        base_path: String::new(),
        connection_engine: engine.into(),
        connection_family: if engine == "mongodb" {
            "document".into()
        } else if engine == "dynamodb" {
            "widecolumn".into()
        } else {
            "sql".into()
        },
        adapter_id: adapter.id.into(),
        client_label: adapter.client_label.into(),
        configuration_key: adapter.configuration_key.into(),
        configuration_example: adapter.configuration_example.into(),
        additional_configuration: adapter
            .additional_configuration
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect(),
        safety_note: adapter.safety_note.into(),
        rust_version: adapter.rust_version.into(),
        resources: vec![match engine {
            "mongodb" => mongodb_resource(),
            "dynamodb" => dynamodb_resource(),
            _ => resource(),
        }],
        custom_endpoints,
        dependencies: Vec::new(),
        warnings: Vec::new(),
    };
    spec.dependencies.extend((renderer.dependencies)(&spec));
    spec.dependencies.extend((adapter.dependencies)(&spec));
    spec
}

fn rendered_files(framework: &str, engine: &str, protocol: &str) -> Vec<ProjectFile> {
    let spec = spec(framework, engine, protocol);
    let renderer = registry::framework_renderer_for(framework).unwrap();
    let adapter = registry::client_adapter_for(framework, engine).unwrap();
    (renderer.render)(&spec, adapter)
}

#[test]
fn registry_has_two_renderers_four_providers_and_exactly_eight_client_adapters() {
    assert_eq!(registry::framework_renderer_registration_count(), 2);
    assert_eq!(registry::datastore_provider_registration_count(), 4);
    assert_eq!(registry::client_adapter_registration_count(), 8);
    for framework in ["rust", "dotnet"] {
        for engine in ["postgresql", "sqlite", "mongodb", "dynamodb"] {
            assert!(registry::client_adapter_for(framework, engine).is_ok());
            assert!(registry::datastore_provider_for(engine).is_ok());
        }
    }
}

#[test]
fn capability_contract_keeps_additive_camel_case_wire_fields() {
    let payload = DatastoreApiServerProjectExportCapabilitiesResponse {
        server_id: "server-1".into(),
        engine: "sqlite".into(),
        frameworks: vec![DatastoreApiServerProjectExportFrameworkCapability {
            framework: "rust".into(),
            supported: true,
            client: "SQLx / SQLite".into(),
            protocols: vec!["rest".into()],
            reason: None,
            resources: vec![DatastoreApiServerProjectExportResourceCapability {
                resource_id: "users".into(),
                mode: "read-only".into(),
                reason: Some("Keyless resource.".into()),
            }],
            custom_endpoints: vec![DatastoreApiServerProjectExportEndpointCapability {
                endpoint_id: "users-by-email".into(),
                supported: false,
                reason: Some("Multiple statements are not supported.".into()),
            }],
            warnings: Vec::new(),
        }],
    };
    let serialized = serde_json::to_value(payload).unwrap();
    assert_eq!(serialized["serverId"], "server-1");
    assert_eq!(
        serialized["frameworks"][0]["resources"][0]["resourceId"],
        "users"
    );
    assert_eq!(
        serialized["frameworks"][0]["customEndpoints"][0]["endpointId"],
        "users-by-email"
    );
}

#[test]
fn unsupported_engines_do_not_inherit_postgresql_support() {
    for engine in ["cockroachdb", "timescaledb", "mysql", "cosmosdb"] {
        let error = match registry::client_adapter_for("rust", engine) {
            Ok(_) => panic!("{engine} must not inherit PostgreSQL export support"),
            Err(error) => error,
        };
        assert_eq!(error.code, "api-server-export-client-unsupported");
        assert_eq!(
            error.message,
            format!(
                "Rust project export supports PostgreSQL, SQLite, MongoDB, and DynamoDB only; `{engine}` is not supported."
            )
        );
    }
}

#[test]
fn mongodb_exports_use_the_official_clients_and_exact_id_guards() {
    for framework in ["rust", "dotnet"] {
        let files = rendered_files(framework, "mongodb", "rest");
        let manifest = file_contents(&files, "UsersApi/datapad-api-export.json");
        let source = files
            .iter()
            .map(|file| file.contents.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(source.contains("MongoDB.Driver") || source.contains("mongodb = \"=3.8.0\""));
        assert!(source.contains("ping"));
        assert!(source.contains("exactly the _id field"));
        assert!(source.contains("cannot change _id"));
        assert!(source.contains("find_one_and_update") || source.contains("FindOneAndUpdateAsync"));
        assert!(manifest.contains("\"resourceShape\": \"document\""));
        assert!(manifest.contains("\"jsonFormat\": \"mongodb-extended-json\""));
        assert!(manifest.contains("\"compilerRequirements\""));
        assert!(!source.contains("Ok(Vec::new())"));
        assert!(!source.contains("Array.Empty"));
    }
}

#[test]
fn dynamodb_exports_share_lossless_tags_and_conditional_mutations() {
    for framework in ["rust", "dotnet"] {
        let files = rendered_files(framework, "dynamodb", "rest");
        let environment = file_contents(&files, "UsersApi/.env.example");
        let manifest = file_contents(&files, "UsersApi/datapad-api-export.json");
        let source = files
            .iter()
            .map(|file| file.contents.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        for tag in [
            "$number",
            "$binary",
            "$stringSet",
            "$numberSet",
            "$binarySet",
        ] {
            assert!(source.contains(tag), "{framework} must emit {tag}");
        }
        assert!(source.contains("DescribeTable") || source.contains("describe_table"));
        assert!(source.contains("attribute_not_exists"));
        assert!(source.contains("ALL_NEW") || source.contains("AllNew"));
        assert!(
            source.contains("ConsistentRead = true") || source.contains("consistent_read(true)")
        );
        assert!(source.contains("rust-version = \"1.94.1\"") || framework == "dotnet");
        assert!(manifest.contains("\"resourceShape\": \"keyed-document\""));
        assert!(manifest.contains("\"jsonFormat\": \"dynamodb-lossless-document-json\""));
        assert!(environment.contains("DYNAMODB_ENDPOINT_URL=http://127.0.0.1:8000"));
        assert!(!environment.contains("AWS_SECRET_ACCESS_KEY"));
        assert!(!environment.contains("AWS_SESSION_TOKEN"));
    }
}

#[test]
fn document_providers_plan_views_keys_and_deferred_custom_endpoints() {
    let config = DatastoreApiServerConfig::default();
    let mongo_resource = DatastoreApiServerResourceConfig {
        id: "resource-audit".into(),
        kind: "collection".into(),
        label: "audit".into(),
        node_id: "audit".into(),
        endpoint_slug: "audit".into(),
        enabled: true,
        path: vec!["catalog".into()],
        ..Default::default()
    };
    let mongo_metadata = ProjectExportMetadata {
        structure_nodes: vec![StructureNode {
            id: "audit".into(),
            family: "document".into(),
            label: "audit".into(),
            kind: "view".into(),
            group_id: Some("catalog".into()),
            detail: None,
            database: Some("catalog".into()),
            schema: Some("catalog".into()),
            object_name: Some("audit".into()),
            qualified_name: Some("catalog.audit".into()),
            column_count: Some(1),
            relationship_count: None,
            row_count_estimate: None,
            index_count: None,
            is_system: Some(false),
            is_view: Some(true),
            fields: vec![StructureField {
                name: "_id".into(),
                data_type: "objectId".into(),
                detail: None,
                nullable: Some(false),
                primary: Some(true),
                ordinal: Some(0),
                indexed: Some(true),
            }],
            metrics: Vec::new(),
            sample: None,
        }],
        ..Default::default()
    };
    let mongo = registry::datastore_provider_for("mongodb").unwrap();
    let mongo_adapter = registry::client_adapter_for("rust", "mongodb").unwrap();
    let view = mongo
        .plan_resource(&config, &mongo_resource, &mongo_metadata, mongo_adapter)
        .unwrap();
    assert_eq!(view.mode, ProjectResourceMode::ReadOnly);
    assert!(view.primary_fields.is_empty());
    assert_eq!(view.sample_status.as_deref(), Some("sampled"));

    let endpoint = DatastoreApiServerCustomEndpointConfig::default();
    let mongo_endpoint = match mongo.plan_custom_endpoint(&config, &endpoint, mongo_adapter) {
        Ok(_) => panic!("MongoDB custom endpoints must stay deferred"),
        Err(error) => error,
    };
    assert_eq!(
        mongo_endpoint.message,
        "MongoDB custom endpoints are not supported by project export; export collection resources instead."
    );

    let dynamodb = registry::datastore_provider_for("dynamodb").unwrap();
    let dynamodb_adapter = registry::client_adapter_for("dotnet", "dynamodb").unwrap();
    let dynamodb_endpoint =
        match dynamodb.plan_custom_endpoint(&config, &endpoint, dynamodb_adapter) {
            Ok(_) => panic!("DynamoDB custom endpoints must stay deferred"),
            Err(error) => error,
        };
    assert_eq!(
        dynamodb_endpoint.message,
        "DynamoDB custom endpoints are not supported by project export; export table resources instead."
    );
}

#[test]
fn rust_sqlite_rest_export_uses_real_parameterized_sqlx_repository() {
    let files = rendered_files("rust", "sqlite", "rest");
    let cargo = file_contents(&files, "UsersApi/Cargo.toml");
    let repository = file_contents(&files, "UsersApi/src/repository.rs");
    let main = file_contents(&files, "UsersApi/src/main.rs");
    let manifest = file_contents(&files, "UsersApi/datapad-api-export.json");

    assert!(cargo.contains("version = \"=0.9.0\""));
    assert!(cargo.contains("\"sqlite\""));
    assert!(repository.contains("SqlitePoolOptions"));
    assert!(repository.contains("QueryBuilder::<sqlx::Sqlite>"));
    assert!(repository.contains("push_bind"));
    assert!(repository.contains("INSERT INTO \\\"users\\\""));
    assert!(repository.contains("let mut assignment_count = 0_usize"));
    assert!(!repository.contains("let mut assignments = query.separated"));
    assert!(!repository.contains("Ok(Vec::new())"));
    assert!(!repository.contains("\"echo\""));
    assert!(main.contains(".search_users("));
    assert!(main.contains(".create_users("));
    assert!(manifest.contains("\"id\": \"rust-sqlite-sqlx\""));
    assert!(manifest.contains("\"mode\": \"crud\""));
}

#[test]
fn dotnet_postgresql_grpc_export_uses_dapper_and_npgsql_repository() {
    let files = rendered_files("dotnet", "postgresql", "grpc");
    let packages = file_contents(&files, "UsersApi/Directory.Packages.props");
    let project = file_contents(&files, "UsersApi/UsersApi.csproj");
    let client = file_contents(&files, "UsersApi/DatastoreClient.cs");
    let repository = file_contents(&files, "UsersApi/DatastoreRepository.cs");
    let services = file_contents(&files, "UsersApi/Services.cs");

    assert!(packages.contains("Dapper\" Version=\"2.1.79\""));
    assert!(packages.contains("Npgsql\" Version=\"10.0.3\""));
    assert!(project.contains("RestorePackagesWithLockFile"));
    assert!(client.contains("NpgsqlDataSource.Create"));
    assert!(repository.contains("QueryAsync<Users>"));
    assert!(repository.contains("DynamicParameters"));
    assert!(services.contains("repository.SearchUsersAsync"));
    assert!(!repository.contains("Array.Empty"));
}

#[test]
fn all_protocol_renderers_call_the_real_repository() {
    for framework in ["rust", "dotnet"] {
        for protocol in ["rest", "graphql", "grpc"] {
            let files = rendered_files(framework, "sqlite", protocol);
            let source = files
                .iter()
                .filter(|file| file.path.ends_with(".rs") || file.path.ends_with(".cs"))
                .map(|file| file.contents.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            assert!(
                source.contains("search_users") || source.contains("SearchUsersAsync"),
                "{framework}/{protocol} must call its repository"
            );
        }
    }
}

#[test]
fn rust_grpc_export_vendors_protoc_for_reproducible_builds() {
    let files = rendered_files("rust", "sqlite", "grpc");
    let cargo = file_contents(&files, "UsersApi/Cargo.toml");
    let build = file_contents(&files, "UsersApi/build.rs");

    assert!(cargo.contains("protoc-bin-vendored = \"=3.2.0\""));
    assert!(build.contains("protoc_bin_vendored::protoc_bin_path()"));
    assert!(build.contains("std::env::set_var(\"PROTOC\", protoc)"));
}

#[test]
fn dotnet_graphql_export_pins_the_patched_parser_line() {
    let files = rendered_files("dotnet", "sqlite", "graphql");
    let packages = file_contents(&files, "UsersApi/Directory.Packages.props");

    assert!(packages.contains("HotChocolate.AspNetCore\" Version=\"15.1.14\""));
    assert!(!packages.contains("HotChocolate.AspNetCore\" Version=\"15.1.11\""));
}

#[test]
fn planner_quotes_identifiers_and_downgrades_keyless_and_unknown_types() {
    let config = DatastoreApiServerConfig::default();
    let resource_config = DatastoreApiServerResourceConfig {
        id: "resource-events".into(),
        kind: "table".into(),
        label: "event log".into(),
        node_id: "node-events".into(),
        endpoint_slug: "events".into(),
        enabled: true,
        ..Default::default()
    };
    let node = StructureNode {
        id: "node-events".into(),
        family: "sql".into(),
        label: "event log".into(),
        kind: "table".into(),
        group_id: None,
        detail: None,
        database: None,
        schema: Some("audit".into()),
        object_name: Some("event\"log".into()),
        qualified_name: None,
        column_count: Some(1),
        relationship_count: None,
        row_count_estimate: None,
        index_count: None,
        is_system: Some(false),
        is_view: Some(false),
        metrics: Vec::new(),
        fields: vec![StructureField {
            name: "payload".into(),
            data_type: "geography".into(),
            detail: None,
            nullable: Some(true),
            primary: Some(false),
            ordinal: Some(1),
            indexed: None,
        }],
        sample: None,
    };
    let adapter = registry::client_adapter_for("rust", "postgresql").unwrap();
    let planned =
        planner::project_resource_model(&config, &resource_config, &[node], adapter).unwrap();

    assert_eq!(planned.qualified_target, "\"audit\".\"event\"\"log\"");
    assert_eq!(planned.mode, ProjectResourceMode::ReadOnly);
    assert!(!planned.fields[0].writable);
}

#[test]
fn custom_sql_is_single_statement_read_only_and_replaces_repeated_parameters() {
    let config = DatastoreApiServerConfig {
        protocol: "rest".into(),
        ..Default::default()
    };
    let endpoint = DatastoreApiServerCustomEndpointConfig {
        id: "endpoint-users".into(),
        label: "Users by email".into(),
        endpoint_slug: "users-by-email".into(),
        enabled: true,
        method: "GET".into(),
        query_text:
            "SELECT id, email FROM users WHERE email = {{api.email}} OR manager = {{api.email}}"
                .into(),
        language: "sql".into(),
        row_limit: Some(50),
        parameters: vec![DatastoreApiServerCustomEndpointParameterConfig {
            name: "email".into(),
            parameter_type: "string".into(),
            required: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    let adapter = registry::client_adapter_for("rust", "postgresql").unwrap();
    let planned = planner::project_custom_endpoint(&config, &endpoint, adapter).unwrap();
    assert_eq!(planned.parameterized_query.matches("$1").count(), 2);
    assert!(planned.parameterized_query.ends_with("LIMIT 50"));
    assert_eq!(planned.parameters.len(), 1);

    let mut write = endpoint.clone();
    write.query_text = "DELETE FROM users WHERE email = {{api.email}}".into();
    let write_error = match planner::project_custom_endpoint(&config, &write, adapter) {
        Ok(_) => panic!("write endpoint must be rejected"),
        Err(error) => error,
    };
    assert_eq!(
        write_error.code,
        "api-server-export-custom-endpoint-read-only"
    );

    let mut multiple = endpoint.clone();
    multiple.query_text = "SELECT 1; SELECT 2".into();
    let multiple_error = match planner::project_custom_endpoint(&config, &multiple, adapter) {
        Ok(_) => panic!("multiple statements must be rejected"),
        Err(error) => error,
    };
    assert_eq!(
        multiple_error.code,
        "api-server-export-custom-endpoint-statement-count"
    );

    let mut secret_template = endpoint;
    secret_template.query_text = "SELECT id FROM users WHERE email = {{environment.secret}}".into();
    let secret_error = match planner::project_custom_endpoint(&config, &secret_template, adapter) {
        Ok(_) => panic!("environment templates must never enter a project export"),
        Err(error) => error,
    };
    assert_eq!(
        secret_error.code,
        "api-server-export-custom-endpoint-template-unsupported"
    );
}

#[test]
fn composite_primary_keys_generate_bound_identity_components() {
    let mut spec = spec("rust", "postgresql", "rest");
    let tenant = field("tenant_id", "i32", "int", true);
    spec.resources[0].fields.insert(1, tenant.clone());
    spec.resources[0].primary_fields.push(tenant);
    let renderer = registry::framework_renderer_for("rust").unwrap();
    let adapter = registry::client_adapter_for("rust", "postgresql").unwrap();
    let files = (renderer.render)(&spec, adapter);
    let repository = file_contents(&files, "UsersApi/src/repository.rs");

    assert!(repository.contains("parse_identity(&identity, true)"));
    assert!(repository.contains("identity_component(&identity, \"id\", true)"));
    assert!(repository.contains("identity_component(&identity, \"tenant_id\", true)"));
    assert!(repository.contains("push_bind"));
}

#[test]
fn generated_projects_link_to_the_official_datapad_website() {
    let rust_files = rendered_files("rust", "postgresql", "rest");
    let readme = file_contents(&rust_files, "UsersApi/README.md");
    let manifest = file_contents(&rust_files, "UsersApi/datapad-api-export.json");
    let cargo = file_contents(&rust_files, "UsersApi/Cargo.toml");
    let dotnet_files = rendered_files("dotnet", "postgresql", "rest");
    let project = file_contents(&dotnet_files, "UsersApi/UsersApi.csproj");

    assert!(readme.contains("[https://datapad-plus-plus.org/](https://datapad-plus-plus.org/)"));
    assert!(manifest.contains("\"generatedByUrl\": \"https://datapad-plus-plus.org/\""));
    assert!(cargo.contains("homepage = \"https://datapad-plus-plus.org/\""));
    assert!(
        project.contains("<PackageProjectUrl>https://datapad-plus-plus.org/</PackageProjectUrl>")
    );
}

#[test]
#[ignore = "invoked by the generated project matrix validator"]
fn emit_generated_project_matrix() {
    let destination = std::env::var_os("DATAPAD_PROJECT_EXPORT_MATRIX_DIR")
        .map(std::path::PathBuf::from)
        .expect("set DATAPAD_PROJECT_EXPORT_MATRIX_DIR");
    for framework in ["rust", "dotnet"] {
        for engine in ["postgresql", "sqlite", "mongodb", "dynamodb"] {
            for protocol in ["rest", "graphql", "grpc"] {
                let mut spec = spec(framework, engine, protocol);
                spec.project_name = format!(
                    "{}{}{}Api",
                    pascal_case(framework),
                    pascal_case(engine),
                    pascal_case(protocol)
                );
                spec.namespace = spec.project_name.clone();
                spec.package_name = snake_case(&spec.project_name);
                let renderer = registry::framework_renderer_for(framework).unwrap();
                let adapter = registry::client_adapter_for(framework, engine).unwrap();
                for file in (renderer.render)(&spec, adapter) {
                    let relative = file
                        .path
                        .split_once('/')
                        .map(|(_, path)| path)
                        .unwrap_or(file.path.as_str());
                    let project_dir = destination.join(format!("{framework}-{engine}-{protocol}"));
                    let path = project_dir.join(relative);
                    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                    std::fs::write(path, file.contents).unwrap();
                }
            }
        }
    }
}

fn file_contents<'a>(files: &'a [ProjectFile], path: &str) -> &'a str {
    files
        .iter()
        .find(|file| file.path == path)
        .map(|file| file.contents.as_str())
        .unwrap_or_else(|| panic!("missing generated file {path}"))
}
