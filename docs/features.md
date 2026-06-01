# DataPad++ Feature Guide

DataPad++ is a desktop workbench for databases and datastores. It is built for developers, analysts, support engineers, and operators who need to move between different data systems without changing tools every few minutes.

This guide focuses on what the application lets you do. For implementation details, see the architecture and contributing docs.

## The Everyday Workflow

Most work in DataPad++ follows a simple flow:

1. Create or choose a connection.
2. Pick the environment you are working in.
3. Explore the available objects.
4. Open a query or browser tab for the object you care about.
5. Run, inspect, edit safely where supported, and save useful work into the Library.

The app is intentionally local-first. Your workspace, saved work, and connection profiles live on your machine, and secrets are handled through desktop-safe storage where available.

## Connections

Connections are the starting point for every datastore. A connection profile can include the datastore type, host, port, database name, local file path, connection string, tags, notes, and read-only settings.

DataPad++ supports several connection styles depending on the datastore:

- host, port, database, username, and password
- connection strings for engines that support them
- local database files for file-backed engines such as SQLite, DuckDB, and LiteDB-style workflows
- cloud-style or SDK-backed connection flows where those adapters are available

Creating a connection does not immediately add it to the workspace. You can fill out the form, test it, adjust it, and save only when it is ready.

## Environments

Environments help keep context visible. A connection or Library folder can be associated with an environment such as Local, Development, QA, Stage, or Production.

Environments can provide:

- a label and color
- a risk level
- variables used in connection strings or queries
- safe-mode behavior
- confirmation rules for risky actions

When folders in the Library have environments, child folders and files inherit the closest environment unless they override it. This makes it easier to keep related scripts and queries aligned with the right target.

## Exploring Datastores

The Library connection tree and Explorer tabs let you browse a datastore before querying it. The tree changes based on the datastore type.

For SQL databases, DataPad++ can show objects such as:

- databases
- schemas
- tables
- views
- columns
- indexes
- functions
- stored procedures where supported

For MongoDB, it can show:

- databases
- collections
- views
- GridFS buckets and files
- indexes
- validation rules
- schema previews based on bounded sampling
- users, roles, and database statistics

For Redis and Valkey, it can show:

- logical databases
- type folders
- key names
- TTL, memory, and encoding information
- ACL, scripts, functions, diagnostics, and module sections when supported

For search engines, it can show:

- indexes
- mappings
- aliases
- data streams
- field capabilities, shard health, lifecycle status, and search result structures

For time-series engines, it can keep native connection context such as Prometheus endpoints, InfluxDB orgs and buckets, OpenTSDB API prefixes, tenant headers, TLS posture, and default query ranges alongside the metric, bucket, tag, and field tree.

For wide-column stores such as Cassandra, it can show:

- keyspaces
- tables
- contact-point, secure-bundle, TLS, consistency, retry, and load-balancing connection options
- primary-key structure
- indexes
- materialized views
- partition, storage, tombstone, and cluster health signals

For DynamoDB, it can show:

- tables
- local endpoints, AWS profiles, assume-role/web-identity settings, retry and capacity preferences
- partition and sort keys
- global and local secondary indexes
- streams, TTL, backups, capacity, hot partitions, alarms, index coverage, and access metadata

Object menus provide relevant actions for the selected item. A table, collection, key, index, or folder should expose actions that make sense for that kind of object.

## Querying

DataPad++ supports both raw query editors and visual query builders.

Raw editors are useful when you already know the query language. Visual builders help when the datastore has a common query shape or when you want to build from existing result fields.

Current query experiences include:

- SQL editors for relational databases, with raw SQL as the default
- SQL SELECT builder for table-focused queries
- MongoDB query builder, raw command JSON, aggregation work, and safe scripting
- Redis and Valkey key browser plus Redis console
- Elasticsearch/OpenSearch query builder
- DynamoDB key-condition builder
- Cassandra partition-key builder

When a builder is available, the toolbar shows the modes that make sense for that datastore. MongoDB, for example, offers Query Builder, Raw, and Scripting. Redis offers Key Browser and Console. SQL tabs open as editors by default, and scoped table or view actions can open a SELECT builder when useful.

SQL-family Explorer tabs can also open a visual table and relationship workspace for understanding schemas, columns, and joins before writing SQL.

## MongoDB Experience

MongoDB gets a document-first workflow.

You can:

- browse databases and collections
- open a collection directly into a Mongo find builder
- choose a collection from a dropdown
- add filters with AND/OR grouping
- turn filters on and off without deleting them
- add projections and sort fields
- control result size through fetch size and Load More
- view documents as expandable rows
- turn on efficiency mode for large documents so nested content is fetched only when expanded
- drag document fields into filters, projections, or sort
- edit fields, values, and types where safe
- inspect field JSON in a side panel
- review Mongo explain plans in a purpose-built plan dashboard
- open purpose-built views for schema, indexes, validation, GridFS, users, roles, statistics, and document insert/upload workflows

Document editing is deliberate. You double-click to edit, and the app only enables edits when the adapter can identify the document safely.

## Redis And Valkey Experience

Redis and Valkey use a key-browser workflow by default instead of starting with a blank command console.

The Redis browser includes:

- key pattern filtering
- key type filtering
- tree and list views
- scan progress
- Scan more
- refresh
- typed badges
- TTL, memory, and length columns
- add key and delete key actions
- type-aware result views

Selecting a key opens its value in the Results panel. DataPad++ can inspect common Redis types such as strings, hashes, lists, sets, sorted sets, and streams. Redis Stack-style types such as JSON, TimeSeries, and probabilistic structures are detected when the server supports them, with unsupported actions shown as unavailable instead of failing mysteriously.

Raw Redis commands are still available from the query toolbar when you need the console.

## SQL Experience

SQL-family databases use familiar table and query workflows.

You can:

- browse schemas and tables
- open scoped queries from tables and views
- run raw SQL
- use a SELECT builder for simple table queries
- open a visual table and relationship explorer with schema filtering, focused graph layout, declared foreign keys, optional inferred links, and table inspectors
- inspect result tables with a grid-like interface
- copy selected cells or rows with keyboard shortcuts
- view schema and diagnostics where supported
- plan table, column, index, and admin operations behind guardrails

DataPad++ aims to respect each SQL dialect. PostgreSQL, SQL Server, MySQL, MariaDB, SQLite, and CockroachDB have different identifier rules, metadata surfaces, and diagnostics. The app should guide you instead of pretending they are all identical.

PostgreSQL workspaces include compact storage, index-health, security, and activity panels so common `pg_stat` and catalog signals are visible without digging through raw metadata. Guarded PostgreSQL maintenance previews cover `VACUUM`, `ANALYZE`, and `REINDEX`, alongside explain/profile, grants, export, and backup workflows.

SQL Server and Azure SQL workspaces include compact storage, index, workload, security, and Agent posture panels. Guarded previews cover `UPDATE STATISTICS`, index rebuild/reorganize/disable/enable workflows, and Query Store workload review.

CockroachDB workspaces include compact table, cluster, locality, job, contention, and security posture panels for distributed SQL signals. Guarded previews cover jobs, ranges, regions, sessions, contention, roles/grants, zone configuration, backup, restore, and import workflows.

CockroachDB live SQL execution is read-oriented. Native inspection commands such as `SHOW JOBS`, `SHOW RANGES`, and `SHOW CLUSTER SETTING` are allowed, while Cockroach-specific administrative work such as `BACKUP`, `RESTORE`, `IMPORT`, `EXPORT`, range movement, job control, and `EXPLAIN ANALYZE` use guarded preview flows.

MySQL and MariaDB expose Workbench-style storage, index, security, session, status, slow-query, InnoDB, and replication surfaces where metadata is available. Maintenance actions such as check, analyze, optimize, repair, and scheduled event enable/disable are shown as guarded previews rather than raw command dumps.

SQLite gets a local-file workbench treatment: file posture, attached databases, PRAGMA health, integrity checks, indexes, triggers, generated columns, and virtual tables are summarized in compact panels. Local maintenance actions such as check, analyze, optimize, vacuum, reindex, backup, and export are planned with guardrails so file-affecting work is explicit.

## Search Experience

For Elasticsearch and OpenSearch, DataPad++ focuses on search-oriented workflows.

You can:

- configure HTTP, Elastic Cloud, managed OpenSearch, AWS SigV4, API key, default-index, TLS, and timeout options without storing secrets in plaintext
- browse indexes, data streams, and mappings
- build search queries visually
- inspect search hits, source documents, highlights, and aggregations
- review cluster, field capability, shard-health, Lucene segment, lifecycle, ingestion, security, and profile views without reading raw API payloads
- preview force merge, cache clear, reindex, open/close, mapping, settings, alias, template, pipeline, rollover, lifecycle policy, task cancel, snapshot/restore, bulk, and security workflows behind guardrails
- switch to raw query DSL
- view profile, explain, shard, index, and cluster diagnostics where supported
- plan index and mapping operations behind safety prompts

## Graph Experience

Graph stores use graph-native tree and object views instead of generic tables.

Depending on the engine, DataPad++ can help you:

- configure endpoint, database or graph name, traversal source, auth mode, AWS/SigV4, TLS, timeout, fetch-size, and default query-language options without storing secrets in plaintext
- browse graphs, node labels, relationship types, properties, indexes, constraints, procedures, security, and diagnostics
- open scoped Cypher, AQL, or Gremlin queries from graph objects
- prepare guarded profile requests before running expensive traversals
- review metrics, permissions, CloudWatch/IAM-style access, schema indexes, and constraints
- preview index, constraint, and graph export workflows through environment guardrails

Neo4j, ArangoDB, JanusGraph, and Amazon Neptune each keep their own request shapes and labels so the UI feels native to the graph engine.

## Warehouse Experience

Cloud and analytical warehouses use SQL-first workflows with cost and job awareness.

DataPad++ can show:

- configure Snowflake, BigQuery, ClickHouse, and DuckDB endpoint, account/project, database/dataset/schema, compute, auth, TLS, timeout, row, cost, and local-file options without storing secrets in plaintext
- databases, datasets, schemas, tables, views, stages, compute warehouses, jobs, reservations, security, and diagnostics
- scoped Snowflake SQL, GoogleSQL, or ClickHouse SQL queries
- dry-run or plan previews before broad warehouse queries
- compact cost, compute, storage, access, query-history, warehouse-load, reservation, slot-usage, and job-timeline posture panels
- cost/profile, query history, utilization, job, access, table clone/copy/optimize, warehouse suspend/resume, and import/export operation previews
- guarded suspend/resume/drop plans for warehouse objects where supported

Snowflake, BigQuery, and ClickHouse previews use their native concepts such as query history, credit usage, warehouse load, streams, shares, zero-copy clones, dry-run estimates, job timelines, reservations, slot usage, scheduled queries, copy jobs, system query logs, MergeTree parts, replicas, table optimization, TTL materialization, freeze snapshots, stages, and warehouse utilization.

## Time-Series SQL Experience

TimescaleDB builds on the PostgreSQL workflow with time-series native surfaces:

- hypertables, chunks, compression, retention, continuous aggregates, and jobs in the tree
- compact hypertable, policy, aggregate, and diagnostic posture panels
- scoped data queries for hypertables and continuous aggregates
- guarded compression-policy, retention-policy, and continuous-aggregate refresh previews
- PostgreSQL-style roles, grants, indexes, explain/profile, and export workflows where they apply

Prometheus, InfluxDB, and OpenTSDB keep their own non-SQL time-series workflows, with typed endpoint/auth/bucket/metric connection options, metric/label/bucket/tag trees, chart-ready results, cardinality and retention surfaces, and guarded metadata-operation previews.

## Document, Local, And Cache Engines

Document-like cloud and local engines keep their own management surfaces.

DataPad++ can help you:

- review Cosmos DB containers, partition keys, indexing policy, RU throughput, regions, consistency, access, and diagnostics
- preview Cosmos DB query metrics, throughput changes, consistency changes, indexing policy updates, region failover, access checks, exports, and guarded drops
- inspect LiteDB local files, collections, schema previews, indexes, file storage, storage health, and settings
- preview LiteDB local health checks, checkpoint/compact, index changes, exports, backups, and collection drops
- review Memcached stats, slabs, item classes, settings, connection pressure, and cache diagnostics
- preview Memcached stats collection, stats reset, guarded flush, and LRU crawler metadata dumps without exposing fake key lists

## Results

The Results panel is one of the main parts of the app. It is designed for repeated database work, not just showing a blob of JSON.

The export action opens an interactive dialog instead of silently preparing a hidden download. DataPad++ offers formats that fit the current payload, such as CSV for tables, JSON/NDJSON for documents, TXT for raw values, and JSON for graph or key-value payloads.

### Table Results

Table results support:

- full-width grids
- sticky column headers
- row numbers
- row and cell selection
- keyboard copy shortcuts
- column resizing
- large-result virtualization
- compact display for null and empty values

Selecting the row-number column selects the full row.

### Document Results

Document results combine a table and a tree:

- root rows are named by document id
- children expand and collapse
- type values use color
- fields can be dragged into query builders
- editing starts only on double-click or explicit context-menu actions
- document-family results can page through large responses
- efficiency mode can fetch only top-level document fields and hydrate nested nodes on expand when no explicit projection is present

### Key-Value Results

Key-value results show the selected key or item with useful metadata. For Redis and Valkey, this includes type, TTL, memory, encoding, length, and a bounded value sample.

### JSON, Raw, Details, And History

You can switch between rich renderers and raw payloads when needed. Messages, details, and query history live in the bottom panel so they are close to the result that produced them.

## Library

The Library replaces a simple saved-query list with a richer workspace for reusable work.

You can save:

- connections
- queries
- scripts
- tests
- snippets
- notes
- bookmarks
- snapshots

The Library supports folders, nested folders, drag-and-drop moves, rename/delete actions, recents, environments, and environment inheritance. Saving a query can target either the Library or a local file, and new saved queries default beside the active connection when possible.

## Settings, Workspace Bundles, And Backups

Settings open as a closeable workbench tab, not a drawer. The left menu groups Appearance, Workspace, Backups, Security, Shortcuts, and Health so each page stays focused.

Workspace export and import are file-first:

- export writes an encrypted `.datapadpp-workspace` file through the system save dialog
- import reads a selected workspace file through the system file picker and requires the passphrase
- optional password/secret inclusion is explicit and remains inside the encrypted bundle
- new bundles include encrypted SHA-256 integrity metadata and are verified before import
- auto-backups are opt-in, encrypted, passphrase-protected, and rotate to keep a maximum of 20 snapshots

See [Settings, Workspace Bundles, And Backups](settings-and-workspace.md) for the full workflow.

## Safe Editing

DataPad++ supports live edits only where the target is clear and the datastore can be updated safely.

Examples:

- SQL row edits need table and primary-key context
- MongoDB document edits need collection and document id context
- Redis key edits need a concrete key
- DynamoDB item edits need complete key conditions
- Cassandra row edits need complete primary-key conditions

When DataPad++ cannot prove the target is safe, the action is disabled or shown as a preview plan instead of being executed silently.

## Operations And Diagnostics

Some work is not a simple query or edit. DataPad++ can expose operation previews and diagnostics where adapters support them.

Examples include:

- execution plans
- query profiles
- slow-query or query-history panels
- permission inspection
- session and lock information
- index and storage stats
- Redis INFO, SLOWLOG, ACL, and memory information
- search-engine profile and shard details
- DynamoDB capacity, TTL, stream, backup, IAM-style access, GSI, and export/import previews
- Cassandra tracing, SAI/index, grants, and diagnostics previews
- Prometheus, InfluxDB, and OpenTSDB profile, metrics/stats, access, posture panels, cardinality, retention, UID repair, export, and guarded metadata-operation previews
- DuckDB local file posture, extension posture, PRAGMA/maintenance panels, table/database analyze, checkpoint, extension load/install, and CSV/Parquet import/export previews
- cloud dry-run or cost estimates where available

Destructive or administrative actions should be previewed first, with the generated SQL, command, or API request visible before execution is allowed.

## Datastore Coverage

DataPad++ is growing in layers. The complete current readiness matrix lives in the [Datastore Readiness And Completion Plan](architecture/datastore-readiness.md).

### Strongest Current Areas

These engines have the deepest native-feeling surfaces today:

- MongoDB
- Redis and Valkey
- SQL Server and Azure SQL
- PostgreSQL
- SQLite
- CockroachDB
- MySQL and MariaDB

### Next Completion Focus

The next hardening focus is:

- finish MongoDB and Redis/Valkey as reference native datastores
- deepen core SQL object views, diagnostics, safe row edits, and import/export
- productionize Elasticsearch/OpenSearch, DynamoDB, and Cassandra
- deepen local, cloud, analytics, graph, and time-series engines with native object views, operation previews, and live adapter depth

### Broader Adapter Set

The broader adapter set includes:

- Elasticsearch and OpenSearch
- DynamoDB
- Cassandra
- Oracle
- TimescaleDB
- Cosmos DB
- LiteDB
- Memcached
- Neo4j
- Amazon Neptune
- ArangoDB
- JanusGraph
- InfluxDB
- Prometheus
- OpenTSDB
- ClickHouse
- DuckDB
- Snowflake
- BigQuery

Some adapters are available as beta, preview, local fixture, cloud-contract, or read-oriented experiences while live production workflows are hardened.

## Sample Data And Fixtures

For contributors and testers, the repository includes repeatable Docker fixtures with seeded sample data.

The default fixture set includes PostgreSQL, MySQL, SQL Server, MongoDB, Redis, and SQLite. Optional profiles add Redis Stack, search engines, cache stores, analytics stores, graph stores, Cassandra, Oracle, and cloud-contract mocks.

See [Docker Fixtures](../tests/fixtures/README.md) for setup commands and connection details.

## Releases

Desktop releases are produced through GitHub Actions and attached to GitHub Releases as draft-reviewed artifacts.

Look for platform assets such as:

- Windows: NSIS installer, MSI installer, or zipped executable
- Linux: `.deb`, `.rpm`, AppImage, or tarred executable
- macOS Apple Silicon: DMG or app bundle artifact

GitHub also displays automatic source-code zip/tar archives. Those are normal GitHub files, but they are not the desktop app installers.
