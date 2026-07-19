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

