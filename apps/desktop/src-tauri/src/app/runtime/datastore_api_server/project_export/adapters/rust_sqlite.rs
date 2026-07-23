use super::*;

pub(crate) static ADAPTER: ProjectExportClientAdapter = ProjectExportClientAdapter {
    id: "rust-sqlite-sqlx",
    framework: "rust",
    engine: "sqlite",
    client_label: "SQLx / SQLite",
    configuration_key: "DATABASE_URL",
    configuration_example: "sqlite://data/app.sqlite?mode=rwc",
    additional_configuration: &[],
    safety_note: "SQL identifiers are generated from validated resource metadata and all request values are bound parameters. Custom endpoints contain one read-only statement and keep their configured row limit.",
    rust_version: "1.89",
    sql: Some(ProjectExportSqlClientHooks {
        supports_schema: false,
        batch_dialect: crate::adapters::SqlBatchDialect::Standard,
        quote_identifier: quote_ansi_identifier,
        select_expression: sqlite_select_expression,
        parameter_placeholder: sqlite_parameter,
    }),
    dependencies,
    render_client_files,
};

fn dependencies(_spec: &ProjectExportSpec) -> Vec<ProjectDependency> {
    vec![ProjectDependency {
        package: "sqlx".into(),
        version: "0.9.0".into(),
        declaration: "sqlx = { version = \"=0.9.0\", default-features = false, features = [\"runtime-tokio\", \"sqlite\", \"derive\", \"json\", \"chrono\", \"uuid\"] }".into(),
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
            database_type: "sqlx::Sqlite",
            pool_type: "sqlx::SqlitePool",
            pool_options_type: "sqlx::sqlite::SqlitePoolOptions",
            row_type: "sqlx::sqlite::SqliteRow",
        },
    )
}
