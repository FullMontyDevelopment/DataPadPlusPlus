use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "dotnet-postgresql-dapper",
    framework: "dotnet",
    engine: "postgresql",
    client_label: "Dapper / Npgsql",
    configuration_key: "ConnectionStrings__Datastore",
    configuration_example: "Host=localhost;Port=5432;Database=app;Username=app;Password=change-me",
    additional_configuration: &[],
    safety_note: "SQL identifiers are generated from validated resource metadata and all request values are bound parameters. Custom endpoints contain one read-only statement and keep their configured row limit.",
    rust_version: "1.89",
    sql: Some(ProjectExportSqlClientHooks {
        supports_schema: true,
        batch_dialect: crate::adapters::SqlBatchDialect::Postgres,
        quote_identifier: quote_ansi_identifier,
        select_expression: postgres_select_expression,
        parameter_placeholder: dotnet_parameter,
    }),
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![
        ProjectDependency {
            package: "Dapper".into(),
            version: "2.1.79".into(),
            declaration: "<PackageReference Include=\"Dapper\" />".into(),
            build: false,
        },
        ProjectDependency {
            package: "Npgsql".into(),
            version: "10.0.3".into(),
            declaration: "<PackageReference Include=\"Npgsql\" />".into(),
            build: false,
        },
    ]
}

fn render_client_files(
    spec: &ProjectExportSpec,
    adapter: &ProjectExportClientAdapter,
) -> Vec<ProjectFile> {
    dotnet_common::render_client_files(
        spec,
        adapter,
        dotnet_common::DotnetClientProfile {
            provider_namespace: "Npgsql",
            factory_body: "var dataSource = NpgsqlDataSource.Create(connectionString);\n        return new NpgsqlConnectionFactory(dataSource);",
            factory_definition: "public sealed class NpgsqlConnectionFactory(NpgsqlDataSource dataSource) : IDatastoreConnectionFactory, IAsyncDisposable\n{\n    public DbConnection CreateConnection() => dataSource.CreateConnection();\n    public ValueTask DisposeAsync() => dataSource.DisposeAsync();\n}",
        },
    )
}
