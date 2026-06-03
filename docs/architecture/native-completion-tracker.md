# Native Datastore Completion Tracker

Last updated: 2026-06-03

This is the working tracker for moving DataPad++ from **contract-complete native UX** to **native-complete** datastore support, one engine at a time.

The source of truth for scoring and per-criterion status is `packages/shared-types/src/datastore-completeness.ts`. This document is the human-readable execution board: it records the chosen order, the current active datastore, the known native gaps, and the acceptance gate for graduating an engine.

## Status Model

- **Queued**: contract-complete, but native gaps remain.
- **In progress**: the current datastore being completed.
- **Blocked**: implementation cannot continue without a driver, fixture, credential model, or product decision.
- **Native-complete**: all 10 completion criteria are `strong` or `native`, docs and tests are updated, and residual risk no longer contradicts the claim.

For cloud or managed services, native-complete may still include optional live/cloud validation notes, but the default claim must not imply untested production credentials or destructive execution.

## Active Completion Run

| Field | Value |
| --- | --- |
| Active datastore | MongoDB |
| Current claim | Contract-complete, near-native |
| Target claim | Native-complete reference datastore |
| Current score | 4.15 / 5 |
| Incomplete native criteria | IntelliSense, diagnostics/performance, import/export |
| First completion goal | Finish MongoDB aggregation-aware IntelliSense, deeper diagnostic dashboards, and guarded collection import/export execution or a clearly adapter-owned live/fixture gate. |

## Native-Complete Acceptance Gate

Every datastore must pass this gate before its tracker status can move to native-complete:

1. All 10 criteria are `strong` or `native` in `packages/shared-types/src/datastore-completeness.ts`.
2. The engine summary and residual-risk wording do not overclaim live/cloud/destructive validation.
3. User-facing docs are updated in `README.md`, `docs/features.md`, and `docs/architecture/datastore-readiness.md` when behavior changes.
4. This tracker is updated with the completed work and the next active datastore.
5. Deterministic default validation passes: `npm run check:all`, `npm run release:test`, and `npm run ci:workflow:test`.
6. `npm audit --omit=dev` is run and any remaining advisory is explicitly documented.
7. Optional live/fixture/cloud tests are added or documented when native-complete depends on external services.

## Completion Order

| Order | Datastore | Tracker status | Native gaps to close |
| --- | --- | --- | --- |
| 1 | MongoDB | In progress | Aggregation-stage IntelliSense, deeper profiler/currentOp/replica/shard diagnostics, guarded live collection import/export. |
| 2 | Redis | Queued | Command-argument IntelliSense, Pub/Sub/streams/ACL/cluster/sentinel/Lua/functions/module object views, guarded live key import/export. |
| 3 | Valkey | Queued | Redis-parity gaps with Valkey-specific capability hiding and fixture/live validation. |
| 4 | SQLite | Queued | SQL-family connection/tree/query/IntelliSense/object-view/admin/diagnostics/import-export depth, plus richer trigger/index editing and local backup/export execution. |
| 5 | PostgreSQL | Queued | SQL-family connection/tree/query/IntelliSense/object-view/admin/diagnostics/import-export depth, especially pg_stat and EXPLAIN ANALYZE workflows. |
| 6 | SQL Server / Azure SQL | Queued | SQL-family depth plus XML Showplan, Query Store, Agent, security/storage, Azure auth, and live management/import/export execution. |
| 7 | MySQL | Queued | SQL-family depth plus performance_schema, optimizer traces, and richer Workbench-style management. |
| 8 | MariaDB | Queued | SQL-family depth plus MariaDB role semantics, optimizer trace/status, routine and event management. |
| 9 | CockroachDB | Queued | SQL-family depth plus distributed diagnostics, jobs/ranges/contention, backup/import/restore execution. |
| 10 | TimescaleDB | Queued | SQL-family depth plus Timescale metrics and live compression, retention, continuous aggregate, and job policy execution. |
| 11 | Oracle | Queued | SQL-family gaps plus live driver path, live row editing, Oracle fixture tests, dictionary and SQL Monitor disabled reasons. |
| 12 | DynamoDB | Queued | PartiQL, richer expression helpers, and live SDK/SigV4 capacity/cost feedback. |
| 13 | Elasticsearch | Queued | Aggregation builder polish plus ES|QL where available. |
| 14 | OpenSearch | Queued | Aggregation builder polish plus OpenSearch SQL, ISM, plugin-specific query and diagnostics paths. |
| 15 | DuckDB | Queued | Safe local OLAP mutation/admin execution, import/export, extension, and file workflows. |
| 16 | LiteDB | Queued | Live query executor and live document/collection CRUD with file-lock and encryption safety. |
| 17 | Memcached | Queued | Live binary/text protocol routing, CAS/TTL-safe known-key edits, multi-node safety. |
| 18 | Cosmos DB | Queued | Non-SQL API builders and live document CRUD with partition-key and ETag safety. |
| 19 | ClickHouse | Queued | Safe table/admin execution, live import/export, maintenance, cluster metrics, and native protocol depth. |
| 20 | Snowflake | Queued | Safe warehouse/table operations, OAuth/programmatic auth, live history/utilization, import/export, task/stream/share management. |
| 21 | BigQuery | Queued | Safe table/job operations, ADC/service account auth, INFORMATION_SCHEMA metrics, IAM execution, scheduled queries, export/import jobs. |
| 22 | Cassandra | Queued | CQL query depth, live primary-key-safe row editing, live/fixture CQL driver tests. |
| 23 | Prometheus | Queued | PromQL builder depth, target/rule/alert/TSDB live views, range chart polish, optional live profile/cardinality execution. |
| 24 | InfluxDB | Queued | Live retention/delete/import workflows, token/version validation, task and retention management views. |
| 25 | OpenTSDB | Queued | Metric/tag query builder depth, UID/tree management execution, stats dashboards, HBase/backend guidance, API import/export. |
| 26 | Neo4j | Queued | Live Bolt/Cypher depth, graph visualization, rendered operator profiles, schema/security execution, safe graph mutations. |
| 27 | ArangoDB | Queued | Deeper live HTTP/AQL execution, collection/graph/index views, rendered explain/profile, Foxx/security execution. |
| 28 | JanusGraph | Queued | Live Gremlin depth, schema/index/property views, backend health, reindex execution, backend/index-service fixtures. |
| 29 | Neptune | Queued | Gremlin/openCypher/SPARQL mode switching, live IAM/SigV4, loader jobs, rendered explain/profile, CloudWatch dashboards. |

## Completed Native-Complete Engines

None yet.

## Progress Log

- **2026-06-03:** Created this tracker from the current all-engine native gap audit. MongoDB is the first active datastore because it is closest to native-complete and should become the reference pattern for later engines.

## Update Rule

When an engine moves forward:

- update its row in this tracker
- add a short progress-log entry with the date and wave/slice name
- update the shared completeness matrix if a criterion changes
- update the readiness plan and user-facing docs if behavior changes
- run the required validation gate and record any residual audit exception in the final work summary
