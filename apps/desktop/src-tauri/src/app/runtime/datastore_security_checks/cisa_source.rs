async fn fetch_cisa_kev(
    client: &reqwest::Client,
) -> Result<HashMap<String, KevEntry>, CommandError> {
    let url = Url::parse(CISA_KEV_URL).map_err(|error| {
        CommandError::new(
            "datastore-security-checks-cisa-url",
            format!("CISA KEV catalog URL is invalid: {error}"),
        )
    })?;
    let response: CisaKevCatalog = fetch_official_json(client, url, "CISA KEV catalog").await?;
    Ok(response
        .vulnerabilities
        .into_iter()
        .map(|entry| (entry.cve_id.clone(), entry))
        .collect())
}

async fn fetch_official_json<T>(
    client: &reqwest::Client,
    url: Url,
    source: &str,
) -> Result<T, CommandError>
where
    T: DeserializeOwned,
{
    let response = client
        .get(url)
        .header(ACCEPT, "application/json")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(reqwest_command_error)?;
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let body = response.text().await.map_err(reqwest_command_error)?;

    if !status.is_success() {
        return Err(CommandError::new(
            "datastore-security-checks-source-http-error",
            format!(
                "{source} returned HTTP {status} from {final_url}. Response preview: {}",
                response_preview(&body)
            ),
        ));
    }

    serde_json::from_str(&body).map_err(|error| {
        CommandError::new(
            "datastore-security-checks-source-json-invalid",
            format!(
                "{source} returned a response that could not be parsed as JSON. Content-Type: {content_type}. Response preview: {}. Details: {error}",
                response_preview(&body)
            ),
        )
    })
}

fn response_preview(body: &str) -> String {
    let mut compact = String::new();
    for part in body.split_whitespace() {
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(part);
        if compact.chars().count() >= 240 {
            break;
        }
    }

    if compact.trim().is_empty() {
        return "<empty body>".into();
    }

    let preview = compact.chars().take(240).collect::<String>();
    if compact.chars().count() > 240 || body.chars().count() > preview.chars().count() {
        format!("{preview}...")
    } else {
        preview
    }
}

#[derive(Deserialize)]
struct CisaKevCatalog {
    #[serde(default)]
    vulnerabilities: Vec<KevEntry>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KevEntry {
    #[serde(rename = "cveID")]
    cve_id: String,
    #[serde(default)]
    date_added: String,
    #[serde(default)]
    required_action: String,
    #[serde(default)]
    due_date: String,
    #[serde(default)]
    known_ransomware_campaign_use: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

