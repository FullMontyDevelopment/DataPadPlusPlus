use super::*;

pub(super) fn security_checks_summary_for_snapshot(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_security_checks;
    let muted_ids = string_set(&preferences.muted_finding_ids);
    let Some(security_snapshot) = snapshot.datastore_security_checks.as_ref() else {
        return json!({
            "enabled": preferences.enabled,
            "status": "missing",
            "message": "No cached Security Checks snapshot is available.",
            "counts": empty_security_counts(),
            "mcpExposure": security_mcp_exposure(),
        });
    };

    let counts = security_counts(security_snapshot, &muted_ids);

    json!({
        "enabled": preferences.enabled,
        "status": security_snapshot.status,
        "checkedAt": security_snapshot.checked_at,
        "expiresAt": security_snapshot.expires_at,
        "refreshIntervalDays": preferences.refresh_interval_days,
        "lastSuccessfulRefreshAt": preferences.last_successful_refresh_at,
        "nextManualRefreshAllowedAt": preferences.next_manual_refresh_allowed_at,
        "counts": counts,
        "warnings": security_snapshot.warnings.iter().map(|warning| redact_sensitive_text(warning)).collect::<Vec<_>>(),
        "errors": security_snapshot.errors.iter().map(|error| redact_sensitive_text(error)).collect::<Vec<_>>(),
        "sourceMetadata": security_snapshot.source_metadata,
        "mcpExposure": security_mcp_exposure(),
    })
}

pub(super) fn list_security_checks_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    request: ListSecurityChecksArgs,
) -> Value {
    let muted_ids = string_set(
        &snapshot
            .preferences
            .datastore_security_checks
            .muted_finding_ids,
    );
    let Some(security_snapshot) = snapshot.datastore_security_checks.as_ref() else {
        return json!({
            "status": "missing",
            "targets": [],
            "findings": [],
            "postureChecks": [],
            "mcpExposure": security_mcp_exposure(),
        });
    };
    let kind = request
        .kind
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    let include_muted = request.include_muted.unwrap_or(false);
    let limit = request.limit.unwrap_or(100).clamp(1, 200);
    let target_filter = request
        .target_id
        .as_deref()
        .filter(|value| !value.is_empty());
    let severity_filter = request
        .severity
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_uppercase());
    let status_filter = request
        .status
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    let targets = if kind == "all" || kind == "targets" {
        security_snapshot
            .targets
            .iter()
            .filter(|target| {
                security_target_matches(target, target_filter, &severity_filter, &status_filter)
            })
            .take(limit)
            .map(sanitized_security_target)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let findings = if kind == "all" || kind == "findings" || kind == "vulnerabilities" {
        security_snapshot
            .findings
            .iter()
            .filter(|finding| {
                (include_muted || !muted_ids.contains(&finding.id))
                    && security_finding_matches(
                        finding,
                        target_filter,
                        severity_filter.as_deref(),
                        status_filter.as_deref(),
                    )
            })
            .take(limit)
            .map(|finding| sanitized_security_finding(finding, muted_ids.contains(&finding.id)))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let posture_checks = if kind == "all" || kind == "posture" || kind == "posturechecks" {
        security_snapshot
            .posture_checks
            .iter()
            .filter(|check| {
                (include_muted || !muted_ids.contains(&check.id))
                    && security_posture_matches(
                        check,
                        target_filter,
                        severity_filter.as_deref(),
                        status_filter.as_deref(),
                    )
            })
            .take(limit)
            .map(|check| sanitized_security_posture_check(check, muted_ids.contains(&check.id)))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    json!({
        "status": security_snapshot.status,
        "checkedAt": security_snapshot.checked_at,
        "filters": {
            "kind": kind,
            "targetId": target_filter,
            "severity": severity_filter,
            "status": status_filter,
            "includeMuted": include_muted,
            "limit": limit,
        },
        "targets": targets,
        "findings": findings,
        "postureChecks": posture_checks,
        "mcpExposure": security_mcp_exposure(),
    })
}

pub(super) fn empty_security_counts() -> Value {
    json!({
        "bySeverity": {
            "CRITICAL": 0,
            "HIGH": 0,
            "MEDIUM": 0,
            "LOW": 0,
            "NONE": 0,
        },
        "knownExploited": 0,
        "vulnerabilities": 0,
        "postureIssues": 0,
        "needsAttentionTargets": 0,
        "targets": 0,
    })
}

pub(super) fn security_counts(
    snapshot: &DatastoreSecurityCheckSnapshot,
    muted_ids: &HashSet<String>,
) -> Value {
    let mut by_severity = HashMap::<String, usize>::from([
        ("CRITICAL".into(), 0),
        ("HIGH".into(), 0),
        ("MEDIUM".into(), 0),
        ("LOW".into(), 0),
        ("NONE".into(), 0),
    ]);
    let mut known_exploited = 0usize;
    let mut vulnerabilities = 0usize;
    let mut posture_issues = 0usize;
    let mut attention_target_ids = HashSet::<String>::new();

    for finding in &snapshot.findings {
        if muted_ids.contains(&finding.id) {
            continue;
        }
        vulnerabilities += 1;
        *by_severity.entry(finding.severity.clone()).or_insert(0) += 1;
        if finding.known_exploited {
            known_exploited += 1;
        }
        for target_id in &finding.target_ids {
            attention_target_ids.insert(target_id.clone());
        }
    }
    for check in &snapshot.posture_checks {
        if muted_ids.contains(&check.id) || !security_posture_status_needs_attention(&check.status)
        {
            continue;
        }
        posture_issues += 1;
        *by_severity.entry(check.severity.clone()).or_insert(0) += 1;
        for target_id in &check.target_ids {
            attention_target_ids.insert(target_id.clone());
        }
    }
    for target in &snapshot.targets {
        if target.status == "versionUnavailable"
            || target.status == "mappingUnavailable"
            || target.status == "error"
            || target.version_status.as_deref() == Some("updateAvailable")
            || target.version_status.as_deref() == Some("unsupported")
        {
            attention_target_ids.insert(target.id.clone());
        }
    }

    json!({
        "bySeverity": by_severity,
        "knownExploited": known_exploited,
        "vulnerabilities": vulnerabilities,
        "postureIssues": posture_issues,
        "needsAttentionTargets": attention_target_ids.len(),
        "targets": snapshot.targets.len(),
    })
}

pub(super) fn security_target_matches(
    target: &DatastoreSecurityTarget,
    target_filter: Option<&str>,
    severity_filter: &Option<String>,
    status_filter: &Option<String>,
) -> bool {
    if target_filter.is_some_and(|value| value != target.id) {
        return false;
    }
    if let Some(severity) = severity_filter {
        if target.highest_severity.as_deref() != Some(severity.as_str()) {
            return false;
        }
    }
    if let Some(status) = status_filter {
        let target_status = target.status.to_ascii_lowercase();
        let version_status = target
            .version_status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if target_status != *status && version_status != *status {
            return false;
        }
    }
    true
}

pub(super) fn security_finding_matches(
    finding: &DatastoreSecurityFinding,
    target_filter: Option<&str>,
    severity_filter: Option<&str>,
    status_filter: Option<&str>,
) -> bool {
    if target_filter.is_some_and(|target_id| !finding.target_ids.iter().any(|id| id == target_id)) {
        return false;
    }
    if severity_filter.is_some_and(|severity| finding.severity != severity) {
        return false;
    }
    if let Some(status) = status_filter {
        let known_exploited = if finding.known_exploited {
            "knownexploited"
        } else {
            ""
        };
        if status != "vulnerability" && status != "cve" && status != known_exploited {
            return false;
        }
    }
    true
}

pub(super) fn security_posture_matches(
    check: &DatastoreSecurityPostureCheckResult,
    target_filter: Option<&str>,
    severity_filter: Option<&str>,
    status_filter: Option<&str>,
) -> bool {
    if target_filter.is_some_and(|target_id| !check.target_ids.iter().any(|id| id == target_id)) {
        return false;
    }
    if severity_filter.is_some_and(|severity| check.severity != severity) {
        return false;
    }
    if status_filter.is_some_and(|status| check.status.to_ascii_lowercase() != status) {
        return false;
    }
    true
}

pub(super) fn security_posture_status_needs_attention(status: &str) -> bool {
    matches!(status, "fail" | "warn" | "unknown")
}

pub(super) fn sanitized_security_target(target: &DatastoreSecurityTarget) -> Value {
    json!({
        "id": target.id,
        "connectionId": target.connection_id,
        "environmentId": target.environment_id,
        "connectionName": target.connection_name,
        "environmentName": target.environment_name,
        "engine": target.engine,
        "family": target.family,
        "status": target.status,
        "detectedProduct": target.detected_product,
        "detectedVersion": target.detected_version,
        "knownLatestVersion": target.known_latest_version,
        "recommendedVersion": target.recommended_version,
        "versionStatus": target.version_status,
        "versionSource": target.version_source,
        "versionSourceLabel": target.version_source_label,
        "versionSourceUrl": target.version_source_url,
        "versionSourceUpdatedAt": target.version_source_updated_at,
        "findingCount": target.finding_count,
        "highestSeverity": target.highest_severity,
        "lastCheckedAt": target.last_checked_at,
        "message": target.message.as_deref().map(redact_sensitive_text),
        "warnings": target.warnings.iter().map(|warning| redact_sensitive_text(warning)).collect::<Vec<_>>(),
    })
}

pub(super) fn sanitized_security_finding(finding: &DatastoreSecurityFinding, muted: bool) -> Value {
    json!({
        "id": finding.id,
        "targetIds": finding.target_ids,
        "cveId": finding.cve_id,
        "title": redact_sensitive_text(&finding.title),
        "summary": redact_sensitive_text(&finding.summary),
        "severity": finding.severity,
        "cvssScore": finding.cvss_score,
        "cvssVector": finding.cvss_vector,
        "publishedAt": finding.published_at,
        "modifiedAt": finding.modified_at,
        "affectedProduct": finding.affected_product,
        "affectedVersion": finding.affected_version,
        "affectedVersionRange": finding.affected_version_range,
        "fixedVersionHint": finding.fixed_version_hint,
        "remediation": redact_sensitive_text(&finding.remediation),
        "references": finding.references,
        "cwes": finding.cwes,
        "knownExploited": finding.known_exploited,
        "kev": finding.kev,
        "sourceUrls": finding.source_urls,
        "muted": muted,
    })
}

pub(super) fn sanitized_security_posture_check(
    check: &DatastoreSecurityPostureCheckResult,
    muted: bool,
) -> Value {
    json!({
        "id": check.id,
        "targetIds": check.target_ids,
        "ruleId": check.rule_id,
        "category": check.category,
        "status": check.status,
        "severity": check.severity,
        "title": redact_sensitive_text(&check.title),
        "summary": redact_sensitive_text(&check.summary),
        "evidence": check.evidence.as_deref().map(redact_sensitive_text),
        "remediation": redact_sensitive_text(&check.remediation),
        "source": check.source,
        "references": check.references,
        "muted": muted,
    })
}

pub(super) fn security_mcp_exposure() -> Value {
    json!({
        "readOnly": true,
        "refreshesScans": false,
        "mutatesMutes": false,
        "rawSecretsIncluded": false,
    })
}

pub(super) const MAX_WORKSPACE_SEARCH_MATCHES: usize = 200;
pub(super) const SNIPPET_CONTEXT: usize = 72;
