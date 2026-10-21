# Result Exports And Query Limits

> DataPad++ is pre-release. Verify exported files before relying on them. Result exports are not datastore backups.

## Choose the source

Open **Export** in the selected query's Results toolbar.

- **Loaded results** is the default. For table/document results, desktop export uses the original values captured for every loaded page, including pages added with **Load More**. It does not export just the visible rows. Efficiency-mode previews are not the export source.
- **Full query results** runs the original supported read query again and writes records incrementally. The connection, environment, scope, selection, filters, parameters, sorting, projection, and authored limits come from the original execution, not the current editor draft. Data can have changed since the first run.

Desktop table/document exports support their existing CSV, JSON, and NDJSON choices. Full-query export offers these formats independently of the selected result renderer, including key-value, graph, and raw views. Native wrappers in document values and legitimate datastore field names are retained. CSV needs consistent column names; if later streamed documents introduce new fields, export fails instead of silently discarding those fields. Choose JSON or NDJSON for heterogeneous documents.

The export takes a stable copy of the loaded session when started. Further loading cannot change that export. Changing connection/environment configuration or replacing the result invalidates its context. Some row edits cannot be merged reliably into a projected/joined result; these require running the query again before export. A clear message explains this rather than exporting stale values.

## Configure limits

Open **Settings → Queries & Results**.

| Control | Default | Meaning |
| --- | --- | --- |
| Fetch batch size | 500 | Records requested per fetch, from 1 to 5,000. |
| Maximum loaded rows | No limit | Optional cumulative results-view cap. Loading remains manual. |
| Maximum exported rows | No limit | Optional cumulative export cap, disclosed in the export dialog. |

The toolbar **Batch size** overrides the workspace default for that tab. **Default** restores inheritance. Changes affect new executions, not an existing result's continuation.

Builder **Query limit** is a constraint in the actual query. **No limit**, where available, omits that constraint; it does not mean zero or an arbitrarily large number. SQL `LIMIT`/`TOP` and equivalent authored constraints remain effective during full export. DynamoDB's **Items evaluated** and Search's **Hit limit** keep their native semantics, including zero-hit aggregation queries.

Unlimited totals can consume substantial disk space or, when manually loading many pages, memory. Connection timeouts, server limits, Explorer pages, API/MCP limits, and history retention are separate.

## Progress and cancellation

Desktop query exports appear in **Transfers**. Keep the dialog open for progress, choose **Run in background**, or cancel. A completed export reports its item count. Reaching a configured export cap is reported as **limited**, not a complete result.

Output is written to a temporary file in the destination directory and published only after success. A failed or canceled export is not presented as a completed file and does not prematurely replace the destination. Canceling the save picker leaves the dialog available.

## Current implementation boundaries

Full-query streaming is desktop-only and currently wired for PostgreSQL/CockroachDB/TimescaleDB, MySQL/MariaDB, SQL Server, SQLite, Oracle's built-in managed runtime, MongoDB, LiteDB, DuckDB, Redis/Valkey, Memcached, InfluxDB's v1-compatible InfluxQL API, Cosmos DB NoSQL, DynamoDB, Cassandra, Elasticsearch/OpenSearch, ArangoDB, Neo4j Bolt, and ClickHouse. Availability is restricted further by query shape; scripts, writes, ambiguous statements, and unsupported forms are rejected. Oracle SQL*Plus and preview profiles cannot stream exports. Memcached supports `get`/`gets` with explicit keys, not key enumeration. InfluxDB exports points with separate measurement, tags, and fields; Flux and v3 SQL are not supported. Native paging consistency differs between providers; no universal point-in-time snapshot is promised.

Prometheus, OpenTSDB, JanusGraph, Neptune, Snowflake, and BigQuery full-query result streams are not implemented yet. Loaded-result export remains available in supported result formats. Adapter wiring alone is not proof of live-service validation; cloud and release-platform validation remain separate acceptance gates.

Not every adapter can continue its results view yet. Such a continuation now reports an explicit unavailable message rather than claiming that all records have been loaded. Where supported, use full-query export instead.

Browser preview supports loaded-result downloads only. Formats without a reliable row model cannot apply a cumulative export cap and explain this rather than silently ignoring it.

## Runtime and persistence

Canonical desktop result sessions and background export jobs are runtime-only. They are not written into workspaces or backups. Workspace schema **14** adds query-result preferences and optional per-tab batch overrides; migration preserves query text, builder limits, and saved work. Encrypted bundle format remains **2**.
