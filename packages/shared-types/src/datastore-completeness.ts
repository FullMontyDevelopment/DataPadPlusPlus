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

export type DatastoreNativeReadiness =
  | 'native'
  | 'near-native'
  | 'usable'
  | 'foundation'
  | 'beta'

export interface DatastoreCompletenessCriterionStatus {
  criterion: DatastoreCompletenessCriterion
  status: DatastoreCompletenessStatus
  note: string
  next: string[]
}

export interface DatastoreCompletenessSummary {
  engine: DatastoreEngine
  family: DatastoreFamily
  readiness: DatastoreNativeReadiness
  nativeScore: number
  targetPhase: number
  summary: string
  criteria: DatastoreCompletenessCriterionStatus[]
}

type CompletionProfile = Record<
  DatastoreCompletenessCriterion,
  Omit<DatastoreCompletenessCriterionStatus, 'criterion'>
>

const MONGO_PROFILE = profile({
  'connection-flow': strong('Native and URI connection flows exist, including optional database discovery.', [
    'Finish advanced TLS, read/write concern, pool, and auth option coverage in the focused Mongo form.',
  ]),
  'object-tree': strong('Mongo uses a database/collection/view/GridFS/users/roles tree with system databases separated.', [
    'Hide optional Atlas-only folders unless metadata proves they are available.',
  ]),
  'query-surface': strong('Find builder, aggregation builder, raw command JSON, and safe scripting are implemented.', [
    'Round out explain and command helpers for less common read-only operations.',
  ]),
  intellisense: partial('Mongo suggestions cover collections/operators/fields from cached metadata and results.', [
    'Add aggregation-stage-aware field and expression suggestions.',
  ]),
  'object-views': strong('Mongo has purpose-built database, collection, schema, indexes, validation, GridFS, users, roles, statistics, and pipeline views.', [
    'Add live fixture coverage and richer before/after summaries for index, user, role, and validator changes.',
  ]),
  'safe-editing': partial('Document result editing and the dedicated insert-document view route through guarded data-edit paths.', [
    'Enable live safe document CRUD only when identity, permissions, and environment guardrails are satisfied.',
  ]),
  'guarded-operations': strong('Admin/destructive operations are preview-first and environment guarded.', [
    'Add richer index/user/role/validator operation previews with before/after summaries.',
  ]),
  'diagnostics-performance': partial('Metrics and Mongo explain rendering exist.', [
    'Add profiler, current operations, replica/shard status, index usage, and collection-level diagnostics.',
  ]),
  'import-export': partial('Results export exists at the platform level and document upload is started.', [
    'Add collection import/export flows for JSON, Extended JSON, NDJSON, CSV, and BSON.',
  ]),
  tests: strong('Mongo has focused builder, object-view, explain, scripting, explorer, and result tests.', [
    'Add fixture-gated coverage for live indexes, validation, GridFS, users, and roles.',
  ]),
})

const REDIS_PROFILE = profile({
  'connection-flow': strong('Native and URI Redis connection options include DB index, TLS, sentinel, cluster, and socket metadata.', [
    'Complete live support for sentinel, cluster discovery, Unix sockets, and cloud-hosted TLS combinations.',
  ]),
  'object-tree': partial('Redis has DB/type/security/diagnostics tree sections and capability-aware module branches.', [
    'Make DB/type folders fully metadata-driven and remove unavailable module clutter everywhere.',
  ]),
  'query-surface': strong('Redis opens in a key browser and has a Redis console mode with command shortcuts, history recall, and read-only pipeline batches.', [
    'Finish command docs and RESP/raw result toggles.',
  ]),
  intellisense: partial('Redis command and key suggestions are started.', [
    'Add command-argument-aware completions from COMMAND metadata.',
  ]),
  'object-views': partial('Redis object views cover DB overview, diagnostics, key/value-oriented views, and metrics.', [
    'Finish Pub/Sub, streams, ACL, cluster, sentinel, Lua scripts, functions, and module-specific views.',
  ]),
  'safe-editing': partial('Key edits route through guarded data-edit paths, currently mostly plan-only.', [
    'Enable safe live single-key and member edits when read/write guardrails allow it.',
  ]),
  'guarded-operations': partial('Destructive key operations are represented as guarded plans.', [
    'Add guarded rename, duplicate, move, expire/persist, stream ack/delete, and module edit plans.',
  ]),
  'diagnostics-performance': strong('INFO-derived dashboard metrics and tables exist.', [
    'Add latency, largest keys, TTL distribution, slowlog drilldown, clients, replication, and memory analysis.',
  ]),
  'import-export': preview('Import/export is still a platform/result-level capability rather than Redis-native.', [
    'Add key export/import by type with TTL and serialization options.',
  ]),
  tests: partial('Redis key browser, console, metrics, and object-view tests exist.', [
    'Add browser-preview tests for all Redis object views and optional Redis Stack fixture tests.',
  ]),
})

const RELATIONAL_CORE_PROFILE = profile({
  'connection-flow': partial('Native and connection-string flows exist, with some engine-specific options.', [
    'Finish focused connection forms for every promoted relational engine.',
  ]),
  'object-tree': partial('Relational trees expose schemas/tables/views/routines and selected engine-specific sections.', [
    'Make every branch permission-aware, metadata-driven, and free of unavailable clutter.',
  ]),
  'query-surface': partial('Raw SQL is stable and scoped SQL SELECT builders exist for tables/views.', [
    'Add joins, parameters, snippets, stored procedure/function execution, and dialect-native explain modes.',
  ]),
  intellisense: partial('SQL IntelliSense exists from cached metadata.', [
    'Improve alias, parameter, routine, and dialect-specific identifier suggestions.',
  ]),
  'object-views': partial('PostgreSQL, CockroachDB, SQL Server, MySQL, and MariaDB have native descriptor-backed object views.', [
    'Extend purpose-built views to SQLite and deepen SQL Server/PostgreSQL/MySQL-family views.',
  ]),
  'safe-editing': preview('Row edits generate safe plans, but live execution is not broadly enabled.', [
    'Enable live row edits with complete primary keys and environment/read-only checks.',
  ]),
  'guarded-operations': partial('DDL/admin actions are mostly operation previews.', [
    'Add create/alter/drop/index/grant/maintenance previews with clear diffs and confirmation.',
  ]),
  'diagnostics-performance': partial('Metrics and diagnostics exist unevenly by engine.', [
    'Add native sessions, locks, slow/top queries, plan/profile, storage, and index-health views per engine.',
  ]),
  'import-export': partial('Result export exists; relational import/export is not yet native per engine.', [
    'Add table import/export and backup/restore planning where each engine supports it.',
  ]),
  tests: partial('Shared builder, tree, object-view, and adapter tests exist.', [
    'Add per-engine UI and browser-preview tests for object views and management plans.',
  ]),
})

const SEARCH_PROFILE = profile({
  'connection-flow': partial('Typed HTTP, Elastic Cloud, managed OpenSearch, AWS SigV4, default-index, TLS, timeout, and credential option contracts now exist.', [
    'Promote cloud/IAM, certificate, API key, bearer token, and SigV4 options into the live HTTPS/runtime path.',
  ]),
  'object-tree': partial('Indexes, data streams, aliases, and cluster sections exist.', [
    'Add capability-aware ILM/ISM, security, templates, ingest pipelines, shards, and segments.',
  ]),
  'query-surface': partial('Query DSL builder and raw search request execution exist.', [
    'Add aggregation builder, profile/explain flows, ES|QL/OpenSearch SQL where available.',
  ]),
  intellisense: partial('Search DSL suggestions are started.', [
    'Add mapping-aware field suggestions and aggregation snippets.',
  ]),
  'object-views': partial('Search object views now include cluster, field-capability, shard, segment, lifecycle, ingestion, and security posture panels.', [
    'Deepen rendered profile/explain detail and add richer index/security management screens.',
  ]),
  'safe-editing': preview('Document edit plans exist, but live execution is not broadly enabled.', [
    'Enable safe single-document index/update/delete when target id is explicit.',
  ]),
  'guarded-operations': partial('Search has guarded HTTP-shaped previews for index, template, pipeline, lifecycle, task, snapshot, alias, rollover, bulk, and security workflows.', [
    'Promote safe live admin execution only after capability and permission checks are adapter-backed.',
  ]),
  'diagnostics-performance': partial('Cluster, shard, segment, lifecycle, and profile-friendly signals are visible in object views.', [
    'Add slow logs, allocation explanations, OpenSearch Performance Analyzer, and richer profile dashboards.',
  ]),
  'import-export': preview('No native search import/export workflow yet.', [
    'Add bulk export/import and reindex plan flows.',
  ]),
  tests: partial('Search builder and adapter tests exist.', [
    'Add native search object-view tests and contract coverage for profile/explain payloads.',
  ]),
})

const WIDE_COLUMN_PROFILE = profile({
  'connection-flow': partial('DynamoDB and Cassandra now have typed option contracts for their native connection models.', [
    'Promote DynamoDB local endpoint, AWS profile, static key, assume-role, and web-identity options into the live AWS SDK/SigV4 runtime path.',
    'Promote Cassandra contact-point, TLS, auth, policy, and secure-bundle options into a live CQL driver path.',
  ]),
  'object-tree': partial('Tables/keyspaces and table children exist at a basic level.', [
    'Add indexes, materialized views, GSIs/LSIs, TTL/streams, and permission-aware optional sections.',
  ]),
  'query-surface': partial('DynamoDB key-condition and Cassandra partition-key builders exist.', [
    'Add PartiQL, richer CQL templates, scan warnings, and cost/capacity feedback.',
  ]),
  intellisense: partial('Keyword and object suggestions are started.', [
    'Add key/index-aware completions and expression helper suggestions.',
  ]),
  'object-views': partial('DynamoDB and Cassandra now have native object-view posture panels for common table/index/capacity/storage/cluster workflows.', [
    'Deepen live object-view payloads and richer editors for table/item/index/tracing workflows.',
  ]),
  'safe-editing': preview('Item/row edit plans exist, but live execution is not broadly enabled.', [
    'Enable guarded live item edits and Cassandra primary-key-safe row edits.',
  ]),
  'guarded-operations': partial('DynamoDB and Cassandra object views expose guarded table/index/TTL/stream/throughput/tracing/repair-style previews.', [
    'Promote selected safe operations to live execution only after capability and environment guard checks.',
  ]),
  'diagnostics-performance': partial('Capacity, hot partition, tracing, compaction, repair, and cluster status panels are started with deterministic payloads.', [
    'Connect live CloudWatch/account metrics and optional Cassandra nodetool/JMX-backed diagnostics.',
  ]),
  'import-export': preview('No native import/export workflow yet.', [
    'Add JSON/CSV item import/export and table backup/restore plan surfaces.',
  ]),
  tests: partial('Builder, edit-plan, object-view, operation-preview, connection-option UI, validation, and migration tests exist for the wide-column slice.', [
    'Add optional live fixture tests for DynamoDB Local and Cassandra-compatible drivers when dependencies are available.',
  ]),
})

const BETA_PROFILE = profile({
  'connection-flow': preview('Connection contracts exist, but live option depth varies by adapter.', [
    'Promote only after native connection modes and friendly errors are implemented.',
  ]),
  'object-tree': preview('A structural tree exists for the family, but native live metadata is limited.', [
    'Replace generic folders with engine-owned metadata trees before promotion.',
  ]),
  'query-surface': preview('Basic query execution or request building exists for many beta adapters.', [
    'Add native query builders, consoles, or script modes that match the engine.',
  ]),
  intellisense: preview('Most beta engines only have keyword or generic suggestions.', [
    'Add metadata-backed completions before promotion.',
  ]),
  'object-views': preview('Descriptor-backed object views exist for most beta engines, but many remain summary-first rather than deep native management tools.', [
    'Deepen engine-specific object-view workspaces and remove remaining generic or raw-payload-first presentations.',
  ]),
  'safe-editing': preview('Safe edit contracts exist at the platform level, but live editing is incomplete or unavailable for most beta engines.', [
    'Add edit target validation, identity checks, and guarded live edits only where the adapter can prove the target.',
  ]),
  'guarded-operations': preview('Admin/destructive workflows are generally preview-only or absent.', [
    'Add operation manifests and environment-guarded previews.',
  ]),
  'diagnostics-performance': preview('Diagnostics are shallow or placeholder-like.', [
    'Add native health, performance, and explain/profile views.',
  ]),
  'import-export': preview('Import/export is not native for this engine.', [
    'Add engine-specific import/export planning.',
  ]),
  tests: preview('Contract tests exist, but native UI and adapter behavior tests are limited.', [
    'Add deterministic browser-preview and optional fixture tests.',
  ]),
})

const ENGINE_OVERRIDES: Partial<Record<DatastoreEngine, {
  readiness: DatastoreNativeReadiness
  nativeScore: number
  targetPhase: number
  summary: string
  profile: CompletionProfile
}>> = {
  mongodb: {
    readiness: 'near-native',
    nativeScore: 4,
    targetPhase: 1,
    summary: 'Reference candidate: native MongoDB workflows are broad, but management depth and live-safe CRUD still need finishing.',
    profile: MONGO_PROFILE,
  },
  redis: {
    readiness: 'near-native',
    nativeScore: 3.5,
    targetPhase: 2,
    summary: 'Native key browser and diagnostics are strong; richer type editors, console ergonomics, and module/admin views remain.',
    profile: REDIS_PROFILE,
  },
  valkey: {
    readiness: 'usable',
    nativeScore: 3,
    targetPhase: 2,
    summary: 'Valkey should share the Redis-native workflow, with Redis Stack/module features hidden unless supported.',
    profile: REDIS_PROFILE,
  },
  postgresql: relational(3.1, 3, 'PostgreSQL now has compact storage, index-health, security, and activity posture panels plus guarded vacuum/analyze/reindex previews; deeper live pg_stat payloads and rendered plan details remain.'),
  cockroachdb: relational(3, 3, 'CockroachDB now has compact table, cluster, locality, job, contention, and security posture panels plus guarded jobs, ranges, regions, sessions, contention, roles/grants, backup, restore, import, and zone-configuration previews; deeper live crdb_internal payloads and distributed plan rendering remain.'),
  sqlserver: relational(3.15, 3, 'SQL Server now has compact storage, index, workload, security, and Agent posture panels plus guarded statistics, index maintenance, and Query Store workload previews; deeper plan rendering, Azure auth, and live management execution remain.'),
  mysql: relational(2.75, 3, 'MySQL has live adapter support, Workbench-style tree branches, compact storage/index/security/diagnostic panels, and guarded maintenance previews; it still needs deeper performance_schema and live management execution.'),
  mariadb: relational(2.75, 3, 'MariaDB shares the MySQL base with native status/security panels and MariaDB profile preview handling; it still needs deeper role semantics, optimizer traces, and live management execution.'),
  sqlite: relational(2.9, 3, 'SQLite now has local-file posture panels and guarded PRAGMA, integrity, analyze, optimize, vacuum, reindex, export, and backup previews; live row edits and richer EXPLAIN rendering remain.'),
  elasticsearch: {
    readiness: 'foundation',
    nativeScore: 2.45,
    targetPhase: 4,
    summary: 'Search support now has native posture panels and guarded HTTP-shaped admin previews, but still needs richer explain/profile rendering and live management execution.',
    profile: SEARCH_PROFILE,
  },
  opensearch: {
    readiness: 'foundation',
    nativeScore: 2.45,
    targetPhase: 4,
    summary: 'OpenSearch shares the deepened search base with ISM-aware previews, but still needs Performance Analyzer, SigV4/IAM, plugin detection, and live management execution.',
    profile: SEARCH_PROFILE,
  },
  dynamodb: {
    readiness: 'foundation',
    nativeScore: 2.25,
    targetPhase: 4,
    summary: 'DynamoDB has a key-condition builder, typed connection-option contract, native table/index/capacity/TTL/stream panels, and guarded AWS-shaped previews; the next gap is live AWS SDK/SigV4 execution and deeper CloudWatch diagnostics.',
    profile: WIDE_COLUMN_PROFILE,
  },
  cassandra: {
    readiness: 'foundation',
    nativeScore: 2.05,
    targetPhase: 4,
    summary: 'Cassandra now has typed contact-point, TLS, auth, consistency, and policy connection options plus CQL builder and native keyspace/table/tracing/repair/compaction surfaces; the next gap is live CQL driver execution and deeper cluster diagnostics.',
    profile: WIDE_COLUMN_PROFILE,
  },
}

export const DATASTORE_COMPLETENESS_MATRIX: DatastoreCompletenessSummary[] =
  DATASTORE_FEATURE_BACKLOG.map((entry) => {
    const override = ENGINE_OVERRIDES[entry.engine]
    const profile = override?.profile ?? BETA_PROFILE

    return {
      engine: entry.engine,
      family: entry.family,
      readiness: override?.readiness ?? 'beta',
      nativeScore: override?.nativeScore ?? (entry.maturity === 'mvp' ? 2 : 1.5),
      targetPhase: override?.targetPhase ?? 5,
      summary: override?.summary ?? `${entry.displayName} has an adapter contract, but still needs engine-native tree, query, object-view, diagnostics, and management depth before promotion.`,
      criteria: DATASTORE_COMPLETENESS_CRITERIA.map((criterion) => ({
        criterion,
        ...profile[criterion],
      })),
    }
  })

export function datastoreCompletenessForEngine(engine: DatastoreEngine) {
  return DATASTORE_COMPLETENESS_MATRIX.find((entry) => entry.engine === engine)
}

export function incompleteCriteriaForEngine(engine: DatastoreEngine) {
  return datastoreCompletenessForEngine(engine)?.criteria.filter(
    (criterion) => criterion.status !== 'native' && criterion.status !== 'strong',
  ) ?? []
}

function relational(nativeScore: number, targetPhase: number, summary: string) {
  return {
    readiness: 'usable' as const,
    nativeScore,
    targetPhase,
    summary,
    profile: RELATIONAL_CORE_PROFILE,
  }
}

function profile(
  values: CompletionProfile,
): CompletionProfile {
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
