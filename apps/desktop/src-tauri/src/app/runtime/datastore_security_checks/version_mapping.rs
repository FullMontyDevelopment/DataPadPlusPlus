async fn detect_target(
    runtime: &ManagedAppState,
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    checked_at: &str,
) -> Result<DatastoreSecurityTarget, CommandError> {
    let mut target = base_target(connection, environment, checked_at);
    let engine = connection.engine.to_ascii_lowercase();

    if not_applicable_engine(&engine) {
        target.status = "notApplicable".into();
        target.message = Some(format!(
            "{} is managed or serverless, so product-version CVE checks are not applicable in this version.",
            connection.engine
        ));
        return Ok(target);
    }

    let (resolved_connection, _, resolution_warnings) =
        runtime.resolve_connection_profile(connection, &environment.id)?;
    if has_unresolved_connection_tokens(&resolved_connection) {
        target.status = "versionUnavailable".into();
        target.message =
            Some("Version detection needs all connection variables to resolve first.".into());
        target.warnings.extend(resolution_warnings);
        return Ok(target);
    }

    let version = explicit_profile_version(&resolved_connection)
        .or_else(|| version_from_connection_warning(&resolved_connection));
    let version = match version {
        Some(version) => Some(version),
        None => {
            let result = adapters::test_connection(&resolved_connection, resolution_warnings)
                .await
                .ok();
            let detected = result.as_ref().and_then(|result| {
                result
                    .warnings
                    .iter()
                    .find_map(|warning| extract_version_from_text(warning))
                    .or_else(|| extract_version_from_text(&result.message))
            });
            match detected {
                Some(version) => Some(version),
                None => {
                    detect_version_by_query(&resolved_connection, connection, environment).await
                }
            }
        }
    };

    let Some(version) = version else {
        target.status = "versionUnavailable".into();
        target.message = Some(format!(
            "DataPad++ could not detect a product version for {} using read-only probes.",
            connection.name
        ));
        return Ok(target);
    };

    let normalized_version = normalize_product_version(&version);
    target.detected_version = Some(normalized_version.clone());
    apply_version_catalog(&mut target, &engine, &normalized_version);
    if let Some(mapping) = product_mapping_for_engine(&engine) {
        target.detected_product = Some(mapping.label.into());
        target.cpe_candidates.push(DatastoreSecurityCpeCandidate {
            cpe_name: mapping.cpe(&normalized_version),
            source: "curated".into(),
            confidence: if normalized_version == version {
                "exact".into()
            } else {
                "version-normalized".into()
            },
        });
        target.status = "checked".into();
        target.message = Some("Version detected and mapped to curated NVD CPE candidates.".into());
    } else {
        target.detected_product = Some(connection.engine.clone());
        target.status = "mappingUnavailable".into();
        target.message = Some(format!(
            "No curated NVD CPE mapping exists yet for {}.",
            connection.engine
        ));
    }

    Ok(target)
}

fn base_target(
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    checked_at: &str,
) -> DatastoreSecurityTarget {
    DatastoreSecurityTarget {
        id: security_target_id(connection, environment),
        connection_id: connection.id.clone(),
        environment_id: environment.id.clone(),
        connection_name: connection.name.clone(),
        environment_name: if environment.label.trim().is_empty() {
            "Default".into()
        } else {
            environment.label.clone()
        },
        engine: connection.engine.clone(),
        family: connection.family.clone(),
        status: "pending".into(),
        detected_product: None,
        detected_version: None,
        known_latest_version: None,
        recommended_version: None,
        version_status: None,
        version_source: None,
        version_source_label: None,
        version_source_url: None,
        version_source_updated_at: None,
        cpe_candidates: Vec::new(),
        finding_count: 0,
        highest_severity: None,
        last_checked_at: Some(checked_at.into()),
        message: None,
        warnings: Vec::new(),
    }
}

fn error_target(
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    checked_at: &str,
    error: CommandError,
) -> DatastoreSecurityTarget {
    let mut target = base_target(connection, environment, checked_at);
    target.status = "error".into();
    target.message = Some(error.message);
    target
}

async fn detect_version_by_query(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
) -> Option<String> {
    let query = version_query_for_engine(&connection.engine)?;
    let request = ExecutionRequest {
        execution_id: Some(generate_id("security-version-probe")),
        tab_id: "security-checks".into(),
        connection_id: profile.id.clone(),
        environment_id: environment.id.clone(),
        language: query.language.into(),
        query_text: query.text.into(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(5),
        document_efficiency_mode: Some(true),
        confirmed_guardrail_id: None,
        builder_state: None,
    };
    let notices = vec![QueryExecutionNotice {
        code: "datastore-security-checks-version-probe".into(),
        level: "info".into(),
        message: "Read-only datastore version probe.".into(),
    }];

    adapters::execute(connection, &request, notices)
        .await
        .ok()
        .and_then(|result| find_version_in_payloads(&result.payloads))
}

struct VersionQuery {
    language: &'static str,
    text: &'static str,
}

fn version_query_for_engine(engine: &str) -> Option<VersionQuery> {
    let (language, text) = security_check_provider(engine)?.version_query?;
    Some(VersionQuery { language, text })
}
fn explicit_profile_version(connection: &ResolvedConnectionProfile) -> Option<String> {
    let engine = connection.engine.to_ascii_lowercase();
    if matches!(engine.as_str(), "cockroachdb" | "cockroach") {
        return connection
            .postgres_options
            .as_ref()
            .and_then(|options| options.cockroach_server_version.clone());
    }
    if engine == "timescaledb" {
        return connection.postgres_options.as_ref().and_then(|options| {
            options
                .timescale_server_version
                .clone()
                .or_else(|| options.timescale_extension_version.clone())
        });
    }
    None
}

fn version_from_connection_warning(_connection: &ResolvedConnectionProfile) -> Option<String> {
    None
}

fn find_version_in_payloads(payloads: &[Value]) -> Option<String> {
    for payload in payloads {
        if let Some(value) = find_version_value(payload) {
            return Some(value);
        }
    }
    None
}

fn find_version_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => extract_version_from_text(text),
        Value::Array(items) => items.iter().find_map(find_version_value),
        Value::Object(map) => {
            for (key, value) in map {
                if key.to_ascii_lowercase().contains("version") {
                    if let Some(text) = value.as_str().and_then(extract_version_from_text) {
                        return Some(text);
                    }
                    if let Some(number) = value.as_i64() {
                        return Some(number.to_string());
                    }
                }
            }
            map.values().find_map(find_version_value)
        }
        _ => None,
    }
}

fn extract_version_from_text(text: &str) -> Option<String> {
    let markers = [
        "version:",
        "version ",
        "version\t",
        "server version:",
        "duckdb version:",
        "detected server version:",
        "detected duckdb version:",
        "timescaledb extension ",
        "mongodb server version:",
    ];
    let lower = text.to_ascii_lowercase();
    for marker in markers {
        if let Some(index) = lower.find(marker) {
            let start = index + marker.len();
            return extract_version_token(&text[start..]);
        }
    }
    extract_version_token(text)
}

fn extract_version_token(text: &str) -> Option<String> {
    text.split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';' || ch == ')' || ch == '(')
        .map(|token| token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.'))
        .find(|token| {
            token.chars().next().is_some_and(|ch| ch.is_ascii_digit()) && token.contains('.')
        })
        .map(str::to_string)
}

fn normalize_product_version(version: &str) -> String {
    let trimmed = version
        .trim()
        .trim_start_matches('v')
        .trim_matches(|ch: char| ch == '"' || ch == '\'');
    trimmed
        .split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';' || ch == ')' || ch == '(')
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()))
        .unwrap_or(trimmed)
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.')
        .to_string()
}

fn apply_version_catalog(
    target: &mut DatastoreSecurityTarget,
    engine: &str,
    detected_version: &str,
) {
    let Some(entry) = version_catalog_entry_for_engine(engine) else {
        target.version_status = Some("unknown".into());
        return;
    };

    target.known_latest_version = Some(entry.latest_known_version.into());
    target.version_source = Some("bundled-catalog".into());
    target.version_source_label = Some(entry.source_label.into());
    target.version_source_url = Some(entry.source_url.into());
    target.version_source_updated_at = Some(VERSION_CATALOG_UPDATED_AT.into());

    let below_minimum = entry
        .minimum_supported_version
        .and_then(|minimum| compare_product_versions(detected_version, minimum))
        .is_some_and(|ordering| ordering == Ordering::Less);
    let behind_latest = compare_product_versions(detected_version, entry.latest_known_version)
        .is_some_and(|ordering| ordering == Ordering::Less);
    let stable_recommendation = entry
        .latest_lts_version
        .unwrap_or(entry.latest_known_version);
    let recommended = if below_minimum {
        stable_recommendation
    } else if behind_latest {
        entry.latest_known_version
    } else {
        stable_recommendation
    };
    target.recommended_version = Some(recommended.into());

    target.version_status = Some(
        if below_minimum {
            "unsupported"
        } else if behind_latest {
            "updateAvailable"
        } else {
            "current"
        }
        .into(),
    );
}

fn version_catalog_entry_for_engine(engine: &str) -> Option<&'static VersionCatalogEntry> {
    let normalized = match engine {
        "cockroach" => "cockroachdb",
        "mssql" => "sqlserver",
        "arango" => "arangodb",
        other => other,
    };
    VERSION_CATALOG
        .iter()
        .find(|entry| entry.engine == normalized)
}

fn compare_product_versions(left: &str, right: &str) -> Option<Ordering> {
    let left_parts = numeric_version_components(left);
    let right_parts = numeric_version_components(right);

    if left_parts.is_empty() || right_parts.is_empty() {
        return None;
    }

    let len = left_parts.len().max(right_parts.len());
    for index in 0..len {
        let left = left_parts.get(index).copied().unwrap_or_default();
        let right = right_parts.get(index).copied().unwrap_or_default();
        match left.cmp(&right) {
            Ordering::Equal => {}
            ordering => return Some(ordering),
        }
    }

    Some(Ordering::Equal)
}

fn numeric_version_components(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn has_unresolved_connection_tokens(connection: &ResolvedConnectionProfile) -> bool {
    has_unresolved_tokens(&connection.host)
        || connection
            .database
            .as_deref()
            .is_some_and(has_unresolved_tokens)
        || connection
            .connection_string
            .as_deref()
            .is_some_and(has_unresolved_tokens)
}

fn has_unresolved_tokens(value: &str) -> bool {
    value.contains("{{") || value.contains("}}")
}

struct ProductMapping {
    label: &'static str,
    vendor: &'static str,
    product: &'static str,
}

impl ProductMapping {
    fn cpe(&self, version: &str) -> String {
        format!(
            "cpe:2.3:a:{}:{}:{}:*:*:*:*:*:*:*",
            self.vendor, self.product, version
        )
    }
}

fn product_mapping_for_engine(engine: &str) -> Option<ProductMapping> {
    let (label, vendor, product) = security_check_provider(engine)?.product?;
    Some(ProductMapping {
        label,
        vendor,
        product,
    })
}
fn not_applicable_engine(engine: &str) -> bool {
    security_check_provider(engine)
        .is_some_and(|provider| provider.version_not_applicable)
}
