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
#[path = "../../../../tests/unit/app/runtime/datastore_security_checks/datastore_security_checks_tests.rs"]
mod datastore_security_checks_tests;
