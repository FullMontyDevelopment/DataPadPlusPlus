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
> DataPad++ is currently pre-release software. A lot of the core experience is already usable, but some datastore-specific features are still being completed, refined, or guarded behind preview flows. Use read-only connections first when connecting to important systems, and treat production changes with care.

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
- file-based encrypted workspace exports, optional secret-inclusive bundles, and opt-in auto-backups

The goal is not to flatten every datastore into a generic table viewer. The goal is to make each datastore feel like it has its own purpose-built IDE inside the same app.

## What It Can Do

### Connect To Your Datastores

Create connection profiles for the systems you use every day. DataPad++ supports native fields, local database files, and connection strings where the datastore supports them.

Current focus areas include:

| Family | Datastores |
| --- | --- |
| SQL and relational | PostgreSQL, CockroachDB, SQL Server and Azure SQL, MySQL, MariaDB, SQLite |
| Document and NoSQL | MongoDB, DynamoDB, Cassandra |
| Key-value and cache | Redis, Valkey, Memcached |
| Search | Elasticsearch, OpenSearch |
| Local and analytical | SQLite, DuckDB, LiteDB |
| Expanding surfaces | Oracle, graph stores, warehouses, time-series, metrics, and more |

Some engines are further along than others. MongoDB, Redis/Valkey, SQL Server, PostgreSQL, SQLite, and several relational flows have received the deepest IDE-style treatment so far.

### Explore Without Guesswork

The Library tree can hold folders, connections, saved queries, scripts, tests, notes, and environments. Expanding a connection shows datastore-owned objects, not a fake generic tree.

Depending on the datastore, DataPad++ can show:

- databases, schemas, tables, views, indexes, functions, procedures, packages, triggers, users, and roles
- MongoDB databases, collections, views, GridFS, indexes, validation rules, schema previews, users, roles, and statistics
- Redis logical databases, type folders, keys, TTLs, memory usage, streams, ACLs, slow logs, and diagnostics
- search indexes, mappings, field capabilities, shards, aliases, lifecycle state, data streams, profile results, and query tools
- DynamoDB tables, keys, GSIs, LSIs, TTL, streams, backups, capacity, hot partitions, index coverage, and access previews
- Cassandra keyspaces, tables, primary keys, indexes, materialized views, partition/storage health, tracing, grants, and diagnostics
- Prometheus, InfluxDB, and OpenTSDB metrics, labels, measurements, tags, targets, rules, UID metadata, stats, posture panels, and guarded profile/cardinality/retention/UID/export previews
- Neo4j, ArangoDB, JanusGraph, and Neptune graph labels, relationships, indexes, constraints, access, metrics, and guarded profile/export previews
- Snowflake, BigQuery, and ClickHouse warehouse objects, jobs, stages/reservations, access, cost/storage/compute posture, ClickHouse query-log/MergeTree/cluster posture, dry-run/cost, table clone/copy/optimize/TTL/freeze, metrics, and import/export previews
- DuckDB local files, schemas, tables, views, extensions, external file sources, PRAGMAs, local file posture, extension posture, analyze/checkpoint, and CSV/Parquet import/export previews
- Cosmos DB containers, partition keys, indexing policy, RU throughput, regions, consistency, access, and guarded throughput/index/failover/export previews
- LiteDB local files, collections, indexes, file storage, storage health, checkpoint/compact, backup/export, and guarded local management previews
- Memcached stats, slabs, item classes, settings, connections, native cache metadata dumps, stats reset, and guarded flush previews
- local database files, metadata, pragmas, tables, indexes, and integrity checks

Right-click menus are designed to be object-aware. A table should feel like a table. A Redis key should feel like a Redis key. A MongoDB collection should feel like a collection, not a generic blob of JSON.

### Query In The Right Mode

Different datastores want different tools. DataPad++ adapts the query window to the connection.

- SQL databases open in a raw SQL editor by default, with metadata-aware IntelliSense.
- MongoDB supports a find query builder, raw JSON command mode, aggregation work, and safe scripting-style reads.
- Redis and Valkey open in a native key browser, with a Redis console available when you want commands.
- Document results can feed fields back into query builders by drag and drop.
- Scoped object actions can open a query already aimed at a collection, table, keyspace, index, or view.
- SQL-family connections can open a visual table-and-relationship explorer with focused graph loading, declared relationships, optional inferred links, and guarded schema-operation previews.

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
- Redis diagnostics, slow log views, ACL views, key import/export plans, and type-aware editors
- SQL-style object views for tables, procedures, functions, indexes, constraints, query store, security, and performance areas
- Oracle-style schema, package, storage, security, and performance views
- metrics dashboards where the datastore exposes useful counters
- explain plan rendering, including a purpose-built MongoDB explain UI
- test-suite workspaces for datastore-specific setup, execute, assert, and teardown flows
- interactive result export through Save As dialogs with datastore-appropriate formats such as CSV, JSON, NDJSON, and text
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
- Settings open as a normal closeable tab, with Appearance, Workspace, Backups, Security, Shortcuts, and Health sections.
- Workspace bundles are encrypted files with integrity verification; optional password inclusion stays encrypted and explicit.
- SQL relationship diagrams show table cards, columns, relationship ends, and focused inspectors without rendering an entire enterprise schema at once.

## Pre-Release Expectations

DataPad++ is moving quickly. That is exciting, but it also means:

- some datastore views may still be preview-backed
- some operations may generate a plan before live execution is available
- optional engines may need additional local drivers, Docker fixtures, or credentials
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

See [Docker Fixtures](tests/fixtures/README.md) for connection details and commands.

## Documentation

- [Feature Guide](docs/features.md)
- [Development Guide](docs/contributing/development.md)
- [Testing Strategy](docs/testing/strategy.md)
- [Settings, Workspace Bundles, And Backups](docs/settings-and-workspace.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Datastore Adapter Roadmap](docs/architecture/datastore-adapter-roadmap.md)
- [Datastore Readiness And Completion Plan](docs/architecture/datastore-readiness.md)
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
