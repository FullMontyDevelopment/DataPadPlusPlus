use super::*;
use crate::domain::models::SecretRef;

#[test]
fn interpolates_timeseries_options_without_secret_values() {
    let options = TimeSeriesConnectionOptions {
        connect_mode: Some("influx-v2".into()),
        endpoint_url: Some("http://{{INFLUX_HOST}}:8086".into()),
        organization: Some("{{INFLUX_ORG}}".into()),
        bucket: Some("{{INFLUX_BUCKET}}".into()),
        token_secret_ref: Some(SecretRef {
            id: "secret-influx-token".into(),
            provider: "os-keyring".into(),
            service: "DataPad++".into(),
            account: "conn-influx".into(),
            label: "InfluxDB token".into(),
        }),
        query_timeout_ms: Some(120_000),
        ..TimeSeriesConnectionOptions::default()
    };
    let interpolate = |value: &str| {
        value
            .replace("{{INFLUX_HOST}}", "localhost")
            .replace("{{INFLUX_ORG}}", "qa")
            .replace("{{INFLUX_BUCKET}}", "telemetry")
    };

    let resolved = interpolate_timeseries_options(&options, &interpolate);

    assert_eq!(
        resolved.endpoint_url.as_deref(),
        Some("http://localhost:8086")
    );
    assert_eq!(resolved.organization.as_deref(), Some("qa"));
    assert_eq!(resolved.bucket.as_deref(), Some("telemetry"));
    assert_eq!(resolved.query_timeout_ms, Some(120_000));
    assert_eq!(
        resolved
            .token_secret_ref
            .as_ref()
            .map(|secret| secret.id.as_str()),
        Some("secret-influx-token")
    );
}
