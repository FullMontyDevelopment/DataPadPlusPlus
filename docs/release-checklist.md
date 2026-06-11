# DataPad++ Release Checklist

DataPad++ desktop releases are created from GitHub Actions with a version input. The workflow updates every release version file, commits that release bump, creates or reuses `app-vX.Y.Z` at the release commit, builds platform bundles, and uploads artifacts to a draft GitHub Release.

Expected release assets:

- Windows x64: NSIS installer, MSI installer, and zipped raw `.exe`.
- Linux x64: `.deb`, `.rpm`, AppImage, and tarred raw executable.
- macOS Apple Silicon: `.app`/DMG bundle outputs and tarred raw executable.
- macOS Intel: temporarily disabled until a reliable runner is available.

GitHub also lists automatic source-code zip/tar archives on releases. Those archives are expected, but they are not DataPad++ desktop installers.

## Before Running Release

- Choose the next semantic version, for example `0.1.1` or `0.2.0-beta.1`.
- Optionally preview the version bump locally with `npm run release:bump -- <version>` on a throwaway branch.
- Run `npm run release:test`.
- Run `npm run ci:workflow:test` if the release workflow changed.
- Run `npm run check:all`.
- Confirm CI is green on the branch you will release from.
- Confirm there is no existing published release for `app-v<version>`.
- Confirm the repository remote points at `https://github.com/FullMontyDevelopment/DataPadPlusPlus.git` when releasing from the official repository.

## Production Signing Secrets

The release workflow can create unsigned draft artifacts for internal smoke testing. Public production releases should configure signing and notarization first.

Updater artifact signing:

- `DATAPADPLUSPLUS_UPDATER_PUBKEY`: repository variable containing the public updater key embedded in the app.
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

macOS code signing and notarization:

- `APPLE_CERTIFICATE`: base64 encoded `.p12` certificate that includes the private key.
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`.
- `APPLE_SIGNING_IDENTITY`: codesigning identity contained in that `.p12`.
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

The release workflow has a `macos_signing` input:

- `auto`: sign and notarize macOS artifacts when all Apple secrets are present and valid; otherwise build unsigned artifacts when no Apple secrets are configured.
- `disabled`: never pass Apple signing secrets to Tauri. Use this for internal unsigned test builds.
- `required`: fail the release if signing/notarization secrets are missing or invalid. Use this for production release candidates.

If macOS signing fails with `SecKeychainItemImport`, the `APPLE_CERTIFICATE` secret is usually not a base64 encoded `.p12` with a private key, or `APPLE_CERTIFICATE_PASSWORD` does not match. On Windows, create the secret value with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("DeveloperIDApplication.p12")) | Set-Clipboard
```

Windows Authenticode signing is not configured yet. Before a public stable Windows release, add certificate-backed signing so installers build trust with Windows SmartScreen.

## Manual Release Steps

1. Open the GitHub Actions `Release` workflow.
2. Run the workflow manually with the exact semantic version, for example `0.1.0` or `0.2.0-beta.1`. Choose `macos_signing=disabled` for unsigned internal builds, or `macos_signing=required` when preparing a production release.
3. Wait for the workflow to commit `chore: release v<version>` and create `app-v<version>`.
4. Wait for all platform builds to finish.
5. Open the draft GitHub Release named `DataPad++ v<version>`.
6. Confirm release assets exist for Windows, Linux, and macOS Apple Silicon where each platform build succeeded. Windows should include both NSIS and MSI installer outputs.
7. Confirm signed updater metadata exists when updater signing is configured: `latest.json` and `.sig` assets must be attached to the release.
8. Download representative installers and smoke-test launch.
9. Publish the draft release only after smoke tests pass.

The release workflow owns version-file updates. Do not pre-edit every version file just to make a release unless you are intentionally preparing or repairing release metadata.

## Smoke Tests

- Install or run the downloaded artifact.
- Confirm the app opens without a blank window.
- Confirm the app version shown by diagnostics matches the release version.
- Create or open a SQLite connection.
- Run a known read query against the seeded SQLite fixture if available.
- Open connection details, explorer, query, and diagnostics surfaces.
- Confirm no secrets, local absolute paths, or debug-only fixture credentials appear in release notes.

## Production Readiness Notes

- Releases are draft-first until install and launch checks are consistently reliable.
- The release workflow may commit version bumps, but the tag must point at source files with the release version.
- Add in-app updater configuration and updater UI in a later pass.
- Add Windows code signing before broad public distribution.
- Treat missing signing/notarization secrets as a release blocker for production channels, even if unsigned draft testing artifacts can still be useful.
- Keep CI dependency-free by default. Docker fixtures, live cloud checks, and desktop WebDriver smoke tests are local/manual validation unless a separate opt-in workflow is added.
