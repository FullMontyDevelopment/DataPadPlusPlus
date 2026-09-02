# Settings, Workspaces, And Backups

The canonical user walkthrough is available in the [website documentation](https://datapad-plus-plus.org/docs/settings-workspace-backups). This reference describes persistence and recovery behavior.

> [!CAUTION]
> DataPad++ is pre-release software. A workspace backup protects DataPad++ configuration and saved work; it is not a backup of the connected datastores and must not be the only copy of important information.

## Workspace Versioning

Workspace schema version 12 is the current synchronized frontend/backend contract. Three versions serve different purposes:

- `schemaVersion` identifies persisted workspace structure.
- `workspaceRevision` orders cross-window state changes and rejects stale responses.
- `formatVersion` identifies the encrypted export envelope.

Missing schemas and supported legacy schemas are normalized through the compatibility path and then migrated sequentially. Migrations run against a cloned snapshot, validate before committing, and create recovery state first. A workspace created by a newer unsupported DataPad++ version is rejected without changing the file.

Vault-writing migrations create new DataPad++-owned entries before durable persistence and remove superseded entries only after persistence succeeds. Failure removes newly created entries and preserves the original workspace.

## Persistent Versus Refreshable State

Persisted state includes:

- connections and environments without plaintext secrets;
- folders, saved queries, scripts, snippets, notes, and test definitions;
- open and recently closed tab identity, targets, drafts, pin state, renderer, and window placement;
- environment color and query/database/schema scope;
- preferences and plugin enablement.

Refreshable runtime payloads are omitted from persistence and backups, including query results, object payloads, metrics diagnostics, cached security results, completed test observations, active execution, and transient errors. Restored views retain enough identity to show **Refresh to load current data**.

Execution history retains the newest entries within the workspace-wide count and serialized-size budgets. Saved queries and current drafts are never truncated to satisfy history retention.

## Workspace Switching

The workspace registry is authoritative for workspace name, active marker, schema version, and summary counts. A successful switch replaces the active bootstrap payload and registry status together so Explorer and open tabs cannot remain attached to the previous workspace.

Switching workspaces closes the previous workspace's detached editor windows and restores the selected workspace's window layout when the experimental Multi-window Tabs plugin is enabled.

## Opaque Connection-String Secrets

A complete connection string is stored as one opaque operating-system vault value. DataPad++ does not parse, normalize, split, or reconstruct it.

- Workspace persistence contains only the DataPad++-owned vault reference.
- Leaving the secret-style field blank while editing preserves the stored value.
- Entering a new value atomically replaces it.
- The backend resolves it only for connection testing or execution and applies environment interpolation in memory.
- Deleting or changing connection mode removes superseded references after persistence succeeds.
- Browser preview stores connection strings in memory only.

Legacy plaintext or component-bound connection strings migrate into a fresh full-string vault entry. Errors identify the affected connection name and datastore without displaying the value.

## Export Dialog

Workspace export uses an application-level dialog:

1. Choose whether to include passwords and secrets. The default is no.
2. Enter and confirm the bundle passphrase.
3. Review the security summary and validation.
4. Choose a destination through the operating-system save picker.

The suggested filename uses the active workspace name and date. Canceling the picker leaves the dialog open and is reported as cancellation, not success or failure.

The bundle uses compact JSON, compression, authenticated metadata, and authenticated encryption. Secret-inclusive export fails rather than producing a partial bundle when any selected secret cannot be resolved. The automatic-backup passphrase is never included.

## File-First Import

Import is staged and memory-only:

1. **Choose File** validates the file size and envelope before requesting a passphrase.
2. **Unlock** accepts retryable passphrases without requiring another file selection.
3. **Review and Import** shows format/schema, encrypted and decrypted sizes, counts, warnings, and included-secret availability.
4. **Create New Workspace** is the default and requires a valid editable name.
5. **Replace Current Workspace** is explicitly destructive, retains the current identity/name, and creates recovery state.
6. Included passwords and secrets are imported only after explicit opt-in and are remapped to fresh DataPad++-owned vault references.

Staged selections expire, are bound to the current revision, and are canceled when the dialog closes. Commit occurs only after validation, vault writes, and durable persistence succeed. The frontend applies the returned workspace payload and authoritative registry status atomically.

## Automatic Backups

Automatic backups are opt-in, encrypted, and created only after the workspace changes. The default cadence is 30 minutes and retention remains 20 files. Every backup file, including a corrupt one, counts toward rotation.

The backup passphrase is stored through the operating-system vault. Restore uses the same preview, validation, rollback, and secret-remapping pipeline as manual import.

## Analyze Workspace Size

**Settings → Workspace + Backups → Analyze Workspace Size** reports:

- live workspace and recovery-file sizes;
- backup count, total size, and average size;
- projected plaintext, compressed, and encrypted bundle sizes;
- grouped contributions from connections, environments, tabs, closed tabs, saved work, history, derived manifests, and cached payloads;
- the largest tabs split into draft, history, object, metrics, and test state;
- secret count and aggregate secret bytes only during explicitly secret-inclusive analysis.

The report contains sizes and counts, never queries, values, credentials, connection strings, payload contents, or full local paths. **Analyze Backup** provides the same report after unlocking an existing bundle without importing it.

## Settings Areas

- **Appearance:** theme and workbench presentation.
- **Workspace + Backups:** registry, switching, import/export, automatic backups, restore, and size analysis.
- **Plugins:** optional and experimental features such as Multi-window Tabs, Workspace Search, API Server, MCP Server, security checks, and tests.
- **Security:** lock and secret-store posture.
- **Updates:** stable/prerelease update preferences.
- **Health and Diagnostics:** sanitized runtime and adapter evidence.

See also [Security And Safety](architecture/security-and-safety.md) and [Multi-window Tabs](multi-window-tabs.md).
