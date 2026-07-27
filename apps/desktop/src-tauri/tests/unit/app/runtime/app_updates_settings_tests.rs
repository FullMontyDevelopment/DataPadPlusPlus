use semver::Version;

use super::{
    channel_for_settings, reconcile_settings_for_build, set_include_prereleases, settings_response,
    StoredAppUpdateSettings,
};

fn version(value: &str) -> Version {
    Version::parse(value).expect("test version should be valid SemVer")
}

#[test]
fn stable_builds_default_to_the_stable_update_channel() {
    let current = version("1.4.0");
    let mut settings = StoredAppUpdateSettings::default();

    assert!(reconcile_settings_for_build(&mut settings, &current));

    let response = settings_response(settings.clone(), &current, true, None);
    assert_eq!(response.build_channel, "stable");
    assert!(!response.include_prereleases);
    assert!(!response.prerelease_auto_enabled);
    assert_eq!(channel_for_settings(&settings, &current), "stable");
}

#[test]
fn first_prerelease_observation_automatically_enables_prerelease_updates() {
    let current = version("1.5.0-beta.1");
    let mut settings = StoredAppUpdateSettings::default();

    assert!(reconcile_settings_for_build(&mut settings, &current));

    let response = settings_response(settings.clone(), &current, true, None);
    assert_eq!(response.build_channel, "prerelease");
    assert!(response.include_prereleases);
    assert!(response.prerelease_auto_enabled);
    assert_eq!(channel_for_settings(&settings, &current), "prerelease");
}

#[test]
fn prerelease_opt_out_survives_consecutive_prerelease_builds() {
    let first = version("1.5.0-beta.1");
    let next = version("1.5.0-rc.1");
    let mut settings = StoredAppUpdateSettings::default();
    reconcile_settings_for_build(&mut settings, &first);

    set_include_prereleases(&mut settings, &first, false);

    assert!(!reconcile_settings_for_build(&mut settings, &next));
    let response = settings_response(settings.clone(), &next, true, None);
    assert!(!response.include_prereleases);
    assert!(!response.prerelease_auto_enabled);
    assert_eq!(channel_for_settings(&settings, &next), "stable");
}

#[test]
fn stable_observation_resets_opt_out_for_a_future_prerelease() {
    let beta = version("1.5.0-beta.1");
    let stable = version("1.5.0");
    let future_beta = version("1.6.0-beta.1");
    let mut settings = StoredAppUpdateSettings::default();
    reconcile_settings_for_build(&mut settings, &beta);
    set_include_prereleases(&mut settings, &beta, false);

    assert!(reconcile_settings_for_build(&mut settings, &stable));
    assert_eq!(channel_for_settings(&settings, &stable), "stable");
    assert!(reconcile_settings_for_build(&mut settings, &future_beta));

    let response = settings_response(settings, &future_beta, true, None);
    assert!(response.include_prereleases);
    assert!(response.prerelease_auto_enabled);
}

#[test]
fn explicit_prerelease_selection_remains_explicit() {
    let current = version("1.5.0-beta.1");
    let mut settings = StoredAppUpdateSettings::default();
    reconcile_settings_for_build(&mut settings, &current);

    set_include_prereleases(&mut settings, &current, true);

    let response = settings_response(settings, &current, true, None);
    assert!(response.include_prereleases);
    assert!(!response.prerelease_auto_enabled);
}

#[test]
fn build_metadata_does_not_make_a_stable_version_prerelease() {
    let current = version("1.5.0+windows.4");
    let mut settings = StoredAppUpdateSettings::default();
    reconcile_settings_for_build(&mut settings, &current);

    let response = settings_response(settings, &current, true, None);
    assert_eq!(response.build_channel, "stable");
    assert!(!response.include_prereleases);
}

#[test]
fn malformed_installed_versions_are_rejected_by_semver() {
    assert!(Version::parse("nightly-build").is_err());
    assert!(Version::parse("1.5").is_err());
}
