# Connection editor implementation

The [connection how-to](https://datapad-plus-plus.org/docs/connections) is the canonical user guide. This reference describes the implementation and its current limits.

> [!CAUTION]
> DataPad++ is pre-release software and should not be used for production workloads. Begin with disposable, local, or read-only systems and keep independent backups.

The connection editor opens as a responsive dialog. Connection methods are visible tabs with arrow-key navigation; switching methods preserves the unsaved draft. General settings remain visible; Authentication, TLS & certificates, and Advanced settings are collapsible. Inputs use defined, theme-aware borders. Existing connection edits do not change the selected query tab.

## Connection methods and saving

Use the highlighted **Create connection** database-plus action at the far right of the Library toolbar. The selected datastore determines the available tabs: **Connection fields**, **Connection string**, **Local database file**, and supported cloud/endpoint methods. Left/Right, Home, and End navigate the tabs. An existing profile's datastore type is not editable.

Enter the name, environment, target, and read-only posture under General, then expand only the optional sections needed. Unset optional controls retain driver defaults. The catalogue's **Runtime support and limitations** section describes unavailable runtime behavior; a displayed option is not evidence that every deployment has been live-validated.

**Test connection** does not save the profile or credential drafts. It is disabled for an uncreated local database and for pending secondary credential changes or credential removals. Save those changes before testing. **Save Connection** persists the profile and credential mutations together. Failed saves retain the draft for a deliberate retry.

## Canceling and discarding

**Cancel**, the header close button, and Escape close an unchanged editor. If the draft changed, they open a centered **Discard connection changes?** alert dialog above a dimmed, inert editor. The confirmation is outside the scrollable form, so it cannot be hidden below its inputs.

- **Keep editing** is focused by default. It preserves the draft and scroll position and restores focus to the originating control.
- Escape within the confirmation also keeps editing; Tab and Shift+Tab remain inside the confirmation.
- **Discard changes** closes without saving the profile or pending credentials. Clicking the backdrop does not discard.
- If a local file was already created but profile saving failed, the confirmation explains that the file remains on disk. Discard does not delete it.
- Cancel and close are disabled while saving or testing. Small viewports scroll the message while keeping both decisions available.

## Credentials

Saved values appear as a fixed placeholder mask, never an editable masking string. Choose **Reveal…**, confirm the disclosure, then read the value. The revealed value is read-only; choose **Hide** to enter a replacement. Revealed values hide after 30 seconds, window blur, dialog closure, workspace switching, or locking. This is confirmation in an unlocked application, **not master-password reauthentication**.

Type directly into a password or secret field, then use **Save Connection** to save it securely with the profile. No separate credential-save action is required. Leaving the field blank keeps the stored value. Use **Undo change** to discard a replacement or **Remove** to explicitly remove a supported credential when saving. The eye button shows or hides an unsaved value. Passwords, Oracle wallet passwords, Redis/Valkey Sentinel passwords, and complete connection strings use typed credential slots. The backend selects vault references from the saved profile, not caller-supplied vault coordinates. Saves use fresh references and preserve existing profile state on persistence failure.

Replacing or deleting a profile retires old DataPad++ vault entries only after checking references in the active and every registered inactive workspace. Shared credentials remain available to copied profiles. Unreadable or newer workspaces defer cleanup; a sanitized diagnostic records the deferral without exposing names, paths, or values.

Browser preview cannot save or reveal OS-vault credentials or create local database files. It rejects connection-editor saves containing credential mutations; this is not a working session-only password-save flow. Secret drafts must never be written to local storage. Browser session-only credential editing remains follow-up work.

## Local files

Choose **Open existing database** or **Create new database**. Choosing a folder does not create a file. Creation happens with **Create Database and Save Connection**.

SQLite and DuckDB support empty databases or example data. LiteDB uses its sidecar to initialize real pages, including optional password encryption. The current package does not bundle LiteDB: local creation requires the `DATAPADPLUSPLUS_LITEDB_SIDECAR_PATH` runtime configuration. Existing profiles may use a `SidecarPath` connection-string option.

Creation initializes a temporary file on the destination filesystem and publishes it without replacing existing files. If saving the profile fails afterward, the dialog retains the created path and retries only profile saving. Testing SQLite or DuckDB does not create a missing file. LiteDB testing opens the database read-only and no longer reports contract-only success.

When creating a different LiteDB file from a saved encrypted profile, explicitly choose a new password or remove it for an unencrypted file. After creation, the password is fixed while profile saving is retried so the saved connection cannot accidentally use a different password from the created file.

## Native runtime fixes

- MongoDB preserves explicit driver timeouts and passes the selected authentication mechanism. Optional native controls cover connection/server-selection timeouts, retryable reads/writes, direct connection, read preference, pool limits, idle timeout, and TLS certificate file paths. Incompatible direct/SRV, pool, and TLS combinations are rejected; omitted controls keep driver defaults.
- Only allowlisted Studio 3T display metadata is removed from the execution URI. The stored URI remains unchanged. Unknown Studio 3T options, including security and routing options, are rejected rather than silently ignored.
- PostgreSQL percent-encodes native usernames, passwords, and database names.
- Redis/Valkey Sentinel resolves its separately stored password.
- SQL Server accepts legacy `sqlserverOptions` and writes the frontend-compatible `sqlServerOptions` property.
- Missing primary credentials produce an actionable error instead of silently testing without a password.

The shared catalogue covers all 29 engine identities. Its entries describe controls and runtime limitations, not a claim that every engine has completed live validation.

## Remaining approved-plan work

Workspace schema is now **13**, following explicit approval. The sequential 12 → 13 migration is additive: it preserves existing settings and credential references. Desktop loading retains a separate original recovery copy, browser loading retains secret-free recovery state, and future versions are rejected before migration. No real user workspace was opened or migrated during implementation.

Still required before the entire plan is complete:

- Complete per-engine native-option audit, conditional controls, and unsupported saved-option handling.
- Browser session-only secret parity and draft testing for secondary credential changes.
- Broader transactional vault failure/rollback coverage and saved-secret validation on each OS.
- Live fixture matrix, native-window accessibility checks on each OS, and packaging checks.

The deterministic frontend, repository quality, sidecar, and native suites have been exercised. The connection dialog has also been checked in an isolated headless Windows browser at desktop, narrow, and short viewport sizes, including scrolling, discard-confirmation visibility, keyboard focus containment, and Escape recovery. This does not replace OS-vault or cross-platform live validation.

These changes are implementation work in progress; passing unit tests does not establish full native/cloud compatibility.

