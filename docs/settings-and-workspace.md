# Settings, Workspace Bundles, And Backups

DataPad++ settings open as a normal workbench tab. The tab is closeable, non-saveable, and organized with a left-side section menu so each page stays focused.

## Settings Sections

- **Appearance**: theme selection and workbench display preferences.
- **Workspace**: file-based workspace export and import.
- **Backups**: opt-in encrypted automatic backups and restore tools.
- **Security**: credential-store status and secret handling options.
- **Plugins**: opt-in workspace capabilities, split between stable plugins and experimental plugins.
- **Shortcuts**: keyboard shortcuts and command behavior.
- **Health**: workspace counts, warnings, and app/runtime status.

Settings apply immediately. The Settings tab does not show dirty indicators or save prompts.

## Plugins

Plugins are opt-in workspace capabilities. The current stable plugin is:

- **Workspace Search** indexes the current workspace snapshot so you can find connections, Library items, open tabs, recently closed tabs, scripts, queries, and test suites.

Experimental plugins stay disabled by default because they expose broader workspace or datastore context than ordinary query tabs:

- **API Server** opens local REST, GraphQL, or gRPC servers for selected datastore resources and saved Library queries.
- **MCP Server** opens a local Streamable HTTP MCP endpoint for scoped local coding clients.
- **Workspaces** adds an app-wide switcher for named local workspaces.
- **Datastore Security Checks** checks connected datastore product versions against NVD and CISA KEV data, then runs advisory posture checks for saved profiles and supported read-only metadata probes. Scan results also show bundled-catalog guidance such as known newer versions, recommended upgrade targets, and NVD affected-version ranges when the existing vulnerability response includes them. DataPad++ does not make extra release-feed calls or cloud-provider API calls during this step.

Start experimental plugins only when you need the integration, keep local listeners bound to `127.0.0.1`, and review the selected connection, environment, resources, scopes, auth tokens, and logs before leaving them running.

## Datastore Security Checks

Datastore Security Checks has two lanes:

- **Vulnerabilities**: detects product versions, maps curated CPE candidates, checks NVD and CISA KEV, and shows bundled known-version guidance.
- **Posture**: reviews TLS/certificate posture, auth mode, read-only and environment guardrails, secret-reference providers, local/emulator endpoints, privilege breadth, durability, and risky engine settings.

Deep read-only posture probes currently target PostgreSQL, CockroachDB, TimescaleDB, MySQL, MariaDB, SQL Server/Azure SQL, MongoDB, Redis/Valkey, Elasticsearch/OpenSearch, SQLite, and DuckDB. Oracle, DynamoDB, Cassandra, Cosmos DB, LiteDB, Memcached, ClickHouse, Snowflake, BigQuery, Prometheus, InfluxDB, OpenTSDB, Neo4j, ArangoDB, JanusGraph, and Neptune receive profile-only posture checks until a later phase adds explicit provider or adapter support.

Posture evidence is intentionally sanitized. The scanner stores summaries such as "TLS disabled" or "current role appears broad"; it does not persist passwords, tokens, raw connection strings, or full probe payloads. Permission-limited checks return **unknown** so teams can either grant read-only metadata visibility or review the setting manually.

## API Server Setup

The experimental API Server plugin can run local server profiles for selected datastore resources and saved-query endpoints.

Each server profile includes:

- a local port, name, description, protocol, and optional base path
- REST/OpenAPI, GraphQL, or gRPC posture
- the datastore connection and environment used for requests
- discovered resources such as tables, collections, indexes, items, or keys
- custom endpoints sourced from saved Library queries
- parameter definitions discovered from `{{api.name}}` tokens
- metrics and logs for the running server

Servers cannot start until a connection, environment, and at least one enabled resource or custom endpoint are configured. Project export creates working Rust or .NET services for PostgreSQL, SQLite, MongoDB, and DynamoDB across REST/OpenAPI, GraphQL, and gRPC. The export dialog reports per-resource CRUD/read-only modes and blocking reasons before creating an archive. Generated projects use real datastore clients, validate their connection at startup, and write environment-variable references instead of DataPad++ secret values. See [API Server Project Exports](api-server-project-exports.md) for the support matrix and runtime configuration.

## MCP Client Setup

The experimental MCP Server plugin includes a Setup section for local LLM coding clients. It generates endpoint-aware snippets for OpenAI Codex, VS Code/GitHub Copilot, Cursor, Claude Code, and Gemini CLI.

Automatic setup is desktop-only and user-level in v1. DataPad++ previews the target config path and DataPad++ entry, then creates a backup before applying the merge. It writes only endpoint and auth-token environment references; raw auth token values are never written to workspace JSON, workspace exports, or client config files by the automatic setup flow.

MCP server profiles use `127.0.0.1`, default port `17641`, Streamable HTTP at `/mcp`, scoped auth tokens, optional origin allowlists, status, metrics, and logs. Tokens are shown only once at creation or reset time; store the raw value in a secure environment variable such as `DATAPAD_MCP_TOKEN` and rotate it if it is lost.

The `plugin:read` token scope exposes the read-only `datapad_list_plugins` MCP tool. It lists Workspace Search, API Server, MCP Server, Workspaces, and Datastore Security Checks with enabled status, capability metadata, required scopes, and available MCP tools.

Using plugin features through MCP requires the matching scope. Workspace Search uses `workspace:search`; Security Checks uses `security:read`; API Server summary access uses `api-server:read`; MCP Server summary access uses `mcp-server:read`; Workspaces profile listing uses `workspaces:read`. These tools are read-only in MCP v1: they do not start or stop local listeners, refresh security scans, mute findings, switch whole workspace profiles, write client config, or expose raw tokens, verifier values, datastore secrets, or query result payloads.

## Workspace Search

Workspace Search is a plugin-backed workbench tab rather than a global modal. When enabled, it indexes:

- saved connections
- folders and Library items
- saved queries and scripts
- test suites
- open tabs
- recently closed tabs

The search UI supports result-type filters, match-case, whole-word matching, recent searches, grouped rows, and virtualized results for large workspaces. Opening a result routes to the underlying connection, Library item, open tab, or closed-tab recovery path.

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
- MCP client auth tokens are shown only at creation/reset time; workspace data stores verifier references only, and exports strip auth token metadata.
- Bundle integrity hashes live inside the encrypted payload so they do not expose a stable public workspace fingerprint.
- Exporting secrets is always explicit and encrypted.
- Import never applies a tampered bundle or restores bundled secrets before integrity verification succeeds.
