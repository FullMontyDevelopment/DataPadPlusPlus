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
mod providers;

use providers::*;
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

