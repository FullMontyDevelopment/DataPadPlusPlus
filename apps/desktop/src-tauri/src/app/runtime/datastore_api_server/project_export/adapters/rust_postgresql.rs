use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "rust-postgresql-sqlx",
    framework: "rust",
    engine: "postgresql",
    client_label: "SQLx / PostgreSQL",
    configuration_key: "DATABASE_URL",
    configuration_example: "postgres://user:password@localhost:5432/database",
    additional_configuration: &[],
    safety_note: "SQL identifiers are generated from validated resource metadata and all request values are bound parameters. Custom endpoints contain one read-only statement and keep their configured row limit.",
    rust_version: "1.89",
    sql: Some(ProjectExportSqlClientHooks {
        supports_schema: true,
        batch_dialect: crate::adapters::SqlBatchDialect::Postgres,
        quote_identifier: quote_ansi_identifier,
        select_expression: postgres_select_expression,
        parameter_placeholder: postgres_parameter,
    }),
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![ProjectDependency {
        package: "sqlx".into(),
        version: "0.9.0".into(),
        declaration: "sqlx = { version = \"=0.9.0\", default-features = false, features = [\"runtime-tokio\", \"tls-rustls-ring\", \"postgres\", \"derive\", \"json\", \"chrono\", \"uuid\"] }".into(),
        build: false,
    }]
}

fn render_client_files(
    spec: &ProjectExportSpec,
    adapter: &ProjectExportClientAdapter,
) -> Vec<ProjectFile> {
    rust_common::render_client_files(
        spec,
        adapter,
        rust_common::SqlxClientProfile {
            database_type: "sqlx::Postgres",
            pool_type: "sqlx::PgPool",
            pool_options_type: "sqlx::postgres::PgPoolOptions",
            row_type: "sqlx::postgres::PgRow",
        },
    )
}
