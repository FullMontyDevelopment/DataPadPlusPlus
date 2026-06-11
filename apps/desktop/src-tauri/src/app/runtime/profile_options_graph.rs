use crate::domain::models::GraphConnectionOptions;

pub(super) fn interpolate_graph_options(
    options: &GraphConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> GraphConnectionOptions {
    GraphConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        endpoint_url: options.endpoint_url.as_deref().map(interpolate),
        path_prefix: options.path_prefix.as_deref().map(interpolate),
        database_name: options.database_name.as_deref().map(interpolate),
        traversal_source: options.traversal_source.as_deref().map(interpolate),
        graph_name: options.graph_name.as_deref().map(interpolate),
        default_query_language: options.default_query_language.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        username: options.username.as_deref().map(interpolate),
        token_secret_ref: options.token_secret_ref.clone(),
        aws_region: options.aws_region.as_deref().map(interpolate),
        aws_profile_name: options.aws_profile_name.as_deref().map(interpolate),
        aws_role_arn: options.aws_role_arn.as_deref().map(interpolate),
        use_iam_auth: options.use_iam_auth,
        verify_certificates: options.verify_certificates,
        use_tls: options.use_tls,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        query_timeout_ms: options.query_timeout_ms,
        fetch_size: options.fetch_size,
        explain_by_default: options.explain_by_default,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/profile_options_graph_tests.rs"]
mod tests;
