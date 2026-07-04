use super::*;
use crate::domain::models::SqliteConnectionOptions;

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
fn bundled_version_catalog_flags_known_newer_versions() {
    let mut target = base_target(
        &ConnectionProfile {
            id: "conn".into(),
            name: "PostgreSQL".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            ..ConnectionProfile::default()
        },
        &EnvironmentProfile {
            id: "env".into(),
            label: "Dev".into(),
            ..EnvironmentProfile::default()
        },
        "2026-07-04T00:00:00.000Z",
    );

    apply_version_catalog(&mut target, "postgresql", "15.2");

    assert_eq!(target.known_latest_version.as_deref(), Some("18.4"));
    assert_eq!(target.version_status.as_deref(), Some("updateAvailable"));
    assert_eq!(target.version_source.as_deref(), Some("bundled-catalog"));
}

#[test]
fn nvd_configuration_ranges_produce_fixed_version_hints() {
    let payload = serde_json::json!({
        "totalResults": 1,
        "resultsPerPage": 1,
        "vulnerabilities": [{
            "cve": {
                "id": "CVE-2026-0003",
                "descriptions": [{ "lang": "en", "value": "Range bounded CVE." }],
                "configurations": [{
                    "nodes": [{
                        "cpeMatch": [{
                            "vulnerable": true,
                            "criteria": "cpe:2.3:a:postgresql:postgresql:*:*:*:*:*:*:*:*",
                            "versionStartIncluding": "15.0",
                            "versionEndExcluding": "15.12"
                        }]
                    }]
                }]
            }
        }]
    });
    let response: NvdCveResponse = serde_json::from_value(payload).expect("nvd response");
    let finding = nvd_vulnerability_to_finding(
        response
            .vulnerabilities
            .into_iter()
            .next()
            .expect("vulnerability"),
        &["target-1".into()],
        &HashMap::new(),
    )
    .expect("finding");

    assert_eq!(
        finding.affected_version_range.as_deref(),
        Some(">= 15.0 and < 15.12")
    );
    assert_eq!(finding.fixed_version_hint.as_deref(), Some(">= 15.12"));
    assert!(finding.remediation.contains(">= 15.12"));
}

#[test]
fn profile_posture_flags_high_risk_writeable_connections() {
    let checks = profile_posture_checks(
        &ConnectionProfile {
            id: "conn".into(),
            name: "Prod Postgres".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            read_only: false,
            ..ConnectionProfile::default()
        },
        &EnvironmentProfile {
            id: "prod".into(),
            label: "Prod".into(),
            risk: "critical".into(),
            requires_confirmation: false,
            safe_mode: false,
            ..EnvironmentProfile::default()
        },
        "security-target-conn-prod",
    );

    let readonly = checks
        .iter()
        .find(|check| check.rule_id == "profile.high-risk-readonly")
        .expect("readonly posture check");
    assert_eq!(readonly.status, "fail");
    assert_eq!(readonly.severity, "HIGH");

    let guardrails = checks
        .iter()
        .find(|check| check.rule_id == "profile.environment-guardrails")
        .expect("environment guardrail posture check");
    assert_eq!(guardrails.status, "warn");
}

#[test]
fn profile_posture_detects_embedded_connection_string_credentials_without_storing_secret() {
    let checks = profile_posture_checks(
        &ConnectionProfile {
            id: "conn".into(),
            name: "Embedded secret".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            connection_string: Some("mongodb://user:super-secret@example.invalid/app".into()),
            ..ConnectionProfile::default()
        },
        &EnvironmentProfile {
            id: "dev".into(),
            label: "Dev".into(),
            risk: "low".into(),
            ..EnvironmentProfile::default()
        },
        "security-target-conn-dev",
    );

    let check = checks
        .iter()
        .find(|check| check.rule_id == "profile.connection-string-credentials")
        .expect("connection string posture check");
    assert_eq!(check.status, "fail");
    assert!(!check
        .evidence
        .as_deref()
        .unwrap_or_default()
        .contains("super-secret"));
}

#[test]
fn sqlite_profile_posture_warns_when_file_encryption_is_not_configured() {
    let check = local_file_profile_posture_check(
        &ConnectionProfile {
            id: "conn".into(),
            name: "Fixture SQLite".into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            sqlite_options: Some(SqliteConnectionOptions {
                open_mode: Some("read-only".into()),
                encryption_provider: Some("none".into()),
                ..SqliteConnectionOptions::default()
            }),
            ..ConnectionProfile::default()
        },
        "sqlite",
        "security-target-conn-dev",
    )
    .expect("sqlite local file posture check");

    assert_eq!(check.status, "warn");
    assert_eq!(check.category, "local-file");
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
