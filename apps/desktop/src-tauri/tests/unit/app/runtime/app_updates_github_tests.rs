use super::*;

fn release(tag_name: &str, prerelease: bool, draft: bool, has_manifest: bool) -> GitHubRelease {
    GitHubRelease {
        tag_name: tag_name.into(),
        draft,
        prerelease,
        html_url: format!("https://github.com/example/releases/{tag_name}"),
        body: Some(format!("Notes for {tag_name}")),
        published_at: Some("2026-06-11T00:00:00Z".into()),
        assets: if has_manifest {
            vec![GitHubReleaseAsset {
                name: "latest.json".into(),
                browser_download_url: format!("https://github.com/example/{tag_name}/latest.json"),
            }]
        } else {
            Vec::new()
        },
    }
}

#[test]
fn stable_channel_selects_highest_non_prerelease() {
    let releases = vec![
        release("app-v0.2.0-beta.1", true, false, true),
        release("app-v0.1.23", false, false, true),
        release("app-v0.1.22", false, false, true),
    ];
    let selected = select_app_update_release(&releases, false, &Version::parse("0.1.22").unwrap())
        .unwrap()
        .unwrap();

    assert_eq!(selected.version, Version::parse("0.1.23").unwrap());
    assert!(!selected.prerelease);
}

#[test]
fn prerelease_channel_selects_highest_semver_release() {
    let releases = vec![
        release("app-v0.1.24", false, false, true),
        release("app-v0.2.0-beta.1", true, false, true),
        release("app-v0.1.23", false, false, true),
    ];
    let selected = select_app_update_release(&releases, true, &Version::parse("0.1.22").unwrap())
        .unwrap()
        .unwrap();

    assert_eq!(selected.version, Version::parse("0.2.0-beta.1").unwrap());
    assert!(selected.prerelease);
}

#[test]
fn release_selection_ignores_invalid_tags_and_drafts() {
    let releases = vec![
        release("v9.9.9", false, false, true),
        release("app-v9.9.9", false, true, true),
        release("app-v0.1.23", false, false, true),
    ];
    let selected = select_app_update_release(&releases, false, &Version::parse("0.1.22").unwrap())
        .unwrap()
        .unwrap();

    assert_eq!(selected.version, Version::parse("0.1.23").unwrap());
}

#[test]
fn release_selection_never_downgrades() {
    let releases = vec![
        release("app-v0.1.21", false, false, true),
        release("app-v0.1.22", false, false, true),
    ];

    assert!(
        select_app_update_release(&releases, false, &Version::parse("0.1.22").unwrap())
            .unwrap()
            .is_none()
    );
}

#[test]
fn newer_release_without_manifest_is_an_error() {
    let releases = vec![release("app-v0.1.23", false, false, false)];
    let error = select_app_update_release(&releases, false, &Version::parse("0.1.22").unwrap())
        .unwrap_err();

    assert_eq!(error.code, "app-update-release-missing-manifest");
}
