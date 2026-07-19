async fn engine_probe_posture_checks(
    connection: &ResolvedConnectionProfile,
    profile: &ConnectionProfile,
    environment: &EnvironmentProfile,
    target_id: &str,
) -> Vec<DatastoreSecurityPostureCheckResult> {
    let engine = normalized_engine_id(&connection.engine);
    match security_check_provider(&engine).map(|provider| provider.deep_probe) {
        Some(DeepProbeKind::Postgres) => {
            postgres_family_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::MySql) => {
            mysql_family_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::SqlServer) => {
            sqlserver_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::MongoDb) => {
            mongodb_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::Redis) => {
            redis_family_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::Sqlite) => {
            sqlite_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::DuckDb) => {
            duckdb_probe_checks(connection, profile, environment, target_id).await
        }
        Some(DeepProbeKind::Search) => search_profile_deep_checks(profile, target_id),
        Some(DeepProbeKind::None) | None => Vec::new(),
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

