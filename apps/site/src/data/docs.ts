import type { ScreenshotId } from './screenshots'

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
}

export const docArticles: DocArticle[] = [
  {
    slug: 'install-and-update',
    title: 'Install And Update DataPad++',
    description: 'Download the right desktop artifact, install it, and understand updater behavior.',
    category: 'Get started',
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
        body: 'Release builds include updater metadata when signing assets are present. If updates appear unavailable, download the next published release manually from GitHub.',
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
    category: 'Get started',
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
        body: 'Create or choose a Local, QA, or read-only environment before connecting to production-like systems.',
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
    category: 'Core workflows',
    readingTime: '8 min',
    screenshots: ['connection-wizard', 'explorer-tree'],
    steps: [
      {
        title: 'Choose New Connection',
        body: 'Start from the Library or connection surface and choose the datastore type that matches the system you want to inspect.',
      },
      {
        title: 'Enter native connection details',
        body: 'Fill in host, port, database, file path, connection string, credential mode, or cloud profile fields depending on the selected datastore.',
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
        body: 'Run the connection test, review warnings or disabled reasons, then save only when the profile represents the target accurately.',
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
    category: 'Core workflows',
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
    category: 'Core workflows',
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
    category: 'Core workflows',
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
    category: 'Core workflows',
    readingTime: '9 min',
    screenshots: ['sql-query-results', 'mongodb-builder', 'redis-browser'],
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
        body: 'When visual builders generate a query, read and adjust it before saving or running against sensitive systems.',
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
    category: 'Core workflows',
    readingTime: '8 min',
    screenshots: ['sql-query-results', 'mongodb-builder', 'redis-browser', 'safety-preview'],
    steps: [
      {
        title: 'Inspect the renderer that matches the payload',
        body: 'Tables use sticky headers and row selection. Documents expand as trees. Redis and Valkey keys show type-aware value surfaces and metadata.',
      },
      {
        title: 'Use raw views when needed',
        body: 'Switch to raw JSON, text, details, messages, or history when the rich renderer hides information you need.',
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
    category: 'Core workflows',
    readingTime: '7 min',
    screenshots: ['import-export', 'settings-backups'],
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
        body: 'Confirm file path, overwrite mode, target identity, read-only state, environment risk, and any scan or cost warning before execution.',
      },
      {
        title: 'Run bounded workflows first',
        body: 'For new connections, export a small object or validate mode before moving larger volumes of data.',
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
    category: 'Core workflows',
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
        body: 'Export serializers sanitize secret-looking fields and preserve the shape needed for downstream analysis, fixtures, or support handoffs.',
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
    category: 'Administration',
    readingTime: '7 min',
    screenshots: ['settings-backups', 'library-environments'],
    steps: [
      {
        title: 'Open Settings as a tab',
        body: 'Settings opens in the workbench so you can close it like other tabs and keep context nearby.',
      },
      {
        title: 'Review Appearance and Workspace',
        body: 'Tune theme, layout, workspace defaults, and saved-work behavior before heavy use.',
      },
      {
        title: 'Export a workspace bundle',
        body: 'Use the system save dialog to create an encrypted .datapadpp-workspace file with integrity metadata.',
      },
      {
        title: 'Choose secret inclusion deliberately',
        body: 'Including passwords or secrets in a workspace bundle is explicit and remains inside the encrypted payload.',
      },
      {
        title: 'Enable auto-backups when useful',
        body: 'Opt-in backups are encrypted, passphrase-protected, and rotate so snapshots do not grow without bound.',
      },
      {
        title: 'Verify import before relying on backups',
        body: 'Test import with a non-critical workspace so you know the passphrase and integrity checks behave as expected.',
      },
    ],
  },
  {
    slug: 'api-server',
    title: 'Run A Local API Server',
    description: 'Expose selected datastore resources and saved queries as local REST, GraphQL, or gRPC endpoints.',
    category: 'Plugin workflows',
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
    category: 'Plugin workflows',
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
    category: 'Plugin workflows',
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
    category: 'Plugin workflows',
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
    category: 'Advanced workflows',
    readingTime: '7 min',
    screenshots: ['test-suites', 'library-environments'],
    steps: [
      {
        title: 'Create or open a test suite',
        body: 'Test suites live with saved work in the Library and keep the target engine, connection, environment, and variables visible.',
      },
      {
        title: 'Choose the editor mode',
        body: 'Use the visual editor, raw JSON, or both. The visual mode is easier for common checks, while raw JSON keeps the full test definition inspectable.',
      },
      {
        title: 'Define setup and execute steps',
        body: 'Add query or request steps for setup, execution, and teardown. SQL suites default to select 1, while MongoDB suites start with JSON-shaped reads.',
      },
      {
        title: 'Add assertions',
        body: 'Use assertions such as row count, document count, key existence, key type, search-hit count, JSON path, no-error, or duration-under.',
      },
      {
        title: 'Run and cancel safely',
        body: 'Run the suite from the toolbar and cancel active runs when needed. The same environment and guardrail model applies to test execution.',
      },
      {
        title: 'Save tests near the target',
        body: 'Keep suites in the same Library folder as the connection or saved query they prove so inherited environment context remains obvious.',
      },
    ],
  },
  {
    slug: 'relationship-explorer',
    title: 'Use SQL Relationship Diagrams',
    description: 'Understand table shape, joins, and schema boundaries before writing broad SQL.',
    category: 'Advanced workflows',
    readingTime: '6 min',
    screenshots: ['relationship-explorer', 'explorer-tree'],
    steps: [
      {
        title: 'Open Structure from a SQL connection',
        body: 'Use a SQL-family connection or Explorer action to open the structure workspace for the schemas and tables you want to understand.',
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
    category: 'Administration',
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
    category: 'Datastore guides',
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
    category: 'Datastore guides',
    readingTime: '8 min',
    screenshots: ['mongodb-builder', 'explorer-tree', 'import-export'],
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
    category: 'Datastore guides',
    readingTime: '8 min',
    screenshots: ['redis-browser', 'import-export', 'safety-preview'],
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
    category: 'Datastore guides',
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
    category: 'Administration',
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
]

export const docCategories = Array.from(new Set(docArticles.map((article) => article.category)))

export function getDocBySlug(slug: string) {
  return docArticles.find((article) => article.slug === slug)
}

export function getNextDoc(slug: string) {
  const index = docArticles.findIndex((article) => article.slug === slug)
  return index >= 0 ? docArticles[index + 1] : undefined
}
