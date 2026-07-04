# Security And Safety

DataPad++ is expected to handle live credentials and production systems, so security and safety need to be part of the architecture rather than later polish.

## Secret handling

Preferred approach:

- store secret values in the OS credential store or keychain
- keep only references in regular app persistence
- redact secret values in logs, previews, and exports by default
- require explicit opt-in for any export that includes secrets
- keep connection tests and diagnostics from echoing raw passwords, tokens, private keys, or connection strings
- clear secret drafts after save, test, import, export, and close flows where possible

## Environment safeguards

Environments are first-class and should carry visible risk context:

- Local / Dev: standard workflow
- QA / UAT / Stage: elevated awareness
- Prod: persistent warning state, stricter confirmation, optional safe mode

The active environment should remain visible in the shell, explorer, editor, and result views.

## Guardrails

Guardrails should be policy-driven and connection-aware:

- read-only connection mode
- confirmation for destructive operations
- banners for production or restricted environments
- warnings for large result sets or long-running operations
- unresolved variable detection before connect or execute
- preview-only plans for admin/destructive/schema/cloud-cost workflows
- explicit warnings for profiling operations that execute the query, such as `EXPLAIN ANALYZE`
- disabled-action reasons when permissions, adapter maturity, read-only mode, or missing identity prevent an action

## Safe edits

DataPad++ supports safe live data edits only when an adapter can identify the target unambiguously and build a native or parameterized request.

Examples:

- SQL row edits require table and primary-key context.
- MongoDB document edits require a collection and document id.
- Redis/Valkey key edits require a concrete key.
- DynamoDB item edits require complete key conditions.
- Cassandra row edits require complete primary-key conditions.

When those conditions are missing, the UI should show a disabled action or a guarded plan instead of attempting a best-effort write.

## Operation previews

Guarded operation plans should show:

- generated SQL, command text, or API request body
- risk level
- destructive/costly flags
- required permissions
- estimated cost or scan impact where available
- environment/read-only guardrail status
- exact confirmation text when execution is supported

## Datastore security checks

The Datastore Security Checks plugin separates vulnerability data from posture data:

- vulnerability findings come from detected product versions, curated CPE mapping, NVD CVE data, CISA KEV enrichment, and the bundled known-version catalog
- posture findings come from saved connection profiles and bounded read-only probes only
- posture probes must not write data, change settings, create objects, or call provider control planes
- permission failures should become `unknown` posture results instead of failing the whole scan
- evidence must be sanitized and should never persist passwords, tokens, raw connection strings, or full command payloads

Deep posture probes are limited to the native live set: PostgreSQL/CockroachDB/TimescaleDB, MySQL/MariaDB, SQL Server/Azure SQL, MongoDB, Redis/Valkey, Elasticsearch/OpenSearch, SQLite, and DuckDB. Other declared engines stay profile-only until a future phase adds explicit adapter or cloud-provider support.

## Desktop protection

The native layer should support:

- app-level locking after inactivity
- optional master password or biometric unlock when feasible
- encrypted exports for portable artifacts
- SHA-256 integrity verification inside encrypted workspace bundles
- opt-in encrypted auto-backups with passphrases stored only through the secret store
- clear separation between UI code and privileged native commands

## Experimental MCP Server Plugin

The desktop MCP Server plugin is opt-in and locked down by default:

- disabled by default, with no default auto-start
- bound only to `127.0.0.1:<port>` and served only at `/mcp`
- rejects non-loopback peers and unexpected `Host` headers
- rejects browser-style `Origin` headers unless explicitly allowlisted
- requires `Authorization: Bearer <auth token>` on every request
- rejects auth tokens in query strings, workspace files, request bodies, and logs
- stores only auth token verifiers through secure secret storage
- exposes only allowlisted datastores and environments
- allows only scoped read, explore, list, context-switch, and diagnostic tools in v1
- enforces row limits, query timeouts, read-only query checks, and full request audit logs

MCP session IDs are not authentication. They are random session identifiers only; auth-token checks run for every request.

MCP client automatic setup follows the same auth token rules. The desktop app can update known user-level config files for supported local clients only after showing a preview. It merges a DataPad++ entry, creates a timestamped backup before overwriting existing config, and writes auth-token environment-variable references or client-side secure prompts instead of raw auth token values. Browser preview cannot apply MCP client config changes.

## Workspace bundles and backups

Workspace bundles are encrypted `.datapadpp-workspace` files. Normal exports include workspace structure, connection metadata, Library items, environments, and non-secret variable metadata. Secret values are excluded unless the user explicitly chooses to include passwords/secrets.

When secrets are included, they must be resolved from `SecretRef`s and stored only inside the encrypted secret envelope. New bundles include encrypted integrity metadata so import can reject corrupted or tampered bundles before applying workspace state or restoring secrets.

Auto-backups are opt-in, encrypted, and rotated. The auto-backup passphrase must be stored as a secret reference, not as workspace plaintext.

## Compatibility fallbacks

`DATAPADPLUSPLUS_*` is the current environment variable prefix. Legacy `DATANAUT_*` and `UNIVERSALITY_*` variables may still be read by the native host for local workspace, fixture, and secret-store compatibility. New docs, scripts, and examples should use the DataPad++ prefix.

## Tracked dependency exceptions

- `monaco-editor` currently pulls a moderate `dompurify` advisory through the editor dependency chain. Do not run `npm audit fix --force` or downgrade Monaco to clear this artificially; keep the advisory tracked and upgrade Monaco when an upstream patch is available.
