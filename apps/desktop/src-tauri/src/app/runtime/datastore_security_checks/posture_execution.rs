async fn execute_posture_probe(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    rule_id: &str,
    language: &str,
    query_text: &str,
) -> Result<Vec<Value>, CommandError> {
    let request = ExecutionRequest {
        execution_id: Some(generate_id("security-posture-probe")),
        tab_id: "security-checks".into(),
        connection_id: profile.id.clone(),
        environment_id: environment.id.clone(),
        language: language.into(),
        query_text: query_text.into(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(10),
        document_efficiency_mode: Some(true),
        confirmed_guardrail_id: None,
        builder_state: None,
    };
    let notices = vec![QueryExecutionNotice {
        code: "datastore-security-checks-posture-probe".into(),
        level: "info".into(),
        message: format!("Read-only datastore posture probe: {rule_id}."),
    }];

    adapters::execute(connection, &request, notices)
        .await
        .map(|result| result.payloads)
}

fn bool_probe_check_from_input(
    input: BoolProbeCheckInput<'_>,
) -> DatastoreSecurityPostureCheckResult {
    posture_check_from_input(PostureCheckInput {
        target_id: input.target_id,
        rule_id: input.rule_id,
        category: input.category,
        status: if input.risky {
            input.risky_status
        } else {
            "pass"
        },
        severity: if input.risky {
            input.risky_severity
        } else {
            "NONE"
        },
        title: if input.risky {
            input.risky_title
        } else {
            input.pass_title
        },
        summary: input.summary,
        evidence: Some(if input.risky {
            "The read-only probe found the risky setting or privilege.".into()
        } else {
            "The read-only probe did not find the risky setting or privilege.".into()
        }),
        remediation: input.remediation,
        source: "read-only-probe",
        references: input.references,
    })
}

fn probe_unknown(
    target_id: &str,
    rule_id: &str,
    category: &str,
    title: &str,
    error: CommandError,
    references: Vec<DatastoreSecurityFindingReference>,
) -> DatastoreSecurityPostureCheckResult {
    posture_check!(
        target_id,
        rule_id,
        category,
        "unknown",
        "UNKNOWN",
        title,
        "DataPad++ attempted a read-only posture probe, but the datastore or current account did not return usable posture data.",
        Some(safe_error_evidence(&error.message)),
        "Grant read-only metadata visibility if you want this rule to report pass/fail, or treat the unknown result as a manual review item.",
        "read-only-probe",
        references,
    )
}

fn posture_check_from_input(input: PostureCheckInput<'_>) -> DatastoreSecurityPostureCheckResult {
    DatastoreSecurityPostureCheckResult {
        id: format!(
            "posture-{}-{}",
            input.target_id,
            sanitize_rule_id(input.rule_id)
        ),
        target_ids: vec![input.target_id.into()],
        rule_id: input.rule_id.into(),
        category: input.category.into(),
        status: input.status.into(),
        severity: input.severity.into(),
        title: input.title.into(),
        summary: input.summary.into(),
        evidence: input.evidence,
        remediation: input.remediation.into(),
        source: input.source.into(),
        references: input.references,
    }
}

fn security_target_id(connection: &ConnectionProfile, environment: &EnvironmentProfile) -> String {
    format!("security-target-{}-{}", connection.id, environment.id)
}

fn normalized_engine_id(engine: &str) -> String {
    match engine.to_ascii_lowercase().as_str() {
        "cockroach" => "cockroachdb".into(),
        "mssql" => "sqlserver".into(),
        "arangodb" => "arango".into(),
        other => other.into(),
    }
}

fn sanitize_rule_id(rule_id: &str) -> String {
    rule_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

fn is_high_risk_environment(environment: &EnvironmentProfile) -> bool {
    matches!(environment.risk.as_str(), "high" | "critical")
}

fn connection_string_appears_to_embed_credentials(value: &str) -> bool {
    if Url::parse(value)
        .ok()
        .is_some_and(|url| !url.username().is_empty() || url.password().is_some())
    {
        return true;
    }

    let lower = value.to_ascii_lowercase();
    [
        "password=",
        "pwd=",
        "pass=",
        "accountkey=",
        "sharedaccesskey=",
        "access_key_id=",
        "secret_access_key=",
        "token=",
        "apikey=",
        "api_key=",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn connection_secret_refs(connection: &ConnectionProfile) -> Vec<&SecretRef> {
    let mut refs = Vec::new();
    if let Some(secret_ref) = connection.auth.secret_ref.as_ref() {
        refs.push(secret_ref);
    }
    if let Some(options) = connection.redis_options.as_ref() {
        refs.extend(options.certificate_password_secret_ref.as_ref());
        refs.extend(options.sentinel_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.memcached_options.as_ref() {
        refs.extend(options.sasl_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.sqlite_options.as_ref() {
        refs.extend(options.encryption_key_secret_ref.as_ref());
    }
    if let Some(options) = connection.postgres_options.as_ref() {
        refs.extend(options.certificate_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.mysql_options.as_ref() {
        refs.extend(options.certificate_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.sqlserver_options.as_ref() {
        refs.extend(options.service_principal_secret_ref.as_ref());
        refs.extend(options.aad_access_token_secret_ref.as_ref());
        refs.extend(options.certificate_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.oracle_options.as_ref() {
        refs.extend(options.wallet_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.dynamo_db_options.as_ref() {
        refs.extend(options.secret_access_key_ref.as_ref());
        refs.extend(options.session_token_ref.as_ref());
    }
    if let Some(options) = connection.cassandra_options.as_ref() {
        refs.extend(options.certificate_password_secret_ref.as_ref());
    }
    if let Some(options) = connection.cosmos_db_options.as_ref() {
        refs.extend(options.account_key_secret_ref.as_ref());
        refs.extend(options.resource_token_secret_ref.as_ref());
    }
    if let Some(options) = connection.search_options.as_ref() {
        refs.extend(options.api_key_secret_ref.as_ref());
        refs.extend(options.bearer_token_secret_ref.as_ref());
        refs.extend(options.service_token_secret_ref.as_ref());
    }
    if let Some(options) = connection.time_series_options.as_ref() {
        refs.extend(options.token_secret_ref.as_ref());
        refs.extend(options.custom_header_secret_ref.as_ref());
    }
    if let Some(options) = connection.graph_options.as_ref() {
        refs.extend(options.token_secret_ref.as_ref());
    }
    if let Some(options) = connection.warehouse_options.as_ref() {
        refs.extend(options.token_secret_ref.as_ref());
        refs.extend(options.service_account_key_secret_ref.as_ref());
        refs.extend(options.client_secret_ref.as_ref());
    }
    refs
}

fn option_bool_label(value: Option<bool>) -> &'static str {
    match value {
        Some(true) => "true",
        Some(false) => "false",
        None => "unspecified",
    }
}

fn safe_error_evidence(message: &str) -> String {
    let sanitized = message
        .split_whitespace()
        .take(28)
        .collect::<Vec<_>>()
        .join(" ");
    if sanitized.is_empty() {
        "Probe failed without a detailed error.".into()
    } else {
        format!("Probe failed: {sanitized}")
    }
}

fn payload_bool(payloads: &[Value], keys: &[&str]) -> Option<bool> {
    payload_value(payloads, keys).and_then(value_as_bool)
}

fn payload_text_field(payloads: &[Value], keys: &[&str]) -> Option<String> {
    payload_value(payloads, keys).and_then(value_as_string)
}

fn payload_value<'a>(payloads: &'a [Value], keys: &[&str]) -> Option<&'a Value> {
    for payload in payloads {
        if let Some(value) = find_value_by_keys(payload, keys) {
            return Some(value);
        }
    }
    None
}

fn find_value_by_keys<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if keys
                    .iter()
                    .any(|candidate| key.eq_ignore_ascii_case(candidate))
                {
                    return Some(value);
                }
            }
            map.values()
                .find_map(|value| find_value_by_keys(value, keys))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|value| find_value_by_keys(value, keys)),
        _ => None,
    }
}

fn value_as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "on" | "yes" | "enabled" => Some(true),
            "0" | "false" | "off" | "no" | "disabled" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn payload_text(payloads: &[Value]) -> String {
    payloads
        .iter()
        .map(|payload| match payload {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn posture_status_rank(status: &str) -> u8 {
    match status {
        "fail" => 4,
        "warn" => 3,
        "unknown" => 2,
        "pass" => 1,
        _ => 0,
    }
}

