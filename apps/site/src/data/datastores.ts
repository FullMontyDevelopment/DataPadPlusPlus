import type { ScreenshotId } from './screenshots'
import { declaredDatastoreEngines, type DatastoreEngineId } from './datastore-engines'

export { declaredDatastoreEngines, type DatastoreEngineId } from './datastore-engines'

export type DatastoreScreenshot = {
  id: ScreenshotId
  shared?: boolean
}

export type DatastoreConnectionField = {
  name: string
  required: boolean
  description: string
  example: string
}

export type DatastoreCapabilityRow = {
  capability: string
  support: 'Available' | 'Guarded' | 'Preview' | 'Unavailable'
  notes: string
}

export type DatastoreTroubleshootingItem = {
  symptom: string
  resolution: string
}

export type DatastoreDoc = {
  engine: DatastoreEngineId
  slug: string
  title: string
  aliases?: string[]
  family: string
  maturity: string
  summary: string
  bestFor: string[]
  connections: string[]
  explorer: string[]
  queryModes: string[]
  resultViews: string[]
  adminFeatures: string[]
  diagnostics: string[]
  importExport: string[]
  safety: string[]
  screenshots: DatastoreScreenshot[]
  prerequisites: string[]
  platforms: string[]
  connectionFields: DatastoreConnectionField[]
  quickstart: string[]
  sampleQuery: string
  queryLanguage: string
  expectedResult: string
  capabilities: DatastoreCapabilityRow[]
  troubleshooting: DatastoreTroubleshootingItem[]
}

const datastoreFamilyOrder = [
  'SQL and relational',
  'Document and NoSQL',
  'Key-value and cache',
  'Search',
  'Warehouse and analytical',
  'Time-series and metrics',
  'Graph',
]

function screenshotSet(engine: DatastoreEngineId): DatastoreScreenshot[] {
  return [
    { id: `datastore-${engine}-connection` as ScreenshotId },
    { id: `datastore-${engine}-workflow` as ScreenshotId },
    { id: 'explorer-tree', shared: true },
    { id: 'result-export', shared: true },
    { id: 'transfer-center', shared: true },
  ]
}

type DatastoreDocBase = Omit<
  DatastoreDoc,
  | 'prerequisites'
  | 'platforms'
  | 'connectionFields'
  | 'quickstart'
  | 'sampleQuery'
  | 'queryLanguage'
  | 'expectedResult'
  | 'capabilities'
  | 'troubleshooting'
>

const datastoreDocsBase: DatastoreDocBase[] = [
  {
    engine: 'postgresql',
    slug: 'postgresql',
    title: 'PostgreSQL',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'PostgreSQL gets a typed SQL workbench with rich catalog views, live read execution, primary-key row evidence, and guarded operational previews.',
    bestFor: ['Application databases', 'Routine and extension review', 'Lock and session diagnostics'],
    connections: [
      'Choose PostgreSQL, then fill TCP, Unix socket, or Cloud SQL proxy details with database, application name, search path, target session attributes, TLS certificate paths, and timeout fields.',
      'Test the profile before saving and review permission warnings for pg_stat, routines, extensions, grants, and optional pg_stat_statements visibility.',
    ],
    explorer: [
      'Browse databases, schemas, tables, views, columns, indexes, routines, extensions, roles, role memberships, grants, and default privileges.',
      'Use object actions to open scoped SELECTs, routine-call previews, extension reviews, grants, and maintenance plans.',
    ],
    queryModes: [
      'Run raw PostgreSQL SQL with metadata-aware snippets for pg_catalog, routines, sessions, locks, search paths, and mixed-case identifier quoting.',
      'Use table-scoped SELECT builders, rendered EXPLAIN plans, and EXPLAIN ANALYZE BUFFERS profiling for safe read statements.',
    ],
    resultViews: [
      'Inspect table grids with sticky headers, row selection, messages, details, and rendered plan dashboards.',
      'Live row edits require table and primary-key identity and include before/after RETURNING evidence where supported.',
    ],
    adminFeatures: [
      'Preview VACUUM, ANALYZE, REINDEX, role grant/revoke, extension update/drop, parameterized routine execution, and backend cancel or terminate actions.',
      'Full pg_dump and pg_restore backup compatibility is unavailable because DataPad++ does not invoke external vendor executables.',
    ],
    diagnostics: [
      'Review pg_stat_activity, pg_locks, pg_stat_user_tables, relation/vacuum/index posture, wait or blocking signals, and optional pg_stat_statements top-query data.',
    ],
    importExport: [
      'Use live driver-level PostgreSQL COPY streaming for text, CSV, and binary, with JSON and NDJSON offered as clearly labelled portable conversions.',
      'Existing targets, exact schema/type validation, fail-on-conflict behavior, read-only state, and environment risk are checked before execution; full backup and restore are unavailable.',
    ],
    safety: [
      'Writes, DDL, maintenance, role, extension, and destructive actions stay disabled or preview-first until identity, permissions, and environment guardrails pass.',
    ],
    screenshots: screenshotSet('postgresql'),
  },
  {
    engine: 'cockroachdb',
    slug: 'cockroachdb',
    title: 'CockroachDB',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'CockroachDB uses PostgreSQL-style SQL with distributed database posture, Cockroach Cloud metadata, and preview-first cluster operations.',
    bestFor: ['Distributed SQL', 'Region and locality review', 'Jobs and contention analysis'],
    connections: [
      'Choose CockroachDB and record deployment mode, Cockroach Cloud organization or cluster identity, region, locality, version/build, TLS posture, and capability toggles.',
      'Use profile gates to hide jobs, ranges, regions, diagnostics, certificates, zone configurations, or EXPLAIN ANALYZE surfaces that the connection cannot safely expose.',
    ],
    explorer: [
      'Browse databases, schemas, tables, indexes, regions, jobs, ranges, sessions, contention, roles, certificates, and zone configuration surfaces.',
    ],
    queryModes: [
      'Run read-oriented SQL, SHOW helpers, crdb_internal diagnostic snippets, distributed explain snippets, and bounded table queries.',
      'Cockroach-specific BACKUP, RESTORE, IMPORT, EXPORT, range movement, and job-control statements open as guarded plans.',
    ],
    resultViews: [
      'Inspect SQL result grids, cluster posture payloads, job rows, region/locality details, statement stats, and contention records.',
      'Primary-key row edits follow the SQL identity model when a table target and key predicate are complete.',
    ],
    adminFeatures: [
      'Preview jobs, ranges, regions, sessions, contention, role/grant/default-privilege changes, zone configuration, backup, restore, import, and export workflows.',
    ],
    diagnostics: [
      'Review jobs, ranges, regions/localities, sessions, statement stats, transactions, locks, contention, statistics, certificates, and restricted-surface warnings.',
    ],
    importExport: [
      'Use import, export, backup, and restore planners with external-storage, permission, scan, read-only, environment, and confirmation guardrails.',
    ],
    safety: [
      'Live SQL remains read-oriented; cluster movement, data movement, destructive work, and EXPLAIN ANALYZE DEBUG stay preview-first unless explicitly enabled later.',
    ],
    screenshots: screenshotSet('cockroachdb'),
  },
  {
    engine: 'sqlserver',
    slug: 'sqlserver',
    title: 'SQL Server/Azure SQL',
    aliases: ['SQL Server', 'Azure SQL'],
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'SQL Server and Azure SQL expose TDS SQL, Showplan rendering, Query Store, Extended Events, Agent posture, and guarded table/file workflows.',
    bestFor: ['Corporate SQL systems', 'Query Store review', 'Showplan and DMV diagnostics'],
    connections: [
      'Choose SQL Server, then select SQL login, Windows Integrated, Microsoft Entra, managed identity, service principal, or certificate profile metadata.',
      'Read per-auth-mode disabled reasons when the current runtime cannot execute that credential path directly.',
    ],
    explorer: [
      'Browse databases, schemas, tables, views, procedures, functions, indexes, security, storage, Query Store, Extended Events, Agent, files, and partitions.',
    ],
    queryModes: [
      'Run live TDS SQL, table-scoped SELECTs, SHOWPLAN_TEXT explains, XML Showplan profiles, and Query Store review queries.',
    ],
    resultViews: [
      'Inspect table grids, message panes, Showplan operator tables, Query Store regressions, DMV rows, and primary-key edit evidence.',
    ],
    adminFeatures: [
      'Preview UPDATE STATISTICS, index rebuild/reorganize/disable/enable, Query Store workload review, Agent posture, and restore-package validation.',
    ],
    diagnostics: [
      'Review cached query stats, active requests, waits, file I/O stalls, memory grants, transactions, missing indexes, Extended Events, Agent jobs, and storage/security panels.',
    ],
    importExport: [
      'Use live TDS bulk streaming or guarded server-side BULK INSERT for data transfer. Native .bak backup and restore require a SQL Server-visible destination and restore to a new database by default.',
    ],
    safety: [
      'Native .bak backup/restore is live only for SQL Server-visible destinations and restores to an isolated new database by default. Broader bcp/sqlcmd and live administration remain outside the scoped claim.',
    ],
    screenshots: screenshotSet('sqlserver'),
  },
  {
    engine: 'mysql',
    slug: 'mysql',
    title: 'MySQL',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'MySQL combines live SQL, Workbench-style metadata, performance_schema diagnostics, and guarded table maintenance previews.',
    bestFor: ['MySQL application data', 'Performance schema review', 'Table maintenance planning'],
    connections: [
      'Choose MySQL and configure TCP, Unix socket, Cloud SQL socket, managed metadata, auth-mode metadata, SSL mode, certificate paths, charset, collation, time zone, and timeouts.',
      'Keep cleartext plugin and IAM token auth plan-only until the live runtime proves those credential modes.',
    ],
    explorer: [
      'Browse schemas, tables, views, routines, events, triggers, indexes, users, grants, storage engines, status, and performance_schema areas.',
    ],
    queryModes: [
      'Run live SQL, table SELECT builders, MySQL keyword/function snippets, information_schema helpers, performance_schema helpers, EXPLAIN FORMAT=JSON, and optimizer trace snippets.',
    ],
    resultViews: [
      'Inspect grid results, status counters, statement digest tables, metadata lock details, InnoDB counters, and primary-key row edit evidence.',
    ],
    adminFeatures: [
      'Preview CHECK TABLE, ANALYZE TABLE, OPTIMIZE TABLE, REPAIR TABLE, routine calls, account lock/unlock, event changes, import/export, backup, and restore validation.',
    ],
    diagnostics: [
      'Review processlist waits, statement digests, table/index I/O waits, metadata locks, InnoDB counters, optimizer trace availability, slow-query posture, and replication panels.',
    ],
    importExport: [
      'Use capability-checked LOAD DATA for CSV import and streamed CSV or NDJSON export. Full native backup and restore remain unavailable without external vendor tooling.',
    ],
    safety: [
      'Guarded local/server file loading and streamed export are live where server capability and permissions allow. mysqlpump/mysqldump backup parity, richer grants, restore, and selected administration remain unavailable or separately gated.',
    ],
    screenshots: screenshotSet('mysql'),
  },
  {
    engine: 'mariadb',
    slug: 'mariadb',
    title: 'MariaDB',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'MariaDB shares the MySQL-compatible base and adds MariaDB-specific roles, storage engines, server variables, and ANALYZE FORMAT=JSON workflows.',
    bestFor: ['MariaDB SQL systems', 'Role mapping review', 'Storage-engine diagnostics'],
    connections: [
      'Choose MariaDB and configure host/socket, SSL, charset, collation, time zone, managed metadata, auth posture, and timeout fields.',
    ],
    explorer: [
      'Browse MySQL-compatible objects plus MariaDB role mappings, server variables, storage engines, Aria metrics, routines, events, and security surfaces.',
    ],
    queryModes: [
      'Run live SQL, SELECT builders, MariaDB-specific keyword/status snippets, EXPLAIN FORMAT=JSON, guarded ANALYZE FORMAT=JSON, and routine helpers.',
    ],
    resultViews: [
      'Inspect grid results, JSON analyze profiles, server-variable panels, role mappings, storage-engine posture, and primary-key row edit evidence.',
    ],
    adminFeatures: [
      'Preview check, analyze, optimize, repair, scheduled event enable/disable, user lock/unlock, role/security changes, import/export, backup, and restore validation.',
    ],
    diagnostics: [
      'Review status counters, processlist waits, metadata locks, statement digests, storage-engine details, role security, Aria metrics, and optimizer trace availability.',
    ],
    importExport: [
      'Use capability-checked MariaDB LOAD DATA for CSV import and streamed CSV or NDJSON export. Full native backup and restore remain unavailable without external vendor tooling.',
    ],
    safety: [
      'Guarded local/server file loading and streamed export are live where MariaDB capability and permissions allow. mariadb-dump backup parity, richer roles/grants, restore, and broader administration remain unavailable or separately gated.',
    ],
    screenshots: screenshotSet('mariadb'),
  },
  {
    engine: 'sqlite',
    slug: 'sqlite',
    title: 'SQLite',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'SQLite is treated as a local-file workbench with file posture, PRAGMA health, integrity checks, guarded VACUUM INTO, and table import/export.',
    bestFor: ['Local database files', 'Embedded app data', 'Portable data inspection'],
    connections: [
      'Choose SQLite and select a local database file, read-only posture, attached database behavior, and timeout or locking expectations.',
      'Check file existence, write permissions, read-only state, and lock warnings before saving the profile.',
    ],
    explorer: [
      'Browse attached databases, schemas, tables, views, columns, indexes, triggers, generated columns, virtual tables, and PRAGMA health panels.',
    ],
    queryModes: [
      'Run raw SQLite SQL, table SELECT builders, PRAGMA helpers, integrity-check helpers, and focused local-file metadata queries.',
    ],
    resultViews: [
      'Inspect table grids, raw payloads, PRAGMA results, integrity-check messages, and primary-key row edit evidence when the table target is complete.',
    ],
    adminFeatures: [
      'Preview check, analyze, optimize, vacuum, reindex, local file backup, and table import/export operations with file and environment guardrails.',
    ],
    diagnostics: [
      'Review file posture, attached databases, indexes, triggers, virtual tables, generated columns, PRAGMA health, and integrity-check status.',
    ],
    importExport: [
      'Use guarded VACUUM INTO backup plus CSV, JSON, and NDJSON table or view export and table import.',
    ],
    safety: [
      'Local file writes require clear file identity, writable posture, no conflicting read-only setting, and explicit confirmation for lock-heavy or destructive maintenance.',
    ],
    screenshots: screenshotSet('sqlite'),
  },
  {
    engine: 'oracle',
    slug: 'oracle',
    title: 'Oracle',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'Oracle 19c+ uses a bundled managed driver for live SQL and PL/SQL, schema and package inspection, DBMS output, plans, and guarded writes.',
    bestFor: ['Oracle schemas', 'Package and storage review', 'SQL and PL/SQL development'],
    connections: [
      'Configure a service name, SID, Easy Connect string, TNS alias, or TCPS/cloud-wallet profile with the required username, proxy user, role, and timeout options.',
      'The desktop app includes its Oracle runtime. Oracle Client, SQLPlus, Docker, and a separate .NET installation are not required; SQLPlus remains an explicit legacy fallback.',
    ],
    explorer: [
      'Browse live schemas, tables and columns, views, materialized views, packages and routines, types, sequences, synonyms, links, constraints, indexes, triggers, storage, security, performance, and permission-aware dictionary details.',
    ],
    queryModes: [
      'Run SQL, DML, DDL, MERGE, procedure calls, transaction control, and multi-statement PL/SQL scripts, with bounded reads, DBMS output, explain, and profile results.',
    ],
    resultViews: [
      'Inspect table, JSON, raw status, affected-row, multiple-result, DBMS output, DBMS_XPLAN, profile, package metadata, and edit-evidence views.',
    ],
    adminFeatures: [
      'Preview schema/package operations, storage and security reviews, import/export plans, RMAN boundary plans, and restore-sensitive workflows.',
    ],
    diagnostics: [
      'Review DBMS_XPLAN, SQL Monitor availability, PL/SQL compile diagnostics, storage posture, security posture, restricted dictionary warnings, and row identity checks.',
    ],
    importExport: [
      'Use managed-driver CSV table transfer for existing empty targets. Data Pump backup/restore is live through server DIRECTORY objects and guarded DBMS_DATAPUMP jobs; physical RMAN backup remains unavailable.',
    ],
    safety: [
      'Writes, destructive SQL, PL/SQL, calls, SELECT FOR UPDATE, and administrative statements use the same environment and read-only guardrails across the UI, API, and MCP server.',
    ],
    screenshots: screenshotSet('oracle'),
  },
  {
    engine: 'timescaledb',
    slug: 'timescaledb',
    title: 'TimescaleDB',
    family: 'SQL and relational',
    maturity: 'Available',
    summary:
      'TimescaleDB builds on PostgreSQL with hypertables, chunks, compression, retention, continuous aggregates, jobs, Toolkit checks, and time-bucket dashboards.',
    bestFor: ['Time-series SQL', 'Hypertable diagnostics', 'Compression and retention planning'],
    connections: [
      'Choose TimescaleDB and configure PostgreSQL-wire fields plus deployment/profile metadata, extension visibility, restricted catalog gates, and query-window defaults.',
    ],
    explorer: [
      'Browse PostgreSQL schemas plus hypertables, chunks, compression policies, retention policies, continuous aggregates, jobs, Toolkit posture, and Timescale-specific diagnostics.',
    ],
    queryModes: [
      'Run scoped SQL, hypertable reads, continuous aggregate reads, time_bucket helpers, Toolkit-aware snippets, EXPLAIN/profile views, and query-window dashboards.',
    ],
    resultViews: [
      'Inspect table grids, time-bucket output, chunk-sizing views, compression coverage, aggregate freshness, job history, and PostgreSQL-style row edit evidence.',
    ],
    adminFeatures: [
      'Preview compression, retention, continuous aggregate refresh, job control, policy changes, import/export, backup, and restore workflows.',
    ],
    diagnostics: [
      'Review extension/catalog metadata, profile posture, hypertable volume, chunks, compression coverage, aggregate lag, failed jobs, Toolkit availability, and restricted-role warnings.',
    ],
    importExport: [
      'Use live PostgreSQL COPY streaming with Timescale-aware hypertable, time-column, chunk-routing, and time-window validation. Full native backup and restore remain unavailable without PostgreSQL backup tools.',
    ],
    safety: [
      'Timescale-aware COPY import/export is live after hypertable and time-dimension validation. Native full backup/restore and policy/job-control mutation remain unavailable or separately gated.',
    ],
    screenshots: screenshotSet('timescaledb'),
  },
  {
    engine: 'mongodb',
    slug: 'mongodb',
    title: 'MongoDB',
    family: 'Document and NoSQL',
    maturity: 'Available',
    summary:
      'MongoDB uses a document-first workbench with collection builders, aggregation helpers, explain dashboards, diagnostics, and guarded document edits.',
    bestFor: ['Document collections', 'Aggregation workflows', 'Schema and index inspection'],
    connections: [
      'Choose MongoDB and configure URI or native host fields, database discovery, TLS/read preference metadata, auth source, and read-only posture.',
      'Test connectivity and confirm Atlas, replica, shard, TLS, and permission warnings before saving long-lived profiles.',
    ],
    explorer: [
      'Browse databases, collections, views, GridFS buckets/files, indexes, validation rules, schema previews, users, roles, statistics, and collection actions.',
    ],
    queryModes: [
      'Use find builder, raw command JSON, aggregation work, and sandboxed mongosh-style JavaScript with CRUD, bulk, transaction, index, collection, command, BSON, and output APIs.',
      'Script mode adds JavaScript and live metadata IntelliSense plus a searchable, resizable guide whose examples insert at the cursor without executing.',
    ],
    resultViews: [
      'Inspect expandable document rows, raw JSON/BSON views, field side panels, efficiency mode for large nested documents, and local document search.',
      'Document insert, replace, delete, and field set/unset/rename/type-change edits require collection and document identity plus environment guardrails.',
    ],
    adminFeatures: [
      'Review index management, validation views, GridFS tools, schema previews, document insert/upload workflows, users, roles, and guarded bulk-write previews.',
    ],
    diagnostics: [
      'Review explain dashboards, profiler data, current operations, replica posture, shard posture, index usage, database statistics, and performance payloads.',
    ],
    importExport: [
      'Use guarded JSON, Extended JSON, NDJSON, CSV, and BSON collection import/export workflows with browser preview staying plan-only.',
    ],
    safety: [
      'Live document and script mutations require read-only and environment checks; destructive, administrative, unknown-command, and write scripts require confirmation before the first mutation.',
      'The embedded JavaScript runtime has bounded memory, stack, CPU, operations, output, timeout, and cancellation, with no filesystem, process, module-loading, eval, or arbitrary network access.',
    ],
    screenshots: screenshotSet('mongodb'),
  },
  {
    engine: 'dynamodb',
    slug: 'dynamodb',
    title: 'DynamoDB',
    family: 'Document and NoSQL',
    maturity: 'Available',
    summary:
      'DynamoDB exposes typed endpoint and credential flows, table/key/index metadata, read-only PartiQL, capacity signals, and guarded conditional item operations.',
    bestFor: ['AWS table inspection', 'Development tables', 'Capacity and key-condition workflows'],
    connections: [
      'Choose DynamoDB and configure local endpoint or AWS credential mode, region, profile, assume-role, web identity, ECS/EC2 metadata posture, retry settings, and capacity preferences.',
      'Use endpointUrl routing and SigV4-shaped headers for local or endpoint-override profiles before trying optional AWS validation.',
    ],
    explorer: [
      'Browse tables, partition and sort keys, GSIs, LSIs, TTL, streams, backups, capacity, alarms, hot partitions, index coverage, access metadata, and item edit targets.',
    ],
    queryModes: [
      'Use Query, GetItem, Scan, DescribeTable, raw JSON requests, expression helpers, key-condition builders, projection/filter helpers, and guarded read-only PartiQL ExecuteStatement.',
    ],
    resultViews: [
      'Inspect item tables, raw attribute JSON, capacity and pagination signals, key metadata, and before/after GetItem evidence for conditional item edits.',
    ],
    adminFeatures: [
      'Preview throughput changes, GSI changes, TTL and stream changes, access checks, backup/restore, export/import, delete table, and cloud metadata operations.',
    ],
    diagnostics: [
      'Review consumed capacity, pagination, table metadata, hot partition posture, TTL/stream state, backup posture, alarms, CloudWatch/IAM optional checks, and access previews.',
    ],
    importExport: [
      'Use guarded table export/import previews; S3 import/export and cloud backup execution remain separately gated.',
    ],
    safety: [
      'Writes require complete keys and conditional guards; cloud, destructive, table movement, IAM, and backup operations stay preview-first unless explicitly validated.',
    ],
    screenshots: screenshotSet('dynamodb'),
  },
  {
    engine: 'cassandra',
    slug: 'cassandra',
    title: 'Cassandra',
    family: 'Document and NoSQL',
    maturity: 'Available for CQL reads; writes and administration are guarded',
    summary:
      'Cassandra runs bounded CQL reads over the native binary protocol and adds partition-key query helpers, tracing, storage health, grants, and snapshot/import/export planning.',
    bestFor: ['Wide-column schemas', 'Partition-key reads', 'Tracing and storage posture'],
    connections: [
      'Choose Cassandra and configure contact points, keyspace, secure bundle, TLS, consistency, retry, load balancing, authentication, and timeout posture.',
    ],
    explorer: [
      'Browse keyspaces, tables, primary keys, clustering columns, indexes, materialized views, grants, partition posture, storage posture, tombstone posture, and diagnostics.',
    ],
    queryModes: [
      'Run live CQL reads with partition-key builders, deterministic Cassandra IntelliSense, bounded SELECT results, and native tracing identifiers.',
    ],
    resultViews: [
      'Inspect table-like CQL results, partition metadata, primary-key targets, tracing payloads, storage warnings, and raw CQL details.',
    ],
    adminFeatures: [
      'Preview grants, index and materialized-view operations, external-tool snapshot boundaries, and guarded row edit plans. Native CQL JSON Lines transfer uses the driver rather than cqlsh.',
    ],
    diagnostics: [
      'Review tracing, partition health, storage health, tombstones, index posture, cluster settings, grants, and driver or secure-bundle disabled reasons.',
    ],
    importExport: [
      'Use live paged SELECT JSON export and prepared INSERT JSON IF NOT EXISTS import with key/type/TTL validation. SSTable and full snapshot backup remain unavailable without external tooling.',
    ],
    safety: [
      'Native reads share bounded result and read-only guardrails; mutations remain preview-first until complete primary-key conditions and write boundaries are validated.',
    ],
    screenshots: screenshotSet('cassandra'),
  },
  {
    engine: 'cosmosdb',
    slug: 'cosmosdb',
    title: 'Cosmos DB',
    family: 'Document and NoSQL',
    maturity: 'Available for NoSQL queries; cloud administration is guarded',
    summary:
      'Cosmos DB supports parameterized SQL API reads with a visual NoSQL builder and bounded continuation-token paging, plus a native GraphSON v2 Gremlin WebSocket runtime with Cosmos authentication, bounded graph results, and request-charge metrics.',
    bestFor: ['Cosmos SQL API containers', 'Cosmos Gremlin graphs', 'RU throughput review'],
    connections: [
      'Choose Cosmos DB and configure account endpoint, database, credential mode, API flavor, preferred regions, consistency expectations, timeout, and read-only posture. Gremlin profiles also select the graph, Gremlin endpoint, and traversal source.',
    ],
    explorer: [
      'Browse databases, containers, partition keys, indexing policies, throughput, consistency, regions, access, diagnostics, and API-specific native branches.',
    ],
    queryModes: [
      'Build Cosmos SQL reads visually with fields, typed filters, AND/OR logic, sorting, offset/limit, partition routing, and exact Count, or run live Gremlin traversals. NoSQL paging is cancellable and session-aware; Gremlin responses aggregate partial GraphSON messages into bounded graph, object, table, JSON, profile, and metrics views.',
    ],
    resultViews: [
      'Inspect document rows or normalized graph nodes and edges, raw JSON, RU/query metrics, opaque continuation state or partial-response signals, partition metadata, and container posture cards.',
    ],
    adminFeatures: [
      'Preview throughput changes, indexing policy changes, consistency changes, failover, access checks, exports, imports, and guarded container drops.',
    ],
    diagnostics: [
      'Review RU consumption, query metrics, indexing posture, region/failover posture, consistency, partition-key shape, access, and API disabled reasons.',
    ],
    importExport: [
      'Use export/import previews for containers with partition-key, RU, file path, overwrite, and cloud cost guardrails.',
    ],
    safety: [
      'Gremlin mutations use the shared environment and read-only guardrails. Throughput, region failover, drops, and broad data movement remain preview-first until credential-gated cloud validation passes.',
    ],
    screenshots: screenshotSet('cosmosdb'),
  },
  {
    engine: 'litedb',
    slug: 'litedb',
    title: 'LiteDB',
    family: 'Document and NoSQL',
    maturity: 'Available with the bundled LiteDB service',
    summary:
      'LiteDB is documented as a local document-file workflow with collection metadata, index and file storage panels, sidecar boundaries, and guarded local management.',
    bestFor: ['Local document files', 'Embedded .NET data', 'Sidecar-backed validation'],
    connections: [
      'Choose LiteDB and select the local file, encryption posture, optional sidecar path, read-only mode, timeout, and lock-boundary expectations.',
    ],
    explorer: [
      'Browse collections, inferred schema previews, indexes, file storage, storage health, local-file preflight state, encryption posture, lock-boundary posture, and settings.',
    ],
    queryModes: [
      'Use LiteDB JSON operation previews, deterministic collection/field IntelliSense, bounded find snippets, and sidecar-backed read dispatch where configured.',
    ],
    resultViews: [
      'Inspect document rows, raw JSON, collection statistics, sidecar response metadata, open-failure details, timeout details, and redacted local-file diagnostics.',
    ],
    adminFeatures: [
      'Preview health checks, checkpoint, compact, index rebuild, backup/export, collection drops, and sidecar-only full-document CRUD plans.',
    ],
    diagnostics: [
      'Review local file preflight, encryption and lock-boundary metadata, sidecar availability, storage health, index posture, and optional .NET engine validation evidence.',
    ],
    importExport: [
      'Use the bundled sidecar for live Extended JSON collection transfer, guarded document edits, FileStorage operations, and coordinated full-file backup/restore under the writer lock.',
    ],
    safety: [
      'Live document editing requires an explicitly configured LiteDB sidecar and remains guarded by file identity, read-only posture, encryption, lock, and _id mismatch checks.',
    ],
    screenshots: screenshotSet('litedb'),
  },
  {
    engine: 'redis',
    slug: 'redis',
    title: 'Redis',
    family: 'Key-value and cache',
    maturity: 'Available',
    summary:
      'Redis opens in a native key browser with type-aware results, console mode, Redis Stack capability gates, live guarded key edits, and file import/export workflows.',
    bestFor: ['Cache inspection', 'Streams and ACL review', 'Redis Stack-aware key workflows'],
    connections: [
      'Choose Redis and configure host, port, TLS, logical database, username/password or ACL posture, module capability metadata, timeout, and read-only mode.',
      'Use connection tests and COMMAND INFO metadata to decide which Redis Stack panels and module operations are visible.',
    ],
    explorer: [
      'Browse logical databases, type folders, keys, TTL, memory, encoding, streams, consumer groups, Pub/Sub, ACLs, slowlog, latency, memory, clients, persistence, replication, cluster, Sentinel, Lua, functions, and module panels.',
    ],
    queryModes: [
      'Start in key browser mode with pattern/type filters, tree/list views, scan progress, Scan more, and refresh; switch to Redis console for precise commands.',
      'Use IntelliSense for read commands, known keys, namespace prefixes, SCAN options, ranges, counts, JSON paths, TimeSeries, vector, INFO, and COMMAND INFO metadata.',
    ],
    resultViews: [
      'Inspect strings, hashes, lists, sets, sorted sets, streams, RedisJSON, TimeSeries, vector sets, TTL, memory, encoding, length, raw payloads, and before/after key metadata.',
    ],
    adminFeatures: [
      'Use guarded key add/edit/delete/rename/TTL workflows, stream entry add/delete, RedisJSON path edits, TimeSeries sample edits, vector member edits, ACL reviews, slowlog, function and script panels, and cluster/Sentinel diagnostics.',
    ],
    diagnostics: [
      'Review INFO sections, command stats, slowlog rows, latency samples, memory stats, clients, Pub/Sub, ACLs, persistence, replication, cluster, Sentinel, Lua scripts, and functions.',
    ],
    importExport: [
      'Use guarded JSON/NDJSON file workflows for core types, RedisJSON, TimeSeries, vector sets, and DUMP/RESTORE snapshot envelopes for opaque module values.',
    ],
    safety: [
      'Live edits require concrete key identity, type checks, read-only gates, environment confirmation, and capability metadata; unsupported module actions stay disabled or preview-first.',
    ],
    screenshots: screenshotSet('redis'),
  },
  {
    engine: 'valkey',
    slug: 'valkey',
    title: 'Valkey',
    family: 'Key-value and cache',
    maturity: 'Available',
    summary:
      'Valkey uses the Redis-compatible core workflow while hiding Redis Stack/vector-only surfaces unless compatible metadata proves support.',
    bestFor: ['Valkey key inspection', 'Core Redis-compatible operations', 'Read-safe cache workflows'],
    connections: [
      'Choose Valkey and configure host, port, TLS, logical database, username/password or ACL posture, timeout, and read-only mode with Valkey-specific labeling.',
    ],
    explorer: [
      'Browse logical databases, type folders, keys, TTL, memory, encoding, streams, ACL/security, Pub/Sub, cluster/Sentinel-like topology where compatible, INFO, persistence, replication, and diagnostics.',
    ],
    queryModes: [
      'Use key browser mode first, filter by pattern/type, scan incrementally, and switch to console mode for Redis-compatible commands.',
    ],
    resultViews: [
      'Inspect strings, hashes, lists, sets, sorted sets, streams, TTL, memory, encoding, length, raw values, and before/after key metadata for guarded changes.',
    ],
    adminFeatures: [
      'Use guarded core key/member edits, stream entry actions, TTL changes, delete/rename workflows, ACL reviews, slowlog, INFO, persistence, and replication panels.',
    ],
    diagnostics: [
      'Review INFO, command stats, memory, latency, clients, slowlog, ACLs, persistence, replication, and Valkey-specific disabled reasons.',
    ],
    importExport: [
      'Use guarded JSON/NDJSON file workflows for core Redis-compatible strings, hashes, lists, sets, sorted sets, and streams; Redis Stack module formats stay gated.',
    ],
    safety: [
      'Redis Stack module actions, vector-only actions, and unsupported module file formats remain hidden or disabled unless compatible live metadata proves support.',
    ],
    screenshots: screenshotSet('valkey'),
  },
  {
    engine: 'memcached',
    slug: 'memcached',
    title: 'Memcached',
    family: 'Key-value and cache',
    maturity: 'Available for known-key reads; broad enumeration is unavailable',
    summary:
      'Memcached is documented around known-key operations and server diagnostics because it has no portable native key browser.',
    bestFor: ['Cache server diagnostics', 'Known-key reads', 'Slab and item-class review'],
    connections: [
      'Choose Memcached and configure host, port, timeout, SASL or credential posture where supported, known-key hints, and read-only mode.',
    ],
    explorer: [
      'Browse stats, slabs, item classes, settings, connections, cache diagnostics, and known-key action targets instead of fake key lists.',
    ],
    queryModes: [
      'Use deterministic command IntelliSense for stats, known-key get/gets, CAS reads, set/touch/incr/decr/delete previews, slab/item-class targets, and guarded write snippets.',
    ],
    resultViews: [
      'Inspect stats tables, slab/item-class rows, setting rows, connection pressure, known-key values, CAS metadata, and raw text responses.',
    ],
    adminFeatures: [
      'Preview stats reset, flush, LRU crawler metadata dumps, known-key set/touch/increment/decrement/delete, and cache management plans.',
    ],
    diagnostics: [
      'Review server stats, slabs, item classes, settings, connections, LRU crawler metadata, memory pressure, hit/miss posture, and cache diagnostics.',
    ],
    importExport: [
      'Use known-key and metadata dump previews; broad cache import/export is intentionally limited by Memcached keyspace visibility.',
    ],
    safety: [
      'Flush, mutation, and broad dump operations remain guarded previews unless a concrete key or server operation has explicit confirmation and environment clearance.',
    ],
    screenshots: screenshotSet('memcached'),
  },
  {
    engine: 'elasticsearch',
    slug: 'elasticsearch',
    title: 'Elasticsearch',
    family: 'Search',
    maturity: 'Available',
    summary:
      'Elasticsearch focuses on search DSL builders, mappings, shard/profile diagnostics, explicit-id document edits, and guarded index/admin previews.',
    bestFor: ['Search indexes', 'Query DSL and aggregations', 'Shard and profile diagnostics'],
    connections: [
      'Choose Elasticsearch and configure HTTP endpoint, Elastic Cloud metadata, API key posture, TLS, default index, timeout, and read-only profile settings.',
      'Read disabled reasons for HTTPS/cloud/token/TLS profiles when the current plain-HTTP scoped runtime cannot execute them.',
    ],
    explorer: [
      'Browse indexes, mappings, aliases, data streams, field capabilities, shard health, lifecycle state, search result structures, templates, pipelines, and diagnostics.',
    ],
    queryModes: [
      'Use visual Query DSL helpers for filters, source fields, sorting, terms/date-histogram/histogram/metric/cardinality aggregations, raw DSL, profile, and explain payloads.',
    ],
    resultViews: [
      'Inspect hits, _source documents, highlights, aggregations, profile stages, shard details, raw JSON, and explicit-id document edit evidence.',
    ],
    adminFeatures: [
      'Preview force merge, cache clear, reindex, open/close, mappings, settings, aliases, templates, pipelines, rollover, lifecycle policy, task cancel, snapshot/restore, bulk, security, slow-log, and allocation workflows.',
    ],
    diagnostics: [
      'Review cluster health, field capabilities, shard health, Lucene segments, lifecycle state, ingestion posture, security posture, slow-log settings, allocation, and normalized profile stages.',
    ],
    importExport: [
      'Use live PIT/search-after export, conflict-safe Bulk import into a rollback-safe index, and repository-backed snapshot/restore where the connected cluster supports them.',
    ],
    safety: [
      'Managed cloud auth and broader destructive administration remain separately gated; transfer and snapshot execution still require compatible versions, repositories, permissions, and guarded destinations.',
    ],
    screenshots: screenshotSet('elasticsearch'),
  },
  {
    engine: 'opensearch',
    slug: 'opensearch',
    title: 'OpenSearch',
    family: 'Search',
    maturity: 'Available',
    summary:
      'OpenSearch mirrors scoped search workflows and adds OpenSearch-specific SQL, ISM, security, and Performance Analyzer boundaries.',
    bestFor: ['OpenSearch indexes', 'ISM and security review', 'Search DSL diagnostics'],
    connections: [
      'Choose OpenSearch and configure HTTP endpoint, managed OpenSearch metadata, AWS SigV4 posture, API key or credential mode, TLS, default index, timeout, and read-only settings.',
      'Read explicit disabled reasons for managed SigV4/IAM, HTTPS/cloud/token/TLS, SQL plugin, and Performance Analyzer execution boundaries.',
    ],
    explorer: [
      'Browse indexes, mappings, aliases, data streams, shards, field capabilities, ISM/lifecycle state, security posture, search result structures, and diagnostics.',
    ],
    queryModes: [
      'Use visual Query DSL helpers, raw DSL, aggregation helpers, profile/explain payloads, and OpenSearch-specific SQL or plugin surfaces only where available.',
    ],
    resultViews: [
      'Inspect hits, source documents, highlights, aggregations, profile stages, shard details, OpenSearch SQL boundary payloads, and explicit-id edit evidence.',
    ],
    adminFeatures: [
      'Preview force merge, cache clear, reindex, open/close, mapping/settings, alias/template/pipeline, rollover, ISM, task cancel, snapshot/restore, bulk, security, slow-log, and allocation workflows.',
    ],
    diagnostics: [
      'Review cluster health, shard/allocation diagnostics, slow-log settings, normalized profile stages, SQL plugin boundaries, ISM state, security posture, and Performance Analyzer boundaries.',
    ],
    importExport: [
      'Use version-compatible scroll/PIT export, conflict-safe Bulk import into a rollback-safe index, and repository-backed snapshot/restore after OpenSearch capability checks.',
    ],
    safety: [
      'Managed SigV4/IAM execution, OpenSearch SQL plugins, Performance Analyzer, and broader administration remain optional; snapshot execution requires a compatible repository and permissions.',
    ],
    screenshots: screenshotSet('opensearch'),
  },
  {
    engine: 'clickhouse',
    slug: 'clickhouse',
    title: 'ClickHouse',
    family: 'Warehouse and analytical',
    maturity: 'Available for HTTP SQL and transfers',
    summary:
      'ClickHouse is documented as a warehouse-style SQL surface with MergeTree, query-log, cluster, TTL, optimize, freeze, metrics, and import/export previews.',
    bestFor: ['Analytical SQL', 'MergeTree posture', 'Query-log diagnostics'],
    connections: [
      'Choose ClickHouse and configure endpoint, database, user, password, TLS, compression or HTTP/native posture, timeout, row limits, and read-only mode.',
    ],
    explorer: [
      'Browse databases, schemas, tables, views, MergeTree parts, replicas, dictionaries, clusters, query logs, TTL posture, access, metrics, and diagnostics.',
    ],
    queryModes: [
      'Run scoped ClickHouse SQL, SELECT builders, deterministic SQL IntelliSense, bounded query starts, dry-run style previews, and table-focused reads.',
    ],
    resultViews: [
      'Inspect analytical grids, query-log rows, MergeTree part details, replica posture, metrics payloads, raw JSON/text, and cost or scan warnings.',
    ],
    adminFeatures: [
      'Preview OPTIMIZE, TTL materialization, FREEZE snapshots, table clone/copy, access changes, query cancellation, import/export, and cluster-sensitive operations.',
    ],
    diagnostics: [
      'Review system query logs, MergeTree parts, replicas, cluster posture, storage, compute, access, metrics, TTL state, and query cost or scan posture.',
    ],
    importExport: [
      'Use live SELECT/INSERT FORMAT streaming for supported CSV, TSV, JSONEachRow, and Parquet data, plus server-configured native backup/restore archives.',
    ],
    safety: [
      'Broad mutations, OPTIMIZE/FREEZE execution, cluster changes, destructive table operations, and large exports remain preview-first unless adapter execution is validated.',
    ],
    screenshots: screenshotSet('clickhouse'),
  },
  {
    engine: 'duckdb',
    slug: 'duckdb',
    title: 'DuckDB',
    family: 'Warehouse and analytical',
    maturity: 'Available',
    summary:
      'DuckDB is a local-file analytics workbench with local read SQL, EXPLAIN/profile rendering, extension posture, CSV import/export, and backup-folder execution.',
    bestFor: ['Local analytics files', 'CSV and embedded OLAP', 'EXPLAIN/profile review'],
    connections: [
      'Choose DuckDB and configure local database file or in-memory profile, read-only mode, extension posture, file-source boundaries, timeout, and row limits.',
      'Check database-file preflight, writable posture, lock boundaries, and JSON/Parquet extension gates before enabling file workflows.',
    ],
    explorer: [
      'Browse schemas, tables, views, columns, extensions, external file sources, PRAGMAs, local file posture, extension posture, and object/admin-scope gates.',
    ],
    queryModes: [
      'Run bundled local-file read SQL, SELECT builders, deterministic DuckDB IntelliSense, EXPLAIN, EXPLAIN ANALYZE, and catalog queries.',
    ],
    resultViews: [
      'Inspect table grids, EXPLAIN/profile payloads, catalog rows, local-file posture, extension warnings, and file workflow lock-boundary metadata.',
    ],
    adminFeatures: [
      'Preview analyze/checkpoint/object admin actions, extension install/load gates, restore-package preflight, and broader local OLAP mutation/admin boundaries.',
    ],
    diagnostics: [
      'Review database-file preflight, read-only state, scoped lock boundaries, PRAGMA panels, extension posture, JSON/Parquet preloaded-extension gates, and restore boundaries.',
    ],
    importExport: [
      'Use live native COPY for CSV, JSON, and Parquet plus database backup/restore into a new isolated file. Format availability still follows loaded extension capability.',
    ],
    safety: [
      'Broad administration and extension install/load remain separate boundaries; restore is live only into a new isolated database file after validation.',
    ],
    screenshots: screenshotSet('duckdb'),
  },
  {
    engine: 'snowflake',
    slug: 'snowflake',
    title: 'Snowflake',
    family: 'Warehouse and analytical',
    maturity: 'Available for InfluxDB 1.x queries and line-protocol transfers',
    summary:
      'Snowflake is documented as a SQL-first warehouse workflow with account/project posture, query history, credits, warehouses, stages, shares, and clone/copy previews.',
    bestFor: ['Cloud warehouse review', 'Credit and warehouse posture', 'Query history analysis'],
    connections: [
      'Choose Snowflake and configure account, region, database, schema, warehouse, role, auth mode, network/TLS posture, timeout, row limits, and read-only mode.',
    ],
    explorer: [
      'Browse databases, schemas, tables, views, stages, warehouses, jobs/query history, shares, streams, tasks, roles, grants, storage, compute, and diagnostics.',
    ],
    queryModes: [
      'Run scoped Snowflake SQL, table SELECT builders, deterministic SQL IntelliSense, bounded query starts, query history helpers, and cost-aware previews.',
    ],
    resultViews: [
      'Inspect result grids, query-history rows, credit usage, warehouse load, storage posture, access details, raw SQL messages, and scan/cost warnings.',
    ],
    adminFeatures: [
      'Preview warehouse suspend/resume, clone/copy, stage workflows, grants, role changes, import/export, unload/load, and guarded drop plans.',
    ],
    diagnostics: [
      'Review query history, credit usage, warehouse load, utilization, storage/compute posture, access, shares, stages, reservations-like posture, and cost signals.',
    ],
    importExport: [
      'Use cloud import/export and stage workflow previews with cost, path, overwrite, role, and environment guardrails.',
    ],
    safety: [
      'Warehouse state changes, role/grant changes, large exports, drops, and cloud file workflows remain preview-first unless live execution is explicitly validated.',
    ],
    screenshots: screenshotSet('snowflake'),
  },
  {
    engine: 'bigquery',
    slug: 'bigquery',
    title: 'BigQuery',
    family: 'Warehouse and analytical',
    maturity: 'Available for Prometheus HTTP queries and bounded exports',
    summary:
      'BigQuery uses GoogleSQL, project/dataset/table metadata, dry-run estimates, job timelines, slot and reservation posture, and guarded cloud-operation previews.',
    bestFor: ['GoogleSQL analytics', 'Dry-run cost estimates', 'Job and reservation review'],
    connections: [
      'Choose BigQuery and configure project, dataset, location, auth mode, service-account or OAuth posture, timeout, row limit, dry-run preference, and read-only mode.',
    ],
    explorer: [
      'Browse projects, datasets, tables, views, jobs, reservations, scheduled queries, copy jobs, access, storage, slots, and diagnostics.',
    ],
    queryModes: [
      'Run scoped GoogleSQL, table SELECT builders, deterministic IntelliSense, bounded query starts, dry-run request payloads, and job-aware query previews.',
    ],
    resultViews: [
      'Inspect result grids, dry-run totalBytesProcessed, job timeline rows, slot usage, reservation posture, raw REST payloads, and cost warnings.',
    ],
    adminFeatures: [
      'Preview table copy/clone, scheduled query, reservation, access, cloud import/export, load/unload, and guarded drop workflows.',
    ],
    diagnostics: [
      'Review jobs, job timelines, slot usage, reservations, cost/storage posture, access, dry-run estimates, scheduled queries, and cloud auth disabled reasons.',
    ],
    importExport: [
      'Use cloud import/export previews with dataset/table identity, location, cost, permissions, file path, overwrite, and environment guardrails.',
    ],
    safety: [
      'Writes, DDL, export, and administrative statements remain preview/dry-run only in the adapter phase unless live cloud execution is configured and validated.',
    ],
    screenshots: screenshotSet('bigquery'),
  },
  {
    engine: 'influxdb',
    slug: 'influxdb',
    title: 'InfluxDB',
    family: 'Time-series and metrics',
    maturity: 'Available for OpenTSDB HTTP queries and bounded exports',
    summary:
      'InfluxDB keeps org, bucket, token, tag, field, retention, cardinality, Flux/InfluxQL, and chart-ready result context visible.',
    bestFor: ['Time-series buckets', 'Flux or InfluxQL reads', 'Retention and cardinality review'],
    connections: [
      'Choose InfluxDB and configure endpoint, organization, bucket, token posture, API version, TLS, tenant headers, default query range, timeout, and read-only mode.',
    ],
    explorer: [
      'Browse orgs, buckets, measurements, tags, fields, retention policies, tasks, authorization posture, cardinality surfaces, and diagnostics.',
    ],
    queryModes: [
      'Use Flux, InfluxQL, metric/tag builders, deterministic measurement/tag/function IntelliSense, bounded time ranges, and profile payload previews.',
    ],
    resultViews: [
      'Inspect chart-ready time-series rows, table results, tag/field metadata, raw line/protocol-like payloads, cardinality warnings, and retention posture.',
    ],
    adminFeatures: [
      'Preview retention, bucket/task changes, authorization review, cardinality operations, API export, and guarded metadata-operation plans.',
    ],
    diagnostics: [
      'Review metrics/stats, retention posture, cardinality, bucket health, auth/access posture, task state, API profile payloads, and query-window warnings.',
    ],
    importExport: [
      'Use API export previews and metadata-operation previews with time range, bucket, path, cost, and environment guardrails.',
    ],
    safety: [
      'Broad writes, retention changes, bucket changes, auth changes, and high-cardinality operations stay preview-first unless adapter-owned execution is validated.',
    ],
    screenshots: screenshotSet('influxdb'),
  },
  {
    engine: 'prometheus',
    slug: 'prometheus',
    title: 'Prometheus',
    family: 'Time-series and metrics',
    maturity: 'Preview',
    summary:
      'Prometheus focuses on endpoints, metric and label discovery, PromQL, targets, rules, chart-ready results, cardinality, retention, and guarded metadata previews.',
    bestFor: ['PromQL exploration', 'Metrics and labels', 'Targets and rules review'],
    connections: [
      'Choose Prometheus and configure endpoint, auth headers, tenant headers, TLS posture, default range/step, timeout, and read-only mode.',
    ],
    explorer: [
      'Browse metrics, labels, label values, targets, rules, alerts, scrape posture, retention posture, cardinality surfaces, access, and diagnostics.',
    ],
    queryModes: [
      'Use PromQL editors, metric/label builders, deterministic PromQL IntelliSense, bounded ranges, instant/range query modes, and profile or metadata previews.',
    ],
    resultViews: [
      'Inspect chart-ready vectors and matrices, label sets, sample tables, target/rule payloads, raw JSON, range warnings, and cardinality signals.',
    ],
    adminFeatures: [
      'Preview metadata operations, target/rule review actions, retention/cardinality checks, API export, and guarded profile workflows.',
    ],
    diagnostics: [
      'Review targets, scrape health, rules, alerts, metrics/stats, retention posture, cardinality, access posture, and query range/step warnings.',
    ],
    importExport: [
      'Use API export previews for selected metric ranges with range, label, path, size, and environment guardrails.',
    ],
    safety: [
      'Prometheus is read-oriented in this scope; broad exports, expensive ranges, metadata operations, and write/admin actions remain guarded previews.',
    ],
    screenshots: screenshotSet('prometheus'),
  },
  {
    engine: 'opentsdb',
    slug: 'opentsdb',
    title: 'OpenTSDB',
    family: 'Time-series and metrics',
    maturity: 'Preview',
    summary:
      'OpenTSDB documents metric, tag, UID, stats, retention, profile, and guarded metadata operations for time-series APIs.',
    bestFor: ['OpenTSDB metric APIs', 'UID metadata review', 'Tag-based queries'],
    connections: [
      'Choose OpenTSDB and configure API prefix, endpoint, auth headers, tenant headers, TLS posture, default time range, timeout, and read-only mode.',
    ],
    explorer: [
      'Browse metrics, tags, tag values, UID metadata, stats, retention posture, access posture, and diagnostics.',
    ],
    queryModes: [
      'Use metric query builders, tag filters, deterministic metric/tag/function IntelliSense, bounded time ranges, and profile or stats previews.',
    ],
    resultViews: [
      'Inspect chart-ready series, tag tables, UID metadata, stats payloads, raw JSON, range warnings, and cardinality/retention hints.',
    ],
    adminFeatures: [
      'Preview UID repair, metadata operations, retention checks, stats collection, profile workflows, and API export plans.',
    ],
    diagnostics: [
      'Review metrics/stats, UID metadata, access posture, retention posture, cardinality, endpoint health, and query-window warnings.',
    ],
    importExport: [
      'Use API export previews with metric, tag, time range, path, size, and environment guardrails.',
    ],
    safety: [
      'UID repair, metadata mutation, broad exports, and high-cardinality operations remain preview-first unless validated for the target deployment.',
    ],
    screenshots: screenshotSet('opentsdb'),
  },
  {
    engine: 'neo4j',
    slug: 'neo4j',
    title: 'Neo4j',
    family: 'Graph',
    maturity: 'Available for Bolt and Query API connections',
    summary:
      'Neo4j runs live Cypher over Bolt by default or the current HTTP Query API, with bounded graph normalization, live metadata, and guarded mutations.',
    bestFor: ['Cypher graph queries', 'Label and relationship exploration', 'Constraint and index review'],
    connections: [
      'Choose Neo4j and configure endpoint, database, auth mode, TLS, timeout, fetch size, default query language, and read-only mode.',
    ],
    explorer: [
      'Browse databases/graphs, labels, relationship types, properties, indexes, constraints, procedures, security, metrics, and diagnostics.',
    ],
    queryModes: [
      'Run scoped Cypher reads and guarded writes, use live-metadata IntelliSense and bounded traversal snippets, and inspect explain/profile results from object-scoped query starts.',
    ],
    resultViews: [
      'Inspect graph rows, node/relationship tables, path payloads, properties, raw JSON, explain/profile payloads, and metrics panels.',
    ],
    adminFeatures: [
      'Preview index, constraint/drop, access/security, metrics, import/export, and graph profile workflows through environment guardrails.',
    ],
    diagnostics: [
      'Review explain/profile output, graph metrics, permissions, indexes, constraints, procedures, transaction posture, and driver/cloud disabled reasons.',
    ],
    importExport: [
      'Use graph import/export previews with label, relationship, path, file, scan, and environment guardrails.',
    ],
    safety: [
      'Cypher writes use shared read-only and environment confirmations. Typed JSON Lines graph import/export is live against an empty target; destructive schema changes remain separately guarded.',
    ],
    screenshots: screenshotSet('neo4j'),
  },
  {
    engine: 'neptune',
    slug: 'neptune',
    title: 'Amazon Neptune',
    aliases: ['Neptune'],
    family: 'Graph',
    maturity: 'Available for AWS IAM queries; some cloud diagnostics are limited',
    summary:
      'Amazon Neptune runs Gremlin and openCypher through the AWS Neptune Data SDK and signs SPARQL with SigV4, while explicit custom endpoints can use unsigned HTTP.',
    bestFor: ['AWS graph workloads', 'Gremlin or openCypher reads', 'IAM and metrics review'],
    connections: [
      'Choose Amazon Neptune and configure endpoint, graph or database name, traversal source, auth mode, AWS/SigV4 posture, TLS, timeout, fetch size, and default query language.',
    ],
    explorer: [
      'Browse graph names, labels, relationship types, properties, indexes, constraints where available, access/IAM posture, metrics, and diagnostics.',
    ],
    queryModes: [
      'Run Gremlin, openCypher, and SPARQL with language-specific live metadata, bounded normalized graph results, guarded mutations, and profile requests.',
    ],
    resultViews: [
      'Inspect graph rows, paths, node/edge properties, raw JSON, CloudWatch-style metrics, profile payloads, and access diagnostic panels.',
    ],
    adminFeatures: [
      'Preview access checks, metrics review, explain/profile, index/constraint-like operations where supported, and graph import/export workflows.',
    ],
    diagnostics: [
      'Review metrics, IAM/access posture, endpoint health, traversal posture, profile boundaries, CloudWatch-style payloads, and SigV4 disabled reasons.',
    ],
    importExport: [
      'Use guarded graph import/export previews with AWS credentials, object location, graph identity, scan/cost, and environment guardrails.',
    ],
    safety: [
      'Query writes use shared read-only and environment confirmations. Cloud cancellation, CloudWatch, loader, import/export, and admin changes remain gated until credential-backed validation passes.',
    ],
    screenshots: screenshotSet('neptune'),
  },
  {
    engine: 'arango',
    slug: 'arango',
    title: 'ArangoDB',
    family: 'Graph',
    maturity: 'Available for HTTP and AQL queries',
    summary:
      'ArangoDB runs live AQL through an authenticated TLS-capable HTTP client, consumes bounded cursor batches, and cleans server cursors on completion or failure.',
    bestFor: ['AQL graph queries', 'Graph and collection inspection', 'Multi-model metadata review'],
    connections: [
      'Choose ArangoDB and configure endpoint, database, auth mode, TLS, timeout, fetch size, default graph/query language, and read-only mode.',
    ],
    explorer: [
      'Browse databases, collections, graphs, vertex and edge collections, analyzers where available, indexes, constraints-like rules, access, metrics, and diagnostics.',
    ],
    queryModes: [
      'Run AQL reads and guarded writes with live collection/graph metadata, deterministic AQL IntelliSense, bounded traversals, cursor cleanup, and profile requests.',
    ],
    resultViews: [
      'Inspect document rows, graph paths, vertices, edges, raw JSON, profile payloads, collection metadata, and metrics panels.',
    ],
    adminFeatures: [
      'Preview index changes, graph/collection operations, access changes, metrics review, import/export, and destructive graph or collection plans.',
    ],
    diagnostics: [
      'Review metrics, permissions, collection/index posture, graph definitions, query profile payloads, access warnings, and endpoint health.',
    ],
    importExport: [
      'Use guarded graph or collection import/export previews with graph identity, collection identity, file path, overwrite, scan, and environment guardrails.',
    ],
    safety: [
      'AQL writes use shared read-only and environment confirmations. Collection drops, index administration, file workflows, and cluster/Foxx changes remain separately guarded.',
    ],
    screenshots: screenshotSet('arango'),
  },
  {
    engine: 'janusgraph',
    slug: 'janusgraph',
    title: 'JanusGraph',
    family: 'Graph',
    maturity: 'Available for Gremlin WebSocket queries',
    summary:
      'JanusGraph runs live GraphSON v3 Gremlin over WebSocket with SASL, partial-response aggregation, TLS/custom CAs, bounded graph results, and live schema metadata.',
    bestFor: ['Gremlin traversals', 'Graph schema review', 'Backend/index posture'],
    connections: [
      'Choose JanusGraph and configure endpoint, graph name, traversal source, auth mode, TLS, timeout, fetch size, backend metadata, and read-only mode.',
    ],
    explorer: [
      'Browse graph labels, edge labels, properties, indexes, management/schema surfaces, backend posture, access, metrics, and diagnostics.',
    ],
    queryModes: [
      'Run Gremlin reads and guarded mutations with live schema IntelliSense, bounded traversal results, profile requests, and graph object-scoped query starts.',
    ],
    resultViews: [
      'Inspect graph rows, paths, vertices, edges, properties, raw JSON, traversal profile payloads, backend/index posture, and metrics panels.',
    ],
    adminFeatures: [
      'Preview index, schema, access, metrics, backend posture, graph import/export, and destructive management workflows.',
    ],
    diagnostics: [
      'Review graph metrics, backend/index posture, schema state, traversal profile payloads, permissions, endpoint health, and disabled execution reasons.',
    ],
    importExport: [
      'Use guarded graph import/export previews with traversal source, graph identity, file path, scan, backend impact, and environment guardrails.',
    ],
    safety: [
      'Gremlin writes use shared read-only and environment confirmations. Schema/index administration, backend-sensitive operations, and import/export execution remain separately guarded.',
    ],
    screenshots: screenshotSet('janusgraph'),
  },
]

const sampleQueries: Record<DatastoreEngineId, { language: string; query: string; expected: string }> = {
  postgresql: { language: 'sql', query: 'SELECT id, name, status\nFROM public.customers\nORDER BY id\nLIMIT 25;', expected: 'Up to 25 customer rows in the Results grid.' },
  cockroachdb: { language: 'sql', query: 'SELECT id, name, status\nFROM public.customers\nORDER BY id\nLIMIT 25;', expected: 'A bounded, consistently ordered customer result.' },
  sqlserver: { language: 'sql', query: 'SELECT TOP (25) id, name, status\nFROM dbo.customers\nORDER BY id;', expected: 'Up to 25 rows from dbo.customers.' },
  mysql: { language: 'sql', query: 'SELECT id, name, status\nFROM commerce.customers\nORDER BY id\nLIMIT 25;', expected: 'Up to 25 commerce customer rows.' },
  mariadb: { language: 'sql', query: 'SELECT id, name, status\nFROM commerce.customers\nORDER BY id\nLIMIT 25;', expected: 'Up to 25 commerce customer rows.' },
  sqlite: { language: 'sql', query: 'SELECT id, name, status\nFROM customers\nORDER BY id\nLIMIT 25;', expected: 'Up to 25 rows read from the selected SQLite database file.' },
  oracle: { language: 'sql', query: 'SELECT customer_id, customer_name, status\nFROM customers\nORDER BY customer_id\nFETCH FIRST 25 ROWS ONLY', expected: 'The first 25 rows in the selected Oracle schema.' },
  timescaledb: { language: 'sql', query: "SELECT time, device_id, temperature\nFROM public.sensor_readings\nWHERE time > now() - interval '1 hour'\nORDER BY time DESC\nLIMIT 100;", expected: 'Recent readings from the selected hypertable.' },
  mongodb: { language: 'javascript', query: "db.products.find({ active: true }, { name: 1, category: 1 }).sort({ name: 1 }).limit(25)", expected: 'Up to 25 active product documents.' },
  dynamodb: { language: 'sql', query: 'SELECT productId, productName, category\nFROM "Products"\nWHERE category = \'active\'', expected: 'Matching items returned by the bounded PartiQL read.' },
  cassandra: { language: 'sql', query: 'SELECT product_id, product_name, category\nFROM catalog.products\nLIMIT 25;', expected: 'Up to 25 rows from the catalog keyspace.' },
  cosmosdb: { language: 'sql', query: 'SELECT TOP 25 c.id, c.name, c.category\nFROM c\nWHERE c.active = true', expected: 'Active documents from the selected container.' },
  litedb: { language: 'javascript', query: 'db.products.find({ active: true }).limit(25)', expected: 'Documents read from the selected LiteDB collection.' },
  redis: { language: 'text', query: 'SCAN 0 MATCH sample:* COUNT 100', expected: 'A cursor and a bounded page of matching keys.' },
  valkey: { language: 'text', query: 'SCAN 0 MATCH sample:* COUNT 100', expected: 'A cursor and a bounded page of matching keys.' },
  memcached: { language: 'text', query: 'stats items', expected: 'Read-only item and slab statistics.' },
  elasticsearch: { language: 'json', query: 'GET products/_search\n{\n  "size": 25,\n  "query": { "term": { "active": true } }\n}', expected: 'Hits, total count, timing, and shard status.' },
  opensearch: { language: 'json', query: 'GET products/_search\n{\n  "size": 25,\n  "query": { "term": { "active": true } }\n}', expected: 'Hits, total count, timing, and shard status.' },
  clickhouse: { language: 'sql', query: 'SELECT event_time, event_name, user_id\nFROM analytics.events\nORDER BY event_time DESC\nLIMIT 100;', expected: 'The 100 most recent analytical events.' },
  duckdb: { language: 'sql', query: 'SELECT order_id, customer_id, total\nFROM orders\nORDER BY order_id\nLIMIT 25;', expected: 'Up to 25 rows from an orders table in the selected DuckDB database.' },
  snowflake: { language: 'sql', query: 'SELECT order_id, customer_id, total\nFROM DEMO.PUBLIC.ORDERS\nORDER BY order_id\nLIMIT 25;', expected: 'Up to 25 rows using the selected warehouse and role.' },
  bigquery: { language: 'sql', query: 'SELECT order_id, customer_id, total\nFROM `demo.analytics.orders`\nORDER BY order_id\nLIMIT 25;', expected: 'A bounded BigQuery result with job metadata.' },
  influxdb: { language: 'text', query: 'from(bucket: "demo")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "temperature")\n  |> limit(n: 100)', expected: 'Recent temperature series and Flux table metadata.' },
  prometheus: { language: 'text', query: 'rate(http_requests_total[5m])', expected: 'A Prometheus instant vector for the matching metric series.' },
  opentsdb: { language: 'json', query: 'GET /api/query?start=1h-ago&m=avg:demo.temperature', expected: 'Time-series points grouped by metric tags.' },
  neo4j: { language: 'sql', query: 'MATCH (p:Product)\nRETURN p.name, p.category\nORDER BY p.name\nLIMIT 25', expected: 'A table and graph-ready result for up to 25 Product nodes.' },
  neptune: { language: 'sql', query: 'SELECT ?product ?name\nWHERE { ?product a :Product ; :name ?name . }\nLIMIT 25', expected: 'A bounded SPARQL binding result.' },
  arango: { language: 'sql', query: 'FOR product IN products\n  FILTER product.active == true\n  SORT product.name\n  LIMIT 25\n  RETURN { name: product.name, category: product.category }', expected: 'Up to 25 active product documents from AQL.' },
  janusgraph: { language: 'text', query: "g.V().hasLabel('product').limit(25).valueMap('name', 'category')", expected: 'A bounded Gremlin traversal result.' },
}

const fileEngines = new Set<DatastoreEngineId>(['sqlite', 'duckdb', 'litedb'])
const cloudEngines = new Set<DatastoreEngineId>(['dynamodb', 'cosmosdb', 'neptune', 'snowflake', 'bigquery'])

function scopeField(doc: DatastoreDocBase) {
  if (doc.family === 'Document and NoSQL') return 'Database / container'
  if (doc.family === 'Key-value and cache') return 'Database / namespace'
  if (doc.family === 'Search') return 'Index / alias'
  if (doc.family === 'Warehouse and analytical') return 'Database / schema'
  if (doc.family === 'Time-series and metrics') return 'Bucket / project'
  if (doc.family === 'Graph') return 'Graph / database'
  return 'Database / schema'
}

function connectionFields(doc: DatastoreDocBase): DatastoreConnectionField[] {
  if (fileEngines.has(doc.engine)) {
    const examplePath = doc.engine === 'sqlite'
      ? 'C:/data/application.db'
      : doc.engine === 'duckdb'
        ? 'C:/data/analytics.duckdb'
        : 'C:/data/archive.litedb'
    return [
      { name: 'File path', required: true, description: `Path to a ${doc.title} database file you are authorized to open.`, example: examplePath },
      { name: 'Mode', required: true, description: 'Open read-only for the first connection; enable writes only when the task requires them.', example: 'Read only' },
      { name: 'Encryption / secret', required: false, description: 'Optional local database secret when the selected engine supports it.', example: 'Stored in the OS secret store' },
    ]
  }

  if (doc.engine === 'bigquery') {
    return [
      { name: 'Project ID', required: true, description: 'Google Cloud project used for jobs and billing.', example: 'my-analytics-project' },
      { name: 'Dataset', required: false, description: 'Default dataset for browsing and unqualified names.', example: 'analytics' },
      { name: 'Credentials', required: true, description: 'Application Default Credentials or an authorized service-account secret.', example: 'Application Default Credentials' },
      { name: 'Location', required: false, description: 'Dataset and job location.', example: 'US' },
    ]
  }

  if (doc.engine === 'dynamodb') {
    return [
      { name: 'Region', required: true, description: 'AWS region that contains your table.', example: 'us-east-1' },
      { name: 'Endpoint', required: false, description: 'Optional endpoint override. Leave blank to use the selected AWS region.', example: 'Leave blank for AWS' },
      { name: 'Access key', required: true, description: 'Access key for a least-privileged identity, stored outside the workspace.', example: 'Stored secret' },
      { name: 'Secret key', required: true, description: 'Secret key stored in the operating-system secret store.', example: 'Stored secret' },
    ]
  }

  return [
    { name: cloudEngines.has(doc.engine) ? 'Endpoint / account' : 'Server', required: true, description: `Host, service URL, or account identifier for your ${doc.title} deployment.`, example: cloudEngines.has(doc.engine) ? `${doc.title} account or service URL` : 'db.example.internal' },
    { name: 'Port', required: !cloudEngines.has(doc.engine), description: 'Native service port when the connection mode uses TCP.', example: 'Engine default' },
    { name: scopeField(doc), required: false, description: `Initial ${scopeField(doc).toLowerCase()} scope used by Explorer and new query tabs.`, example: 'demo' },
    { name: 'Username / identity', required: false, description: 'Authorized, least-privileged identity for the selected datastore.', example: 'datapad_reader' },
    { name: 'Secret / TLS', required: false, description: 'Secret-store reference and transport-security settings; never commit raw credentials.', example: 'OS secret store + TLS verify' },
  ]
}

function capabilityRows(doc: DatastoreDocBase): DatastoreCapabilityRow[] {
  const preview = /^preview\b/i.test(doc.maturity)
  const editable = doc.resultViews.some((item) => /edit|mutation|write/i.test(item))
  return [
    { capability: 'Native explorer', support: preview ? 'Preview' : 'Available', notes: doc.explorer[0] ?? 'Native Explorer availability follows the adapter capability registry.' },
    { capability: 'Read queries', support: preview ? 'Preview' : 'Available', notes: doc.queryModes[0] ?? 'Read-query availability follows the adapter capability registry.' },
    { capability: 'Inline editing', support: editable ? 'Guarded' : 'Unavailable', notes: editable ? 'Requires key evidence, a writable profile, and environment confirmation.' : 'Use a reviewed statement or the engine-native tool instead.' },
    { capability: 'Diagnostics / administration', support: 'Guarded', notes: doc.adminFeatures[0] ?? 'Administration is available only when the adapter exposes a reviewed preview and execution boundary.' },
    { capability: 'Import / export / transfer', support: 'Guarded', notes: 'Availability follows the authoritative runtime transfer manifest and shows a disabled reason when execution is not implemented.' },
  ]
}

function enrichDatastoreDoc(doc: DatastoreDocBase): DatastoreDoc {
  const sample = sampleQueries[doc.engine]
  return {
    ...doc,
    importExport: transferDocumentation(doc.engine),
    prerequisites: [
      'Install the current DataPad++ desktop pre-release on Windows, macOS, or Linux.',
      `Have the endpoint, database file, or cloud account details for a ${doc.title} datastore you are authorized to use. Start with least-privileged, read-only access.`,
      'Keep an independent backup before enabling edits, administration, restore, or transfer execution.',
    ],
    platforms: ['Windows desktop', 'macOS desktop', 'Linux desktop'],
    connectionFields: connectionFields(doc),
    quickstart: [
      `Open Library, choose Add connection, and select ${doc.title}.`,
      'Complete the connection fields, keep Read only enabled, then choose Test connection and review the returned capability warnings.',
      `Save the profile and open its native ${doc.title} Explorer.`,
      `Select the ${scopeField(doc).toLowerCase()} scope that should be attached to the new tab.`,
      'Open a query tab, paste the bounded read-only sample below, and choose Run or press Ctrl/Cmd+Enter.',
      'Inspect Results, Messages, History, and Details; dock the panel on the bottom or right as needed.',
      'Export only the required rows after reviewing format, destination, and redaction options.',
      'Open Diagnostics or Transfers from the drawer/status bar and treat disabled reasons as capability boundaries, not transient errors.',
    ],
    sampleQuery: sample.query,
    queryLanguage: sample.language,
    expectedResult: sample.expected,
    capabilities: capabilityRows(doc),
    troubleshooting: [
      { symptom: 'Test connection fails or times out', resolution: 'Verify endpoint, port, TLS mode, proxy settings, service health, firewall rules, and network access. Keep the profile unsaved until the test explains the failure.' },
      { symptom: 'Explorer branches are empty or disabled', resolution: `Confirm the selected ${scopeField(doc).toLowerCase()}, refresh the branch, and grant the minimum metadata permissions described in the connection warning.` },
      { symptom: 'Run, edit, admin, or transfer is disabled', resolution: 'Read the visible disabled reason. Select a compatible target, turn off read-only only when authorized, or use the documented preview/export fallback.' },
      { symptom: 'The sample query fails or returns different columns', resolution: `Replace the example names with objects from your ${doc.title} datastore, confirm the selected ${scopeField(doc).toLowerCase()}, and keep the query bounded while you validate the result.` },
    ],
  }
}

export const datastoreDocs: DatastoreDoc[] = datastoreDocsBase.map(enrichDatastoreDoc)

export const datastoreDocsByFamily = datastoreFamilyOrder
  .map((family) => ({
    family,
    docs: datastoreDocs.filter((doc) => doc.family === family),
  }))
  .filter((group) => group.docs.length > 0)

export const datastoreDocRoutes = datastoreDocs.map((doc) => `/docs/datastores/${doc.slug}`)

export const datastoreGuideLinksByArticleSlug: Record<string, string[]> = {
  'api-server': ['postgresql', 'mongodb', 'redis', 'dynamodb', 'elasticsearch', 'opensearch'],
  'test-suites': ['postgresql', 'mongodb', 'redis', 'dynamodb', 'elasticsearch', 'opensearch'],
  'relationship-explorer': ['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite', 'oracle', 'timescaledb', 'duckdb'],
  'datastore-coverage-maturity': declaredDatastoreEngines.map((engine) => getDatastoreDocBySlug(engine)?.slug ?? engine),
  'sql-workflows': ['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite', 'oracle', 'timescaledb', 'duckdb'],
  'mongodb-workflows': ['mongodb'],
  'redis-valkey-workflows': ['redis', 'valkey', 'memcached'],
  'typed-query-builders': ['mongodb', 'cosmosdb', 'dynamodb', 'postgresql', 'cockroachdb', 'mysql', 'mariadb', 'sqlite', 'sqlserver'],
  'sql-database-schema-scope': ['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'oracle', 'timescaledb'],
  'document-results-editing': ['mongodb', 'cosmosdb', 'litedb', 'arango'],
  'key-value-full-value': ['redis', 'valkey', 'memcached'],
  'native-datastore-transfers': declaredDatastoreEngines.map((engine) => getDatastoreDocBySlug(engine)?.slug ?? engine),
  'oracle-explorer-intellisense': ['oracle'],
  'search-dynamodb-and-secondary': [
    'elasticsearch',
    'opensearch',
    'dynamodb',
    'cassandra',
    'cosmosdb',
    'litedb',
    'clickhouse',
    'snowflake',
    'bigquery',
    'influxdb',
    'prometheus',
    'opentsdb',
    'neo4j',
    'neptune',
    'arango',
    'janusgraph',
  ],
}

export function getDatastoreDocBySlug(slug: string) {
  return datastoreDocs.find((doc) => doc.slug === slug)
}
import { transferDocumentation } from './transfer-docs'
