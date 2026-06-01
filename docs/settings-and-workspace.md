# Settings, Workspace Bundles, And Backups

DataPad++ settings open as a normal workbench tab. The tab is closeable, non-saveable, and organized with a left-side section menu so each page stays focused.

## Settings Sections

- **Appearance**: theme selection and workbench display preferences.
- **Workspace**: file-based workspace export and import.
- **Backups**: opt-in encrypted automatic backups and restore tools.
- **Security**: credential-store status and secret handling options.
- **Shortcuts**: keyboard shortcuts and command behavior.
- **Health**: workspace counts, warnings, and app/runtime status.

Settings apply immediately. The Settings tab does not show dirty indicators or save prompts.

## Themes

DataPad++ supports System, Dark, Light, Midnight, Graphite, Solarized Dark, Solarized Light, and High Contrast themes. Monaco editors currently map to the closest light or dark editor base while the surrounding workbench uses the selected DataPad++ theme tokens.

## Workspace Export

Workspace export writes an encrypted `.datapadpp-workspace` file through the operating system save dialog.

An exported bundle can include workspace layout, Library folders and saved items, connection profile metadata, environments, non-secret variable metadata, recents, and app state needed to restore the workspace.

Secrets are excluded by default. If **include passwords/secrets** is enabled, DataPad++ resolves reachable secret references and stores those secret values only inside the encrypted bundle secret envelope.

Every new bundle includes encrypted SHA-256 integrity metadata. On import, DataPad++ decrypts the bundle, recomputes the digest, and rejects the file before applying it if the contents have been corrupted or modified.

## Workspace Import

Workspace import uses the operating system file picker and expects a `.datapadpp-workspace` file plus the passphrase used to create it.

Import behavior:

- the bundle must decrypt successfully
- integrity must verify for bundles that include integrity metadata
- bundled secrets are restored into the desktop secret store before the workspace is applied
- legacy bundles without integrity metadata remain supported
- wrong-passphrase, corrupt-file, and missing-secret-store failures are shown without leaking secret values

## Auto-Backups

Auto-backup is opt-in. When enabled, DataPad++ creates encrypted workspace snapshots while the app is open, only after the workspace has changed. The default cadence is 30 minutes and the app keeps at most 20 automatic backups, rotating out the oldest after a successful new backup.

Enabling auto-backup requires a passphrase. That passphrase is stored in the operating system secret store as a secret reference, not as plaintext workspace data.

Backup tools include enable/disable, change passphrase, include passwords/secrets, manual backup, list backups, restore selected backup, and delete selected backup.

## Security Expectations

- Passwords and tokens should never appear in workspace JSON, diagnostics, messages, logs, or non-secret exports.
- Bundle integrity hashes live inside the encrypted payload so they do not expose a stable public workspace fingerprint.
- Exporting secrets is always explicit and encrypted.
- Import never applies a tampered bundle or restores bundled secrets before integrity verification succeeds.
