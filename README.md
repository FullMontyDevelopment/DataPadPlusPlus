# DataPad++

[![CI](https://github.com/FullMontyDevelopment/DataPadPlusPlus/actions/workflows/ci.yml/badge.svg)](https://github.com/FullMontyDevelopment/DataPadPlusPlus/actions/workflows/ci.yml)

DataPad++ is a desktop workspace for people who work across databases. It brings SQL, document stores, key-value systems, search engines, and cloud-style datastores into one local app, with a familiar editor, visual query tools, rich results, and safety checks for real environments.

The goal is simple: one place to connect, explore, query, inspect, and safely change data without jumping between a different tool for every datastore.

## What You Can Do

### Connect To Many Datastores

Create saved connection profiles for the systems you use every day. DataPad++ supports local files, host/port connections, and connection strings where the datastore allows them.

Current focus areas include:

- SQL: PostgreSQL, CockroachDB, SQL Server, MySQL, MariaDB, SQLite
- Document and NoSQL: MongoDB, DynamoDB, Cassandra
- Key-value and cache: Redis and Valkey
- Search: Elasticsearch and OpenSearch
- Local analytical files: SQLite, DuckDB, LiteDB surfaces

More engines are being added behind the same workspace experience.

### Explore Before You Query

Use the connection tree or Explorer tabs to browse what exists in a datastore before writing a query.

Depending on the datastore, DataPad++ can show:

- databases, schemas, tables, views, indexes, functions, and procedures
- MongoDB databases, collections, indexes, and sampled document shapes
- Redis and Valkey key groups, key types, TTLs, memory usage, and typed values
- search indexes, mappings, data streams, and search-oriented objects
- Cassandra keyspaces, tables, indexes, and materialized views

Object menus help you open a query already scoped to the item you selected.

### Query In The Style That Fits The Datastore

DataPad++ supports raw query editors and visual builders. You can switch between builder-only, raw-only, or side-by-side views when a builder exists.

Examples:

- write SQL directly for relational databases
- build MongoDB find queries with filters, projections, sorting, limits, and grouped AND/OR logic
- browse Redis keys visually instead of typing `SCAN` commands by hand
- create search queries for Elasticsearch/OpenSearch
- build key-condition or partition-key queries for stores like DynamoDB and Cassandra

Builder changes update the raw query immediately, so you can learn the generated query, edit it, save it, or share it.

### Work With Results Comfortably

Results are designed to feel like database work, not a generic web table.

Table results include:

- sticky headers and row numbers
- row and cell selection
- keyboard copy shortcuts
- column sizing
- large-result virtualization
- compact null and empty-value styling

Document and JSON-like results include:

- expandable field trees
- type-colored values
- document root labels based on the document id
- drag fields into query-builder filters, projections, or sorts
- double-click editing where the datastore safely supports it

Redis and Valkey results include type-aware views for strings, hashes, lists, sets, sorted sets, streams, and supported Redis Stack-style values.

### Save Work In A Library

The Library is a workspace for saved queries, scripts, snippets, notes, bookmarks, snapshots, and folders. You can organize items into nested folders, move them around, rename them, and reopen recent work.

When saving a query, DataPad++ can save it into the Library or to a local file on your machine.

### Use Environments And Safety Controls

Connections can be tied to environments such as Local, QA, Stage, and Production. Environments can carry colors, risk levels, variables, and confirmation rules.

DataPad++ is built to make risky actions visible:

- read-only connection profiles can block writes
- production or high-risk environments can require confirmations
- destructive operations are previewed before execution
- unsupported actions explain why they are disabled
- secrets are kept out of normal workspace files where possible

### Inspect Diagnostics

Where the datastore supports it, DataPad++ can surface execution plans, query profiles, performance counters, permissions, locks, sessions, index stats, Redis INFO/SLOWLOG/ACL data, and other engine-specific diagnostics.

Diagnostics vary by datastore. The app is designed to show the best useful information each engine can provide instead of forcing every database into the same shape.

## Downloading Releases

Releases are published from GitHub Actions as draft-reviewed desktop artifacts.

Look for assets such as:

- Windows installers: `.exe` or `.msi`
- Linux packages: `.deb`, `.rpm`, or AppImage
- macOS Apple Silicon builds: `.dmg` or app bundle artifacts

GitHub also adds automatic "Source code" zip/tar files to every release. Those are normal GitHub archives, but they are not the desktop app installers.

## Building From Source

Most users should download a release. Build from source if you want to contribute, test unreleased work, or run local datastore fixtures.

### Prerequisites

- Node.js 24+
- npm 11+
- Rust stable toolchain
- Tauri platform prerequisites from the [official Tauri docs](https://tauri.app/start/prerequisites/)
- Docker, when running the optional datastore fixtures
- On Windows, the Visual Studio C++ desktop workload and Windows SDK required by Tauri native builds

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

## Sample Datastores For Testing

The repository includes Docker fixtures with repeatable seed data for local testing.

```bash
npm run fixtures:up
npm run fixtures:seed
```

Optional fixture profiles add more engines such as Redis Stack, search engines, graph stores, analytics stores, Cassandra, Oracle, and cloud-contract mocks.

See [Docker Fixtures](tests/fixtures/README.md) for connection details and commands.

## Documentation

- [Feature Guide](docs/features.md) - product walkthrough and datastore experiences
- [Development Guide](docs/contributing/development.md) - build, test, release, and contributor workflow
- [Testing Strategy](docs/testing/strategy.md) - how checks and fixtures are organized
- [Architecture Overview](docs/architecture/overview.md) - deeper design notes for contributors
- [Datastore Adapter Roadmap](docs/architecture/datastore-adapter-roadmap.md) - long-term datastore platform plan
- [Security And Safety](docs/architecture/security-and-safety.md) - safety model and guardrails

## Project Status

DataPad++ is early-stage desktop software. Many core workflows already exist, and the project is actively growing toward a complete multi-datastore workbench. Some datastore experiences are mature enough for regular local use, while others are still beta, preview, or fixture-backed.

Use care with production systems. Prefer read-only profiles until you are comfortable with the app's safety prompts and generated operation previews.

## Contributing

Contributions are welcome. Please keep new datastore work aligned with the existing experience:

- make features feel natural for that datastore
- keep dangerous actions explicit and previewable
- avoid storing secrets in regular workspace files
- add tests for user-facing behavior and adapter safety
- keep product docs understandable for people who are not working inside the codebase

Start with the [Development Guide](docs/contributing/development.md).

## License

DataPad++ is source-available under the [DataPad++ Free Use License 1.0](LICENSE).

That means DataPad++ is free to use for personal, educational, nonprofit, government, internal business, and commercial work. Companies may use the official application internally without buying a license.

The license does not allow redistribution, selling, white-labeling, rebranding, bundling, hosted/managed-service use, publishing modified builds, or using the source code/assets to build a competing or substitute product without a separate written license. See [Commercial And Corporate Use](COMMERCIAL-LICENSE.md) for the practical summary.

Sponsorships and donations are welcome and help support development, but they are not required for ordinary internal use.
