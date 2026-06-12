use std::sync::Mutex;

use semver::Version;
use serde::Serialize;
use tauri::{ipc::Channel, plugin::TauriPlugin, AppHandle, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::domain::error::CommandError;

use super::{
    app_updates_github::{fetch_github_releases, select_app_update_release, UPDATE_CHECK_TIMEOUT},
    app_updates_settings::{
        channel_for_settings, read_stored_settings, save_stored_settings, settings_response,
        StoredAppUpdateSettings,
    },
    timestamp_now,
};

pub use super::app_updates_settings::{
    AppUpdateLastResult, AppUpdateSettings, AppUpdateSettingsRequest,
};

#[derive(Default)]
pub struct PendingAppUpdate(pub Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCandidate {
    pub version: String,
    pub current_version: String,
    pub channel: String,
    pub release_url: String,
    pub manifest_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pub_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub status: String,
    pub channel: String,
    pub current_version: String,
    pub checked_at: String,
    pub message: String,
    pub settings: AppUpdateSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate: Option<AppUpdateCandidate>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum AppUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
        content_length: Option<u64>,
        downloaded_bytes: u64,
    },
    Finished,
}

pub fn updater_public_key() -> Option<String> {
    option_env!("DATAPADPLUSPLUS_UPDATER_PUBKEY")
        .or(option_env!("TAURI_UPDATER_PUBKEY"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[derive(Clone, Copy)]
struct UpdaterSupport {
    supported: bool,
    message: Option<&'static str>,
}

fn updater_support() -> UpdaterSupport {
    if updater_public_key().is_none() {
        return UpdaterSupport {
            supported: false,
            message: Some("Update signing public key is not configured for this build."),
        };
    }

    if tauri_plugin_updater::target().is_none() {
        return UpdaterSupport {
            supported: false,
            message: Some("This platform is not supported by the updater."),
        };
    }

    UpdaterSupport {
        supported: true,
        message: None,
    }
}

fn update_settings_response(settings: StoredAppUpdateSettings) -> AppUpdateSettings {
    let support = updater_support();
    settings_response(settings, support.supported, support.message)
}

pub fn updater_plugin<R: Runtime>() -> TauriPlugin<R, tauri_plugin_updater::Config> {
    let mut builder = tauri_plugin_updater::Builder::new();
    if let Some(pubkey) = updater_public_key() {
        builder = builder.pubkey(pubkey);
    }
    builder.build()
}

pub fn get_app_update_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<AppUpdateSettings, CommandError> {
    Ok(update_settings_response(read_stored_settings(app)?))
}

pub fn set_app_update_settings<R: Runtime>(
    app: &AppHandle<R>,
    request: AppUpdateSettingsRequest,
) -> Result<AppUpdateSettings, CommandError> {
    let mut settings = read_stored_settings(app)?;
    settings.include_prereleases = request.include_prereleases;
    save_stored_settings(app, &settings)?;
    Ok(update_settings_response(settings))
}

pub async fn check_app_update<R: Runtime>(
    app: AppHandle<R>,
    pending_update: State<'_, PendingAppUpdate>,
) -> Result<AppUpdateCheckResult, CommandError> {
    let settings = read_stored_settings(&app)?;
    let result = match check_app_update_inner(&app, &pending_update, &settings).await {
        Ok(result) => result,
        Err(error) => error_update_result(&settings, &error.message),
    };
    persist_check_result(&app, result)
}

pub async fn install_app_update(
    pending_update: State<'_, PendingAppUpdate>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), CommandError> {
    let update = {
        let mut pending = pending_update.0.lock().map_err(|_| {
            CommandError::new(
                "app-update-state-unavailable",
                "Update state is temporarily unavailable. Restart DataPad++ if this continues.",
            )
        })?;
        pending.take()
    };

    let Some(update) = update else {
        return Err(CommandError::new(
            "app-update-missing",
            "Check for updates before installing.",
        ));
    };

    let mut started = false;
    let mut downloaded_bytes = 0_u64;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });
                    started = true;
                }
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                let _ = on_event.send(AppUpdateDownloadEvent::Progress {
                    chunk_length,
                    content_length,
                    downloaded_bytes,
                });
            },
            || {
                let _ = on_event.send(AppUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| {
            CommandError::new(
                "app-update-install",
                format!("Unable to install the update. {error}"),
            )
        })
}

async fn check_app_update_inner<R: Runtime>(
    app: &AppHandle<R>,
    pending_update: &State<'_, PendingAppUpdate>,
    settings: &StoredAppUpdateSettings,
) -> Result<AppUpdateCheckResult, CommandError> {
    let checked_at = timestamp_now();
    let channel = channel_for_settings(settings);
    let current_version = current_version()?;
    let support = updater_support();

    if !support.supported {
        clear_pending_update(pending_update)?;
        return Ok(AppUpdateCheckResult {
            status: "unsupported".into(),
            channel,
            current_version: current_version.to_string(),
            checked_at,
            message: support
                .message
                .unwrap_or("Updates are not available for this build.")
                .into(),
            settings: update_settings_response(settings.clone()),
            candidate: None,
        });
    }

    let releases = fetch_github_releases().await?;
    let Some(release) =
        select_app_update_release(&releases, settings.include_prereleases, &current_version)?
    else {
        clear_pending_update(pending_update)?;
        return Ok(AppUpdateCheckResult {
            status: "current".into(),
            channel,
            current_version: current_version.to_string(),
            checked_at,
            message: "DataPad++ is up to date.".into(),
            settings: update_settings_response(settings.clone()),
            candidate: None,
        });
    };

    let endpoint = Url::parse(&release.manifest_url).map_err(|error| {
        CommandError::new(
            "app-update-manifest-url",
            format!("The update manifest URL is invalid. {error}"),
        )
    })?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| {
            CommandError::new(
                "app-update-endpoint",
                format!("Unable to configure the update endpoint. {error}"),
            )
        })?
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|error| {
            CommandError::new(
                "app-update-build",
                format!("Unable to initialize the updater. {error}"),
            )
        })?
        .check()
        .await
        .map_err(|error| {
            CommandError::new(
                "app-update-check",
                format!("Unable to check for updates. {error}"),
            )
        })?;

    let Some(update) = update else {
        clear_pending_update(pending_update)?;
        return Ok(AppUpdateCheckResult {
            status: "error".into(),
            channel,
            current_version: current_version.to_string(),
            checked_at,
            message: format!(
                "GitHub release app-v{} exists, but no signed update is available for this platform.",
                release.version
            ),
            settings: update_settings_response(settings.clone()),
            candidate: None,
        });
    };

    let candidate = AppUpdateCandidate {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        channel: if release.prerelease {
            "prerelease".into()
        } else {
            "stable".into()
        },
        release_url: release.release_url,
        manifest_url: release.manifest_url,
        notes: update.body.clone().or(release.notes),
        pub_date: update
            .date
            .map(|date| date.to_string())
            .or(release.published_at),
        download_url: Some(update.download_url.to_string()),
    };

    {
        let mut pending = pending_update.0.lock().map_err(|_| {
            CommandError::new(
                "app-update-state-unavailable",
                "Update state is temporarily unavailable. Restart DataPad++ if this continues.",
            )
        })?;
        *pending = Some(update);
    }

    Ok(AppUpdateCheckResult {
        status: "available".into(),
        channel,
        current_version: current_version.to_string(),
        checked_at,
        message: format!("DataPad++ {} is available.", candidate.version),
        settings: update_settings_response(settings.clone()),
        candidate: Some(candidate),
    })
}

fn current_version() -> Result<Version, CommandError> {
    Version::parse(env!("CARGO_PKG_VERSION")).map_err(|error| {
        CommandError::new(
            "app-update-current-version",
            format!("The application version is not valid semver. {error}"),
        )
    })
}

fn error_update_result(settings: &StoredAppUpdateSettings, message: &str) -> AppUpdateCheckResult {
    let checked_at = timestamp_now();
    AppUpdateCheckResult {
        status: "error".into(),
        channel: channel_for_settings(settings),
        current_version: env!("CARGO_PKG_VERSION").into(),
        checked_at,
        message: message.into(),
        settings: update_settings_response(settings.clone()),
        candidate: None,
    }
}

fn persist_check_result<R: Runtime>(
    app: &AppHandle<R>,
    result: AppUpdateCheckResult,
) -> Result<AppUpdateCheckResult, CommandError> {
    let mut settings = read_stored_settings(app)?;
    settings.last_checked_at = Some(result.checked_at.clone());
    settings.last_result = Some(AppUpdateLastResult {
        status: result.status.clone(),
        channel: result.channel.clone(),
        checked_at: result.checked_at.clone(),
        version: result
            .candidate
            .as_ref()
            .map(|candidate| candidate.version.clone()),
        message: Some(result.message.clone()),
    });
    save_stored_settings(app, &settings)?;

    Ok(AppUpdateCheckResult {
        settings: update_settings_response(settings),
        ..result
    })
}

fn clear_pending_update(pending_update: &State<'_, PendingAppUpdate>) -> Result<(), CommandError> {
    let mut pending = pending_update.0.lock().map_err(|_| {
        CommandError::new(
            "app-update-state-unavailable",
            "Update state is temporarily unavailable. Restart DataPad++ if this continues.",
        )
    })?;
    *pending = None;
    Ok(())
}
