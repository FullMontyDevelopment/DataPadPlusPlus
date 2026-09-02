import type { ScreenshotId } from './screenshots'
import type { DatastoreEngineId } from './datastores'

export type DocumentationStatus = 'Live' | 'Experimental' | 'Plan only' | 'Unavailable'

export type DocStep = {
  title: string
  body: string
}

export type DocArticle = {
  slug: string
  title: string
  description: string
  category: string
  readingTime: string
  screenshots: ScreenshotId[]
  steps: DocStep[]
  notes?: string[]
  status?: DocumentationStatus
  warning?: string
  relatedGuides?: string[]
  appliesTo?: DatastoreEngineId[]
  featured?: boolean
}

export const docArticles: DocArticle[] = [
  {
    slug: 'install-and-update',
    title: 'Install And Update DataPad++',
    description: 'Download the right desktop artifact, install it, and understand updater behavior.',
    category: 'Getting started',
    readingTime: '6 min',
    screenshots: ['download-release', 'hero-workbench'],
    steps: [
      {
        title: 'Open the Download page',
        body: 'Choose Download from the site navigation. The page reads the latest GitHub Releases and highlights the best artifact for your platform.',
      },
      {
        title: 'Pick the installer for your operating system',
        body: 'Windows users should prefer the installer or MSI. Linux users should prefer AppImage, then package formats. macOS users should prefer the DMG when it is available.',
      },
      {
        title: 'Avoid source archives',
        body: 'GitHub source zip and tar archives are repository snapshots. They are useful for contributors but are not desktop app installers.',
      },
      {
        title: 'Launch the app after installation',
        body: 'Open DataPad++ from your operating system launcher. Start with a local or read-only connection until you are familiar with guardrails.',
      },
      {
        title: 'Review update availability',
        body: 'Release builds include updater metadata when signing assets are present. Versions with SemVer prerelease metadata show a bottom-left Pre-release badge and automatically include pre-release updates on first use. You can opt out in Settings → Updates and remain on stable-only checks.',
      },
    ],
    notes: [
      'DataPad++ is pre-release software, so release artifacts can change while packaging matures.',
      'macOS Intel builds are not currently part of the expected release matrix.',
    ],
  },
  {
    slug: 'first-launch',
    title: 'First Launch Checklist',
    description: 'Orient yourself in the workbench before connecting to important systems.',
    category: 'Getting started',
    readingTime: '5 min',
    screenshots: ['hero-workbench', 'library-environments'],
    steps: [
      {
        title: 'Open the workspace',
        body: 'The main window opens into the workbench shell with navigation, Library, editor tabs, results, and detail panels.',
      },
      {
        title: 'Review the Library',
        body: 'Use the Library as the home base for connections, folders, saved queries, scripts, tests, snippets, notes, and environments.',
      },
      {
        title: 'Set a safe default posture',
        body: 'Global safe mode is off by default for new workspaces. Enable it for workspace-wide confirmation and inline-edit protection, or create a Local, QA, read-only, or safe-mode environment before connecting to production-like systems. Environment protections remain independent.',
      },
      {
        title: 'Open Settings',
        body: 'Check Appearance, Workspace, Backups, Security, Shortcuts, and Health before storing long-lived work.',
      },
      {
        title: 'Connect to a local fixture first',
        body: 'For evaluation, start with SQLite or Docker-backed fixtures so you can learn query, explorer, and result behavior without risking important data.',
      },
    ],
  },
  {
    slug: 'connections',
    title: 'Create A Connection',
    description: 'Build, test, save, and organize datastore connection profiles.',
    category: 'Connections, environments, and secrets',
    readingTime: '8 min',
    screenshots: ['connection-wizard', 'explorer-tree'],
    status: 'Live',
    relatedGuides: ['environments', 'workspace-import-export', 'safety-model'],
    steps: [
      {
        title: 'Choose New Connection',
        body: 'Start from the Library or connection surface and choose the datastore type that matches the system you want to inspect.',
      },
      {
        title: 'Enter native connection details',
        body: 'Fill in host, port, database, file path, credential mode, or cloud profile fields for the adapter. A complete connection string is treated as one opaque secret and stored unchanged behind an operating-system vault reference.',
      },
      {
        title: 'Name the profile clearly',
        body: 'Use a name that includes the system and purpose, such as PostgreSQL Local, Redis QA, or MongoDB Reporting Readonly.',
      },
      {
        title: 'Set safety options',
        body: 'Enable read-only mode or attach a low-risk environment when you are exploring a live system for the first time.',
      },
      {
        title: 'Test before saving',
        body: 'Run the connection test, review warnings or disabled reasons, then save only when the profile represents the target accurately. Connections start each session without a health badge; status appears only after a test or real datastore operation supplies evidence.',
      },
      {
        title: 'Organize in the Library',
        body: 'Place the connection in a folder that carries the right environment inheritance for related saved work.',
      },
    ],
  },
  {
    slug: 'environments',
    title: 'Use Environments And Variables',
    description: 'Keep risk, secrets, and target context visible while you work.',
    category: 'Connections, environments, and secrets',
    readingTime: '7 min',
    screenshots: ['library-environments', 'safety-preview'],
    steps: [
      {
        title: 'Create environment labels',
        body: 'Define environments such as Local, Development, QA, Stage, Production, or DR with distinct colors and risk levels.',
      },
      {
        title: 'Attach environments to folders',
        body: 'Assign an environment to a Library folder so child connections and saved work inherit the nearest context.',
      },
      {
        title: 'Use variables in repeatable work',
        body: 'Reference environment variables with the supported {{VAR_NAME}} syntax in connection strings or compatible editors.',
      },
      {
        title: 'Keep secrets masked',
        body: 'Store secret variables through desktop-safe storage where available. Secret values should resolve only at execution time.',
      },
      {
        title: 'Respect confirmation rules',
        body: 'Risky actions should require confirmation or stay preview-only when the environment says the target is sensitive.',
      },
    ],
  },
  {
    slug: 'library',
    title: 'Save Work In The Library',
    description: 'Organize connections, saved queries, scripts, notes, tests, and reusable snippets.',
    category: 'Getting started',
    readingTime: '6 min',
    screenshots: ['library-environments', 'sql-query-results'],
    steps: [
      {
        title: 'Create folders by project or system',
        body: 'Group related connections, saved queries, scripts, notes, and tests under folders that mirror how you actually work.',
      },
      {
        title: 'Save queries beside their target',
        body: 'When a query belongs to a connection, save it near that connection so the right environment and context stay visible.',
      },
      {
        title: 'Use notes for operational context',
        body: 'Capture reminders, safe run windows, data ownership, or production-change instructions beside the work they affect.',
      },
      {
        title: 'Avoid duplicate open tabs',
        body: 'Saved Library items open once so you do not accidentally edit two copies of the same reusable work.',
      },
      {
        title: 'Move work deliberately',
        body: 'Drag, rename, and reorganize Library items when a project changes, then confirm inherited environment context still matches.',
      },
    ],
  },
  {
    slug: 'explorer',
    title: 'Explore Datastore Objects',
    description: 'Use datastore-native object trees and context menus before writing queries.',
    category: 'Exploring and IntelliSense',
    readingTime: '8 min',
    screenshots: ['explorer-tree', 'search-diagnostics'],
    steps: [
      {
        title: 'Expand the connection',
        body: 'Open a saved connection from the Library to reveal objects that belong to that datastore family.',
      },
      {
        title: 'Scan native object groups',
        body: 'SQL connections show schemas, tables, views, routines, and indexes. MongoDB shows databases and collections. Redis shows key and diagnostic surfaces.',
      },
      {
        title: 'Open object details',
        body: 'Select an object to inspect columns, indexes, metadata, permissions, storage, diagnostics, or datastore-specific panels.',
      },
      {
        title: 'Use context actions',
        body: 'Right-click objects to open scoped queries, builders, previews, diagnostics, import/export workflows, or guarded management actions.',
      },
      {
        title: 'Prefer focused loading',
        body: 'Large enterprise schemas should be explored in focused slices instead of rendering every object and relationship at once.',
      },
    ],
  },
  {
    slug: 'querying',
    title: 'Query In The Right Mode',
    description: 'Choose raw editors, visual builders, consoles, and scoped query surfaces.',
    category: 'Querying and query builders',
    readingTime: '9 min',
    screenshots: ['sql-query-results', 'mongodb-builder', 'redis-browser'],
    status: 'Live',
    relatedGuides: ['typed-query-builders', 'sql-database-schema-scope', 'oracle-explorer-intellisense'],
    steps: [
      {
        title: 'Open a query from a connection or object',
        body: 'Use a connection-level action for a blank editor or an object action for a query already aimed at a table, collection, keyspace, index, or view.',
      },
      {
        title: 'Choose the mode that fits the datastore',
        body: 'SQL opens in raw SQL by default. MongoDB can use builder, raw JSON command, aggregation, or scripting-style reads. Redis and Valkey start in key-browser mode with a console available.',
      },
      {
        title: 'Use IntelliSense and snippets',
        body: 'Let cached metadata, dialect helpers, command hints, and known field paths guide query construction.',
      },
      {
        title: 'Run bounded reads first',
        body: 'Start with a limit, filter, projection, key pattern, or partition condition to keep initial results small and predictable.',
      },
      {
        title: 'Review generated queries',
        body: 'When visual builders generate a query, read it before saving or running. Invalid typed values or nested groups block compilation, execution, count, and editor handoff instead of falling back to stale text.',
      },
      {
        title: 'Save useful work',
        body: 'Save repeated queries to the Library with names that identify the target, purpose, and intended environment.',
      },
    ],
  },
  {
    slug: 'results-and-editing',
    title: 'Inspect Results And Edit Safely',
    description: 'Read table, document, raw, and key-value results with safe editing boundaries.',
    category: 'Results and safe editing',
    readingTime: '8 min',
    screenshots: ['sql-query-results', 'mongodb-builder', 'redis-browser', 'safety-preview'],
    status: 'Live',
    relatedGuides: ['document-results-editing', 'key-value-full-value', 'result-export'],
    steps: [
      {
        title: 'Inspect the renderer that matches the payload',
        body: 'Tables use sticky headers and row selection. Documents expand as trees. Redis and Valkey keys show type-aware value surfaces and metadata.',
      },
      {
        title: 'Use raw views when needed',
        body: 'Switch to formatted raw JSON, text, details, messages, or history when the rich renderer hides information you need. Full-value actions retrieve authoritative content rather than copying a shortened preview.',
      },
      {
        title: 'Select precisely',
        body: 'Use row numbers, cells, fields, or key entries to copy the exact data needed for analysis or follow-up work.',
      },
      {
        title: 'Edit only when identity is proven',
        body: 'SQL edits need table and primary-key context. MongoDB edits need collection and document identity. Redis edits need a concrete key. DynamoDB edits need complete keys and conditional guards.',
      },
      {
        title: 'Read disabled reasons',
        body: 'When an edit or operation is disabled, the reason is part of the safety model. Fix the missing identity, permission, or environment condition before trying again.',
      },
    ],
  },
  {
    slug: 'import-export',
    title: 'Import, Export, And Backup Data',
    description: 'Use guarded desktop file workflows for portable data movement.',
    category: 'Import, export, and native backup',
    readingTime: '7 min',
    screenshots: ['datastore-transfer', 'result-export'],
    status: 'Live',
    warning: 'Support is action-specific. Review the selected datastore manifest before assuming import, export, backup, or restore is executable.',
    relatedGuides: ['native-datastore-transfers', 'result-export', 'workspace-import-export'],
    steps: [
      {
        title: 'Open the action from the object context',
        body: 'Start import or export from the table, collection, key, local file, or database object that owns the data.',
      },
      {
        title: 'Choose a datastore-appropriate format',
        body: 'Tables commonly support CSV, JSON, or NDJSON. MongoDB can use JSON, Extended JSON, NDJSON, CSV, or BSON where supported. Redis key workflows use JSON, NDJSON, or snapshot envelopes depending on type.',
      },
      {
        title: 'Review the preview',
        body: 'Confirm the backend-owned selection, destination type, fail-on-conflict policy, target identity, read-only state, environment risk, and any scan or cost warning before execution.',
      },
      {
        title: 'Follow the transfer job',
        body: 'For new connections, export a small object or validate mode before larger volumes. Transfers Center keeps progress, cancellation, warnings, retry state, native job identifiers, and completed artifacts visible.',
      },
      {
        title: 'Store workspace backups separately',
        body: 'Workspace bundles and application backups protect saved work. They are different from datastore backups and should be secured with passphrases.',
      },
    ],
  },
  {
    slug: 'result-export',
    title: 'Export Result Files',
    description: 'Save query and object-view results in formats that match the current payload.',
    category: 'Import, export, and native backup',
    readingTime: '5 min',
    screenshots: ['result-export', 'sql-query-results'],
    steps: [
      {
        title: 'Run or open the result you need',
        body: 'Start from a query, object view, key browser, document browser, diagnostic panel, or saved workflow that has a concrete result payload.',
      },
      {
        title: 'Open Export from the Results panel',
        body: 'Use the result toolbar export action. DataPad++ chooses sensible defaults from the renderer instead of asking you to guess the file format first.',
      },
      {
        title: 'Choose a payload-aware format',
        body: 'Tables can export as CSV or JSON. Documents commonly use JSON or NDJSON. Raw values can export as text, and graph or key-value payloads keep structured JSON available.',
      },
      {
        title: 'Review redaction and shape',
        body: 'Export serializers preserve payload shape and redact only confirmed secret evidence. Ordinary returned values are not masked merely because a field name resembles a credential.',
      },
      {
        title: 'Save through the desktop file picker',
        body: 'Pick the target path with the operating system save dialog, then keep large or sensitive exports in the environment-specific location your team expects.',
      },
    ],
  },
  {
    slug: 'settings-workspace-backups',
    title: 'Settings, Workspace Bundles, And Backups',
    description: 'Configure appearance, workspace security, encrypted exports, and automatic backups.',
    category: 'Workspaces, backups, and recovery',
    readingTime: '7 min',
    screenshots: ['settings-backups', 'library-environments'],
    status: 'Live',
    warning: 'A workspace bundle contains DataPad++ configuration and saved work. It is not a backup of any connected datastore.',
    relatedGuides: ['workspace-import-export', 'workspace-size-analysis', 'connections'],
    steps: [
      {
        title: 'Open Settings as a tab',
        body: 'Settings opens in the workbench so you can close it like other tabs and keep context nearby.',
      },
      {
        title: 'Review Appearance and Workspace',
        body: 'Tune theme, layout, workspace defaults, plugins, and saved-work behavior. The workspace registry switches the active payload, Explorer, tabs, and detached-window layout together.',
      },
      {
        title: 'Export a workspace bundle',
        body: 'Open the export dialog, choose secret inclusion, enter and confirm a passphrase, then use the system picker to create a compact authenticated encrypted .datapadpp-workspace file.',
      },
      {
        title: 'Choose secret inclusion deliberately',
        body: 'Secret-free export removes values and references. Secret-inclusive export requires every selected vault reference to resolve and keeps those values only inside the authenticated encrypted payload.',
      },
      {
        title: 'Enable auto-backups when useful',
        body: 'Opt-in backups are encrypted, passphrase-protected, and rotate so snapshots do not grow without bound.',
      },
      {
        title: 'Import file first and review',
        body: 'Select the file, unlock it, review schema 12 compatibility, sizes, counts, warnings and secrets, then name a new workspace or explicitly replace the current workspace with recovery state.',
      },
    ],
  },
  {
    slug: 'api-server',
    title: 'Run A Local API Server',
    description: 'Expose selected datastore resources and saved queries as local REST, GraphQL, or gRPC endpoints.',
    category: 'Integrations and automation',
    readingTime: '8 min',
    screenshots: ['api-server', 'safety-preview'],
    steps: [
      {
        title: 'Enable API Server in Plugins settings',
        body: 'The API Server is a desktop-only experimental plugin. Open Settings, choose Plugins, enable API Server, then open the API Server workspace.',
      },
      {
        title: 'Choose a datastore and environment',
        body: 'Each server needs a connection and environment so DataPad++ can keep target identity, read-only posture, variables, and risk context visible.',
      },
      {
        title: 'Discover and select resources',
        body: 'Use resource discovery to add tables, collections, indexes, items, or keys deliberately. Disabled resources stay configured but are not exposed.',
      },
      {
        title: 'Add saved-query endpoints when useful',
        body: 'Custom endpoints come from saved Library queries. Tokens like {{api.email}} become typed endpoint parameters with required flags and serialization rules.',
      },
      {
        title: 'Start locally and inspect docs',
        body: 'Started servers bind to 127.0.0.1. REST servers expose OpenAPI docs, GraphQL servers expose GraphQL endpoints, and gRPC servers expose proto-oriented entry points.',
      },
      {
        title: 'Watch metrics, logs, and exports',
        body: 'Use the Metrics and Logs tabs to review local traffic. For PostgreSQL, SQLite, MongoDB, or DynamoDB, export a working Rust or .NET project backed by a real datastore client when you want code outside the desktop app.',
      },
      {
        title: 'Review export capabilities',
        body: 'The export dialog shows whether the framework and datastore pair is supported, labels resources as CRUD or read-only, and explains blocked custom endpoints. REST/OpenAPI, GraphQL, and gRPC are supported for every enabled pair.',
      },
      {
        title: 'Configure the generated service',
        body: 'Use DATABASE_URL or ConnectionStrings__Datastore for relational exports, MONGODB_URI for MongoDB, and the standard AWS region and credential chain with optional DYNAMODB_ENDPOINT_URL for DynamoDB. The archive contains examples, never resolved DataPad++ secrets.',
      },
    ],
    notes: [
      'API Server is designed for local development and integration experiments, not public hosting.',
      'Secrets are referenced through environment variables; exported projects do not include DataPad++ secret values.',
      'Custom query endpoints are currently exportable only for safe, read-only PostgreSQL and SQLite REST endpoints.',
    ],
  },
  {
    slug: 'mcp-server',
    title: 'Connect Local MCP Clients',
    description: 'Use the desktop-only MCP Server with scoped tokens, setup snippets, metrics, and logs.',
    category: 'Integrations and automation',
    readingTime: '8 min',
    screenshots: ['mcp-server', 'settings-backups'],
    steps: [
      {
        title: 'Enable MCP Server in Plugins settings',
        body: 'Open Settings, choose Plugins, enable the experimental MCP Server plugin, then open the MCP Server workspace. The listener is local-only and does not auto-start unless configured.',
      },
      {
        title: 'Create or choose a server profile',
        body: 'Server profiles use 127.0.0.1, a local port, optional allowlisted origins, and explicit datastore or workspace scope choices.',
      },
      {
        title: 'Create a scoped auth token',
        body: 'Tokens are shown only once. Store the raw token in an environment variable such as DATAPAD_MCP_TOKEN and rotate it if it is lost.',
      },
      {
        title: 'Copy or apply client setup',
        body: 'Use generated snippets for OpenAI Codex, VS Code and GitHub Copilot, Cursor, Claude Code, or Gemini CLI. Desktop automatic setup previews config changes and creates backups.',
      },
      {
        title: 'Start the endpoint and test access',
        body: 'MCP uses Streamable HTTP at /mcp. Requests need Authorization headers, and write, destructive, admin, and costly operations remain blocked in the current scope.',
      },
      {
        title: 'Discover enabled plugins',
        body: 'Tokens with plugin:read can call datapad_list_plugins to list Workspace Search, API Server, MCP Server, Workspaces, and Datastore Security Checks with required scopes and available MCP tools.',
      },
      {
        title: 'Use plugin surfaces with scoped rights',
        body: 'Workspace Search uses workspace:search, Security Checks uses security:read, API Server summary access uses api-server:read, MCP Server summary access uses mcp-server:read, and Workspaces listing uses workspaces:read. MCP v1 keeps these plugin tools read-only.',
      },
      {
        title: 'Review observability',
        body: 'Use server status, metrics, and logs to verify which clients connected and which scopes they used before keeping the server enabled.',
      },
    ],
  },
  {
    slug: 'datastore-security-checks',
    title: 'Review Datastore Security Checks',
    description: 'Scan datastore versions for vulnerabilities and review local/read-only posture checks.',
    category: 'Connections, environments, and secrets',
    readingTime: '8 min',
    screenshots: ['settings-backups', 'safety-preview'],
    steps: [
      {
        title: 'Enable Security Checks',
        body: 'Open Settings, choose Plugins, enable Datastore Security Checks, then open the Security Checks workspace from the workbench.',
      },
      {
        title: 'Refresh saved connections',
        body: 'The desktop app resolves connection profiles, detects product versions with read-only probes where possible, checks mapped CPE candidates against NVD and CISA KEV, and runs local posture checks.',
      },
      {
        title: 'Switch between lanes',
        body: 'Use Vulnerabilities for CVE and KEV findings. Use Posture for advisory checks covering TLS, auth mode, read-only/environment guardrails, secret storage, privilege breadth, durability, and risky settings.',
      },
      {
        title: 'Inspect CVE details',
        body: 'Finding details include severity, CVSS, references, KEV action data when available, and NVD affected-version or fixed-version hints when the response provides version bounds.',
      },
      {
        title: 'Inspect posture details',
        body: 'Posture details show pass, warn, fail, unknown, or not-applicable status, sanitized evidence, source type, remediation, and official references without storing raw secret-bearing payloads.',
      },
      {
        title: 'Read the coverage boundary',
        body: 'Deep posture checks target PostgreSQL, CockroachDB, TimescaleDB, MySQL, MariaDB, SQL Server, Azure SQL, MongoDB, Redis, Valkey, Elasticsearch, OpenSearch, SQLite, and DuckDB. Other declared datastores receive profile-only checks.',
      },
      {
        title: 'Treat guidance as advisory',
        body: 'The bundled catalog is updated with app releases and avoids extra release-feed calls during a scan. Posture checks do not call cloud-provider APIs and are not compliance certification.',
      },
    ],
    notes: [
      'Browser preview cannot run network-backed security scans; use the desktop app.',
      'Catalog guidance is intentionally labeled as known newer or recommended, not as a guaranteed live latest version.',
      'Unknown posture results usually mean the current account lacks metadata visibility or the engine/runtime cannot expose that signal safely.',
    ],
  },
  {
    slug: 'workspace-search',
    title: 'Search The Workspace',
    description: 'Find connections, Library work, open tabs, closed tabs, scripts, queries, and test suites quickly.',
    category: 'Integrations and automation',
    readingTime: '5 min',
    screenshots: ['workspace-search', 'library-environments'],
    steps: [
      {
        title: 'Enable Workspace Search',
        body: 'Open Settings, choose Plugins, enable Workspace Search, then open the Search workspace from the workbench.',
      },
      {
        title: 'Type the thing you remember',
        body: 'Search indexes the current workspace snapshot, including connection names, Library items, open tabs, recently closed tabs, scripts, queries, and tests.',
      },
      {
        title: 'Filter by result type',
        body: 'Toggle Connections, Folders, Queries, Scripts, Tests, Library, Open tabs, and Closed results to keep large workspaces easy to scan.',
      },
      {
        title: 'Use matching options',
        body: 'Match case and whole-word controls help narrow noisy searches without changing the saved workspace content.',
      },
      {
        title: 'Open results in place',
        body: 'Selecting a result opens the connection, Library item, tab, or recently closed tab so you can return to work without rebuilding context.',
      },
    ],
  },
  {
    slug: 'test-suites',
    title: 'Build Datastore Test Suites',
    description: 'Capture repeatable setup, execute, assertion, and teardown checks beside the datastore they validate.',
    category: 'Integrations and automation',
    readingTime: '7 min',
    screenshots: ['test-suites', 'library-environments'],
    steps: [
      {
        title: 'Enable the experimental plugin',
        body: 'Datastore Tests is disabled by default per workspace. Enable it from Settings → Plugins; disabling it later preserves every saved suite, case, result, and draft.',
      },
      {
        title: 'Bind the suite to its datastore target',
        body: 'Choose one connection, one assigned environment, and a live database, table, view, collection, Redis/Valkey prefix, or DynamoDB table. Explorer actions open the same dialog with their object preselected. The binding is immutable after creation.',
      },
      {
        title: 'Create and navigate owned cases',
        body: 'A Test Suite owns one or more Test Cases. Every case inherits the suite binding. Select virtual case children beneath the suite in the Library, then add, duplicate, reorder, disable, or remove cases in the visual editor.',
      },
      {
        title: 'Build visual steps',
        body: 'Add and remove query, builder, data-edit, or adapter-operation steps in Setup, Execute, and Teardown. The provider infers query language and generates a starter for the selected target; structured steps cannot retarget another datastore object.',
      },
      {
        title: 'Add assertions',
        body: 'Choose a source step, comparison, path or field, expected value, and timeout for assertions such as row count, document count, key existence, JSON path, no-error, or duration-under.',
      },
      {
        title: 'Review preflight and run real checks',
        body: 'Preflight shows the immutable connection, environment, target, inferred language, adapter support, redacted generated requests, blockers, warnings, and an exact one-time phrase for writes. Ambiguous raw requests are warned; unsupported work is never reported as a simulated pass.',
      },
      {
        title: 'Run a case or the suite',
        body: 'Run one focused case or every enabled case. Setup and Execute fail fast, Teardown is attempted after failures, and later cases continue after ordinary failures.',
      },
    ],
  },
  {
    slug: 'datastore-explorer',
    title: 'Explore Datastore Metadata',
    description: 'Browse each datastore through its native hierarchy and purpose-built detail views.',
    category: 'Exploring and IntelliSense',
    readingTime: '6 min',
    screenshots: ['explorer-tree', 'relationship-explorer'],
    steps: [
      {
        title: 'Open Explorer from a connection',
        body: 'Open Explorer from the connection menu. The full Explorer and sidebar use the same provider, loaded scopes, continuation pages, errors, and retry state.',
      },
      {
        title: 'Browse the native hierarchy',
        body: 'Expand the datastore-specific databases, schemas, collections, key groups, indices, metrics, graphs, or warehouse objects. System and administrative namespaces remain separate and collapsed by default.',
      },
      {
        title: 'Load large inventories safely',
        body: 'Explorer loads bounded pages, shows loaded and available counts where the datastore reports them, and marks partial results instead of implying that a truncated inventory is complete.',
      },
      {
        title: 'Use purpose-built details',
        body: 'Select an object to see structured metrics, inventories, schema, health, security, diagnostics, or bounded type-aware values. Raw provider metadata is never used as a visual fallback.',
      },
      {
        title: 'Respond to exact states',
        body: 'Empty, permission, authentication, connectivity, timeout, partial, and retryable failure states remain distinct so you know whether to load more, retry, or request access.',
      },
      {
        title: 'Hand work to guarded tools',
        body: 'Explorer is read-only. Open queries and operational views from contextual actions; edits and administrative changes continue through the existing guarded planning and confirmation workflows.',
      },
    ],
  },
  {
    slug: 'relationship-explorer',
    title: 'Use SQL Relationship Diagrams',
    description: 'Understand table shape, joins, and schema boundaries before writing broad SQL.',
    category: 'Exploring and IntelliSense',
    readingTime: '6 min',
    screenshots: ['relationship-explorer', 'explorer-tree'],
    steps: [
      {
        title: 'Open the Relationship map',
        body: 'Use the secondary Relationship map action from a SQL-family Explorer after choosing the schemas and tables you want to understand.',
      },
      {
        title: 'Filter before loading broadly',
        body: 'Large enterprise schemas should be explored in focused slices. Filter schemas or tables before expecting a useful diagram.',
      },
      {
        title: 'Read table cards and columns',
        body: 'Each card summarizes a table and its columns so primary keys, foreign keys, and interesting fields stay visible together.',
      },
      {
        title: 'Inspect relationship ends',
        body: 'Relationship labels distinguish declared links from inferred links and show the direction and cardinality DataPad++ can explain.',
      },
      {
        title: 'Use the diagram as a query aid',
        body: 'Open scoped object actions or copy relationship context into SQL builders after you have verified the join path.',
      },
      {
        title: 'Keep risky schema work preview-first',
        body: 'Schema operations, inferred links, and admin actions should remain reviewable plans until the target and environment are proven.',
      },
    ],
  },
  {
    slug: 'datastore-coverage-maturity',
    title: 'Understand Datastore Coverage',
    description: 'Read native-complete, contract-complete, fixture-backed, and preview-first claims without overestimating live readiness.',
    category: 'Datastore-specific guides',
    readingTime: '7 min',
    screenshots: ['search-diagnostics', 'safety-preview'],
    steps: [
      {
        title: 'Start with the datastore directory',
        body: 'The datastore docs list every declared engine and describe connection fields, object models, query modes, result views, diagnostics, import/export, and safety boundaries.',
      },
      {
        title: 'Distinguish native-complete from contract-complete',
        body: 'Native-complete means the scoped release claim has live or fixture-backed evidence. Contract-complete means the UX, contracts, plans, and residual risks are covered, while live validation may still be optional.',
      },
      {
        title: 'Read residual-risk wording',
        body: 'Cloud auth, driver-specific modes, high-cost operations, destructive admin flows, and broader import/export execution can remain outside a scoped claim.',
      },
      {
        title: 'Check fixture evidence',
        body: 'Use the testing docs when you need to verify PostgreSQL, MongoDB, Redis/Valkey, Oracle, DynamoDB, search, DuckDB, LiteDB, or other optional fixture evidence locally.',
      },
      {
        title: 'Use read-only first',
        body: 'Even native-complete workflows should begin with local, fixture-backed, or read-only profiles until you trust the target, credentials, and environment guardrails.',
      },
    ],
  },
  {
    slug: 'sql-workflows',
    title: 'SQL Family Workflows',
    description: 'Work with PostgreSQL, SQL Server, MySQL, MariaDB, SQLite, CockroachDB, TimescaleDB, DuckDB, Oracle, and related engines.',
    category: 'Datastore-specific guides',
    readingTime: '10 min',
    screenshots: ['explorer-tree', 'sql-query-results', 'safety-preview'],
    steps: [
      {
        title: 'Create a typed SQL connection',
        body: 'Choose the specific engine so DataPad++ can apply the right dialect, metadata surfaces, disabled reasons, and guarded operation previews.',
      },
      {
        title: 'Explore schemas and tables',
        body: 'Open databases, schemas, tables, views, columns, indexes, routines, roles, diagnostics, or engine-specific tree sections.',
      },
      {
        title: 'Open a scoped query',
        body: 'Use table or view actions to start with a SELECT builder or raw SQL editor already aimed at the selected object.',
      },
      {
        title: 'Inspect plans and diagnostics',
        body: 'Use EXPLAIN, profile, wait, lock, storage, query-store, performance-schema, or engine-specific panels where available.',
      },
      {
        title: 'Edit rows with identity proof',
        body: 'Live row edits require primary-key or equivalent identity context plus read-only and environment checks.',
      },
      {
        title: 'Keep admin work preview-first',
        body: 'Maintenance, role, extension, backup, restore, import, export, and destructive workflows should show guarded plans before execution.',
      },
    ],
  },
  {
    slug: 'mongodb-workflows',
    title: 'MongoDB Workflows',
    description: 'Build queries, inspect documents, review explain plans, and manage collection workflows.',
    category: 'Datastore-specific guides',
    readingTime: '8 min',
    screenshots: ['mongodb-builder', 'explorer-tree', 'document-editor'],
    steps: [
      {
        title: 'Open a collection',
        body: 'Use the MongoDB tree to open a database or collection directly into a collection-focused query workspace.',
      },
      {
        title: 'Build a query visually',
        body: 'Add filters with grouping, projections, sort fields, and result limits. Drag fields from documents back into query builder sections when useful.',
      },
      {
        title: 'Switch modes deliberately',
        body: 'Move between Query Builder, raw JSON command, aggregation, and sandboxed mongosh-style JavaScript. Script mode supports guarded CRUD, bulk operations, transactions, indexes, collection management, BSON values, and permission-authorized commands.',
      },
      {
        title: 'Use the scripting guide',
        body: 'Search the resizable guide for query, CRUD, aggregation, bulk, transaction, index, administration, BSON, output, and safety examples. Insert examples at the cursor, and use JavaScript IntelliSense for live collections and discovered fields.',
      },
      {
        title: 'Inspect documents efficiently',
        body: 'Use expandable document rows, field search, raw inspection, and efficiency mode for large nested documents.',
      },
      {
        title: 'Review explain and diagnostics',
        body: 'Open explain, profiler, current operation, replica, shard, and index-usage surfaces when diagnosing performance.',
      },
      {
        title: 'Use guarded document edits',
        body: 'Document edits and script mutations share read-only checks and environment confirmations. The script sandbox cannot access files, processes, packages, or arbitrary networks, and cancellation aborts any open transaction.',
      },
    ],
  },
  {
    slug: 'redis-valkey-workflows',
    title: 'Redis And Valkey Workflows',
    description: 'Browse keys, inspect types, run console commands, and protect key operations.',
    category: 'Datastore-specific guides',
    readingTime: '8 min',
    screenshots: ['redis-browser', 'key-value-inspector', 'safety-preview'],
    steps: [
      {
        title: 'Start in the key browser',
        body: 'Redis and Valkey open with key browsing first so you can filter by pattern, type, TTL, memory, and length before reaching for raw commands.',
      },
      {
        title: 'Scan incrementally',
        body: 'Use Scan more and refresh controls to avoid assuming a full keyspace is loaded at once.',
      },
      {
        title: 'Inspect by type',
        body: 'Strings, hashes, lists, sets, sorted sets, streams, JSON, TimeSeries, and supported module values should render through type-aware panels where available.',
      },
      {
        title: 'Use the console for precise commands',
        body: 'Switch to Redis console mode when you need command syntax, known-key hints, module hints, or direct read commands.',
      },
      {
        title: 'Guard live key changes',
        body: 'Edits, renames, TTL changes, deletes, stream updates, imports, and exports require concrete key identity and environment checks.',
      },
    ],
  },
  {
    slug: 'search-dynamodb-and-secondary',
    title: 'Search, DynamoDB, And Secondary Engines',
    description: 'Understand preview-first workflows for search, wide-column, cloud, graph, warehouse, metrics, and local engines.',
    category: 'Datastore-specific guides',
    readingTime: '9 min',
    screenshots: ['search-diagnostics', 'explorer-tree', 'safety-preview'],
    steps: [
      {
        title: 'Choose the exact adapter',
        body: 'Pick Elasticsearch, OpenSearch, DynamoDB, Cassandra, Cosmos DB, ClickHouse, Snowflake, BigQuery, Prometheus, InfluxDB, graph engines, or local-file engines explicitly.',
      },
      {
        title: 'Read capability gates',
        body: 'Some adapters are scoped, preview-backed, fixture-backed, read-oriented, or cloud-contract oriented. Capability labels and disabled reasons are part of the product surface.',
      },
      {
        title: 'Use bounded builders',
        body: 'Start with key conditions, query DSL, metric labels, graph labels, partition keys, dry-run estimates, or local-file preflights before running broad operations.',
      },
      {
        title: 'Inspect posture and diagnostics',
        body: 'Use mapping, shard, capacity, TTL, stream, cost, profile, metrics, access, storage, and health panels where available.',
      },
      {
        title: 'Treat admin actions as plans',
        body: 'Cloud, destructive, import/export, repair, failover, role, throughput, snapshot, and restore actions should stay preview-first unless a validated guarded executor is available.',
      },
    ],
  },
  {
    slug: 'safety-model',
    title: 'Safety Model',
    description: 'Learn why DataPad++ disables, previews, or confirms risky actions.',
    category: 'Connections, environments, and secrets',
    readingTime: '6 min',
    screenshots: ['safety-preview', 'library-environments'],
    steps: [
      {
        title: 'Identify the target',
        body: 'Before live changes, DataPad++ needs concrete object identity such as a table primary key, document id, Redis key, DynamoDB key, or search document id.',
      },
      {
        title: 'Respect read-only connections',
        body: 'Read-only profiles should block writes and destructive actions even if the database account itself has permission.',
      },
      {
        title: 'Use environments as guardrails',
        body: 'Production and high-risk environments can require confirmation, keep actions preview-only, or make danger visible before execution.',
      },
      {
        title: 'Review plans before execution',
        body: 'Guarded previews should show generated SQL, command, API request, file path, overwrite mode, scan risk, permission requirement, or restore target before any live operation.',
      },
      {
        title: 'Treat disabled reasons as instructions',
        body: 'If an action is unavailable, read the disabled reason and fix the missing context instead of forcing an unsafe path.',
      },
    ],
  },
  {
    slug: 'workspace-import-export',
    title: 'Import Or Export A Workspace',
    description: 'Move a versioned workspace safely, choose whether secrets travel, and activate the imported workspace immediately.',
    category: 'Workspaces, backups, and recovery',
    readingTime: '9 min',
    screenshots: ['workspace-import-review', 'settings-backups'],
    status: 'Live',
    warning: 'Workspace bundles preserve DataPad++ state, not the connected datastore data. Keep independent datastore backups.',
    relatedGuides: ['settings-workspace-backups', 'workspace-size-analysis', 'connections'],
    featured: true,
    steps: [
      {
        title: 'Choose Export from Workspace and Backups',
        body: 'Exports exclude passwords and secrets by default. Enable secret inclusion only when the receiving machine should receive every resolvable vault-backed credential.',
      },
      {
        title: 'Protect the bundle',
        body: 'Enter and confirm a strong passphrase, review the security summary, then choose the destination. Canceling the save picker leaves the dialog ready for another attempt.',
      },
      {
        title: 'Choose the import file first',
        body: 'Import validates the size and encrypted envelope before asking for a passphrase. A wrong passphrase can be retried without selecting the file again.',
      },
      {
        title: 'Review schema, counts, and secrets',
        body: 'The review shows format, workspace schema, encrypted/decrypted sizes, object counts, warnings, and whether secret material is available. Schema 12 is the current synchronized workspace contract.',
      },
      {
        title: 'Name and commit the workspace',
        body: 'Create New Workspace is the default and accepts an editable name. Replace Current Workspace is explicitly destructive, keeps the current identity, and creates recovery state. Secret import always requires a separate opt-in.',
      },
    ],
  },
  {
    slug: 'workspace-size-analysis',
    title: 'Analyze Workspace And Backup Size',
    description: 'Find large histories or cached payloads using byte-only diagnostics without exposing private content.',
    category: 'Workspaces, backups, and recovery',
    readingTime: '6 min',
    screenshots: ['settings-backups'],
    status: 'Live',
    relatedGuides: ['workspace-import-export', 'settings-workspace-backups'],
    steps: [
      {
        title: 'Open Workspace and Backups',
        body: 'Choose Analyze Workspace Size to inspect the active workspace, recovery state, and projected bundle sizes.',
      },
      {
        title: 'Read section contributions',
        body: 'Compare connections, environments, open/closed tabs, saved work, execution history, adapter data, and refreshable payload contributions by byte count.',
      },
      {
        title: 'Inspect the largest tabs',
        body: 'The report splits large tab contributions into draft, history, object, metrics, and test state without displaying queries or values.',
      },
      {
        title: 'Analyze an existing backup',
        body: 'Unlock a bundle through Analyze Backup to inspect encrypted, compressed, and decrypted sizes without importing it.',
      },
      {
        title: 'Understand normalization',
        body: 'New persistence omits refreshable results/diagnostics and bounds execution history while preserving saved queries, current drafts, targets, definitions, and layout.',
      },
    ],
  },
  {
    slug: 'typed-query-builders',
    title: 'Build Valid Typed Queries',
    description: 'Create nested filters with type-aware values, validated JSON, and native array predicates.',
    category: 'Querying and query builders',
    readingTime: '10 min',
    screenshots: ['typed-query-builder', 'mongodb-builder'],
    status: 'Live',
    appliesTo: ['mongodb', 'cosmosdb', 'dynamodb', 'postgresql', 'cockroachdb', 'mysql', 'mariadb', 'sqlite', 'sqlserver'],
    relatedGuides: ['querying', 'sql-database-schema-scope', 'document-results-editing'],
    featured: true,
    steps: [
      {
        title: 'Choose the field and operator',
        body: 'The builder uses explicit group ownership for AND/OR nesting. Enabled invalid rows block compilation instead of being dropped or replaced with a stale query.',
      },
      {
        title: 'Select the value type',
        body: 'Strings, finite numbers, booleans, timezone-bearing dates, UUID/GUID values, MongoDB ObjectIds, JSON, and multi-value inputs validate before compilation.',
      },
      {
        title: 'Edit JSON in the dialog',
        body: 'Open the JSON editor for more space, format/search the draft, choose Validate, and apply only after the current text passes. Invalid text remains available for correction.',
      },
      {
        title: 'Use native array predicates',
        body: 'Has Items, Has No Items, and Has Length appear only where a reliable server-side expression exists. Missing, null, and scalar values do not count as empty arrays.',
      },
      {
        title: 'Run only a valid compilation',
        body: 'Run, Count, and Use in Query Editor remain disabled while the builder is invalid. Performance guidance identifies predicates that may be computed or non-indexed.',
      },
    ],
  },
  {
    slug: 'sql-database-schema-scope',
    title: 'Select SQL Database And Schema Scope',
    description: 'Keep database and schema context on the query tab instead of repeating session-selection statements.',
    category: 'Querying and query builders',
    readingTime: '5 min',
    screenshots: ['sql-query-results', 'explorer-tree'],
    status: 'Live',
    appliesTo: ['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'oracle', 'timescaledb'],
    relatedGuides: ['sql-workflows', 'oracle-explorer-intellisense'],
    steps: [
      {
        title: 'Open a SQL tab from the target',
        body: 'Explorer actions initialize the connection, environment, and available database/schema context on the tab.',
      },
      {
        title: 'Choose database or catalog',
        body: 'Use the database selector only for engines with a safe supported routing/session mechanism. Other engines keep connection-level or qualified-name behavior.',
      },
      {
        title: 'Choose the schema',
        body: 'The selected schema drives object completion and generated qualification. Oracle uses it as the authoritative completion owner.',
      },
      {
        title: 'Write only the query',
        body: 'The tab applies supported session scope automatically, so generated builder SQL does not prepend a user-authored USE statement.',
      },
      {
        title: 'Verify the visible context',
        body: 'Connection, environment, database/schema, and environment color remain attached to the tab, including while inactive or moved between windows.',
      },
    ],
  },
  {
    slug: 'document-results-editing',
    title: 'Edit Document Results Safely',
    description: 'Add or remove fields, use native typed inputs, and validate raw JSON before datastore execution.',
    category: 'Results and safe editing',
    readingTime: '10 min',
    screenshots: ['document-editor', 'mongodb-builder'],
    status: 'Live',
    appliesTo: ['mongodb', 'cosmosdb', 'litedb', 'arango'],
    relatedGuides: ['results-and-editing', 'typed-query-builders'],
    featured: true,
    steps: [
      {
        title: 'Open the field context menu',
        body: 'Add Field targets an object or a scalar\'s object parent; arrays remain editable through raw JSON. Remove Field applies to object properties while root deletion stays Delete Document.',
      },
      {
        title: 'Choose a supported native type',
        body: 'Editors preserve numbers, decimals, booleans, DateTime, ObjectId, MongoDB UUID, LiteDB GUID, binary, and other native wrappers without reclassifying ordinary strings.',
      },
      {
        title: 'Respect protected identity',
        body: 'Duplicate, empty, unsafe, reserved, identity, partition/shard, and concurrency fields cannot be added, removed, or changed.',
      },
      {
        title: 'Inspect or edit raw JSON',
        body: 'View Raw JSON formats the selected value. Edit Raw JSON requires explicit validation after every change and keeps Save disabled until the current text passes all checks.',
      },
      {
        title: 'Wait for authoritative evidence',
        body: 'The result changes only after execution succeeds and returns before/after data. Projected, lazy, truncated, stale, read-only, or insufficiently identified documents remain viewable but not mutable.',
      },
    ],
  },
  {
    slug: 'key-value-full-value',
    title: 'Inspect A Complete Key-Value Value',
    description: 'Open, format, copy, and safely edit authoritative values without relying on shortened cell previews.',
    category: 'Results and safe editing',
    readingTime: '7 min',
    screenshots: ['key-value-inspector', 'redis-browser'],
    status: 'Live',
    appliesTo: ['redis', 'valkey', 'memcached'],
    relatedGuides: ['redis-valkey-workflows', 'result-export'],
    featured: true,
    steps: [
      {
        title: 'Search without losing the draft',
        body: 'Edit the namespace delimiter or search pattern, then deliberately run the search. Typing no longer refreshes the page or replaces the field.',
      },
      {
        title: 'Open Value from the row menu',
        body: 'Scalar rows avoid a redundant expansion control. Open Value requests the authoritative value in a dedicated inspector.',
      },
      {
        title: 'Read the compact header',
        body: 'The field/key name leads the view, with content type and byte size shown as small inline badges.',
      },
      {
        title: 'Choose source or formatted JSON',
        body: 'Source preserves the original representation. Formatted JSON appears only when parsing succeeds and never changes stored data.',
      },
      {
        title: 'Copy or edit deliberately',
        body: 'Copy actions operate on the complete retrieved value. Editing remains subject to concrete identity, native type support, read-only posture, environment confirmation, and server evidence.',
      },
    ],
  },
  {
    slug: 'native-datastore-transfers',
    title: 'Import, Export, Backup, And Restore Datastore Data',
    description: 'Use native and portable formats through a staged, conflict-safe transfer workflow.',
    category: 'Import, export, and native backup',
    readingTime: '12 min',
    screenshots: ['datastore-transfer', 'transfer-center'],
    status: 'Live',
    warning: 'Transfer status is action-specific. A datastore with live export may still have plan-only or unavailable import, backup, or restore.',
    relatedGuides: ['import-export', 'result-export', 'datastore-coverage-maturity'],
    featured: true,
    steps: [
      {
        title: 'Choose the operation',
        body: 'Select Import, Export, Backup, or Restore. Result export and workspace backup are separate workflows with different scope and artifacts.',
      },
      {
        title: 'Confirm objects and format',
        body: 'The selected adapter exposes native formats plus clearly labelled portable or potentially lossy alternatives. Unsupported formats never appear as executable.',
      },
      {
        title: 'Choose the destination',
        body: 'Use an allowed local selection, server path, repository, directory object, named stage, cloud URI, or managed restore target. Full local paths stay backend-owned.',
      },
      {
        title: 'Validate and review',
        body: 'Review schema/type compatibility, permissions, locks, cost/scan impact, destination isolation, overwrite policy, and adapter-specific warnings. Imports fail on conflicts by default.',
      },
      {
        title: 'Follow the job',
        body: 'Transfers Center shows progress, cancellation, warnings, retry state, native job identifiers, and completed artifacts. Temporary local output is promoted only after success.',
      },
    ],
  },
  {
    slug: 'multi-window-tabs',
    title: 'Move Tabs Between Windows',
    description: 'Enable the experimental desktop workspace and move eligible working tabs without creating another application session.',
    category: 'Experimental features',
    readingTime: '8 min',
    screenshots: ['multi-window-tabs', 'hero-workbench'],
    status: 'Experimental',
    warning: 'Cross-window dragging is enabled only on platforms where WebView drag behavior passes the release checks. Move commands remain the reliable accessible path.',
    relatedGuides: ['library', 'settings-workspace-backups'],
    featured: true,
    steps: [
      {
        title: 'Enable Multi-window Tabs',
        body: 'Open Settings → Plugins and enable the desktop-only experimental plugin. Browser preview stays single-window.',
      },
      {
        title: 'Move an eligible tab',
        body: 'Use Move to New Window, Move to Window…, or Move to Main Window from the tab menu. Query, object, metrics, test, and search work can move; administrative surfaces remain in main.',
      },
      {
        title: 'Use drag where supported',
        body: 'A supported platform can insert over another strip or create an editor window outside the app. Escape and invalid destinations cancel without moving ownership.',
      },
      {
        title: 'Respect execution locks',
        body: 'Queued or running work blocks movement. Drafts flush before transfer, and failed window creation leaves the tab in its source window.',
      },
      {
        title: 'Understand close and restore',
        body: 'Closing an editor window reattaches its tabs to main. Closing main coordinates application shutdown. Window placement and ownership restore with the workspace.',
      },
    ],
  },
  {
    slug: 'oracle-explorer-intellisense',
    title: 'Navigate Large Oracle Schemas',
    description: 'Page through large object catalogs and let IntelliSense complete the schema selected on the query tab.',
    category: 'Exploring and IntelliSense',
    readingTime: '7 min',
    screenshots: ['oracle-paging', 'explorer-tree'],
    status: 'Live',
    appliesTo: ['oracle'],
    relatedGuides: ['explorer', 'sql-database-schema-scope', 'sql-workflows'],
    steps: [
      {
        title: 'Select the Oracle schema',
        body: 'The query tab schema selector is authoritative for completion. Scoped target and current session schema are fallbacks only.',
      },
      {
        title: 'Expand a paged branch',
        body: 'Tables, Views, Materialized Views, and other large branches load deterministically in server pages rather than silently stopping at an early UI limit.',
      },
      {
        title: 'Choose Load more',
        body: 'Buffered children appear first, then the next cursor is requested. A failed page leaves already loaded objects available, and Refresh starts from the first page.',
      },
      {
        title: 'Let completion continue in the background',
        body: 'Object names load before larger column pages. Suggestions remain usable during progressive loading and a partial catalog can retry with Ctrl/Cmd+Space or schema refresh.',
      },
      {
        title: 'Preserve exact identifiers',
        body: 'Oracle completion and deduplication retain quoting, case, Unicode, dollar signs, and hash characters. Stale pages from another tab or schema are ignored.',
      },
    ],
  },
]

export const docCategories = [
  'Getting started',
  'Connections, environments, and secrets',
  'Workspaces, backups, and recovery',
  'Exploring and IntelliSense',
  'Querying and query builders',
  'Results and safe editing',
  'Import, export, and native backup',
  'Experimental features',
  'Integrations and automation',
  'Datastore-specific guides',
] as const

export function getDocBySlug(slug: string) {
  return docArticles.find((article) => article.slug === slug)
}

export function getNextDoc(slug: string) {
  const index = docArticles.findIndex((article) => article.slug === slug)
  return index >= 0 ? docArticles[index + 1] : undefined
}
