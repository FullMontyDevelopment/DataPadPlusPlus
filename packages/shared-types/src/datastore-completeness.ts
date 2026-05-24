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
    'Make management views deeper and more action-oriented instead of preview-first only.',
  ]),
  'safe-editing': partial('Document result editing and upload route through guarded data-edit paths.', [
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
  'query-surface': strong('Redis opens in a key browser and has a Redis console mode.', [
    'Make the console fully CLI-like with history, pipeline mode, docs, and RESP/raw toggles.',
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
  'object-views': partial('PostgreSQL, CockroachDB, and SQL Server have native descriptor-backed object views.', [
    'Extend purpose-built views to MySQL, MariaDB, and SQLite and deepen SQL Server/PostgreSQL views.',
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
  'connection-flow': partial('HTTP connection and basic auth-style flows exist.', [
    'Add cloud/IAM and certificate option coverage for Elastic/OpenSearch deployments.',
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
  'object-views': preview('Search object views are mostly generic compared with Mongo/Redis/relational stores.', [
    'Build native index, mapping, shard, segment, search profile, and security views.',
  ]),
  'safe-editing': preview('Document edit plans exist, but live execution is not broadly enabled.', [
    'Enable safe single-document index/update/delete when target id is explicit.',
  ]),
  'guarded-operations': preview('Index/admin actions need richer guarded operation plans.', [
    'Add create/delete index, mapping/template, ILM/ISM, and reindex previews.',
  ]),
  'diagnostics-performance': partial('Basic diagnostics exist through HTTP metadata.', [
    'Add cluster health, shard allocation, segment stats, slow logs, and profile dashboards.',
  ]),
  'import-export': preview('No native search import/export workflow yet.', [
    'Add bulk export/import and reindex plan flows.',
  ]),
  tests: partial('Search builder and adapter tests exist.', [
    'Add native search object-view tests and contract coverage for profile/explain payloads.',
  ]),
})

const WIDE_COLUMN_PROFILE = profile({
  'connection-flow': partial('Connection models exist but are still uneven across wide-column engines.', [
    'Complete AWS SDK/IAM/local endpoint options for DynamoDB and native Cassandra options.',
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
  'object-views': preview('Object views are not yet native enough for DynamoDB or Cassandra.', [
    'Build table/item/index/capacity/stream/tracing views.',
  ]),
  'safe-editing': preview('Item/row edit plans exist, but live execution is not broadly enabled.', [
    'Enable guarded live item edits and Cassandra primary-key-safe row edits.',
  ]),
  'guarded-operations': preview('Admin operation plans are skeletal.', [
    'Add table/index/TTL/stream/throughput/repair/compaction previews.',
  ]),
  'diagnostics-performance': preview('Diagnostics are shallow.', [
    'Add consumed capacity, hot partitions, tracing, compaction, repair, and cluster status.',
  ]),
  'import-export': preview('No native import/export workflow yet.', [
    'Add JSON/CSV item import/export and table backup/restore plan surfaces.',
  ]),
  tests: partial('Builder and edit-plan tests exist.', [
    'Add browser-preview object-view and guardrail tests for DynamoDB and Cassandra.',
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
  'object-views': missing('Purpose-built object views are not complete for this engine.', [
    'Add engine-specific object-view descriptors and workspaces.',
  ]),
  'safe-editing': missing('Safe live editing is not complete for this engine.', [
    'Add edit target validation and guarded data-edit plans first.',
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
  postgresql: relational(3, 3, 'PostgreSQL has the relational base and descriptors, but needs deeper pg-native diagnostics, roles/grants, and maintenance tooling.'),
  cockroachdb: relational(2.75, 3, 'CockroachDB builds on the PostgreSQL base and needs native jobs, ranges, regions, contention, and distributed diagnostics.'),
  sqlserver: relational(3, 3, 'SQL Server has live TDS and an SSMS-inspired tree; Query Store, Agent, security, storage, and plan tooling need deeper views.'),
  mysql: relational(2.5, 3, 'MySQL has live adapter support but still needs Workbench-like object views, grants, performance_schema, and explain tooling.'),
  mariadb: relational(2.5, 3, 'MariaDB shares the MySQL base and needs MariaDB-specific roles, engines, status panels, and explain handling.'),
  sqlite: relational(2.75, 3, 'SQLite has strong local-file basics and should receive native PRAGMA, trigger, index, integrity, vacuum, and backup views.'),
  elasticsearch: {
    readiness: 'foundation',
    nativeScore: 2.25,
    targetPhase: 4,
    summary: 'Search support has a DSL builder and live HTTP adapter, but native index/mapping/profile/admin views are still shallow.',
    profile: SEARCH_PROFILE,
  },
  opensearch: {
    readiness: 'foundation',
    nativeScore: 2.25,
    targetPhase: 4,
    summary: 'OpenSearch shares the search base and needs OpenSearch-specific ISM/security/profile surfaces.',
    profile: SEARCH_PROFILE,
  },
  dynamodb: {
    readiness: 'foundation',
    nativeScore: 2,
    targetPhase: 4,
    summary: 'DynamoDB has a key-condition builder and edit plans, but needs item/table/index/capacity/streams-native workspaces.',
    profile: WIDE_COLUMN_PROFILE,
  },
  cassandra: {
    readiness: 'foundation',
    nativeScore: 1.75,
    targetPhase: 4,
    summary: 'Cassandra has CQL builder scaffolding, but native keyspace/table/tracing/repair/compaction experiences are still early.',
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

function missing(note: string, next: string[]) {
  return { status: 'missing' as const, note, next }
}
