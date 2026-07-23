use std::fmt::Write as _;

use super::*;

pub(crate) static RENDERER: ProjectExportFrameworkRenderer = ProjectExportFrameworkRenderer {
    framework: "dotnet",
    dependencies,
    render,
};

fn dependencies(spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    let mut dependencies = Vec::new();
    if spec.protocol == "rest" {
        dependencies.push(dependency(
            "Microsoft.AspNetCore.OpenApi",
            "10.0.10",
            "<PackageReference Include=\"Microsoft.AspNetCore.OpenApi\" />",
        ));
        dependencies.push(dependency(
            "Microsoft.OpenApi",
            "2.11.0",
            "<PackageReference Include=\"Microsoft.OpenApi\" />",
        ));
    }
    if spec.protocol == "graphql" {
        dependencies.push(dependency(
            "HotChocolate.AspNetCore",
            "15.1.14",
            "<PackageReference Include=\"HotChocolate.AspNetCore\" />",
        ));
    }
    if spec.protocol == "grpc" {
        dependencies.push(dependency(
            "Grpc.AspNetCore",
            "2.67.0",
            "<PackageReference Include=\"Grpc.AspNetCore\" />",
        ));
        dependencies.push(dependency(
            "Grpc.Tools",
            "2.67.0",
            "<PackageReference Include=\"Grpc.Tools\" PrivateAssets=\"All\" />",
        ));
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
        project_file(
            &root,
            &format!("{}.csproj", spec.project_name),
            project_file_source(spec),
        ),
        project_file(&root, "Directory.Packages.props", directory_packages(spec)),
        project_file(&root, ".env.example", common::env_example(spec)),
        project_file(&root, "README.md", common::project_readme(spec)),
        project_file(
            &root,
            "datapad-api-export.json",
            common::project_manifest(spec),
        ),
        project_file(&root, "Program.cs", program(spec)),
        project_file(&root, "Models.cs", models(spec)),
    ];
    files.extend((adapter.render_client_files)(spec, adapter));
    if spec.protocol == "graphql" {
        files.push(project_file(&root, "GraphQlTypes.cs", graphql_types(spec)));
    }
    if spec.protocol == "grpc" {
        files.push(project_file(&root, "Services.cs", grpc_services(spec)));
        files.push(project_file(
            &root,
            "Protos/datapad_api.proto",
            common::grpc_proto(spec),
        ));
    }
    files
}

fn project_file_source(spec: &ProjectExportSpec) -> String {
    let packages = spec
        .dependencies
        .iter()
        .map(|dependency| format!("    {}", dependency.declaration))
        .collect::<Vec<_>>()
        .join("\n");
    let proto = if spec.protocol == "grpc" {
        "\n  <ItemGroup>\n    <Protobuf Include=\"Protos\\datapad_api.proto\" GrpcServices=\"Server\" />\n  </ItemGroup>\n"
    } else {
        ""
    };
    format!(
        "<Project Sdk=\"Microsoft.NET.Sdk.Web\">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>\n    <PackageProjectUrl>https://datapad-plus-plus.org/</PackageProjectUrl>\n  </PropertyGroup>\n\n  <ItemGroup>\n{packages}\n  </ItemGroup>\n{proto}</Project>\n"
    )
}

fn directory_packages(spec: &ProjectExportSpec) -> String {
    let versions = spec
        .dependencies
        .iter()
        .map(|dependency| {
            format!(
                "    <PackageVersion Include=\"{}\" Version=\"{}\" />",
                dependency.package, dependency.version
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n{versions}\n  </ItemGroup>\n</Project>\n"
    )
}

fn program(spec: &ProjectExportSpec) -> String {
    match spec.protocol.as_str() {
        "graphql" => graphql_program(spec),
        "grpc" => grpc_program(spec),
        _ => rest_program(spec),
    }
}

fn program_prelude(spec: &ProjectExportSpec) -> String {
    format!(
        "using System.Text.Json;\nusing Microsoft.AspNetCore.Diagnostics;\nusing Microsoft.AspNetCore.Mvc;\nusing {};\n\n",
        spec.namespace
    )
}

fn common_host_setup() -> &'static str {
    r#"builder.Services.AddProblemDetails();
builder.Services.AddDatastoreClient(builder.Configuration);
"#
}

fn exception_pipeline() -> &'static str {
    r#"app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var repositoryError = error as RepositoryException;
    var status = repositoryError?.Kind switch
    {
        "invalid" => StatusCodes.Status400BadRequest,
        "not-found" => StatusCodes.Status404NotFound,
        "unavailable" => StatusCodes.Status503ServiceUnavailable,
        _ => StatusCodes.Status500InternalServerError,
    };
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new ProblemDetails
    {
        Status = status,
        Title = repositoryError?.Message ?? "The datastore operation failed.",
        Type = repositoryError?.Kind,
    });
}));
"#
}

fn startup_validation_and_health() -> &'static str {
    r#"await using (var scope = app.Services.CreateAsyncScope())
{
    await scope.ServiceProvider.GetRequiredService<DatastoreRepository>().PingAsync();
}
app.MapGet("/health", async (DatastoreRepository repository) =>
{
    await repository.PingAsync();
    return TypedResults.Ok(new { ok = true, datastoreConnected = true });
});
"#
}

fn rest_program(spec: &ProjectExportSpec) -> String {
    let mut routes = String::new();
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        let path = csharp_string_literal(&resource.endpoint_path);
        let _ = writeln!(
            routes,
            "api.MapGet({path}, async (DatastoreRepository repository, int? limit) => TypedResults.Ok(await repository.Search{base}Async(limit ?? 100)));"
        );
        if resource.mode == ProjectResourceMode::Crud {
            let _ = writeln!(
                routes,
                "api.MapPost({path}, async (DatastoreRepository repository, MutationBody body) => TypedResults.Ok(await repository.Create{base}Async(body.Values ?? JsonSerializer.SerializeToElement(new {{ }}))));"
            );
        }
        if !resource.primary_fields.is_empty() {
            let identity_path =
                csharp_string_literal(&format!("{}/{{identity}}", resource.endpoint_path));
            let _ = writeln!(
                routes,
                "api.MapGet({identity_path}, async (DatastoreRepository repository, string identity) => TypedResults.Ok(await repository.Get{base}Async(identity)));"
            );
            if resource.mode == ProjectResourceMode::Crud {
                let _ = writeln!(
                    routes,
                    "api.MapPatch({identity_path}, async (DatastoreRepository repository, string identity, MutationBody body) => TypedResults.Ok(await repository.Update{base}Async(identity, body.Values ?? JsonSerializer.SerializeToElement(new {{ }}))));"
                );
                let _ = writeln!(
                    routes,
                    "api.MapDelete({identity_path}, async (DatastoreRepository repository, string identity) => TypedResults.Ok(await repository.Delete{base}Async(identity)));"
                );
            }
        }
    }
    for endpoint in &spec.custom_endpoints {
        let name = pascal_case(&endpoint.function_name);
        let path = csharp_string_literal(&endpoint.endpoint_path);
        if endpoint.method == "POST" {
            let _ = writeln!(
                routes,
                "api.MapPost({path}, async (DatastoreRepository repository, JsonElement body) => TypedResults.Ok(await repository.Run{name}Async(body)));"
            );
        } else {
            let _ = writeln!(
                routes,
                "api.MapGet({path}, async (DatastoreRepository repository, HttpRequest request) => TypedResults.Ok(await repository.Run{name}Async(JsonSerializer.SerializeToElement(request.Query.ToDictionary(item => item.Key, item => item.Value.ToString())))));"
            );
        }
    }
    format!(
        r#"{prelude}var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
{services}
var app = builder.Build();
{exception_pipeline}
{health}
if (app.Environment.IsDevelopment())
{{
    app.MapOpenApi();
}}

var api = app.MapGroup("");
{routes}
app.Run();

public sealed record MutationBody(
    JsonElement? Values,
    JsonElement? Identity,
    JsonElement[]? Changes,
    string? ConfirmationText);
"#,
        prelude = program_prelude(spec),
        services = common_host_setup(),
        exception_pipeline = exception_pipeline(),
        health = startup_validation_and_health(),
        routes = routes,
    )
}

fn graphql_program(spec: &ProjectExportSpec) -> String {
    let mutation_registration = if spec
        .resources
        .iter()
        .any(|resource| resource.mode == ProjectResourceMode::Crud)
    {
        "\n    .AddMutationType<Mutation>()"
    } else {
        ""
    };
    format!(
        r#"{prelude}var builder = WebApplication.CreateBuilder(args);
{services}builder.Services
    .AddGraphQLServer()
    .AddQueryType<Query>(){mutation_registration};

var app = builder.Build();
{exception_pipeline}{health}app.MapGraphQL();
app.Run();
"#,
        prelude = program_prelude(spec),
        services = common_host_setup(),
        exception_pipeline = exception_pipeline(),
        health = startup_validation_and_health(),
        mutation_registration = mutation_registration,
    )
}

fn grpc_program(spec: &ProjectExportSpec) -> String {
    let services = spec
        .resources
        .iter()
        .map(|resource| format!("app.MapGrpcService<{}ServiceImpl>();", resource.model_name))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"{prelude}var builder = WebApplication.CreateBuilder(args);
{host_services}builder.Services.AddGrpc();

var app = builder.Build();
{exception_pipeline}{health}{services}
app.MapGet("/", () => "gRPC endpoint. Use a gRPC client with Protos/datapad_api.proto.");
app.Run();
"#,
        prelude = program_prelude(spec),
        host_services = common_host_setup(),
        exception_pipeline = exception_pipeline(),
        health = startup_validation_and_health(),
        services = services,
    )
}

fn models(spec: &ProjectExportSpec) -> String {
    let document_import = if spec
        .resources
        .iter()
        .any(|resource| resource.shape.is_document())
    {
        "using System.Text.Json;\n"
    } else {
        ""
    };
    let mut output = format!(
        "{}using System.Text.Json.Serialization;\n{}\nnamespace {};\n\n",
        document_import,
        if spec.protocol == "graphql" {
            "using HotChocolate.Types;\n"
        } else {
            ""
        },
        spec.namespace
    );
    for resource in &spec.resources {
        if resource.shape.is_document() {
            output.push_str(&document_model(resource, &spec.protocol));
            continue;
        }
        let _ = writeln!(output, "public sealed class {}\n{{", resource.model_name);
        for field in &resource.fields {
            let default = if field.csharp_type == "string" {
                " = string.Empty;"
            } else {
                ""
            };
            let _ = writeln!(
                output,
                "    [JsonPropertyName({})]\n    public {} {} {{ get; set; }}{}\n",
                csharp_string_literal(&field.json_name),
                field.csharp_type,
                field.csharp_name,
                default
            );
        }
        output.push_str("}\n\n");
        if spec.protocol == "graphql" && resource.mode == ProjectResourceMode::Crud {
            let _ = writeln!(
                output,
                "public sealed class {}Input\n{{",
                resource.model_name
            );
            for field in &resource.fields {
                let _ = writeln!(
                    output,
                    "    [JsonPropertyName({})]\n    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]\n    public {}? {} {{ get; set; }}\n",
                    csharp_string_literal(&field.json_name),
                    field.csharp_base_type,
                    field.csharp_name,
                );
            }
            output.push_str("}\n\n");
        }
    }
    output
}

fn document_model(resource: &ProjectResourceModel, protocol: &str) -> String {
    let mut output = String::new();
    let _ = writeln!(output, "public sealed class {}\n{{", resource.model_name);
    if protocol == "graphql" {
        output.push_str(
            "    [GraphQLType(typeof(AnyType))]\n    public JsonElement Document { get; set; }\n\n",
        );
        for field in &resource.fields {
            let annotation = if field.csharp_base_type == "System.Text.Json.JsonElement" {
                "    [GraphQLType(typeof(AnyType))]\n"
            } else {
                ""
            };
            let _ = writeln!(
                output,
                "{annotation}    [JsonPropertyName({json_name})]\n    public {field_type} {field_name} {{ get; set; }}\n",
                annotation = annotation,
                json_name = csharp_string_literal(&field.json_name),
                field_type = field.csharp_type,
                field_name = field.csharp_name,
            );
        }
        let _ = writeln!(
            output,
            "    public static {} FromDocument(JsonElement document)\n    {{\n        return new {}",
            resource.model_name, resource.model_name
        );
        output.push_str("        {\n            Document = document.Clone(),\n");
        for field in &resource.fields {
            let projection = dotnet_document_projection(field);
            let _ = writeln!(
                output,
                "            {} = {},",
                field.csharp_name, projection
            );
        }
        output.push_str("        };\n    }\n}\n\n");
        if resource.mode == ProjectResourceMode::Crud {
            let _ = writeln!(
                output,
                "public sealed class {}Input\n{{\n    [GraphQLType(typeof(AnyType))]\n    public JsonElement Document {{ get; set; }}\n}}\n",
                resource.model_name
            );
        }
    } else {
        output.push_str("    public JsonElement Document { get; set; }\n}\n\n");
    }
    output
}

fn dotnet_document_projection(field: &ProjectFieldModel) -> String {
    let name = csharp_string_literal(&field.json_name);
    match field.csharp_base_type.as_str() {
        "string" => format!(
            "document.TryGetProperty({name}, out var {field}) && {field}.ValueKind == JsonValueKind.String ? {field}.GetString() : null",
            field = field.csharp_name.to_ascii_lowercase()
        ),
        "bool" => format!(
            "document.TryGetProperty({name}, out var {field}) && {field}.ValueKind is JsonValueKind.True or JsonValueKind.False ? {field}.GetBoolean() : null",
            field = field.csharp_name.to_ascii_lowercase()
        ),
        "int" => format!(
            "document.TryGetProperty({name}, out var {field}) && {field}.TryGetInt32(out var parsed{field}) ? parsed{field} : null",
            field = field.csharp_name
        ),
        "long" => format!(
            "document.TryGetProperty({name}, out var {field}) && {field}.TryGetInt64(out var parsed{field}) ? parsed{field} : null",
            field = field.csharp_name
        ),
        "double" => format!(
            "document.TryGetProperty({name}, out var {field}) && {field}.TryGetDouble(out var parsed{field}) ? parsed{field} : null",
            field = field.csharp_name
        ),
        _ => format!(
            "document.TryGetProperty({name}, out var {field}) ? {field}.Clone() : null",
            field = field.csharp_name.to_ascii_lowercase()
        ),
    }
}

fn graphql_types(spec: &ProjectExportSpec) -> String {
    let mut query = format!(
        "namespace {};\n\npublic sealed class Query\n{{\n",
        spec.namespace
    );
    let mut mutation = String::from("public sealed class Mutation\n{\n");
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        let _ = writeln!(
            query,
            "    public Task<IReadOnlyList<{model}>> {base}(DatastoreRepository repository, int? limit) => repository.Search{base}Async(limit ?? 100);",
            model = resource.model_name
        );
        if resource.mode == ProjectResourceMode::Crud {
            let create_value = if resource.shape.is_document() {
                "values.Document"
            } else {
                "System.Text.Json.JsonSerializer.SerializeToElement(values)"
            };
            let _ = writeln!(
                mutation,
                "    public Task<{model}> Create{base}(DatastoreRepository repository, {model}Input values) => repository.Create{base}Async({create_value});",
                model = resource.model_name,
                create_value = create_value,
            );
        }
    }
    query.push_str("}\n\n");
    mutation.push_str("}\n");
    format!("{query}{mutation}")
}

fn grpc_services(spec: &ProjectExportSpec) -> String {
    let mut output = format!(
        "using System.Text.Json;\nusing Grpc.Core;\nusing {}.Grpc;\n\nnamespace {};\n\n",
        spec.namespace, spec.namespace
    );
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        let _ = write!(
            output,
            r#"public sealed class {model}ServiceImpl(DatastoreRepository repository)
    : {model}Service.{model}ServiceBase
{{
    public override async Task<JsonResponse> Search(
        SearchRequest request,
        ServerCallContext context)
    {{
        try
        {{
            var rows = await repository.Search{base}Async((int)Math.Max(request.Limit, 1u));
            return new JsonResponse {{ Json = JsonSerializer.Serialize(rows) }};
        }}
        catch (RepositoryException error)
        {{
            throw new RpcException(new Status(
                error.Kind == "invalid" ? StatusCode.InvalidArgument : StatusCode.Internal,
                error.Message));
        }}
    }}
}}

"#,
            model = resource.model_name,
            base = base,
        );
    }
    output
}
