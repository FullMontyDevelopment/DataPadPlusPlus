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

