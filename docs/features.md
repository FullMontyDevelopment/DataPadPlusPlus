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
6. Search saved work, export useful results, or capture repeatable checks as test suites.
7. Enable local API or MCP plugins only when an integration needs the desktop app to expose scoped data context.

The app is intentionally local-first. Your workspace, saved work, and connection profiles live on your machine, and secrets are handled through desktop-safe storage where available.

## Experimental MCP Server Plugin

DataPad++ can expose a desktop-only Model Context Protocol server for local MCP clients. The plugin is disabled by default and does not auto-start unless you explicitly enable it from Settings -> Plugins.

The MCP listener is intentionally narrow:

- it binds only to `127.0.0.1`, default port `17641`
- it serves only Streamable HTTP at `/mcp`
- every request requires `Authorization: Bearer <auth token>`
- present `Origin` headers are rejected unless allowlisted
- datastores and workspace contexts are hidden until allowlisted
- v1 exposes plugin metadata, read, explore, list, context switch, and diagnostic scopes only
- write, destructive, admin, and costly operations are blocked

The `plugin:read` scope enables the read-only `datapad_list_plugins` tool. It reports the current DataPad++ plugin catalog, including Workspace Search, API Server, MCP Server, Workspaces, and Datastore Security Checks. The catalog also lists the MCP tools and scopes required to use each plugin surface.

Plugin use is intentionally scoped:

- `workspace:search` can call `datapad_search_workspace` for Workspace Search metadata. It does not return result payloads or secret-bearing structured keys.
- `security:read` can call `datapad_get_security_checks_summary` and `datapad_list_security_checks` for cached Security Checks targets, CVEs, and posture results. It cannot refresh scans or mute findings.
- `api-server:read` can call `datapad_get_api_server_summary` for API Server profile and endpoint counts. It cannot start or stop local listeners.
- `mcp-server:read` can call `datapad_get_mcp_server_summary` for MCP Server profile and token metadata counts. It never returns raw auth tokens or verifier values.
- `workspaces:read` can call `datapad_list_workspaces` when the Workspaces plugin is enabled. Switching whole workspace profiles remains unavailable through MCP v1.

Create or reset client auth tokens from the MCP Server tab. DataPad++ shows the raw auth token only once, at creation time. Workspace JSON and exports keep only secure verifier references; if an auth token is lost, rotate it. Client setup snippets use `DATAPAD_MCP_TOKEN` or a client-side secure prompt so raw auth tokens do not need to be saved in config files.

The MCP Server Setup tab includes copy/paste snippets and desktop-only automatic setup for user-level local coding clients. Automatic setup previews the exact config file and DataPad++ entry before writing, creates a backup before overwriting existing config, and never writes the raw auth token value.

Set the auth token once for local clients:

```powershell
[Environment]::SetEnvironmentVariable("DATAPAD_MCP_TOKEN", "<auth token shown once>", "User")
```

```sh
export DATAPAD_MCP_TOKEN='<auth token shown once>'
```

OpenAI Codex (`~/.codex/config.toml` or `.codex/config.toml`):

```toml
[mcp_servers.datapadplusplus]
url = "http://127.0.0.1:17641/mcp"
bearer_token_env_var = "DATAPAD_MCP_TOKEN"
startup_timeout_sec = 10
tool_timeout_sec = 30
```

VS Code / GitHub Copilot (`mcp.json` or `.vscode/mcp.json`):

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "datapad-mcp-token",
      "description": "DataPad++ MCP Auth Token",
      "password": true
    }
  ],
  "servers": {
    "datapadplusplus": {
      "type": "http",
      "url": "http://127.0.0.1:17641/mcp",
      "headers": {
        "Authorization": "Bearer ${input:datapad-mcp-token}"
      }
    }
  }
}
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "datapadplusplus": {
      "url": "http://127.0.0.1:17641/mcp",
      "headers": {
        "Authorization": "Bearer ${env:DATAPAD_MCP_TOKEN}"
      }
    }
  }
}
```

Claude Code (`~/.claude.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "datapadplusplus": {
      "type": "http",
      "url": "http://127.0.0.1:17641/mcp",
      "headers": {
        "Authorization": "Bearer ${DATAPAD_MCP_TOKEN}"
      }
    }
  }
}
```

Gemini CLI (`~/.gemini/settings.json` or `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "datapadplusplus": {
      "httpUrl": "http://127.0.0.1:17641/mcp",
      "headers": {
        "Authorization": "Bearer $DATAPAD_MCP_TOKEN"
      },
      "timeout": 30000,
      "trust": false
    }
  }
}
```

Cloud or browser-hosted LLM apps cannot normally reach a desktop `127.0.0.1` listener. Treat them as guidance-only until DataPad++ offers an explicit tunnel/public-endpoint mode.

## Experimental API Server Plugin

DataPad++ can run desktop-only local API servers for selected datastore resources and saved Library queries. The plugin is disabled by default and is intended for local integration experiments, generated project scaffolds, and tightly scoped internal tools.

An API Server profile can define:

- a local `127.0.0.1` port, name, description, protocol, and base path
- REST/OpenAPI, GraphQL, or gRPC posture
- the datastore connection and environment the server should use
- discovered CRUD resources such as tables, collections, indexes, items, or keys
- custom query endpoints sourced from saved Library queries
- endpoint parameters discovered from tokens such as `{{api.customerId}}`
- metrics and request logs for the running local server

Servers do not expose the whole workspace automatically. You add resources or saved-query endpoints deliberately, and every server still carries the selected connection and environment context. Exported API projects use environment-variable references for runtime secrets; DataPad++ secret values are not written into generated Rust or .NET projects.

## Workspace Search

Workspace Search is a plugin-backed indexed view over the current workspace snapshot. It helps recover work quickly without remembering which folder, tab, or connection owns it.

It can search:

- saved connections
- folders and Library items
- saved queries and scripts
- test suites
- open tabs
- recently closed tabs

The search workspace includes type filters, match-case and whole-word controls, recent searches, grouped results, and virtualized rows for large workspaces. Selecting a result opens the matching connection, Library item, tab, or recently closed tab directly.

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
- DynamoDB key-condition, projection/filter, and conditional-write helpers plus guarded read-only PartiQL `ExecuteStatement` requests in raw JSON mode
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
- use aggregation-aware IntelliSense for stages, expression operators, snippets, and `$field.path` references
- control result size through fetch size and Load More
- view documents as expandable rows
- turn on efficiency mode for large documents so nested content is fetched only when expanded
- drag document fields into filters, projections, or sort
- insert, replace, delete, and edit fields, values, and types where safe
- inspect field JSON in a side panel
- review Mongo explain plans in a purpose-built plan dashboard
- review profiler, current operation, replica, shard, and index-usage diagnostics as profile and metric payloads
- run guarded desktop JSON, Extended JSON, NDJSON, CSV, and BSON collection import/export file workflows with adapter-driven fixture evidence, with browser preview staying plan-only
- open purpose-built views for schema, indexes, validation, GridFS, users, roles, statistics, and document insert/upload workflows

Document editing is deliberate. You double-click to edit, and the desktop adapter only enables live insert, replace, delete, and field set/unset/rename/type-change edits when it can identify the collection/document safely and the active environment allows the change.

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
- command-argument IntelliSense for read command syntax, key arguments, subcommands, SCAN options, ranges, counts, JSON paths, Redis Stack module hints, INFO sections, and live `COMMAND INFO` metadata from recent console results

Selecting a key opens its value in the Results panel. DataPad++ can inspect common Redis types such as strings, hashes, lists, sets, sorted sets, and streams. Redis is native-complete for the scoped Redis and Redis Stack key workflow, with vector-set live fixture evidence kept as an optional `--require-vector` check for Redis Stack images that expose `VADD`. Redis Stack-style types such as JSON, TimeSeries, and probabilistic structures are detected when the server supports them, with unsupported actions shown as unavailable instead of failing mysteriously. Valkey is native-complete for the scoped core single-node workflow: profiles use Valkey-specific tree, preview, and disabled-action wording while keeping Redis Stack/vector-only surfaces hidden unless compatible live metadata proves support.

Raw Redis commands are still available from the query toolbar when you need the console. Core key/member edits, stream entry add/delete, RedisTimeSeries sample add/delete, RedisJSON path edits, and vector-set member/attribute edits are live-capable in the desktop adapter after read-only, identity, type, and confirmation checks pass; remaining probabilistic module edits stay disabled or preview-first until the matching command workflows are confirmed.

Redis key import/export also runs through guarded desktop JSON/NDJSON file workflows for strings, hashes, lists, sets, sorted sets, streams, whole-document RedisJSON values, RedisTimeSeries samples, vector-set elements, and Redis DUMP/RESTORE snapshot envelopes for Bloom, Cuckoo, CMS, TopK, and t-digest module values. The workflow requires a concrete file path and confirmation, preserves positive TTLs by default, supports create-only/replace/validate modes, and records before/after metadata. Valkey runs the same guarded workflow for core Redis-compatible strings, hashes, lists, sets, sorted sets, and streams while Redis Stack module file formats stay gated unless compatible live metadata proves support; browser preview remains plan-only.

Redis object views render stream overviews, recent entries, consumer groups, consumers, pending messages, Redis Stack module panels for JSON, TimeSeries, Bloom, RediSearch, and vector sets, Pub/Sub channels, pattern counts, subscriber plans, ACL users/categories/current user, cluster nodes/slots, Sentinel masters/replicas/peers, Lua script handoffs, function libraries, INFO sections, command stats, slowlog rows, latency samples, memory stats, clients, persistence, and replication payloads without dumping raw command arrays first. Valkey uses the same Redis-compatible panels with Valkey-specific labels and gated module actions.

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

PostgreSQL is native-complete for the scoped SQL workflow. Workspaces include typed connection/profile options for TCP, Unix socket, Cloud SQL proxy, application name, search path, target session attributes, TLS certificate paths, and connect/statement/lock/idle timeouts. They also include compact storage, index-health, security, extension, and activity panels so common `pg_stat` and catalog signals are visible without digging through raw metadata. PostgreSQL IntelliSense adds `pg_catalog` helpers, dialect functions/keywords, routine call and definition snippets from cached metadata, profile/session/lock/routine snippets, and safe quoting for mixed-case or reserved identifiers. Extension views show installed/default versions, update hints, and extension-owned objects; security views show roles, role memberships, normalized schema/table/routine/sequence grants, and default privileges. Desktop row edits include before/after row evidence where PostgreSQL can safely fetch the primary-key target and return changed rows. Desktop diagnostics expose live session/wait/blocking, lock posture, relation/vacuum/index-scan, and optional `pg_stat_statements` top-query profile payloads where permissions allow them. Guarded PostgreSQL previews cover parameterized function/procedure calls, backend cancel/terminate actions through PID-aware `pg_cancel_backend` and `pg_terminate_backend` plans, `VACUUM`, `ANALYZE`, and `REINDEX`, alongside role grant/revoke, extension update/drop, rendered explain plans, rendered `EXPLAIN ANALYZE BUFFERS` JSON profile dashboards, grants, and desktop CSV/JSON/NDJSON table import/export plus bounded JSON/SQL logical backup workflows. Optional fixture validation checks seeded volume, catalogs, diagnostics, routines, profile primitives, row evidence, permission denial, import/export primitives, and bounded backup evidence. Full `pg_dump`/`pg_restore` execution remains outside this scoped claim unless promoted later.

SQL Server and Azure SQL are native-complete for the scoped SQL Server/Azure SQL workflow. Workspaces include typed connection options for SQL Server login, Windows Integrated, Microsoft Entra, managed identity, service principal, and certificate modes, with per-mode plan-only disabled reasons when the current TDS runtime cannot execute that auth path yet. They also include compact storage, index, workload, Extended Events, security, and Agent posture panels. SHOWPLAN_TEXT explain results and XML Showplan profile results render through the shared plan viewer, with XML Showplan extracting statement estimates and relational operators into an operator table. Runtime performance inspections surface cached query stats, active requests, waits, file I/O stalls, memory grants, active transactions, and missing-index impact from SQL Server DMVs. Query Store inspections surface status/options, top-query runtime rows, forced-plan rows, and recent-vs-prior regression hints in the workload panel. Extended Events inspections surface database-scoped and server-scoped sessions, event definitions, targets, running/stopped state, startup/retention/memory/causality settings, target data availability, and permission/empty-state warnings. SQL Server Agent inspections surface `msdb` jobs, schedules, alerts, operators, proxies, optional service status, last/next run signals, owners/categories, notification channels, proxy credential names, and Azure/restricted-login warnings. Security and storage inspections surface users, roles, role memberships, schemas, database permissions, certificates, symmetric/asymmetric keys, database-scoped credentials, audit specifications, files, filegroups, partition schemes/functions/boundaries, and allocation-unit totals. Guarded previews cover `UPDATE STATISTICS`, index rebuild/reorganize/disable/enable workflows, and Query Store workload review, while guarded desktop file workflows cover CSV/JSON/NDJSON table import/export, bounded JSON/SQL logical backup packages, and restore-package validation. Native `.bak` backup/restore, bcp/sqlcmd bulk workflows, identity insert, and broader live maintenance/admin execution remain optional extensions outside the scoped claim.

CockroachDB is native-complete for the scoped distributed SQL workflow. Workspaces include typed CockroachDB profile metadata for deployment mode, Cockroach Cloud organization/cluster identity, region/locality, version/build, auth/TLS disabled reasons, and explicit capability toggles for restricted jobs, ranges, regions, cluster status/settings, sessions, contention, roles/grants, certificates, zone configurations, and `EXPLAIN ANALYZE`. Those toggles hide unavailable CockroachDB tree nodes, direct inspections report restricted warnings, and operation/action menus follow the same profile gates. Workspaces also include Cockroach-owned database/schema/cluster/security/diagnostics trees, compact table, cluster, locality, job, contention, and security posture panels, and focused browser/Rust payloads for jobs, ranges, regions/localities, sessions, statement stats, transactions, locks, contention, statistics, certificates, and zone configurations. CockroachDB IntelliSense adds `SHOW` helpers, `crdb_internal` diagnostic objects, distributed explain/profile snippets, contention dashboards, regions/localities snippets, and zone-configuration review snippets. Guarded previews cover jobs, ranges, regions, sessions, contention, roles/grants, default privileges, zone configuration, import, export, backup, and restore workflows with external-storage, permission, confirmation, read-only/environment, and scan/cost guardrails.

CockroachDB live SQL execution is read-oriented. Native inspection commands such as `SHOW JOBS`, `SHOW RANGES`, and `SHOW CLUSTER SETTING` are allowed, while Cockroach-specific administrative work such as `BACKUP`, `RESTORE`, `IMPORT`, `EXPORT`, range movement, job control, and `EXPLAIN ANALYZE` use guarded preview flows.

MySQL is native-complete for the scoped MySQL workflow. It exposes typed native connection/profile options for TCP, Unix socket, Cloud SQL socket, managed metadata, auth-mode metadata, SSL modes, certificate paths, charset, collation, time zone, statement cache capacity, and connect/command timeouts. Cleartext plugin and IAM token auth stay plan-only until live runtime support is validated. MySQL also exposes a dialect-aware SELECT builder, MySQL-specific IntelliSense keywords/functions, information_schema and performance_schema catalog helpers, routine call/definition snippets, EXPLAIN FORMAT=JSON helpers, optimizer trace snippets, processlist/wait snippets, statement digest snippets, and backtick-aware alias completions. It also exposes Workbench-style storage, index, security, session, status, slow-query, performance_schema, metadata-lock, optimizer-trace, InnoDB, and replication surfaces where metadata is available, with detailed object-view sections for statement digests, table/index I/O waits, metadata locks, optimizer trace settings, and status counters. Desktop diagnostics collect live status counters, processlist waits, statement digests, table/index I/O waits, metadata locks, InnoDB counters, and optimizer trace availability, with matching browser-preview and object-view posture cards. MariaDB is native-complete for the scoped MariaDB workflow: it shares the MySQL-compatible live SQL/edit base and adds typed MariaDB connection/profile metadata, MariaDB-aware Workbench-style trees, explicit EXPLAIN FORMAT=JSON and guarded ANALYZE FORMAT=JSON previews, MariaDB-specific status/version/storage-engine and role IntelliSense helpers, native MariaDB object-view descriptors and posture cards for role mappings, server variables, storage engines, and ANALYZE FORMAT=JSON profile metadata, Aria metrics, role-mapping security previews, guarded CSV/JSON/NDJSON table import/export, bounded logical backup packages, and restore-package validation. Maintenance actions such as check, analyze, optimize, repair, parameter-aware routine calls, scheduled event enable/disable, security inspection, and user account lock/unlock are shown as structured guarded previews with privilege, confirmation, read-only, scheduler/definer/account, and disabled-reason guardrails rather than raw command dumps.

SQLite gets a local-file workbench treatment: file posture, attached databases, PRAGMA health, integrity checks, indexes, triggers, generated columns, and virtual tables are summarized in compact panels. Local maintenance actions such as check, analyze, optimize, vacuum, and reindex are planned with guardrails, while guarded desktop live workflows cover `VACUUM INTO` backup plus CSV/JSON/NDJSON table or view export and table import. Browser preview remains plan-only for those file workflows.

SQL row editing is live only when the target identity is complete and the connection/environment guardrails allow it. PostgreSQL-family, SQL Server, MySQL/MariaDB, SQLite, and TimescaleDB use primary-key predicates for live row edits, with desktop live-edit scopes and browser preview-only scopes covered by contract tests. Oracle uses configured SQLPlus live execution for scoped insert/update/delete row workflows with primary-key or ROWID identity, bounded before/after evidence, read-only gates, confirmation gates, and browser preview-only request contracts.

## Search Experience

For Elasticsearch and OpenSearch, DataPad++ focuses on search-oriented workflows.

You can:

- configure HTTP, Elastic Cloud, managed OpenSearch, AWS SigV4, API key, default-index, TLS, and timeout options without storing secrets in plaintext, with explicit plan-only reasons when the current live runtime cannot execute a profile yet
- browse indexes, data streams, and mappings
- build search queries visually with filters, source fields, sorting, and terms/date-histogram/histogram/metric/cardinality aggregations
- use deterministic DSL IntelliSense for query keys, index names, mapped fields, and aggregation snippets
- inspect search hits, source documents, highlights, and aggregations
- review cluster, field capability, shard-health, Lucene segment, lifecycle, ingestion, security, slow-log, allocation, and normalized profile-stage views without reading raw API payloads
- edit explicitly identified search documents behind read-only, document-id, and confirmation guards, with before/after `_doc` evidence captured by the desktop adapter
- preview force merge, cache clear, reindex, open/close, mapping, settings, alias, template, pipeline, rollover, lifecycle policy, task cancel, snapshot/restore, bulk, security, slow-log, and allocation workflows behind guardrails
- switch to raw query DSL
- view profile, explain, shard, index, and cluster diagnostics where supported
- plan index and mapping operations behind safety prompts

## Graph Experience

Graph stores use graph-native tree and object views instead of generic tables.

Depending on the engine, DataPad++ can help you:

- configure endpoint, database or graph name, traversal source, auth mode, AWS/SigV4, TLS, timeout, fetch-size, and default query-language options without storing secrets in plaintext
- browse graphs, node labels, relationship types, properties, indexes, constraints, procedures, security, and diagnostics
- open scoped Cypher, AQL, or Gremlin queries from graph objects
- use graph-query descriptors for Cypher, AQL, Gremlin, openCypher, and SPARQL-style query composition while writes stay preview-first
- use deterministic graph IntelliSense for query-language keywords, graph names, labels, relationship types, properties, and bounded traversal snippets
- prepare guarded profile requests before running expensive traversals
- review metrics, permissions, CloudWatch/IAM-style access, schema indexes, and constraints
- preview explain/profile, index, constraint/drop, access, metrics, and graph import/export workflows through environment guardrails

Neo4j, ArangoDB, JanusGraph, and Amazon Neptune each keep their own request shapes and labels so the UI feels native to the graph engine, while live driver/cloud execution remains explicitly guarded.

## Warehouse Experience

Cloud and analytical warehouses use SQL-first workflows with cost and job awareness.

DataPad++ can show:

- configure Snowflake, BigQuery, ClickHouse, and DuckDB endpoint, account/project, database/dataset/schema, compute, auth, TLS, timeout, row, cost, and local-file options without storing secrets in plaintext
- databases, datasets, schemas, tables, views, stages, compute warehouses, jobs, reservations, security, and diagnostics
- scoped Snowflake SQL, GoogleSQL, or ClickHouse SQL queries
- SQL SELECT builders for DuckDB, ClickHouse, Snowflake, and BigQuery table-focused reads
- deterministic SQL IntelliSense for warehouse and embedded-OLAP schemas, objects, columns, aliases, functions, and bounded query starts
- dry-run or plan previews before broad warehouse queries
- compact cost, compute, storage, access, query-history, warehouse-load, reservation, slot-usage, and job-timeline posture panels
- cost/profile, query history, utilization, job, access, table clone/copy/optimize, warehouse suspend/resume, and import/export operation previews
- guarded suspend/resume/drop plans for warehouse objects where supported

Snowflake, BigQuery, and ClickHouse previews use their native concepts such as query history, credit usage, warehouse load, streams, shares, zero-copy clones, dry-run estimates, job timelines, reservations, slot usage, scheduled queries, copy jobs, system query logs, MergeTree parts, replicas, table optimization, TTL materialization, freeze snapshots, stages, and warehouse utilization.

DuckDB is native-complete for the scoped local-file analytics workflow. It supports typed local-file and memory profiles, local database creation, bundled local-file read SQL, rendered EXPLAIN and EXPLAIN ANALYZE payloads, deterministic DuckDB IntelliSense, native local-file/object/extension posture panels, guarded CSV table export/import, CSV backup-folder execution, database-file preflight/read-only and scoped lock-boundary evidence, fail-closed JSON/Parquet preloaded-extension-only gates, restore-package preflight, and explicit restore/admin/extension execution-boundary exclusions. Extension-loaded JSON/Parquet execution and broader local OLAP mutation, admin, restore, and extension execution remain optional extensions outside the scoped claim.

## Time-Series SQL Experience

TimescaleDB builds on the PostgreSQL workflow with time-series native surfaces:

- hypertables, chunks, compression, retention, continuous aggregates, and jobs in the tree
- typed Timescale deployment/profile metadata with capability-hiding for restricted catalog surfaces
- compact profile, hypertable, policy, aggregate, and diagnostic posture panels
- rendered time-bucket, chunk-sizing, compression-coverage, aggregate-freshness, job-history, Toolkit availability, bucket-window, and time-bucket query-history dashboards
- scoped data queries for hypertables and continuous aggregates
- guarded compression, retention, continuous aggregate refresh, job-control, import/export, backup, and restore previews with Timescale-native preflights
- guarded compression-policy, retention-policy, continuous-aggregate refresh, import/export, and backup/restore previews
- PostgreSQL-style roles, grants, indexes, rendered explain/profile, row-edit, and export workflows where they apply
- optional fixture validation for extension/catalog metadata, seeded hypertables/chunks, row-edit before/after evidence, restricted catalog visibility, permission-denied writes, and continuous aggregate plus policy/job boundary evidence

Prometheus, InfluxDB, and OpenTSDB keep their own non-SQL time-series workflows, with typed endpoint/auth/bucket/metric connection options, metric/label/bucket/tag trees, chart-ready results, pinned query-builder descriptors for PromQL, Flux/InfluxQL, and OpenTSDB metric queries, deterministic metric/dimension/function IntelliSense, profile/metrics payloads, cardinality and retention surfaces, UID repair, API export, and guarded metadata-operation previews.

## Document, Local, And Cache Engines

Document-like cloud and local engines keep their own management surfaces.

DataPad++ can help you:

- review Cosmos DB containers, partition keys, indexing policy, RU throughput, regions, consistency, access, and diagnostics
- use deterministic Cosmos SQL and JSON IntelliSense for databases, containers, fields, partition-key helpers, and bounded query snippets
- preview Cosmos DB query metrics, throughput changes, consistency changes, indexing policy updates, region failover, access checks, exports, and guarded drops
- inspect LiteDB local files, collections, schema previews, indexes, file storage, storage health, local-file preflight, encryption posture, lock-boundary posture, and settings
- use deterministic LiteDB JSON IntelliSense for collections, inferred fields, operation keys, and bounded find snippets
- preview LiteDB local health checks, checkpoint/compact, exports, backups, configured sidecar read-dispatch boundaries with local process evidence, sidecar-only full-document CRUD plans, sidecar-backed JSON collection import/export execution, sidecar-backed file-storage import/export/delete execution, and live sidecar-backed index create/drop plus collection drop management
- review Memcached stats, slabs, item classes, settings, connection pressure, and cache diagnostics
- use deterministic Memcached command IntelliSense for stats, known-key operations, slab/item-class targets, CAS reads, and guarded write-preview snippets
- preview Memcached stats collection, stats reset, guarded flush, LRU crawler metadata dumps, and known-key get/gets/set/touch/incr/decr/delete plans without exposing fake key lists

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

## Test Suites

Test suites make repeatable datastore checks part of the workspace instead of an external afterthought.

A suite can include:

- setup, execute, and teardown phases
- SQL, MongoDB, Redis/search-style, or raw request steps depending on the connection
- assertions for row count, document count, key existence, key type, search-hit count, JSON path, no-error, and duration-under checks
- visual editing for common cases plus raw JSON for the full definition
- connection, environment, and variable context inherited from the Library item

Suites are useful for validating fixture data, proving a saved query still returns the expected shape, and documenting operational checks beside the connection they rely on. Test execution follows the same read-only and environment guardrail posture as other workbench actions.

## Settings, Workspace Bundles, And Backups

Settings open as a closeable workbench tab, not a drawer. The left menu groups Appearance, Workspace, Backups, Security, Plugins, Shortcuts, and Health so each page stays focused.

The Plugins section is where Workspace Search and experimental plugins such as API Server, MCP Server, Workspaces, and Datastore Security Checks are enabled. These surfaces are opt-in because they can expose broader workspace or datastore context than ordinary query tabs. Datastore Security Checks detect product versions, query NVD and CISA KEV, show NVD affected-version ranges when present, compare detected versions with a bundled known-version catalog, and run advisory posture checks for TLS, auth, environment guardrails, secrets, privileges, durability, and risky settings. Posture checks use saved profiles plus supported read-only probes; they do not add cloud-provider API calls. Browser preview can save some settings, but usable local listeners, posture probes, and automatic client setup require the desktop app.

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
- MongoDB document edits need collection context and, except for inserts, stable document id context
- Redis and Valkey key edits need a concrete key
- DynamoDB item edits need complete key conditions and use conditional-write guards
- Elasticsearch and OpenSearch document edits need an explicit index and document id
- Cassandra row edits need complete primary-key conditions and remain preview-only until the live CQL driver path is available

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
- DynamoDB capacity, TTL, stream, backup/restore, IAM-style access, GSI, item edit, and export/import previews
- Cassandra tracing, SAI/index, grants, diagnostics, cqlsh COPY import/export, and nodetool snapshot/restore previews
- Prometheus, InfluxDB, and OpenTSDB profile, metrics/stats, access, posture panels, cardinality, retention, UID repair, export, and guarded metadata-operation previews
- Neo4j, ArangoDB, JanusGraph, and Neptune explain/profile, graph metrics, access/IAM, index, constraint/drop, and graph import/export previews
- Cosmos DB throughput, consistency, failover, RU metrics, indexing, access, export, and drop previews
- LiteDB local file health, read/write open preflight, encryption and lock-boundary metadata, configured sidecar read-dispatch contracts with local sidecar-process evidence, sidecar-only document CRUD plans, optional .NET engine read/edit/encrypted-file validation, sidecar-backed JSON collection import/export execution, sidecar-backed file-storage import/export/delete execution, live sidecar-backed index create/drop and collection drop management, checkpoint, compact, index rebuild, import/export, and backup previews
- Memcached stats reset, flush, CAS reads, set/touch/increment/decrement/delete, and LRU dump previews
- DuckDB local file posture, extension posture, PRAGMA/maintenance panels, structured analyze/checkpoint/object admin-scope gates with explicit admin execution-boundary metadata, structured extension load/install gates with explicit extension execution-boundary metadata, guarded CSV table import/export and backup-folder execution, database-file preflight/read-only guard evidence, explicit scoped file-workflow lock-boundary metadata, fail-closed JSON/Parquet preloaded-extension-only gates, restore-package preflight, explicit restore execution-boundary metadata, and JSON/Parquet extension-backed previews
- ClickHouse optimize, TTL materialization, freeze snapshot, query-log, metrics, access, and import/export previews
- Snowflake and BigQuery cost, metrics, access, clone/copy, suspend/resume where applicable, and cloud import/export previews
- cloud dry-run or cost estimates where available

Destructive or administrative actions should be previewed first, with the generated SQL, command, or API request visible before execution is allowed.

## Datastore Coverage

DataPad++ is growing in layers. All 29 declared engines are now accepted for the contract-complete native UX gate, MongoDB, PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, Redis, SQLite, TimescaleDB, Valkey, Oracle, DynamoDB, Elasticsearch, OpenSearch, and DuckDB are native-complete for scoped claims, the complete current readiness matrix lives in the [Datastore Readiness And Completion Plan](architecture/datastore-readiness.md), and the one-by-one native-completion queue is tracked in the [Native Datastore Completion Tracker](architecture/native-completion-tracker.md).

### Current Contract Claim

Every declared engine now has explicit contract evidence, per-criterion contract coverage, and a residual-risk note in the shared completeness matrix. MongoDB, PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, Redis, SQLite, TimescaleDB, Valkey, Oracle, DynamoDB, Elasticsearch, OpenSearch, and DuckDB additionally have scoped native-complete claims. This is not a claim that every cloud service, driver, credential mode, or destructive/admin path has live production validation.

### Strongest Live/Native Areas

These engines have the deepest live or native-feeling surfaces today:

- MongoDB
- Redis and Valkey
- SQL Server and Azure SQL
- PostgreSQL
- SQLite
- CockroachDB
- MySQL and MariaDB
- Oracle SQLPlus-backed SQL workflows
- Elasticsearch and OpenSearch scoped plain-HTTP search workflows with aggregation-aware Query DSL, normalized profile stages, explicit-id document editing with before/after `_doc` evidence, slow-log/allocation diagnostics, and OpenSearch SQL/ISM/security/Performance Analyzer boundary evidence
- DynamoDB complete-key item editing with before/after item evidence and conditional writes
- Search, wide-column, Wave 4, and Wave 5 native connection-flow parity across shared types, right-drawer fields, browser validation, Rust interpolation, and redaction
- Search, wide-column, Wave 4, and Wave 5 native object-tree parity across shared, Rust, and browser-preview manifests
- Search, wide-column, Wave 4, and Wave 5 object-view parity across descriptor-backed workflows, focused descriptor tests, posture panels, workspace routing, and guarded action strips
- Search, wide-column, Wave 4, and Wave 5 guarded-operation parity across object-view actions, browser manifests/planners, Rust manifests/planners, disabled reasons, confirmations, and plan-only execution wording
- Search, wide-column, Wave 4, and Wave 5 diagnostics/performance parity across diagnostics trees, object-view posture panels, browser diagnostics/profile payloads, Rust metrics/profile planning, and preview-only residual-risk wording
- Search, wide-column, Wave 4, and Wave 5 import/export parity across object-view actions, browser manifests/planners, Rust manifests/planners, backup/restore or bounded export plans, and plan-only file/cloud execution wording
- DuckDB, ClickHouse, Snowflake, and BigQuery SQL SELECT builder coverage
- Prometheus, InfluxDB, OpenTSDB, Neo4j, ArangoDB, JanusGraph, and Neptune query-builder descriptor coverage
- Search, wide-column, Wave 4, and Wave 5 deterministic IntelliSense coverage
- Wave 4 local/document/cache/analytics and Wave 5 time-series/graph slices at the contract-complete gate

### Next Completion Focus

The next hardening focus is:

- continue LiteDB native-completion work after the local-file preflight, local sidecar-process protocol checkpoint, optional real .NET engine read/edit validation, guarded document CRUD checkpoint, encrypted-file success/failure validation, JSON collection import/export execution, file-storage import/export/delete execution, and index/collection management execution, with packaged distribution and exclusive writer-lock validation still outside the claim
- keep the active engine, remaining native criteria, and completion gate current in the [Native Datastore Completion Tracker](architecture/native-completion-tracker.md)
- deepen core SQL distributed diagnostics, guarded operations, before/after row-edit previews, and import/export execution
- add optional live validation for Elasticsearch/OpenSearch cloud auth/admin flows, DynamoDB cloud/IAM flows, Cassandra live CQL, Cosmos DB, LiteDB, Memcached, DuckDB, ClickHouse, Snowflake, BigQuery, Prometheus, InfluxDB, OpenTSDB, Neo4j, ArangoDB, JanusGraph, and Neptune where credentials or fixtures are available
- promote selected DuckDB extension-loaded JSON/Parquet, restore, extension/admin, ClickHouse, Snowflake, and BigQuery import/export or admin previews only after cost, permission, local-file, extension, and cloud-storage checks are live
- promote selected contract-only operation previews to guarded live execution only after adapter-backed permission, cost, and environment checks exist

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

The default fixture set includes PostgreSQL, MySQL, SQL Server, MongoDB, Redis, and SQLite. Optional profiles add Redis Stack, search engines, cache stores, analytics stores, graph stores, Cassandra, Oracle, and cloud-contract mocks. PostgreSQL reference-engine fixture evidence can be checked with `npm run fixtures:validate:postgres` after starting and seeding the default fixtures. MongoDB reference-engine fixture evidence can be checked with `npm run fixtures:validate:mongodb` after starting and seeding the default fixtures. Redis/Valkey reference-engine fixture evidence, including Valkey core key-file command primitives, permission-denied guarded writes, and large key-file primitives, can be checked with `npm run fixtures:validate:redis -- --require-stack --require-valkey` after starting and seeding the Redis Stack and cache profiles; add `--require-vector` only when the selected Redis Stack image exposes `VADD`. TimescaleDB optional fixture evidence, including compressed chunk, aggregate lag, Toolkit variant, bounded file-copy, and failed-job diagnostic checks, can be checked with `npm run fixtures:validate:timescale` after starting and seeding the `sqlplus` profile. Oracle optional fixture evidence, including DBMS_XPLAN, SQL Monitor boundary, PL/SQL compile diagnostics, row identity, bounded SQLPlus export/import, restricted dictionary, and Data Pump/RMAN preview-boundary checks, can be checked with `npm run fixtures:validate:oracle` after starting and seeding the `oracle` profile. DynamoDB Local optional fixture evidence, including seeded volume, consumed-capacity reads, Query/GetItem/PartiQL, conditional item-edit before/after evidence, transient key/GSI/TTL metadata, and backup/import-export boundary checks, can be checked with `npm run fixtures:validate:dynamodb` after starting and seeding the `cloud-contract` profile. Search optional fixture evidence, including seeded Elasticsearch/OpenSearch volume, aggregation/profile payloads, document edit evidence, slow-log/allocation diagnostics, bounded `_search`/`_bulk` primitives, and OpenSearch SQL/ISM/security/Performance Analyzer boundaries, can be checked with `npm run fixtures:validate:search` after starting and seeding the `search` profile. DuckDB optional fixture evidence, including bundled local-file read/EXPLAIN/profile execution, catalog inspection, diagnostics templates, guarded CSV export/import, backup-folder execution, database-file preflight/read-only guard evidence, explicit lock-boundary evidence, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight, explicit restore/admin/extension execution-boundary evidence, and write-SQL guard boundaries, can be checked with `npm run fixtures:validate:duckdb` without Docker. LiteDB optional fixture evidence, including local-file read/write open preflight, encryption and lock-boundary metadata, fixture-token and local sidecar-process read dispatch, bounded response normalization, process open-failure mapping, timeout, and redaction evidence, can be checked with `npm run fixtures:validate:litedb` without Docker or a real .NET LiteDB engine sidecar; optional real LiteDB engine sidecar validation, including guarded full-document insert/update/delete, before/after reads, read-only mutation blocking, `_id` mismatch blocking, encrypted-file correct-password open/read evidence, wrong-password failure evidence without secret/path leakage, JSON collection import/export execution evidence, file-storage import/export/delete evidence, guarded index create/drop, `_id` index drop blocking, guarded collection drop, and post-drop collection listing, can be run with `DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet` after the .NET sidecar has been restored and built. Live AWS DynamoDB validation can be checked with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE=1 npm run fixtures:validate:dynamodb:cloud` after configuring environment, shared-profile, STS AssumeRole, web identity, ECS task, or EC2 metadata AWS credentials.

See [Docker Fixtures](../tests/fixtures/README.md) for setup commands and connection details.

## Releases

Desktop releases are produced through GitHub Actions and attached to GitHub Releases as draft-reviewed artifacts.

Look for platform assets such as:

- Windows: NSIS installer, MSI installer, or zipped executable
- Linux: `.deb`, `.rpm`, AppImage, or tarred executable
- macOS Apple Silicon: DMG or app bundle artifact

GitHub also displays automatic source-code zip/tar archives. Those are normal GitHub files, but they are not the desktop app installers.
