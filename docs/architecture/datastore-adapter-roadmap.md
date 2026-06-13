# DataPad++ Datastore Adapter Roadmap

This document is the durable implementation memory for DataPad++'s datastore workbench. It captures the product plan, adapter architecture, feature backlog, safety model, and testing expectations so the roadmap does not live only in chat history.

## North Star

DataPad++ should provide a capability-driven workbench for many datastore families without pretending every engine behaves like SQL. Each adapter should expose what the engine can safely support: connection validation, metadata exploration, query execution, normalized result rendering, permissions, diagnostics, operation planning, and guarded admin/destructive workflows.

The product should prefer real engine protocols and SDKs over ORMs. ORMs can become an optional future context import feature, but they must not be a primary connection mechanism.

## Current Implementation Status

The repository now includes the DataPad++ rename, the current desktop workbench, scoped query tabs, datastore icons, visual builders, richer results, Docker fixtures, release automation, and dependency-free CI checks.

Current live or partially live product surfaces include:

- explicit connection creation and save behavior
- unified Library connection context menus for New Query, Explore, Metrics, Edit Connection, duplicate, folder placement, environment, and delete-style workflows
- explorer and object-tree surfaces that vary by datastore family
- query builders for MongoDB find/aggregation, SQL SELECT, DynamoDB key condition, Cassandra partition-key CQL, and search Query DSL
- datastore-specific query modes such as MongoDB Query Builder/Raw/Scripting, Redis Key Browser/Console, and raw SQL defaults for SQL engines
- rich table and document result renderers, document-only paging, document efficiency mode, non-document virtualization, result export dialogs, result runtime footer, query history, messages, and details
- drag-and-drop document fields into filters, projection, and sort builder sections
- SQL visual table-and-relationship exploration with focused graph layout and guarded relationship/schema actions
- safe edit planning/execution for supported natural data edits
- guarded operation plans for admin/destructive/costly actions
- Settings as a closeable workbench tab with file-based workspace import/export, encrypted bundle integrity, optional secret inclusion, opt-in auto-backups, and curated themes
- datastore completeness tracking in `packages/shared-types/src/datastore-completeness.ts`
- a current production-readiness reference in [Datastore Readiness And Completion Plan](datastore-readiness.md)
- a one-by-one execution board in [Native Datastore Completion Tracker](native-completion-tracker.md)
- Docker fixture profiles with deterministic seed data
- release workflow automation that bumps versions, tags `app-vX.Y.Z`, and creates draft Tauri releases

Naming note: `DATAPADPLUSPLUS_*` is the current environment-variable prefix. Legacy `DATANAUT_*` and `UNIVERSALITY_*` fallbacks are kept only for compatibility.

## Adapter Completion Bar

For this phase, "full implementation" means read/diagnostic-complete:

- Live connection validation where local/container access is realistic.
- Metadata explorer roots and child nodes that match the datastore family.
- Query execution or typed request-builder execution where live cloud execution is gated.
- Normalized result payloads: `table`, `json`, `document`, `keyvalue`, `raw`, `schema`, `diff`, `plan`, `metrics`, `series`, `searchHits`, `graph`, `profile`, and `costEstimate`.
- Permission inspection with effective roles/grants/IAM signals where available.
- Diagnostics for plans, profiles, metrics, query history, warnings, and cost/scan signals.
- Import/export and backup/restore operation planning.
- Guarded operation plans for admin work, destructive DDL/DML, profiling that executes queries, backup/restore, import/export, and cloud-cost operations.

Natural data edits can be live when they are identity-safe and adapter-supported, such as SQL row edits with primary keys, MongoDB document field edits with document ids, Redis/Valkey key/TTL edits, DynamoDB item edits with complete keys, and Cassandra row edits with complete primary-key conditions. Destructive/admin mutation execution remains preview-only until a later pass explicitly enables execution with confirmation and permission checks.

## Families

The shared contract should support these datastore families:

- `sql`
- `document`
- `keyvalue`
- `graph`
- `timeseries`
- `widecolumn`
- `search`
- `warehouse`
- `embedded-olap`

## Query Languages

The shared contract should support these query languages:

- `sql`
- `t-sql`
- `plsql`
- `sqlite-sql`
- `mongodb`
- `redis`
- `cypher`
- `flux`
- `cql`
- `aql`
- `gremlin`
- `sparql`
- `promql`
- `influxql`
- `opentsdb`
- `query-dsl`
- `esql`
- `google-sql`
- `snowflake-sql`
- `clickhouse-sql`

## Capabilities

Adapters should advertise capabilities only when at least one operation, explorer surface, diagnostic payload, or renderer uses the capability.

Core capabilities:

- `supports_sql_editor`
- `supports_schema_browser`
- `supports_document_view`
- `supports_key_browser`
- `supports_graph_view`
- `supports_time_series_charting`
- `supports_visual_query_builder`
- `supports_result_snapshots`
- `supports_streaming_results`
- `supports_transactions`
- `supports_local_database_creation`
- `supports_ttl_management`
- `supports_structure_visualization`

Admin, security, and diagnostics:

- `supports_admin_operations`
- `supports_index_management`
- `supports_user_role_browser`
- `supports_permission_inspection`
- `supports_explain_plan`
- `supports_plan_visualization`
- `supports_query_profile`
- `supports_metrics_collection`
- `supports_query_cancellation`
- `supports_cloud_iam`
- `supports_cost_estimation`
- `supports_import_export`
- `supports_backup_restore`
- `supports_vector_search`

## Operation Model

Adapters should expose a typed operation layer rather than one-off UI buttons.

`DatastoreOperationManifest` should describe:

- Operation id.
- Engine.
- Family.
- Label.
- Object scope.
- Risk: `read`, `write`, `destructive`, `costly`, or `diagnostic`.
- Required capabilities.
- Supported result renderers.
- Whether confirmation is required.
- Whether execution is preview-only.

`OperationPlan` should include:

- Generated SQL, command text, API request, or SDK request plan.
- Whether the operation is destructive.
- Estimated cost or scan impact.
- Required permissions.
- Confirmation text.
- Guardrail warnings.

`PermissionInspection` should include:

- Effective roles/grants/IAM signals.
- Unavailable actions.
- User-facing disabled reasons.
- Warnings for read-only profiles, beta adapters, missing privileges, or unavailable cloud identity.

`AdapterDiagnostics` should include:

- Plans.
- Profiles.
- Metrics.
- Series.
- Query history.
- Cost estimates.
- Warnings.

## Guardrails

DataPad++ should be conservative by default:

- Read-only profiles block writes before execution.
- Production/safe-mode profiles require explicit confirmation for DDL, DML, admin, backup/restore, import/export, and profiling that executes queries.
- `EXPLAIN ANALYZE`, query profiling, deletes, drops, repairs, compactions, backup/restore, and cloud-cost operations must surface warnings.
- Permission-aware disabled actions should explain exactly why an action is unavailable.
- Secrets must be redacted.
- Large results should stream or page; adapters should avoid unbounded query generation.
- Native protocols, drivers, connection strings, local files, cloud SDKs, IAM, OAuth, SigV4, Entra, and Google ADC are valid connection modes.
- ORMs are not connection modes.

## Adapter Waves

### Wave 1: Foundation And Local SQL

Goals:

- Split the Rust adapter layer into registry plus family modules.
- Preserve the app-facing commands and trait shape.
- Deepen PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, and SQLite.
- Add TimescaleDB through PostgreSQL wire plus Timescale metadata.
- Add DuckDB local-file SQL execution and metadata.
- Add ClickHouse HTTP/native-over-HTTP read, query, metadata, and explain support.

### Wave 2: Document, Cache, Search, And Time-Series

Goals:

- MongoDB: databases, collections, indexes, find/aggregation, explain, stats.
- Redis and Valkey: key browser, SCAN, typed reads, TTL, INFO, SLOWLOG, ACL diagnostics.
- Memcached: stats, slabs/items/settings diagnostics, known-key reads, preview-only writes.
- Elasticsearch and OpenSearch: indexes, data streams, mappings, Query DSL, hits/aggs, explain/profile/stats.
- InfluxDB, Prometheus, OpenTSDB: metric/tag explorer, query execution, chartable series, status diagnostics.

### Wave 3: Graph And Wide-Column

Goals:

- Cassandra: CQL contract surface, keyspaces, tables, indexes, materialized views, tracing, partition-key guardrails; native binary protocol execution remains an isolated driver follow-up inside the Cassandra folder.
- Neo4j: Bolt/openCypher metadata, Cypher execution, graph/table results, EXPLAIN/PROFILE.
- ArangoDB: HTTP AQL execution, collections, graphs, indexes, explain/profile.
- JanusGraph: Gremlin request builder and contract adapter; live support after protocol path is confirmed.

### Wave 4: Cloud And Managed Contract Adapters

Goals:

- DynamoDB, Cosmos DB, Neptune, Snowflake, and BigQuery get typed request builders.
- Add dry-run/cost where available.
- Add IAM/permission inspection shapes.
- Add mocked contract tests.
- Gate optional live tests behind environment variables and credentials.

## Datastore Backlog

| Datastore | Family | Query / API | Maturity Target | Feature Stories |
| --- | --- | --- | --- | --- |
| PostgreSQL | `sql` | SQL | `mvp` | Connect, schema/table/view/function/extension browser, row/table querying with before/after edit evidence, compact storage/index/security/extension/activity panels, role memberships, default privileges, normalized grants, extension update hints and owned objects, DDL/index plans, `EXPLAIN`, rendered guarded `EXPLAIN ANALYZE` JSON profile dashboards, locks/sessions, `pg_stat*`, guarded role/extension previews, vacuum/analyze/reindex helpers, guarded CSV/JSON/NDJSON table import/export, and bounded JSON/SQL logical backup packages. |
| CockroachDB | `sql` | SQL / PostgreSQL wire | `mvp` | PostgreSQL-compatible connection, databases/schemas/tables/indexes/constraints, compact table/cluster/locality/job/contention/security panels, ranges, regions/localities, jobs, sessions, contention, roles/grants, cluster/node status, read-safe `SHOW JOBS`, `SHOW RANGES`, `SHOW CLUSTER SETTING`, guarded `EXPLAIN ANALYZE (DISTSQL)`, backup/restore/import/export, job-control, range-movement, and zone-config previews. |
| SQL Server / Azure SQL | `sql` | T-SQL | `mvp` | Schema/table/view/procedure/index browser, DDL plans, T-SQL editor, compact storage/index/workload/security/Agent panels, estimated/actual plans, Query Store workload previews, DMV dashboards, role/permission inspection, and guarded statistics/index maintenance previews. |
| MySQL | `sql` | SQL | `mvp` | Workbench-style table/column/index/FK/routine browser, storage/index/security/diagnostics panels, DESCRIBE/SHOW helpers, SQL editor, EXPLAIN/ANALYZE, user@host grants, and guarded check/analyze/optimize/repair/event previews. |
| MariaDB | `sql` | SQL | `mvp` | MySQL-compatible surfaces plus MariaDB roles, MariaDB EXPLAIN/ANALYZE output, engine/status panels, grants, routines, and guarded table/event maintenance previews. |
| SQLite | `sql` | SQLite SQL / PRAGMA | `mvp` | Open/create DB, tables/indexes/views/triggers, PRAGMA metadata, compact file/maintenance/schema posture panels, `EXPLAIN QUERY PLAN`, guarded integrity check, analyze, optimize, vacuum, reindex, and local backup/export previews. |
| Oracle | `sql` | SQL/PLSQL | `beta` | Schema/table/index/sequence/package browser, DDL editor, EXPLAIN PLAN/DBMS_XPLAN renderer, session/wait metrics, object grants, client-runtime warnings. |
| TimescaleDB | `timeseries` | SQL / PostgreSQL wire | `beta` then `mvp` | PostgreSQL features plus native hypertable/chunk/compression/retention/continuous-aggregate/job branches, compact posture panels, guarded policy/refresh previews, and deeper time-series dashboards. |
| MongoDB | `document` | Query API / aggregation | `mvp` | Database/collection/index browser, document CRUD planning, visual find/filter builder, aggregation builder, explain, index stats, schema inference, shard/replica metrics. |
| DynamoDB | `widecolumn` | Query/Scan/PartiQL | `beta` | Table/item browser, key-condition builder, typed local/AWS connection option contract, key design, GSI/LSI viewer, TTL/streams/backups/capacity panels, hot partition signals, and guarded AWS-shaped previews for GSI, TTL, streams, capacity, backup, access, and export workflows. |
| Cassandra | `widecolumn` | CQL | `beta` | Typed contact-point, secure-bundle, TLS, consistency, retry, and load-balancing connection options; keyspace/table/type/index/materialized-view browser, CQL editor, partition-key builder, SAI/index guidance, tracing, repair/compaction status. |
| Cosmos DB | `document` | SQL API and multi-model APIs | `beta` | Typed emulator, account endpoint, Entra, managed identity, resource-token, consistency, region, and request option contract; account/database/container browser, SQL query builder, partition/RU/indexing/global distribution panels, guarded throughput/consistency/failover previews, RU charge, query metrics, latency charts, API adapters. |
| LiteDB | `document` | LiteDB API / .NET bridge | `beta` | Open/create file, collection/document/index CRUD planning, query editor, password/encryption, export/import, schema sampling, checkpoint/compact previews. |
| Redis | `keyvalue` | RESP commands | `mvp` | Key browser, SCAN, typed editors, TTL, delete/rename plans, INFO/SLOWLOG/ACL, Streams/JSON/Search module support. |
| Valkey | `keyvalue` | RESP commands | `beta` then `mvp` | Redis-compatible connection, SCAN, typed reads, TTL, diagnostics, ACL where supported. |
| Memcached | `keyvalue` | Text/binary protocol | `beta` | Server stats, version, known-key get/gets, set/delete/incr/decr plans, slab/hit-rate/eviction dashboards, guarded stats reset and flush previews. |
| Neo4j | `graph` | Cypher | `beta` | Typed endpoint/database/auth/TLS/query options, database/node-label/relationship/index/constraint browser, Cypher editor, graph renderer, EXPLAIN/PROFILE, role/security browser. |
| Neptune | `graph` | Gremlin/openCypher/SPARQL | `beta` | Typed endpoint/path/database/language/AWS SigV4/IAM/TLS options, language editors, graph/RDF renderers, status/cancel, explain/profile, CloudWatch metrics, bulk loader workflows. |
| ArangoDB | `graph` | AQL / HTTP API | `beta` | Typed endpoint/database/graph/auth/TLS/query options, collection/document/edge/graph browser, AQL editor, index CRUD planning, AQL explain/profile, permissions, Foxx later. |
| JanusGraph | `graph` | Gremlin | `beta` | Typed endpoint/traversal-source/auth/TLS/query options, schema/index/property/label browser, Gremlin editor, graph renderer, index lifecycle/reindex, backend health. |
| InfluxDB | `timeseries` | Flux/InfluxQL/SQL | `beta` | Bucket/measurement/field/tag explorer, query editor, line protocol import, retention/tasks, cardinality posture, guarded retention previews, v1/v2/v3 compatibility. |
| Prometheus | `timeseries` | PromQL / HTTP API | `beta` | PromQL editor, series/label/target/rule browser, instant/range charts, alerts/rules/status, TSDB/head stats, guarded cardinality previews. |
| OpenTSDB | `timeseries` | HTTP/Telnet API | `beta` | Metric/tag explorer, query builder with aggregator/downsample, stats, UID/tree management, guarded UID repair previews, network ACL warnings. |
| Elasticsearch | `search` | Query DSL / ES\|QL / SQL | `beta` | Typed HTTP, Elastic Cloud, API key, default-index, TLS, and timeout options; cluster/index/data-stream/mapping browser, Query DSL editor, hits/aggs/charts, cluster/field/shard/segment/lifecycle/ingestion/security posture panels, guarded force-merge/cache/reindex/open-close/template/pipeline/ILM/task/snapshot previews, and richer profile/explain still to deepen. |
| OpenSearch | `search` | Query DSL / OpenSearch APIs | `beta` | Typed HTTP, managed endpoint, AWS SigV4, default-index, TLS, and timeout options; Elasticsearch-like adapter with ISM-aware lifecycle previews, security-plugin surfaces, task/snapshot workflows, and remaining Performance Analyzer/live SigV4/plugin-detection depth. |
| ClickHouse | `warehouse` | ClickHouse SQL | `beta` then `mvp` | Typed HTTP/native endpoint/database/auth/TLS/row-limit connection options, database/table/materialized-view browser, SQL editor, import/export plans, EXPLAIN pipeline, `system.query_log`, MergeTree parts, replicas, metrics dashboards, guarded table optimization/TTL/freeze previews, cluster topology. |
| DuckDB | `embedded-olap` | SQL | `beta` | Typed local-file/memory/extension/thread/memory-limit connection options, open/create DB, table/view/schema browser, SQL over CSV/Parquet, EXPLAIN/ANALYZE/profiling, PRAGMA metadata, local-file/extension/maintenance posture panels, guarded analyze/checkpoint/extension/import/export previews. |
| Snowflake | `warehouse` | Snowflake SQL | `beta` | Typed account/endpoint/database/schema/warehouse/role/auth/TLS/row/cost connection options, account/database/schema/table/stage/warehouse browser, SQL editor, role/warehouse selector, query history/profile, cost/utilization charts, guarded zero-copy clone and warehouse suspend/resume previews, tasks/streams/shares. |
| BigQuery | `warehouse` | GoogleSQL | `beta` | Typed endpoint/project/dataset/location/auth/row/cost connection options, project/dataset/table/job browser, SQL editor, dry-run byte estimate, INFORMATION_SCHEMA.JOBS dashboards, slot usage, guarded table copy previews, scheduled queries. |

## Architecture Refactor Plan

The adapter layer should keep datastore-owned code together. The current preferred shape is:

```text
apps/desktop/src-tauri/src/adapters/
  mod.rs                 # facade and public exports only
  contract.rs            # DatastoreAdapter trait
  registry.rs            # authoritative runtime adapter registry
  runtime.rs             # command-facing dispatch helpers
  common/                # shared payloads, guardrails, paging, diagnostics, operations
  datastores/
    postgresql/          # PostgreSQL wire family: postgres, cockroach, timescale
    mysql/
    sqlite/
    sqlserver/
    duckdb/
    clickhouse/
    mongodb/
    redis/
    valkey/
    memcached/
    cassandra/
    neo4j/
    arango/
    janusgraph/
    neptune/
    dynamodb/
    cosmosdb/
    snowflake/
    bigquery/
    influxdb/
    prometheus/
    opentsdb/
    search/              # Elasticsearch/OpenSearch shared HTTP search family
    planned/             # only engines not yet concrete
```

Refactor rules:

- Keep `adapters::manifests`, `execution_capabilities`, `test_connection`, `list_explorer_nodes`, `inspect_explorer_node`, `execute`, `fetch_result_page`, `cancel`, `operation_manifests`, `plan_operation`, `inspect_permissions`, and `collect_diagnostics` stable.
- Move one datastore at a time unless several engines share a protocol implementation.
- Add contract tests before and after moving a family.
- Avoid changing behavior during extraction unless a bug is found.
- Prefer each datastore folder to contain narrow `catalog`, `connection`, `explorer`, `query`, and `diagnostics` modules over large family files.
- Keep preview/cloud adapters honest: beta maturity and preview-only risky operations until live execution exists.

## Test Plan

### Rust Contract Tests

Every adapter must cover:

- Manifest registration.
- Family.
- Query language.
- Capabilities.
- Operation manifests.
- Permission inspection.
- Diagnostics shape.
- Explorer root shape.
- Query execution payload shape, or request-builder payload for cloud previews.
- Pagination/cancellation response shape.
- Safe defaults.

### Fixture Tests

Local/container fixtures should cover:

- PostgreSQL
- CockroachDB
- SQL Server
- MySQL
- MariaDB
- SQLite
- MongoDB
- Redis
- Valkey
- Memcached
- Cassandra-compatible
- Neo4j
- ArangoDB
- InfluxDB
- Prometheus
- OpenSearch/Elasticsearch
- ClickHouse
- DuckDB

### Cloud Contract Tests

Mocked contract tests should cover:

- DynamoDB
- Cosmos DB
- Neptune
- Snowflake
- BigQuery
- Managed Elasticsearch/OpenSearch
- LiteDB bridge behavior

Optional live tests must run only when credentials and explicit environment variables are present.

### UI Tests

Every engine should have:

- Selectable connection profile.
- Per-engine screen.
- Explorer root.
- Query editor label.
- Diagnostics tab.
- Disabled reason rendering.
- Guarded operation preview.
- Visual builder preservation of filters/limits.

### Guardrail Tests

Guardrail tests must prove:

- Read-only profiles block writes.
- Production/safe mode requires confirmation for risky operations.
- Profiling and `EXPLAIN ANALYZE` warn when they execute the query.
- Destructive DDL/DML is never silently executed.
- Cloud-cost operations show dry-run/cost warnings.

## Current Milestone State

At the current milestone:

- CockroachDB is registered as a first-class MVP SQL engine.
- The adapter trait already exposes operation manifests, operation planning, permissions, diagnostics, result paging, cancellation, metadata explorer, and execution.
- The shared model includes datastore experience manifests, scoped query targets, query-builder states, safe edit contracts, operation plans, permission inspection, and normalized result payloads.
- MongoDB, SQL SELECT, DynamoDB, Cassandra, and search query builders have UI surfaces and raw-query synchronization.
- The results workbench has split renderer components for table, document, JSON/tree, key-value, search, raw, messages, details, and history-style workflows.
- Natural data edits are being added through safe edit contracts; admin/destructive operations remain guarded preview plans.
- PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, SQLite, MongoDB, Redis, TimescaleDB, ClickHouse, Valkey, Memcached, ArangoDB, BigQuery, Cassandra, Cosmos DB, DuckDB, DynamoDB, Elasticsearch/OpenSearch, InfluxDB, JanusGraph, LiteDB, Neo4j, Neptune, OpenTSDB, Oracle, Prometheus, and Snowflake have concrete adapter structs.
- Every declared datastore now has an adapter backlog entry, tree manifest, object-view descriptor owner, and object-view route or family workspace route.
- TimescaleDB, ClickHouse, Valkey, Memcached, Cassandra, LiteDB, Oracle, and cloud/managed adapters remain beta/read-diagnostic oriented where appropriate.
- Snowflake and BigQuery now use concrete cloud-contract request builders rather than the generic beta adapter.
- Cassandra now has a concrete CQL contract adapter, typed native connection options, and partition-key guardrails while native binary protocol execution remains a future driver pass.
- LiteDB now has a concrete .NET sidecar bridge contract adapter with configured live read dispatch, scoped sidecar document CRUD evidence, encrypted-file success/failure validation, JSON collection import/export execution, file-storage import/export/delete execution, and index/collection management execution; packaged distribution and exclusive writer-lock validation remain the final bridge passes.
- Oracle now has a concrete SQL/PLSQL contract adapter with Oracle client/runtime prerequisite warnings while native OCI/thin execution remains a future driver pass.
- The largest immediate architecture risk has shifted from raw adapter sprawl to live-depth gaps, capability hiding, object-view quality, quality budgets, and drift tests between Rust manifests, TypeScript contracts, fixtures, and docs.
- The current per-engine completion inventory is maintained in [Datastore Readiness And Completion Plan](datastore-readiness.md), and the active native-completion queue is maintained in [Native Datastore Completion Tracker](native-completion-tracker.md).
