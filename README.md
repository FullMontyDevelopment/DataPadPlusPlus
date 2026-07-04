<p align="center">
  <img src="apps/desktop/public/logo_transparent.png" alt="DataPad++" width="360" />
</p>

<h1 align="center">DataPad++</h1>

<p align="center">
  <strong>All Data. One Pad.</strong>
</p>

<p align="center">
  <a href="https://github.com/FullMontyDevelopment/DataPadPlusPlus/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/FullMontyDevelopment/DataPadPlusPlus/actions/workflows/ci.yml/badge.svg" />
  </a>
  <img alt="Pre-release" src="https://img.shields.io/badge/status-pre--release-6bbf2a" />
  <img alt="Desktop app" src="https://img.shields.io/badge/app-desktop-222222" />
  <img alt="License" src="https://img.shields.io/badge/license-free_use_source_available-6bbf2a" />
</p>

DataPad++ is a desktop IDE for people who work with more than one kind of datastore.

Instead of bouncing between SQL tools, MongoDB tools, Redis tools, search consoles, cloud dashboards, and local file browsers, DataPad++ brings those workflows into one focused workspace. Connect, explore, query, inspect, edit, test, and manage your data with an experience that adapts to the datastore you are using.

> **Pre-release note**
>
> DataPad++ is currently pre-release software. All 29 declared datastore engines now have a contract-complete native UX gate, but some datastore-specific features still need live fixture, cloud, driver, or deeper native validation before they should be treated as production-complete. Use read-only connections first when connecting to important systems, and treat production changes with care.

## Why DataPad++ Exists

Modern teams rarely use only one database.

You might have PostgreSQL for app data, MongoDB for documents, Redis for cache and streams, Elasticsearch for search, SQLite files on disk, SQL Server in a corporate system, and DynamoDB or Cassandra somewhere in the stack. Each one has its own tools, language, mental model, and sharp edges.

DataPad++ is built to make that easier:

- one desktop workspace for many datastore families
- native-feeling tree views and object views per datastore
- query editors, visual builders, scripts, consoles, and results in one place
- safe live edits where the app can prove the target
- guarded previews for destructive or admin work
- environments, variables, and secret-safe workflows
- a Library for saved queries, scripts, tests, notes, and connection folders
- Workspace Search for connections, Library work, open tabs, closed tabs, scripts, and test suites
- opt-in local API and MCP server workspaces for deliberate desktop integrations
- file-based encrypted workspace exports, optional secret-inclusive bundles, and opt-in auto-backups

The goal is not to flatten every datastore into a generic table viewer. The goal is to make each datastore feel like it has its own purpose-built IDE inside the same app.

## What It Can Do

### Connect To Your Datastores

Create connection profiles for the systems you use every day. DataPad++ supports native fields, local database files, and connection strings where the datastore supports them.

Current focus areas include:

| Family | Datastores |
| --- | --- |
| SQL and relational | PostgreSQL, CockroachDB, SQL Server and Azure SQL, MySQL, MariaDB, SQLite, Oracle, TimescaleDB |
| Document and NoSQL | MongoDB, DynamoDB, Cassandra |
| Key-value and cache | Redis, Valkey, Memcached |
| Search | Elasticsearch, OpenSearch |
| Local and analytical | SQLite, DuckDB, LiteDB |
| Expanding surfaces | Oracle, graph stores, warehouses, time-series, metrics, and more |

All declared engines are accepted for the contract-complete native UX gate. MongoDB, PostgreSQL, CockroachDB, SQL Server and Azure SQL, MySQL, MariaDB, Redis, SQLite, TimescaleDB, Valkey, Oracle, DynamoDB, Elasticsearch, OpenSearch, and DuckDB are native-complete for scoped claims, with optional extensions kept outside those claims unless separately validated.

TimescaleDB is native-complete for the scoped time-series SQL workflow. Its PostgreSQL-wire base, typed deployment/profile metadata, capability hiding, primary-key row edits with before/after `RETURNING *` evidence, native hypertable/chunk/compression/retention/continuous-aggregate/job surfaces, richer live metadata normalizers, rendered profile/time-bucket/chunk/compression/freshness/job/Toolkit/query-window dashboards, guarded policy/job-control/import/export/backup previews, and live-run optional fixture validator are complete for the scoped claim. Policy, job-control, import/export, backup, and restore execution stays plan-only unless a future guarded executor explicitly promotes those workflows.

Secondary datastore families have pinned native connection-flow, object-tree, object-view, guarded-operation, diagnostics/performance, and import/export parity across shared, browser, and Rust contracts. Elasticsearch and OpenSearch are native-complete for scoped plain-HTTP workflows, including aggregation-aware Query DSL helpers, normalized profile stages, explicit-id document edits with before/after `_doc` evidence, explicit plan-only disabled reasons for HTTPS/cloud/token/TLS/SigV4 search profiles, slow-log/allocation diagnostic dashboards, optional local fixture validation, and OpenSearch-specific SQL/ISM/security/Performance Analyzer boundary evidence. Managed SigV4/IAM execution, OpenSearch SQL plugin execution, Performance Analyzer dashboards, desktop file/cloud import-export, snapshot execution, and broader live admin execution remain optional extensions outside those scoped claims. DynamoDB read execution covers guarded read-only PartiQL `ExecuteStatement` requests with capacity and pagination payloads, typed endpointUrl routing, SigV4-shaped local/endpoint-override JSON API headers, conditional-write guards, and consistent before/after `GetItem` evidence. Cloud, graph, warehouse, and other secondary admin/import/diagnostics flows still carry contract-only residual risks for optional live validation.

TimescaleDB now also has typed deployment/profile metadata, capability-hiding for restricted catalog surfaces, rendered profile posture, richer live catalog normalizers, rendered time-bucket/chunk-sizing/compression/freshness/job/Toolkit/query-window dashboards, connection-test extension warnings, profile-specific policy disabled reasons, before/after row-edit evidence plans, job-control previews, native import/export/backup preflights, and a live-run optional fixture validator for extension/catalog, row-evidence, restricted-role, continuous-aggregate, policy/job boundary, compressed chunk, aggregate lag, Toolkit variant, bounded file-copy, and failed-job diagnostic evidence. Oracle is native-complete for the scoped SQLPlus-backed SQL workflow with configurable live query execution and primary-key/ROWID guarded row edits; DynamoDB is native-complete for the scoped local/endpoint-override plus opt-in AWS validation workflow; Elasticsearch and OpenSearch are native-complete for scoped plain-HTTP search workflows. DuckDB is native-complete for the scoped local-file analytics workflow with bundled local-file read/EXPLAIN/profile/catalog execution, guarded CSV table export/import, CSV backup-folder execution, database-file preflight/read-only and scoped lock-boundary evidence, fail-closed JSON/Parquet preloaded-extension-only gates, restore-package preflight, and explicit restore/admin/extension execution-boundary exclusions; extension-loaded JSON/Parquet execution and broader local OLAP mutation/admin/extension execution remain optional extensions.

### Explore Without Guesswork

The Library tree can hold folders, connections, saved queries, scripts, tests, notes, and environments. Expanding a connection shows datastore-owned objects, not a fake generic tree.

Depending on the datastore, DataPad++ can show:

- databases, schemas, tables, views, indexes, functions, procedures, packages, triggers, users, and roles
- MongoDB databases, collections, views, GridFS, indexes, validation rules, schema previews, users, roles, and statistics
- Redis logical databases, type folders, keys, TTLs, memory usage, streams, ACLs, slow logs, and diagnostics
- search indexes, mappings, field capabilities, shards, aliases, lifecycle state, data streams, profile results, explicit document-edit targets, and query tools
- DynamoDB tables, keys, GSIs, LSIs, TTL, streams, backups, capacity, hot partitions, index coverage, PartiQL read helpers, access previews, expression helpers, and item edit targets
- Cassandra keyspaces, tables, primary keys, indexes, materialized views, partition/storage health, tracing, grants, diagnostics, import/export plans, and snapshot plans
- Prometheus, InfluxDB, and OpenTSDB metrics, labels, measurements, tags, targets, rules, UID metadata, stats, posture panels, and guarded profile/cardinality/retention/UID/export previews
- Neo4j, ArangoDB, JanusGraph, and Neptune graph labels, relationships, indexes, constraints, access, metrics, explain/profile, and guarded import/export previews
- Snowflake, BigQuery, and ClickHouse warehouse objects, jobs, stages/reservations, access, cost/storage/compute posture, ClickHouse query-log/MergeTree/cluster posture, dry-run/cost, table clone/copy/optimize/TTL/freeze, metrics, and import/export previews
- DuckDB local files, schemas, tables, views, extensions, external file sources, PRAGMAs, local file posture, extension posture, structured analyze/checkpoint/object admin-scope gates with explicit admin execution-boundary metadata, structured extension install/load gates with explicit extension execution-boundary metadata, guarded CSV table import/export, backup-folder execution, database-file preflight/read-only guard evidence, explicit scoped file-workflow lock-boundary metadata, fail-closed JSON/Parquet preloaded-extension-only gates, restore-package preflight, explicit restore execution-boundary metadata, and JSON/Parquet extension-backed previews
- Cosmos DB containers, partition keys, indexing policy, RU throughput, regions, consistency, access, and guarded throughput/index/failover/export previews
- LiteDB local files, collections, indexes, file storage, storage health, local-file read/write open preflight, encryption/lock-boundary metadata, configured sidecar read-dispatch contracts with local sidecar-process evidence, sidecar-only document CRUD plans, optional .NET engine read/edit/encrypted-file validation, JSON collection import/export execution, file-storage import/export/delete execution, live index/collection management execution, checkpoint/compact, backup/export, and guarded local management previews
- Memcached stats, slabs, item classes, settings, connections, native cache metadata dumps, stats reset, guarded flush previews, and known-key get/gets/set/touch/incr/decr/delete plans
- local database files, metadata, pragmas, tables, indexes, and integrity checks

Right-click menus are designed to be object-aware. A table should feel like a table. A Redis key should feel like a Redis key. A MongoDB collection should feel like a collection, not a generic blob of JSON.

### Query In The Right Mode

Different datastores want different tools. DataPad++ adapts the query window to the connection.

- SQL databases open in a raw SQL editor by default, with metadata-aware IntelliSense.
- MongoDB supports a find query builder, raw JSON command mode, aggregation work, and safe scripting-style reads.
- MongoDB IntelliSense includes aggregation stages, expression operators, snippets, and document field path references from cached metadata and recent results.
- MongoDB document insert, replace, delete, and field set/unset/rename/type-change edits are live-capable in the desktop adapter only when collection/document identity and environment guardrails pass.
- MongoDB diagnostics expose profiler, current operation, replica, shard, and index-usage signals as profile and metric payloads.
- Redis and Valkey open in a native key browser, with a Redis console available when you want commands.
- Redis and Valkey IntelliSense suggests read command syntax, command-specific arguments, known keys, namespace prefixes, SCAN options, subcommands, Redis Stack module hints when supported, and live `COMMAND INFO` metadata from recent console results.
- Redis and Valkey core key/member edits plus stream entry add/delete are live-capable in the desktop adapter after read-only, identity, type, and confirmation checks pass; RedisTimeSeries sample edits, RedisJSON path edits, and vector-set member/attribute edits are live-capable for Redis module keys, while remaining probabilistic module edits stay capability-gated.
- Redis key import/export runs through guarded desktop JSON/NDJSON file workflows for core types, whole-document RedisJSON, RedisTimeSeries samples, vector-set elements, and Redis DUMP/RESTORE snapshot envelopes for opaque module values with concrete path checks, TTL preservation, create-only/replace/validate modes, and before/after metadata; Valkey runs the same guarded workflow for core Redis-compatible strings, hashes, lists, sets, sorted sets, and streams while Redis Stack module file formats stay gated, and browser preview stays plan-only.
- Redis object views render streams and consumer groups, Redis Stack module panels, Pub/Sub, ACL/security, cluster, Sentinel, Lua script, function library, slowlog, latency, memory, client, INFO, persistence, replication, and command-stat payloads as native panels; Valkey uses the same Redis-compatible panels with Valkey-specific labels and gated module actions.
- Document results can feed fields back into query builders by drag and drop.
- Scoped object actions can open a query already aimed at a collection, table, keyspace, index, or view.
- SQL-family connections can open a visual table-and-relationship explorer with focused graph loading, declared relationships, optional inferred links, and guarded schema-operation previews.
- PostgreSQL is native-complete for the scoped SQL workflow: connection profiles include typed TCP, Unix socket, Cloud SQL proxy, application/search-path/session/TLS certificate, and timeout options; IntelliSense includes `pg_catalog` helpers, routine call/definition snippets, profile/session/lock snippets, and safe mixed-case identifier quoting; diagnostics expose live `pg_stat_activity`, `pg_locks`, `pg_stat_user_tables`, and optional `pg_stat_statements` profile payloads where permissions allow, while PostgreSQL row edits now include before/after evidence metadata and object views include extension update hints, extension-owned objects, role memberships, default privileges, normalized grants, guarded parameterized routine execution plans, guarded backend cancel/terminate previews, guarded role/extension operation previews, rendered `EXPLAIN ANALYZE BUFFERS` JSON profile dashboards, guarded desktop table import/export, bounded logical backup packages, and optional fixture validation. Full `pg_dump`/`pg_restore` execution stays outside the scoped claim unless promoted later.
- CockroachDB is native-complete for the scoped distributed SQL workflow: connection profiles include typed deployment mode, Cockroach Cloud organization/cluster metadata, region/locality/version/build fields, auth/TLS disabled reasons, and capability toggles that hide restricted jobs, ranges, regions, diagnostics, security, certificate, zone, and `EXPLAIN ANALYZE` surfaces. Cockroach-owned trees, posture panels, query helpers, IntelliSense snippets, and guarded jobs/ranges/regions/sessions/contention/role/default-privilege/zone/import/export/backup/restore planners are in scope, while live Cockroach Cloud probing, EXPLAIN ANALYZE DEBUG dashboards, job-control execution, zone changes, and live destructive/data-movement execution remain optional extensions.
- SQL Server is native-complete for the scoped SQL Server/Azure SQL workflow: typed auth/profile modes, live TDS SQL, primary-key row edits, SHOWPLAN_TEXT/XML Showplan rendering, Query Store, Extended Events, Agent, security/storage/runtime DMV panels, guarded desktop CSV/JSON/NDJSON table import/export, bounded JSON/SQL logical backup packages, and restore-package validation are in scope; native `.bak`, bcp/sqlcmd, identity insert, and broader live admin execution stay optional.
- MySQL is native-complete for the scoped MySQL workflow: typed connection/profile options, live SQL, primary-key row edits, MySQL query helpers and IntelliSense, Workbench-style trees, performance_schema/status/optimizer object views, guarded management previews, guarded CSV/JSON/NDJSON table import/export, bounded logical backup packages, and restore-package validation are in scope; selected live admin execution, `LOAD DATA INFILE`, mysqlpump/mysqldump parity, richer grant editing, and full restore execution stay optional.
- MariaDB is native-complete for the scoped MariaDB workflow: typed MariaDB connection/profile metadata, live SQL, primary-key row edits, MariaDB-aware Workbench-style trees, native role-mapping/server-variable/storage-engine/ANALYZE object views, guarded `ANALYZE FORMAT=JSON`, role-aware security previews, guarded table import/export, bounded logical backup packages, and restore-package validation are in scope; selected live admin execution, `LOAD DATA INFILE`, mariadb-dump/mysql dump parity, richer role/grant editing, and full restore execution stay optional.
- Search, wide-column, Wave 4 local/document/cache/analytics, and Wave 5 time-series/graph engines now have deterministic IntelliSense providers for their contract-backed keywords, objects, fields, commands, and bounded-query snippets.
- Search, wide-column, Wave 4 local/document/cache/analytics, and Wave 5 time-series/graph object views now have contract parity across descriptor-backed workflows, focused descriptor tests, posture panels, workspace routing, and guarded action strips without claiming live payload depth.
- Search, wide-column, Wave 4 local/document/cache/analytics, and Wave 5 time-series/graph guarded operation previews now have contract parity across object-view actions, browser planning, and Rust planning while staying preview-first for admin/write execution.
- Search, wide-column, Wave 4 local/document/cache/analytics, and Wave 5 time-series/graph diagnostics/performance previews now have contract parity across diagnostics tree roots, posture panels, browser payloads, and Rust metrics/profile plans without claiming live sampling.
- MongoDB collection import/export now runs through guarded desktop JSON, Extended JSON, NDJSON, CSV, and BSON file workflows with adapter-driven fixture evidence; browser preview remains plan-only.
- Search, wide-column, Wave 4 local/document/cache/analytics, and Wave 5 time-series/graph import/export previews now have contract parity across object-view actions, browser planning, and Rust planning while staying plan-only until adapter-owned file/cloud workflows are validated.

Where visual builders exist, they update the actual query immediately. You can learn from the generated query, adjust it, save it, or switch back to the visual mode later.

### Work With Results Like A Datastore IDE

DataPad++ results are built for real data work.

Table results support:

- full-width grid rendering
- sticky headers
- row selection from the row-number column
- keyboard copy shortcuts
- large-result virtualization
- inline editing where supported by the datastore and connection safety rules

Document results support:

- expandable document trees
- root labels based on the document key or id
- BSON/JSON type coloring
- virtualized rows for large documents
- local search across loaded documents
- raw field inspection side panels
- double-click editing for safe fields
- drag fields into filters, projections, and sort sections

Redis and Valkey results support:

- type-aware key detail views
- string, hash, list, set, sorted set, and stream surfaces
- TTL, memory, encoding, and length metadata
- guarded key edits, renames, TTL changes, deletes, imports, and exports

### Manage More Than Queries

DataPad++ is not only a query runner.

It is growing into a full datastore workbench with:

- MongoDB index management, validation views, GridFS tools, schema previews, and user/role surfaces
- Redis diagnostics, slow log views, ACL views, Pub/Sub/cluster/Sentinel/function panels, guarded core and RedisJSON key import/export workflows, guarded stream entry and TimeSeries sample edits, Valkey guarded core key import/export workflows, and type-aware editors
- SQL-style object views for tables, procedures, functions, indexes, constraints, query store, security, and performance areas
- Oracle-style schema, package, storage, security, performance, DBMS_XPLAN, SQL Monitor, PL/SQL compile-diagnostic, primary-key/ROWID row-edit, import/export, and RMAN preview flows
- metrics dashboards where the datastore exposes useful counters
- explain plan rendering, including purpose-built MongoDB explain UI and shared SQL plan views for PostgreSQL, SQL Server SHOWPLAN_TEXT/XML Showplan, MySQL/MariaDB performance_schema/status diagnostics, SQLite, and compatible PostgreSQL-wire engines
- test-suite workspaces for datastore-specific setup, execute, assert, and teardown flows
- interactive result export through Save As dialogs with datastore-appropriate formats such as CSV, JSON, NDJSON, and text
- Workspace Search across saved connections, Library content, scripts, test suites, open tabs, and recently closed tabs
- an opt-in API Server workspace for local REST, GraphQL, or gRPC resources backed by selected datastore objects and saved queries
- an opt-in MCP Server workspace for local LLM clients with scoped auth tokens, setup snippets, metrics, and logs
- per-tab concurrent execution so long-running queries do not block other tabs

Many admin operations are intentionally preview-first. If an action can drop, overwrite, lock, scan heavily, or affect production data, DataPad++ should make that obvious before anything runs.

## Library, Environments, And Safety

The Library is the home base.

You can store:

- connections
- folders and nested folders
- saved queries
- scripts
- snippets
- notes
- snapshots
- test suites
- recent work
- environments

Saved work can live beside the connection it belongs to, so it naturally inherits the right environment.

Environments can define:

- names and colors such as Local, QA, UAT, PROD, or DR
- risk levels
- variables using `{{VAR_NAME}}`
- secret variables that stay masked and resolve only at execution time
- confirmation behavior for risky actions

DataPad++ is designed around a simple rule: make dangerous work visible, and keep secrets out of plain text.

## A Few Cool Details

- MongoDB explain plans become a readable performance dashboard instead of a wall of raw JSON.
- Redis opens as a key browser by default, not a JSON-shaped command editor.
- MongoDB document fields can be dragged into query-builder filters, projections, and sorts.
- Results can dock at the bottom or beside the query editor.
- Non-saveable tabs such as metrics, explorer, and object views do not pretend they have unsaved changes.
- Saved Library items open once, so you do not accidentally edit two copies of the same thing.
- Environment variables are suggested while typing `{{` in supported editors.
- Query tabs show datastore icons, running state, error state, and unsaved state separately.
- Settings open as a normal closeable tab, with Appearance, Workspace, Backups, Security, Experimental, Shortcuts, and Health sections.
- Workspace bundles are encrypted files with integrity verification; optional password inclusion stays encrypted and explicit.
- SQL relationship diagrams show table cards, columns, relationship ends, and focused inspectors without rendering an entire enterprise schema at once.
- API Server and MCP Server stay opt-in, bind locally, and expose only the resources, saved queries, scopes, and clients you configure.

## Pre-Release Expectations

DataPad++ is moving quickly. That is exciting, but it also means:

- some datastore views may still be preview-backed
- some operations may generate a plan before live execution is available
- optional engines may need additional local drivers, Docker fixtures, or credentials
- contract-complete does not mean every engine has been live-verified against production services
- release artifacts may change as packaging matures
- docs may lag a little behind fast-moving features

If you are evaluating the app, the best path is:

1. Start with local or Docker-backed datastores.
2. Use read-only profiles for anything important.
3. Try the Library, query windows, result views, and object views.
4. Move to editable workflows only after you are comfortable with the guardrails.

## Download Releases

Releases are published from GitHub Actions.

Download builds from the [GitHub Releases page](https://github.com/FullMontyDevelopment/DataPadPlusPlus/releases).

Look for desktop artifacts such as:

- Windows installer or executable
- Linux packages or AppImage
- macOS builds where available

GitHub also adds automatic "Source code" zip and tar files to every release. Those are normal repository archives, not the app installers.

## Build From Source

Most users should download a release. Build from source if you want to contribute, test unreleased work, or run local datastore fixtures.

### Requirements

- Node.js 24+
- npm 11+
- Rust stable toolchain
- Tauri platform prerequisites from the [official Tauri docs](https://tauri.app/start/prerequisites/)
- Docker, when running optional datastore fixtures
- On Windows: Visual Studio C++ desktop workload and the Windows SDK required by Tauri native builds

### Install

```bash
npm install
```

### Run The Desktop App

```bash
npm run tauri:dev
```

### Build

```bash
npm run build
npm run tauri:build
```

### Validate

```bash
npm run check
npm run check:native
```

## Sample Datastores

The repository includes Docker fixtures with repeatable seed data for local testing.

```bash
npm run fixtures:up
npm run fixtures:seed
```

Optional fixture profiles add more datastore coverage for broader testing.

PostgreSQL fixture evidence can be checked with `npm run fixtures:validate:postgres`. MongoDB fixture evidence can be checked with `npm run fixtures:validate:mongodb`. Redis/Valkey fixture evidence can be checked with `npm run fixtures:validate:redis -- --require-stack --require-valkey`; add `--require-vector` only when the selected Redis Stack image exposes `VADD`. TimescaleDB fixture evidence can be checked with `npm run fixtures:validate:timescale` after starting and seeding the `sqlplus` profile. Oracle optional fixture evidence, including DBMS_XPLAN, SQL Monitor boundary, PL/SQL compile diagnostics, row identity, bounded SQLPlus export/import, restricted dictionary, and Data Pump/RMAN preview-boundary checks, can be checked with `npm run fixtures:validate:oracle` after starting and seeding the `oracle` profile. DynamoDB Local optional fixture evidence, including seeded volume, consumed-capacity reads, Query/GetItem/PartiQL, conditional item-edit evidence, transient key/GSI/TTL metadata, and backup/import-export boundaries, can be checked with `npm run fixtures:validate:dynamodb` after starting and seeding the `cloud-contract` profile. Search optional fixture evidence, including seeded Elasticsearch/OpenSearch volume, aggregation/profile payloads, document edit evidence, slow-log/allocation diagnostics, bounded `_search`/`_bulk` primitives, and OpenSearch SQL/ISM/security/Performance Analyzer boundaries, can be checked with `npm run fixtures:validate:search` after starting and seeding the `search` profile. DuckDB optional fixture evidence, including bundled local-file read/EXPLAIN/profile execution, catalog inspection, diagnostics templates, guarded CSV export/import, backup-folder execution, database-file preflight/read-only guard evidence, explicit lock-boundary evidence, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight, explicit restore/admin/extension execution-boundary evidence, and write-SQL guard boundaries, can be checked with `npm run fixtures:validate:duckdb` without Docker. LiteDB optional fixture evidence, including local-file read/write open preflight, encryption and lock-boundary metadata, fixture-token and local sidecar-process read dispatch, bounded response normalization, process open-failure mapping, timeout, and redaction evidence, can be checked with `npm run fixtures:validate:litedb` without Docker or a real .NET LiteDB engine sidecar; optional real LiteDB engine sidecar validation, including guarded full-document insert/update/delete, before/after reads, read-only mutation blocking, `_id` mismatch blocking, encrypted-file correct-password open/read evidence, wrong-password failure evidence without secret/path leakage, JSON collection import/export execution evidence, file-storage import/export/delete evidence, guarded index create/drop, `_id` index drop blocking, guarded collection drop, and post-drop collection listing, can be run with `DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet` after the .NET sidecar has been restored and built. Optional live AWS DynamoDB validation can be run with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE=1 npm run fixtures:validate:dynamodb:cloud` after configuring `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, an AWS profile, STS AssumeRole, web identity, ECS task, or EC2 metadata credential mode; table, CloudWatch, IAM, and metadata checks stay separately gated by documented environment variables.

See [Docker Fixtures](tests/fixtures/README.md) for connection details and commands.

## Documentation

- [Feature Guide](docs/features.md)
- [Development Guide](docs/contributing/development.md)
- [Testing Strategy](docs/testing/strategy.md)
- [Settings, Workspace Bundles, And Backups](docs/settings-and-workspace.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Datastore Adapter Roadmap](docs/architecture/datastore-adapter-roadmap.md)
- [Datastore Readiness And Completion Plan](docs/architecture/datastore-readiness.md)
- [Native Datastore Completion Tracker](docs/architecture/native-completion-tracker.md)
- [Security And Safety](docs/architecture/security-and-safety.md)

## Contributing

Contributions are welcome, especially around datastore-native experiences, safety, testing, packaging, and documentation.

Good contributions should:

- make a datastore feel more natural to use
- avoid generic raw payload dumps where a purpose-built view would help
- keep risky actions explicit and guarded
- keep secrets out of workspace files, logs, diagnostics, and exports
- add tests for user-facing behavior and adapter safety
- keep the UI compact and workbench-like

Start with the [Development Guide](docs/contributing/development.md).

## License

DataPad++ is source-available under the [DataPad++ Free Use License 1.0](LICENSE).

DataPad++ is free to use for personal, educational, nonprofit, government, internal business, and commercial work. Companies may use the official application internally without buying a license.

The license does not allow redistribution, selling, white-labeling, rebranding, bundling, hosted or managed-service use, publishing modified builds, or using the source code/assets to build a competing or substitute product without a separate written license.

See [Commercial And Corporate Use](COMMERCIAL-LICENSE.md) for the practical summary.

Sponsorships and donations are welcome and help support development, but they are not required for ordinary internal use.
