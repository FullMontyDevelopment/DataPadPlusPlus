use super::*;
use crate::domain::models::SecretRef;

#[test]
fn interpolates_warehouse_options_without_secret_values() {
    let options = WarehouseConnectionOptions {
        endpoint_url: Some("http://{{WAREHOUSE_HOST}}:8123/proxy".into()),
        database_name: Some("{{WAREHOUSE_DATABASE}}".into()),
        schema_name: Some("{{WAREHOUSE_SCHEMA}}".into()),
        project_id: Some("{{GCP_PROJECT}}".into()),
        extensions: vec!["{{DUCKDB_EXTENSION}}".into(), "parquet".into()],
        token_secret_ref: Some(SecretRef {
            id: "secret-warehouse-token".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-warehouse".into(),
            label: "Warehouse token".into(),
        }),
        max_rows: Some(10_000),
        ..WarehouseConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{WAREHOUSE_HOST}}", "localhost")
            .replace("{{WAREHOUSE_DATABASE}}", "analytics")
            .replace("{{WAREHOUSE_SCHEMA}}", "public")
            .replace("{{GCP_PROJECT}}", "project-qa")
            .replace("{{DUCKDB_EXTENSION}}", "httpfs")
    };

    let resolved = interpolate_warehouse_options(&options, &interpolate);

    assert_eq!(
        resolved.endpoint_url.as_deref(),
        Some("http://localhost:8123/proxy")
    );
    assert_eq!(resolved.database_name.as_deref(), Some("analytics"));
    assert_eq!(resolved.schema_name.as_deref(), Some("public"));
    assert_eq!(resolved.project_id.as_deref(), Some("project-qa"));
    assert_eq!(resolved.extensions, vec!["httpfs", "parquet"]);
    assert_eq!(
        resolved
            .token_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-warehouse-token")
    );
    assert_eq!(resolved.max_rows, Some(10_000));
}
