use std::{
    cmp::Ordering,
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
            DatastoreSecurityPostureCheckResult, DatastoreSecuritySourceMetadata,
            DatastoreSecurityTarget, EnvironmentProfile, ExecutionRequest, QueryExecutionNotice,
            ResolvedConnectionProfile, SecretRef,
        },
    },
};

mod references;

use references::*;

const NVD_CVE_API_URL: &str = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CISA_KEV_URL: &str =
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const NVD_PUBLIC_DELAY_SECONDS: u64 = 6;
const MANUAL_REFRESH_COOLDOWN_SECONDS: u64 = 60;
const MAX_NVD_PAGES_PER_CPE: usize = 20;
const VERSION_CATALOG_UPDATED_AT: &str = "2026-07-04";
const VERSION_CATALOG_URL: &str = "bundled://datastore-security-version-catalog";

struct PostureCheckInput<'a> {
    target_id: &'a str,
    rule_id: &'a str,
    category: &'a str,
    status: &'a str,
    severity: &'a str,
    title: &'a str,
    summary: &'a str,
    evidence: Option<String>,
    remediation: &'a str,
    source: &'a str,
    references: Vec<DatastoreSecurityFindingReference>,
}

struct BoolProbeCheckInput<'a> {
    target_id: &'a str,
    rule_id: &'a str,
    category: &'a str,
    risky: bool,
    risky_status: &'a str,
    risky_severity: &'a str,
    risky_title: &'a str,
    pass_title: &'a str,
    summary: &'a str,
    remediation: &'a str,
    references: Vec<DatastoreSecurityFindingReference>,
}

macro_rules! posture_check {
    ($target_id:expr, $rule_id:expr, $category:expr, $status:expr, $severity:expr,
     $title:expr, $summary:expr, $evidence:expr, $remediation:expr, $source:expr,
     $references:expr $(,)?) => {
        posture_check_from_input(PostureCheckInput {
            target_id: $target_id,
            rule_id: $rule_id,
            category: $category,
            status: $status,
            severity: $severity,
            title: $title,
            summary: $summary,
            evidence: $evidence,
            remediation: $remediation,
            source: $source,
            references: $references,
        })
    };
}

macro_rules! bool_probe_check {
    ($target_id:expr, $rule_id:expr, $category:expr, $risky:expr, $risky_status:expr,
     $risky_severity:expr, $risky_title:expr, $pass_title:expr, $summary:expr,
     $remediation:expr, $references:expr $(,)?) => {
        bool_probe_check_from_input(BoolProbeCheckInput {
            target_id: $target_id,
            rule_id: $rule_id,
            category: $category,
            risky: $risky,
            risky_status: $risky_status,
            risky_severity: $risky_severity,
            risky_title: $risky_title,
            pass_title: $pass_title,
            summary: $summary,
            remediation: $remediation,
            references: $references,
        })
    };
}

struct VersionCatalogEntry {
    engine: &'static str,
    latest_known_version: &'static str,
    latest_lts_version: Option<&'static str>,
    minimum_supported_version: Option<&'static str>,
    source_label: &'static str,
    source_url: &'static str,
}

const VERSION_CATALOG: &[VersionCatalogEntry] = &[
    VersionCatalogEntry {
        engine: "postgresql",
        latest_known_version: "18.4",
        latest_lts_version: None,
        minimum_supported_version: Some("14.0"),
        source_label: "PostgreSQL release notes",
        source_url: "https://www.postgresql.org/docs/release/",
    },
    VersionCatalogEntry {
        engine: "mysql",
        latest_known_version: "9.7.0",
        latest_lts_version: Some("8.4.9"),
        minimum_supported_version: Some("8.4.0"),
        source_label: "MySQL release notes",
        source_url: "https://dev.mysql.com/doc/relnotes/mysql/",
    },
    VersionCatalogEntry {
        engine: "mariadb",
        latest_known_version: "11.4.12",
        latest_lts_version: Some("11.4.12"),
        minimum_supported_version: Some("10.11.0"),
        source_label: "MariaDB all releases",
        source_url: "https://mariadb.org/mariadb/all-releases/",
    },
    VersionCatalogEntry {
        engine: "mongodb",
        latest_known_version: "8.3",
        latest_lts_version: Some("8.0"),
        minimum_supported_version: Some("8.0"),
        source_label: "MongoDB release notes",
        source_url: "https://www.mongodb.com/docs/manual/release-notes/",
    },
    VersionCatalogEntry {
        engine: "redis",
        latest_known_version: "8.8.0",
        latest_lts_version: None,
        minimum_supported_version: Some("8.0.0"),
        source_label: "Redis releases",
        source_url: "https://github.com/redis/redis/releases",
    },
    VersionCatalogEntry {
        engine: "valkey",
        latest_known_version: "8.1.8",
        latest_lts_version: None,
        minimum_supported_version: Some("8.0.0"),
        source_label: "Valkey releases",
        source_url: "https://valkey.io/",
    },
    VersionCatalogEntry {
        engine: "sqlite",
        latest_known_version: "3.53.3",
        latest_lts_version: None,
        minimum_supported_version: None,
        source_label: "SQLite download page",
        source_url: "https://sqlite.org/download.html",
    },
    VersionCatalogEntry {
        engine: "duckdb",
        latest_known_version: "1.5.4",
        latest_lts_version: Some("1.4.0"),
        minimum_supported_version: Some("1.4.0"),
        source_label: "DuckDB releases",
        source_url: "https://github.com/duckdb/duckdb/releases",
    },
    VersionCatalogEntry {
        engine: "cockroachdb",
        latest_known_version: "26.2.0",
        latest_lts_version: None,
        minimum_supported_version: Some("25.2.0"),
        source_label: "CockroachDB releases",
        source_url: "https://www.cockroachlabs.com/docs/releases/",
    },
    VersionCatalogEntry {
        engine: "elasticsearch",
        latest_known_version: "9.4.3",
        latest_lts_version: Some("8.19.18"),
        minimum_supported_version: Some("8.19.0"),
        source_label: "Elasticsearch release notes",
        source_url: "https://www.elastic.co/docs/release-notes/elasticsearch",
    },
    VersionCatalogEntry {
        engine: "opensearch",
        latest_known_version: "3.7.0",
        latest_lts_version: None,
        minimum_supported_version: Some("2.19.0"),
        source_label: "OpenSearch downloads",
        source_url: "https://opensearch.org/downloads/",
    },
    VersionCatalogEntry {
        engine: "cassandra",
        latest_known_version: "5.0.8",
        latest_lts_version: None,
        minimum_supported_version: Some("4.0.0"),
        source_label: "Apache Cassandra downloads",
        source_url: "https://cassandra.apache.org/_/download.html",
    },
    VersionCatalogEntry {
        engine: "clickhouse",
        latest_known_version: "26.6.0",
        latest_lts_version: Some("26.3.0"),
        minimum_supported_version: Some("25.8.0"),
        source_label: "ClickHouse changelog",
        source_url: "https://clickhouse.com/docs/whats-new/changelog",
    },
];

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
                    posture_checks: Vec::new(),
                    warnings: Vec::new(),
                    errors: Vec::new(),
                });
            snapshot.status = if snapshot.findings.is_empty()
                && snapshot.targets.is_empty()
                && snapshot.posture_checks.is_empty()
            {
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
    let posture_checks = detect_posture_checks(runtime).await;
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
    source_metadata.push(DatastoreSecuritySourceMetadata {
        source: "version-catalog".into(),
        fetched_at: Some(checked_at.clone()),
        url: VERSION_CATALOG_URL.into(),
        record_count: Some(VERSION_CATALOG.len()),
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
                    if entry.affected_version_range.is_none() {
                        entry.affected_version_range = finding.affected_version_range;
                    }
                    if entry.fixed_version_hint.is_none() {
                        entry.fixed_version_hint = finding.fixed_version_hint;
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
        posture_checks,
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

async fn detect_posture_checks(
    runtime: &ManagedAppState,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let mut checks = Vec::new();
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
            let target_id = security_target_id(connection, &environment);
            checks.extend(profile_posture_checks(connection, &environment, &target_id));

            match runtime.resolve_connection_profile(connection, &environment.id) {
                Ok((resolved_connection, _, resolution_warnings)) => {
                    if has_unresolved_connection_tokens(&resolved_connection) {
                        checks.push(posture_check!(
                            &target_id,
                            "profile.variables-resolved",
                            "secrets",
                            "unknown",
                            "UNKNOWN",
                            "Connection variables unresolved",
                            "Posture probes need all connection variables to resolve before DataPad++ can inspect the datastore.",
                            Some("One or more connection fields still contains an unresolved environment token.".into()),
                            "Resolve the environment variables or secret references, then refresh Security Checks again.",
                            "profile",
                            Vec::new(),
                        ));
                    } else {
                        let mut probe_checks = engine_probe_posture_checks(
                            &resolved_connection,
                            connection,
                            &environment,
                            &target_id,
                        )
                        .await;
                        if !resolution_warnings.is_empty() {
                            for check in &mut probe_checks {
                                if check.evidence.is_none() {
                                    check.evidence = Some("Connection resolved with non-secret warnings.".into());
                                }
                            }
                        }
                        checks.extend(probe_checks);
                    }
                }
                Err(error) => checks.push(posture_check!(
                    &target_id,
                    "profile.resolve",
                    "secrets",
                    "unknown",
                    "UNKNOWN",
                    "Connection could not be resolved",
                    "Profile posture checks ran, but read-only datastore probes could not start because the connection did not resolve.",
                    Some(safe_error_evidence(&error.message)),
                    "Fix the connection profile or environment, then refresh Security Checks again.",
                    "profile",
                    Vec::new(),
                )),
            }
        }
    }

    checks.sort_by(|left, right| {
        posture_status_rank(&right.status)
            .cmp(&posture_status_rank(&left.status))
            .then_with(|| severity_rank(&right.severity).cmp(&severity_rank(&left.severity)))
            .then_with(|| left.rule_id.cmp(&right.rule_id))
    });
    checks
}

fn profile_posture_checks(
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let mut checks = Vec::new();
    let engine = normalized_engine_id(&connection.engine);
    let high_risk = is_high_risk_environment(environment);

    checks.push(if high_risk && !connection.read_only {
        posture_check!(
            target_id,
            "profile.high-risk-readonly",
            "environment",
            "fail",
            "HIGH",
            "High-risk environment is not read-only",
            "The connection is attached to a high or critical risk environment without the connection-level read-only guard.",
            Some(format!("Environment risk: {}. Connection read-only: false.", environment.risk)),
            "Enable read-only mode for production-like profiles or use a lower-risk environment for write-capable work.",
            "profile",
            Vec::new(),
        )
    } else {
        posture_check!(
            target_id,
            "profile.high-risk-readonly",
            "environment",
            "pass",
            "NONE",
            "Environment read-only posture is acceptable",
            "High-risk environments are read-only, or this connection is not attached to a high-risk environment.",
            Some(format!(
                "Environment risk: {}. Connection read-only: {}.",
                environment.risk, connection.read_only
            )),
            "Keep production-like connections read-only unless a workflow has explicit approval.",
            "profile",
            Vec::new(),
        )
    });

    checks.push(if high_risk && (!environment.requires_confirmation || !environment.safe_mode) {
        posture_check!(
            target_id,
            "profile.environment-guardrails",
            "environment",
            "warn",
            "MEDIUM",
            "High-risk environment guardrails are incomplete",
            "High or critical environments should require confirmation and safe mode before risky workflows execute.",
            Some(format!(
                "Requires confirmation: {}. Safe mode: {}.",
                environment.requires_confirmation, environment.safe_mode
            )),
            "Enable confirmation and safe mode on high-risk environments.",
            "profile",
            Vec::new(),
        )
    } else {
        posture_check!(
            target_id,
            "profile.environment-guardrails",
            "environment",
            "pass",
            "NONE",
            "Environment guardrails are acceptable",
            "Environment confirmation and safe-mode settings match the current risk level.",
            Some(format!(
                "Risk: {}. Requires confirmation: {}. Safe mode: {}.",
                environment.risk, environment.requires_confirmation, environment.safe_mode
            )),
            "Keep confirmation and safe mode enabled for production-like environments.",
            "profile",
            Vec::new(),
        )
    });

    if connection
        .connection_string
        .as_deref()
        .is_some_and(connection_string_appears_to_embed_credentials)
    {
        checks.push(posture_check!(
            target_id,
            "profile.connection-string-credentials",
            "secrets",
            "fail",
            "HIGH",
            "Connection string appears to embed credentials",
            "The saved profile includes a connection string shape that appears to contain credential material.",
            Some("Credential-like connection string parameters or URL user info were detected; values were not recorded.".into()),
            "Move passwords, access keys, tokens, and account keys into DataPad++ secret references or the OS secret store.",
            "profile",
            Vec::new(),
        ));
    } else {
        checks.push(posture_check!(
            target_id,
            "profile.connection-string-credentials",
            "secrets",
            "pass",
            "NONE",
            "No embedded connection-string credentials detected",
            "DataPad++ did not detect common credential patterns in the saved connection string.",
            None,
            "Continue storing secrets through secret references instead of inline connection strings.",
            "profile",
            Vec::new(),
        ));
    }

    checks.extend(secret_provider_posture_checks(
        connection,
        environment,
        target_id,
    ));
    if let Some(check) = transport_profile_posture_check(connection, &engine, target_id) {
        checks.push(check);
    }
    if let Some(check) = auth_profile_posture_check(connection, &engine, target_id) {
        checks.push(check);
    }
    if let Some(check) =
        emulator_or_local_endpoint_posture_check(connection, &engine, environment, target_id)
    {
        checks.push(check);
    }
    if let Some(check) = local_file_profile_posture_check(connection, &engine, target_id) {
        checks.push(check);
    }

    checks
}

fn secret_provider_posture_checks(
    connection: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let refs = connection_secret_refs(connection);
    if refs.is_empty() {
        return vec![posture_check!(
            target_id,
            "profile.secret-provider",
            "secrets",
            "unknown",
            "UNKNOWN",
            "No secret references are visible in this profile",
            "The connection profile does not expose secret references DataPad++ can classify for posture checks.",
            None,
            "Use DataPad++ secret references or an OS-backed secret provider for long-lived credentials.",
            "profile",
            Vec::new(),
        )];
    }

    let risky_refs = refs
        .iter()
        .filter(|secret_ref| matches!(secret_ref.provider.as_str(), "manual" | "session"))
        .count();
    if is_high_risk_environment(environment) && risky_refs > 0 {
        vec![posture_check!(
            target_id,
            "profile.secret-provider",
            "secrets",
            "warn",
            "MEDIUM",
            "High-risk profile uses temporary or manual secrets",
            "At least one secret reference uses a provider intended for manual or session-scoped secrets.",
            Some(format!("Secret references inspected: {}. Temporary/manual providers: {risky_refs}.", refs.len())),
            "Prefer OS keyring or desktop secret-store providers for high-risk or production-like connections.",
            "profile",
            Vec::new(),
        )]
    } else {
        vec![posture_check!(
            target_id,
            "profile.secret-provider",
            "secrets",
            "pass",
            "NONE",
            "Secret provider posture is acceptable",
            "Visible secret references do not use temporary/manual providers for a high-risk environment.",
            Some(format!("Secret references inspected: {}.", refs.len())),
            "Continue keeping credential values out of workspace JSON.",
            "profile",
            Vec::new(),
        )]
    }
}

fn transport_profile_posture_check(
    connection: &ConnectionProfile,
    engine: &str,
    target_id: &str,
) -> Option<DatastoreSecurityPostureCheckResult> {
    match engine {
        "sqlite" | "duckdb" | "litedb" => Some(posture_check!(
            target_id,
            "profile.transport",
            "transport",
            "notApplicable",
            "NONE",
            "Network transport is not applicable",
            "This datastore profile is local-file or in-memory, so network TLS checks do not apply.",
            None,
            "Review local file encryption and file permissions instead.",
            "profile",
            Vec::new(),
        )),
        "postgresql" | "timescaledb" | "cockroachdb" => {
            let ssl_mode = connection.auth.ssl_mode.as_deref().unwrap_or("unspecified");
            let postgres = connection.postgres_options.as_ref();
            let tls_disabled = ssl_mode == "disable" || postgres.and_then(|options| options.use_tls) == Some(false);
            let verify_disabled = postgres.and_then(|options| options.verify_server_certificate)
                == Some(false)
                || !matches!(ssl_mode, "verify-ca" | "verify-full");
            Some(transport_result(
                target_id,
                tls_disabled,
                verify_disabled,
                format!("SSL mode: {ssl_mode}. TLS option: {}.", option_bool_label(postgres.and_then(|options| options.use_tls))),
                postgres_security_references(),
            ))
        }
        "mysql" | "mariadb" => {
            let ssl_mode = connection
                .mysql_options
                .as_ref()
                .and_then(|options| options.ssl_mode.as_deref())
                .unwrap_or("unspecified");
            let tls_disabled = matches!(ssl_mode, "disabled");
            let verify_disabled = matches!(ssl_mode, "disabled" | "preferred" | "required" | "unspecified");
            Some(transport_result(
                target_id,
                tls_disabled,
                verify_disabled,
                format!("SSL mode: {ssl_mode}."),
                Vec::new(),
            ))
        }
        "sqlserver" | "mssql" => {
            let options = connection.sqlserver_options.as_ref();
            let encrypt = options.and_then(|options| options.encrypt_connection);
            let trust = options.and_then(|options| options.trust_server_certificate);
            Some(transport_result(
                target_id,
                encrypt == Some(false),
                trust == Some(true) || encrypt.is_none(),
                format!(
                    "Encrypt connection: {}. Trust server certificate: {}.",
                    option_bool_label(encrypt),
                    option_bool_label(trust)
                ),
                sqlserver_security_references(),
            ))
        }
        "mongodb" => {
            let options = connection.mongodb_options.as_ref();
            let tls = options.and_then(|options| options.tls);
            let scheme = options
                .and_then(|options| options.connection_scheme.as_deref())
                .unwrap_or("mongodb");
            Some(transport_result(
                target_id,
                tls == Some(false),
                tls.is_none() && scheme != "mongodb+srv",
                format!("Scheme: {scheme}. TLS option: {}.", option_bool_label(tls)),
                mongodb_security_references(),
            ))
        }
        "redis" | "valkey" => {
            let options = connection.redis_options.as_ref();
            let tls = options.and_then(|options| options.use_tls);
            let verify_disabled = options
                .and_then(|options| options.verify_server_certificate)
                == Some(false)
                || options.and_then(|options| options.allow_invalid_certificates) == Some(true)
                || options.and_then(|options| options.allow_invalid_hostnames) == Some(true);
            let deployment_mode = options
                .and_then(|options| options.deployment_mode.as_deref())
                .unwrap_or("standalone");
            Some(transport_result(
                target_id,
                tls == Some(false),
                verify_disabled || (tls.is_none() && deployment_mode != "tls"),
                format!("Deployment mode: {deployment_mode}. TLS: {}.", option_bool_label(tls)),
                redis_security_references(),
            ))
        }
        "elasticsearch" | "opensearch" => {
            let options = connection.search_options.as_ref();
            let use_tls = options.and_then(|options| options.use_tls);
            let endpoint = options.and_then(|options| options.endpoint_url.as_deref());
            let http_endpoint = endpoint.is_some_and(|value| value.to_ascii_lowercase().starts_with("http://"));
            let verify_disabled = options
                .and_then(|options| options.verify_certificates)
                == Some(false);
            Some(transport_result(
                target_id,
                use_tls == Some(false) || http_endpoint,
                verify_disabled || use_tls.is_none(),
                "Search endpoint TLS/certificate posture inspected from the saved profile.".into(),
                search_security_references(engine),
            ))
        }
        "cassandra" => {
            let tls = connection.cassandra_options.as_ref().and_then(|options| options.use_tls);
            Some(transport_result(
                target_id,
                tls == Some(false),
                tls.is_none(),
                format!("Cassandra TLS: {}.", option_bool_label(tls)),
                cassandra_security_references(),
            ))
        }
        "cosmosdb" => {
            let tls = connection.cosmos_db_options.as_ref().and_then(|options| options.use_tls);
            Some(transport_result(
                target_id,
                tls == Some(false),
                false,
                format!("Cosmos DB TLS: {}.", option_bool_label(tls)),
                cosmos_security_references(),
            ))
        }
        "oracle" => {
            let tls = connection.oracle_options.as_ref().and_then(|options| options.use_tls);
            Some(transport_result(
                target_id,
                tls == Some(false),
                tls.is_none(),
                format!("Oracle TCPS/TLS: {}.", option_bool_label(tls)),
                oracle_security_references(),
            ))
        }
        "prometheus" | "influxdb" | "opentsdb" => {
            let options = connection.time_series_options.as_ref();
            let use_tls = options.and_then(|options| options.use_tls);
            let endpoint = options.and_then(|options| options.endpoint_url.as_deref());
            Some(transport_result(
                target_id,
                use_tls == Some(false) || endpoint.is_some_and(|value| value.starts_with("http://")),
                options.and_then(|options| options.verify_certificates) == Some(false) || use_tls.is_none(),
                "Time-series endpoint TLS/certificate posture inspected from the saved profile.".into(),
                time_series_security_references(engine),
            ))
        }
        "neo4j" | "arango" | "arangodb" | "janusgraph" | "neptune" => {
            let options = connection.graph_options.as_ref();
            let use_tls = options.and_then(|options| options.use_tls);
            let endpoint = options.and_then(|options| options.endpoint_url.as_deref());
            Some(transport_result(
                target_id,
                use_tls == Some(false) || endpoint.is_some_and(|value| value.starts_with("http://")),
                options.and_then(|options| options.verify_certificates) == Some(false) || use_tls.is_none(),
                "Graph endpoint TLS/certificate posture inspected from the saved profile.".into(),
                graph_security_references(engine),
            ))
        }
        "clickhouse" | "snowflake" | "bigquery" => {
            let options = connection.warehouse_options.as_ref();
            let use_tls = options.and_then(|options| options.use_tls);
            let endpoint = options.and_then(|options| options.endpoint_url.as_deref());
            Some(transport_result(
                target_id,
                use_tls == Some(false) || endpoint.is_some_and(|value| value.starts_with("http://")),
                options.and_then(|options| options.verify_certificates) == Some(false),
                "Warehouse endpoint TLS/certificate posture inspected from the saved profile.".into(),
                warehouse_security_references(engine),
            ))
        }
        "dynamodb" => None,
        "memcached" => Some(posture_check!(
            target_id,
            "profile.transport",
            "transport",
            "unknown",
            "UNKNOWN",
            "Memcached TLS posture cannot be confirmed from this profile",
            "Memcached supports TLS in modern builds, but this profile does not expose a dedicated TLS setting.",
            None,
            "Keep Memcached on a private backend network or use a TLS-capable deployment and client path.",
            "profile",
            memcached_security_references(),
        )),
        _ => None,
    }
}

fn auth_profile_posture_check(
    connection: &ConnectionProfile,
    engine: &str,
    target_id: &str,
) -> Option<DatastoreSecurityPostureCheckResult> {
    match engine {
        "redis" | "valkey" => {
            let has_auth = connection.auth.secret_ref.is_some()
                || connection
                    .auth
                    .username
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty());
            Some(auth_result(
                target_id,
                !has_auth,
                "Redis/Valkey profile does not show an ACL username or secret reference.",
                redis_security_references(),
            ))
        }
        "mongodb" => {
            let has_auth = connection.auth.secret_ref.is_some()
                || connection
                    .auth
                    .username
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty());
            Some(auth_result(
                target_id,
                !has_auth,
                "MongoDB profile does not show a username or secret reference.",
                mongodb_security_references(),
            ))
        }
        "elasticsearch" | "opensearch" => {
            let auth_mode = connection
                .search_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("none");
            Some(auth_result(
                target_id,
                auth_mode == "none",
                "Search auth mode is set to none.",
                search_security_references(engine),
            ))
        }
        "memcached" => {
            let auth_mode = connection
                .memcached_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("none");
            Some(auth_result(
                target_id,
                auth_mode == "none",
                "Memcached auth mode is none.",
                memcached_security_references(),
            ))
        }
        "cassandra" => {
            let auth_provider = connection
                .cassandra_options
                .as_ref()
                .and_then(|options| options.auth_provider.as_deref())
                .unwrap_or("none");
            Some(auth_result(
                target_id,
                auth_provider == "none",
                "Cassandra auth provider is none.",
                cassandra_security_references(),
            ))
        }
        "cosmosdb" => {
            let auth_mode = connection
                .cosmos_db_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("unspecified");
            let status = if matches!(auth_mode, "account-key" | "connection-string") {
                (
                    "warn",
                    "MEDIUM",
                    "Cosmos DB profile uses key-based authentication",
                )
            } else {
                (
                    "pass",
                    "NONE",
                    "Cosmos DB profile does not prefer account-key authentication",
                )
            };
            Some(posture_check!(
                target_id,
                "profile.auth-mode",
                "auth",
                status.0,
                status.1,
                status.2,
                "Identity-based auth is easier to scope, rotate, and audit than broad account keys where available.",
                Some(format!("Auth mode: {auth_mode}.")),
                "Prefer Entra ID, managed identity, or resource-scoped tokens when the target supports them.",
                "profile",
                cosmos_security_references(),
            ))
        }
        "dynamodb" => {
            let provider = connection
                .dynamo_db_options
                .as_ref()
                .and_then(|options| options.credentials_provider.as_deref())
                .unwrap_or("default-chain");
            let static_keys = matches!(provider, "static-keys" | "session-token")
                || connection
                    .dynamo_db_options
                    .as_ref()
                    .is_some_and(|options| options.access_key_id.is_some());
            Some(posture_check!(
                target_id,
                "profile.auth-mode",
                "cloud",
                if static_keys { "warn" } else { "pass" },
                if static_keys { "MEDIUM" } else { "NONE" },
                if static_keys {
                    "DynamoDB profile uses static access-key style credentials"
                } else {
                    "DynamoDB credential provider posture is acceptable"
                },
                "Role, profile, and instance/container credential providers are usually easier to rotate and scope than static access keys.",
                Some(format!("Credential provider: {provider}.")),
                "Prefer AWS profile, AssumeRole, web identity, ECS task, or EC2 metadata providers for long-lived profiles.",
                "profile",
                dynamodb_security_references(),
            ))
        }
        "prometheus" | "influxdb" | "opentsdb" => {
            let auth_mode = connection
                .time_series_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("none");
            Some(auth_result(
                target_id,
                auth_mode == "none",
                "Time-series auth mode is none.",
                time_series_security_references(engine),
            ))
        }
        "neo4j" | "arango" | "arangodb" | "janusgraph" | "neptune" => {
            let auth_mode = connection
                .graph_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("none");
            Some(auth_result(
                target_id,
                auth_mode == "none",
                "Graph auth mode is none.",
                graph_security_references(engine),
            ))
        }
        "clickhouse" | "snowflake" | "bigquery" => {
            let auth_mode = connection
                .warehouse_options
                .as_ref()
                .and_then(|options| options.auth_mode.as_deref())
                .unwrap_or("unspecified");
            let risky = matches!(auth_mode, "none" | "basic");
            Some(posture_check!(
                target_id,
                "profile.auth-mode",
                "auth",
                if risky { "warn" } else { "pass" },
                if risky { "MEDIUM" } else { "NONE" },
                if risky {
                    "Warehouse auth posture should be reviewed"
                } else {
                    "Warehouse auth posture is acceptable"
                },
                "Cloud and warehouse profiles are safer with scoped token, OAuth, service-account, or cloud-default identity where available.",
                Some(format!("Auth mode: {auth_mode}.")),
                "Prefer scoped identity-based auth for shared or production-like warehouse connections.",
                "profile",
                warehouse_security_references(engine),
            ))
        }
        _ => None,
    }
}

fn emulator_or_local_endpoint_posture_check(
    connection: &ConnectionProfile,
    engine: &str,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Option<DatastoreSecurityPostureCheckResult> {
    let high_risk = is_high_risk_environment(environment);
    let local_endpoint = match engine {
        "dynamodb" => connection
            .dynamo_db_options
            .as_ref()
            .and_then(|options| options.connect_mode.as_deref())
            .is_some_and(|mode| matches!(mode, "local-endpoint" | "endpoint-override")),
        "cosmosdb" => {
            connection
                .cosmos_db_options
                .as_ref()
                .and_then(|options| options.connect_mode.as_deref())
                == Some("emulator")
        }
        _ => false,
    };

    local_endpoint.then(|| {
        posture_check!(
            target_id,
            "profile.local-or-emulator-endpoint",
            "environment",
            if high_risk { "warn" } else { "pass" },
            if high_risk { "MEDIUM" } else { "NONE" },
            if high_risk {
                "Local/emulator endpoint is attached to a high-risk environment"
            } else {
                "Local/emulator endpoint posture is acceptable"
            },
            "Local and emulator endpoints are useful for fixtures, but they can be confusing when attached to production-like environments.",
            Some(format!("Environment risk: {}.", environment.risk)),
            "Use a low-risk fixture environment for emulator endpoints, or rename the environment/profile to make the boundary explicit.",
            "profile",
            Vec::new(),
        )
    })
}

fn local_file_profile_posture_check(
    connection: &ConnectionProfile,
    engine: &str,
    target_id: &str,
) -> Option<DatastoreSecurityPostureCheckResult> {
    match engine {
        "sqlite" => {
            let options = connection.sqlite_options.as_ref();
            let encryption = options
                .and_then(|options| options.encryption_provider.as_deref())
                .unwrap_or("none");
            let open_mode = options
                .and_then(|options| options.open_mode.as_deref())
                .unwrap_or("unspecified");
            let encrypted = encryption != "none"
                && options
                    .and_then(|options| options.encryption_key_secret_ref.as_ref())
                    .is_some();
            Some(posture_check!(
                target_id,
                "profile.local-file-encryption",
                "local-file",
                if encrypted { "pass" } else { "warn" },
                if encrypted { "NONE" } else { "LOW" },
                if encrypted {
                    "SQLite encryption posture is configured"
                } else {
                    "SQLite file encryption is not configured"
                },
                "Local database files can be copied outside DataPad++ guardrails, so sensitive fixtures should use encryption or OS-level disk protection.",
                Some(format!("Open mode: {open_mode}. Encryption provider: {encryption}.")),
                "Use SQLCipher/provider-specific encryption for sensitive local files, or keep the file under an encrypted volume.",
                "profile",
                sqlite_security_references(),
            ))
        }
        "duckdb" => {
            let options = connection.warehouse_options.as_ref();
            let mode = options
                .and_then(|options| options.connect_mode.as_deref())
                .unwrap_or("duckdb-file");
            Some(posture_check!(
                target_id,
                "profile.local-file-encryption",
                "local-file",
                "unknown",
                "UNKNOWN",
                "DuckDB file encryption is not confirmed",
                "DuckDB file profiles can reference local data and external files; DataPad++ cannot confirm at-rest encryption from this profile.",
                Some(format!("Connect mode: {mode}.")),
                "Keep sensitive DuckDB files under OS-level disk encryption and use read-only profiles for inspection.",
                "profile",
                duckdb_security_references(),
            ))
        }
        _ => None,
    }
}

fn transport_result(
    target_id: &str,
    tls_disabled: bool,
    verification_weak: bool,
    evidence: String,
    references: Vec<DatastoreSecurityFindingReference>,
) -> DatastoreSecurityPostureCheckResult {
    let (status, severity, title, summary, remediation) = if tls_disabled {
        (
            "fail",
            "HIGH",
            "Transport encryption is disabled",
            "The saved connection profile allows an unencrypted datastore connection.",
            "Require TLS for network datastore connections, especially outside local fixture environments.",
        )
    } else if verification_weak {
        (
            "warn",
            "MEDIUM",
            "Transport certificate verification should be tightened",
            "The profile does not require full certificate or hostname verification.",
            "Require CA or hostname verification where the datastore and driver support it.",
        )
    } else {
        (
            "pass",
            "NONE",
            "Transport encryption posture is acceptable",
            "The profile requires TLS and does not explicitly disable certificate verification.",
            "Keep TLS and certificate verification enabled for shared environments.",
        )
    };

    posture_check!(
        target_id,
        "profile.transport",
        "transport",
        status,
        severity,
        title,
        summary,
        Some(evidence),
        remediation,
        "profile",
        references,
    )
}

fn auth_result(
    target_id: &str,
    missing_auth: bool,
    evidence: &str,
    references: Vec<DatastoreSecurityFindingReference>,
) -> DatastoreSecurityPostureCheckResult {
    posture_check!(
        target_id,
        "profile.auth-mode",
        "auth",
        if missing_auth { "fail" } else { "pass" },
        if missing_auth { "HIGH" } else { "NONE" },
        if missing_auth {
            "Authentication is not configured in the profile"
        } else {
            "Authentication posture is acceptable"
        },
        if missing_auth {
            "The profile appears to use no authentication or does not expose a credential reference."
        } else {
            "The profile exposes an authentication mode or secret reference DataPad++ can recognize."
        },
        Some(evidence.into()),
        "Require authentication and use least-privilege credentials for saved datastore profiles.",
        "profile",
        references,
    )
}

async fn engine_probe_posture_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    match normalized_engine_id(&connection.engine).as_str() {
        "postgresql" | "timescaledb" | "cockroachdb" => {
            postgres_family_probe_checks(connection, profile, environment, target_id).await
        }
        "mysql" | "mariadb" => {
            mysql_family_probe_checks(connection, profile, environment, target_id).await
        }
        "sqlserver" | "mssql" => {
            sqlserver_probe_checks(connection, profile, environment, target_id).await
        }
        "mongodb" => mongodb_probe_checks(connection, profile, environment, target_id).await,
        "redis" | "valkey" => {
            redis_family_probe_checks(connection, profile, environment, target_id).await
        }
        "sqlite" => sqlite_probe_checks(connection, profile, environment, target_id).await,
        "duckdb" => duckdb_probe_checks(connection, profile, environment, target_id).await,
        "elasticsearch" | "opensearch" => search_profile_deep_checks(profile, target_id),
        _ => Vec::new(),
    }
}

async fn postgres_family_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let query = "select current_user as current_user, coalesce((select rolsuper from pg_roles where rolname = current_user), false) as rolsuper, coalesce((select rolcreatedb from pg_roles where rolname = current_user), false) as rolcreatedb, coalesce((select rolcreaterole from pg_roles where rolname = current_user), false) as rolcreaterole, coalesce((select rolreplication from pg_roles where rolname = current_user), false) as rolreplication, coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as rolbypassrls, has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create";
    let payloads = match execute_posture_probe(
        connection,
        profile,
        environment,
        "postgresql.role-posture",
        "sql",
        query,
    )
    .await
    {
        Ok(payloads) => payloads,
        Err(error) => {
            return vec![probe_unknown(
                target_id,
                "postgresql.role-posture",
                "privileges",
                "PostgreSQL role posture could not be inspected",
                error,
                postgres_security_references(),
            )]
        }
    };

    vec![
        bool_probe_check!(
            target_id,
            "postgresql.superuser",
            "privileges",
            payload_bool(&payloads, &["rolsuper", "is_superuser"]).unwrap_or(false),
            "fail",
            "HIGH",
            "Current role has superuser privileges",
            "Current role is not a superuser",
            "The current PostgreSQL role can bypass ordinary permission boundaries.",
            "Use a non-superuser role for routine inspection and saved query workflows.",
            postgres_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "postgresql.role-management",
            "privileges",
            payload_bool(&payloads, &["rolcreaterole"]).unwrap_or(false),
            "warn",
            "MEDIUM",
            "Current role can create or manage roles",
            "Current role cannot create roles",
            "Role-management privileges are broader than needed for read-only inspection.",
            "Use a role without CREATEROLE for day-to-day DataPad++ profiles.",
            postgres_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "postgresql.bypass-rls",
            "privileges",
            payload_bool(&payloads, &["rolbypassrls"]).unwrap_or(false),
            "fail",
            "HIGH",
            "Current role can bypass row-level security",
            "Current role cannot bypass row-level security",
            "BYPASSRLS can expose rows hidden by table policies.",
            "Use a role without BYPASSRLS unless this profile is explicitly for administration.",
            postgres_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "postgresql.public-schema-create",
            "privileges",
            payload_bool(&payloads, &["public_schema_create"]).unwrap_or(false),
            "warn",
            "MEDIUM",
            "Current role can create objects in public schema",
            "Current role cannot create objects in public schema",
            "CREATE on public can allow accidental or unwanted object creation in shared schemas.",
            "Revoke public-schema CREATE from routine users where application compatibility allows.",
            postgres_security_references(),
        ),
    ]
}

async fn mysql_family_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let mut checks = Vec::new();
    let query = "select @@require_secure_transport as require_secure_transport, @@local_infile as local_infile, @@secure_file_priv as secure_file_priv, current_user() as current_user";
    match execute_posture_probe(
        connection,
        profile,
        environment,
        "mysql.server-security-settings",
        "sql",
        query,
    )
    .await
    {
        Ok(payloads) => {
            checks.push(bool_probe_check!(
                target_id,
                "mysql.require-secure-transport",
                "transport",
                !payload_bool(&payloads, &["require_secure_transport"]).unwrap_or(false),
                "fail",
                "HIGH",
                "Server does not require secure transport",
                "Server requires secure transport",
                "MySQL/MariaDB can accept plaintext client connections when secure transport is not required.",
                "Enable require_secure_transport where supported and use verifying TLS client settings.",
                Vec::new(),
            ));
            checks.push(bool_probe_check!(
                target_id,
                "mysql.local-infile",
                "risky-settings",
                payload_bool(&payloads, &["local_infile"]).unwrap_or(false),
                "warn",
                "MEDIUM",
                "LOCAL INFILE is enabled",
                "LOCAL INFILE is not enabled",
                "LOCAL INFILE can expand the file access surface for clients and import workflows.",
                "Disable LOCAL INFILE unless this profile specifically needs local file imports.",
                Vec::new(),
            ));
            let secure_file_priv =
                payload_text_field(&payloads, &["secure_file_priv"]).unwrap_or_default();
            checks.push(posture_check!(
                target_id,
                "mysql.secure-file-priv",
                "risky-settings",
                if secure_file_priv.trim().is_empty() { "warn" } else { "pass" },
                if secure_file_priv.trim().is_empty() { "MEDIUM" } else { "NONE" },
                if secure_file_priv.trim().is_empty() {
                    "Server-side file import/export directory is unrestricted"
                } else {
                    "Server-side file import/export directory is restricted"
                },
                "secure_file_priv constrains server-side file import/export locations.",
                Some(if secure_file_priv.trim().is_empty() {
                    "secure_file_priv is empty or unavailable.".into()
                } else {
                    "secure_file_priv is configured.".into()
                }),
                "Set secure_file_priv to a controlled directory or NULL unless server-side file workflows are required.",
                "read-only-probe",
                Vec::new(),
            ));
        }
        Err(error) => checks.push(probe_unknown(
            target_id,
            "mysql.server-security-settings",
            "risky-settings",
            "MySQL/MariaDB server settings could not be inspected",
            error,
            Vec::new(),
        )),
    }

    match execute_posture_probe(
        connection,
        profile,
        environment,
        "mysql.current-grants",
        "sql",
        "show grants for current_user()",
    )
    .await
    {
        Ok(payloads) => {
            let grants = payload_text(&payloads).to_ascii_uppercase();
            let broad = [
                "ALL PRIVILEGES",
                "GRANT OPTION",
                " SUPER",
                "`SUPER`",
                " FILE",
                "`FILE`",
            ]
            .iter()
            .any(|needle| grants.contains(needle));
            checks.push(posture_check!(
                target_id,
                "mysql.current-grants",
                "privileges",
                if broad { "warn" } else { "pass" },
                if broad { "HIGH" } else { "NONE" },
                if broad {
                    "Current MySQL/MariaDB grants appear broad"
                } else {
                    "Current MySQL/MariaDB grants do not look broadly administrative"
                },
                "The current account grant text was scanned for broad administrative privileges without storing credential values.",
                Some(if broad {
                    "Grant text contains administrative privilege keywords.".into()
                } else {
                    "No broad administrative grant keywords detected.".into()
                }),
                "Use a least-privilege account for routine DataPad++ connections.",
                "read-only-probe",
                Vec::new(),
            ));
        }
        Err(error) => checks.push(probe_unknown(
            target_id,
            "mysql.current-grants",
            "privileges",
            "Current MySQL/MariaDB grants could not be inspected",
            error,
            Vec::new(),
        )),
    }

    checks
}

async fn sqlserver_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let query = "select is_srvrolemember('sysadmin') as is_sysadmin, is_member('db_owner') as is_db_owner, cast((select value_in_use from sys.configurations where name = 'xp_cmdshell') as int) as xp_cmdshell, cast((select value_in_use from sys.configurations where name = 'clr enabled') as int) as clr_enabled, cast((select value_in_use from sys.configurations where name = 'Ole Automation Procedures') as int) as ole_automation, cast((select value_in_use from sys.configurations where name = 'Ad Hoc Distributed Queries') as int) as ad_hoc_distributed_queries, cast(databasepropertyex(db_name(), 'IsEncrypted') as int) as database_encrypted, cast(databasepropertyex(db_name(), 'IsTrustworthy') as int) as trustworthy";
    let payloads = match execute_posture_probe(
        connection,
        profile,
        environment,
        "sqlserver.security-settings",
        "sql",
        query,
    )
    .await
    {
        Ok(payloads) => payloads,
        Err(error) => {
            return vec![probe_unknown(
                target_id,
                "sqlserver.security-settings",
                "privileges",
                "SQL Server security settings could not be inspected",
                error,
                sqlserver_security_references(),
            )]
        }
    };

    vec![
        bool_probe_check!(
            target_id,
            "sqlserver.sysadmin",
            "privileges",
            payload_bool(&payloads, &["is_sysadmin"]).unwrap_or(false),
            "fail",
            "HIGH",
            "Current login is sysadmin",
            "Current login is not sysadmin",
            "sysadmin is broader than needed for routine datastore inspection.",
            "Use a least-privilege login or database role for DataPad++ profiles.",
            sqlserver_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "sqlserver.db-owner",
            "privileges",
            payload_bool(&payloads, &["is_db_owner"]).unwrap_or(false),
            "warn",
            "MEDIUM",
            "Current user is db_owner",
            "Current user is not db_owner",
            "db_owner can perform broad database changes.",
            "Use reader or narrowly scoped database roles for routine inspection.",
            sqlserver_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "sqlserver.xp-cmdshell",
            "risky-settings",
            payload_bool(&payloads, &["xp_cmdshell"]).unwrap_or(false),
            "fail",
            "HIGH",
            "xp_cmdshell is enabled",
            "xp_cmdshell is not enabled",
            "xp_cmdshell expands SQL Server into operating-system command execution.",
            "Keep xp_cmdshell disabled unless a tightly controlled administrative workflow requires it.",
            sqlserver_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "sqlserver.trustworthy",
            "risky-settings",
            payload_bool(&payloads, &["trustworthy"]).unwrap_or(false),
            "warn",
            "MEDIUM",
            "Database TRUSTWORTHY is enabled",
            "Database TRUSTWORTHY is not enabled",
            "TRUSTWORTHY can increase privilege-escalation risk for database code.",
            "Disable TRUSTWORTHY unless the database has a reviewed requirement.",
            sqlserver_security_references(),
        ),
    ]
}

async fn mongodb_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let command = r#"{"operation":"runCommand","database":"admin","command":{"connectionStatus":1,"showPrivileges":false}}"#;
    let payloads = match execute_posture_probe(
        connection,
        profile,
        environment,
        "mongodb.connection-status",
        "json",
        command,
    )
    .await
    {
        Ok(payloads) => payloads,
        Err(error) => {
            return vec![probe_unknown(
                target_id,
                "mongodb.connection-status",
                "privileges",
                "MongoDB authenticated role posture could not be inspected",
                error,
                mongodb_security_references(),
            )]
        }
    };

    let text = payload_text(&payloads);
    let lower = text.to_ascii_lowercase();
    let broad_roles = [
        "root",
        "clusteradmin",
        "useradminanydatabase",
        "dbadminanydatabase",
        "readwriteanydatabase",
    ]
    .iter()
    .filter(|role| lower.contains(**role))
    .count();
    let authenticated =
        lower.contains("authenticatedusers") || lower.contains("authenticateduserroles");
    vec![
        posture_check!(
            target_id,
            "mongodb.broad-roles",
            "privileges",
            if broad_roles > 0 { "warn" } else if authenticated { "pass" } else { "unknown" },
            if broad_roles > 0 { "HIGH" } else if authenticated { "NONE" } else { "UNKNOWN" },
            if broad_roles > 0 {
                "MongoDB authenticated user has broad roles"
            } else if authenticated {
                "MongoDB authenticated roles do not look broadly administrative"
            } else {
                "MongoDB authentication role details were not visible"
            },
            "The connectionStatus response was scanned for broad built-in roles.",
            Some(if broad_roles > 0 {
                format!("Broad role names detected: {broad_roles}.")
            } else {
                "No broad built-in role names detected in visible role metadata.".into()
            }),
            "Use a user with only the database and collection privileges needed for the intended workflow.",
            "read-only-probe",
            mongodb_security_references(),
        ),
        posture_check!(
            target_id,
            "mongodb.admin-auth-source",
            "auth",
            if profile
                .mongodb_options
                .as_ref()
                .and_then(|options| options.auth_source.as_deref())
                == Some("admin")
            {
                "warn"
            } else {
                "pass"
            },
            if profile
                .mongodb_options
                .as_ref()
                .and_then(|options| options.auth_source.as_deref())
                == Some("admin")
            {
                "MEDIUM"
            } else {
                "NONE"
            },
            "MongoDB authSource reviewed",
            "The saved MongoDB authSource was checked for broad admin-database usage.",
            Some(format!(
                "authSource: {}.",
                profile
                    .mongodb_options
                    .as_ref()
                    .and_then(|options| options.auth_source.as_deref())
                    .unwrap_or("unspecified")
            )),
            "Use database-scoped users where practical; keep admin-database users reserved for administration.",
            "profile",
            mongodb_security_references(),
        ),
    ]
}

async fn redis_family_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let mut checks = Vec::new();
    match execute_posture_probe(
        connection,
        profile,
        environment,
        "redis.acl-whoami",
        "text",
        "ACL WHOAMI",
    )
    .await
    {
        Ok(payloads) => {
            let whoami = payload_text(&payloads).to_ascii_lowercase();
            checks.push(posture_check!(
                target_id,
                "redis.default-user",
                "auth",
                if whoami.contains("default") { "warn" } else { "pass" },
                if whoami.contains("default") { "MEDIUM" } else { "NONE" },
                if whoami.contains("default") {
                    "Redis/Valkey connection uses the default ACL user"
                } else {
                    "Redis/Valkey connection uses a named ACL user"
                },
                "Named ACL users make command/key scoping easier to review than the default user.",
                Some(if whoami.contains("default") {
                    "ACL WHOAMI returned default.".into()
                } else {
                    "ACL WHOAMI returned a non-default user.".into()
                }),
                "Use a named ACL user with only the command categories and key patterns this profile needs.",
                "read-only-probe",
                redis_security_references(),
            ));
        }
        Err(error) => checks.push(probe_unknown(
            target_id,
            "redis.acl-whoami",
            "auth",
            "Redis/Valkey ACL user could not be inspected",
            error,
            redis_security_references(),
        )),
    }

    match execute_posture_probe(
        connection,
        profile,
        environment,
        "redis.protected-mode",
        "text",
        "CONFIG GET protected-mode",
    )
    .await
    {
        Ok(payloads) => {
            let text = payload_text(&payloads).to_ascii_lowercase();
            let disabled = text.contains("no") || text.contains("false") || text.contains("\"0\"");
            checks.push(posture_check!(
                target_id,
                "redis.protected-mode",
                "transport",
                if disabled { "fail" } else { "pass" },
                if disabled { "HIGH" } else { "NONE" },
                if disabled {
                    "Redis/Valkey protected mode appears disabled"
                } else {
                    "Redis/Valkey protected mode is not reported as disabled"
                },
                "Protected mode reduces the chance of accidental unauthenticated exposure on unsafe network bindings.",
                Some("CONFIG GET protected-mode completed; raw values were not stored.".into()),
                "Keep protected mode enabled unless the deployment has explicit network and auth controls.",
                "read-only-probe",
                redis_security_references(),
            ));
        }
        Err(error) => checks.push(probe_unknown(
            target_id,
            "redis.protected-mode",
            "transport",
            "Redis/Valkey protected-mode setting could not be inspected",
            error,
            redis_security_references(),
        )),
    }

    match execute_posture_probe(
        connection,
        profile,
        environment,
        "redis.persistence",
        "text",
        "INFO persistence",
    )
    .await
    {
        Ok(payloads) => {
            let text = payload_text(&payloads).to_ascii_lowercase();
            let aof_disabled = text.contains("aof_enabled:0");
            checks.push(posture_check!(
                target_id,
                "redis.persistence",
                "durability",
                if aof_disabled { "warn" } else { "pass" },
                if aof_disabled { "LOW" } else { "NONE" },
                if aof_disabled {
                    "Redis/Valkey append-only persistence is disabled"
                } else {
                    "Redis/Valkey persistence posture is acceptable"
                },
                "Persistence may be intentionally disabled for pure caches, but durable Redis workloads should make that choice explicit.",
                Some("INFO persistence completed; only posture summary was retained.".into()),
                "If this datastore stores non-cache data, enable and monitor appropriate persistence.",
                "read-only-probe",
                redis_security_references(),
            ));
        }
        Err(error) => checks.push(probe_unknown(
            target_id,
            "redis.persistence",
            "durability",
            "Redis/Valkey persistence could not be inspected",
            error,
            redis_security_references(),
        )),
    }

    checks
}

async fn sqlite_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let query = "select (select journal_mode from pragma_journal_mode) as journal_mode, (select synchronous from pragma_synchronous) as synchronous, (select foreign_keys from pragma_foreign_keys) as foreign_keys, (select trusted_schema from pragma_trusted_schema) as trusted_schema, (select secure_delete from pragma_secure_delete) as secure_delete";
    let payloads = match execute_posture_probe(
        connection,
        profile,
        environment,
        "sqlite.pragmas",
        "sql",
        query,
    )
    .await
    {
        Ok(payloads) => payloads,
        Err(error) => {
            return vec![probe_unknown(
                target_id,
                "sqlite.pragmas",
                "durability",
                "SQLite PRAGMA posture could not be inspected",
                error,
                sqlite_security_references(),
            )]
        }
    };
    let journal = payload_text_field(&payloads, &["journal_mode"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let synchronous = payload_text_field(&payloads, &["synchronous"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    vec![
        posture_check!(
            target_id,
            "sqlite.journal-mode",
            "durability",
            if journal == "off" { "fail" } else { "pass" },
            if journal == "off" { "MEDIUM" } else { "NONE" },
            if journal == "off" {
                "SQLite journaling is off"
            } else {
                "SQLite journaling is enabled"
            },
            "SQLite journaling protects local files from partial writes and corruption.",
            Some(format!("journal_mode: {}.", if journal.is_empty() { "unknown" } else { &journal })),
            "Avoid journal_mode=OFF for sensitive or important local database files.",
            "read-only-probe",
            sqlite_security_references(),
        ),
        posture_check!(
            target_id,
            "sqlite.synchronous",
            "durability",
            if synchronous == "0" || synchronous == "off" { "warn" } else { "pass" },
            if synchronous == "0" || synchronous == "off" { "LOW" } else { "NONE" },
            if synchronous == "0" || synchronous == "off" {
                "SQLite synchronous mode is off"
            } else {
                "SQLite synchronous mode is not off"
            },
            "synchronous=OFF trades durability for speed.",
            Some(format!("synchronous: {}.", if synchronous.is_empty() { "unknown" } else { &synchronous })),
            "Use NORMAL, FULL, or EXTRA for files where durability matters.",
            "read-only-probe",
            sqlite_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "sqlite.foreign-keys",
            "risky-settings",
            !payload_bool(&payloads, &["foreign_keys"]).unwrap_or(true),
            "warn",
            "LOW",
            "SQLite foreign key enforcement is disabled",
            "SQLite foreign key enforcement is enabled",
            "Disabled foreign key enforcement can let local fixtures drift away from expected relational constraints.",
            "Enable PRAGMA foreign_keys for profiles that should enforce relational integrity.",
            sqlite_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "sqlite.trusted-schema",
            "risky-settings",
            payload_bool(&payloads, &["trusted_schema"]).unwrap_or(false),
            "warn",
            "LOW",
            "SQLite trusted_schema is enabled",
            "SQLite trusted_schema is not enabled",
            "trusted_schema can allow schema content to influence execution of application-defined SQL functions.",
            "Disable trusted_schema for untrusted local database files where supported.",
            sqlite_security_references(),
        ),
    ]
}

async fn duckdb_probe_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let query = "select current_setting('enable_external_access') as enable_external_access, current_setting('allow_unsigned_extensions') as allow_unsigned_extensions";
    let payloads = match execute_posture_probe(
        connection,
        profile,
        environment,
        "duckdb.settings",
        "sql",
        query,
    )
    .await
    {
        Ok(payloads) => payloads,
        Err(error) => {
            return vec![probe_unknown(
                target_id,
                "duckdb.settings",
                "risky-settings",
                "DuckDB security settings could not be inspected",
                error,
                duckdb_security_references(),
            )]
        }
    };

    vec![
        bool_probe_check!(
            target_id,
            "duckdb.external-access",
            "risky-settings",
            payload_bool(&payloads, &["enable_external_access"]).unwrap_or(true),
            "warn",
            "MEDIUM",
            "DuckDB external access is enabled",
            "DuckDB external access is disabled",
            "External access allows DuckDB to reach local or remote state through extensions, files, and COPY-style workflows.",
            "Disable external access for untrusted local files or high-risk environments unless the workflow needs it.",
            duckdb_security_references(),
        ),
        bool_probe_check!(
            target_id,
            "duckdb.unsigned-extensions",
            "risky-settings",
            payload_bool(&payloads, &["allow_unsigned_extensions"]).unwrap_or(false),
            "fail",
            "HIGH",
            "DuckDB unsigned extensions are allowed",
            "DuckDB unsigned extensions are not allowed",
            "Unsigned extension loading can execute untrusted native code.",
            "Keep unsigned extensions disabled outside isolated development workflows.",
            duckdb_security_references(),
        ),
    ]
}

fn search_profile_deep_checks(
    profile: &ConnectionProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let engine = normalized_engine_id(&profile.engine);
    let options = profile.search_options.as_ref();
    let auth_mode = options
        .and_then(|options| options.auth_mode.as_deref())
        .unwrap_or("none");
    let sniffing = options
        .and_then(|options| options.sniff_on_start)
        .unwrap_or(false);
    vec![
        posture_check!(
            target_id,
            "search.anonymous-auth",
            "auth",
            if auth_mode == "none" { "fail" } else { "pass" },
            if auth_mode == "none" { "HIGH" } else { "NONE" },
            if auth_mode == "none" {
                "Search profile allows anonymous/no-auth access"
            } else {
                "Search profile uses an authentication mode"
            },
            "Elasticsearch/OpenSearch clusters should require authentication for search and admin APIs.",
            Some(format!("Auth mode: {auth_mode}.")),
            "Use API keys, service tokens, basic auth, or SigV4/IAM where appropriate.",
            "profile",
            search_security_references(&engine),
        ),
        posture_check!(
            target_id,
            "search.sniff-on-start",
            "transport",
            if sniffing { "warn" } else { "pass" },
            if sniffing { "LOW" } else { "NONE" },
            if sniffing {
                "Search client sniffing is enabled"
            } else {
                "Search client sniffing is not enabled"
            },
            "Sniffing can discover additional cluster nodes and may bypass intended endpoint boundaries in managed or proxied deployments.",
            Some(format!("Sniff on start: {sniffing}.")),
            "Disable sniffing for managed, proxied, or tightly scoped endpoints unless it is explicitly needed.",
            "profile",
            search_security_references(&engine),
        ),
    ]
}

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
    #[serde(default)]
    configurations: Vec<NvdConfiguration>,
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

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdConfiguration {
    #[serde(default)]
    nodes: Vec<NvdConfigurationNode>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdConfigurationNode {
    #[serde(default)]
    cpe_match: Vec<NvdCpeMatch>,
    #[serde(default)]
    children: Vec<NvdConfigurationNode>,
}

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdCpeMatch {
    #[serde(default)]
    vulnerable: bool,
    #[serde(default)]
    criteria: String,
    #[serde(default)]
    version_start_including: Option<String>,
    #[serde(default)]
    version_start_excluding: Option<String>,
    #[serde(default)]
    version_end_including: Option<String>,
    #[serde(default)]
    version_end_excluding: Option<String>,
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
    let affected_version_range = nvd_affected_version_range(&cve.configurations);
    let fixed_version_hint = nvd_fixed_version_hint(&cve.configurations);
    let kev = kev_map.get(&cve.id);
    let known_exploited = kev.is_some();
    let remediation = kev
        .map(|entry| entry.required_action.clone())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            fixed_version_hint
                .as_ref()
                .map(|hint| format!("Review the vendor advisory and upgrade to a version outside the affected range ({hint})."))
        })
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
        affected_version_range,
        fixed_version_hint,
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

fn nvd_affected_version_range(configurations: &[NvdConfiguration]) -> Option<String> {
    let mut ranges = BTreeSet::new();
    for cpe_match in vulnerable_nvd_cpe_matches(configurations) {
        if let Some(range) = nvd_cpe_match_range_label(&cpe_match) {
            ranges.insert(range);
        }
    }

    if ranges.is_empty() {
        None
    } else {
        Some(ranges.into_iter().take(3).collect::<Vec<_>>().join(", "))
    }
}

fn nvd_fixed_version_hint(configurations: &[NvdConfiguration]) -> Option<String> {
    let mut hints = BTreeSet::new();
    for cpe_match in vulnerable_nvd_cpe_matches(configurations) {
        if let Some(version) = cpe_match.version_end_excluding.as_deref() {
            hints.insert(format!(">= {version}"));
        } else if let Some(version) = cpe_match.version_end_including.as_deref() {
            hints.insert(format!("> {version}"));
        }
    }

    if hints.is_empty() {
        None
    } else {
        Some(hints.into_iter().take(3).collect::<Vec<_>>().join(", "))
    }
}

fn vulnerable_nvd_cpe_matches(configurations: &[NvdConfiguration]) -> Vec<NvdCpeMatch> {
    let mut matches = Vec::new();
    for configuration in configurations {
        for node in &configuration.nodes {
            collect_vulnerable_nvd_cpe_matches(node, &mut matches);
        }
    }
    matches
}

fn collect_vulnerable_nvd_cpe_matches(node: &NvdConfigurationNode, matches: &mut Vec<NvdCpeMatch>) {
    matches.extend(
        node.cpe_match
            .iter()
            .filter(|item| item.vulnerable)
            .cloned(),
    );
    for child in &node.children {
        collect_vulnerable_nvd_cpe_matches(child, matches);
    }
}

fn nvd_cpe_match_range_label(cpe_match: &NvdCpeMatch) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(version) = cpe_match.version_start_including.as_deref() {
        parts.push(format!(">= {version}"));
    }
    if let Some(version) = cpe_match.version_start_excluding.as_deref() {
        parts.push(format!("> {version}"));
    }
    if let Some(version) = cpe_match.version_end_including.as_deref() {
        parts.push(format!("<= {version}"));
    }
    if let Some(version) = cpe_match.version_end_excluding.as_deref() {
        parts.push(format!("< {version}"));
    }

    if !parts.is_empty() {
        return Some(parts.join(" and "));
    }

    cpe_version_from_criteria(&cpe_match.criteria).map(|version| format!("= {version}"))
}

fn cpe_version_from_criteria(criteria: &str) -> Option<String> {
    let version = criteria.split(':').nth(5)?.trim();
    if version.is_empty() || version == "*" || version == "-" {
        None
    } else {
        Some(version.to_string())
    }
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
#[path = "../../../tests/unit/app/runtime/datastore_security_checks_tests.rs"]
mod datastore_security_checks_tests;
