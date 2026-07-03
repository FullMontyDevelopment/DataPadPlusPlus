use std::{
    collections::{BTreeSet, HashMap},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use reqwest::header::{ACCEPT, ACCEPT_ENCODING, CONTENT_TYPE};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;
use tauri::State;
use tokio::time::sleep;
use url::Url;

use super::{generate_id, timestamp_now, ManagedAppState, SharedAppState};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            BootstrapPayload, ConnectionProfile, DatastoreSecurityCheckSnapshot,
            DatastoreSecurityChecksRefreshRequest, DatastoreSecurityChecksSettingsRequest,
            DatastoreSecurityChecksStatus, DatastoreSecurityCpeCandidate, DatastoreSecurityFinding,
            DatastoreSecurityFindingReference, DatastoreSecurityKevDetails,
            DatastoreSecuritySourceMetadata, DatastoreSecurityTarget, EnvironmentProfile,
            ExecutionRequest, QueryExecutionNotice, ResolvedConnectionProfile,
        },
    },
};

const NVD_CVE_API_URL: &str = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CISA_KEV_URL: &str =
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const NVD_PUBLIC_DELAY_SECONDS: u64 = 6;
const MANUAL_REFRESH_COOLDOWN_SECONDS: u64 = 60;
const MAX_NVD_PAGES_PER_CPE: usize = 20;

pub type SharedDatastoreSecurityChecks = DatastoreSecurityCheckManager;

#[derive(Default)]
pub struct DatastoreSecurityCheckManager {
    refreshing: Mutex<bool>,
    last_nvd_request_at: Mutex<Option<Instant>>,
}

struct RefreshGuard<'a> {
    manager: &'a DatastoreSecurityCheckManager,
}

struct PreparedRefresh {
    runtime: ManagedAppState,
    attempt_at: String,
}

impl Drop for RefreshGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut refreshing) = self.manager.refreshing.lock() {
            *refreshing = false;
        }
    }
}

impl DatastoreSecurityCheckManager {
    fn begin_refresh(&self) -> Result<RefreshGuard<'_>, CommandError> {
        let mut refreshing = self.refreshing.lock().map_err(|_| {
            CommandError::new(
                "datastore-security-checks-state-unavailable",
                "Security check state is temporarily unavailable.",
            )
        })?;

        if *refreshing {
            return Err(CommandError::new(
                "datastore-security-checks-refresh-running",
                "A datastore security check refresh is already running.",
            ));
        }

        *refreshing = true;
        Ok(RefreshGuard { manager: self })
    }

    async fn wait_for_nvd_slot(&self) -> Result<(), CommandError> {
        let wait_for = {
            let last_request = self.last_nvd_request_at.lock().map_err(|_| {
                CommandError::new(
                    "datastore-security-checks-rate-limit-state",
                    "Security check rate-limit state is temporarily unavailable.",
                )
            })?;
            last_request
                .as_ref()
                .and_then(|last| {
                    let minimum_delay = Duration::from_secs(NVD_PUBLIC_DELAY_SECONDS);
                    let elapsed = last.elapsed();
                    (elapsed < minimum_delay).then_some(minimum_delay - elapsed)
                })
                .unwrap_or_default()
        };

        if !wait_for.is_zero() {
            sleep(wait_for).await;
        }

        let mut last_request = self.last_nvd_request_at.lock().map_err(|_| {
            CommandError::new(
                "datastore-security-checks-rate-limit-state",
                "Security check rate-limit state is temporarily unavailable.",
            )
        })?;
        *last_request = Some(Instant::now());
        Ok(())
    }
}

pub fn status(runtime: &ManagedAppState) -> DatastoreSecurityChecksStatus {
    let preferences = runtime
        .snapshot
        .preferences
        .datastore_security_checks
        .clone();
    let mut snapshot = runtime.snapshot.datastore_security_checks.clone();
    let enabled = preferences.enabled;
    let now = epoch_seconds();
    let mut can_refresh = enabled;
    let mut refresh_blocked_reason = None;

    if let Some(next_allowed) = preferences
        .next_manual_refresh_allowed_at
        .as_deref()
        .and_then(parse_timestamp_seconds)
    {
        if next_allowed > now {
            can_refresh = false;
            refresh_blocked_reason = Some(format!(
                "Manual refresh is available again in {} seconds.",
                next_allowed - now
            ));
        }
    }

    if let Some(cached) = snapshot.as_mut() {
        if cached.status == "ready"
            && cached
                .expires_at
                .as_deref()
                .and_then(parse_timestamp_seconds)
                .is_some_and(|expires_at| expires_at < now)
        {
            cached.status = "stale".into();
        }
    }

    DatastoreSecurityChecksStatus {
        supported: true,
        enabled,
        message: if enabled {
            "Datastore Security Checks are enabled.".into()
        } else {
            "Enable Datastore Security Checks from Settings > Experimental.".into()
        },
        can_refresh,
        refresh_blocked_reason,
        preferences,
        snapshot,
    }
}

pub fn update_settings(
    runtime: &mut ManagedAppState,
    request: DatastoreSecurityChecksSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    runtime
        .snapshot
        .preferences
        .datastore_security_checks
        .enabled = request.enabled;
    if let Some(days) = request.refresh_interval_days {
        runtime
            .snapshot
            .preferences
            .datastore_security_checks
            .refresh_interval_days = days.clamp(1, 30);
    }
    if let Some(mut muted_finding_ids) = request.muted_finding_ids {
        muted_finding_ids.retain(|finding_id| !finding_id.trim().is_empty());
        for finding_id in &mut muted_finding_ids {
            *finding_id = finding_id.trim().to_string();
        }
        muted_finding_ids.sort();
        muted_finding_ids.dedup();
        runtime
            .snapshot
            .preferences
            .datastore_security_checks
            .muted_finding_ids = muted_finding_ids;
    }
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

fn lock_runtime_state<'a, 'b>(
    state: &'a State<'b, SharedAppState>,
) -> Result<MutexGuard<'a, ManagedAppState>, CommandError> {
    state.lock().map_err(|_| {
        CommandError::new(
            "workspace-state-unavailable",
            "Workspace state is temporarily unavailable. Restart DataPad++ if this continues.",
        )
    })
}

pub async fn refresh(
    manager: State<'_, SharedDatastoreSecurityChecks>,
    state: State<'_, SharedAppState>,
    request: DatastoreSecurityChecksRefreshRequest,
) -> Result<BootstrapPayload, CommandError> {
    let _guard = manager.begin_refresh()?;
    let prepared = {
        let mut runtime = lock_runtime_state(&state)?;
        match prepare_refresh(&mut runtime, request)? {
            Some(prepared) => prepared,
            None => return Ok(runtime.bootstrap_payload()),
        }
    };

    let scan = run_scan(&manager, &prepared.runtime).await;
    let mut runtime = lock_runtime_state(&state)?;
    apply_refresh_result(&mut runtime, &prepared.attempt_at, scan)
}

fn prepare_refresh(
    runtime: &mut ManagedAppState,
    request: DatastoreSecurityChecksRefreshRequest,
) -> Result<Option<PreparedRefresh>, CommandError> {
    runtime.ensure_unlocked()?;
    if !runtime
        .snapshot
        .preferences
        .datastore_security_checks
        .enabled
    {
        return Err(CommandError::new(
            "datastore-security-checks-disabled",
            "Enable Datastore Security Checks from Settings > Experimental before refreshing.",
        ));
    }

    let now = epoch_seconds();
    if request.manual {
        if let Some(next_allowed) = runtime
            .snapshot
            .preferences
            .datastore_security_checks
            .next_manual_refresh_allowed_at
            .as_deref()
            .and_then(parse_timestamp_seconds)
        {
            if next_allowed > now {
                return Err(CommandError::new(
                    "datastore-security-checks-refresh-cooldown",
                    format!(
                        "Manual refresh is available again in {} seconds.",
                        next_allowed - now
                    ),
                ));
            }
        }
    } else if cache_is_fresh(runtime, now) {
        return Ok(None);
    }

    let attempt_at = timestamp_now();
    runtime
        .snapshot
        .preferences
        .datastore_security_checks
        .last_refresh_attempt_at = Some(attempt_at.clone());
    if request.manual {
        runtime
            .snapshot
            .preferences
            .datastore_security_checks
            .next_manual_refresh_allowed_at =
            Some((now + MANUAL_REFRESH_COOLDOWN_SECONDS).to_string());
    }
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    Ok(Some(PreparedRefresh {
        runtime: ManagedAppState {
            app: runtime.app.clone(),
            snapshot: runtime.snapshot.clone(),
        },
        attempt_at,
    }))
}

fn apply_refresh_result(
    runtime: &mut ManagedAppState,
    attempt_at: &str,
    scan: Result<DatastoreSecurityCheckSnapshot, CommandError>,
) -> Result<BootstrapPayload, CommandError> {
    match scan {
        Ok(snapshot) => {
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .last_successful_refresh_at = snapshot.checked_at.clone();
            runtime.snapshot.datastore_security_checks = Some(snapshot);
        }
        Err(error) => {
            let mut snapshot = runtime
                .snapshot
                .datastore_security_checks
                .clone()
                .unwrap_or_else(|| DatastoreSecurityCheckSnapshot {
                    status: "error".into(),
                    checked_at: Some(attempt_at.to_string()),
                    expires_at: None,
                    source_metadata: Vec::new(),
                    targets: Vec::new(),
                    findings: Vec::new(),
                    warnings: Vec::new(),
                    errors: Vec::new(),
                });
            snapshot.status = if snapshot.findings.is_empty() && snapshot.targets.is_empty() {
                "error".into()
            } else {
                "stale".into()
            };
            snapshot.errors.push(error.message);
            runtime.snapshot.datastore_security_checks = Some(snapshot);
        }
    }

    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

async fn run_scan(
    manager: &DatastoreSecurityCheckManager,
    runtime: &ManagedAppState,
) -> Result<DatastoreSecurityCheckSnapshot, CommandError> {
    let checked_at = timestamp_now();
    let expires_at = (epoch_seconds()
        + u64::from(
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .refresh_interval_days
                .max(1),
        ) * 24
            * 60
            * 60)
        .to_string();
    let mut warnings = Vec::new();
    let mut targets = detect_targets(runtime, &checked_at).await;
    let cpe_to_targets = cpe_target_map(&targets);

    let client = reqwest::Client::builder()
        .user_agent(format!(
            "DataPad++ datastore-security-checks/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(reqwest_command_error)?;

    let kev_map = match fetch_cisa_kev(&client).await {
        Ok(map) => map,
        Err(error) => {
            warnings.push(format!("CISA KEV enrichment failed: {}", error.message));
            HashMap::new()
        }
    };

    let mut findings_by_cve: HashMap<String, DatastoreSecurityFinding> = HashMap::new();
    let mut source_metadata = Vec::new();
    source_metadata.push(DatastoreSecuritySourceMetadata {
        source: "cisa-kev".into(),
        fetched_at: Some(checked_at.clone()),
        url: CISA_KEV_URL.into(),
        record_count: Some(kev_map.len()),
    });

    for (cpe_name, target_ids) in cpe_to_targets {
        match fetch_nvd_findings(manager, &client, &cpe_name, &target_ids, &kev_map).await {
            Ok((count, findings)) => {
                source_metadata.push(DatastoreSecuritySourceMetadata {
                    source: "nvd".into(),
                    fetched_at: Some(timestamp_now()),
                    url: nvd_source_url(&cpe_name),
                    record_count: Some(count),
                });
                for finding in findings {
                    let entry = findings_by_cve
                        .entry(finding.cve_id.clone())
                        .or_insert_with(|| finding.clone());
                    let mut merged_ids = entry.target_ids.clone();
                    merged_ids.extend(finding.target_ids);
                    merged_ids.sort();
                    merged_ids.dedup();
                    entry.target_ids = merged_ids;
                    entry.known_exploited |= finding.known_exploited;
                    if entry.kev.is_none() {
                        entry.kev = finding.kev;
                    }
                    if severity_rank(&finding.severity) > severity_rank(&entry.severity) {
                        entry.severity = finding.severity;
                        entry.cvss_score = finding.cvss_score;
                        entry.cvss_vector = finding.cvss_vector;
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "NVD lookup failed for a mapped product/version candidate: {}",
                error.message
            )),
        }
    }

    let mut findings = findings_by_cve.into_values().collect::<Vec<_>>();
    findings.sort_by(|left, right| {
        severity_rank(&right.severity)
            .cmp(&severity_rank(&left.severity))
            .then_with(|| left.cve_id.cmp(&right.cve_id))
    });

    let target_counts = finding_counts_by_target(&findings);
    let target_highest = highest_severity_by_target(&findings);
    for target in &mut targets {
        target.finding_count = target_counts.get(&target.id).copied().unwrap_or_default();
        target.highest_severity = target_highest.get(&target.id).cloned();
    }

    Ok(DatastoreSecurityCheckSnapshot {
        status: "ready".into(),
        checked_at: Some(checked_at),
        expires_at: Some(expires_at),
        source_metadata,
        targets,
        findings,
        warnings,
        errors: Vec::new(),
    })
}

async fn detect_targets(
    runtime: &ManagedAppState,
    checked_at: &str,
) -> Vec<DatastoreSecurityTarget> {
    let mut targets = Vec::new();
    let environments = if runtime.snapshot.environments.is_empty() {
        vec![EnvironmentProfile {
            id: String::new(),
            label: "Default".into(),
            risk: "medium".into(),
            ..EnvironmentProfile::default()
        }]
    } else {
        runtime.snapshot.environments.clone()
    };

    for connection in &runtime.snapshot.connections {
        let scoped_environments = if connection.environment_ids.is_empty() {
            environments.clone()
        } else {
            environments
                .iter()
                .filter(|environment| connection.environment_ids.contains(&environment.id))
                .cloned()
                .collect::<Vec<_>>()
        };

        for environment in scoped_environments {
            targets.push(
                detect_target(runtime, connection, &environment, checked_at)
                    .await
                    .unwrap_or_else(|error| {
                        error_target(connection, &environment, checked_at, error)
                    }),
            );
        }
    }

    targets
}

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
        id: format!("security-target-{}-{}", connection.id, environment.id),
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
    match engine.to_ascii_lowercase().as_str() {
        "postgresql" | "timescaledb" | "cockroachdb" | "cockroach" => Some(VersionQuery {
            language: "sql",
            text: "select version() as version",
        }),
        "mysql" | "mariadb" => Some(VersionQuery {
            language: "sql",
            text: "select version() as version",
        }),
        "sqlserver" | "mssql" => Some(VersionQuery {
            language: "sql",
            text: "select cast(serverproperty('ProductVersion') as nvarchar(128)) as version",
        }),
        "sqlite" => Some(VersionQuery {
            language: "sql",
            text: "select sqlite_version() as version",
        }),
        "duckdb" => Some(VersionQuery {
            language: "sql",
            text: "select version() as version",
        }),
        "mongodb" => Some(VersionQuery {
            language: "json",
            text: r#"{"operation":"runCommand","database":"admin","command":{"buildInfo":1}}"#,
        }),
        "redis" | "valkey" => Some(VersionQuery {
            language: "text",
            text: "INFO server",
        }),
        "clickhouse" => Some(VersionQuery {
            language: "sql",
            text: "select version() as version",
        }),
        "cassandra" => Some(VersionQuery {
            language: "cql",
            text: "select release_version from system.local",
        }),
        "neo4j" => Some(VersionQuery {
            language: "cypher",
            text: "CALL dbms.components() YIELD versions RETURN versions",
        }),
        "memcached" => Some(VersionQuery {
            language: "text",
            text: "version",
        }),
        _ => None,
    }
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

fn version_from_connection_warning(connection: &ResolvedConnectionProfile) -> Option<String> {
    match connection.engine.to_ascii_lowercase().as_str() {
        _ => None,
    }
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
    Some(match engine {
        "postgresql" => ProductMapping {
            label: "PostgreSQL",
            vendor: "postgresql",
            product: "postgresql",
        },
        "timescaledb" => ProductMapping {
            label: "TimescaleDB",
            vendor: "timescale",
            product: "timescaledb",
        },
        "cockroachdb" | "cockroach" => ProductMapping {
            label: "CockroachDB",
            vendor: "cockroachlabs",
            product: "cockroachdb",
        },
        "mysql" => ProductMapping {
            label: "MySQL",
            vendor: "oracle",
            product: "mysql",
        },
        "mariadb" => ProductMapping {
            label: "MariaDB",
            vendor: "mariadb",
            product: "mariadb",
        },
        "sqlserver" | "mssql" => ProductMapping {
            label: "Microsoft SQL Server",
            vendor: "microsoft",
            product: "sql_server",
        },
        "sqlite" => ProductMapping {
            label: "SQLite",
            vendor: "sqlite",
            product: "sqlite",
        },
        "duckdb" => ProductMapping {
            label: "DuckDB",
            vendor: "duckdb",
            product: "duckdb",
        },
        "mongodb" => ProductMapping {
            label: "MongoDB",
            vendor: "mongodb",
            product: "mongodb",
        },
        "redis" => ProductMapping {
            label: "Redis",
            vendor: "redis",
            product: "redis",
        },
        "valkey" => ProductMapping {
            label: "Valkey",
            vendor: "valkey",
            product: "valkey",
        },
        "elasticsearch" => ProductMapping {
            label: "Elasticsearch",
            vendor: "elastic",
            product: "elasticsearch",
        },
        "opensearch" => ProductMapping {
            label: "OpenSearch",
            vendor: "opensearch",
            product: "opensearch",
        },
        "cassandra" => ProductMapping {
            label: "Apache Cassandra",
            vendor: "apache",
            product: "cassandra",
        },
        "clickhouse" => ProductMapping {
            label: "ClickHouse",
            vendor: "clickhouse",
            product: "clickhouse",
        },
        "influxdb" => ProductMapping {
            label: "InfluxDB",
            vendor: "influxdata",
            product: "influxdb",
        },
        "neo4j" => ProductMapping {
            label: "Neo4j",
            vendor: "neo4j",
            product: "neo4j",
        },
        "arangodb" | "arango" => ProductMapping {
            label: "ArangoDB",
            vendor: "arangodb",
            product: "arangodb",
        },
        "litedb" => ProductMapping {
            label: "LiteDB",
            vendor: "litedb",
            product: "litedb",
        },
        "memcached" => ProductMapping {
            label: "Memcached",
            vendor: "memcached",
            product: "memcached",
        },
        _ => return None,
    })
}

fn not_applicable_engine(engine: &str) -> bool {
    matches!(
        engine,
        "dynamodb"
            | "bigquery"
            | "cosmosdb"
            | "snowflake"
            | "prometheus"
            | "opentsdb"
            | "neptune"
            | "janusgraph"
    )
}

fn cpe_target_map(targets: &[DatastoreSecurityTarget]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for target in targets {
        for candidate in &target.cpe_candidates {
            map.entry(candidate.cpe_name.clone())
                .or_default()
                .push(target.id.clone());
        }
    }
    for target_ids in map.values_mut() {
        target_ids.sort();
        target_ids.dedup();
    }
    map
}

async fn fetch_nvd_findings(
    manager: &DatastoreSecurityCheckManager,
    client: &reqwest::Client,
    cpe_name: &str,
    target_ids: &[String],
    kev_map: &HashMap<String, KevEntry>,
) -> Result<(usize, Vec<DatastoreSecurityFinding>), CommandError> {
    let mut start_index = 0usize;
    let mut findings = Vec::new();
    let mut pages = 0usize;

    loop {
        manager.wait_for_nvd_slot().await?;
        let mut url = Url::parse(NVD_CVE_API_URL).map_err(|error| {
            CommandError::new(
                "datastore-security-checks-nvd-url",
                format!("NVD CVE API URL is invalid: {error}"),
            )
        })?;
        url.query_pairs_mut()
            .append_pair("cpeName", cpe_name)
            .append_pair("startIndex", &start_index.to_string());
        let response: NvdCveResponse = fetch_official_json(client, url, "NVD CVE API").await?;
        let total_results = response.total_results;
        for item in response.vulnerabilities {
            if let Some(finding) = nvd_vulnerability_to_finding(item, target_ids, kev_map) {
                findings.push(finding);
            }
        }

        pages += 1;
        start_index += response.results_per_page.max(1);
        if start_index >= total_results || pages >= MAX_NVD_PAGES_PER_CPE {
            break;
        }
    }

    let finding_count = findings.len();
    Ok((finding_count, findings))
}

fn nvd_source_url(cpe_name: &str) -> String {
    let mut url = Url::parse(NVD_CVE_API_URL).expect("static NVD URL is valid");
    url.query_pairs_mut().append_pair("cpeName", cpe_name);
    url.to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCveResponse {
    #[serde(default)]
    total_results: usize,
    #[serde(default = "default_nvd_page_size")]
    results_per_page: usize,
    #[serde(default)]
    vulnerabilities: Vec<NvdVulnerability>,
}

fn default_nvd_page_size() -> usize {
    2000
}

#[derive(Deserialize)]
struct NvdVulnerability {
    cve: NvdCve,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCve {
    id: String,
    #[serde(default)]
    descriptions: Vec<NvdLangValue>,
    #[serde(default)]
    published: Option<String>,
    #[serde(default)]
    last_modified: Option<String>,
    #[serde(default)]
    metrics: Value,
    #[serde(default)]
    weaknesses: Vec<NvdWeakness>,
    #[serde(default, deserialize_with = "deserialize_nvd_references")]
    references: Vec<NvdReference>,
}

#[derive(Deserialize)]
struct NvdLangValue {
    #[serde(default)]
    lang: String,
    #[serde(default)]
    value: String,
}

#[derive(Deserialize, Default)]
struct NvdWeakness {
    #[serde(default)]
    description: Vec<NvdLangValue>,
}

#[derive(Deserialize)]
struct NvdReference {
    url: String,
    #[serde(default)]
    source: Option<String>,
}

fn deserialize_nvd_references<'de, D>(deserializer: D) -> Result<Vec<NvdReference>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum References {
        Current(Vec<NvdReference>),
        Legacy {
            #[serde(default, rename = "referenceData")]
            reference_data: Vec<NvdReference>,
        },
    }

    Ok(match References::deserialize(deserializer)? {
        References::Current(references) => references,
        References::Legacy { reference_data } => reference_data,
    })
}

fn nvd_vulnerability_to_finding(
    vulnerability: NvdVulnerability,
    target_ids: &[String],
    kev_map: &HashMap<String, KevEntry>,
) -> Option<DatastoreSecurityFinding> {
    let cve = vulnerability.cve;
    let description = cve
        .descriptions
        .iter()
        .find(|item| item.lang == "en")
        .or_else(|| cve.descriptions.first())
        .map(|item| item.value.clone())
        .unwrap_or_default();
    if description.trim().is_empty() {
        return None;
    }
    let (severity, cvss_score, cvss_vector) = cvss_from_metrics(&cve.metrics);
    let kev = kev_map.get(&cve.id);
    let known_exploited = kev.is_some();
    let remediation = kev
        .map(|entry| entry.required_action.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            "Review the vendor advisory and apply a supported patched version.".into()
        });
    let mut references = cve
        .references
        .into_iter()
        .take(12)
        .map(|reference| DatastoreSecurityFindingReference {
            label: reference
                .source
                .clone()
                .filter(|source| !source.trim().is_empty())
                .unwrap_or_else(|| reference.url.clone()),
            url: reference.url,
            source: reference.source,
        })
        .collect::<Vec<_>>();
    references.insert(
        0,
        DatastoreSecurityFindingReference {
            label: "NVD".into(),
            url: format!("https://nvd.nist.gov/vuln/detail/{}", cve.id),
            source: Some("NVD".into()),
        },
    );

    Some(DatastoreSecurityFinding {
        id: cve.id.clone(),
        target_ids: target_ids.to_vec(),
        cve_id: cve.id.clone(),
        title: cve.id.clone(),
        summary: description,
        severity,
        cvss_score,
        cvss_vector,
        published_at: cve.published,
        modified_at: cve.last_modified,
        affected_product: "Mapped datastore product".into(),
        affected_version: None,
        remediation,
        references,
        cwes: cwes_from_weaknesses(&cve.weaknesses),
        known_exploited,
        kev: kev.map(|entry| DatastoreSecurityKevDetails {
            date_added: Some(entry.date_added.clone()),
            required_action: Some(entry.required_action.clone()),
            due_date: Some(entry.due_date.clone()),
            known_ransomware_campaign_use: entry.known_ransomware_campaign_use.clone(),
            notes: entry.notes.clone(),
        }),
        source_urls: vec![
            format!("https://nvd.nist.gov/vuln/detail/{}", cve.id),
            CISA_KEV_URL.into(),
        ],
    })
}

fn cvss_from_metrics(metrics: &Value) -> (String, Option<f64>, Option<String>) {
    for key in [
        "cvssMetricV40",
        "cvssMetricV31",
        "cvssMetricV30",
        "cvssMetricV2",
    ] {
        if let Some(metric) = metrics
            .get(key)
            .and_then(Value::as_array)
            .and_then(|items| items.first())
        {
            let data = metric.get("cvssData").unwrap_or(metric);
            let severity = metric
                .get("baseSeverity")
                .or_else(|| data.get("baseSeverity"))
                .and_then(Value::as_str)
                .map(|value| value.to_ascii_uppercase())
                .unwrap_or_else(|| "UNKNOWN".into());
            let score = data.get("baseScore").and_then(Value::as_f64);
            let vector = data
                .get("vectorString")
                .and_then(Value::as_str)
                .map(str::to_string);
            return (normalize_severity(&severity), score, vector);
        }
    }
    ("UNKNOWN".into(), None, None)
}

fn normalize_severity(severity: &str) -> String {
    match severity.to_ascii_uppercase().as_str() {
        "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE" => severity.to_ascii_uppercase(),
        _ => "UNKNOWN".into(),
    }
}

fn cwes_from_weaknesses(weaknesses: &[NvdWeakness]) -> Vec<String> {
    let mut cwes = BTreeSet::new();
    for weakness in weaknesses {
        for description in &weakness.description {
            if description.value.starts_with("CWE-") {
                cwes.insert(description.value.clone());
            }
        }
    }
    cwes.into_iter().collect()
}

async fn fetch_cisa_kev(
    client: &reqwest::Client,
) -> Result<HashMap<String, KevEntry>, CommandError> {
    let url = Url::parse(CISA_KEV_URL).map_err(|error| {
        CommandError::new(
            "datastore-security-checks-cisa-url",
            format!("CISA KEV catalog URL is invalid: {error}"),
        )
    })?;
    let response: CisaKevCatalog = fetch_official_json(client, url, "CISA KEV catalog").await?;
    Ok(response
        .vulnerabilities
        .into_iter()
        .map(|entry| (entry.cve_id.clone(), entry))
        .collect())
}

async fn fetch_official_json<T>(
    client: &reqwest::Client,
    url: Url,
    source: &str,
) -> Result<T, CommandError>
where
    T: DeserializeOwned,
{
    let response = client
        .get(url)
        .header(ACCEPT, "application/json")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(reqwest_command_error)?;
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let body = response.text().await.map_err(reqwest_command_error)?;

    if !status.is_success() {
        return Err(CommandError::new(
            "datastore-security-checks-source-http-error",
            format!(
                "{source} returned HTTP {status} from {final_url}. Response preview: {}",
                response_preview(&body)
            ),
        ));
    }

    serde_json::from_str(&body).map_err(|error| {
        CommandError::new(
            "datastore-security-checks-source-json-invalid",
            format!(
                "{source} returned a response that could not be parsed as JSON. Content-Type: {content_type}. Response preview: {}. Details: {error}",
                response_preview(&body)
            ),
        )
    })
}

fn response_preview(body: &str) -> String {
    let mut compact = String::new();
    for part in body.split_whitespace() {
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(part);
        if compact.chars().count() >= 240 {
            break;
        }
    }

    if compact.trim().is_empty() {
        return "<empty body>".into();
    }

    let preview = compact.chars().take(240).collect::<String>();
    if compact.chars().count() > 240 || body.chars().count() > preview.chars().count() {
        format!("{preview}...")
    } else {
        preview
    }
}

#[derive(Deserialize)]
struct CisaKevCatalog {
    #[serde(default)]
    vulnerabilities: Vec<KevEntry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KevEntry {
    #[serde(rename = "cveID")]
    cve_id: String,
    #[serde(default)]
    date_added: String,
    #[serde(default)]
    required_action: String,
    #[serde(default)]
    due_date: String,
    #[serde(default)]
    known_ransomware_campaign_use: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

fn finding_counts_by_target(findings: &[DatastoreSecurityFinding]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for finding in findings {
        for target_id in &finding.target_ids {
            *counts.entry(target_id.clone()).or_default() += 1;
        }
    }
    counts
}

fn highest_severity_by_target(findings: &[DatastoreSecurityFinding]) -> HashMap<String, String> {
    let mut severities = HashMap::new();
    for finding in findings {
        for target_id in &finding.target_ids {
            let current = severities
                .entry(target_id.clone())
                .or_insert_with(|| finding.severity.clone());
            if severity_rank(&finding.severity) > severity_rank(current) {
                *current = finding.severity.clone();
            }
        }
    }
    severities
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "CRITICAL" => 5,
        "HIGH" => 4,
        "MEDIUM" => 3,
        "LOW" => 2,
        "NONE" => 1,
        _ => 0,
    }
}

fn cache_is_fresh(runtime: &ManagedAppState, now: u64) -> bool {
    runtime
        .snapshot
        .datastore_security_checks
        .as_ref()
        .and_then(|snapshot| snapshot.expires_at.as_deref())
        .and_then(parse_timestamp_seconds)
        .is_some_and(|expires_at| expires_at > now)
}

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn parse_timestamp_seconds(value: &str) -> Option<u64> {
    value.parse::<u64>().ok()
}

fn reqwest_command_error(error: reqwest::Error) -> CommandError {
    CommandError::new(
        "datastore-security-checks-source-request-failed",
        format!("Official vulnerability source request failed: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_common_text() {
        assert_eq!(
            extract_version_from_text("Detected server version: 8.12.2"),
            Some("8.12.2".into())
        );
        assert_eq!(
            extract_version_from_text("PostgreSQL 16.2 on x86_64-pc-linux"),
            Some("16.2".into())
        );
    }

    #[test]
    fn cpe_mapping_uses_curated_vendor_product() {
        let mapping = product_mapping_for_engine("postgresql").expect("mapping");
        assert_eq!(
            mapping.cpe("16.2"),
            "cpe:2.3:a:postgresql:postgresql:16.2:*:*:*:*:*:*:*"
        );
    }

    #[test]
    fn severity_ranking_orders_critical_first() {
        assert!(severity_rank("CRITICAL") > severity_rank("HIGH"));
        assert!(severity_rank("HIGH") > severity_rank("MEDIUM"));
    }

    #[test]
    fn cpe_target_map_deduplicates_candidates() {
        let mut target = DatastoreSecurityTarget {
            id: "target-1".into(),
            connection_id: "conn".into(),
            environment_id: "env".into(),
            connection_name: "Datastore".into(),
            environment_name: "Env".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            status: "checked".into(),
            detected_product: Some("PostgreSQL".into()),
            detected_version: Some("16.2".into()),
            cpe_candidates: Vec::new(),
            finding_count: 0,
            highest_severity: None,
            last_checked_at: None,
            message: None,
            warnings: Vec::new(),
        };
        target.cpe_candidates.push(DatastoreSecurityCpeCandidate {
            cpe_name: "cpe".into(),
            source: "curated".into(),
            confidence: "exact".into(),
        });
        target.cpe_candidates.push(DatastoreSecurityCpeCandidate {
            cpe_name: "cpe".into(),
            source: "curated".into(),
            confidence: "exact".into(),
        });

        let map = cpe_target_map(&[target]);
        assert_eq!(map.get("cpe"), Some(&vec!["target-1".into()]));
    }

    #[test]
    fn parses_current_nvd_references_shape() {
        let payload = serde_json::json!({
            "totalResults": 1,
            "resultsPerPage": 1,
            "vulnerabilities": [{
                "cve": {
                    "id": "CVE-2026-0001",
                    "descriptions": [{ "lang": "en", "value": "Example datastore CVE." }],
                    "references": [{ "url": "https://nvd.nist.gov/vuln/detail/CVE-2026-0001", "source": "nvd@nist.gov" }]
                }
            }]
        });

        let response: NvdCveResponse = serde_json::from_value(payload).expect("nvd response");
        let cve = response
            .vulnerabilities
            .into_iter()
            .next()
            .expect("vulnerability")
            .cve;
        assert_eq!(cve.references.len(), 1);
        assert_eq!(
            cve.references[0].url,
            "https://nvd.nist.gov/vuln/detail/CVE-2026-0001"
        );
    }

    #[test]
    fn parses_cisa_kev_cve_id_field() {
        let payload = serde_json::json!({
            "vulnerabilities": [{
                "cveID": "CVE-2026-0002",
                "dateAdded": "2026-07-01",
                "requiredAction": "Apply vendor mitigation.",
                "dueDate": "2026-07-04"
            }]
        });

        let catalog: CisaKevCatalog = serde_json::from_value(payload).expect("cisa catalog");
        assert_eq!(catalog.vulnerabilities[0].cve_id, "CVE-2026-0002");
        assert_eq!(
            catalog.vulnerabilities[0].required_action,
            "Apply vendor mitigation."
        );
    }
}
