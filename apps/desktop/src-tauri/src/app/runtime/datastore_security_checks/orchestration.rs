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

