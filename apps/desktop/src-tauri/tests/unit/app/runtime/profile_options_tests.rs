use super::*;
use crate::domain::models::SecretRef;

#[test]
fn interpolates_memcached_options_without_secret_values() {
    let options = MemcachedConnectionOptions {
        servers: vec!["{{CACHE_HOST}}:11211".into(), "cache-b:11211".into()],
        username: Some("{{CACHE_USER}}".into()),
        namespace_prefix: Some("{{CACHE_PREFIX}}:".into()),
        sasl_password_secret_ref: Some(SecretRef {
            id: "secret-memcached-sasl".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-memcached".into(),
            label: "Memcached SASL password".into(),
        }),
        request_timeout_ms: Some(15_000),
        ..MemcachedConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{CACHE_HOST}}", "cache-a")
            .replace("{{CACHE_USER}}", "worker")
            .replace("{{CACHE_PREFIX}}", "catalog")
    };

    let resolved = interpolate_memcached_options(&options, &interpolate);

    assert_eq!(
        resolved.servers,
        vec!["cache-a:11211".to_string(), "cache-b:11211".to_string()]
    );
    assert_eq!(resolved.username.as_deref(), Some("worker"));
    assert_eq!(resolved.namespace_prefix.as_deref(), Some("catalog:"));
    assert_eq!(resolved.request_timeout_ms, Some(15_000));
    assert_eq!(
        resolved
            .sasl_password_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-memcached-sasl")
    );
}

#[test]
fn interpolates_postgres_options_without_secret_values() {
    let options = PostgresConnectionOptions {
        connect_mode: Some("{{PG_MODE}}".into()),
        application_name: Some("{{APP_NAME}}".into()),
        search_path: Some("{{PG_SCHEMA}}, public".into()),
        target_session_attrs: Some("read-write".into()),
        connect_timeout_ms: Some(2_500),
        statement_timeout_ms: Some(5_000),
        use_tls: Some(true),
        verify_server_certificate: Some(true),
        ca_certificate_path: Some("{{PG_CERT_DIR}}/root.pem".into()),
        certificate_password_secret_ref: Some(SecretRef {
            id: "secret-postgres-cert".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-postgres".into(),
            label: "PostgreSQL certificate password".into(),
        }),
        cloud_sql_instance: Some("{{PG_INSTANCE}}".into()),
        cockroach_deployment_mode: Some("{{CRDB_DEPLOYMENT}}".into()),
        cockroach_organization: Some("{{CRDB_ORG}}".into()),
        cockroach_cluster_name: Some("{{CRDB_CLUSTER}}".into()),
        cockroach_cluster_id: Some("{{CRDB_CLUSTER_ID}}".into()),
        cockroach_cloud_region: Some("{{CRDB_REGION}}".into()),
        cockroach_default_region: Some("{{CRDB_DEFAULT_REGION}}".into()),
        cockroach_locality: Some("{{CRDB_LOCALITY}}".into()),
        cockroach_server_version: Some("{{CRDB_VERSION}}".into()),
        cockroach_build_tag: Some("{{CRDB_BUILD}}".into()),
        cockroach_auth_disabled_reason: Some("{{CRDB_AUTH_REASON}}".into()),
        cockroach_tls_disabled_reason: Some("{{CRDB_TLS_REASON}}".into()),
        cockroach_capabilities: Some(crate::domain::models::CockroachConnectionCapabilities {
            inspect_ranges: Some(false),
            ..Default::default()
        }),
        timescale_deployment_mode: Some("{{TS_DEPLOYMENT}}".into()),
        timescale_project: Some("{{TS_PROJECT}}".into()),
        timescale_service_id: Some("{{TS_SERVICE}}".into()),
        timescale_region: Some("{{TS_REGION}}".into()),
        timescale_extension_schema: Some("{{TS_SCHEMA}}".into()),
        timescale_extension_version: Some("{{TS_EXTENSION}}".into()),
        timescale_server_version: Some("{{TS_SERVER}}".into()),
        timescale_license: Some("{{TS_LICENSE}}".into()),
        timescale_policy_execution_disabled_reason: Some("{{TS_POLICY_REASON}}".into()),
        timescale_compression_disabled_reason: Some("{{TS_COMPRESSION_REASON}}".into()),
        timescale_retention_disabled_reason: Some("{{TS_RETENTION_REASON}}".into()),
        timescale_continuous_aggregate_disabled_reason: Some("{{TS_AGG_REASON}}".into()),
        timescale_capabilities: Some(crate::domain::models::TimescaleConnectionCapabilities {
            inspect_compression: Some(false),
            live_policy_execution: Some(false),
            ..Default::default()
        }),
        ..PostgresConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{PG_MODE}}", "cloud-sql-proxy")
            .replace("{{APP_NAME}}", "DataPad++ QA")
            .replace("{{PG_SCHEMA}}", "analytics")
            .replace("{{PG_CERT_DIR}}", "C:/certs")
            .replace("{{PG_INSTANCE}}", "project:region:instance")
            .replace("{{CRDB_DEPLOYMENT}}", "cockroach-cloud-dedicated")
            .replace("{{CRDB_ORG}}", "DataPad Labs")
            .replace("{{CRDB_CLUSTER}}", "analytics-crdb")
            .replace("{{CRDB_CLUSTER_ID}}", "crl-123")
            .replace("{{CRDB_REGION}}", "aws-us-east-1")
            .replace("{{CRDB_DEFAULT_REGION}}", "us-east")
            .replace("{{CRDB_LOCALITY}}", "region=us-east,az=a")
            .replace("{{CRDB_VERSION}}", "v24.3")
            .replace("{{CRDB_BUILD}}", "v24.3.5")
            .replace("{{CRDB_AUTH_REASON}}", "Auth mode is plan-only.")
            .replace("{{CRDB_TLS_REASON}}", "TLS verifier is plan-only.")
            .replace("{{TS_DEPLOYMENT}}", "timescale-cloud")
            .replace("{{TS_PROJECT}}", "DataPad Observability")
            .replace("{{TS_SERVICE}}", "tsdb-123")
            .replace("{{TS_REGION}}", "aws-us-east-1")
            .replace("{{TS_SCHEMA}}", "public")
            .replace("{{TS_EXTENSION}}", "2.15.0")
            .replace("{{TS_SERVER}}", "PostgreSQL 16")
            .replace("{{TS_LICENSE}}", "timescale")
            .replace("{{TS_POLICY_REASON}}", "Policy execution is preview-only.")
            .replace("{{TS_COMPRESSION_REASON}}", "Owner role required.")
            .replace("{{TS_RETENTION_REASON}}", "Retention can drop chunks.")
            .replace("{{TS_AGG_REASON}}", "Refresh is manually approved.")
    };

    let resolved = interpolate_postgres_options(&options, &interpolate);

    for (actual, expected) in [
        (resolved.connect_mode.as_deref(), "cloud-sql-proxy"),
        (resolved.application_name.as_deref(), "DataPad++ QA"),
        (resolved.search_path.as_deref(), "analytics, public"),
        (resolved.target_session_attrs.as_deref(), "read-write"),
        (resolved.ca_certificate_path.as_deref(), "C:/certs/root.pem"),
        (
            resolved.cloud_sql_instance.as_deref(),
            "project:region:instance",
        ),
        (
            resolved.cockroach_deployment_mode.as_deref(),
            "cockroach-cloud-dedicated",
        ),
        (resolved.cockroach_organization.as_deref(), "DataPad Labs"),
        (resolved.cockroach_cluster_name.as_deref(), "analytics-crdb"),
        (resolved.cockroach_cluster_id.as_deref(), "crl-123"),
        (resolved.cockroach_cloud_region.as_deref(), "aws-us-east-1"),
        (resolved.cockroach_default_region.as_deref(), "us-east"),
        (
            resolved.cockroach_locality.as_deref(),
            "region=us-east,az=a",
        ),
        (resolved.cockroach_server_version.as_deref(), "v24.3"),
        (resolved.cockroach_build_tag.as_deref(), "v24.3.5"),
        (
            resolved.cockroach_auth_disabled_reason.as_deref(),
            "Auth mode is plan-only.",
        ),
        (
            resolved.cockroach_tls_disabled_reason.as_deref(),
            "TLS verifier is plan-only.",
        ),
        (
            resolved.timescale_deployment_mode.as_deref(),
            "timescale-cloud",
        ),
        (
            resolved.timescale_project.as_deref(),
            "DataPad Observability",
        ),
        (resolved.timescale_service_id.as_deref(), "tsdb-123"),
        (resolved.timescale_region.as_deref(), "aws-us-east-1"),
        (resolved.timescale_extension_schema.as_deref(), "public"),
        (resolved.timescale_extension_version.as_deref(), "2.15.0"),
        (
            resolved.timescale_server_version.as_deref(),
            "PostgreSQL 16",
        ),
        (resolved.timescale_license.as_deref(), "timescale"),
        (
            resolved
                .timescale_policy_execution_disabled_reason
                .as_deref(),
            "Policy execution is preview-only.",
        ),
        (
            resolved.timescale_compression_disabled_reason.as_deref(),
            "Owner role required.",
        ),
        (
            resolved.timescale_retention_disabled_reason.as_deref(),
            "Retention can drop chunks.",
        ),
        (
            resolved
                .timescale_continuous_aggregate_disabled_reason
                .as_deref(),
            "Refresh is manually approved.",
        ),
    ] {
        assert_eq!(actual, Some(expected));
    }
    assert_eq!(resolved.connect_timeout_ms, Some(2_500));
    assert_eq!(resolved.statement_timeout_ms, Some(5_000));
    assert_eq!(resolved.use_tls, Some(true));
    assert_eq!(resolved.verify_server_certificate, Some(true));
    assert_eq!(
        resolved
            .cockroach_capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.inspect_ranges),
        Some(false)
    );
    assert_eq!(
        resolved
            .timescale_capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.inspect_compression),
        Some(false)
    );
    assert_eq!(
        resolved
            .timescale_capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.live_policy_execution),
        Some(false)
    );
    assert_eq!(
        resolved
            .certificate_password_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-postgres-cert")
    );
}
