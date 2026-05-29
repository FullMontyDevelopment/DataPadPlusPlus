use crate::domain::models::WarehouseConnectionOptions;

pub(super) fn interpolate_warehouse_options(
    options: &WarehouseConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> WarehouseConnectionOptions {
    WarehouseConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        endpoint_url: options.endpoint_url.as_deref().map(interpolate),
        path_prefix: options.path_prefix.as_deref().map(interpolate),
        account_name: options.account_name.as_deref().map(interpolate),
        project_id: options.project_id.as_deref().map(interpolate),
        dataset_id: options.dataset_id.as_deref().map(interpolate),
        database_name: options.database_name.as_deref().map(interpolate),
        schema_name: options.schema_name.as_deref().map(interpolate),
        warehouse_name: options.warehouse_name.as_deref().map(interpolate),
        role_name: options.role_name.as_deref().map(interpolate),
        catalog_name: options.catalog_name.as_deref().map(interpolate),
        region: options.region.as_deref().map(interpolate),
        location: options.location.as_deref().map(interpolate),
        file_path: options.file_path.as_deref().map(interpolate),
        temp_directory: options.temp_directory.as_deref().map(interpolate),
        memory_limit: options.memory_limit.as_deref().map(interpolate),
        extensions: options
            .extensions
            .iter()
            .map(|extension| interpolate(extension))
            .collect(),
        default_query_language: options.default_query_language.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        username: options.username.as_deref().map(interpolate),
        token_secret_ref: options.token_secret_ref.clone(),
        service_account_key_secret_ref: options.service_account_key_secret_ref.clone(),
        client_id: options.client_id.as_deref().map(interpolate),
        client_secret_ref: options.client_secret_ref.clone(),
        profile_name: options.profile_name.as_deref().map(interpolate),
        use_tls: options.use_tls,
        verify_certificates: options.verify_certificates,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        query_timeout_ms: options.query_timeout_ms,
        max_rows: options.max_rows,
        threads: options.threads,
        dry_run_by_default: options.dry_run_by_default,
        explain_by_default: options.explain_by_default,
        cost_limit_usd: options.cost_limit_usd,
    }
}

#[cfg(test)]
mod tests {
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
}
