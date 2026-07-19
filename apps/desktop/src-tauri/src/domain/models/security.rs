use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DatastoreSecurityChecksPreferences {
    pub enabled: bool,
    pub refresh_interval_days: u32,
    pub muted_finding_ids: Vec<String>,
    pub last_refresh_attempt_at: Option<String>,
    pub last_successful_refresh_at: Option<String>,
    pub next_manual_refresh_allowed_at: Option<String>,
}

impl Default for DatastoreSecurityChecksPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            refresh_interval_days: 7,
            muted_finding_ids: Vec::new(),
            last_refresh_attempt_at: None,
            last_successful_refresh_at: None,
            next_manual_refresh_allowed_at: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityCpeCandidate {
    pub cpe_name: String,
    pub source: String,
    pub confidence: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityTarget {
    pub id: String,
    pub connection_id: String,
    pub environment_id: String,
    pub connection_name: String,
    pub environment_name: String,
    pub engine: String,
    pub family: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_product: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_latest_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_source_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_source_updated_at: Option<String>,
    #[serde(default)]
    pub cpe_candidates: Vec<DatastoreSecurityCpeCandidate>,
    pub finding_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highest_severity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityKevDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_ransomware_campaign_use: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityFindingReference {
    pub label: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityFinding {
    pub id: String,
    #[serde(default)]
    pub target_ids: Vec<String>,
    pub cve_id: String,
    pub title: String,
    pub summary: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cvss_score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cvss_vector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    pub affected_product: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affected_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affected_version_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_version_hint: Option<String>,
    pub remediation: String,
    #[serde(default)]
    pub references: Vec<DatastoreSecurityFindingReference>,
    #[serde(default)]
    pub cwes: Vec<String>,
    pub known_exploited: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kev: Option<DatastoreSecurityKevDetails>,
    #[serde(default)]
    pub source_urls: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityPostureCheckResult {
    pub id: String,
    #[serde(default)]
    pub target_ids: Vec<String>,
    pub rule_id: String,
    pub category: String,
    pub status: String,
    pub severity: String,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    pub remediation: String,
    pub source: String,
    #[serde(default)]
    pub references: Vec<DatastoreSecurityFindingReference>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecuritySourceMetadata {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_count: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityCheckSnapshot {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub source_metadata: Vec<DatastoreSecuritySourceMetadata>,
    #[serde(default)]
    pub targets: Vec<DatastoreSecurityTarget>,
    #[serde(default)]
    pub findings: Vec<DatastoreSecurityFinding>,
    #[serde(default)]
    pub posture_checks: Vec<DatastoreSecurityPostureCheckResult>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityChecksSettingsRequest {
    pub enabled: bool,
    pub refresh_interval_days: Option<u32>,
    pub muted_finding_ids: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityChecksRefreshRequest {
    #[serde(default)]
    pub manual: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSecurityChecksStatus {
    pub supported: bool,
    pub enabled: bool,
    pub message: String,
    pub can_refresh: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_blocked_reason: Option<String>,
    pub preferences: DatastoreSecurityChecksPreferences,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<DatastoreSecurityCheckSnapshot>,
}
