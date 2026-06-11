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
