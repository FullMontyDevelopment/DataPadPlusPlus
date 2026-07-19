fn cpe_target_map(targets: &[DatastoreSecurityTarget]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for target in targets {
        for candidate in &target.cpe_candidates {
            map.entry(candidate.cpe_name.clone())
                .or_default()
                .push(target.id.clone());
        }
    }
    for target_ids in map.values_mut() {
        target_ids.sort();
        target_ids.dedup();
    }
    map
}

async fn fetch_nvd_findings(
    manager: &DatastoreSecurityCheckManager,
    client: &reqwest::Client,
    cpe_name: &str,
    target_ids: &[String],
    kev_map: &HashMap<String, KevEntry>,
) -> Result<(usize, Vec<DatastoreSecurityFinding>), CommandError> {
    let mut start_index = 0usize;
    let mut findings = Vec::new();
    let mut pages = 0usize;

    loop {
        manager.wait_for_nvd_slot().await?;
        let mut url = Url::parse(NVD_CVE_API_URL).map_err(|error| {
            CommandError::new(
                "datastore-security-checks-nvd-url",
                format!("NVD CVE API URL is invalid: {error}"),
            )
        })?;
        url.query_pairs_mut()
            .append_pair("cpeName", cpe_name)
            .append_pair("startIndex", &start_index.to_string());
        let response: NvdCveResponse = fetch_official_json(client, url, "NVD CVE API").await?;
        let total_results = response.total_results;
        for item in response.vulnerabilities {
            if let Some(finding) = nvd_vulnerability_to_finding(item, target_ids, kev_map) {
                findings.push(finding);
            }
        }

        pages += 1;
        start_index += response.results_per_page.max(1);
        if start_index >= total_results || pages >= MAX_NVD_PAGES_PER_CPE {
            break;
        }
    }

    let finding_count = findings.len();
    Ok((finding_count, findings))
}

fn nvd_source_url(cpe_name: &str) -> String {
    let mut url = Url::parse(NVD_CVE_API_URL).expect("static NVD URL is valid");
    url.query_pairs_mut().append_pair("cpeName", cpe_name);
    url.to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCveResponse {
    #[serde(default)]
    total_results: usize,
    #[serde(default = "default_nvd_page_size")]
    results_per_page: usize,
    #[serde(default)]
    vulnerabilities: Vec<NvdVulnerability>,
}

fn default_nvd_page_size() -> usize {
    2000
}

#[derive(Deserialize)]
struct NvdVulnerability {
    cve: NvdCve,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCve {
    id: String,
    #[serde(default)]
    descriptions: Vec<NvdLangValue>,
    #[serde(default)]
    published: Option<String>,
    #[serde(default)]
    last_modified: Option<String>,
    #[serde(default)]
    metrics: Value,
    #[serde(default)]
    weaknesses: Vec<NvdWeakness>,
    #[serde(default, deserialize_with = "deserialize_nvd_references")]
    references: Vec<NvdReference>,
    #[serde(default)]
    configurations: Vec<NvdConfiguration>,
}

#[derive(Deserialize)]
struct NvdLangValue {
    #[serde(default)]
    lang: String,
    #[serde(default)]
    value: String,
}

#[derive(Deserialize, Default)]
struct NvdWeakness {
    #[serde(default)]
    description: Vec<NvdLangValue>,
}

#[derive(Deserialize)]
struct NvdReference {
    url: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdConfiguration {
    #[serde(default)]
    nodes: Vec<NvdConfigurationNode>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdConfigurationNode {
    #[serde(default)]
    cpe_match: Vec<NvdCpeMatch>,
    #[serde(default)]
    children: Vec<NvdConfigurationNode>,
}

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdCpeMatch {
    #[serde(default)]
    vulnerable: bool,
    #[serde(default)]
    criteria: String,
    #[serde(default)]
    version_start_including: Option<String>,
    #[serde(default)]
    version_start_excluding: Option<String>,
    #[serde(default)]
    version_end_including: Option<String>,
    #[serde(default)]
    version_end_excluding: Option<String>,
}

fn deserialize_nvd_references<'de, D>(deserializer: D) -> Result<Vec<NvdReference>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum References {
        Current(Vec<NvdReference>),
        Legacy {
            #[serde(default, rename = "referenceData")]
            reference_data: Vec<NvdReference>,
        },
    }

    Ok(match References::deserialize(deserializer)? {
        References::Current(references) => references,
        References::Legacy { reference_data } => reference_data,
    })
}

fn nvd_vulnerability_to_finding(
    vulnerability: NvdVulnerability,
    target_ids: &[String],
    kev_map: &HashMap<String, KevEntry>,
) -> Option<DatastoreSecurityFinding> {
    let cve = vulnerability.cve;
    let description = cve
        .descriptions
        .iter()
        .find(|item| item.lang == "en")
        .or_else(|| cve.descriptions.first())
        .map(|item| item.value.clone())
        .unwrap_or_default();
    if description.trim().is_empty() {
        return None;
    }
    let (severity, cvss_score, cvss_vector) = cvss_from_metrics(&cve.metrics);
    let affected_version_range = nvd_affected_version_range(&cve.configurations);
    let fixed_version_hint = nvd_fixed_version_hint(&cve.configurations);
    let kev = kev_map.get(&cve.id);
    let known_exploited = kev.is_some();
    let remediation = kev
        .map(|entry| entry.required_action.clone())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            fixed_version_hint
                .as_ref()
                .map(|hint| format!("Review the vendor advisory and upgrade to a version outside the affected range ({hint})."))
        })
        .unwrap_or_else(|| {
            "Review the vendor advisory and apply a supported patched version.".into()
        });
    let mut references = cve
        .references
        .into_iter()
        .take(12)
        .map(|reference| DatastoreSecurityFindingReference {
            label: reference
                .source
                .clone()
                .filter(|source| !source.trim().is_empty())
                .unwrap_or_else(|| reference.url.clone()),
            url: reference.url,
            source: reference.source,
        })
        .collect::<Vec<_>>();
    references.insert(
        0,
        DatastoreSecurityFindingReference {
            label: "NVD".into(),
            url: format!("https://nvd.nist.gov/vuln/detail/{}", cve.id),
            source: Some("NVD".into()),
        },
    );

    Some(DatastoreSecurityFinding {
        id: cve.id.clone(),
        target_ids: target_ids.to_vec(),
        cve_id: cve.id.clone(),
        title: cve.id.clone(),
        summary: description,
        severity,
        cvss_score,
        cvss_vector,
        published_at: cve.published,
        modified_at: cve.last_modified,
        affected_product: "Mapped datastore product".into(),
        affected_version: None,
        affected_version_range,
        fixed_version_hint,
        remediation,
        references,
        cwes: cwes_from_weaknesses(&cve.weaknesses),
        known_exploited,
        kev: kev.map(|entry| DatastoreSecurityKevDetails {
            date_added: Some(entry.date_added.clone()),
            required_action: Some(entry.required_action.clone()),
            due_date: Some(entry.due_date.clone()),
            known_ransomware_campaign_use: entry.known_ransomware_campaign_use.clone(),
            notes: entry.notes.clone(),
        }),
        source_urls: vec![
            format!("https://nvd.nist.gov/vuln/detail/{}", cve.id),
            CISA_KEV_URL.into(),
        ],
    })
}

fn nvd_affected_version_range(configurations: &[NvdConfiguration]) -> Option<String> {
    let mut ranges = BTreeSet::new();
    for cpe_match in vulnerable_nvd_cpe_matches(configurations) {
        if let Some(range) = nvd_cpe_match_range_label(&cpe_match) {
            ranges.insert(range);
        }
    }

    if ranges.is_empty() {
        None
    } else {
        Some(ranges.into_iter().take(3).collect::<Vec<_>>().join(", "))
    }
}

fn nvd_fixed_version_hint(configurations: &[NvdConfiguration]) -> Option<String> {
    let mut hints = BTreeSet::new();
    for cpe_match in vulnerable_nvd_cpe_matches(configurations) {
        if let Some(version) = cpe_match.version_end_excluding.as_deref() {
            hints.insert(format!(">= {version}"));
        } else if let Some(version) = cpe_match.version_end_including.as_deref() {
            hints.insert(format!("> {version}"));
        }
    }

    if hints.is_empty() {
        None
    } else {
        Some(hints.into_iter().take(3).collect::<Vec<_>>().join(", "))
    }
}

fn vulnerable_nvd_cpe_matches(configurations: &[NvdConfiguration]) -> Vec<NvdCpeMatch> {
    let mut matches = Vec::new();
    for configuration in configurations {
        for node in &configuration.nodes {
            collect_vulnerable_nvd_cpe_matches(node, &mut matches);
        }
    }
    matches
}

fn collect_vulnerable_nvd_cpe_matches(node: &NvdConfigurationNode, matches: &mut Vec<NvdCpeMatch>) {
    matches.extend(
        node.cpe_match
            .iter()
            .filter(|item| item.vulnerable)
            .cloned(),
    );
    for child in &node.children {
        collect_vulnerable_nvd_cpe_matches(child, matches);
    }
}

fn nvd_cpe_match_range_label(cpe_match: &NvdCpeMatch) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(version) = cpe_match.version_start_including.as_deref() {
        parts.push(format!(">= {version}"));
    }
    if let Some(version) = cpe_match.version_start_excluding.as_deref() {
        parts.push(format!("> {version}"));
    }
    if let Some(version) = cpe_match.version_end_including.as_deref() {
        parts.push(format!("<= {version}"));
    }
    if let Some(version) = cpe_match.version_end_excluding.as_deref() {
        parts.push(format!("< {version}"));
    }

    if !parts.is_empty() {
        return Some(parts.join(" and "));
    }

    cpe_version_from_criteria(&cpe_match.criteria).map(|version| format!("= {version}"))
}

fn cpe_version_from_criteria(criteria: &str) -> Option<String> {
    let version = criteria.split(':').nth(5)?.trim();
    if version.is_empty() || version == "*" || version == "-" {
        None
    } else {
        Some(version.to_string())
    }
}

fn cvss_from_metrics(metrics: &Value) -> (String, Option<f64>, Option<String>) {
    for key in [
        "cvssMetricV40",
        "cvssMetricV31",
        "cvssMetricV30",
        "cvssMetricV2",
    ] {
        if let Some(metric) = metrics
            .get(key)
            .and_then(Value::as_array)
            .and_then(|items| items.first())
        {
            let data = metric.get("cvssData").unwrap_or(metric);
            let severity = metric
                .get("baseSeverity")
                .or_else(|| data.get("baseSeverity"))
                .and_then(Value::as_str)
                .map(|value| value.to_ascii_uppercase())
                .unwrap_or_else(|| "UNKNOWN".into());
            let score = data.get("baseScore").and_then(Value::as_f64);
            let vector = data
                .get("vectorString")
                .and_then(Value::as_str)
                .map(str::to_string);
            return (normalize_severity(&severity), score, vector);
        }
    }
    ("UNKNOWN".into(), None, None)
}

fn normalize_severity(severity: &str) -> String {
    match severity.to_ascii_uppercase().as_str() {
        "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE" => severity.to_ascii_uppercase(),
        _ => "UNKNOWN".into(),
    }
}

fn cwes_from_weaknesses(weaknesses: &[NvdWeakness]) -> Vec<String> {
    let mut cwes = BTreeSet::new();
    for weakness in weaknesses {
        for description in &weakness.description {
            if description.value.starts_with("CWE-") {
                cwes.insert(description.value.clone());
            }
        }
    }
    cwes.into_iter().collect()
}

