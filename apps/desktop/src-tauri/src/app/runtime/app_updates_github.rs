use std::time::Duration;

use semver::Version;
use serde::Deserialize;

use crate::domain::error::CommandError;

pub(super) const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/FullMontyDevelopment/DataPadPlusPlus/releases?per_page=30";
const GITHUB_API_VERSION: &str = "2026-03-10";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Clone, Debug)]
pub(super) struct SelectedGitHubRelease {
    pub version: Version,
    pub prerelease: bool,
    pub release_url: String,
    pub manifest_url: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

pub(super) async fn fetch_github_releases() -> Result<Vec<GitHubRelease>, CommandError> {
    let response = reqwest::Client::builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|error| {
            CommandError::new(
                "app-update-http-client",
                format!("Unable to initialize the GitHub client. {error}"),
            )
        })?
        .get(GITHUB_RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .header("User-Agent", "DataPad++ updater")
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "app-update-github-network",
                format!("Unable to reach GitHub Releases. {error}"),
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        let remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok());
        let message = if status.as_u16() == 403 && remaining == Some("0") {
            "GitHub API rate limit reached. Try again later.".to_string()
        } else {
            format!("GitHub Releases returned HTTP {status}.")
        };
        return Err(CommandError::new("app-update-github-response", message));
    }

    response
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|error| {
            CommandError::new(
                "app-update-github-json",
                format!("GitHub Releases returned an unexpected response. {error}"),
            )
        })
}

pub(super) fn select_app_update_release(
    releases: &[GitHubRelease],
    include_prereleases: bool,
    current_version: &Version,
) -> Result<Option<SelectedGitHubRelease>, CommandError> {
    let mut candidates = releases
        .iter()
        .filter(|release| !release.draft)
        .filter(|release| include_prereleases || !release.prerelease)
        .filter_map(|release| {
            let version = release_version(&release.tag_name)?;
            if version <= *current_version {
                return None;
            }
            if !include_prereleases && !version.pre.is_empty() {
                return None;
            }
            Some((release, version))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|(_, left), (_, right)| right.cmp(left));

    let Some((release, version)) = candidates.into_iter().next() else {
        return Ok(None);
    };

    let manifest_url = release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("latest.json"))
        .map(|asset| asset.browser_download_url.clone())
        .ok_or_else(|| {
            CommandError::new(
                "app-update-release-missing-manifest",
                format!(
                    "GitHub release {} is newer but does not include latest.json.",
                    release.tag_name
                ),
            )
        })?;

    Ok(Some(SelectedGitHubRelease {
        version,
        prerelease: release.prerelease,
        release_url: release.html_url.clone(),
        manifest_url,
        notes: release.body.clone(),
        published_at: release.published_at.clone(),
    }))
}

fn release_version(tag_name: &str) -> Option<Version> {
    tag_name
        .strip_prefix("app-v")
        .and_then(|version| Version::parse(version).ok())
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/app_updates_github_tests.rs"]
mod tests;
