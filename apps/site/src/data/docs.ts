import type { ScreenshotId } from './screenshots'
import type { DatastoreEngineId } from './datastore-engines'

export type DocumentationStatus = 'Live' | 'Experimental' | 'Plan only' | 'Unavailable'

type LegacyDocStep = {
  title: string
  body: string
}

type LegacyDocArticle = {
  slug: string
  title: string
  description: string
  category: string
  readingTime: string
  screenshots: ScreenshotId[]
  steps: LegacyDocStep[]
  notes?: string[]
  status?: DocumentationStatus
  warning?: string
  relatedGuides?: string[]
  appliesTo?: DatastoreEngineId[]
  featured?: boolean
}

export type DocCalloutTone = 'note' | 'tip' | 'important' | 'warning'

export type DocProcedureStep = {
  title: string
  body: string
  figure?: ScreenshotId
}

export type DocBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'procedure'; steps: DocProcedureStep[] }
  | { type: 'figure'; screenshot: ScreenshotId }
  | { type: 'callout'; tone: DocCalloutTone; title: string; body: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'code'; language: string; code: string; label?: string }
  | { type: 'links'; links: { href: string; label: string; description: string }[] }

export type DocSection = {
  id: string
  title: string
  blocks: DocBlock[]
}

export type DocArticle = Omit<LegacyDocArticle, 'screenshots' | 'steps' | 'notes' | 'warning'> & {
  prerequisites: string[]
  keywords: string[]
  sections: DocSection[]
}

const legacyDocArticles: LegacyDocArticle[] = [
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
        title: 'Start with a datastore you control',
        body: 'For your first connection, use a development or staging datastore—or a local database file you own—with a least-privileged, read-only account. You can then learn Explorer, query, and result behavior against your own schema and data.',
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
    category: 'Plugins',
    readingTime: '8 min',
    screenshots: ['plugins-experimental', 'api-server'],
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
    category: 'Plugins',
    readingTime: '8 min',
    screenshots: ['plugins-experimental', 'mcp-server'],
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
    category: 'Plugins',
    readingTime: '8 min',
    screenshots: ['plugins-experimental', 'security-checks'],
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
    category: 'Plugins',
    readingTime: '5 min',
    screenshots: ['plugins-ready', 'workspace-search'],
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
    category: 'Plugins',
    readingTime: '7 min',
    screenshots: ['plugins-experimental', 'test-suites'],
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
    description: 'Understand which datastore features are available, guarded, in preview, or unavailable before you rely on them.',
    category: 'Datastore-specific guides',
    readingTime: '7 min',
    screenshots: ['search-diagnostics', 'safety-preview'],
    steps: [
      {
        title: 'Start with the datastore directory',
        body: 'The datastore docs list every declared engine and describe connection fields, object models, query modes, result views, diagnostics, import/export, and safety boundaries.',
      },
      {
        title: 'Read the availability labels',
        body: 'Available features can be used with a supported connection. Guarded features require additional permissions or confirmation. Preview features can change and may support only part of the workflow. Unavailable controls include a reason and, when possible, a safer alternative.',
      },
      {
        title: 'Review limitations',
        body: 'A guide calls out unsupported authentication modes, high-cost operations, destructive administration, and import/export limits so you can choose an appropriate workflow before connecting.',
      },
      {
        title: 'Check your connection and permissions',
        body: 'Open the guide for your datastore to verify supported authentication, required metadata permissions, query modes, result views, diagnostics, and transfer boundaries before using an important system.',
      },
      {
        title: 'Use read-only first',
        body: 'Begin with a read-only profile and a development or staging target until you trust the connection, credentials, selected scope, and environment guardrails.',
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
        body: 'Some adapters are read-oriented, scoped to particular authentication modes, or still in preview. Capability labels and disabled reasons tell you what is usable for the selected connection.',
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
    category: 'Plugins',
    readingTime: '8 min',
    screenshots: ['plugins-ready', 'multi-window-tabs'],
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

function stableId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function upgradeLegacyArticle(article: LegacyDocArticle): DocArticle {
  const procedureSteps = article.steps.map((step, index) => ({
    ...step,
    figure: article.screenshots[index],
  }))
  const remainingFigures = article.screenshots.slice(procedureSteps.length)
  const detailBlocks: DocBlock[] = []

  if (article.notes?.length) detailBlocks.push({ type: 'list', items: article.notes })
  if (remainingFigures.length) {
    detailBlocks.push(...remainingFigures.map((screenshot): DocBlock => ({ type: 'figure', screenshot })))
  }

  return {
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    readingTime: article.readingTime,
    status: article.status,
    relatedGuides: article.relatedGuides,
    appliesTo: article.appliesTo,
    featured: article.featured,
    prerequisites: [
      'Install the current DataPad++ desktop pre-release and open the workspace where you want to organize your connections and saved work.',
      'Have access to a datastore or database file you are authorized to inspect. Start read-only with a least-privileged account.',
    ],
    keywords: [article.title, article.category, ...article.steps.flatMap((step) => [step.title, step.body])],
    sections: [
      {
        id: 'quickstart',
        title: 'Quickstart',
        blocks: [
          ...(article.warning
            ? [{ type: 'callout', tone: 'warning', title: 'Before you begin', body: article.warning } as DocBlock]
            : []),
          { type: 'procedure', steps: procedureSteps },
        ],
      },
      {
        id: 'task-reference',
        title: 'Task and control reference',
        blocks: detailBlocks.length
          ? detailBlocks
          : [
              {
                type: 'paragraph',
                text: 'The workbench keeps the active connection, environment, target scope, query mode, and panel state visible. Review that context before you run, edit, export, or administer anything.',
              },
            ],
      },
      {
        id: 'safety-boundaries',
        title: 'Safety boundaries',
        blocks: [
          {
            type: 'callout',
            tone: 'important',
            title: 'Pre-release safety boundary',
            body: 'DataPad++ is pre-release software. Start read-only, keep independent backups, review target and environment context, and treat preview-only or disabled controls as intentional product boundaries.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        blocks: [
          {
            type: 'table',
            columns: ['Symptom', 'What to check'],
            rows: [
              ['A control is disabled', 'Read its disabled reason, then verify target scope, connection health, read-only mode, environment policy, and feature maturity.'],
              ['The screen does not match this guide', 'Confirm the app version and platform, refresh the active tab, and check whether the feature is marked Experimental, Plan only, or Unavailable.'],
              ['The operation produces no rows', 'Open Messages and History, verify the selected datastore scope, replace the sample object names with names from your datastore, and retry with a bounded read.'],
            ],
          },
        ],
      },
    ],
  }
}

type TaskGuideInput = {
  slug: string
  title: string
  description: string
  category: string
  screenshots: ScreenshotId[]
  steps: LegacyDocStep[]
  referenceRows: string[][]
  keywords: string[]
  relatedGuides: string[]
  status?: DocumentationStatus
}

function taskGuide(input: TaskGuideInput): DocArticle {
  return {
    slug: input.slug,
    title: input.title,
    description: input.description,
    category: input.category,
    readingTime: '8 min',
    status: input.status ?? 'Live',
    relatedGuides: input.relatedGuides,
    prerequisites: [
      'Open DataPad++ and the workspace where you want to organize your own connections and saved work.',
      'Connect with an account you are authorized to use, and keep it read-only until your task requires a reviewed write.',
    ],
    keywords: [...input.keywords, ...input.steps.flatMap((step) => [step.title, step.body])],
    sections: [
      {
        id: 'quickstart',
        title: 'Quickstart',
        blocks: [
          {
            type: 'procedure',
            steps: input.steps.map((step, index) => ({ ...step, figure: input.screenshots[index] })),
          },
        ],
      },
      {
        id: 'task-reference',
        title: 'Task and control reference',
        blocks: [{ type: 'table', columns: ['Surface or task', 'How to use it'], rows: input.referenceRows }],
      },
      {
        id: 'common-failures',
        title: 'Common failure states',
        blocks: [
          {
            type: 'callout',
            tone: 'tip',
            title: 'Start with visible context',
            body: 'When an action is unavailable, inspect the active connection, environment badge, selected scope, tab type, Messages panel, and the disabled-reason text before changing configuration.',
          },
          {
            type: 'table',
            columns: ['Problem', 'Resolution'],
            rows: [
              ['The expected surface is hidden', 'Use the activity bar, View command, status-bar entry point, or Ctrl/Cmd+J for the panel and Ctrl/Cmd+B for the sidebar.'],
              ['The tab has stale context', 'Refresh the tab, reselect its connection and scope, or open a new tab from the intended Explorer object.'],
              ['A preview cannot execute', 'The feature may be preview-only for that datastore. Keep the generated plan or use the documented native-tool fallback.'],
            ],
          },
        ],
      },
      {
        id: 'safety-boundaries',
        title: 'Safety boundaries',
        blocks: [
          {
            type: 'callout',
            tone: 'warning',
            title: 'Confirm the target before writes',
            body: 'DataPad++ is pre-release software. Start with development or staging, keep independent backups, retain read-only mode by default, and review destructive, administrative, restore, and transfer plans before execution against your data.',
          },
        ],
      },
    ],
  }
}

export type DocumentedPlugin = {
  id: string
  title: string
  slug: string
  summary: string
  status: DocumentationStatus
  availability: string
  enablement: string
  dataBoundary: string
  disableBehavior: string
  features: Array<[string, string]>
}

export const documentedPlugins: DocumentedPlugin[] = [
  {
    id: 'workspaces',
    title: 'Workspaces',
    slug: 'plugin-workspaces',
    summary: 'Create and switch between named local workspaces while preserving each workspace before a switch.',
    status: 'Experimental',
    availability: 'Desktop app; stored in the local application workspace registry.',
    enablement: 'Application-local registry setting.',
    dataBoundary: 'Stores workspace names, locations, counts, recent status, and the active workspace id. It does not copy connected datastore data.',
    disableBehavior: 'The switcher is hidden and the current workspace remains active. Existing workspace profiles stay on disk.',
    features: [
      ['Named workspace profiles', 'Create a separate local profile for a project, team, or operating context.'],
      ['Save before switching', 'DataPad++ persists the active workspace before loading the selected profile.'],
      ['Workspace status', 'See which workspace is active together with connection, tab, and saved-work counts.'],
      ['Create and rename', 'Add a workspace from the Library section and rename it without changing its contents.'],
      ['Context restoration', 'Restore the selected workspace\'s connections, Explorer state, tabs, and supported window layout.'],
    ],
  },
  {
    id: 'workspace-search',
    title: 'Workspace Search',
    slug: 'workspace-search',
    summary: 'Search workspace structure and saved work without indexing credentials or datastore result payloads.',
    status: 'Live',
    availability: 'Desktop app and browser preview for the currently loaded workspace.',
    enablement: 'Current workspace preference.',
    dataBoundary: 'Indexes names and searchable workspace metadata. Secret values and query result payloads are excluded.',
    disableBehavior: 'Search entry points are hidden; connections, tabs, scripts, queries, tests, and saved work are unchanged.',
    features: [
      ['Workspace-wide index', 'Find connections, folders, Library work, scripts, queries, tests, and open or recently closed tabs.'],
      ['Result-type filters', 'Show only the categories relevant to the task.'],
      ['Matching controls', 'Use case-sensitive and whole-word matching to narrow a noisy result set.'],
      ['Open in context', 'Select a result to reopen its connection, saved work, or tab in the current workspace.'],
      ['Private index boundary', 'Search omits secrets and datastore result payloads.'],
    ],
  },
  {
    id: 'multi-window-tabs',
    title: 'Multi-window Tabs',
    slug: 'multi-window-tabs',
    summary: 'Move eligible working tabs into native editor windows while sharing one workspace and backend.',
    status: 'Experimental',
    availability: 'Desktop app on Windows, macOS, and Linux; cross-window drag depends on the validated WebView platform.',
    enablement: 'Current workspace preference.',
    dataBoundary: 'Persists tab ownership and window geometry, not a second datastore session or copied credentials.',
    disableBehavior: 'Eligible tabs return to the main window. Running or queued work must finish or be cancelled first.',
    features: [
      ['Move commands', 'Move an eligible tab to a new window, another window, or the main window from its tab menu.'],
      ['Validated dragging', 'Drag between strips only when the current platform exposes reliable WebView drag behavior.'],
      ['Shared backend', 'All windows use the same lock state, connections, environments, execution state, and workspace revision.'],
      ['Execution locks', 'Queued or running tabs cannot move, preventing duplicated or misdirected work.'],
      ['Layout recovery', 'Closing an editor window reattaches its tabs, and supported layout returns with the workspace.'],
    ],
  },
  {
    id: 'datastore-api-server',
    title: 'API Server',
    slug: 'api-server',
    summary: 'Expose explicitly selected resources and saved read queries through a local development API.',
    status: 'Experimental',
    availability: 'Desktop app; local loopback listeners only.',
    enablement: 'Current workspace preference.',
    dataBoundary: 'Only resources and saved queries added to a server profile are exposed. Generated projects contain configuration examples, not resolved secrets.',
    disableBehavior: 'Server entry points become unavailable while saved profiles remain in the workspace. Stop running profiles before disabling.',
    features: [
      ['Server profiles', 'Choose the connection, environment, protocol, port, and explicitly exposed resources.'],
      ['REST, GraphQL, and gRPC', 'Use the protocol that matches the local integration and inspect its generated contract.'],
      ['Resource discovery', 'Add supported tables, collections, indexes, items, or keys individually.'],
      ['Saved-query endpoints', 'Turn supported saved read queries and their typed parameters into custom endpoints.'],
      ['Metrics and logs', 'Review local requests, failures, latency, and redacted diagnostic events.'],
      ['Project export', 'Generate supported Rust or .NET service projects that use normal environment-based configuration.'],
    ],
  },
  {
    id: 'datastore-mcp-server',
    title: 'MCP Server',
    slug: 'mcp-server',
    summary: 'Give local MCP clients allowlisted, scoped, read-only access to selected DataPad++ tools.',
    status: 'Experimental',
    availability: 'Desktop app; Streamable HTTP on a loopback endpoint.',
    enablement: 'Current workspace preference.',
    dataBoundary: 'Profiles allowlist connections and environments. Tokens carry explicit scopes, are shown once, and are stored as verifiers rather than recoverable plaintext.',
    disableBehavior: 'Client entry points become unavailable while profiles and token metadata remain available for later review. Stop the endpoint before disabling.',
    features: [
      ['Scoped server profiles', 'Allowlist only the connections, environments, origins, and tool scopes a client needs.'],
      ['One-time tokens', 'Create a token, copy it once into the client\'s secret or environment store, and rotate it when necessary.'],
      ['Client setup', 'Copy generated setup for Codex, VS Code, Cursor, Claude Code, or Gemini CLI.'],
      ['Read-only tools', 'List metadata, run bounded reads, search the workspace, and inspect enabled plugin summaries where scopes allow.'],
      ['Plugin discovery', 'Use plugin:read to list enabled DataPad++ plugins and the MCP tools they expose.'],
      ['Metrics and audit logs', 'Review client connections, requests, denials, latency, and token-scope usage.'],
    ],
  },
  {
    id: 'datastore-security-checks',
    title: 'Datastore Security Checks',
    slug: 'datastore-security-checks',
    summary: 'Review vulnerability and configuration-posture guidance for saved datastore connections.',
    status: 'Experimental',
    availability: 'Desktop app for network-backed refreshes; results are advisory.',
    enablement: 'Current workspace preference with a configurable refresh interval.',
    dataBoundary: 'Uses profile metadata and bounded read-only version or posture probes. Evidence is sanitized and cloud-provider administration APIs are not called.',
    disableBehavior: 'Refresh and workspace entry points are unavailable. Treat any previously viewed result as stale until the next successful refresh.',
    features: [
      ['Version checks', 'Detect supported product versions and map them to candidate vulnerability identifiers.'],
      ['NVD and CISA KEV enrichment', 'Review severity, references, known-exploited status, and available remediation hints.'],
      ['Posture checks', 'Inspect TLS, authentication, read-only, environment, secret-storage, privilege, durability, and risky-setting guidance.'],
      ['Coverage-aware results', 'Distinguish deep adapter checks from profile-only checks and unknown results.'],
      ['Finding controls', 'Switch between Vulnerabilities and Posture, show passing checks, and mute a reviewed item.'],
      ['Refresh controls', 'Run a manual refresh when allowed and see checked and expiry timestamps.'],
    ],
  },
  {
    id: 'datastore-tests',
    title: 'Datastore Tests',
    slug: 'test-suites',
    summary: 'Build visual, target-bound test suites and run supported steps through the real datastore adapter.',
    status: 'Experimental',
    availability: 'Editor availability is workspace-scoped; live execution depends on the desktop adapter and target capability.',
    enablement: 'Current workspace preference.',
    dataBoundary: 'A suite is bound to one connection, environment, and target. Observations are bounded and sensitive evidence is redacted.',
    disableBehavior: 'Saved suites, cases, results, and drafts remain available. An active test run must finish or be cancelled before disabling.',
    features: [
      ['Visual suites and cases', 'Create suite-owned cases without maintaining a separate script file.'],
      ['Immutable target binding', 'Bind the suite to one connection, environment, and datastore object when it is created.'],
      ['Phased steps', 'Compose Setup, Execute, and Teardown from supported queries, builders, edits, and adapter operations.'],
      ['Assertions', 'Check row or document counts, key existence, JSON paths, errors, and duration limits.'],
      ['Capability preflight', 'Review generated operations, blockers, warnings, and confirmation requirements before a run.'],
      ['Run evidence', 'Run one case or a suite and inspect pass, failure, blocked, timing, and teardown outcomes.'],
    ],
  },
]

const pluginOverviewGuide: DocArticle = {
  slug: 'plugins',
  title: 'Choose And Manage Plugins',
  description: 'Understand every DataPad++ plugin, enable only what you need, and open its working surface.',
  category: 'Plugins',
  readingTime: '8 min',
  status: 'Live',
  featured: false,
  relatedGuides: documentedPlugins.map((plugin) => plugin.slug),
  prerequisites: [
    'Open DataPad++ and select the workspace where the capability should be available.',
    'Use the desktop app for native windows, local servers, network-backed security scans, and adapter-backed test execution.',
  ],
  keywords: ['plugins', 'extensions', 'enable plugin', 'disable plugin', 'plugin permissions', ...documentedPlugins.flatMap((plugin) => [plugin.title, plugin.id])],
  sections: [
    {
      id: 'quickstart',
      title: 'Enable a plugin',
      blocks: [
        {
          type: 'procedure',
          steps: [
            { title: 'Open Plugins settings', body: 'Open Settings from the status bar or a Settings tab, then choose Plugins.', figure: 'plugins-ready' },
            { title: 'Review maturity and platform notes', body: 'Read the badge, feature list, and disabled reason. Experimental plugins are opt-in previews and some require the desktop app.', figure: 'plugins-experimental' },
            { title: 'Enable only the capability you need', body: 'Turn on the plugin for the current workspace. Workspaces uses the local application registry because it controls switching between workspace files.' },
            { title: 'Open its working surface', body: 'Use Open on the plugin card, its Library or status-bar entry point, or the relevant tab menu. The individual guides below show each path.' },
            { title: 'Verify the boundary before use', body: 'Confirm the selected connection, environment, allowlist, scopes, read-only state, and preview limitations before running a test or starting a local server.' },
          ],
        },
      ],
    },
    {
      id: 'available-plugins',
      title: 'Available plugins',
      blocks: [
        {
          type: 'table',
          columns: ['Plugin', 'Maturity', 'What it adds', 'Where it runs'],
          rows: documentedPlugins.map((plugin) => [plugin.title, plugin.status, plugin.summary, plugin.availability]),
        },
      ],
    },
    {
      id: 'permissions-and-data',
      title: 'Permissions, data, and disable behavior',
      blocks: [
        { type: 'paragraph', text: 'Plugins are first-party opt-in capabilities. Enabling one does not grant new datastore permissions; the active connection account, environment policy, safe mode, and adapter capability still apply.' },
        {
          type: 'callout',
          tone: 'important',
          title: 'Local does not mean unrestricted',
          body: 'API and MCP listeners bind to loopback, but their resource allowlists and token scopes still matter. Do not expose a listener through a proxy or tunnel unless you have designed and reviewed that security boundary.',
        },
        {
          type: 'table',
          columns: ['Plugin', 'Enablement scope', 'When disabled'],
          rows: documentedPlugins.map((plugin) => [plugin.title, plugin.enablement, plugin.disableBehavior]),
        },
      ],
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      blocks: [
        {
          type: 'table',
          columns: ['Problem', 'What to check'],
          rows: [
            ['The enable control is unavailable', 'Read the card\'s platform message, use the desktop app where required, and wait for active runs or movable tabs to become idle.'],
            ['The plugin is enabled but its entry point is missing', 'Confirm the correct workspace is active, reopen Settings → Plugins, and inspect the status bar, Library sections, or tab menu documented in the plugin guide.'],
            ['The plugin cannot access a datastore', 'Test the connection and verify its environment assignment, account permissions, read-only policy, resource allowlist, and adapter capability.'],
            ['A server client is denied', 'Verify loopback URL, port, origin allowlist, bearer token, token expiry, and required scope without sharing the raw token.'],
          ],
        },
      ],
    },
    {
      id: 'safety-boundaries',
      title: 'Safety boundaries',
      blocks: [
        {
          type: 'callout',
          tone: 'warning',
          title: 'Plugins inherit every existing guardrail',
          body: 'Enabling a plugin does not bypass read-only connections, environment confirmations, safe mode, adapter limits, resource allowlists, or token scopes. Keep independent datastore backups and start with development or staging.',
        },
      ],
    },
  ],
}

const pluginWorkspaceGuide = taskGuide({
  slug: 'plugin-workspaces',
  title: 'Use The Workspaces Plugin',
  description: 'Create, switch, rename, and safely maintain named local DataPad++ workspaces.',
  category: 'Plugins',
  screenshots: ['plugins-experimental', 'workspace-switcher'],
  steps: [
    { title: 'Enable Workspaces', body: 'Open Settings → Plugins, find Workspaces under Experimental Plugins, and enable Workspaces switcher.' },
    { title: 'Create a named workspace', body: 'Open Library, expand Workspaces, choose New workspace, enter a short recognizable name, and choose Create. DataPad++ saves the current workspace before switching.' },
    { title: 'Switch workspaces', body: 'Select another workspace in the Workspaces section. Confirm that the active name, connection count, tab count, Library work, Explorer state, and supported window layout match the intended context.' },
    { title: 'Rename without moving data', body: 'Use the rename action beside a workspace. Renaming changes the profile label only; it does not rewrite the workspace contents or connected datastore.' },
    { title: 'Back up important workspace configuration', body: 'Use Workspace + Backups to export or automatically back up DataPad++ configuration. Back up each connected datastore separately with its supported native tools.' },
  ],
  referenceRows: [
    ['Workspaces section', 'Lists local workspace profiles, highlights the active profile, and shows summary counts.'],
    ['New workspace', 'Creates a new local profile after saving the current workspace.'],
    ['Switch', 'Saves the current workspace, loads the selected workspace, and restores its navigation and tabs.'],
    ['Rename', 'Changes the profile name without modifying connections or datastore data.'],
    ['Disable', 'Hides the switcher while leaving the active and saved workspace profiles intact.'],
  ],
  keywords: ['workspace plugin', 'workspace switcher', 'new workspace', 'switch workspace', 'rename workspace', 'workspace registry'],
  relatedGuides: ['plugins', 'settings-workspace-backups', 'workspace-import-export', 'multi-window-tabs'],
  status: 'Experimental',
})

function enhancePluginArticle(article: DocArticle): DocArticle {
  const plugin = documentedPlugins.find((candidate) => candidate.slug === article.slug)
  if (!plugin) return article
  const [quickstart, ...remainingSections] = article.sections
  if (!quickstart) return article

  return {
    ...article,
    category: 'Plugins',
    status: plugin.status,
    relatedGuides: Array.from(new Set(['plugins', ...(article.relatedGuides ?? [])])).filter((slug) => slug !== article.slug),
    prerequisites: [
      'Open the workspace where you want this plugin to be available and review its current maturity in Settings → Plugins.',
      `Confirm the platform boundary: ${plugin.availability}`,
      'Use only connections, environments, resources, and credentials you are authorized to access.',
    ],
    keywords: [...article.keywords, plugin.id, plugin.title, 'plugin', 'enable plugin', ...plugin.features.flatMap(([feature, use]) => [feature, use])],
    sections: [
      quickstart,
      {
        id: 'features',
        title: 'Features',
        blocks: [{ type: 'table', columns: ['Feature', 'How to use it'], rows: plugin.features }],
      },
      {
        id: 'availability-and-data',
        title: 'Availability and data boundary',
        blocks: [
          { type: 'table', columns: ['Area', 'Behavior'], rows: [
            ['Maturity', plugin.status],
            ['Availability', plugin.availability],
            ['Enablement', plugin.enablement],
            ['Data boundary', plugin.dataBoundary],
            ['When disabled', plugin.disableBehavior],
          ] },
        ],
      },
      ...remainingSections,
    ],
  }
}

const newTaskGuides: DocArticle[] = [
  taskGuide({
    slug: 'interface-tour',
    title: 'Tour The DataPad++ Interface',
    description: 'Learn every navigation surface before you connect or run a query.',
    category: 'Getting started',
    screenshots: ['hero-workbench', 'library-environments'],
    steps: [
      { title: 'Choose a sidebar', body: 'Use the activity rail to open Library, Explorer, or Tests. Library owns saved connections, environments, folders, scripts, and reusable work; Explorer follows the active datastore; Tests opens visual datastore suites.' },
      { title: 'Open a workspace tab', body: 'Open query, explorer, metrics, object-view, test-suite, environment, settings, API Server, MCP Server, Workspace Search, or Security Checks tabs. Each tab retains its own target and state.' },
      { title: 'Use the query toolbar', body: 'Review Run, Cancel, Explain, query mode, connection context, and document-action controls. Controls appear only when the active tab and datastore can support them.' },
      { title: 'Arrange supporting surfaces', body: 'Open Results, Messages, History, or Details and dock the panel at the bottom or right. Use connection, inspection, and diagnostics drawers for focused tasks.' },
      { title: 'Read the status bar', body: 'Open updates, API/MCP servers, security checks, transfers, messages, panel visibility, or Settings from their status-bar entry points.' },
    ],
    referenceRows: [
      ['Library sidebar', 'Connections, environments, folders, scripts, saved queries, and recently used work.'],
      ['Explorer sidebar', 'Native database, schema, table, collection, index, bucket, metric, or graph objects for the active connection.'],
      ['Tests sidebar', 'Owned suites, cases, steps, variables, assertions, and adapter-backed preflight runs.'],
      ['Right drawers', 'Connection editing, object inspection, and connection/query diagnostics without leaving the active tab.'],
      ['Status bar', 'Updates, servers, security, transfers, messages, panels, and Settings entry points.'],
    ],
    keywords: ['navigation', 'Library', 'Explorer', 'Tests', 'status bar', 'tabs', 'drawers', 'panels'],
    relatedGuides: ['first-query', 'tabs-panels-and-drawers', 'appearance-shortcuts-logs'],
  }),
  taskGuide({
    slug: 'first-query',
    title: 'Run Your First Query',
    description: 'Connect to your datastore, select its scope, run a bounded read, and inspect the result.',
    category: 'Getting started',
    screenshots: ['connection-wizard', 'sql-query-results'],
    steps: [
      { title: 'Add and test a connection', body: 'In Library, choose Add connection, select your datastore, enter its host or file and authentication details, keep Read only enabled, and choose Test connection.' },
      { title: 'Open a query from Explorer', body: 'Expand the connection, choose a database/schema/container/index/bucket/graph scope, and open a new query so the tab inherits that context.' },
      { title: 'Run a bounded read', body: 'Enter a read-only query with a row or document limit, then choose Run or press Ctrl/Cmd+Enter. Choose Cancel if the request is no longer useful.' },
      { title: 'Inspect the run', body: 'Review Results, Messages, History, and Details. Use Explain or Ctrl/Cmd+Shift+E only when the selected query mode and datastore expose a safe plan.' },
      { title: 'Save the tab', body: 'Press Ctrl/Cmd+S, choose a Library location, and use a task-specific name that does not contain credentials or customer identifiers.' },
    ],
    referenceRows: [
      ['Run', 'Executes the active selection or document with the current connection, scope, query mode, and safety policy.'],
      ['Cancel', 'Requests cancellation for the active execution; server-side completion can still depend on the datastore.'],
      ['Explain', 'Shows a plan for supported safe reads; Explain Analyze or equivalent may execute the statement and is labeled separately.'],
      ['Connection context', 'Changes the tab target without changing another tab. Recheck database/schema/container scope afterward.'],
    ],
    keywords: ['query', 'run', 'cancel', 'explain', 'Ctrl Enter', 'connection context', 'query mode'],
    relatedGuides: ['connections', 'querying', 'results-and-editing'],
  }),
  taskGuide({
    slug: 'tabs-panels-and-drawers',
    title: 'Use Tabs, Panels, And Drawers',
    description: 'Manage workspace tabs and place supporting information where it is easiest to compare.',
    category: 'Workspaces, backups, and recovery',
    screenshots: ['multi-window-tabs', 'hero-workbench'],
    steps: [
      { title: 'Manage tabs', body: 'Save, rename, drag to reorder, or close a tab. Press Ctrl/Cmd+Shift+T to reopen the most recently closed tab.' },
      { title: 'Choose a panel', body: 'Open Results, Messages, History, or Details. Press Ctrl/Cmd+J to show or hide the panel and choose bottom or right docking.' },
      { title: 'Open a drawer', body: 'Use the connection drawer for profile context, inspection for the selected object or cell, and diagnostics for connection and execution evidence.' },
      { title: 'Use multiple windows', body: 'When experimental multi-window support is enabled, detach a tab to another window. The windows share the workspace and backend while each tab keeps its own context.' },
      { title: 'Recover layout', body: 'If a surface is lost, use Workspace Search, the status bar, or Settings to reopen it; reopen a closed tab before recreating work.' },
    ],
    referenceRows: [
      ['Query tab', 'Editor, query mode, connection/scope, execution controls, and result panels.'], ['Explorer / object-view / metrics', 'Native browsing, selected-object detail, or datastore metrics.'], ['Environment / settings', 'Policy and application configuration workspaces.'], ['API / MCP / Search / Security', 'Dedicated integration, discovery, and diagnostic workspaces.'], ['Multi-window', 'Experimental; unavailable controls are labeled and no independent backend is created.'],
    ],
    keywords: ['save tab', 'rename tab', 'reorder tab', 'close tab', 'reopen tab', 'multi-window', 'Results', 'Messages', 'History', 'Details', 'bottom dock', 'right dock'],
    relatedGuides: ['multi-window-tabs', 'workspace-search', 'interface-tour'],
    status: 'Experimental',
  }),
  taskGuide({
    slug: 'connection-health',
    title: 'Check Connection Health',
    description: 'Test connectivity, inspect capability warnings, and diagnose a failing profile.',
    category: 'Connections, environments, and secrets',
    screenshots: ['connection-wizard', 'search-diagnostics'],
    steps: [
      { title: 'Open the connection drawer', body: 'Select a Library connection and open Connection. Confirm engine, endpoint, environment, scope, credential source, TLS mode, and read-only posture.' },
      { title: 'Test without saving secrets', body: 'Choose Test connection. The result separates transport/authentication failures from permission and capability warnings.' },
      { title: 'Open diagnostics', body: 'Use the Diagnostics drawer to inspect timing, endpoint and adapter evidence, server metadata, and safe suggested actions.' },
      { title: 'Refresh the Explorer', body: 'After a successful test, refresh the relevant branch. Empty branches usually mean scope or metadata permission problems, not a successful empty database.' },
      { title: 'Escalate safely', body: 'Copy redacted diagnostics only. Never include tokens, passwords, personal file paths, or full production connection strings in an issue.' },
    ],
    referenceRows: [['Test connection', 'Validates endpoint, authentication, TLS, selected environment, and adapter handshake.'], ['Capability warning', 'Explains partial metadata, query, edit, diagnostics, admin, or transfer support.'], ['Diagnostics drawer', 'Shows redacted evidence and retry guidance for the selected connection or run.'], ['Security Checks', 'Audits profile posture without silently modifying the datastore.']],
    keywords: ['health', 'test connection', 'timeout', 'TLS', 'credentials', 'diagnostics drawer', 'permission warning'],
    relatedGuides: ['connections', 'datastore-security-checks', 'safety-model'],
  }),
  taskGuide({
    slug: 'query-history-explain',
    title: 'Use Query History And Explain',
    description: 'Review previous executions, reopen a query, and inspect safe execution plans.',
    category: 'Querying and query builders',
    screenshots: ['sql-query-results', 'search-diagnostics'],
    steps: [
      { title: 'Open History', body: 'Show the bottom/right panel and select History. Filter entries by tab, target, status, or time before reopening one.' },
      { title: 'Review captured context', body: 'Confirm the stored connection, environment, scope, query mode, duration, row count, and error state. History is diagnostic context, not proof that a rerun is still safe.' },
      { title: 'Reopen without running', body: 'Open the history entry in a new query tab, review it, and update any time bounds or target names before execution.' },
      { title: 'Explain a read', body: 'Select a supported read-only statement and choose Explain or Ctrl/Cmd+Shift+E. Use the rendered plan and Details panel to find scans, filters, joins, shards, or traversal cost.' },
      { title: 'Avoid accidental execution', body: 'Explain Analyze and equivalent profile modes can execute the statement. Use them only for bounded reads against safe targets.' },
    ],
    referenceRows: [['History panel', 'Execution timestamp, target context, status, duration, affected/returned count, and reopen action.'], ['Explain', 'Non-executing plan where supported.'], ['Explain Analyze / Profile', 'May execute a read and consume production resources; separately labeled and guarded.'], ['Details panel', 'Plan nodes, raw payload, timings, notices, or adapter metadata.']],
    keywords: ['history', 'reopen query', 'explain plan', 'explain analyze', 'profile', 'Details panel'],
    relatedGuides: ['querying', 'results-and-editing', 'first-query'],
  }),
  taskGuide({
    slug: 'metrics-and-inspection',
    title: 'Inspect Objects And Metrics',
    description: 'Open object views, inspect metadata, and use metrics without losing query context.',
    category: 'Exploring and IntelliSense',
    screenshots: ['explorer-tree', 'relationship-explorer'],
    steps: [
      { title: 'Select an Explorer object', body: 'Choose a native object in Explorer and open Object view or the Inspection drawer to see identifiers, columns/fields/properties, indexes, ownership, and available actions.' },
      { title: 'Open metrics', body: 'Use the object action or status entry point to open a Metrics tab when the adapter supplies safe runtime evidence.' },
      { title: 'Compare without retargeting', body: 'Keep the object-view or metrics tab beside the query tab. Each retains its own connection, environment, and scope.' },
      { title: 'Refresh intentionally', body: 'Press F5 or use Refresh to request current metadata. Large branches and Oracle paging may show Load more rather than fetching everything.' },
      { title: 'Read unavailable states', body: 'A disabled metric, inspection field, or admin action includes a reason such as missing permission, unsupported adapter capability, incompatible object kind, or plan-only status.' },
    ],
    referenceRows: [['Explorer tab', 'A full native browsing workspace.'], ['Object-view tab', 'Persistent selected-object metadata and actions.'], ['Metrics tab', 'Adapter-provided health, activity, size, latency, or performance evidence.'], ['Inspection drawer', 'Transient detail for the current tree node, result cell, or plan node.'], ['Diagnostics drawer', 'Connection and execution evidence with redacted copy actions.']],
    keywords: ['metrics tab', 'object-view tab', 'inspection drawer', 'diagnostics drawer', 'F5', 'refresh', 'Load more'],
    relatedGuides: ['explorer', 'datastore-explorer', 'relationship-explorer', 'oracle-explorer-intellisense'],
  }),
  taskGuide({
    slug: 'transfers-center',
    title: 'Use The Transfers Center',
    description: 'Start a supported transfer, monitor progress, and recover from warnings or failures.',
    category: 'Import, export, and native backup',
    screenshots: ['datastore-transfer', 'transfer-center'],
    steps: [
      { title: 'Open a transfer action', body: 'Choose Import, Export, Backup, Restore, or Transfer from a compatible object action. Unsupported operations stay disabled with the runtime-manifest reason.' },
      { title: 'Review the plan', body: 'Confirm source objects, native or portable format, destination, overwrite/conflict behavior, validation, backend impact, and environment guardrails.' },
      { title: 'Start the job', body: 'Start only against an approved nonproduction target. A background job appears in Transfers Center and retains its native job identifier when available.' },
      { title: 'Monitor or cancel', body: 'Open Transfers from the status bar to review progress, warnings, logs, cancellation, retry state, and completed artifacts.' },
      { title: 'Validate the result', body: 'Check counts, checksums or engine-native validation, warnings, and destination scope before treating the transfer as successful.' },
    ],
    referenceRows: [['Import / export', 'Portable file movement where the runtime manifest marks formats as executable.'], ['Backup / restore', 'Engine-native operations; guarded separately and never implied by portable export.'], ['Cancel', 'Requests cancellation; an engine-native job may require time to stop.'], ['Retry', 'Creates a reviewed retry from retained safe parameters; secrets are resolved again.'], ['Completed artifact', 'Shows path, format, validation, warnings, and redacted job metadata.']],
    keywords: ['Transfers Center', 'status bar transfers', 'import', 'export', 'backup', 'restore', 'cancel transfer', 'retry transfer'],
    relatedGuides: ['native-datastore-transfers', 'import-export', 'result-export'],
  }),
  taskGuide({
    slug: 'appearance-shortcuts-logs',
    title: 'Configure Appearance, Shortcuts, And Logs',
    description: 'Navigate all eight Settings sections and safely collect diagnostic logs.',
    category: 'Workspaces, backups, and recovery',
    screenshots: ['settings-backups', 'workspace-import-review'],
    steps: [
      { title: 'Open Settings', body: 'Use the status bar or Settings tab, then choose Appearance, Workspace + Backups, Updates, Security, Plugins, Shortcuts, Logs, or About.' },
      { title: 'Adjust appearance', body: 'Choose theme, density, editor, result-grid, and panel presentation settings. Reduced-motion preferences remain respected.' },
      { title: 'Review workspace and security', body: 'Configure workspace location, backup/export behavior, update channel, secret handling, read-only defaults, and environmental guardrails.' },
      { title: 'Change shortcuts or plugins', body: 'Review conflicts before saving shortcut changes. Plugins and other experimental features show maturity and permission boundaries.' },
      { title: 'Collect redacted logs', body: 'Filter Logs by level or component, copy only the minimum diagnostic slice, and inspect it for tokens, credentials, connection strings, personal paths, and customer data before sharing.' },
    ],
    referenceRows: [['Appearance', 'Theme, density, editor, grid, and layout preferences.'], ['Workspace + Backups', 'Workspace path, encrypted bundle import/export, backup posture, and size review.'], ['Updates', 'Release channel, checks, download state, and restart guidance.'], ['Security', 'Secret storage, read-only defaults, environment confirmation, and redaction.'], ['Plugins', 'Experimental extension discovery, status, permissions, and disabled reasons.'], ['Shortcuts', 'Searchable command bindings and conflict review.'], ['Logs', 'Local diagnostic events, filters, copy/export, and redaction guidance.'], ['About', 'Version, platform, licenses, links, and support information.']],
    keywords: ['Appearance', 'Workspace Backups', 'Updates', 'Security', 'Plugins', 'Shortcuts', 'Logs', 'About', 'settings'],
    relatedGuides: ['settings-workspace-backups', 'workspace-import-export', 'safety-model'],
  }),
]

const allTaskArticles = [
  ...legacyDocArticles.map(upgradeLegacyArticle),
  ...newTaskGuides,
  pluginWorkspaceGuide,
].map(enhancePluginArticle)
const pluginArticleSlugs = new Set(documentedPlugins.map((plugin) => plugin.slug))

export const docArticles: DocArticle[] = [
  ...allTaskArticles.filter((article) => !pluginArticleSlugs.has(article.slug)),
  pluginOverviewGuide,
  ...documentedPlugins.map((plugin) => {
    const article = allTaskArticles.find((candidate) => candidate.slug === plugin.slug)
    if (!article) throw new Error(`Missing documentation article for plugin ${plugin.id}`)
    return article
  }),
]

export const docCategories = [
  'Getting started',
  'Connections, environments, and secrets',
  'Workspaces, backups, and recovery',
  'Exploring and IntelliSense',
  'Querying and query builders',
  'Results and safe editing',
  'Import, export, and native backup',
  'Plugins',
  'Datastore-specific guides',
] as const

export type DocNavigationGroup = {
  label: string
  slugs: string[]
}

export const docNavigationGroups: DocNavigationGroup[] = [
  { label: 'Start here', slugs: ['install-and-update', 'first-launch', 'interface-tour', 'first-query'] },
  { label: 'Connections and organization', slugs: ['connections', 'environments', 'library', 'connection-health'] },
  { label: 'Navigate and inspect', slugs: ['explorer', 'datastore-explorer', 'relationship-explorer', 'oracle-explorer-intellisense', 'metrics-and-inspection', 'tabs-panels-and-drawers'] },
  { label: 'Query and edit', slugs: ['querying', 'query-history-explain', 'typed-query-builders', 'sql-database-schema-scope', 'results-and-editing', 'document-results-editing', 'key-value-full-value'] },
  { label: 'Move and protect data', slugs: ['import-export', 'result-export', 'native-datastore-transfers', 'transfers-center', 'settings-workspace-backups', 'workspace-import-export', 'workspace-size-analysis'] },
  { label: 'Plugins', slugs: ['plugins', ...documentedPlugins.map((plugin) => plugin.slug)] },
  { label: 'Automate and diagnose', slugs: ['appearance-shortcuts-logs'] },
  { label: 'Safety and troubleshooting', slugs: ['safety-model', 'datastore-coverage-maturity'] },
  { label: 'Datastore guides', slugs: ['sql-workflows', 'mongodb-workflows', 'redis-valkey-workflows', 'search-dynamodb-and-secondary'] },
]

export const documentedNavigationSurfaces = [
  'Library sidebar', 'Explorer sidebar', 'Tests sidebar', 'query tab', 'explorer tab', 'metrics tab', 'object-view tab', 'test-suite tab', 'environment tab', 'settings tab', 'API Server tab', 'MCP Server tab', 'Workspace Search tab', 'Security Checks tab',
  'Run control', 'Cancel control', 'Explain control', 'query-mode control', 'connection-context control', 'document-action control', 'Results panel', 'Messages panel', 'History panel', 'Details panel', 'bottom docking', 'right docking',
  'connection drawer', 'inspection drawer', 'diagnostics drawer', 'tab save', 'tab rename', 'tab reorder', 'tab close', 'tab reopen', 'multi-window', 'updates status', 'API server status', 'MCP server status', 'security checks status', 'transfers status', 'messages status', 'panel visibility status', 'settings status',
  'Appearance settings', 'Workspace + Backups settings', 'Updates settings', 'Security settings', 'Plugins settings', 'Shortcuts settings', 'Logs settings', 'About settings',
] as const

export const navigationSurfaceArticle = Object.fromEntries(
  documentedNavigationSurfaces.map((surface) => {
    const normalized = surface.toLowerCase()
    const slug = normalized.includes('settings') || ['updates status', 'panel visibility status'].includes(normalized)
      ? 'appearance-shortcuts-logs'
      : normalized.includes('drawer') || normalized.includes('metrics') || normalized.includes('object-view')
        ? 'metrics-and-inspection'
        : normalized.includes('panel') || normalized.includes('tab') || normalized.includes('docking') || normalized.includes('multi-window')
          ? 'tabs-panels-and-drawers'
          : normalized.includes('run') || normalized.includes('cancel') || normalized.includes('explain') || normalized.includes('query-mode') || normalized.includes('connection-context') || normalized.includes('document-action')
            ? 'first-query'
            : 'interface-tour'
    return [surface, slug]
  }),
) as Record<(typeof documentedNavigationSurfaces)[number], string>

export function getDocBySlug(slug: string) {
  return docArticles.find((article) => article.slug === slug)
}

export function getNextDoc(slug: string) {
  const index = docArticles.findIndex((article) => article.slug === slug)
  return index >= 0 ? docArticles[index + 1] : undefined
}
