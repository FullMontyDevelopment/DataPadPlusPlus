use crate::domain::models::TimeSeriesConnectionOptions;

pub(super) fn interpolate_timeseries_options(
    options: &TimeSeriesConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> TimeSeriesConnectionOptions {
    TimeSeriesConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        endpoint_url: options.endpoint_url.as_deref().map(interpolate),
        path_prefix: options.path_prefix.as_deref().map(interpolate),
        organization: options.organization.as_deref().map(interpolate),
        bucket: options.bucket.as_deref().map(interpolate),
        database_name: options.database_name.as_deref().map(interpolate),
        retention_policy: options.retention_policy.as_deref().map(interpolate),
        default_metric: options.default_metric.as_deref().map(interpolate),
        default_range: options.default_range.as_deref().map(interpolate),
        default_step: options.default_step.as_deref().map(interpolate),
        default_query_language: options.default_query_language.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        username: options.username.as_deref().map(interpolate),
        token_secret_ref: options.token_secret_ref.clone(),
        custom_header_name: options.custom_header_name.as_deref().map(interpolate),
        custom_header_secret_ref: options.custom_header_secret_ref.clone(),
        tenant_header_name: options.tenant_header_name.as_deref().map(interpolate),
        tenant_id: options.tenant_id.as_deref().map(interpolate),
        verify_certificates: options.verify_certificates,
        use_tls: options.use_tls,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        query_timeout_ms: options.query_timeout_ms,
        max_series: options.max_series,
        max_data_points: options.max_data_points,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/profile_options_timeseries_tests.rs"]
mod tests;
