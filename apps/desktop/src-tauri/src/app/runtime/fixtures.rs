use std::collections::HashMap;

use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppPreferences, ConnectionAuth, ConnectionProfile, DatastoreApiServerConfig,
            DatastoreApiServerPreferences, DatastoreMcpServerConfig, DatastoreMcpServerPreferences,
            EnvironmentProfile, LockState, MySqlConnectionOptions, QueryHistoryEntry,
            QueryTabState, SavedWorkItem, SecretRef, UiState, WorkspaceSnapshot,
        },
    },
    persistence, security,
};

use super::library::{ensure_library_nodes, library_nodes_are_empty_scaffold};
use super::query_tabs::{editor_label_for_connection, language_for_connection};
use super::timestamp_now;
pub(super) struct FixtureWorkspaceSeed {
    pub(super) snapshot: WorkspaceSnapshot,
    pub(super) secrets: Vec<(SecretRef, String)>,
}

mod catalog;
mod fixture_env;
mod saved_work;

use catalog::{fixture_connection_seeds, FixtureConnectionSeed};
use fixture_env::{fixture_env_value, fixture_port, resolve_fixture_connection_string};
use saved_work::{fixture_closed_tabs, fixture_snippets};

pub(super) fn fixture_debug_enabled() -> bool {
    fixture_env_value("DATAPADPLUSPLUS_FIXTURE_RUN")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(super) fn screenshot_seed_enabled() -> bool {
    fixture_env_value("DATAPADPLUSPLUS_SCREENSHOT_SEED")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(super) fn workspace_is_empty(snapshot: &WorkspaceSnapshot) -> bool {
    snapshot.connections.is_empty()
        && snapshot.environments.is_empty()
        && snapshot.tabs.is_empty()
        && library_nodes_are_empty_scaffold(&snapshot.library_nodes)
        && snapshot.saved_work.is_empty()
}

pub(super) fn fixture_workspace_seed() -> FixtureWorkspaceSeed {
    let profile_value = fixture_env_value("DATAPADPLUSPLUS_FIXTURE_PROFILE");
    let sqlite_fixture = fixture_env_value("DATAPADPLUSPLUS_SQLITE_FIXTURE")
        .unwrap_or_else(|| "tests/fixtures/sqlite/datapadplusplus.sqlite3".into());
    fixture_workspace_seed_for_profile_options(
        profile_value.as_deref(),
        &sqlite_fixture,
        screenshot_seed_enabled(),
    )
}

#[cfg(test)]
pub(super) fn fixture_workspace_seed_for_profile(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
) -> FixtureWorkspaceSeed {
    fixture_workspace_seed_for_profile_options(profile_value, sqlite_fixture, false)
}

#[cfg(test)]
pub(super) fn fixture_workspace_seed_for_profile_with_screenshot_seed(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
) -> FixtureWorkspaceSeed {
    fixture_workspace_seed_for_profile_options(profile_value, sqlite_fixture, true)
}

fn fixture_workspace_seed_for_profile_options(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
    screenshot_seed: bool,
) -> FixtureWorkspaceSeed {
    let created_at = timestamp_now();
    let environments = if screenshot_seed {
        screenshot_environments(&created_at, sqlite_fixture)
    } else {
        fixture_environments(&created_at, sqlite_fixture)
    };
    let active_environment_id = if screenshot_seed {
        "env-local-demo"
    } else {
        "env-fixtures"
    };
    let seeds: Vec<FixtureConnectionSeed> = fixture_connection_seeds()
        .into_iter()
        .filter(|seed| fixture_profile_requested(seed.profile, profile_value))
        .collect();
    let mut secrets = Vec::new();
    let mut connections = Vec::new();

    for seed in &seeds {
        let (connection, secret) = build_fixture_connection(seed, sqlite_fixture, &created_at);
        if let Some(secret) = secret {
            secrets.push(secret);
        }
        connections.push(connection);
    }
    if screenshot_seed {
        decorate_screenshot_connections(&mut connections);
    }

    let tabs = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| fixture_query_tab(connection, seed, active_environment_id, &created_at))
        })
        .collect::<Vec<_>>();
    let mut saved_work = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| {
                    fixture_saved_query(connection, seed, active_environment_id, &created_at)
                })
        })
        .chain(fixture_snippets(&created_at))
        .collect::<Vec<_>>();
    if screenshot_seed {
        for item in &mut saved_work {
            if item.environment_id.as_deref() == Some("env-fixtures") {
                item.environment_id = Some(active_environment_id.into());
            }
        }
        saved_work.extend(screenshot_saved_work(
            &connections,
            active_environment_id,
            &created_at,
        ));
    }
    let mut closed_tabs = fixture_closed_tabs(&connections, &created_at);
    if screenshot_seed {
        for closed_tab in &mut closed_tabs {
            if closed_tab.tab.environment_id == "env-fixtures" {
                closed_tab.tab.environment_id = active_environment_id.into();
            }
        }
    }
    let active_connection_id = connections
        .first()
        .map(|connection| connection.id.clone())
        .unwrap_or_default();
    let active_tab_id = tabs.first().map(|tab| tab.id.clone()).unwrap_or_default();
    let datastore_api_server = if screenshot_seed {
        screenshot_api_server_preferences(&connections, active_environment_id)
    } else {
        Default::default()
    };
    let datastore_mcp_server = if screenshot_seed {
        screenshot_mcp_server_preferences(&connections, active_environment_id)
    } else {
        Default::default()
    };

    let mut snapshot = WorkspaceSnapshot {
        schema_version: persistence::SCHEMA_VERSION,
        connections,
        environments,
        tabs,
        closed_tabs,
        library_nodes: Vec::new(),
        saved_work,
        explorer_nodes: Vec::new(),
        adapter_manifests: adapters::manifests(),
        preferences: AppPreferences {
            theme: "dark".into(),
            telemetry: "opt-in".into(),
            lock_after_minutes: 15,
            safe_mode_enabled: true,
            keyboard_shortcuts: HashMap::new(),
            workspace_backups: Default::default(),
            datastore_api_server,
            datastore_mcp_server,
            datastore_security_checks: if screenshot_seed {
                crate::domain::models::DatastoreSecurityChecksPreferences {
                    enabled: true,
                    refresh_interval_days: 7,
                    ..Default::default()
                }
            } else {
                Default::default()
            },
            workspace_search: crate::domain::models::WorkspaceSearchPreferences {
                enabled: screenshot_seed,
            },
            first_install_guide: Default::default(),
            explorer_folder_orders: HashMap::new(),
        },
        datastore_security_checks: None,
        guardrails: Vec::new(),
        lock_state: LockState {
            is_locked: false,
            locked_at: None,
        },
        ui: UiState {
            active_connection_id,
            active_environment_id: active_environment_id.into(),
            active_tab_id,
            explorer_filter: String::new(),
            explorer_view: "structure".into(),
            connection_group_mode: if screenshot_seed {
                "group".into()
            } else {
                "none".into()
            },
            sidebar_section_states: HashMap::new(),
            active_activity: "library".into(),
            sidebar_collapsed: false,
            active_sidebar_pane: "library".into(),
            sidebar_width: 300,
            bottom_panel_visible: false,
            active_bottom_panel_tab: "results".into(),
            bottom_panel_height: 300,
            results_dock: "bottom".into(),
            results_side_width: 420,
            right_drawer: "none".into(),
            right_drawer_width: 380,
        },
        updated_at: created_at,
    };
    ensure_library_nodes(&mut snapshot);

    FixtureWorkspaceSeed { snapshot, secrets }
}

pub(super) fn seed_fixture_secrets(secrets: &[(SecretRef, String)]) -> Result<(), CommandError> {
    if !security::using_file_secret_store() {
        return Err(CommandError::new(
            "fixture-secret-store",
            "Fixture workspace seeding requires DATAPADPLUSPLUS_SECRET_STORE=file, which stores encrypted secrets.",
        ));
    }

    for (secret_ref, secret) in secrets {
        security::store_secret_value(secret_ref, secret)?;
    }

    Ok(())
}

fn fixture_profile_requested(seed_profile: Option<&str>, profile_value: Option<&str>) -> bool {
    match seed_profile {
        None => true,
        Some(seed_profile) => profile_value
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .any(|profile| profile == "all" || profile.eq_ignore_ascii_case(seed_profile)),
    }
}

fn fixture_environments(created_at: &str, sqlite_fixture: &str) -> Vec<EnvironmentProfile> {
    let mut variables = HashMap::new();
    variables.insert("FIXTURE_HOST".into(), "127.0.0.1".into());
    variables.insert("SQLITE_FIXTURE".into(), sqlite_fixture.into());

    vec![
        EnvironmentProfile {
            id: "env-fixtures".into(),
            label: "Fixtures".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables,
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-fixtures-prod-sim".into(),
            label: "Fixture Prod Sim".into(),
            color: "#ec7b7b".into(),
            risk: "critical".into(),
            inherits_from: Some("env-fixtures".into()),
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: true,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
    ]
}

fn screenshot_environments(created_at: &str, sqlite_fixture: &str) -> Vec<EnvironmentProfile> {
    let mut variables = HashMap::new();
    variables.insert("FIXTURE_HOST".into(), "127.0.0.1".into());
    variables.insert("SQLITE_FIXTURE".into(), sqlite_fixture.into());
    variables.insert("REGION".into(), "emea".into());
    variables.insert("TENANT".into(), "acme-demo".into());
    variables.insert("LOOKBACK_DAYS".into(), "14".into());
    variables.insert("LIMIT".into(), "50".into());

    vec![
        EnvironmentProfile {
            id: "env-local-demo".into(),
            label: "Local Demo".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables,
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-staging".into(),
            label: "Staging".into(),
            color: "#f0bf4f".into(),
            risk: "medium".into(),
            inherits_from: Some("env-local-demo".into()),
            variables: HashMap::from([
                ("TENANT".into(), "acme-staging".into()),
                ("LOOKBACK_DAYS".into(), "30".into()),
            ]),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-production-preview".into(),
            label: "Production Preview".into(),
            color: "#ec7b7b".into(),
            risk: "critical".into(),
            inherits_from: Some("env-staging".into()),
            variables: HashMap::from([
                ("TENANT".into(), "acme-production-preview".into()),
                ("LIMIT".into(), "100".into()),
            ]),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: true,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
    ]
}

fn decorate_screenshot_connections(connections: &mut [ConnectionProfile]) {
    for connection in connections {
        if let Some((name, group, color, notes)) = screenshot_connection_display(&connection.id) {
            connection.name = name.into();
            connection.group = Some(group.into());
            connection.color = Some(color.into());
            connection.tags = screenshot_tags_for_connection(connection);
            connection.notes = Some(notes.into());
            connection.favorite = matches!(
                connection.id.as_str(),
                "fixture-postgresql"
                    | "fixture-mongodb"
                    | "fixture-redis"
                    | "fixture-opensearch"
                    | "fixture-clickhouse"
                    | "fixture-neo4j"
            );
            connection.environment_ids = vec![
                "env-local-demo".into(),
                "env-staging".into(),
                "env-production-preview".into(),
            ];
            connection.read_only = true;
        }
    }
}

fn screenshot_connection_display(
    id: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    Some(match id {
        "fixture-postgresql" => (
            "Northwind Analytics PostgreSQL",
            "Commerce",
            "#2dbf9b",
            "Curated relational demo for revenue, orders, and operational health screenshots.",
        ),
        "fixture-sqlserver" => (
            "Operations SQL Server",
            "Operations",
            "#4aa3ff",
            "Operational order and support data with recent activity views.",
        ),
        "fixture-mysql" => (
            "Inventory MySQL",
            "Commerce",
            "#f0a95b",
            "Inventory availability and catalog freshness for commerce workflows.",
        ),
        "fixture-sqlite" => (
            "Local Accounts SQLite",
            "Local Files",
            "#c9a86a",
            "Portable local-file account sample for import/export screenshots.",
        ),
        "fixture-mongodb" => (
            "Commerce Catalog MongoDB",
            "Commerce",
            "#5abf6f",
            "Document catalog, orders, and large-document samples for builder and browser views.",
        ),
        "fixture-redis" => (
            "Realtime Cache Redis",
            "Cache",
            "#d15b5b",
            "Hot keys, order streams, product inventory, and session cache samples.",
        ),
        "fixture-valkey" => (
            "Edge Cache Valkey",
            "Cache",
            "#c9463c",
            "Valkey cache data for stream and high-volume key screenshots.",
        ),
        "fixture-memcached" => (
            "Feature Flag Memcached",
            "Cache",
            "#8ac16f",
            "Simple product and feature-flag cache samples.",
        ),
        "fixture-mariadb" => (
            "Orders MariaDB",
            "Commerce",
            "#b98edb",
            "Order lifecycle data for SQL family comparison screenshots.",
        ),
        "fixture-cockroachdb" => (
            "Regional Accounts CockroachDB",
            "Commerce",
            "#6eb7ff",
            "Distributed SQL account sample with region-aware names.",
        ),
        "fixture-timescaledb" => (
            "Order Metrics TimescaleDB",
            "Analytics",
            "#55a8e6",
            "Hypertable order and service metrics for time-series screenshots.",
        ),
        "fixture-clickhouse" => (
            "Warehouse Events ClickHouse",
            "Analytics",
            "#f3d74f",
            "High-volume event analytics for warehouse result and profile views.",
        ),
        "fixture-influxdb" => (
            "Latency Metrics InfluxDB",
            "Analytics",
            "#8d74ff",
            "Service latency time-series data for operations dashboards.",
        ),
        "fixture-prometheus" => (
            "Service Health Prometheus",
            "Operations",
            "#e87941",
            "Prometheus health vectors for diagnostics screenshots.",
        ),
        "fixture-opensearch" => (
            "Search Catalog OpenSearch",
            "Search",
            "#5cb3ff",
            "Product and order indexes with facets, profiles, and diagnostics.",
        ),
        "fixture-elasticsearch" => (
            "Search Orders Elasticsearch",
            "Search",
            "#f0bf4f",
            "Order search index for search-family comparison screenshots.",
        ),
        "fixture-neo4j" => (
            "Customer Journey Neo4j",
            "Graph",
            "#4f8dff",
            "Graph sample for account, order, and journey path exploration.",
        ),
        "fixture-arangodb" => (
            "Graph Catalog ArangoDB",
            "Graph",
            "#75b84d",
            "Multi-model account and order graph sample.",
        ),
        "fixture-janusgraph" => (
            "Network Signals JanusGraph",
            "Graph",
            "#9a7bd7",
            "Graph traversal sample for wide graph integrations.",
        ),
        "fixture-cassandra" => (
            "Order Ledger Cassandra",
            "Cloud + Wide Column",
            "#64a6d8",
            "Wide-column order ledger data for table and key access screenshots.",
        ),
        "fixture-oracle" => (
            "Finance Operations Oracle",
            "Enterprise SQL",
            "#d85f4f",
            "Enterprise SQL sample with plans, packages, and operational order data.",
        ),
        "fixture-dynamodb" => (
            "Serverless Orders DynamoDB",
            "Cloud + Wide Column",
            "#5487e8",
            "Local DynamoDB order and event sample for cloud-contract screenshots.",
        ),
        "fixture-bigquery" => (
            "Marketing Analytics BigQuery",
            "Cloud Warehouse",
            "#669df6",
            "Mock BigQuery analytics endpoint for cloud warehouse screenshots.",
        ),
        "fixture-snowflake" => (
            "Revenue Warehouse Snowflake",
            "Cloud Warehouse",
            "#7dd3fc",
            "Mock Snowflake warehouse endpoint for BI-oriented screenshots.",
        ),
        "fixture-cosmosdb" => (
            "Customer Profiles Cosmos DB",
            "Cloud Document",
            "#58a6ff",
            "Mock Cosmos DB customer profile sample for document workflows.",
        ),
        "fixture-neptune" => (
            "Recommendation Graph Neptune",
            "Cloud Graph",
            "#64d2ff",
            "Mock Neptune recommendation graph sample.",
        ),
        _ => return None,
    })
}

fn screenshot_tags_for_connection(connection: &ConnectionProfile) -> Vec<String> {
    let mut tags = vec![
        "screenshot".into(),
        "demo".into(),
        connection.family.clone(),
    ];
    if let Some(group) = &connection.group {
        tags.push(group.to_lowercase().replace([' ', '+'], "-"));
    }
    tags
}

fn build_fixture_connection(
    seed: &FixtureConnectionSeed,
    _sqlite_fixture: &str,
    created_at: &str,
) -> (ConnectionProfile, Option<(SecretRef, String)>) {
    let database = if seed.use_sqlite_fixture {
        Some("${SQLITE_FIXTURE}".into())
    } else {
        seed.database.map(str::to_string)
    };
    let secret_ref = seed.password.map(|_| SecretRef {
        id: format!("secret-{}", seed.id),
        provider: "file".into(),
        service: "DataPadPlusPlusFixture".into(),
        account: seed.id.into(),
        label: format!("{} fixture credential", seed.name),
    });
    let secret = secret_ref.clone().zip(seed.password.map(str::to_string));

    (
        ConnectionProfile {
            id: seed.id.into(),
            name: seed.name.into(),
            engine: seed.engine.into(),
            family: seed.family.into(),
            host: seed.host.into(),
            port: seed.port,
            database,
            connection_string: seed
                .connection_string
                .map(|value| resolve_fixture_connection_string(value, seed)),
            connection_mode: Some(
                if seed.use_sqlite_fixture {
                    "file"
                } else {
                    "host"
                }
                .into(),
            ),
            environment_ids: vec!["env-fixtures".into()],
            tags: seed.tags.iter().map(|tag| (*tag).to_string()).collect(),
            favorite: seed.profile.is_none(),
            redis_options: None,
            memcached_options: None,
            mongodb_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: mysql_options_for_seed(seed),
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
            icon: seed.icon.into(),
            color: Some(seed.color.into()),
            group: Some(seed.group.into()),
            notes: Some("Seeded only for fixture debug workspaces.".into()),
            auth: ConnectionAuth {
                username: seed.username.map(str::to_string),
                auth_mechanism: seed.auth_mechanism.map(str::to_string),
                ssl_mode: seed.ssl_mode.map(str::to_string),
                cloud_provider: None,
                principal: None,
                secret_ref,
            },
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        secret,
    )
}

fn mysql_options_for_seed(seed: &FixtureConnectionSeed) -> Option<MySqlConnectionOptions> {
    if !matches!(seed.engine, "mysql" | "mariadb") {
        return None;
    }
    let is_mariadb = seed.engine == "mariadb";

    Some(MySqlConnectionOptions {
        connect_mode: Some("tcp".into()),
        auth_mode: Some("password".into()),
        ssl_mode: seed.ssl_mode.map(|mode| match mode {
            "disable" => "disabled".into(),
            "require" => "required".into(),
            "verify-ca" => "verify-ca".into(),
            "verify-full" => "verify-identity".into(),
            _ => "preferred".into(),
        }),
        server_flavor: Some(if is_mariadb { "mariadb" } else { "mysql" }.into()),
        charset: Some("utf8mb4".into()),
        collation: Some(
            if is_mariadb {
                "utf8mb4_unicode_ci"
            } else {
                "utf8mb4_0900_ai_ci"
            }
            .into(),
        ),
        time_zone: Some("+00:00".into()),
        sql_mode: Some("STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION".into()),
        default_storage_engine: Some(if is_mariadb { "Aria" } else { "InnoDB" }.into()),
        allow_local_infile: Some(false),
        statement_cache_capacity: Some(100),
        connect_timeout_ms: Some(5_000),
        command_timeout_ms: Some(30_000),
        ..MySqlConnectionOptions::default()
    })
}

fn fixture_query_tab(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    environment_id: &str,
    created_at: &str,
) -> QueryTabState {
    QueryTabState {
        id: format!("tab-{}", seed.id),
        title: if environment_id == "env-local-demo" {
            screenshot_tab_title(connection, seed)
        } else {
            seed.query_title.into()
        },
        tab_kind: Some("query".into()),
        connection_id: connection.id.clone(),
        environment_id: environment_id.into(),
        family: connection.family.clone(),
        language: language_for_connection(connection),
        pinned: Some(seed.profile.is_none()),
        save_target: None,
        saved_query_id: Some(format!("saved-{}", seed.id)),
        editor_label: editor_label_for_connection(connection),
        query_text: seed.query_text.into(),
        query_view_mode: Some(super::query_tabs::default_query_view_mode(connection)),
        script_text: super::query_tabs::default_script_text(connection),
        document_efficiency_mode: None,
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        active_execution: None,
        dirty: false,
        last_run_at: None,
        result: None,
        history: vec![QueryHistoryEntry {
            id: format!("history-{}", seed.id),
            query_text: seed.query_text.into(),
            executed_at: created_at.into(),
            status: "seeded".into(),
        }],
        error: None,
    }
}

fn fixture_saved_query(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    environment_id: &str,
    created_at: &str,
) -> SavedWorkItem {
    SavedWorkItem {
        id: format!("saved-{}", seed.id),
        kind: "query".into(),
        name: if environment_id == "env-local-demo" {
            format!("{} overview", connection.name)
        } else {
            format!("{} smoke query", seed.name)
        },
        summary: if environment_id == "env-local-demo" {
            format!("Curated read-only overview for {}.", connection.name)
        } else {
            format!("Fixture query for {}", seed.name)
        },
        tags: if environment_id == "env-local-demo" {
            screenshot_tags_for_connection(connection)
        } else {
            seed.tags.iter().map(|tag| (*tag).to_string()).collect()
        },
        updated_at: created_at.into(),
        folder: Some(if environment_id == "env-local-demo" {
            screenshot_folder_for_connection(connection)
        } else {
            match seed.profile {
                Some(profile) => format!("Fixture Profiles/{profile}"),
                None => "Fixture Core".into(),
            }
        }),
        favorite: Some(seed.profile.is_none()),
        connection_id: Some(connection.id.clone()),
        environment_id: Some(environment_id.into()),
        language: Some(language_for_connection(connection)),
        query_text: Some(seed.query_text.into()),
        snapshot_result_id: None,
    }
}

fn screenshot_tab_title(connection: &ConnectionProfile, seed: &FixtureConnectionSeed) -> String {
    let extension = seed
        .query_title
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("sql");
    format!("{} overview.{extension}", connection.name)
}

fn screenshot_folder_for_connection(connection: &ConnectionProfile) -> String {
    match connection.group.as_deref() {
        Some("Commerce") => "Commerce".into(),
        Some("Operations") => "Operations".into(),
        Some("Cache") => "Cache".into(),
        Some("Search") => "Search".into(),
        Some("Analytics") | Some("Cloud Warehouse") => "Analytics".into(),
        Some("Graph") | Some("Cloud Graph") => "Graph".into(),
        Some("Enterprise SQL") => "Operations/Enterprise".into(),
        Some("Cloud + Wide Column") | Some("Cloud Document") => "Cloud Contracts".into(),
        Some("Local Files") => "Local Files".into(),
        _ => "Showcase".into(),
    }
}

fn screenshot_saved_work(
    connections: &[ConnectionProfile],
    environment_id: &str,
    created_at: &str,
) -> Vec<SavedWorkItem> {
    [
        (
            "saved-screenshot-revenue-by-region",
            "Revenue by region",
            "Regional revenue and order volume for the current demo window.",
            "Commerce",
            "fixture-postgresql",
            "sql",
            "select region, count(*) as orders, sum(total_amount) as revenue\nfrom orders\nwhere updated_at >= now() - interval '${LOOKBACK_DAYS} days'\ngroup by region\norder by revenue desc\nlimit ${LIMIT};",
            &["commerce", "analytics", "revenue"][..],
        ),
        (
            "saved-screenshot-open-orders",
            "Open orders by status",
            "Operational order queue with bounded rows for safe screenshots.",
            "Commerce",
            "fixture-mariadb",
            "sql",
            "select status, count(*) as orders, max(updated_at) as latest_update\nfrom orders\ngroup by status\norder by orders desc\nlimit ${LIMIT};",
            &["commerce", "orders", "operations"][..],
        ),
        (
            "saved-screenshot-support-queue",
            "Customer support queue",
            "Recent support tickets with priority and account context.",
            "Operations",
            "fixture-sqlserver",
            "sql",
            "select top 50 ticket_id, account_id, priority, status, updated_at\nfrom dbo.support_tickets\norder by updated_at desc;",
            &["operations", "support", "queue"][..],
        ),
        (
            "saved-screenshot-product-facets",
            "Product search with facets",
            "Search catalog query with category and inventory aggregations.",
            "Search",
            "fixture-opensearch",
            "json",
            "{\n  \"index\": \"products\",\n  \"query\": { \"match_all\": {} },\n  \"aggs\": {\n    \"categories\": { \"terms\": { \"field\": \"category.keyword\", \"size\": 8 } },\n    \"availability\": { \"terms\": { \"field\": \"availability.keyword\" } }\n  },\n  \"size\": 25\n}",
            &["search", "catalog", "facets"][..],
        ),
        (
            "saved-screenshot-hot-cache-keys",
            "Hot product keys",
            "Bounded cache scan for product inventory and session keys.",
            "Cache",
            "fixture-redis",
            "redis",
            "SCAN 0 MATCH product:* COUNT 50",
            &["cache", "redis", "keys"][..],
        ),
        (
            "saved-screenshot-recent-order-stream",
            "Recent order stream",
            "Stream read for order fulfillment events.",
            "Cache",
            "fixture-redis",
            "redis",
            "XREVRANGE stream:orders + - COUNT 25",
            &["cache", "streams", "orders"][..],
        ),
        (
            "saved-screenshot-daily-order-metrics",
            "Daily order metrics",
            "Time-series order volume and latency for the active region.",
            "Analytics",
            "fixture-timescaledb",
            "sql",
            "select time_bucket('1 day', time) as day, region, sum(orders) as orders, avg(latency_ms) as avg_latency_ms\nfrom order_metrics\nwhere time >= now() - interval '${LOOKBACK_DAYS} days'\ngroup by day, region\norder by day desc, region\nlimit ${LIMIT};",
            &["analytics", "timeseries", "orders"][..],
        ),
        (
            "saved-screenshot-funnel-conversion",
            "Funnel conversion",
            "Warehouse event funnel for the screenshot demo tenant.",
            "Analytics",
            "fixture-clickhouse",
            "sql",
            "select event_type, count() as events, avg(latency_ms) as avg_latency_ms\nfrom analytics.events\nwhere tenant = '${TENANT}'\ngroup by event_type\norder by events desc\nlimit ${LIMIT};",
            &["analytics", "warehouse", "funnel"][..],
        ),
        (
            "saved-screenshot-customer-journeys",
            "Customer journey paths",
            "Graph traversal for customers, orders, and product touchpoints.",
            "Graph",
            "fixture-neo4j",
            "cypher",
            "MATCH path = (account)-[*1..3]-(order)\nRETURN path\nLIMIT 25",
            &["graph", "journey", "customers"][..],
        ),
    ]
    .into_iter()
    .filter_map(
        |(id, name, summary, folder, connection_id, language, query_text, tags)| {
            connections
                .iter()
                .any(|connection| connection.id == connection_id)
                .then(|| SavedWorkItem {
                    id: id.into(),
                    kind: "query".into(),
                    name: name.into(),
                    summary: summary.into(),
                    tags: tags.iter().map(|tag| (*tag).into()).collect(),
                    updated_at: created_at.into(),
                    folder: Some(folder.into()),
                    favorite: Some(true),
                    connection_id: Some(connection_id.into()),
                    environment_id: Some(environment_id.into()),
                    language: Some(language.into()),
                    query_text: Some(query_text.into()),
                    snapshot_result_id: None,
                })
        },
    )
    .collect()
}

fn screenshot_api_server_preferences(
    connections: &[ConnectionProfile],
    environment_id: &str,
) -> DatastoreApiServerPreferences {
    let connection_id = connections
        .iter()
        .find(|connection| connection.id == "fixture-postgresql")
        .or_else(|| connections.first())
        .map(|connection| connection.id.clone());

    DatastoreApiServerPreferences {
        enabled: true,
        host: "127.0.0.1".into(),
        port: 17640,
        auto_start: false,
        connection_id: connection_id.clone(),
        environment_id: Some(environment_id.into()),
        active_server_id: Some("api-server-screenshot".into()),
        servers: vec![DatastoreApiServerConfig {
            id: "api-server-screenshot".into(),
            name: "Showcase API Server".into(),
            description: Some("Read-only local API profile for website screenshots.".into()),
            host: "127.0.0.1".into(),
            port: 17640,
            auto_start: false,
            protocol: "rest".into(),
            base_path: "/showcase".into(),
            connection_id,
            environment_id: Some(environment_id.into()),
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
        }],
    }
}

fn screenshot_mcp_server_preferences(
    connections: &[ConnectionProfile],
    environment_id: &str,
) -> DatastoreMcpServerPreferences {
    DatastoreMcpServerPreferences {
        enabled: true,
        host: "127.0.0.1".into(),
        port: 17641,
        auto_start: false,
        active_server_id: Some("mcp-server-screenshot".into()),
        servers: vec![DatastoreMcpServerConfig {
            id: "mcp-server-screenshot".into(),
            name: "Showcase MCP Server".into(),
            description: Some("Local-only MCP profile with allowlisted demo datastores.".into()),
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: false,
            allowed_origins: Vec::new(),
            connection_ids: connections
                .iter()
                .filter(|connection| {
                    matches!(
                        connection.id.as_str(),
                        "fixture-postgresql"
                            | "fixture-mongodb"
                            | "fixture-redis"
                            | "fixture-opensearch"
                            | "fixture-clickhouse"
                            | "fixture-neo4j"
                    )
                })
                .map(|connection| connection.id.clone())
                .collect(),
            environment_ids: vec![environment_id.into()],
            tokens: Vec::new(),
        }],
    }
}
