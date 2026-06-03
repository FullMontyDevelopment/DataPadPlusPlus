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

export const DATASTORE_CONTRACT_STATUSES = [
  'covered',
  'not-covered',
] as const

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
  'safe-editing': strong('MongoDB insert-document and field set/unset/rename/type-change edits execute through the native adapter only when collection, document identity, read-only, and confirmation guardrails pass.', [
    'Add richer before/after previews, delete/replace coverage, and optional live fixture coverage for permission-specific failures.',
  ]),
  'guarded-operations': strong('Admin/destructive operations are preview-first and environment guarded.', [
    'Add richer index/user/role/validator operation previews with before/after summaries.',
  ]),
  'diagnostics-performance': partial('Mongo metrics, explain rendering, profiler status, current operations, replica/shard probes, and scoped index-usage diagnostics exist.', [
    'Deepen rendered profiler/currentOp/replica/shard dashboards and add fixture/live coverage for permission-specific payloads.',
  ]),
  'import-export': partial('Collection import/export plans exist with scoped database/collection targets, filters, formats, validation, and create/replace policy options.', [
    'Promote JSON, Extended JSON, NDJSON, CSV, and BSON collection import/export to guarded live execution after file and fixture coverage.',
  ]),
  tests: strong('Mongo has focused builder, object-view, explain, scripting, explorer, and result tests.', [
    'Add fixture-gated coverage for live indexes, validation, GridFS, users, and roles.',
  ]),
})

const REDIS_PROFILE = profile({
  'connection-flow': strong('Native and URI Redis connection options include DB index, TLS, sentinel, cluster, and socket metadata.', [
    'Complete live support for sentinel, cluster discovery, Unix sockets, and cloud-hosted TLS combinations.',
  ]),
  'object-tree': strong('Redis has DB/type/security/diagnostics tree sections and module branches stay hidden until manifest or live metadata proves availability.', [
    'Deepen DB/type counts with per-type live metadata and permission-specific disabled reasons.',
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
  'safe-editing': strong('Core single-key and member edits execute live only after read-only, identity, and confirmation guardrails pass.', [
    'Extend live edit parity to streams, RedisJSON, time-series, vectors, and other module-backed values only when module commands are confirmed.',
  ]),
  'guarded-operations': strong('Destructive/admin key operations include guarded rename, duplicate, move, expire/persist, stream ack/delete, and key import/export previews.', [
    'Add module-specific edit/admin plans after live capability evidence confirms the module command set.',
  ]),
  'diagnostics-performance': strong('INFO-derived dashboard metrics and tables exist.', [
    'Add latency, largest keys, TTL distribution, slowlog drilldown, clients, replication, and memory analysis.',
  ]),
  'import-export': partial('Redis and Valkey expose native key export/import plans with type, TTL, serialization, validation, and create/replace policy options.', [
    'Promote selected key import/export paths to guarded live execution after fixture-backed serializer coverage.',
  ]),
  tests: strong('Redis and Valkey key browser, console, metrics, object-view, live core edit, operation-plan, and capability-hiding tests cover the reference contract.', [
    'Add optional Redis Stack and Valkey fixture tests for module-specific behavior outside default CI.',
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
  'safe-editing': strong('Live insert/update/delete row edits with complete identity exist for PostgreSQL-family, SQL Server, MySQL-family, SQLite, and TimescaleDB, with browser-preview contracts kept plan-only.', [
    'Broaden optional fixture coverage for every promoted SQL engine and add before/after row diffs where drivers can return changed rows safely.',
  ]),
  'guarded-operations': partial('DDL/admin actions are mostly operation previews.', [
    'Add create/alter/drop/index/grant/maintenance previews with clear diffs and confirmation.',
  ]),
  'diagnostics-performance': partial('Metrics, posture panels, and rendered plan payloads exist unevenly across the SQL family.', [
    'Deepen pg_stat/performance_schema/Query Store/DBMS_XPLAN payloads, live lock/session dashboards, and EXPLAIN ANALYZE/profile details per engine.',
  ]),
  'import-export': partial('Dialect-aware import/export and backup/restore plans now exist across the Wave 2 SQL engines.', [
    'Promote selected import/export and backup paths to guarded live execution only after fixture/live coverage exists.',
  ]),
  tests: strong('Shared builder, tree, object-view, row-edit, operation-plan, rendered-plan, browser-preview, and desktop live-scope tests cover the promoted SQL engines.', [
    'Add optional live fixture tests for promoted SQL engines and deeper browser-preview coverage for object-view management flows.',
  ]),
})

const ORACLE_RELATIONAL_PROFILE = profile({
  ...RELATIONAL_CORE_PROFILE,
  'safe-editing': partial('Oracle row editing remains contract-plan only until a supported live driver/runtime path is available.', [
    'Add Oracle live row-edit execution after a supported driver/runtime path is available.',
    'Keep DDL, grant, compile, import/export, and backup workflows preview-first until Oracle permission checks are adapter-backed.',
  ]),
  tests: partial('Oracle has deterministic tree, object-view, operation-plan, and DBMS_XPLAN-shaped contract tests, but no default live driver fixture.', [
    'Add optional Oracle fixture/live tests once driver prerequisites and CI-safe credentials are documented.',
    'Add browser-preview coverage for permission-specific dictionary and SQL Monitor disabled reasons.',
  ]),
})

const SEARCH_PROFILE = profile({
  'connection-flow': strong('Search connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for HTTP, Elastic Cloud, managed OpenSearch, AWS SigV4, default-index, TLS, and credential metadata.', [
    'Contract-only residual risk: promote cloud/IAM, certificate, API key, bearer token, and SigV4 combinations into the live HTTPS/runtime path after fixture or cloud validation.',
  ]),
  'object-tree': strong('Indexes, data streams, aliases, cluster, security, lifecycle, shard, segment, template, and ingest sections are pinned in shared/Rust tree manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen live plugin/capability detection for ILM/ISM, security, Performance Analyzer, vector, and snapshot sections.',
  ]),
  'query-surface': partial('Query DSL builder, bounded raw search execution, explain/profile request modes, search-hit tables, aggregations, and profile payloads exist.', [
    'Add aggregation builder polish plus ES|QL/OpenSearch SQL where available.',
  ]),
  intellisense: strong('Search DSL suggestions include deterministic keys, index names, mapped fields, and query/aggregation snippets from cached metadata contracts.', [
    'Contract-only residual risk: add live mapping-aware field boosting, analyzer-aware snippets, and aggregation validation from endpoint metadata.',
  ]),
  'object-views': strong('Search object-view parity is pinned across descriptor-backed workflows, focused descriptor tests, cluster/index/security posture panels, profile-friendly workspaces, and guarded action strips for explain/profile, lifecycle, ingestion, security, bulk, snapshot, and restore workflows.', [
    'Contract-only residual risk: deepen rendered live profile/explain detail, index/security management screens, and plugin-aware payloads after fixture/live validation.',
  ]),
  'safe-editing': strong('Explicit-id search document index/update/delete edits execute through the native adapter only when index, document id, read-only, and confirmation guardrails pass.', [
    'Add richer before/after document previews, bulk-safe validators, and fixture/live coverage for auth-specific failures.',
  ]),
  'guarded-operations': strong('Search guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and HTTP-shaped index/template/pipeline/lifecycle/task/snapshot/alias/rollover/bulk/security requests.', [
    'Contract-only residual risk: promote safe live admin execution only after capability and permission checks are adapter-backed.',
  ]),
  'diagnostics-performance': strong('Search diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, query profile plans, Rust metrics/profile request planning, and profile-friendly result payloads for cluster, shard, segment, lifecycle, metrics, and profile workflows.', [
    'Contract-only residual risk: add slow logs, allocation explanations, OpenSearch Performance Analyzer, and richer rendered live profile dashboards.',
  ]),
  'import-export': strong('Search import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, bulk export/import, reindex, snapshot, and restore HTTP-shaped requests.', [
    'Contract-only residual risk: add adapter-owned file workflows and promote selected export/snapshot flows after fixture/live validation.',
  ]),
  tests: strong('Search builder, object-view operation, profile payload, explicit-id data-edit, browser-preview, manifest, and Rust planner tests cover the promoted search contract slice.', [
    'Add optional live Elasticsearch/OpenSearch fixture tests and deeper rendered profile/explain UI coverage.',
  ]),
})

const WIDE_COLUMN_PROFILE = profile({
  'connection-flow': strong('Wide-column connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for DynamoDB local/AWS modes and Cassandra contact-point, secure-bundle, TLS, auth, consistency, retry, and load-balancing metadata.', [
    'Contract-only residual risk: promote DynamoDB local endpoint, AWS profile, static key, assume-role, and web-identity options into the live AWS SDK/SigV4 runtime path.',
    'Contract-only residual risk: promote Cassandra contact-point, TLS, auth, policy, and secure-bundle options into a live CQL driver path.',
  ]),
  'object-tree': strong('DynamoDB tables/indexes/TTL/streams/backups and Cassandra keyspaces/tables/indexes/materialized views/security/diagnostics sections are pinned in shared/Rust tree manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen permission-aware optional sections from live metadata and hide unavailable cloud/CQL features by detected capability.',
  ]),
  'query-surface': partial('DynamoDB key-condition requests include consumed-capacity and pagination payloads; Cassandra CQL requests include partition-key, tracing, and ALLOW FILTERING guardrails.', [
    'Add PartiQL, richer CQL templates, and live driver-backed cost/capacity feedback for cloud and cluster deployments.',
  ]),
  intellisense: strong('DynamoDB and Cassandra suggestions include deterministic keywords, table/keyspace/table names, key/index-aware fields, and expression/CQL helper snippets.', [
    'Contract-only residual risk: add live key/index-specific expression validation, Cassandra type-aware UDF completions, and permission-aware suggestions.',
  ]),
  'object-views': strong('Wide-column object-view parity is pinned across DynamoDB and Cassandra descriptor-backed workflows, focused descriptor tests, key/capacity/TTL/stream/backup panels, partition/storage/compaction/tracing panels, and guarded action strips for table, index, access, diagnostics, import/export, and backup workflows.', [
    'Contract-only residual risk: deepen live object-view payloads and richer editors for table, item, index, tracing, partition, and cluster workflows after SDK/CQL validation.',
  ]),
  'safe-editing': partial('DynamoDB item put/update/delete execution exists behind complete-key, read-only, and confirmation guards; Cassandra row edits remain contract-only.', [
    'Add Cassandra primary-key-safe row edit execution only after the live CQL driver path exists.',
  ]),
  'guarded-operations': strong('Wide-column guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and DynamoDB/Cassandra table/index/TTL/stream/throughput/tracing/repair/import-export/backup-style requests.', [
    'Contract-only residual risk: promote selected safe operations to live execution only after capability and environment guard checks.',
  ]),
  'diagnostics-performance': strong('Wide-column diagnostics/performance parity is pinned across diagnostics tree roots, DynamoDB/Cassandra object-view posture panels, browser diagnostics payloads, query/profile plans, Rust metrics/profile request planning, and deterministic capacity, hot-partition, tracing, compaction, repair, and cluster-status signals.', [
    'Contract-only residual risk: connect live CloudWatch/account metrics and optional Cassandra nodetool/JMX-backed diagnostics.',
  ]),
  'import-export': strong('Wide-column import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, DynamoDB export/import/backup/restore requests, and Cassandra cqlsh COPY/nodetool snapshot/SSTable restore plans.', [
    'Contract-only residual risk: promote file-backed import/export and backup/restore only after DynamoDB Local/cloud and Cassandra fixture validation are available.',
  ]),
  tests: partial('Builder, edit-plan, object-view, operation-preview, connection-option UI, validation, and migration tests exist for the wide-column slice.', [
    'Add optional live fixture tests for DynamoDB Local and Cassandra-compatible drivers when dependencies are available.',
  ]),
})

const DYNAMODB_PROFILE = profile({
  ...WIDE_COLUMN_PROFILE,
  'safe-editing': strong('DynamoDB item put/update/delete execution exists behind complete-key, read-only, and confirmation guardrails; Cassandra row editing remains a separate contract-only path.', [
    'Add before/after item previews, conditional-expression helpers, and optional DynamoDB Local/cloud fixture coverage.',
  ]),
  tests: strong('DynamoDB key-condition, consumed-capacity, item edit, operation-preview, object-view, browser-preview, and manifest tests cover the promoted DynamoDB contract slice.', [
    'Add optional live fixture tests for DynamoDB Local and cloud IAM modes when dependencies and credentials are available.',
  ]),
})

const WAVE4_DOCUMENT_PROFILE = profile({
  'connection-flow': strong('Document connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, local file handling, and redaction for Cosmos account/API/auth/region metadata and LiteDB local-file guardrails.', [
    'Contract-only residual risk: promote Azure SDK, Entra identity, account-key, and LiteDB encrypted-file paths only after live fixture coverage exists.',
  ]),
  'object-tree': strong('Document trees expose Cosmos account/database/container/region/security sections and LiteDB database/collection/index/storage sections from engine-owned shared/Rust manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen live capability discovery for Cosmos API variants and LiteDB file-lock/encryption states.',
  ]),
  'query-surface': partial('Cosmos SQL request previews and LiteDB collection/query previews include native filters, metrics hooks, and safe default payloads.', [
    'Contract-only residual risk: add API-specific Cosmos Mongo/Cassandra/Gremlin/Table builders and a live LiteDB query executor path.',
  ]),
  intellisense: strong('Cosmos DB and LiteDB suggestions include deterministic SQL/JSON keys, database/container/collection names, result fields, partition-key helpers, and bounded query snippets.', [
    'Contract-only residual risk: add partition-key, indexing-policy, BSON, and query-shape-aware completions from live metadata.',
  ]),
  'object-views': strong('Document object-view parity is pinned across Cosmos DB and LiteDB descriptor-backed workflows, focused descriptor tests, partition/RU/indexing/distribution panels, local-file/storage/index panels, and guarded action strips for throughput, consistency, failover, access, export, backup, compact, and drop workflows.', [
    'Contract-only residual risk: add richer live payloads for region failover, RU trends, file pages, encryption posture, and permission-specific disabled reasons after cloud/local fixture validation.',
  ]),
  'safe-editing': partial('Document and collection edits remain guarded by platform edit contracts and preview-first destructive/admin workflows.', [
    'Contract-only residual risk: promote live document CRUD only after identity, partition key, ETag, and file-lock validation are adapter-backed.',
  ]),
  'guarded-operations': strong('Document guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and Cosmos throughput/consistency/failover/access/metrics/import-export/drop plus LiteDB checkpoint/compact/rebuild/backup/import-export/index requests.', [
    'Contract-only residual risk: keep execution plan-only until cloud/local permission and file-safety checks are live.',
  ]),
  'diagnostics-performance': strong('Document diagnostics/performance parity is pinned across diagnostics tree roots, Cosmos/LiteDB object-view posture panels, browser diagnostics payloads, query/profile plans, Rust metrics/profile request planning, and deterministic RU, latency, throttle, query-metric, local-file health, checkpoint, compaction, and index rebuild signals.', [
    'Contract-only residual risk: connect Azure Monitor and LiteDB storage/page telemetry after fixture/live validation exists.',
  ]),
  'import-export': strong('Document import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Cosmos partition/format/export plans, and LiteDB collection export/backup plans with bounded-file warnings.', [
    'Contract-only residual risk: add adapter-owned file workflows and optional live import/export fixtures before execution promotion.',
  ]),
  tests: strong('Wave 4 document engines have deterministic manifest, planner, browser-preview, and object-view action coverage for the contract slice.', [
    'Contract-only residual risk: add live Cosmos emulator/Azure and LiteDB encrypted-file fixture tests outside default CI.',
  ]),
})

const WAVE4_CACHE_PROFILE = profile({
  'connection-flow': strong('Memcached connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, server-list routing, TCP no-delay handling, optional SASL metadata, and read-only guardrails.', [
    'Contract-only residual risk: promote binary protocol, SASL execution, compression, and multi-server failover only after live fixture coverage exists.',
  ]),
  'object-tree': strong('Memcached exposes server, settings, slabs, item classes, connections, and known-key lookup sections in shared/Rust manifests and browser explorer routing without pretending cache keys are globally enumerable.', [
    'Contract-only residual risk: deepen live slab/item metadata and disabled reasons for servers without crawler/stat support.',
  ]),
  'query-surface': partial('Native command previews cover stats, metadata refresh, get/gets, set, touch, increment, decrement, delete, reset, flush, and LRU crawler dumps.', [
    'Contract-only residual risk: add binary protocol and multi-server routing once the live executor is available.',
  ]),
  intellisense: strong('Memcached suggestions include deterministic command names, stats variants, known-key targets, slab/item-class objects, CAS reads, and guarded write-preview snippets.', [
    'Contract-only residual risk: add argument-aware completions from live version/protocol capability detection.',
  ]),
  'object-views': strong('Memcached object-view parity is pinned across descriptor-backed workflows, focused descriptor tests, cache/slab/item/settings posture panels, known-key workflow surfaces, and guarded action strips for stats, settings, reset, flush, LRU crawler dumps, and explicit-key operations.', [
    'Contract-only residual risk: add richer live charts for evictions, hit rate, item age, crawler status, multi-server pressure, and connection churn after protocol fixture validation.',
  ]),
  'safe-editing': partial('Known-key mutations are guarded previews with read-only, confirmation, and plan warnings; broad key browsing remains intentionally unavailable.', [
    'Contract-only residual risk: promote selected known-key operations only after live CAS, TTL, and multi-node safety checks exist.',
  ]),
  'guarded-operations': strong('Memcached guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and stats reset, flush, known-key get/gets/set/touch/incr/decr/delete, metrics, and LRU crawler dump requests.', [
    'Contract-only residual risk: keep destructive flush and mutation execution plan-only until environment and server-scope checks are live.',
  ]),
  'diagnostics-performance': strong('Memcached diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, Rust metrics request planning, and deterministic stats, settings, slabs, items, connection, eviction, and hit/miss signals.', [
    'Contract-only residual risk: connect live stats sampling and multi-node aggregation after optional fixture validation exists.',
  ]),
  'import-export': strong('Memcached import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, and LRU crawler metadata dump previews with explicit warnings that values are not exported unless keys are selected.', [
    'Contract-only residual risk: add safe value export/import workflows only for explicitly supplied keys after live validation.',
  ]),
  tests: strong('Memcached has deterministic manifest, planner, browser-preview, and object-view action tests for Wave 4 cache workflows.', [
    'Contract-only residual risk: add optional live memcached fixture tests for text, binary, SASL, crawler, and flush guard paths.',
  ]),
})

const WAVE4_ANALYTICS_PROFILE = profile({
  'connection-flow': strong('Analytics connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, local database creation, and redaction for DuckDB, ClickHouse, Snowflake, and BigQuery auth, file, warehouse, dataset, cost, and compute metadata.', [
    'Contract-only residual risk: promote every cloud driver, OAuth/IAM, TLS, and local extension mode only after fixture/live validation exists.',
  ]),
  'object-tree': strong('Analytics trees expose local files, schemas, tables, materialized views, stages, jobs, warehouses, datasets, system sections, security, and diagnostics through shared/Rust manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen live capability hiding for cloud permissions, ClickHouse clusters, DuckDB extensions, and warehouse optional features.',
  ]),
  'query-surface': strong('SQL query surfaces include pinned SQL SELECT builders, engine-native explain/profile/dry-run payloads, cost and scan warnings, and import/export request shapes.', [
    'Contract-only residual risk: add parameter workflows, richer visual builder dialect polish, and live driver-backed profile feedback per engine.',
  ]),
  intellisense: strong('DuckDB, ClickHouse, Snowflake, and BigQuery use deterministic SQL keyword, object, schema, column, alias, and function suggestions through the shared dialect-aware provider.', [
    'Contract-only residual risk: add dialect-aware functions, stages, datasets, extensions, settings, and alias completions from live metadata.',
  ]),
  'object-views': strong('Analytics object-view parity is pinned across DuckDB, ClickHouse, Snowflake, and BigQuery descriptor-backed workflows, focused descriptor tests, local-file/extension/query-log/MergeTree/job/reservation/storage/security posture panels, cloud warehouse insights, and guarded action strips for profile, metrics, access, clone/copy/optimize, import/export, backup, and destructive workflows.', [
    'Contract-only residual risk: deepen rendered live query-plan/profile timelines, cost dashboards, cloud permission payloads, and local-file telemetry after fixture/live validation.',
  ]),
  'safe-editing': partial('Warehouse and embedded-OLAP mutation workflows are preview-first with guarded DDL, copy/clone, import/export, and destructive object plans.', [
    'Contract-only residual risk: promote live row/table edits only where identity, permissions, dry-run, and transaction/file safety can be proven.',
  ]),
  'guarded-operations': strong('Analytics guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and DuckDB analyze/checkpoint/extension/import/backup, ClickHouse optimize/TTL/freeze/import-export, Snowflake clone/suspend/resume/export, and BigQuery dry-run/copy/export requests.', [
    'Contract-only residual risk: keep admin execution plan-only until live permission, cost, and environment checks are adapter-backed.',
  ]),
  'diagnostics-performance': strong('Analytics diagnostics/performance parity is pinned across diagnostics tree roots, warehouse/local object-view posture panels, browser diagnostics payloads, query profile/cost plans, Rust metrics/profile request planning, and deterministic DuckDB profiling/settings, ClickHouse query_log/system metrics, Snowflake query/warehouse history, and BigQuery dry-run/job signals.', [
    'Contract-only residual risk: connect live profile graphs, slot/credit usage, cluster metrics, and local file telemetry after optional fixtures exist.',
  ]),
  'import-export': strong('Analytics import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, DuckDB file import/export/backup, ClickHouse file import/export, Snowflake stage copy, and BigQuery extract/load plans with format, local-file, stage, bucket, scan, and cost warnings.', [
    'Contract-only residual risk: add adapter-owned file/cloud storage workflows and optional live validation before execution promotion.',
  ]),
  tests: strong('Analytics engines have deterministic manifest, SQL-builder, planner, browser-preview, object-view, and roadmap completeness coverage for the contract slice.', [
    'Contract-only residual risk: add optional live DuckDB, ClickHouse, Snowflake, and BigQuery fixture/cloud tests outside default CI.',
  ]),
})

const WAVE5_TIMESERIES_PROFILE = profile({
  'connection-flow': strong('Time-series connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for endpoint, auth, tenant/org/bucket, TLS, path-prefix, range, and query-limit metadata.', [
    'Contract-only residual risk: promote every auth proxy, token, tenant, version, and legacy OpenTSDB deployment mode only after fixture/live validation exists.',
  ]),
  'object-tree': strong('Time-series trees expose metrics, labels, targets, rules, buckets, measurements, tags, fields, UID metadata, trees, stats, security, and diagnostics through shared/Rust manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen live capability hiding for Prometheus rule/target endpoints, InfluxDB v1/v2/v3 differences, and OpenTSDB UID/tree availability.',
  ]),
  'query-surface': strong('PromQL, Flux/InfluxQL/SQL, and OpenTSDB query descriptors are pinned in browser and desktop manifests, with native query/profile/export payloads, bounded range, and cardinality warnings.', [
    'Contract-only residual risk: turn the manifest descriptors into richer visual range builders, parameter workflows, and live profile/cardinality feedback per engine.',
  ]),
  intellisense: strong('Prometheus, InfluxDB, and OpenTSDB suggestions include deterministic query keywords/functions, metrics, buckets, measurements, labels/tags, fields, aggregators, and bounded range/query snippets.', [
    'Contract-only residual risk: add label/tag/value-aware completions from live metadata and avoid expensive per-keystroke metadata calls.',
  ]),
  'object-views': strong('Time-series object-view parity is pinned across Prometheus, InfluxDB, and OpenTSDB descriptor-backed workflows, focused descriptor tests, metric/bucket/measurement/UID posture workspaces, cardinality/ingestion/retention/governance panels, and guarded action strips for profile, metrics, cardinality, retention, UID, access, import/export, and delete workflows.', [
    'Contract-only residual risk: deepen rendered live cardinality, target health, retention/task, UID/tree, and backend-health views after fixture/live validation.',
  ]),
  'safe-editing': partial('Time-series write/admin workflows are preview-first; destructive retention/delete/UID operations remain guarded by environment and confirmation plans.', [
    'Contract-only residual risk: promote live retention, delete, UID repair, and import workflows only after permissions, time windows, and series impact can be proven.',
  ]),
  'guarded-operations': strong('Time-series guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and Prometheus cardinality/profile/metrics, InfluxDB profile/metrics/access/retention/import-export/delete, and OpenTSDB stats/UID repair/import-export/delete requests.', [
    'Contract-only residual risk: keep admin execution plan-only until live endpoint capability and permission checks are adapter-backed.',
  ]),
  'diagnostics-performance': strong('Time-series diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, query profile/cardinality plans, Rust metrics/profile request planning, and deterministic TSDB/head status, target/rule health, task/retention status, API stats, UID repair preflights, and cardinality checks.', [
    'Contract-only residual risk: connect live sampling, backend health, and long-range query impact estimates after optional fixtures exist.',
  ]),
  'import-export': strong('Time-series import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Prometheus bounded range export plans, InfluxDB line-protocol import/export plans, and OpenTSDB API export/import plans without claiming mutable Prometheus imports.', [
    'Contract-only residual risk: add adapter-owned file workflows and optional live import/export validation before execution promotion.',
  ]),
  tests: strong('Wave 5 time-series engines have deterministic manifest, query-builder descriptor, planner, browser-preview, object-view action, and completeness coverage for the contract slice.', [
    'Contract-only residual risk: add optional live Prometheus, InfluxDB, and OpenTSDB fixture tests outside default CI.',
  ]),
})

const WAVE5_GRAPH_PROFILE = profile({
  'connection-flow': strong('Graph connection flow is pinned across typed shared options, right-drawer fields, browser validation, Rust interpolation, timeout selection, and redaction for endpoint, database/graph, traversal-source, query-language, auth, IAM/SigV4, TLS, timeout, and fetch-size metadata.', [
    'Contract-only residual risk: promote every Bolt, HTTP, Gremlin, SPARQL/openCypher, IAM, and backend-specific mode only after fixture/live validation exists.',
  ]),
  'object-tree': strong('Graph trees expose labels, relationships, properties, indexes, constraints, named graphs, collections, procedures, security, diagnostics, loader, and backend sections through shared/Rust manifests and browser explorer routing.', [
    'Contract-only residual risk: deepen live capability hiding for optional graph algorithms, Neptune loader jobs, JanusGraph backend/index services, and ArangoDB cluster/Foxx features.',
  ]),
  'query-surface': strong('Cypher, AQL, Gremlin, SPARQL/openCypher query descriptors are pinned in browser and desktop manifests, with native explain/profile, graph result, metrics, access, index, and export request shapes.', [
    'Contract-only residual risk: turn the manifest descriptors into richer visual graph builders, parameter workflows, path explain renderers, and live query-status/cancel support where engines allow it.',
  ]),
  intellisense: strong('Neo4j, ArangoDB, JanusGraph, and Neptune suggestions include deterministic Cypher/AQL/Gremlin keywords, graphs, labels, relationship types, property keys, and bounded graph query snippets.', [
    'Contract-only residual risk: add schema-aware path, procedure, traversal-source, index, and IAM completions from live metadata.',
  ]),
  'object-views': strong('Graph object-view parity is pinned across Neo4j, ArangoDB, JanusGraph, and Neptune descriptor-backed workflows, focused descriptor tests, schema/index/constraint/security posture workspaces, graph renderers, and guarded action strips for explain/profile, metrics, access, index, constraint/drop, import/export, and destructive workflows.', [
    'Contract-only residual risk: deepen rendered live explain/profile graphs, Neptune loader timelines, backend-health panels, index lifecycle, and security-permission payloads after driver/cloud fixture validation.',
  ]),
  'safe-editing': partial('Graph writes and schema/admin actions are preview-first with guarded index, constraint/drop, import/export, and IAM/security checks.', [
    'Contract-only residual risk: promote live graph mutations only after identity, transaction, permissions, and environment checks are adapter-backed.',
  ]),
  'guarded-operations': strong('Graph guarded-operation parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, disabled reasons, confirmations, and explain/profile, metrics, access, index create/drop, graph export/import, and destructive object/constraint requests.', [
    'Contract-only residual risk: keep admin execution plan-only until live driver/cloud capability, permission, and rollback checks exist.',
  ]),
  'diagnostics-performance': strong('Graph diagnostics/performance parity is pinned across diagnostics tree roots, object-view posture panels, browser diagnostics payloads, query profile plans, Rust metrics/profile request planning, and deterministic Neo4j JMX/profile, ArangoDB statistics/explain, JanusGraph management/index status, and Neptune CloudWatch/IAM/profile signals.', [
    'Contract-only residual risk: connect live profile graphs, backend health, query status/cancel, loader jobs, and cluster metrics after optional fixtures exist.',
  ]),
  'import-export': strong('Graph import/export parity is pinned across object-view actions, browser manifests, browser planners, Rust manifests, Rust planners, Neo4j/ArangoDB/JanusGraph graph exports, and Neptune loader-style import/export plans with format, query, source, and validation guardrails.', [
    'Contract-only residual risk: add adapter-owned file/cloud storage workflows and optional live import/export validation before execution promotion.',
  ]),
  tests: strong('Wave 5 graph engines have deterministic manifest, query-builder descriptor, planner, browser-preview, object-view action, and completeness coverage for the contract slice.', [
    'Contract-only residual risk: add optional live Neo4j, ArangoDB, JanusGraph, and Neptune fixture/cloud tests outside default CI.',
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
    nativeScore: 4.15,
    targetPhase: 1,
    summary: 'Reference candidate: native MongoDB workflows are broad, with live guarded document inserts and field edits now reflected in the completion matrix; management depth, delete/replace coverage, and live import/export still need finishing.',
    profile: MONGO_PROFILE,
  },
  redis: {
    readiness: 'near-native',
    nativeScore: 3.8,
    targetPhase: 1,
    summary: 'Native key browser, diagnostics, live guarded core key/member edits, capability-gated modules, key import/export plans, and reference test coverage are strong; module editors and deeper admin views remain.',
    profile: REDIS_PROFILE,
  },
  valkey: {
    readiness: 'usable',
    nativeScore: 3.35,
    targetPhase: 1,
    summary: 'Valkey shares the Redis-native workflow, live guarded core key/member edits, and reference tests with Valkey-specific capability text and Redis Stack/vector-only features hidden unless supported.',
    profile: REDIS_PROFILE,
  },
  postgresql: relational(3.35, 2, 'PostgreSQL has live SQL, live primary-key row edits pinned by desktop live-scope tests, rendered EXPLAIN payloads, compact posture panels, and guarded vacuum/analyze/reindex/import/export/backup previews; deeper live pg_stat payloads and EXPLAIN ANALYZE details remain.'),
  cockroachdb: relational(3.15, 2, 'CockroachDB has PostgreSQL-wire live SQL and row edits pinned by desktop live-scope tests, native cluster/job/contention posture panels, guarded jobs/ranges/regions/sessions/roles/import/export/backup previews, and distributed explain/profile plan contracts; deeper crdb_internal payloads and live management execution remain.'),
  sqlserver: relational(3.35, 2, 'SQL Server has TDS SQL, live primary-key row edits pinned by desktop live-scope tests, rendered SHOWPLAN_TEXT payloads, compact storage/index/workload/security/Agent posture panels, and guarded statistics/index/Query Store/import/export/backup previews; XML Showplan, Azure auth, and live management execution remain.'),
  mysql: relational(3.05, 2, 'MySQL has live SQL and primary-key row edits pinned by desktop live-scope tests, Workbench-style trees, storage/index/security/diagnostic panels, rendered EXPLAIN payloads, and guarded maintenance/import/export previews; deeper performance_schema and live management execution remain.'),
  mariadb: relational(3.05, 2, 'MariaDB shares the MySQL live SQL/edit base with native status/security panels, MariaDB profile previews, desktop live-scope tests, and guarded maintenance/import/export previews; deeper role semantics, optimizer traces, and routine/event management remain.'),
  sqlite: relational(3.2, 2, 'SQLite has local-file SQL, live primary-key row edits pinned by desktop live-scope tests, rendered EXPLAIN QUERY PLAN/bytecode payloads, local posture panels, and guarded PRAGMA/integrity/analyze/optimize/vacuum/reindex/export/backup previews; richer trigger/index editing and backup/export execution remain.'),
  oracle: {
    readiness: 'foundation',
    nativeScore: 2.75,
    targetPhase: 2,
    summary: 'Oracle has a contract-complete SQL UX with SQL Developer-style trees, object views, DBMS_XPLAN-shaped plan/profile payloads, and guarded import/export/RMAN previews; live driver execution remains the explicit contract-only residual risk.',
    profile: ORACLE_RELATIONAL_PROFILE,
  },
  timescaledb: relational(3.2, 2, 'TimescaleDB has PostgreSQL-wire SQL, live primary-key row edits pinned by desktop live-scope tests, native hypertable/chunk/compression/retention/continuous aggregate/job views, rendered PostgreSQL EXPLAIN payloads, and guarded policy/import/export/backup previews; deeper live Timescale metrics and policy execution remain.'),
  elasticsearch: {
    readiness: 'foundation',
    nativeScore: 3.55,
    targetPhase: 3,
    summary: 'Elasticsearch has a contract-complete native search UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, live bounded search, explicit-id document edits pinned by desktop live-scope tests, profile payloads, and index/template/pipeline/lifecycle/security/bulk/snapshot plans; live cloud auth/admin execution remains residual risk.',
    profile: SEARCH_PROFILE,
  },
  opensearch: {
    readiness: 'foundation',
    nativeScore: 3.45,
    targetPhase: 3,
    summary: 'OpenSearch shares the contract-complete search UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, ISM/security-aware request routing, typed managed/SigV4 options, profile payloads, explicit-id document edits pinned by desktop live-scope tests, and admin/import/export plans; live IAM/plugin detection and Performance Analyzer remain residual risk.',
    profile: SEARCH_PROFILE,
  },
  dynamodb: {
    readiness: 'foundation',
    nativeScore: 3.5,
    targetPhase: 3,
    summary: 'DynamoDB has typed connection-flow parity for local/AWS modes, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, table/index/capacity/TTL/stream/backup panels, read API execution, live guarded item edits pinned by desktop live-scope tests, consumed-capacity payloads, and AWS-shaped metrics, access, import/export, backup/restore, and table-management previews; full AWS SDK/SigV4/cloud diagnostics remain residual risk.',
    profile: DYNAMODB_PROFILE,
  },
  cassandra: {
    readiness: 'foundation',
    nativeScore: 3.05,
    targetPhase: 3,
    summary: 'Cassandra has typed native connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, CQL request-builder execution, partition-key/tracing guardrails, keyspace/table/security/diagnostic panels, and CQL/nodetool-shaped index, permission, import/export, backup/restore, and drop previews; live binary driver execution remains residual risk.',
    profile: WIDE_COLUMN_PROFILE,
  },
  cosmosdb: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 4,
    summary: 'Cosmos DB has contract-complete native UX for SQL API account/container browsing with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, RU/query diagnostics, indexing, throughput, consistency, failover, access, import/export, destructive previews, and deterministic Wave 4 coverage; live Azure SDK/cloud validation remains residual risk.',
    profile: WAVE4_DOCUMENT_PROFILE,
  },
  litedb: {
    readiness: 'foundation',
    nativeScore: 3.3,
    targetPhase: 4,
    summary: 'LiteDB has contract-complete native UX for local-file connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, collection/index/storage views, checkpoint/compact/rebuild, import/export, backup, collection/index operations, and deterministic Wave 4 coverage; live encrypted-file and lock-state validation remains residual risk.',
    profile: WAVE4_DOCUMENT_PROFILE,
  },
  memcached: {
    readiness: 'foundation',
    nativeScore: 3.25,
    targetPhase: 4,
    summary: 'Memcached has contract-complete native UX for typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, server stats, slab/item metadata, known-key get/gets/set/touch/incr/decr/delete, stats reset, flush, metrics, LRU dump previews, and deterministic Wave 4 coverage; live protocol/SASL validation remains residual risk.',
    profile: WAVE4_CACHE_PROFILE,
  },
  duckdb: {
    readiness: 'usable',
    nativeScore: 3.7,
    targetPhase: 4,
    summary: 'DuckDB has contract-complete local analytics UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, local-file creation, SQL SELECT builder coverage, SQL, explain/profile, extension posture, analyze/checkpoint/import/export/backup plans, and object-view actions; live extension/file workflow promotion remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  clickhouse: {
    readiness: 'foundation',
    nativeScore: 3.45,
    targetPhase: 4,
    summary: 'ClickHouse has contract-complete analytics UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, ClickHouse SQL, system/query-log diagnostics, MergeTree posture, import/export, optimize, TTL materialization, freeze snapshot, access, and drop previews; live cluster/admin execution remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  snowflake: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 4,
    summary: 'Snowflake has contract-complete warehouse UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, Snowflake SQL, query/profile history, warehouse metrics, role/grant inspection, stage export/load, zero-copy clone, suspend/resume, and drop previews; live driver/cloud validation remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  bigquery: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 4,
    summary: 'BigQuery has contract-complete warehouse UX with typed connection-flow parity, pinned native tree parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, SQL SELECT builder coverage, GoogleSQL dry-run cost plans, dataset/table/job/security views, IAM inspection, extract/load, table copy, metrics, and destructive previews; live ADC/OAuth/cloud validation remains residual risk.',
    profile: WAVE4_ANALYTICS_PROFILE,
  },
  prometheus: {
    readiness: 'foundation',
    nativeScore: 3.3,
    targetPhase: 5,
    summary: 'Prometheus has contract-complete time-series UX with typed connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, metric/label/target/rule trees, pinned PromQL range builder descriptors, profile requests, TSDB metrics, cardinality analysis, bounded range export plans, and bounded query diagnostics; live auth-proxy and long-range validation remain residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  influxdb: {
    readiness: 'foundation',
    nativeScore: 3.35,
    targetPhase: 5,
    summary: 'InfluxDB has contract-complete time-series UX with version-aware connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, bucket/measurement/tag/field trees, pinned Flux/InfluxQL builder descriptors, profile payloads, metrics, token access inspection, retention updates, import/export, and guarded delete plans; live token/version validation remains residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  opentsdb: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 5,
    summary: 'OpenTSDB has contract-complete time-series UX with HTTP connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, metric/tag/UID/tree/stat views, pinned metric query builder descriptors, native stats, API export plans, UID repair, and guarded metadata delete previews; live legacy deployment and backend validation remain residual risk.',
    profile: WAVE5_TIMESERIES_PROFILE,
  },
  neo4j: {
    readiness: 'foundation',
    nativeScore: 3.4,
    targetPhase: 5,
    summary: 'Neo4j has contract-complete graph UX with typed connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, label/relationship/index/constraint/security trees, pinned Cypher pattern builder descriptors, explain/profile, JMX metrics, index/security previews, graph export plans, and guarded constraint/object drops; live Bolt mutation validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  arango: {
    readiness: 'foundation',
    nativeScore: 3.3,
    targetPhase: 5,
    summary: 'ArangoDB has contract-complete graph/document UX with HTTP connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, collection/edge/graph/index/security trees, pinned AQL graph builder descriptors, explain/profile, admin statistics, permission inspection, index plans, and graph export previews; live cluster/Foxx/admin validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  janusgraph: {
    readiness: 'foundation',
    nativeScore: 3.2,
    targetPhase: 5,
    summary: 'JanusGraph has contract-complete graph UX with Gremlin connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, schema/index/backend trees, pinned Gremlin traversal builder descriptors, traversal explain/profile, management metrics, index lifecycle previews, and graph export plans; live backend/index-service validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
  neptune: {
    readiness: 'foundation',
    nativeScore: 3.25,
    targetPhase: 5,
    summary: 'Amazon Neptune has contract-complete graph UX with typed cloud/IAM connection-flow parity, object-view parity, guarded operation parity, diagnostics/performance parity, import/export parity, pinned Gremlin/openCypher builder descriptors, SPARQL surface, profile/explain payloads, CloudWatch metrics, IAM access inspection, loader-style import/export, and guarded graph plans; live SigV4/cloud validation remains residual risk.',
    profile: WAVE5_GRAPH_PROFILE,
  },
}

export const DATASTORE_COMPLETENESS_MATRIX: DatastoreCompletenessSummary[] =
  DATASTORE_FEATURE_BACKLOG.map((entry) => {
    const override = ENGINE_OVERRIDES[entry.engine]
    const profile = override?.profile ?? BETA_PROFILE
    const completionClaim: DatastoreCompletionClaim = CONTRACT_COMPLETE_ENGINE_SET.has(
      entry.engine,
    )
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
      nativeScore: override?.nativeScore ?? (entry.maturity === 'mvp' ? 2 : 1.5),
      targetPhase: override?.targetPhase ?? 5,
      summary: override?.summary ?? `${entry.displayName} has an adapter contract, but still needs engine-native tree, query, object-view, diagnostics, and management depth before promotion.`,
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
  return datastoreCompletenessForEngine(engine)?.criteria.filter(
    (criterion) => criterion.status !== 'native' && criterion.status !== 'strong',
  ) ?? []
}

export function contractIncompleteCriteriaForEngine(engine: DatastoreEngine) {
  return datastoreCompletenessForEngine(engine)?.criteria.filter(
    (criterion) => criterion.contractStatus !== 'covered',
  ) ?? []
}

export function isDatastoreContractComplete(engine: DatastoreEngine) {
  return datastoreCompletenessForEngine(engine)?.completionClaim === 'contract-complete'
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
      ? 'Covered for the contract-only native UX gate; remaining work is live validation, fixture coverage, or deeper native polish.'
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
      'mysql',
      'sqlserver',
    ].includes(engine)
  ) {
    evidence.add('fixture')
  }

  return [...evidence]
}

function residualRiskForEngine(completionClaim: DatastoreCompletionClaim) {
  if (completionClaim === 'native-complete') {
    return 'No known native completion residual risk remains in the contract matrix.'
  }

  if (completionClaim === 'contract-complete') {
    return 'Contract-complete native UX: default CI validates deterministic contracts, browser-preview behavior, plans, docs, and Rust/browser parity; optional live fixture and cloud validation remain residual risk.'
  }

  return 'Incomplete: this engine still needs contract coverage before any native-complete claim.'
}
