import type { DatastoreEngine, DatastoreFamily } from './connection'
import { DATASTORE_FEATURE_BACKLOG } from './datastore-roadmap'

export const DATASTORE_COMPLETENESS_CRITERIA = [
  'connection-flow',
  'object-tree',
  'query-surface',
  'intellisense',
  'object-views',
  'safe-editing',
  'guarded-operations',
  'diagnostics-performance',
  'import-export',
  'tests',
] as const

export type DatastoreCompletenessCriterion =
  (typeof DATASTORE_COMPLETENESS_CRITERIA)[number]

export const DATASTORE_COMPLETENESS_STATUSES = [
  'native',
  'strong',
  'partial',
  'preview',
  'missing',
] as const

export type DatastoreCompletenessStatus =
  (typeof DATASTORE_COMPLETENESS_STATUSES)[number]

export const DATASTORE_COMPLETION_CLAIMS = [
  'native-complete',
  'contract-complete',
  'incomplete',
] as const

export type DatastoreCompletionClaim =
  (typeof DATASTORE_COMPLETION_CLAIMS)[number]

export const DATASTORE_CONTRACT_STATUSES = ['covered', 'not-covered'] as const

export type DatastoreContractStatus =
  (typeof DATASTORE_CONTRACT_STATUSES)[number]

export const DATASTORE_COMPLETENESS_EVIDENCE_TYPES = [
  'live',
  'contract',
  'fixture',
  'manual',
  'plan-only',
] as const

export type DatastoreCompletenessEvidenceType =
  (typeof DATASTORE_COMPLETENESS_EVIDENCE_TYPES)[number]

export type DatastoreNativeReadiness =
  | 'native'
  | 'near-native'
  | 'usable'
  | 'foundation'
  | 'beta'

export interface DatastoreCompletenessCriterionStatus {
  criterion: DatastoreCompletenessCriterion
  status: DatastoreCompletenessStatus
  contractStatus: DatastoreContractStatus
  evidence: DatastoreCompletenessEvidenceType[]
  contractNote: string
  note: string
  next: string[]
}

export interface DatastoreCompletenessSummary {
  engine: DatastoreEngine
  family: DatastoreFamily
  readiness: DatastoreNativeReadiness
  completionClaim: DatastoreCompletionClaim
  completionEvidence: DatastoreCompletenessEvidenceType[]
  residualRisk: string
  nativeScore: number
  targetPhase: number
  summary: string
  criteria: DatastoreCompletenessCriterionStatus[]
}

type CompletionProfile = Record<
  DatastoreCompletenessCriterion,
  Omit<
    DatastoreCompletenessCriterionStatus,
    'criterion' | 'contractStatus' | 'evidence' | 'contractNote'
  >
>

export const CONTRACT_COMPLETE_DATASTORE_ENGINES = [
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'oracle',
  'mongodb',
  'dynamodb',
  'cassandra',
  'cosmosdb',
  'litedb',
  'redis',
  'valkey',
  'memcached',
  'neo4j',
  'neptune',
  'arango',
  'janusgraph',
  'influxdb',
  'timescaledb',
  'prometheus',
  'opentsdb',
  'elasticsearch',
  'opensearch',
  'clickhouse',
  'duckdb',
  'snowflake',
  'bigquery',
] as const satisfies readonly DatastoreEngine[]

const CONTRACT_COMPLETE_ENGINE_SET = new Set<DatastoreEngine>(
  CONTRACT_COMPLETE_DATASTORE_ENGINES,
)

export const NATIVE_COMPLETE_DATASTORE_ENGINES = [
  'mongodb',
  'postgresql',
  'sqlserver',
  'mysql',
  'mariadb',
  'cockroachdb',
  'timescaledb',
  'redis',
  'sqlite',
  'valkey',
  'oracle',
  'dynamodb',
  'elasticsearch',
  'opensearch',
  'duckdb',
] as const satisfies readonly DatastoreEngine[]

const NATIVE_COMPLETE_ENGINE_SET = new Set<DatastoreEngine>(
  NATIVE_COMPLETE_DATASTORE_ENGINES,
)

const MONGO_PROFILE = profile({
  'connection-flow': strong(
    'Native and URI connection flows exist, including optional database discovery.',
    [
      'Optional extension: add deeper Atlas/TLS/read-write concern presets when those deployment profiles enter the release claim.',
    ],
  ),
  'object-tree': strong(
    'Mongo uses a database/collection/view/GridFS/users/roles tree with system databases separated.',
    [
      'Optional extension: add Atlas-only folders only when live metadata proves they are available.',
    ],
  ),
  'query-surface': strong(
    'Find builder, aggregation builder, raw command JSON, and safe scripting are implemented.',
    [
      'Optional extension: add helpers for less common read-only commands after server-version metadata proves availability.',
    ],
  ),
  intellisense: strong(
    'Mongo suggestions cover collections, query keys, operators, aggregation stages, expression operators, snippets, document fields, and `$field.path` pipeline references from cached metadata and recent results.',
    [
      'Optional extension: add live collection-specific stage validation and accumulator suggestions from sampled schema and server version metadata.',
    ],
  ),
  'object-views': strong(
    'Mongo has purpose-built database, collection, schema, indexes, validation, GridFS, users, roles, statistics, and pipeline views.',
    [
      'Optional fixture validation now covers index hide/unhide, validator update, and user create/drop before/after primitives; live GridFS file workflows and Atlas-specific management views stay outside the scoped claim.',
    ],
  ),
  'safe-editing': strong(
    'MongoDB insert-document, whole-document replacement, document delete, and field set/unset/rename/type-change edits execute through the native adapter only when collection, document identity, read-only, and confirmation guardrails pass.',
    [
      'Optional extension: add bulk/multi-document editing only after separate identity, preview, and confirmation guards are designed.',
    ],
  ),
  'guarded-operations': strong(
    'Admin/destructive operations are preview-first and environment guarded.',
    [
      'Optional fixture validation now covers management before/after primitives; live execution for index/user/role/validator administration remains preview-first unless explicitly added later.',
    ],
  ),
  'diagnostics-performance': strong(
    'Mongo metrics, explain rendering, profiler status, recent profiler entries, current operations, replica status, sharding state, scoped index-usage diagnostics, and browser-preview profile payloads are pinned.',
    [
      'Optional fixture validation now covers read-only dbStats plus permission-denied serverStatus/currentOp paths; replica and shard topology fixture depth remains outside the scoped claim.',
    ],
  ),
  'import-export': strong(
    'Collection import/export is a guarded desktop live file workflow with scoped database/collection targets, filters, projections, sorting, JSON/Extended JSON/NDJSON/CSV/BSON serializers and parsers, concrete file-path checks, overwrite guards, read-only/confirmation gates, duplicate-key policy handling, before/after import summaries, adapter-driven fixture evidence, and optional validator/large-document fixture evidence; browser preview remains plan-only.',
    [
      'Optional extension: add live GridFS file execution and replica/shard stress fixtures if those workflows enter the release claim.',
    ],
  ),
  tests: strong(
    'Mongo has focused builder, object-view, explain, scripting, explorer, result, safe-edit, adapter file-workflow, optional live fixture, and quality drift tests.',
    [
      'Optional extension: add Atlas, GridFS live file workflow, and replica/shard topology fixtures when those claims are in scope.',
    ],
  ),
})

const REDIS_PROFILE = profile({
  'connection-flow': strong(
    'Native and URI Redis connection options include DB index, TLS, sentinel, cluster, and socket metadata.',
    [
      'Optional extension: add live Sentinel, cluster discovery, Unix socket, and cloud-hosted TLS fixture coverage when those deployment modes enter the release claim.',
    ],
  ),
  'object-tree': strong(
    'Redis has DB/type/security/diagnostics tree sections and module branches stay hidden until manifest or live metadata proves availability.',
    [
      'Optional extension: deepen DB/type counts with per-type live metadata and permission-specific disabled reasons from live command and ACL metadata.',
    ],
  ),
  'query-surface': strong(
    'Redis opens in a key browser and has a Redis console mode with command shortcuts, history recall, and read-only pipeline batches.',
    [
      'Optional extension: add richer command docs and RESP/raw result toggles for advanced console inspection.',
    ],
  ),
  intellisense: strong(
    'Redis suggestions cover read command syntax, known keys, namespace prefixes, command-specific key positions, subcommands, SCAN options, range/count/path literals, INFO sections, Redis Stack module hints for RedisJSON, TimeSeries, Bloom, RediSearch, and vector sets, and live COMMAND INFO metadata ingested from recent Redis console results.',
    [
      'Optional extension: add ACL-aware disabled reasons from live module and command metadata; run `--require-vector` fixture validation when a Redis Stack image with `VADD` support is available.',
    ],
  ),
  'object-views': strong(
    'Redis object views cover DB overview, typed key folders, key details, stream overview/entries/consumer groups/consumers/pending messages, Redis Stack module panels for RedisJSON, TimeSeries, Bloom, RediSearch, and vector sets, Pub/Sub, ACL/security, cluster, sentinel, Lua script, function library, diagnostics, and native command payload renderers for slowlog, latency, memory, clients, INFO, and command stats.',
    [
      'Optional fixture validation now covers Redis Stack modules and stream-group deployments; add cluster and Sentinel fixture evidence if those topologies become part of the release claim.',
    ],
  ),
  'safe-editing': strong(
    'Core single-key/member edits, stream entry add/delete, RedisTimeSeries sample add/delete, RedisJSON path edits, and vector member/attribute edits execute live only after read-only, identity, type, and confirmation guardrails pass.',
    [
      'Optional extension: extend live edit parity to remaining probabilistic module-backed values only when module commands are confirmed.',
    ],
  ),
  'guarded-operations': strong(
    'Redis destructive/admin key operations include guarded rename, duplicate, move, expire/persist, stream ack/delete, stream entry delete, RedisTimeSeries sample delete, RedisJSON path delete, vector member removal, vector attribute updates, and guarded live desktop key import/export for core types, RedisJSON, RedisTimeSeries, vector sets, and Redis DUMP snapshot-backed opaque modules.',
    [
      'Optional extension: add module-specific edit/admin plans after live capability evidence confirms the module command set.',
    ],
  ),
  'diagnostics-performance': strong(
    'INFO-derived dashboard metrics and tables exist.',
    [
      'Optional extension: add deeper largest-key, TTL-distribution, cluster, Sentinel, and replication analysis once those live payloads are in scope.',
    ],
  ),
  'import-export': strong(
    'Redis exposes guarded desktop key export/import workflows for strings, hashes, lists, sets, sorted sets, streams, whole-document RedisJSON values, RedisTimeSeries samples, vector-set elements, and Redis DUMP/RESTORE snapshot envelopes for Bloom, Cuckoo, CMS, TopK, and t-digest module values with concrete file paths, JSON/NDJSON serializers, TTL preservation, create-only/replace/validate modes, and before/after metadata summaries.',
    [
      'Optional Redis Stack fixture validation now covers DUMP/RESTORE module snapshot evidence; run `--require-vector` when the fixture image exposes `VADD`, and consider broader RESP/RDB-style export formats later.',
    ],
  ),
  tests: strong(
    'Redis key browser, console, COMMAND INFO ingestion, metrics, object-view descriptors, native command payload renderers, live core edit, stream entry edit, RedisTimeSeries sample edit, RedisJSON path edit, vector member edit, guarded core, RedisJSON, TimeSeries, vector-set, and module-snapshot key file workflow, operation-plan, and capability-hiding tests cover the reference contract.',
    [
      '`npm run fixtures:validate:redis -- --require-stack --require-valkey` passed for core Redis, Valkey, Redis Stack modules, and DUMP/RESTORE snapshots; keep optional `--require-vector` evidence outside default CI until a `VADD`-capable Redis Stack image is selected.',
    ],
  ),
})

const VALKEY_PROFILE = profile({
  ...REDIS_PROFILE,
  intellisense: strong(
    'Valkey shares Redis-compatible command, key, namespace, SCAN option, range/count/path, INFO section, and live COMMAND INFO suggestions, while Redis Stack static hints stay hidden unless live command metadata proves support.',
    [
      'Optional extension: enable module completions only when live Valkey-compatible command metadata proves support.',
    ],
  ),
  'object-views': strong(
    'Valkey shares the Redis-compatible DB overview, typed key folders, key details, Pub/Sub, ACL/security, cluster, sentinel, Lua script, function library, diagnostics, and native command payload renderers with Valkey-specific tree, preview, menu, and disabled-action copy while Redis Stack/vector-only surfaces stay capability-gated.',
    [
      'Optional extension: add cluster/Sentinel fixture evidence only if topology support becomes part of the Valkey release claim.',
    ],
  ),
  'safe-editing': strong(
    'Valkey core single-key, member, and stream entry edits execute live only after read-only, identity, type, and confirmation guardrails pass, while Redis Stack path/module edits stay hidden until compatible live evidence exists.',
    [
      'Optional extension: promote module-specific edits only after fixture-backed validation confirms Valkey-compatible commands.',
    ],
  ),
  'guarded-operations': strong(
    'Valkey exposes Redis-compatible guarded rename, duplicate, move, expire/persist, stream ack/delete, live core key/member edit scopes, and guarded desktop key import/export execution for core Redis-compatible types.',
    [
      'Optional extension: promote module-specific operations only after fixture-backed validation confirms Valkey-compatible commands.',
    ],
  ),
  'import-export': strong(
    'Valkey exposes guarded desktop JSON/NDJSON key import/export execution for strings, hashes, lists, sets, sorted sets, and streams with concrete path checks, type metadata, TTL preservation, validate-only/create-only/replace modes, before/after summaries, and Redis Stack module formats kept plan-only unless compatible live evidence appears.',
    [
      'Optional live Valkey fixture validation now covers TTL behavior, permission-denied guarded write evidence, and large list/stream key-file command primitives; keep Redis Stack module formats gated until compatible live evidence appears.',
    ],
  ),
  tests: strong(
    'Valkey shares Redis key browser, console, metrics, object-view, live core edit, operation-plan, capability-hiding, guarded key file workflow, shared tree-manifest, sidebar, and browser-preview tests; the optional Redis fixture validator now checks Valkey core export/import primitives, TTL behavior, permission-denied guarded writes, large key-file primitives, and stream-group state.',
    [
      'Optional extension: add Valkey cluster/Sentinel fixture tests only if those topology claims become part of the release claim.',
    ],
  ),
})

const RELATIONAL_CORE_PROFILE = profile({
  'connection-flow': partial(
    'Native and connection-string flows exist, with some engine-specific options.',
    ['Finish focused connection forms for every promoted relational engine.'],
  ),
  'object-tree': partial(
    'Relational trees expose schemas/tables/views/routines and selected engine-specific sections.',
    [
      'Make every branch permission-aware, metadata-driven, and free of unavailable clutter.',
    ],
  ),
  'query-surface': partial(
    'Raw SQL is stable and scoped SQL SELECT builders exist for tables/views.',
    [
      'Add joins, parameters, snippets, stored procedure/function execution, and dialect-native explain modes.',
    ],
  ),
  intellisense: partial('SQL IntelliSense exists from cached metadata.', [
    'Improve alias, parameter, routine, and dialect-specific identifier suggestions.',
  ]),
  'object-views': partial(
    'PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, and SQLite have native descriptor-backed object views.',
    [
      'Deepen SQL Server/PostgreSQL/MySQL-family views with richer live management payloads.',
    ],
  ),
  'safe-editing': strong(
    'Live insert/update/delete row edits with complete identity exist for PostgreSQL-family, SQL Server, MySQL-family, SQLite, and TimescaleDB, with browser-preview contracts kept plan-only.',
    [
      'Broaden optional fixture coverage for every promoted SQL engine and add before/after row diffs where drivers can return changed rows safely.',
    ],
  ),
  'guarded-operations': partial(
    'DDL/admin actions are mostly operation previews.',
    [
      'Add create/alter/drop/index/grant/maintenance previews with clear diffs and confirmation.',
    ],
  ),
  'diagnostics-performance': partial(
    'Metrics, posture panels, and rendered plan payloads exist unevenly across the SQL family.',
    [
      'Deepen pg_stat/performance_schema/Query Store/DBMS_XPLAN payloads, live lock/session dashboards, and EXPLAIN ANALYZE/profile details per engine.',
    ],
  ),
  'import-export': partial(
    'Dialect-aware import/export and backup/restore plans now exist across the Wave 2 SQL engines.',
    [
      'Promote selected import/export and backup paths to guarded live execution only after fixture/live coverage exists.',
    ],
  ),
  tests: strong(
    'Shared builder, tree, object-view, row-edit, operation-plan, rendered-plan, browser-preview, and desktop live-scope tests cover the promoted SQL engines.',
    [
      'Add optional live fixture tests for promoted SQL engines and deeper browser-preview coverage for object-view management flows.',
    ],
  ),
})

const POSTGRESQL_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'PostgreSQL native and connection-string flows now preserve typed TCP, Unix socket, Cloud SQL proxy, managed-profile metadata, application_name, search_path, target_session_attrs, TLS certificate paths, connect/statement/lock/idle timeout options, right-drawer fields, Rust interpolation, timeout routing, and encoded DSN query parameters without storing secret values.',
    [
      'Optional extension: add live fixture/cloud validation for managed provider IAM/proxy/certificate combinations only when those deployment claims enter scope.',
    ],
  ),
  'query-surface': strong(
    'PostgreSQL supports raw SQL, scoped SELECT builders, rendered EXPLAIN, first-class EXPLAIN ANALYZE profile execution, PostgreSQL-aware snippets for bounded reads, CTEs, routine inventory, routine calls, session waits, locks, extension checks, and profile workflows, plus guarded routine execution plans that expose function/procedure argument metadata as parameterized bindings outside raw SQL.',
    [
      'Optional extension: add richer visual join builders, overload-aware live parameter metadata, and adapter-owned live routine execution only after volatility, permission, and result-cardinality guardrails are proven.',
    ],
  ),
  intellisense: strong(
    'PostgreSQL IntelliSense now layers PostgreSQL-native catalog helpers, pg_catalog/information_schema objects, dialect functions/keywords, routine call and definition snippets from cached explorer metadata, profile/lock/session snippets, and safe identifier quoting for mixed-case or reserved names on top of the shared SQL metadata provider.',
    [
      'Optional extension: add deeper live parameter metadata, overload-aware routine signatures, permission-aware disabled reasons, and connection-profile-specific search_path suggestions when that polish enters scope.',
    ],
  ),
  'object-tree': strong(
    'PostgreSQL now exposes live schema objects with extension folders, extension update hints, Security child branches for roles, role memberships, permissions, and default privileges, plus diagnostics/profile roots mirrored by browser-preview routing.',
    [
      'Add finer capability hiding for managed PostgreSQL roles/extensions when cloud permissions or version-specific catalogs make sections unavailable.',
    ],
  ),
  'object-views': strong(
    'PostgreSQL object views now render schema extension inventories, extension-owned objects, extension update state, role posture, role memberships, normalized schema/table/routine/sequence permissions, and default privileges alongside storage, index, activity, and diagnostics panels.',
    [
      'Optional extension: add richer relation-level privilege editors and extension dependency graphs when live management editing enters scope.',
    ],
  ),
  'safe-editing': strong(
    'PostgreSQL live insert/update/delete row edits use complete primary-key identity where required, keep browser-preview execution plan-only, execute desktop mutations with RETURNING row snapshots, and include before/after row evidence metadata for safe review.',
    [
      'Add optional live fixture assertions for row-evidence metadata across generated keys, composite keys, triggers, and no-match edits.',
    ],
  ),
  'guarded-operations': strong(
    'PostgreSQL guarded operations cover parameterized routine execution plans, backend cancel/terminate previews with PID and current-backend guards, vacuum/analyze/reindex, security inspection, role grant/revoke plans, extension update/drop plans, live guarded EXPLAIN ANALYZE JSON profile execution for read statements, and live desktop file workflows for bounded table import/export plus logical backup packages through matching browser and Rust planner contracts.',
    [
      'Optional extension: add relation-level privilege editors and guarded full pg_dump/pg_restore execution only if those workflows enter the scoped claim.',
    ],
  ),
  'diagnostics-performance': strong(
    'PostgreSQL diagnostics now collect live pg_stat_database metrics, pg_stat_activity session/wait/blocking profile payloads, pg_locks lock posture payloads, pg_stat_user_tables relation/vacuum/index-scan payloads, optional pg_stat_statements top-query payloads when the extension is visible, rendered EXPLAIN payloads, and rendered EXPLAIN ANALYZE JSON profile dashboards with operator stages, plan/table fallbacks, warnings, and raw JSON auditability.',
    [
      'Optional extension: add deeper lock wait graphs and statement-history fixture evidence when those diagnostics enter scope.',
    ],
  ),
  tests: strong(
    'PostgreSQL has shared SQL builder/tree/object-view/row-edit tests plus focused frontend/Rust/browser coverage for typed connection options, DSN option generation, profile interpolation, diagnostics/profile, row-evidence SQL generation, role/default-privilege/extension object views, maintenance, parameterized routine operation previews, backend cancel/terminate action previews, role/extension operation previews, guarded file workflows, rendered EXPLAIN ANALYZE profile payloads, and an opt-in PostgreSQL fixture validator.',
    [
      'Optional extension: broaden fixture assertions for generated/identity columns, custom types, large files, managed roles, pg_stat_statements deployments, and full pg_dump/restore workflows if those claims enter scope.',
    ],
  ),
  'import-export': strong(
    'PostgreSQL now has guarded desktop live table/view export to CSV/JSON/NDJSON, CSV/JSON/NDJSON import into explicit existing tables with target-column/type validation and validation-only mode, and bounded JSON/SQL logical backup packages with concrete path, overwrite, read-only, row-limit, table-limit, and confirmation guardrails; browser preview emits the same workflow contracts while restore and full pg_dump/pg_restore execution remain optional extensions outside the scoped claim.',
    [
      'Optional extension: add generated/identity column, custom type, large-file, streaming, and full pg_dump/restore execution workflows only if those claims enter scope.',
    ],
  ),
})

const COCKROACH_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'CockroachDB now has typed PostgreSQL-wire connection options plus CockroachDB-specific deployment/profile metadata for local, self-hosted, Cockroach Cloud dedicated, and Cockroach Cloud serverless targets; right-drawer fields, browser request validation, Rust interpolation, auth/TLS disabled-reason metadata, and explicit capability toggles for jobs, ranges, regions, crdb_internal diagnostics, certificates, zone configurations, and EXPLAIN ANALYZE stay in sync without storing secret values.',
    [
      'Optional extension: add live Cockroach Cloud API probes for organization/cluster identity, certificate posture, and restricted capability discovery before a native-complete cloud claim.',
    ],
  ),
  'object-tree': strong(
    'CockroachDB now has Cockroach-owned database/schema, cluster, security, diagnostics, jobs, ranges, regions/localities, sessions, statement stats, transactions, contention, locks, statistics, certificates, and zone-configuration tree contracts across shared manifests, browser preview, and Rust explorer routing, with profile capability hiding for restricted native surfaces.',
    [
      'Add optional live permission/version probes to set capability defaults from the connected CockroachDB deployment instead of relying on saved profile metadata.',
    ],
  ),
  'query-surface': strong(
    'CockroachDB supports PostgreSQL-wire SQL, scoped SELECT templates, read-safe SHOW/crdb_internal inspection templates, distributed EXPLAIN plans, guarded EXPLAIN ANALYZE profile previews, and CockroachDB-specific jobs/ranges/regions/sessions/contention/roles/backup/restore/import/export/zone request builders.',
    [
      'Add richer visual builders for follower reads, AS OF SYSTEM TIME, multi-region schema changes, and parameterized CockroachDB admin workflows when those workflows enter scope.',
    ],
  ),
  intellisense: strong(
    'CockroachDB IntelliSense now adds SHOW helpers, crdb_internal diagnostic objects, CockroachDB functions, distributed explain/profile snippets, jobs, ranges, contention, regions/localities, and zone-configuration snippets on top of shared SQL objects and CockroachDB-safe identifier quoting.',
    [
      'Add version-aware suggestions for newer crdb_internal tables and cloud-only surfaces once connection metadata records CockroachDB version and deployment mode.',
    ],
  ),
  'object-views': strong(
    'CockroachDB object views render compact table/locality, cluster, ranges, regions, jobs, activity/contention, security/grants, certificates, statistics, and zone-configuration posture from focused browser and Rust payload shapes instead of falling back to generic JSON.',
    [
      'Add richer per-job, per-range, and per-node drilldowns after live identity and permission probes are available.',
    ],
  ),
  'guarded-operations': strong(
    'CockroachDB now has Cockroach-owned guarded operation manifests and browser/Rust planners for jobs, ranges, regions, sessions, contention, role/grant/default-privilege inspection, zone-configuration review, BACKUP, RESTORE, IMPORT, and EXPORT workflows. Write, destructive, data-movement, and placement changes stay preview-first with confirmation text, permission requirements, external-storage checks, read-only/environment guard warnings, and profile capability hiding.',
    [
      'Optional extension: promote selected CockroachDB admin execution only after live external-storage, role/default privilege, zone-configuration, job-control, and restore safety fixtures exist.',
    ],
  ),
  'diagnostics-performance': strong(
    'CockroachDB diagnostics now have focused browser-preview and Rust live payload contracts for jobs, ranges, regions/localities, sessions, statement stats, transactions, locks, contention events, cluster settings, node status, certificates, statistics, and zone configuration surfaces with warnings when crdb_internal metadata is restricted.',
    [
      'Add rendered distributed profile dashboards from EXPLAIN ANALYZE DEBUG artifacts and optional live fixture/cloud evidence for restricted crdb_internal paths.',
    ],
  ),
  'import-export': strong(
    'CockroachDB now has explicit preview-first IMPORT, EXPORT, BACKUP, RESTORE, and generic data import/export and backup/restore request builders across browser preview and the desktop adapter. Plans include external URI parameters, CSV format defaults, skip-row handling, revision-history/detached backup options, restore target hints, confirmation requirements, permission requirements, scan/cost warnings, and operation/action manifests that keep live destructive execution out of the scoped claim.',
    [
      'Optional extension: add live CockroachDB fixture/cloud validation for external storage URIs, protected timestamps, job polling, import column validation, EXPORT row-count evidence, and restore-package dry runs before promoting any live data-movement execution claim.',
    ],
  ),
  tests: strong(
    'CockroachDB has focused tests for typed profile validation, right-drawer profile fields, browser and Rust capability hiding, shared tree manifests, browser explorer routing, object-view descriptors, posture rendering, operation actions, guarded operation plans, generic and Cockroach-specific import/export/backup builders, query guardrails, crdb_internal normalizers, live-payload merge behavior, SQL live-scope row edits, and CockroachDB-specific IntelliSense snippets.',
    [
      'Add optional CockroachDB fixture validation for live capability probing, jobs/ranges/regions/contention payloads, and guarded import/export/backup flows before native-complete graduation.',
    ],
  ),
})

const SQLSERVER_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'SQL Server and Azure SQL profiles preserve typed native, connection-string, SQL login, Windows, Entra, managed identity, service principal, certificate, encryption, trust, application intent, timeout, packet, and MARS/pooling option metadata with mode-specific disabled reasons where the current TDS runtime is plan-only.',
    [
      'Optional extension: add live managed-identity, Entra, certificate, LocalDB, and named-instance fixture coverage only when those deployment claims enter scope.',
    ],
  ),
  'object-tree': strong(
    'SQL Server exposes SSMS-inspired database, schema, table, view, routine, Query Store, performance, Extended Events, Agent, security, storage, and table-child branches with focused routing and unavailable-surface warnings.',
    [
      'Optional extension: add version and permission-specific capability hiding for older SQL Server editions and constrained Azure SQL tiers.',
    ],
  ),
  'query-surface': strong(
    'SQL Server supports raw T-SQL, scoped SELECT templates, SHOWPLAN_TEXT explain, XML Showplan profile plans, Query Store workload review, DMV diagnostics requests, and guarded file-workflow request builders.',
    [
      'Optional extension: add richer visual join builders, parameter panels, and stored-procedure execution after result-cardinality and permission guardrails are proven.',
    ],
  ),
  intellisense: strong(
    'SQL Server IntelliSense layers T-SQL metadata, bracket-safe identifier quoting, scoped object names, and SQL Server/Azure SQL snippets on top of the shared SQL metadata provider.',
    [
      'Optional extension: add live parameter metadata for procedures/functions and version-aware hints for Azure SQL-only features.',
    ],
  ),
  'object-views': strong(
    'SQL Server object views render compact storage, index, workload, security, Agent, Extended Events, Query Store, XML Showplan, runtime DMV, and file-workflow posture instead of falling back to generic JSON.',
    [
      'Optional extension: add richer editors for grants, jobs, event sessions, and Query Store settings after live management execution is separately validated.',
    ],
  ),
  'guarded-operations': strong(
    'SQL Server guarded operations cover statistics, index maintenance, Query Store workload review, metrics, import/export, backup package creation, and restore-package validation with confirmation and read-only guardrails; destructive/native restore and broader live management execution remain preview-first.',
    [
      'Optional extension: promote selected statistics, index, Agent, Extended Events, grants, and native BACKUP/RESTORE execution only after live fixture coverage and rollback boundaries are proven.',
    ],
  ),
  'diagnostics-performance': strong(
    'SQL Server diagnostics include rendered SHOWPLAN_TEXT/XML Showplan payloads, Query Store status/top-query/forced-plan/regression signals, runtime DMV payloads for cached queries, requests, waits, file I/O, memory grants, transactions, missing indexes, and Agent/Extended Events warnings.',
    [
      'Optional extension: add live Query Store setting edits, server-side trace/session controls, and Azure Monitor correlation only when those operational claims enter scope.',
    ],
  ),
  'import-export': strong(
    'SQL Server now has guarded desktop CSV/JSON/NDJSON table export/import, bounded JSON/SQL logical backup package creation, and restore-package validation with absolute path, overwrite, row/table limit, read-only, and column-validation guardrails.',
    [
      'Optional extension: native .bak BACKUP/RESTORE, bcp/sqlcmd, identity insert, and bulk-load workflows stay outside the scoped claim until live validated.',
    ],
  ),
  tests: strong(
    'SQL Server is covered by browser/Rust manifest, planner, object-view, connection-option, row-edit, plan-rendering, DMV payload, and file-workflow contract tests; live server fixture coverage remains optional for scoped claims.',
    [
      'Optional extension: add seeded SQL Server fixture validation for import/export/backup packages, Query Store, Agent, Extended Events, and Azure SQL permission variants.',
    ],
  ),
})

const MYSQL_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'MySQL now has typed native connection/profile options for TCP, Unix socket, Cloud SQL socket, managed metadata, password/auth-mode metadata, SSL modes, certificate paths, charset, collation, time zone, statement cache capacity, and connect/command timeouts. The right drawer, browser request validation, Rust model interpolation, connection-test timeout routing, seed fixtures, and SQLx-supported DSN parameters stay in sync without storing secret values.',
    [
      'Optional extension: cleartext plugin and IAM token auth remain plan-only disabled reasons until live runtime support and fixture-backed permission evidence are added.',
    ],
  ),
  'object-tree': strong(
    'MySQL now exposes Workbench-style live tree branches for databases, system schemas, tables, views, routines, events, triggers, indexes, storage, users/roles/grants, sessions, status counters, slow queries, performance_schema, metadata locks, optimizer trace, InnoDB status, and replication, with browser-preview and Rust routing kept aligned.',
    [
      'Optional extension: add version-aware capability hiding for plugins, replication modes, and restricted performance_schema tables when optional live fixtures are available.',
    ],
  ),
  'query-surface': strong(
    'MySQL now has a dialect-aware SQL SELECT builder with backtick identifier output and MySQL boolean literal handling, plus MySQL-native query-helper snippets for bounded SELECTs, EXPLAIN FORMAT=JSON, optimizer trace capture, processlist/wait review, statement digest profiles, metadata locks, routine inventory, and routine calls.',
    [
      'Optional extension: add visual controls for optimizer/index hints, routine parameters, generated-column filters, and EXPLAIN ANALYZE variants when those deeper MySQL workflows enter scope.',
    ],
  ),
  intellisense: strong(
    'MySQL IntelliSense now layers MySQL keywords, functions, information_schema and performance_schema catalog helpers, routine call/definition snippets, backtick-safe identifier quoting, and backtick-aware alias completions over the shared SQL metadata provider.',
    [
      'Optional extension: add version-aware system variable, storage engine, plugin, and function suggestions from live MySQL metadata when fixture coverage is available.',
    ],
  ),
  'object-views': strong(
    'MySQL object views now render native database/table/view/routine/event/security/storage/diagnostic descriptors, Workbench-style storage/index/security/session/status/performance_schema/optimizer/InnoDB/replication posture cards, detailed statement digest, table/index I/O, metadata-lock, optimizer-trace, and status-counter sections, and focused workflow/action strips for table maintenance, routine calls, event toggles, user-account previews, explain/profile, export, and backup plans.',
    [
      'Optional extension: add richer visual controls for optimizer traces, grant editing, replication channels, generated-column mapping, and live maintenance execution after fixture-backed permission checks are available.',
    ],
  ),
  'guarded-operations': strong(
    'MySQL guarded operations now emit structured browser/Rust workflow contracts for CHECK/ANALYZE/OPTIMIZE/REPAIR table maintenance, parameter-aware routine execution previews, event enable/disable previews, security inspection, user account lock/unlock previews, live diagnostics, and guarded desktop file workflows, with explicit privileges, read-only blocks, confirmation requirements, disabled reasons, and residual-risk wording.',
    [
      'Optional extension: promote selected maintenance, routine, event, user, and grant execution only after live privilege checks, rollback boundaries, and fixture-backed scheduler/account evidence are proven.',
    ],
  ),
  'diagnostics-performance': strong(
    'MySQL diagnostics now collect rendered EXPLAIN payloads, live SHOW GLOBAL STATUS metrics, processlist sessions joined to performance_schema waits, statement digest workload profiles, table/index I/O wait profiles, metadata lock posture, InnoDB status counters, optimizer trace availability, browser-preview parity, and Workbench-style object-view cards for performance_schema and optimizer/status surfaces.',
    [
      'Optional extension: add optional fixture evidence for performance_schema visibility and optimizer trace permissions when live MySQL validation is available.',
    ],
  ),
  'import-export': strong(
    'MySQL now has guarded desktop CSV/JSON/NDJSON table export/import, validation-only import, insertable-column validation for auto/generated columns, read-only import blocking, bounded JSON/SQL logical backup package creation, and restore-package validation with concrete path, overwrite, row/table limit, and confirmation guardrails; browser and Rust planners emit matching workflow contracts.',
    [
      'Optional extension: LOAD DATA INFILE, mysqlpump/mysqldump parity, generated-column mapping controls, and full restore execution stay outside the scoped claim until live validated.',
    ],
  ),
  tests: strong(
    'MySQL is covered by shared SQL builder/tree/object-view/row-edit/operation-plan tests plus focused browser/Rust coverage for typed connection-option validation, right-drawer fields, auth disabled reasons, profile interpolation, SQLx DSN option mapping, MySQL IntelliSense snippets, backtick-aware alias completions, MySQL SELECT builder output, Workbench-style diagnostics, performance_schema object-view detail sections and workflow chips, optimizer trace request templates, MySQL-family metrics preview payloads, structured maintenance/routine/event/security/user planner contracts, live file-workflow manifests, guarded workflow planner contracts, CSV parsing, quoted identifiers, insert statements, SQL backup guards, and restore-package validation.',
    [
      'Next: add optional MySQL fixture validation for performance_schema visibility, import/export files, permission-denied writes, and backup-package evidence.',
    ],
  ),
})

const MARIADB_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'MariaDB now has typed native connection/profile options through the MySQL-family form with MariaDB-labeled auth guidance, managed-MariaDB mode metadata, server flavor, SQL mode, default storage engine, charset/collation, LOCAL INFILE metadata, SSL, timeout, socket, Cloud SQL socket, and secret-safe Rust interpolation/redaction coverage.',
    [
      'Next: add optional live fixture evidence for MariaDB-specific authentication plugins, cloud-managed variants, and LOCAL INFILE runtime boundaries.',
    ],
  ),
  'object-tree': strong(
    'MariaDB now has Workbench-style shared, Rust, and browser-preview tree branches with MariaDB-labeled schemas, role-aware security leaves for mysql.user is_role and mysql.roles_mapping, and diagnostics leaves for server variables, storage engines, ANALYZE FORMAT=JSON, InnoDB status, replication, status counters, sessions, performance_schema, slow queries, and metadata locks while hiding MySQL-only optimizer trace.',
    [
      'Next: add optional live capability hiding for version-specific performance_schema, role catalog, storage-engine, plugin, and replication metadata availability.',
    ],
  ),
  'object-views': strong(
    'MariaDB now has native descriptor-backed object views for MariaDB roles, role mappings, server variables, storage engines, ANALYZE FORMAT=JSON profile metadata, routines, events, storage, security, diagnostics, and performance_schema payloads, with MariaDB-specific posture cards, table sections, workflow routing, and browser/Rust payload parity while hiding MySQL-only optimizer-trace views.',
    [
      'Next: add optional live fixture evidence for version-specific role catalogs, routine/event metadata depth, storage-engine differences, and rendered ANALYZE FORMAT=JSON payload variety.',
    ],
  ),
  'query-surface': strong(
    'MariaDB now has explicit dialect query/profile previews for EXPLAIN FORMAT=JSON and guarded ANALYZE FORMAT=JSON, while continuing to share the live SQL and primary-key row-edit base with MySQL-family adapters.',
    [
      'Optional extension: add deeper MariaDB visual controls for optimizer switches, roles, routines, events, and version-aware feature availability.',
    ],
  ),
  intellisense: strong(
    'MariaDB IntelliSense now uses the MySQL-family metadata provider with MariaDB-specific labels, backtick-safe identifiers, ANALYZE FORMAT=JSON, status/version/storage-engine, role-mapping, routine, performance_schema, processlist, statement-digest, and metadata-lock helpers, while hiding MySQL-only optimizer trace snippets.',
    [
      'Next: add version-aware system variable, storage engine, plugin, role, routine, and function suggestions from live MariaDB metadata when fixture coverage is available.',
    ],
  ),
  'diagnostics-performance': strong(
    'MariaDB diagnostics now have browser/Rust-aligned contracts for status counters, version variables, storage engines, processlist sessions, performance_schema statement digests, table/index I/O waits, metadata locks, role mappings, Aria counters, and ANALYZE FORMAT=JSON profile samples with MariaDB-labeled metrics and object-view posture cards.',
    [
      'Next: add optional live fixture evidence for MariaDB performance_schema visibility, role catalog visibility, storage-engine differences, and ANALYZE FORMAT=JSON permission/load boundaries.',
    ],
  ),
  'guarded-operations': strong(
    'MariaDB guarded operations now emit MariaDB-specific browser/Rust workflow contracts for CHECK/ANALYZE/OPTIMIZE/REPAIR table maintenance, parameter-aware routine execution previews, event enable/disable previews, security inspection with mysql.roles_mapping, user account lock/unlock previews, live diagnostics, and guarded desktop file workflows, with explicit privileges, read-only blocks, confirmations, disabled reasons, and residual-risk wording.',
    [
      'Optional extension: promote selected routine, event, account-management, and table-maintenance execution only after live MariaDB privilege, scheduler, storage-engine, and rollback boundaries are fixture-validated.',
    ],
  ),
  'import-export': strong(
    'MariaDB now has guarded desktop CSV/JSON/NDJSON table export/import, validation-only import, insertable-column validation for generated/auto columns, read-only import blocking, bounded JSON/SQL logical backup package creation, and restore-package validation with concrete path, overwrite, row/table limit, and confirmation guardrails; browser and Rust planners emit matching mariadb.* workflow contracts.',
    [
      'Optional extension: LOAD DATA INFILE, mariadb-dump/mysql dump parity, generated-column mapping controls, and full restore execution stay outside the scoped claim until live validated.',
    ],
  ),
  tests: strong(
    'MariaDB is covered by shared SQL builder/tree/object-view/row-edit/operation-plan/rendered-plan tests plus focused right-drawer, browser validation, Rust interpolation, shared/Rust/browser tree, IntelliSense, EXPLAIN FORMAT=JSON, ANALYZE FORMAT=JSON, status/version/storage-engine diagnostics, Aria metrics, role-aware security inspection, MariaDB descriptor, object-view section, posture-card, browser payload, guarded operation, live file-workflow manifest, browser/Rust planner, and restore-package validation coverage.',
    [
      'Next: add optional MariaDB fixture validation for role visibility, performance_schema payloads, routine/event previews, import/export files, permission-denied writes, and backup-package evidence.',
    ],
  ),
})

const SQLITE_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'SQLite has local file open/create flows, connection-string parsing, read-only and immutable modes, PRAGMA-backed options, local database creation, and explicit encryption-provider gating.',
    [
      'Optional extension: add SQLCipher/provider-specific live builds only when encrypted SQLite support enters the release claim.',
    ],
  ),
  'object-tree': strong(
    'SQLite exposes native main/attached database roots, table/view/index/trigger folders, virtual-table branches, generated columns, schema definitions, and PRAGMA diagnostics without synthetic object leaves.',
    [
      'Optional extension: add richer extension-specific virtual table branches when live module metadata proves the module is available.',
    ],
  ),
  'query-surface': strong(
    'SQLite supports raw SQL, scoped SELECT builders, bounded table/view query templates, EXPLAIN QUERY PLAN, EXPLAIN bytecode profile mode, and read-only mutation guards.',
    [
      'Optional extension: add more SQLite-specific snippets for common CTE, JSON1, FTS, and window-function workflows.',
    ],
  ),
  intellisense: strong(
    'SQLite uses the shared SQL metadata-aware IntelliSense path with scoped schema/table/column context, SQL keywords, and SQLite quoting behavior.',
    [
      'Optional extension: add deeper PRAGMA, virtual-table module, JSON1, and FTS function completions from live SQLite compile options.',
    ],
  ),
  'object-views': strong(
    'SQLite object views cover file posture, attached databases, tables, views, columns, indexes, triggers, constraints, foreign keys, statistics, PRAGMAs, schema SQL, virtual tables, FTS/RTree hints, generated columns, and maintenance posture.',
    [
      'Optional extension: add richer trigger body parsing, expression-index summaries, and extension-specific panels.',
    ],
  ),
  'safe-editing': strong(
    'SQLite insert/update/delete row edits execute live only when a concrete table, complete primary-key identity for update/delete, read-only state, environment guardrails, and confirmation checks pass.',
    [
      'Optional extension: add before/after changed-row snapshots when the adapter can fetch them without widening predicates.',
    ],
  ),
  'guarded-operations': strong(
    'SQLite guarded operations cover integrity checks, analyze, optimize, vacuum, reindex previews, and live desktop file workflows for database backup, table/view export, and table import with concrete path and confirmation checks.',
    [
      'Optional extension: promote selected trigger/index authoring and restore workflows only after preview, rollback, and file-lock handling are proven.',
    ],
  ),
  'diagnostics-performance': strong(
    'SQLite diagnostics collect PRAGMA page/page-size/freelist/foreign-key/version/application/journal/synchronous/quick-check signals, attached databases, object counts, metrics payloads, and rendered plan/bytecode payloads.',
    [
      'Optional extension: add deeper sqlite_stat*, WAL checkpoint, compile-option, and long-running lock diagnostics.',
    ],
  ),
  'import-export': strong(
    'SQLite has guarded desktop live file workflows for VACUUM INTO database backups, bounded table/view export to CSV/JSON/NDJSON, and CSV/JSON/NDJSON table import into explicit existing targets with read-only, absolute-path, overwrite, row-limit, validation-only, and confirmation guardrails; browser preview remains plan-only.',
    [
      'Optional extension: add restore execution, typed CSV mapping controls, and larger streaming fixtures if those workflows enter the scoped claim.',
    ],
  ),
  tests: strong(
    'SQLite has connection option, tree, object-view, operation-plan, query/explain, row-edit, structure, browser-preview, adapter fixture, and live file-workflow unit tests.',
    [
      'Optional extension: add dedicated restore and extension-module fixture tests when those claims are in scope.',
    ],
  ),
})

const ORACLE_RELATIONAL_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'Oracle connection flow now has typed service-name, SID, TNS alias, Easy Connect, TCPS/cloud-wallet, wallet/certificate, proxy user, connection role, SQLPlus runtime/path, NLS, fetch-size, timeout, pool, client identifier, application, and edition option contracts across shared types, right-drawer fields, Rust descriptor interpolation, connection-test runtime warnings, and secret-safe pass-through.',
    [
      'Optional extension: add broader live fixture coverage for wallet, TNS alias, proxy-user, role, and managed-service connection variants without storing wallet or credential material.',
    ],
  ),
  'object-tree': strong(
    'Oracle exposes SQL Developer-style container, schema, table, view, materialized view, synonym, sequence, PL/SQL function/procedure/package/type, JSON collection, external table, database link, security, storage, performance, and diagnostics branches across shared tree manifests, browser preview routing, Rust explorer routing, and focused sidebar tests, while optional enterprise surfaces stay hidden unless requested or granted.',
    [
      'Optional extension: add live capability probing for DBA/V$/GV$, Data Guard, RAC, Scheduler, Queue, Flashback, and managed-service surfaces before promoting those branches beyond permission-aware previews.',
    ],
  ),
  'query-surface': strong(
    'Oracle now has a guarded live SQLPlus query surface when a SQLPlus runtime/path is configured: the desktop adapter uses a single-statement read guard, SQLPlus /nolog stdin credential flow, password redaction, request timeouts, bounded row wrapping, CSV normalization, EXPLAIN PLAN/DBMS_XPLAN result handling, Oracle-specific query templates, SQL Developer-style object query actions, safe contract fallback, and optional fixture evidence for DBMS_XPLAN output.',
    [
      'Optional extension: add a thin-driver or OCI-native path, cancellation, server-side cursor paging, and live SQL Monitor report rendering after client prerequisites are documented.',
      'Keep PL/SQL mutation/admin execution behind guarded operation planners until permission, transaction, and rollback boundaries are adapter-backed.',
    ],
  ),
  intellisense: strong(
    'Oracle IntelliSense now layers Oracle keywords, functions, DBMS_XPLAN, SQL Monitor, session/wait, invalid-object, compile-error, package-source, function, procedure, and package snippets plus Oracle-safe identifier quoting on top of the shared SQL metadata provider.',
    [
      'Optional extension: enrich completions from live ALL_ARGUMENTS, ALL_SOURCE, ALL_SYNONYMS, DBA_/V$ capability probes, and package overload metadata once live metadata loaders are added.',
    ],
  ),
  'object-views': strong(
    'Oracle object views are descriptor-backed for containers, schemas, tables, views, materialized views, PL/SQL functions/procedures/packages/types, security, storage, sessions, waits, locks, SQL Monitor, execution plans, diagnostics, invalid objects, grants, DDL, indexes, constraints, triggers, partitions, statistics, dependencies, and permissions, with focused workspace/helper/menu tests and rendered PL/SQL source kept behind explicit reveal.',
    [
      'Optional extension: replace remaining contract-preview payloads with live dictionary payloads and permission-specific empty states after the Oracle runtime path is available.',
    ],
  ),
  'safe-editing': strong(
    'Oracle row editing now has a scoped SQLPlus-backed live executor for insert/update/delete row flows with table validation, primary-key or ROWID identity, bounded before/after evidence, read-only and confirmation guards, explicit commit only after evidence collection, and plan-only downshift when SQLPlus is not configured.',
    [
      'Optional extension: add thin/OCI driver execution, richer affected-row telemetry, cancellation, and fixture variants for proxy-user, wallet, and role-gated edit failures.',
      'Keep DDL, grant, compile, import/export, Data Pump, and RMAN workflows preview-first until Oracle permission checks and rollback boundaries are adapter-backed.',
    ],
  ),
  'guarded-operations': strong(
    'Oracle guarded operations cover query explain/profile, index create/drop, object refresh, create/drop previews, session/security/storage/metrics inspections, SQLPlus/SQLcl import/export plans, Data Pump wording, and RMAN backup/restore previews with explicit review, permission, and preview-first boundaries in browser and Rust planners.',
    [
      'Optional extension: add permission-aware live executors for selected compile/grant/DDL/session actions only after transaction, confirmation, and rollback handling are proven.',
    ],
  ),
  'diagnostics-performance': strong(
    'Oracle diagnostics now include DBMS_XPLAN-shaped plan/profile payloads, SQL Monitor templates, V$SESSION/V$LOCK/V$SQL_MONITOR warnings, storage/security/profile metrics, invalid-object and compile-error object views, and optional fixture evidence for DBMS_XPLAN output, SQL Monitor visibility or denial, restricted dictionary denial, PL/SQL compile errors, and seeded storage/catalog metadata.',
    [
      'Optional extension: add live runtime sampling for V$/GV$, ASH/AWR where licensed/granted, SQL Monitor report rendering, and dictionary-specific disabled reasons from adapter-owned errors.',
    ],
  ),
  'import-export': strong(
    'Oracle import/export and backup/restore are covered as native preview workflows: SQLPlus/SQLcl bounded CSV-style export/import evidence, Data Pump review wording, RMAN backup/restore request templates, object-view actions, browser/Rust operation plans, and optional fixture boundary checks are in place while file/database execution stays preview-first.',
    [
      'Optional extension: promote selected Data Pump, SQLcl file, or RMAN workflows only after directory grants, file paths, TDE/wallet state, recovery target, and rollback/confirmation guardrails are adapter-backed.',
    ],
  ),
  tests: strong(
    'Oracle has deterministic tree, object-view, operation-plan, DBMS_XPLAN-shaped contract, IntelliSense, browser-preview, Rust explorer/query/editing, SQLPlus script/CSV/redaction unit coverage, and Oracle optional fixture validator coverage for seeded volume, dictionary/security/storage metadata, DBMS_XPLAN, SQL Monitor boundaries, PL/SQL compile diagnostics, row identity primitives, SQLPlus export/import boundaries, restricted dictionary denial, and Data Pump/RMAN preview boundaries.',
    [
      'Add optional live SQLPlus edit execution tests and thin/OCI driver tests once Oracle client prerequisites and CI-safe credentials are documented.',
      'Add adapter-owned browser/Rust coverage for permission-specific dictionary and SQL Monitor disabled reasons once live errors are normalized.',
    ],
  ),
})

const TIMESCALE_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'connection-flow': strong(
    'TimescaleDB now has typed PostgreSQL-wire connection options plus Timescale-specific deployment, project/service, region, extension schema/version, server version, license, policy disabled-reason, and capability metadata. The right drawer, browser validation, Rust profile interpolation, connection-test extension warnings, and rendered profile posture stay in sync without storing secret values.',
    [
      'Next: add optional live Timescale Cloud/service capability probing and fixture evidence for constrained extension schemas and managed-service roles.',
    ],
  ),
  'object-tree': strong(
    'TimescaleDB exposes native hypertable, chunk, compression, retention, continuous aggregate, job, diagnostics, and PostgreSQL security branches, with browser inspections returning restricted warnings when profile capabilities hide catalog surfaces, Rust live inspections normalizing chunk ranges, compressed chunks, policy jobs, continuous aggregate internals, job statistics, and derived dashboard rows, and optional live fixture validation covering restricted catalog visibility, compressed chunks, aggregate lag, Toolkit variants, and failed-job diagnostic surfaces.',
    [
      'Optional extension: add Timescale Cloud/service capability probing and managed-service role/version variants outside the scoped native-complete claim.',
    ],
  ),
  'query-surface': strong(
    'TimescaleDB uses the PostgreSQL-wire SQL editor, scoped SQL SELECT builders, PostgreSQL EXPLAIN payload rendering, query-profile previews, time-bucket query templates, and Timescale-aware operation planners for compression, retention, continuous aggregate refresh, job, import/export, and backup workflows.',
    [
      'Optional extension: add a richer visual time-bucket builder and live EXPLAIN ANALYZE promotion only after profile execution guardrails are adapter-backed.',
    ],
  ),
  intellisense: strong(
    'TimescaleDB inherits PostgreSQL metadata-backed SQL IntelliSense and adds Timescale-aware query-helper coverage for hypertables, continuous aggregates, time_bucket/time_bucket_gapfill functions, profile snippets, and safe quoted identifiers through the shared SQL completion path.',
    [
      'Optional extension: add live Toolkit-specific aggregate/function completions when a Toolkit-installed fixture image is available.',
    ],
  ),
  'object-views': strong(
    'TimescaleDB object views render Timescale profile posture, hypertable/policy/aggregate/diagnostic cards, time-bucket dashboards, chunk sizing panels, compression coverage, continuous aggregate freshness, job history, and richer live owner/chunk/job/aggregate fields instead of falling back to raw JSON.',
    [
      'Optional extension: add Timescale Cloud-specific dashboard variants and more managed-service warning states.',
    ],
  ),
  'safe-editing': strong(
    'TimescaleDB now pins PostgreSQL-wire row edits as Timescale-specific evidence plans: browser and Rust previews show bounded primary-key prefetches plus RETURNING * mutation/after evidence, Rust live scopes treat Timescale row edits as table writes instead of generic time-series writes, and chunk/compression/retention/continuous aggregate policy changes remain separate guarded operation previews.',
    [
      'Optional extension: add generated-column, trigger, and more multi-column time/space identity stress fixtures outside the scoped claim.',
    ],
  ),
  'guarded-operations': strong(
    'TimescaleDB guarded operation parity now covers profile-specific disabled reasons plus browser/Rust planners for compression policy, retention policy, continuous aggregate refresh, job control, import/export, and backup/restore previews with confirmation, permission, chunk, policy, continuous-aggregate impact wording, and explicit plan-only execution-boundary preflights.',
    [
      'Scoped decision: compression, retention, refresh, job-control, import/export, backup, and restore execution stays preview-first; promote selected live workflows only after a separate adapter-owned executor adds permission checks, rollback boundaries, file-path guards, and fixture evidence.',
    ],
  ),
  'import-export': strong(
    'TimescaleDB import/export and backup/restore previews are native TimescaleDB workflows: browser and Rust planners emit hypertable, chunk, compression, job, continuous-aggregate, extension-version, bounded time-window, CSV/JSON staging, pg_dump, and pg_restore preflights while explicitly keeping file execution preview-first for the scoped claim.',
    [
      'Optional extension: promote selected file workflows only after adapter-owned file validation, chunk/policy impact checks, and restore-package guardrails exist.',
    ],
  ),
  'diagnostics-performance': strong(
    'TimescaleDB has rendered PostgreSQL EXPLAIN payloads, profile-aware catalog diagnostics, compact compression/retention/refresh signals, live-derived chunk sizing, compression coverage, aggregate freshness, job-history rows, job reliability signals, Toolkit availability diagnostics, visible time_bucket/time_bucket_gapfill function diagnostics, bounded time-bucket window summaries, optional pg_stat_statements time-bucket query-duration samples, and rendered dashboard sections for those payloads.',
    [
      'Optional extension: add pg_stat_statements-disabled and Toolkit-installed image variants outside the scoped claim.',
    ],
  ),
  tests: strong(
    'TimescaleDB is covered by shared SQL/tree/object-view/row-edit/operation-plan tests plus focused browser/Rust coverage for typed profile validation, right-drawer fields, Rust interpolation, extension metadata warnings, capability-restricted payloads, rendered profile posture, time-bucket/chunk-sizing/compression/aggregate-freshness/job-history dashboards, live metadata normalizers, before/after row-edit evidence plans, policy disabled reasons, object-view action strips, guarded policy/job-control previews, native import/export preflights, backup/restore previews, and a live-run optional TimescaleDB fixture validator for extension/catalog metadata, hypertable row evidence, restricted-role visibility, continuous aggregate metadata, policy/job boundaries, compressed chunks, aggregate lag, Toolkit variants, bounded file-copy evidence, and failed-job diagnostics.',
    [
      'Optional extension: add managed Timescale Cloud, Toolkit-installed, and pg_stat_statements-disabled fixture variants outside default CI.',
    ],
  ),
})

const SEARCH_PROFILE = profile({
  'connection-flow': strong(
    'Search connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, redaction, and explicit live-runtime disabled reasons for HTTP, Elastic Cloud, managed OpenSearch, AWS SigV4, default-index, TLS, and credential metadata.',
    [
      'Contract-only residual risk: promote cloud/IAM, certificate, API key, bearer token, and SigV4 combinations into the live HTTPS/runtime path after fixture or cloud validation.',
    ],
  ),
  'object-tree': strong(
    'Indexes, data streams, aliases, cluster, security, lifecycle, shard, segment, template, and ingest sections are pinned in shared/Rust tree manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen live plugin/capability detection for ILM/ISM, security, Performance Analyzer, vector, and snapshot sections.',
    ],
  ),
  'query-surface': strong(
    'Query DSL builder covers match, term, range, query-string, filters, source fields, sort clauses, and terms/date-histogram/histogram/metric/cardinality aggregations; bounded live search, explain/profile request modes, search-hit tables, aggregation payloads, and normalized profile stages are covered for the scoped claim.',
    [
      'Optional extension: add ES|QL/OpenSearch SQL, mapping-aware aggregation validation, and endpoint-specific query helpers where the engine reports support.',
    ],
  ),
  intellisense: strong(
    'Search DSL suggestions include deterministic keys, index names, mapped fields, and query/aggregation snippets from cached metadata contracts.',
    [
      'Contract-only residual risk: add live mapping-aware field boosting, analyzer-aware snippets, and aggregation validation from endpoint metadata.',
    ],
  ),
  'object-views': strong(
    'Search object-view parity is pinned across descriptor-backed workflows, focused descriptor tests, cluster/index/security/slow-log/allocation posture panels, profile-friendly workspaces, and guarded action strips for explain/profile, lifecycle, ingestion, security, bulk, snapshot, and restore workflows.',
    [
      'Contract-only residual risk: deepen rendered live profile/explain detail, index/security management screens, and plugin-aware payloads after fixture/live validation.',
    ],
  ),
  'safe-editing': strong(
    'Explicit-id search document index/update/delete edits execute through the native adapter only when index, document id, read-only, and confirmation guardrails pass, with before/after `_doc` evidence captured around the mutation request.',
    [
      'Optional extension: add bulk-safe validators, fixture/live coverage for auth-specific failures, and richer conflict/sequence-number handling.',
    ],
  ),
  'guarded-operations': strong(
    'Search guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, preview-first execution gates, disabled reasons, confirmations, explicit scoped exclusions for broader live admin execution, and HTTP-shaped index/template/pipeline/lifecycle/task/snapshot/alias/rollover/bulk/security/slow-log/allocation requests.',
    [
      'Optional extension: promote selected live admin execution only after capability, permission, rollback, and environment checks are adapter-backed.',
    ],
  ),
  'diagnostics-performance': strong(
    'Search diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, slow-log/allocation dashboard payloads, query profile plans, Rust metrics/profile/slow-log/allocation request planning, normalized profile-stage result payloads, and profile-friendly result modes for cluster, shard, segment, lifecycle, metrics, and profile workflows.',
    [
      'Optional extension: add live OpenSearch Performance Analyzer dashboards and deeper rendered live profile dashboards after separate fixture/live validation.',
    ],
  ),
  'import-export': strong(
    'Search import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, preview-first execution gates, bounded fixture `_search` export plus `_bulk` import primitives, reindex, snapshot, and restore HTTP-shaped requests; desktop file/cloud import-export execution remains explicitly outside the scoped claim.',
    [
      'Optional extension: add adapter-owned desktop file workflows and promote selected export/snapshot flows after separate fixture/live validation.',
    ],
  ),
  tests: strong(
    'Search builder, aggregation parsing, runtime-boundary, object-view operation, slow-log/allocation dashboard, normalized profile payload, explicit-id data-edit evidence, browser-preview, manifest, Rust planner, and optional search fixture validator coverage now cover the scoped search claim.',
    [
      'Optional extension: add cloud-auth fixture validation and deeper rendered profile/explain UI coverage.',
    ],
  ),
})

const WIDE_COLUMN_PROFILE = profile({
  'connection-flow': strong(
    'Wide-column connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for Cassandra contact-point, secure-bundle, TLS, auth, consistency, retry, and load-balancing metadata; DynamoDB has a dedicated native-complete profile override for its local/AWS modes.',
    [
      'Contract-only residual risk: promote Cassandra contact-point, TLS, auth, policy, and secure-bundle options into a live CQL driver path.',
    ],
  ),
  'object-tree': strong(
    'DynamoDB tables/indexes/TTL/streams/backups and Cassandra keyspaces/tables/indexes/materialized views/security/diagnostics sections are pinned in shared/Rust tree manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen permission-aware optional sections from live metadata and hide unavailable cloud/CQL features by detected capability.',
    ],
  ),
  'query-surface': partial(
    'DynamoDB key-condition requests include consumed-capacity and pagination payloads; Cassandra CQL requests include partition-key, tracing, and ALLOW FILTERING guardrails.',
    [
      'Add PartiQL, richer CQL templates, and live driver-backed cost/capacity feedback for cloud and cluster deployments.',
    ],
  ),
  intellisense: strong(
    'DynamoDB and Cassandra suggestions include deterministic keywords, table/keyspace/table names, key/index-aware fields, and expression/CQL helper snippets.',
    [
      'Contract-only residual risk: add live key/index-specific expression validation, Cassandra type-aware UDF completions, and permission-aware suggestions.',
    ],
  ),
  'object-views': strong(
    'Wide-column object-view parity is pinned across DynamoDB and Cassandra descriptor-backed workflows, focused descriptor tests, key/capacity/TTL/stream/backup panels, partition/storage/compaction/tracing panels, and guarded action strips for table, index, access, diagnostics, import/export, and backup workflows.',
    [
      'Contract-only residual risk: deepen live object-view payloads and richer editors for table, item, index, tracing, partition, and cluster workflows after SDK/CQL validation.',
    ],
  ),
  'safe-editing': partial(
    'DynamoDB item put/update/delete execution exists behind complete-key, read-only, and confirmation guards; Cassandra row edits remain contract-only.',
    [
      'Add Cassandra primary-key-safe row edit execution only after the live CQL driver path exists.',
    ],
  ),
  'guarded-operations': strong(
    'Wide-column guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and DynamoDB/Cassandra table/index/TTL/stream/throughput/tracing/repair/import-export/backup-style requests.',
    [
      'Contract-only residual risk: promote selected safe operations to live execution only after capability and environment guard checks.',
    ],
  ),
  'diagnostics-performance': strong(
    'Wide-column diagnostics/performance parity is pinned across diagnostics tree roots, DynamoDB/Cassandra object-view posture panels, browser diagnostics payloads, query/profile plans, Rust metrics/profile request planning, and deterministic capacity, hot-partition, tracing, compaction, repair, and cluster-status signals.',
    [
      'Contract-only residual risk: connect live CloudWatch/account metrics and optional Cassandra nodetool/JMX-backed diagnostics.',
    ],
  ),
  'import-export': strong(
    'Wide-column import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, DynamoDB export/import/backup/restore requests, and Cassandra cqlsh COPY/nodetool snapshot/SSTable restore plans.',
    [
      'Contract-only residual risk: promote file-backed import/export and backup/restore only after DynamoDB Local/cloud and Cassandra fixture validation are available.',
    ],
  ),
  tests: partial(
    'Builder, edit-plan, object-view, operation-preview, connection-option UI, validation, and migration tests exist for the wide-column slice.',
    [
      'Add optional live fixture tests for DynamoDB Local and Cassandra-compatible drivers when dependencies are available.',
    ],
  ),
})

const DYNAMODB_PROFILE = profile({
  ...WIDE_COLUMN_PROFILE,
  'connection-flow': strong(
    'DynamoDB connection flow is pinned across typed local endpoint, endpoint override, static key, shared profile, STS AssumeRole, web identity, ECS task, EC2 metadata, retry, timeout, consumed-capacity, right-drawer, browser validation, Rust interpolation, redaction, deterministic local SigV4-shaped execution, and optional live AWS credential-provider validation paths.',
    [
      'Scoped native-complete residual risk: the desktop runtime executes local/endpoint-override HTTP JSON API paths; production AWS HTTPS execution remains covered by the opt-in cloud validator and future SDK-backed runtime work.',
    ],
  ),
  'query-surface': strong(
    'DynamoDB key-condition, projection/filter expression planning, conditional-write expression planning, Scan, GetItem, DescribeTable, DescribeLimits, ListTables, and guarded read-only PartiQL ExecuteStatement requests execute through the adapter with consumed-capacity, pagination payloads, typed endpointUrl routing, and SigV4-shaped local/endpoint-override JSON API headers.',
    [
      'Scoped native-complete residual risk: richer live expression authoring, projection validation, and PartiQL explain/cost hints remain optional polish after real table metadata is available.',
    ],
  ),
  'safe-editing': strong(
    'DynamoDB item put/update/delete execution exists behind complete-key, read-only, confirmation, and conditional-write guardrails with consistent GetItem before/after evidence and mutation consumed-capacity metadata; Cassandra row editing remains a separate contract-only path.',
    [
      'Optional polish: add richer conditional-write UI controls for version attributes and item-level optimistic-lock helpers when live schema metadata is available.',
    ],
  ),
  'diagnostics-performance': strong(
    'DynamoDB diagnostics now include deterministic SigV4-shaped auth evidence, credential-mode disabled reasons, live/local ListTables and DescribeLimits capacity signals when supported, ReturnConsumedCapacity guidance, CloudWatch.GetMetricData request plans, IAM simulation boundaries, Rust metrics/profile payloads, browser/Rust preview parity for metrics and access plans, and an opt-in AWS cloud validator for STS identity, ListTables, DescribeLimits, table diagnostics, CloudWatch metrics, IAM simulation, STS AssumeRole, web identity, ECS task credentials, and EC2 metadata credentials.',
    [
      'Scoped native-complete residual risk: live CloudWatch and IAM validation require optional AWS credentials and explicit strict flags; S3 import/export and managed backup execution remain preview-first.',
    ],
  ),
  'import-export': strong(
    'DynamoDB import/export and backup/restore parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, local backup/import-export boundary fixture evidence, AWS-shaped ExportTableToPointInTime, ImportTable, CreateBackup, RestoreTableFromBackup, ListBackups, and DescribeContinuousBackups request plans, plus optional cloud read-only preflights.',
    [
      'Scoped native-complete residual risk: S3 export/import jobs, backup creation/deletion, and restore execution remain preview-first until a cost-aware guarded cloud executor is separately added.',
    ],
  ),
  tests: strong(
    'DynamoDB key-condition, consumed-capacity, SigV4-shaped auth evidence, endpointUrl routing, item edit, operation-preview, object-view, browser-preview, manifest tests, the live-run optional DynamoDB Local fixture validator, and the optional AWS cloud validator cover the promoted scoped native-complete slice, including environment/shared-profile credentials plus opt-in STS AssumeRole, web identity, ECS task, and EC2 metadata credential modes.',
    [
      'Run `fixtures:validate:dynamodb:cloud` with AWS credentials and strict flags when validating cloud IAM/CloudWatch behavior before a release claim expands beyond the scoped read/diagnostic claim.',
    ],
  ),
})

const WAVE4_DOCUMENT_PROFILE = profile({
  'connection-flow': strong(
    'Document connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, local file handling, and redaction for Cosmos account/API/auth/region metadata and LiteDB local-file guardrails.',
    [
      'Contract-only residual risk: promote Azure SDK, Entra identity, account-key, and broader LiteDB local-file paths only after live fixture coverage exists; LiteDB encrypted-file success/failure evidence is covered by the opt-in .NET sidecar validator.',
    ],
  ),
  'object-tree': strong(
    'Document trees expose Cosmos account/database/container/region/security sections and LiteDB database/collection/index/storage sections from engine-owned shared/Rust manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen live capability discovery for Cosmos API variants and LiteDB file-lock/encryption states.',
    ],
  ),
  'query-surface': partial(
    'Cosmos SQL request previews and LiteDB collection/query/edit/file previews include native filters, metrics hooks, safe default payloads, LiteDB configured sidecar read-dispatch contracts with local sidecar-process fixture evidence, optional real .NET LiteDB sidecar read/edit validation, encrypted-file success/failure validation, sidecar-backed JSON/NDJSON collection import/export execution, sidecar-backed LiteDB file-storage list/import/export/delete execution, and sidecar-backed LiteDB index/collection management execution.',
    [
      'Contract-only residual risk: add API-specific Cosmos Mongo/Cassandra/Gremlin/Table builders and promote LiteDB beyond optional real-engine read/edit/encryption/file/management workflow validation into exclusive writer-lock safety.',
    ],
  ),
  intellisense: strong(
    'Cosmos DB and LiteDB suggestions include deterministic SQL/JSON keys, database/container/collection names, result fields, partition-key helpers, and bounded query snippets.',
    [
      'Contract-only residual risk: add partition-key, indexing-policy, BSON, and query-shape-aware completions from live metadata.',
    ],
  ),
  'object-views': strong(
    'Document object-view parity is pinned across Cosmos DB and LiteDB descriptor-backed workflows, focused descriptor tests, partition/RU/indexing/distribution panels, local-file/storage/index panels, and guarded action strips for throughput, consistency, failover, access, export, backup, compact, and drop workflows.',
    [
      'Contract-only residual risk: add richer live payloads for region failover, RU trends, file pages, encryption posture, and permission-specific disabled reasons after cloud/local fixture validation.',
    ],
  ),
  'safe-editing': partial(
    'Document and collection edits remain guarded by platform edit contracts and preview-first destructive/admin workflows; LiteDB scoped full-document insert/update/delete plus file-storage import/delete and index create/drop plus collection drop now use sidecar-only live execution with confirmation gates, identity validation, before/after evidence requests, and optional real .NET sidecar validation.',
    [
      'Contract-only residual risk: promote Cosmos document CRUD and broader LiteDB file/storage edits only after identity, partition key, ETag, and writer-lock validation are adapter-backed.',
    ],
  ),
  'guarded-operations': strong(
    'Document guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and Cosmos throughput/consistency/failover/access/metrics/import-export/drop plus LiteDB checkpoint/compact/rebuild/backup/import-export/file-storage/index requests; LiteDB JSON/NDJSON collection import/export, file-storage import/export/delete, and index create/drop plus collection drop now have confirmed sidecar executors.',
    [
      'Contract-only residual risk: keep unsupported cloud/admin execution plan-only until cloud/local permission and writer-lock checks are live.',
    ],
  ),
  'diagnostics-performance': strong(
    'Document diagnostics/performance parity is pinned across diagnostics tree roots, Cosmos/LiteDB object-view posture panels, browser diagnostics payloads, query/profile plans, Rust metrics/profile request planning, and deterministic RU, latency, throttle, query-metric, local-file health, checkpoint, compaction, and index rebuild signals.',
    [
      'Contract-only residual risk: connect Azure Monitor and LiteDB storage/page telemetry after fixture/live validation exists.',
    ],
  ),
  'import-export': strong(
    'Document import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Cosmos partition/format/export plans, and LiteDB collection/file-storage export/backup plans with bounded-file warnings; LiteDB JSON/NDJSON collection export/import and file-storage import/export now execute through the configured sidecar with concrete-path, overwrite, read-only import block, bounded row/file, and before/after evidence.',
    [
      'Contract-only residual risk: add live Cosmos emulator/Azure file workflow evidence plus LiteDB writer-lock validation before broader execution promotion.',
    ],
  ),
  tests: strong(
    'Wave 4 document engines have deterministic manifest, planner, browser-preview, object-view action, and LiteDB sidecar CRUD, encrypted-file, JSON collection import/export, file-storage import/export/delete, and index/collection management validator coverage for the contract slice.',
    [
      'Contract-only residual risk: add live Cosmos emulator/Azure and LiteDB writer-lock fixture tests outside default CI.',
    ],
  ),
})

const WAVE4_CACHE_PROFILE = profile({
  'connection-flow': strong(
    'Memcached connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, server-list routing, TCP no-delay handling, optional SASL metadata, and read-only guardrails.',
    [
      'Contract-only residual risk: promote binary protocol, SASL execution, compression, and multi-server failover only after live fixture coverage exists.',
    ],
  ),
  'object-tree': strong(
    'Memcached exposes server, settings, slabs, item classes, connections, and known-key lookup sections in shared/Rust manifests and browser explorer routing without pretending cache keys are globally enumerable.',
    [
      'Contract-only residual risk: deepen live slab/item metadata and disabled reasons for servers without crawler/stat support.',
    ],
  ),
  'query-surface': partial(
    'Native command previews cover stats, metadata refresh, get/gets, set, touch, increment, decrement, delete, reset, flush, and LRU crawler dumps.',
    [
      'Contract-only residual risk: add binary protocol and multi-server routing once the live executor is available.',
    ],
  ),
  intellisense: strong(
    'Memcached suggestions include deterministic command names, stats variants, known-key targets, slab/item-class objects, CAS reads, and guarded write-preview snippets.',
    [
      'Contract-only residual risk: add argument-aware completions from live version/protocol capability detection.',
    ],
  ),
  'object-views': strong(
    'Memcached object-view parity is pinned across descriptor-backed workflows, focused descriptor tests, cache/slab/item/settings posture panels, known-key workflow surfaces, and guarded action strips for stats, settings, reset, flush, LRU crawler dumps, and explicit-key operations.',
    [
      'Contract-only residual risk: add richer live charts for evictions, hit rate, item age, crawler status, multi-server pressure, and connection churn after protocol fixture validation.',
    ],
  ),
  'safe-editing': partial(
    'Known-key mutations are guarded previews with read-only, confirmation, and plan warnings; broad key browsing remains intentionally unavailable.',
    [
      'Contract-only residual risk: promote selected known-key operations only after live CAS, TTL, and multi-node safety checks exist.',
    ],
  ),
  'guarded-operations': strong(
    'Memcached guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and stats reset, flush, known-key get/gets/set/touch/incr/decr/delete, metrics, and LRU crawler dump requests.',
    [
      'Contract-only residual risk: keep destructive flush and mutation execution plan-only until environment and server-scope checks are live.',
    ],
  ),
  'diagnostics-performance': strong(
    'Memcached diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, Rust metrics request planning, and deterministic stats, settings, slabs, items, connection, eviction, and hit/miss signals.',
    [
      'Contract-only residual risk: connect live stats sampling and multi-node aggregation after optional fixture validation exists.',
    ],
  ),
  'import-export': strong(
    'Memcached import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, and LRU crawler metadata dump previews with explicit warnings that values are not exported unless keys are selected.',
    [
      'Contract-only residual risk: add safe value export/import workflows only for explicitly supplied keys after live validation.',
    ],
  ),
  tests: strong(
    'Memcached has deterministic manifest, planner, browser-preview, and object-view action tests for Wave 4 cache workflows.',
    [
      'Contract-only residual risk: add optional live memcached fixture tests for text, binary, SASL, crawler, and flush guard paths.',
    ],
  ),
})

const WAVE4_ANALYTICS_PROFILE = profile({
  'connection-flow': strong(
    'Analytics connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, local database creation, and redaction for DuckDB, ClickHouse, Snowflake, and BigQuery auth, file, warehouse, dataset, cost, and compute metadata.',
    [
      'Contract-only residual risk: promote every cloud driver, OAuth/IAM, TLS, and local extension mode only after fixture/live validation exists.',
    ],
  ),
  'object-tree': strong(
    'Analytics trees expose local files, schemas, tables, materialized views, stages, jobs, warehouses, datasets, system sections, security, and diagnostics through shared/Rust manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen live capability hiding for cloud permissions, ClickHouse clusters, DuckDB extensions, and warehouse optional features.',
    ],
  ),
  'query-surface': strong(
    'SQL query surfaces include pinned SQL SELECT builders, engine-native explain/profile/dry-run payloads, cost and scan warnings, and import/export request shapes.',
    [
      'Contract-only residual risk: add parameter workflows, richer visual builder dialect polish, and live driver-backed profile feedback per engine.',
    ],
  ),
  intellisense: strong(
    'DuckDB, ClickHouse, Snowflake, and BigQuery use deterministic SQL keyword, object, schema, column, alias, and function suggestions through the shared dialect-aware provider.',
    [
      'Contract-only residual risk: add dialect-aware functions, stages, datasets, extensions, settings, and alias completions from live metadata.',
    ],
  ),
  'object-views': strong(
    'Analytics object-view parity is pinned across DuckDB, ClickHouse, Snowflake, and BigQuery descriptor-backed workflows, focused descriptor tests, local-file/extension/query-log/MergeTree/job/reservation/storage/security posture panels, cloud warehouse insights, and guarded action strips for profile, metrics, access, clone/copy/optimize, import/export, backup, and destructive workflows.',
    [
      'Contract-only residual risk: deepen rendered live query-plan/profile timelines, cost dashboards, cloud permission payloads, and local-file telemetry after fixture/live validation.',
    ],
  ),
  'safe-editing': partial(
    'Warehouse and embedded-OLAP mutation workflows are preview-first with guarded DDL, copy/clone, import/export, and destructive object plans.',
    [
      'Contract-only residual risk: promote live row/table edits only where identity, permissions, dry-run, and transaction/file safety can be proven.',
    ],
  ),
  'guarded-operations': strong(
    'Analytics guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and DuckDB analyze/checkpoint/extension/import/backup, ClickHouse optimize/TTL/freeze/import-export, Snowflake clone/suspend/resume/export, and BigQuery dry-run/copy/export requests.',
    [
      'Contract-only residual risk: keep admin execution plan-only until live permission, cost, and environment checks are adapter-backed.',
    ],
  ),
  'diagnostics-performance': strong(
    'Analytics diagnostics/performance parity is pinned across diagnostics tree roots, warehouse/local object-view posture panels, browser diagnostics payloads, query profile/cost plans, Rust metrics/profile request planning, and deterministic DuckDB profiling/settings, ClickHouse query_log/system metrics, Snowflake query/warehouse history, and BigQuery dry-run/job signals.',
    [
      'Contract-only residual risk: connect live profile graphs, slot/credit usage, cluster metrics, and local file telemetry after optional fixtures exist.',
    ],
  ),
  'import-export': strong(
    'Analytics import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, DuckDB file import/export/backup, ClickHouse file import/export, Snowflake stage copy, and BigQuery extract/load plans with format, local-file, stage, bucket, scan, and cost warnings.',
    [
      'Contract-only residual risk: add adapter-owned file/cloud storage workflows and optional live validation before execution promotion.',
    ],
  ),
  tests: strong(
    'Analytics engines have deterministic manifest, SQL-builder, planner, browser-preview, object-view, and roadmap completeness coverage for the contract slice.',
    [
      'Contract-only residual risk: add optional live DuckDB, ClickHouse, Snowflake, and BigQuery fixture/cloud tests outside default CI.',
    ],
  ),
})

const DUCKDB_PROFILE = profile({
  ...WAVE4_ANALYTICS_PROFILE,
  'connection-flow': strong(
    'DuckDB connection flow is pinned across typed local-file and memory options, right-drawer fields, browser validation, Rust interpolation, timeout selection, local database creation, redaction, and bundled runtime connection tests for temporary `.duckdb` files.',
    [
      'Optional extension: add encrypted/remote filesystem modes, extension-specific connection presets, and stricter file-lock diagnostics only after live validation exists.',
    ],
  ),
  'object-tree': strong(
    'DuckDB tree parity is pinned across shared TypeScript manifests, Rust manifests, browser explorer routing, local database/schema/table/view roots, extension posture, external-file source helpers, PRAGMA diagnostics, and fixture-backed catalog roots for temporary `.duckdb` files.',
    [
      'Optional extension: deepen live capability hiding for version-specific extensions, attached databases, remote filesystems, and external file-source metadata after fixture-backed capability probes exist.',
    ],
  ),
  'query-surface': strong(
    'DuckDB now has bundled local-file read SQL execution, bounded table payloads, read-only SQL guards, native EXPLAIN and EXPLAIN ANALYZE plan/profile payloads, SQL SELECT builder coverage, and optional DuckDB fixture validator evidence for 5,000-row local read/profile queries.',
    [
      'Optional extension: add richer visual local analytics templates, parameter workflows, and file-scan warnings from live query metadata.',
    ],
  ),
  intellisense: strong(
    'DuckDB SQL suggestions cover deterministic SQL keywords, local schemas, tables, columns, aliases, analytics functions, read_csv/read_parquet/read_json helpers, and bounded local-file query snippets through the shared dialect-aware provider.',
    [
      'Optional extension: add extension-aware function suggestions and file-schema-aware completions after live extension and file-scan metadata are available.',
    ],
  ),
  'object-views': strong(
    'DuckDB object-view parity is pinned across descriptor-backed schema/table/view/extension/file/PRAGMA/local-file workspaces, local-file and extension posture panels, guarded file actions, and rendered plan/profile sections.',
    [
      'Optional extension: deepen per-file scan telemetry, storage-layout cards, attached-database views, and extension-specific views after live metadata is fixture-backed.',
    ],
  ),
  'diagnostics-performance': strong(
    'DuckDB diagnostics now combine Rust metrics/profile payloads, version/settings metrics, local catalog/table counts, read_csv/read_parquet/read_json query templates, rendered EXPLAIN/EXPLAIN ANALYZE plan lines, and optional fixture evidence for bundled local-file read/EXPLAIN/profile/catalog paths plus database lock-boundary metadata from file read/write and DuckDB open probes.',
    [
      'Optional extension: add deeper PRAGMA/storage/profile timelines, per-file scan telemetry, extension capability diagnostics, and optional live external-process contention fixtures if the lock claim expands beyond scoped file-workflow preflight.',
    ],
  ),
  'safe-editing': strong(
    'DuckDB safe editing is complete for the scoped local-file analytics claim: generic write, DDL, extension, restore, and administrative SQL are blocked from the query path; live write-like behavior is limited to confirmed CSV table import/export and CSV EXPORT DATABASE backup workflows with database file access, read-only, file-probe, lock-boundary, and confirmation metadata; extension install/load, analyze/checkpoint/object admin, and restore execution stay explicit scoped exclusions with execution-boundary metadata.',
    [
      'Optional extension: promote selected local OLAP mutation/admin or extension workflows only after identity, transaction, deeper cross-process lock, offline source trust, rollback, and fixture evidence exist; otherwise keep them explicitly scoped out.',
    ],
  ),
  'guarded-operations': strong(
    'DuckDB guarded operations are pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, table import/export, database backup, restore preflight, analyze/checkpoint/object admin, extension install/load, scoped file-workflow lock-boundary, and explicit restore/admin/extension execution-boundary metadata.',
    [
      'Optional extension: convert selected preview-first admin, restore, or extension operations to live execution only after writer-lock, rollback/snapshot, offline-source trust, post-operation validation, and fixture-backed confirmation gates are implemented.',
    ],
  ),
  'import-export': strong(
    'DuckDB import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, plan-only file import previews, guarded live generic CSV table import/export execution, guarded live CSV EXPORT DATABASE backup folder execution, concrete-path checks, overwrite and row-limit guardrails, database file access/read-only preflights, read/open/write probes, explicit lock-boundary metadata for scoped file workflows, blocked read-only disk evidence, JSON/Parquet extension-backed format preflight, explicit preloaded-extension-only execution boundaries for JSON/Parquet, controlled extension-directory setup, fail-closed unloaded-extension evidence, restore-package preflight with source folder, schema.sql, load.sql, file-count, byte-count, detected-format, and target write/open validation, and explicit restore execution-boundary metadata that scopes destructive IMPORT DATABASE out of the native claim until snapshot, lock, post-restore validation, and confirmation gates are executable.',
    [
      'Optional extension: only promote preloaded/offline DuckDB extension-backed execution beyond scoped boundary after an extension-loaded fixture exists; keep external-process contention plus broader local analytics mutation/admin promotion outside scope until fixture-backed.',
    ],
  ),
  tests: strong(
    'DuckDB coverage now includes deterministic manifest, SQL-builder, planner, browser-preview, object-view, roadmap completeness, query guard, result/profile, explorer/catalog, diagnostics, and optional DuckDB fixture validator coverage for bundled local-file read/EXPLAIN/profile/catalog evidence plus guarded live CSV export, import, backup-folder, database file access/read-only preflight, explicit lock-boundary evidence, blocked read-only disk, JSON/Parquet extension-gate, preloaded-extension-only boundary evidence, restore-package preflight, explicit restore execution-boundary evidence, explicit admin/extension execution-boundary evidence, and write-SQL boundary evidence.',
    [
      'Add extension-loaded live validation, larger local analytics, and selected mutation/admin or extension execution fixture coverage only if those workflows are promoted beyond the scoped claim.',
    ],
  ),
})

const WAVE5_TIMESERIES_PROFILE = profile({
  'connection-flow': strong(
    'Time-series connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for endpoint, auth, tenant/org/bucket, TLS, path-prefix, range, and query-limit metadata.',
    [
      'Contract-only residual risk: promote every auth proxy, token, tenant, version, and legacy OpenTSDB deployment mode only after fixture/live validation exists.',
    ],
  ),
  'object-tree': strong(
    'Time-series trees expose metrics, labels, targets, rules, buckets, measurements, tags, fields, UID metadata, trees, stats, security, and diagnostics through shared/Rust manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen live capability hiding for Prometheus rule/target endpoints, InfluxDB v1/v2/v3 differences, and OpenTSDB UID/tree availability.',
    ],
  ),
  'query-surface': strong(
    'PromQL, Flux/InfluxQL/SQL, and OpenTSDB query descriptors are pinned in browser and desktop manifests, with native query/profile/export payloads, bounded range, and cardinality warnings.',
    [
      'Contract-only residual risk: turn the manifest descriptors into richer visual range builders, parameter workflows, and live profile/cardinality feedback per engine.',
    ],
  ),
  intellisense: strong(
    'Prometheus, InfluxDB, and OpenTSDB suggestions include deterministic query keywords/functions, metrics, buckets, measurements, labels/tags, fields, aggregators, and bounded range/query snippets.',
    [
      'Contract-only residual risk: add label/tag/value-aware completions from live metadata and avoid expensive per-keystroke metadata calls.',
    ],
  ),
  'object-views': strong(
    'Time-series object-view parity is pinned across Prometheus, InfluxDB, and OpenTSDB descriptor-backed workflows, focused descriptor tests, metric/bucket/measurement/UID posture workspaces, cardinality/ingestion/retention/governance panels, and guarded action strips for profile, metrics, cardinality, retention, UID, access, import/export, and delete workflows.',
    [
      'Contract-only residual risk: deepen rendered live cardinality, target health, retention/task, UID/tree, and backend-health views after fixture/live validation.',
    ],
  ),
  'safe-editing': partial(
    'Time-series write/admin workflows are preview-first; destructive retention/delete/UID operations remain guarded by environment and confirmation plans.',
    [
      'Contract-only residual risk: promote live retention, delete, UID repair, and import workflows only after permissions, time windows, and series impact can be proven.',
    ],
  ),
  'guarded-operations': strong(
    'Time-series guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and Prometheus cardinality/profile/metrics, InfluxDB profile/metrics/access/retention/import-export/delete, and OpenTSDB stats/UID repair/import-export/delete requests.',
    [
      'Contract-only residual risk: keep admin execution plan-only until live endpoint capability and permission checks are adapter-backed.',
    ],
  ),
  'diagnostics-performance': strong(
    'Time-series diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, query profile/cardinality plans, Rust metrics/profile request planning, and deterministic TSDB/head status, target/rule health, task/retention status, API stats, UID repair preflights, and cardinality checks.',
    [
      'Contract-only residual risk: connect live sampling, backend health, and long-range query impact estimates after optional fixtures exist.',
    ],
  ),
  'import-export': strong(
    'Time-series import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Prometheus bounded range export plans, InfluxDB line-protocol import/export plans, and OpenTSDB API export/import plans without claiming mutable Prometheus imports.',
    [
      'Contract-only residual risk: add adapter-owned file workflows and optional live import/export validation before execution promotion.',
    ],
  ),
  tests: strong(
    'Wave 5 time-series engines have deterministic manifest, query-builder descriptor, planner, browser-preview, object-view action, and completeness coverage for the contract slice.',
    [
      'Contract-only residual risk: add optional live Prometheus, InfluxDB, and OpenTSDB fixture tests outside default CI.',
    ],
  ),
})

const WAVE5_GRAPH_PROFILE = profile({
  'connection-flow': strong(
    'Graph connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for endpoint, database/graph, traversal-source, query-language, auth, IAM/SigV4, TLS, timeout, and fetch-size metadata.',
    [
      'Contract-only residual risk: promote every Bolt, HTTP, Gremlin, SPARQL/openCypher, IAM, and backend-specific mode only after fixture/live validation exists.',
    ],
  ),
  'object-tree': strong(
    'Graph trees expose labels, relationships, properties, indexes, constraints, named graphs, collections, procedures, security, diagnostics, loader, and backend sections through shared/Rust manifests and browser explorer routing.',
    [
      'Contract-only residual risk: deepen live capability hiding for optional graph algorithms, Neptune loader jobs, JanusGraph backend/index services, and ArangoDB cluster/Foxx features.',
    ],
  ),
  'query-surface': strong(
    'Cypher, AQL, Gremlin, SPARQL/openCypher query descriptors are pinned in browser and desktop manifests, with native explain/profile, graph result, metrics, access, index, and export request shapes.',
    [
      'Contract-only residual risk: turn the manifest descriptors into richer visual graph builders, parameter workflows, path explain renderers, and live query-status/cancel support where engines allow it.',
    ],
  ),
  intellisense: strong(
    'Neo4j, ArangoDB, JanusGraph, and Neptune suggestions include deterministic Cypher/AQL/Gremlin keywords, graphs, labels, relationship types, property keys, and bounded graph query snippets.',
    [
      'Contract-only residual risk: add schema-aware path, procedure, traversal-source, index, and IAM completions from live metadata.',
    ],
  ),
  'object-views': strong(
    'Graph object-view parity is pinned across Neo4j, ArangoDB, JanusGraph, and Neptune descriptor-backed workflows, focused descriptor tests, schema/index/constraint/security posture workspaces, graph renderers, and guarded action strips for explain/profile, metrics, access, index, constraint/drop, import/export, and destructive workflows.',
    [
      'Contract-only residual risk: deepen rendered live explain/profile graphs, Neptune loader timelines, backend-health panels, index lifecycle, and security-permission payloads after driver/cloud fixture validation.',
    ],
  ),
  'safe-editing': partial(
    'Graph writes and schema/admin actions are preview-first with guarded index, constraint/drop, import/export, and IAM/security checks.',
    [
      'Contract-only residual risk: promote live graph mutations only after identity, transaction, permissions, and environment checks are adapter-backed.',
    ],
  ),
  'guarded-operations': strong(
    'Graph guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and explain/profile, metrics, access, index create/drop, graph export/import, and destructive object/constraint requests.',
    [
      'Contract-only residual risk: keep admin execution plan-only until live driver/cloud capability, permission, and rollback checks exist.',
    ],
  ),
  'diagnostics-performance': strong(
    'Graph diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, query profile plans, Rust metrics/profile request planning, and deterministic Neo4j JMX/profile, ArangoDB statistics/explain, JanusGraph management/index status, and Neptune CloudWatch/IAM/profile signals.',
    [
      'Contract-only residual risk: connect live profile graphs, backend health, query status/cancel, loader jobs, and cluster metrics after optional fixtures exist.',
    ],
  ),
  'import-export': strong(
    'Graph import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Neo4j/ArangoDB/JanusGraph graph exports, and Neptune loader-style import/export plans with format, query, source, and validation guardrails.',
    [
      'Contract-only residual risk: add adapter-owned file/cloud storage workflows and optional live import/export validation before execution promotion.',
    ],
  ),
  tests: strong(
    'Wave 5 graph engines have deterministic manifest, query-builder descriptor, planner, browser-preview, object-view action, and completeness coverage for the contract slice.',
    [
      'Contract-only residual risk: add optional live Neo4j, ArangoDB, JanusGraph, and Neptune fixture/cloud tests outside default CI.',
    ],
  ),
})

const BETA_PROFILE = profile({
  'connection-flow': preview(
    'Connection contracts exist, but live option depth varies by adapter.',
    [
      'Promote only after native connection modes and friendly errors are implemented.',
    ],
  ),
  'object-tree': preview(
    'A structural tree exists for the family, but native live metadata is limited.',
    [
      'Replace generic folders with engine-owned metadata trees before promotion.',
    ],
  ),
  'query-surface': preview(
    'Basic query execution or request building exists for many beta adapters.',
    [
      'Add native query builders, consoles, or script modes that match the engine.',
    ],
  ),
  intellisense: preview(
    'Most beta engines only have keyword or generic suggestions.',
    ['Add metadata-backed completions before promotion.'],
  ),
  'object-views': preview(
    'Descriptor-backed object views exist for most beta engines, but many remain summary-first rather than deep native management tools.',
    [
      'Deepen engine-specific object-view workspaces and remove remaining generic or raw-payload-first presentations.',
    ],
  ),
  'safe-editing': preview(
    'Safe edit contracts exist at the platform level, but live editing is incomplete or unavailable for most beta engines.',
    [
      'Add edit target validation, identity checks, and guarded live edits only where the adapter can prove the target.',
    ],
  ),
  'guarded-operations': preview(
    'Admin/destructive workflows are generally preview-only or absent.',
    ['Add operation manifests and environment-guarded previews.'],
  ),
  'diagnostics-performance': preview(
    'Diagnostics are shallow or placeholder-like.',
    ['Add native health, performance, and explain/profile views.'],
  ),
  'import-export': preview('Import/export is not native for this engine.', [
    'Add engine-specific import/export planning.',
  ]),
  tests: preview(
    'Contract tests exist, but native UI and adapter behavior tests are limited.',
    ['Add deterministic browser-preview and optional fixture tests.'],
  ),
})

const ENGINE_OVERRIDES: Partial<
  Record<
    DatastoreEngine,
    {
      readiness: DatastoreNativeReadiness
      nativeScore: number
      targetPhase: number
      summary: string
      profile: CompletionProfile
    }
  >
> = {
  mongodb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 1,
    summary:
      'Native-complete for the scoped MongoDB document workflow: native connection and tree surfaces, find/aggregation/raw command query surfaces, aggregation-aware IntelliSense, object views, rendered profiler/currentOp/replica/shard diagnostics, live guarded document insert/replace/delete and field edits, guarded live desktop collection import/export for JSON, Extended JSON, NDJSON, CSV, and BSON, adapter-driven fixture evidence, and optional permission/management fixture validation are complete; Atlas-only surfaces, live GridFS file workflows, replica/shard fixture depth, and live admin execution remain optional extensions outside this claim.',
    profile: MONGO_PROFILE,
  },
  redis: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 1,
    summary:
      'Native-complete for the scoped Redis and Redis Stack key workflow: Redis has native connection and tree surfaces, key browser and console query surfaces, command-argument-aware IntelliSense with Redis Stack module hints and live COMMAND INFO ingestion, stream consumer-group drilldowns, Redis Stack module object views, diagnostics, live guarded core key/member edits, stream entry add/delete, RedisTimeSeries sample add/delete, RedisJSON path edits, vector member/attribute edits, guarded desktop JSON/NDJSON key import/export for core Redis types, RedisJSON, RedisTimeSeries samples, vector-set elements, Redis DUMP/RESTORE snapshots for opaque modules, and reference test coverage; optional Redis/Redis Stack/Valkey fixture validation passes for core, stream-group, module, and DUMP/RESTORE snapshot evidence, while vector-set live fixture evidence is an image-dependent optional extension gated by `--require-vector` and cluster/Sentinel evidence remains outside this claim.',
    profile: REDIS_PROFILE,
  },
  valkey: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 1,
    summary:
      'Native-complete for the core single-node Valkey claim: Valkey has Redis-compatible connection flow, native key browser, command-argument-aware console IntelliSense, live guarded core key/member and stream entry edits, guarded desktop JSON/NDJSON key import/export execution for core Redis-compatible types, Valkey-specific tree/preview/menu copy, capability-gated Redis Stack/vector-only surfaces, and optional fixture validation for core key-file primitives, permission-denied guarded writes, large key-file primitives, TTL behavior, and stream-group evidence.',
    profile: VALKEY_PROFILE,
  },
  postgresql: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped PostgreSQL workflow: typed native connection/profile options with right-drawer fields, Rust interpolation, timeout routing, and encoded DSN parameters, live SQL, live primary-key row edits pinned by desktop live-scope tests, before/after row evidence metadata for desktop row edits, PostgreSQL-aware IntelliSense with pg_catalog helpers, routine call/definition snippets, profile snippets, and safe identifier quoting, rendered EXPLAIN payloads, rendered EXPLAIN ANALYZE JSON profile dashboards with operator stages and plan/table/raw fallbacks, compact posture panels, live pg_stat_database metrics, pg_stat_activity session/wait/blocking profiles, pg_locks lock posture profiles, pg_stat_user_tables relation/vacuum/index-scan profiles, optional pg_stat_statements top-query profiles when available, extension-aware trees/views with update hints and extension-owned objects, role membership/default privilege/grant views, guarded parameterized routine execution plans, guarded pg_cancel_backend/pg_terminate_backend previews with PID and current-backend guards, guarded role grant/revoke and extension update/drop plans, live guarded EXPLAIN ANALYZE profile execution for read statements, guarded vacuum/analyze/reindex previews, guarded desktop CSV/JSON/NDJSON table export/import, bounded JSON/SQL logical backup execution, and optional PostgreSQL fixture validation for seeded volume, diagnostics, row evidence, permission denial, routine/profile primitives, import/export primitives, and bounded backup evidence. Full pg_dump/pg_restore execution, managed-provider IAM/proxy/certificate combinations, richer privilege editors, generated/custom-type stress fixtures, and restore execution remain optional extensions outside this scoped claim.',
    profile: POSTGRESQL_PROFILE,
  },
  cockroachdb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped CockroachDB workflow: PostgreSQL-wire live SQL and primary-key row edits are pinned by desktop live-scope tests; typed CockroachDB connection/profile metadata captures deployment mode, Cockroach Cloud identity, region/locality/version/build fields, auth/TLS disabled reasons, and capability gates; Cockroach-owned tree contracts, SHOW/crdb_internal query helpers, distributed EXPLAIN/profile previews, CockroachDB IntelliSense snippets, native cluster/range/region/job/activity/security/zone posture panels, Rust live payload contracts for crdb_internal diagnostics, and guarded jobs/ranges/regions/sessions/contention/role/default-privilege/zone workflows are covered; browser and Rust planners now emit preview-first IMPORT, EXPORT, BACKUP, RESTORE, and generic data-movement requests with external-storage, permission, confirmation, read-only/environment, and scan/cost guardrails. Live Cockroach Cloud/capability probing, rendered EXPLAIN ANALYZE DEBUG dashboards, job-control execution, zone changes, and live destructive/data-movement execution remain optional extensions outside this scoped claim.',
    profile: COCKROACH_PROFILE,
  },
  sqlserver: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped SQL Server/Azure SQL workflow: SQL Server has TDS SQL, live primary-key row edits pinned by desktop live-scope tests, typed SQL Server/Azure SQL connection option validation with per-mode Windows, Entra, managed identity, service principal, and certificate disabled reasons, rendered SHOWPLAN_TEXT explain payloads, XML Showplan profile payloads with operator tables and statement estimates, runtime DMV profile payloads for cached query stats, active requests, waits, file I/O, memory grants, transactions, and missing-index signals, compact storage/index/workload/security/Agent posture panels, Query Store status/top-query/forced-plan/regression payloads, database/server-scoped Extended Events session/event/target payloads, msdb-backed Agent service/job/schedule/alert/operator/proxy payloads, security payloads for users/roles/memberships/schemas/permissions/certificates/keys/credentials/audits, storage payloads for files/filegroups/partition schemes/functions/boundaries/allocation units, guarded statistics/index/Query Store previews, guarded desktop CSV/JSON/NDJSON table export/import, bounded JSON/SQL logical backup package execution, and restore-package validation. Native .bak BACKUP/RESTORE, bcp/sqlcmd bulk workflows, identity insert, and broader live maintenance/admin execution remain optional extensions outside the scoped claim.',
    profile: SQLSERVER_PROFILE,
  },
  mysql: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped MySQL workflow: MySQL has typed native connection/profile options, live SQL, a dialect-aware SELECT builder, MySQL-native IntelliSense/query-helper snippets, primary-key row edits pinned by desktop live-scope tests, Workbench-style trees, native storage/index/security/session/status/performance_schema/optimizer/InnoDB/replication object views, detailed statement digest, table/index I/O, metadata-lock, optimizer-trace, and status-counter sections, rendered EXPLAIN payloads, live performance_schema/status/optimizer diagnostics, structured guarded maintenance/routine/event/security/user previews, guarded desktop CSV/JSON/NDJSON table import/export, bounded JSON/SQL logical backup packages, and restore-package validation. Cleartext/IAM auth, selected live admin execution, LOAD DATA INFILE, mysqlpump/mysqldump parity, replication-channel depth, richer grant editing, and full restore execution remain optional extensions outside this scoped claim.',
    profile: MYSQL_PROFILE,
  },
  mariadb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped MariaDB workflow: MariaDB shares the MySQL live SQL/edit base and now has typed MariaDB connection/profile metadata, MariaDB-aware Workbench-style trees, native MariaDB object-view descriptors and posture cards for role mappings, server variables, storage engines, routines, events, diagnostics, and ANALYZE FORMAT=JSON profile metadata, explicit EXPLAIN FORMAT=JSON and guarded ANALYZE FORMAT=JSON previews, MariaDB-specific IntelliSense helpers, status/version/storage-engine diagnostics, Aria metrics, role-mapping security previews, structured preview-first routine/event/admin/user workflows, guarded desktop CSV/JSON/NDJSON table import/export, bounded JSON/SQL logical backup packages, and restore-package validation. Selected live admin execution, LOAD DATA INFILE, mariadb-dump/mysql dump parity, richer role/grant editing, and full restore execution remain optional extensions outside this scoped claim.',
    profile: MARIADB_PROFILE,
  },
  sqlite: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped local-file SQLite workflow: SQLite has local file open/create and read-only connection flows, native main/attached database trees, table/view/index/trigger/virtual/generated-column surfaces, raw SQL and scoped SELECT builders, metadata-aware SQL IntelliSense, purpose-built object views, rendered EXPLAIN QUERY PLAN and bytecode profile payloads, PRAGMA diagnostics, live primary-key row edits, guarded maintenance plans, live desktop VACUUM INTO backup, table/view CSV/JSON/NDJSON export, CSV/JSON/NDJSON table import with concrete path/read-only/overwrite/row-limit/validation/confirmation guardrails, browser plan-only previews, and focused live file-workflow tests; restore execution, encrypted-provider builds, and deeper trigger/index authoring remain optional extensions outside this claim.',
    profile: SQLITE_PROFILE,
  },
  oracle: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Oracle is native-complete for the scoped SQLPlus-backed SQL workflow with typed Oracle connection/profile options, configurable SQLPlus live SELECT/EXPLAIN execution, primary-key/ROWID guarded row edits with before/after evidence, SQL Developer-style trees, Oracle-specific IntelliSense, descriptor-backed object views, DBMS_XPLAN-shaped plan/profile payloads, guarded SQLPlus/Data Pump import/export and RMAN previews, diagnostics/storage/security contracts, and optional Oracle fixture validation for seeded volume, DBMS_XPLAN, SQL Monitor boundaries, PL/SQL compile diagnostics, row identity primitives, restricted dictionary denial, and preview-first file/backup boundaries; thin/OCI drivers, Data Pump/RMAN execution, and broader admin execution remain optional extensions.',
    profile: ORACLE_RELATIONAL_PROFILE,
  },
  timescaledb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 2,
    summary:
      'Native-complete for the scoped TimescaleDB time-series SQL workflow: TimescaleDB has PostgreSQL-wire SQL, typed Timescale deployment/profile metadata, profile capability hiding, rendered profile/hypertable/policy/aggregate posture, rendered time-bucket/chunk-sizing/compression/freshness/job dashboards, Toolkit availability and time-bucket query-window diagnostics, Timescale-specific before/after row-edit evidence plans, native hypertable/chunk/compression/retention/continuous aggregate/job views with richer live metadata normalizers, rendered PostgreSQL EXPLAIN payloads, guarded policy/job-control previews, native import/export/backup/restore preflights, and live optional fixture evidence for extension/catalog, row-evidence, restricted-role, continuous-aggregate, policy/job boundary, compressed chunk, aggregate lag, Toolkit variant, bounded file-copy, and failed-job diagnostics; policy/job/file execution remains explicitly plan-only outside the scoped claim.',
    profile: TIMESCALE_PROFILE,
  },
  elasticsearch: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 3,
    summary:
      'Native-complete for the scoped Elasticsearch plain-HTTP search workflow: Elasticsearch has typed connection-flow parity with explicit disabled reasons for HTTPS/cloud/token/TLS/SigV4 profiles, pinned native tree parity, aggregation-aware Query DSL helpers, bounded live search, search hits/aggregation/profile renderers, normalized profile stages, native cluster/index/mapping/security/diagnostics/slow-log/allocation views, explicit-id document edits with before/after `_doc` evidence pinned by desktop live-scope tests, preview-first execution gates for index/template/pipeline/lifecycle/security/bulk/snapshot/admin plans, and optional search fixture validator evidence for seeded index volume, mappings, aggregation/profile payloads, document evidence, slow-log/allocation diagnostics, and bounded `_search` export plus `_bulk` import primitives. Production cloud auth, ES|QL, desktop file/cloud import-export, snapshot execution, and broader live admin execution remain optional extensions outside the scoped claim.',
    profile: SEARCH_PROFILE,
  },
  opensearch: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 3,
    summary:
      'Native-complete for the scoped OpenSearch plain-HTTP search workflow: OpenSearch has typed connection-flow parity with explicit disabled reasons for HTTPS/managed/token/TLS/SigV4 profiles, pinned native tree parity, aggregation-aware Query DSL helpers, bounded live search, search hits/aggregation/profile renderers, normalized profile stages, native cluster/index/mapping/security/diagnostics/slow-log/allocation views, ISM/security-aware request routing, typed managed/SigV4 options, explicit-id document edits with before/after `_doc` evidence pinned by desktop live-scope tests, preview-first execution gates for index/template/pipeline/lifecycle/security/bulk/snapshot/admin plans, and optional search fixture validator evidence for seeded OpenSearch volume, mappings, aggregation/profile payloads, document evidence, slow-log/allocation diagnostics, bounded `_search` export plus `_bulk` import primitives, and OpenSearch SQL, ISM, security, and Performance Analyzer boundary evidence. Managed SigV4/IAM runtime execution, OpenSearch SQL plugin execution, Performance Analyzer dashboards, desktop file/cloud import-export, snapshot execution, and broader live admin execution remain optional extensions outside the scoped claim.',
    profile: SEARCH_PROFILE,
  },
  dynamodb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 3,
    summary:
      'Native-complete for the scoped DynamoDB local/endpoint-override plus opt-in AWS validation workflow: DynamoDB has typed connection-flow parity for local/AWS modes, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, table/index/capacity/TTL/stream/backup panels, key/filter/projection and conditional-write expression planning, read API execution including guarded read-only PartiQL ExecuteStatement, typed endpointUrl routing, SigV4-shaped local/endpoint-override JSON API headers, live guarded item edits with consistent before/after GetItem evidence pinned by desktop live-scope tests, consumed-capacity payloads, DescribeLimits capacity diagnostics, credential-mode disabled reasons, AWS-shaped CloudWatch/IAM/import/export/backup/table-management previews, live-run optional DynamoDB Local fixture evidence for seeded volume, local metadata, Query/GetItem/PartiQL, conditional item edits, consumed-capacity, and backup/import-export boundaries, plus an opt-in AWS cloud validator for STS identity, ListTables, DescribeLimits, table diagnostics, CloudWatch metrics, IAM simulation, STS AssumeRole, web identity, ECS task credentials, and EC2 metadata credentials; S3 import/export job execution, backup create/delete, restore execution, and production AWS HTTPS SDK runtime execution remain optional extensions outside the scoped claim.',
    profile: DYNAMODB_PROFILE,
  },
  cassandra: {
    readiness: 'foundation',
    nativeScore: 3.05,
    targetPhase: 3,
    summary:
      'Cassandra has typed native connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, CQL request-builder execution, partition-key/tracing guardrails, keyspace/table/security/diagnostic panels, and CQL/nodetool-shaped index, permission, import/export, backup/restore, and drop previews; live binary driver execution remains residual risk.',
    profile: WIDE_COLUMN_PROFILE,
  },
  cosmosdb: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 4,
    summary:
      'Cosmos DB has contract-complete native UX for SQL API account/container browsing with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, RU/query diagnostics, indexing, throughput, consistency, failover, access, import/export, destructive previews, and deterministic Wave 4 coverage; live Azure SDK/cloud validation remains residual risk.',
    profile: WAVE4_DOCUMENT_PROFILE,
  },
  litedb: {
    readiness: 'foundation',
    nativeScore: 4.65,
    targetPhase: 4,
    summary:
      'LiteDB has contract-complete native UX for local-file connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, collection/index/storage/file-storage views, checkpoint/compact/rebuild, import/export, backup, collection/index/file-storage operations, deterministic Wave 4 coverage, local-file read/write open preflight evidence, explicit encryption and lock-boundary metadata, configured sidecar read-dispatch contract with deterministic fixture-token and local sidecar-process bounded response, timeout, open-failure, process-dispatch, and redaction evidence, plus sidecar-only full-document insert/update/delete plans with confirmation gates and `_id` validation. The optional real .NET LiteDB sidecar validator creates temporary databases and validates collection, find, index, guarded document CRUD, read-only mutation blocking, `_id` mismatch blocking, open-failure, encrypted-file correct-password open/read evidence, wrong-password failure evidence, secret/path redaction, JSON collection export/import execution with overwrite, read-only import block, before/after count evidence, file-storage list/import/export/delete execution with concrete IDs, local path checks, overwrite blocking, and before/after metadata evidence, plus guarded index create/drop and collection drop management execution; packaged sidecar distribution and exclusive writer-lock validation remain residual risks.',
    profile: WAVE4_DOCUMENT_PROFILE,
  },
  memcached: {
    readiness: 'foundation',
    nativeScore: 3.25,
    targetPhase: 4,
    summary:
      'Memcached has contract-complete native UX for typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, server stats, slab/item metadata, known-key get/gets/set/touch/incr/decr/delete, stats reset, flush, metrics, LRU dump previews, and deterministic Wave 4 coverage; live protocol/SASL validation remains residual risk.',
    profile: WAVE4_CACHE_PROFILE,
  },
  duckdb: {
    readiness: 'native',
    nativeScore: 5,
    targetPhase: 4,
    summary:
      'DuckDB is native-complete for the scoped local-file analytics workflow with typed local-file/memory connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, local-file creation, SQL SELECT builder coverage, bundled local-file read/EXPLAIN/profile execution, rendered DuckDB plan payloads, extension posture, structured analyze/checkpoint/object admin-scope gates, import/export/backup plans, structured extension install/load gates, object-view actions, and optional DuckDB fixture validator evidence for bundled local-file read/EXPLAIN/profile/catalog paths plus guarded live CSV export, CSV import, CSV backup-folder, database file access/read-only preflight, explicit scoped file-workflow lock-boundary metadata, JSON/Parquet extension-backed format preflight, explicit preloaded-extension-only JSON/Parquet boundaries, fail-closed unloaded-extension evidence, restore-package preflight, explicit restore execution-boundary evidence, explicit admin/extension execution-boundary evidence, blocked read-only disk, and write-SQL boundary evidence; extension-loaded live validation and any future executable local OLAP mutation/admin/extension promotion remain optional extensions beyond the scoped claim.',
    profile: DUCKDB_PROFILE,
  },
  clickhouse: {
    readiness: 'foundation',
    nativeScore: 3.45,
    targetPhase: 4,
    summary:
      'ClickHouse has contract-complete analytics UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, ClickHouse SQL, system/query-log diagnostics, MergeTree posture, import/export, optimize, TTL materialization, freeze snapshot, access, and drop previews; live cluster/admin execution remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  snowflake: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 4,
    summary:
      'Snowflake has contract-complete warehouse UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, Snowflake SQL, query/profile history, warehouse metrics, role/grant inspection, stage export/load, zero-copy clone, suspend/resume, and drop previews; live driver/cloud validation remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  bigquery: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 4,
    summary:
      'BigQuery has contract-complete warehouse UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, GoogleSQL dry-run cost plans, dataset/table/job/security views, IAM inspection, extract/load, table copy, metrics, and destructive previews; live ADC/OAuth/cloud validation remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  prometheus: {
    readiness: 'foundation',
    nativeScore: 3.3,
    targetPhase: 5,
    summary:
      'Prometheus has contract-complete time-series UX with typed connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, metric/label/target/rule trees, pinned PromQL range builder descriptors, profile requests, TSDB metrics, cardinality analysis, bounded range export plans, and bounded query diagnostics; live auth-proxy and long-range validation remain residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  influxdb: {
    readiness: 'foundation',
    nativeScore: 3.35,
    targetPhase: 5,
    summary:
      'InfluxDB has contract-complete time-series UX with version-aware connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, bucket/measurement/tag/field trees, pinned Flux/InfluxQL builder descriptors, profile payloads, metrics, token access inspection, retention updates, import/export, and guarded delete plans; live token/version validation remains residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  opentsdb: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 5,
    summary:
      'OpenTSDB has contract-complete time-series UX with HTTP connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, metric/tag/UID/tree/stat views, pinned metric query builder descriptors, native stats, API export plans, UID repair, and guarded metadata delete previews; live legacy deployment and backend validation remain residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  neo4j: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 5,
    summary:
      'Neo4j has contract-complete graph UX with typed connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, label/relationship/index/constraint/security trees, pinned Cypher pattern builder descriptors, explain/profile, JMX metrics, index/security previews, graph export plans, and guarded constraint/object drops; live Bolt mutation validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  arango: {
    readiness: 'foundation',
    nativeScore: 3.3,
    targetPhase: 5,
    summary:
      'ArangoDB has contract-complete graph/document UX with HTTP connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, collection/edge/graph/index/security trees, pinned AQL graph builder descriptors, explain/profile, admin statistics, permission inspection, index plans, and graph export previews; live cluster/Foxx/admin validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  janusgraph: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 5,
    summary:
      'JanusGraph has contract-complete graph UX with Gremlin connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, schema/index/backend trees, pinned Gremlin traversal builder descriptors, traversal explain/profile, management metrics, index lifecycle previews, and graph export plans; live backend/index-service validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  neptune: {
    readiness: 'foundation',
    nativeScore: 3.25,
    targetPhase: 5,
    summary:
      'Amazon Neptune has contract-complete graph UX with typed cloud/IAM connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, pinned Gremlin/openCypher builder descriptors, SPARQL surface, profile/explain payloads, CloudWatch metrics, IAM access inspection, loader-style import/export, and guarded graph plans; live SigV4/cloud validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
}

export const DATASTORE_COMPLETENESS_MATRIX: DatastoreCompletenessSummary[] =
  DATASTORE_FEATURE_BACKLOG.map((entry) => {
    const override = ENGINE_OVERRIDES[entry.engine]
    const profile = override?.profile ?? BETA_PROFILE
    const completionClaim: DatastoreCompletionClaim =
      NATIVE_COMPLETE_ENGINE_SET.has(entry.engine)
        ? 'native-complete'
        : CONTRACT_COMPLETE_ENGINE_SET.has(entry.engine)
          ? 'contract-complete'
          : 'incomplete'
    const completionEvidence = completionEvidenceForEngine(entry.engine)

    return {
      engine: entry.engine,
      family: entry.family,
      readiness: override?.readiness ?? 'beta',
      completionClaim,
      completionEvidence,
      residualRisk: residualRiskForEngine(completionClaim),
      nativeScore:
        override?.nativeScore ?? (entry.maturity === 'mvp' ? 2 : 1.5),
      targetPhase: override?.targetPhase ?? 5,
      summary:
        override?.summary ??
        `${entry.displayName} has an adapter contract, but still needs engine-native tree, query, object-view, diagnostics, and management depth before promotion.`,
      criteria: DATASTORE_COMPLETENESS_CRITERIA.map((criterion) =>
        completenessCriterionStatus(
          criterion,
          profile[criterion],
          completionClaim,
          completionEvidence,
        ),
      ),
    }
  })

export function datastoreCompletenessForEngine(engine: DatastoreEngine) {
  return DATASTORE_COMPLETENESS_MATRIX.find((entry) => entry.engine === engine)
}

export function incompleteCriteriaForEngine(engine: DatastoreEngine) {
  return (
    datastoreCompletenessForEngine(engine)?.criteria.filter(
      (criterion) =>
        criterion.status !== 'native' && criterion.status !== 'strong',
    ) ?? []
  )
}

export function contractIncompleteCriteriaForEngine(engine: DatastoreEngine) {
  return (
    datastoreCompletenessForEngine(engine)?.criteria.filter(
      (criterion) => criterion.contractStatus !== 'covered',
    ) ?? []
  )
}

export function isDatastoreContractComplete(engine: DatastoreEngine) {
  const entry = datastoreCompletenessForEngine(engine)
  return Boolean(entry && entry.completionClaim !== 'incomplete')
}

function profile(values: CompletionProfile): CompletionProfile {
  return values
}

function strong(note: string, next: string[]) {
  return { status: 'strong' as const, note, next }
}

function partial(note: string, next: string[]) {
  return { status: 'partial' as const, note, next }
}

function preview(note: string, next: string[]) {
  return { status: 'preview' as const, note, next }
}

function completenessCriterionStatus(
  criterion: DatastoreCompletenessCriterion,
  value: CompletionProfile[DatastoreCompletenessCriterion],
  completionClaim: DatastoreCompletionClaim,
  completionEvidence: DatastoreCompletenessEvidenceType[],
): DatastoreCompletenessCriterionStatus {
  const covered = completionClaim !== 'incomplete' && value.status !== 'missing'

  return {
    criterion,
    ...value,
    contractStatus: covered ? 'covered' : 'not-covered',
    evidence: criterionEvidence(criterion, completionEvidence),
    contractNote: covered
      ? completionClaim === 'native-complete'
        ? 'Covered for the native-complete gate within the scoped release claim; optional extensions stay gated until separately validated.'
        : 'Covered for the contract-only native UX gate; remaining work is live validation, fixture coverage, or deeper native polish.'
      : 'Not covered by the contract-only native UX gate yet.',
  }
}

function criterionEvidence(
  criterion: DatastoreCompletenessCriterion,
  completionEvidence: DatastoreCompletenessEvidenceType[],
) {
  const evidence = new Set<DatastoreCompletenessEvidenceType>(
    completionEvidence.filter((item) => item !== 'plan-only'),
  )

  if (
    criterion === 'guarded-operations' ||
    criterion === 'import-export' ||
    criterion === 'safe-editing'
  ) {
    evidence.add('plan-only')
  }

  if (criterion === 'tests') {
    evidence.add('fixture')
  }

  return [...evidence]
}

function completionEvidenceForEngine(engine: DatastoreEngine) {
  const evidence = new Set<DatastoreCompletenessEvidenceType>(['contract'])

  if (!CONTRACT_COMPLETE_ENGINE_SET.has(engine)) {
    return [...evidence]
  }

  evidence.add('plan-only')

  if (
    [
      'postgresql',
      'cockroachdb',
      'sqlserver',
      'mysql',
      'mariadb',
      'sqlite',
      'timescaledb',
      'mongodb',
      'redis',
      'valkey',
      'elasticsearch',
      'opensearch',
      'dynamodb',
      'duckdb',
      'oracle',
    ].includes(engine)
  ) {
    evidence.add('live')
  }

  if (
    [
      'sqlite',
      'duckdb',
      'mongodb',
      'redis',
      'valkey',
      'postgresql',
      'timescaledb',
      'mysql',
      'sqlserver',
      'oracle',
      'dynamodb',
      'elasticsearch',
      'opensearch',
    ].includes(engine)
  ) {
    evidence.add('fixture')
  }

  return [...evidence]
}

function residualRiskForEngine(completionClaim: DatastoreCompletionClaim) {
  if (completionClaim === 'native-complete') {
    return 'No known native completion residual risk remains in the scoped native-complete claim; optional extension areas stay outside the claim unless explicitly validated.'
  }

  if (completionClaim === 'contract-complete') {
    return 'Contract-complete native UX: default CI validates deterministic contracts, browser-preview behavior, plans, docs, and Rust/browser parity; optional live fixture and cloud validation remain residual risk.'
  }

  return 'Incomplete: this engine still needs contract coverage before any native-complete claim.'
}
