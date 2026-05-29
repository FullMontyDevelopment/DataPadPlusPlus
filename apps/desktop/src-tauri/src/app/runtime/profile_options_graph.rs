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
mod tests {
    use super::*;
    use crate::domain::models::SecretRef;

    #[test]
    fn interpolates_graph_options_without_secret_values() {
        let options = GraphConnectionOptions {
            connect_mode: Some("neo4j-http".into()),
            endpoint_url: Some("http://{{NEO4J_HOST}}:7474".into()),
            database_name: Some("{{NEO4J_DATABASE}}".into()),
            username: Some("{{NEO4J_USER}}".into()),
            token_secret_ref: Some(SecretRef {
                id: "secret-neo4j-token".into(),
                provider: "os-keyring".into(),
                service: "DataPad++".into(),
                account: "conn-neo4j".into(),
                label: "Neo4j token".into(),
            }),
            fetch_size: Some(500),
            ..GraphConnectionOptions::default()
        };
        let interpolate = |value: &str| {
            value
                .replace("{{NEO4J_HOST}}", "localhost")
                .replace("{{NEO4J_DATABASE}}", "analytics")
                .replace("{{NEO4J_USER}}", "neo4j")
        };

        let resolved = interpolate_graph_options(&options, &interpolate);

        assert_eq!(
            resolved.endpoint_url.as_deref(),
            Some("http://localhost:7474")
        );
        assert_eq!(resolved.database_name.as_deref(), Some("analytics"));
        assert_eq!(resolved.username.as_deref(), Some("neo4j"));
        assert_eq!(resolved.fetch_size, Some(500));
        assert_eq!(
            resolved
                .token_secret_ref
                .as_ref()
                .map(|secret| secret.id.as_str()),
            Some("secret-neo4j-token")
        );
    }
}
