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
#[path = "../../../tests/unit/app/runtime/profile_options_warehouse_tests.rs"]
mod tests;
