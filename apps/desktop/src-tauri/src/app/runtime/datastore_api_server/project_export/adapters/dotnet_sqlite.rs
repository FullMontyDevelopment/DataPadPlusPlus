use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "dotnet-sqlite-dapper",
    framework: "dotnet",
    engine: "sqlite",
    client_label: "Dapper / Microsoft.Data.Sqlite",
    configuration_key: "ConnectionStrings__Datastore",
    configuration_example: "Data Source=data/app.sqlite;Mode=ReadWriteCreate",
    additional_configuration: &[],
    safety_note: "SQL identifiers are generated from validated resource metadata and all request values are bound parameters. Custom endpoints contain one read-only statement and keep their configured row limit.",
    rust_version: "1.89",
    sql: Some(ProjectExportSqlClientHooks {
        supports_schema: false,
        batch_dialect: crate::adapters::SqlBatchDialect::Standard,
        quote_identifier: quote_ansi_identifier,
        select_expression: sqlite_select_expression,
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
            package: "Microsoft.Data.Sqlite".into(),
            version: "10.0.10".into(),
            declaration: "<PackageReference Include=\"Microsoft.Data.Sqlite\" />".into(),
            build: false,
        },
        ProjectDependency {
            package: "SQLitePCLRaw.lib.e_sqlite3".into(),
            version: "2.1.12".into(),
            declaration: "<PackageReference Include=\"SQLitePCLRaw.lib.e_sqlite3\" />".into(),
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
            provider_namespace: "Microsoft.Data.Sqlite",
            factory_body: "return new SqliteConnectionFactory(connectionString);",
            factory_definition: "public sealed class SqliteConnectionFactory(string connectionString) : IDatastoreConnectionFactory\n{\n    public DbConnection CreateConnection() => new SqliteConnection(connectionString);\n}",
        },
    )
}
