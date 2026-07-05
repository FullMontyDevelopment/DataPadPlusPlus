# DataPad++ Docker Fixtures

This folder contains repeatable local fixtures for debugging and E2E testing datastore adapters.

Connection strings, credentials, and seeded smoke queries are listed in
[`CONNECTIONS.md`](./CONNECTIONS.md).

## Commands

- Core fixtures: `npm run fixtures:up`
- Seed running fixtures: `npm run fixtures:seed`
- Start one optional profile: `npm run fixtures:up:profile -- <profile>`
- Start all optional profiles: `npm run fixtures:up:all`
- Seed all running/known profiles: `npm run fixtures:seed:all`
- Validate PostgreSQL fixture evidence: `npm run fixtures:validate:postgres`
- Validate MongoDB fixture evidence: `npm run fixtures:validate:mongodb`
- Validate Redis/Redis Stack/Valkey fixture evidence: `npm run fixtures:validate:redis`
- Validate TimescaleDB fixture evidence: `npm run fixtures:validate:timescale`
- Validate Oracle fixture evidence: `npm run fixtures:validate:oracle`
- Validate Cosmos DB emulator evidence: `npm run fixtures:validate:cosmosdb`
- Validate DynamoDB Local fixture evidence: `npm run fixtures:validate:dynamodb`
- Validate opt-in DynamoDB AWS cloud evidence: `npm run fixtures:validate:dynamodb:cloud`
- Validate Elasticsearch/OpenSearch fixture evidence: `npm run fixtures:validate:search`
- Validate DuckDB local fixture evidence: `npm run fixtures:validate:duckdb`
- Validate LiteDB local-file and sidecar dispatch evidence: `npm run fixtures:validate:litedb`
- Validate opt-in LiteDB .NET sidecar evidence: `DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet`
- Launch a polished fixture workspace for website screenshots: `npm run fixtures:screenshot-seed`
- Stop and remove volumes: `npm run fixtures:down`

Run seeded Rust fixture tests with:

```powershell
$env:DATAPADPLUSPLUS_FIXTURE_RUN='1'
npm run rust:test
```

`DATAPADPLUSPLUS_*` is the current fixture environment prefix. Older `DATANAUT_*` and `UNIVERSALITY_*` variables may still be read as compatibility fallbacks, but new scripts and docs should use the DataPad++ prefix.

## Website Screenshot Seed

Use the screenshot seed when capturing website images or demos that should look professional while still using deterministic local fixtures:

```powershell
npm run fixtures:up:all
npm run fixtures:seed:all
npm run fixtures:screenshot-seed
```

The launcher sets `DATAPADPLUSPLUS_FIXTURE_RUN=1`, `DATAPADPLUSPLUS_FIXTURE_PROFILE=all`, `DATAPADPLUSPLUS_SCREENSHOT_SEED=1`, and defaults `DATAPADPLUSPLUS_SECRET_STORE=file` if it is not already set. The seeded workspace uses polished connection names, grouped datastore families, Local Demo/Staging/Production Preview environments, curated Library folders and queries, and enabled-but-stopped Workspace Search, API Server, MCP Server, and Datastore Security Checks plugins.

The launcher uses an isolated workspace directory at `tests/fixtures/.screenshot-workspace` so your normal DataPad++ workspace is not overwritten. It resets that screenshot workspace on each launch by default; set `DATAPADPLUSPLUS_SCREENSHOT_RESET_WORKSPACE=0` if you want to preserve edits between screenshot sessions.

To capture only a smaller subset, set `DATAPADPLUSPLUS_FIXTURE_PROFILE` before launching:

```powershell
$env:DATAPADPLUSPLUS_FIXTURE_PROFILE='search,analytics'
npm run fixtures:screenshot-seed
```

For PostgreSQL reference-engine evidence, start and seed the default fixtures, then run the PostgreSQL validator:

```powershell
npm run fixtures:up
npm run fixtures:seed
npm run fixtures:validate:postgres
```

The validator checks seeded relational volume, catalog/security/extension visibility, diagnostics and lock/session primitives, guarded session action primitives for `pg_cancel_backend` and `pg_terminate_backend`, rendered `EXPLAIN ANALYZE` JSON output, routine call/procedure primitives, row-edit before/after evidence, table import/export command primitives, bounded logical backup evidence, and permission-denied writes through a temporary `fixture_postgres_readonly` role. It creates and removes transient `fixture_postgres_*` tables, routines, and roles. Full `pg_dump`/`pg_restore` execution remains outside the scoped PostgreSQL native-complete claim unless a future release promotes it with explicit guardrails.

For MongoDB reference-engine evidence, start and seed the default fixtures, then run the MongoDB validator:

```powershell
npm run fixtures:up
npm run fixtures:seed
npm run fixtures:validate:mongodb
```

The validator checks seeded catalog volume, large-document export primitives, collection import/export command primitives, duplicate-key and validator failure evidence, permission-denied diagnostics with a temporary read-only user, and before/after evidence for index hiding, validator updates, and user management. It creates and removes transient `fixture_mongodb_*` collections and users.

For full Redis reference-engine evidence, start and seed the optional Redis Stack and cache profiles, then run the Redis validator:

```powershell
npm run fixtures:up:profile -- redis-stack
npm run fixtures:up:profile -- cache
npm run fixtures:seed:all
npm run fixtures:validate:redis -- --require-stack --require-valkey
```

The validator checks core Redis and Valkey seeded keys plus stream consumer groups, validates Valkey core key-file export/import command primitives, TTL behavior, permission-denied guarded writes, and large key-file primitives, and checks Redis Stack JSON, TimeSeries, Bloom, Cuckoo, CMS, TopK, t-digest, and vector-set fixture data when the selected Redis Stack image exposes vector commands. Add `--require-vector` only with a Redis Stack image that exposes `VADD`; otherwise vector-set live fixture evidence is intentionally image-dependent and optional.

For TimescaleDB optional evidence, start and seed the `sqlplus` profile, then run the TimescaleDB validator:

```powershell
npm run fixtures:up:profile -- sqlplus
npm run fixtures:seed:all
npm run fixtures:validate:timescale
```

The validator checks TimescaleDB extension/version visibility, seeded hypertable and chunk catalog rows, seeded metric volume, hypertable row-edit before/after evidence with `RETURNING` row snapshots, restricted catalog visibility and permission-denied writes through a temporary `fixture_timescale_readonly` role, continuous aggregate and policy/job boundary evidence, compressed chunk and aggregate lag evidence, Toolkit availability/function variants, bounded CSV export/import evidence, and failed-job diagnostics through transient `fixture_timescale_*` objects. Live policy/file execution remains preview-first; this optional validator proves metadata, permissions, and planner boundary evidence while keeping production-style policy/job execution outside the scoped claim.

For Oracle optional evidence, start and seed the `oracle` profile, then run the Oracle validator:

```powershell
npm run fixtures:up:profile -- oracle
npm run fixtures:seed:all
npm run fixtures:validate:oracle
```

The validator checks Oracle seeded relational volume, dictionary/security/storage metadata, DBMS_XPLAN output, SQL Monitor visibility or permission-boundary evidence, PL/SQL package source and compile diagnostics, row identity and DML `RETURNING` primitives, SQLPlus bounded CSV-style export/import evidence, restricted dictionary denial evidence, and Data Pump/RMAN preview boundary wording through transient `fixture_oracle_*` objects. Desktop Oracle SQLPlus query and primary-key/ROWID row-edit execution are now configurable per connection; Data Pump and RMAN execution remain outside the scoped claim until guarded executors are added.

For Cosmos DB emulator optional evidence, start the `cosmosdb` profile, then run the Cosmos DB validator:

```powershell
npm run fixtures:up:profile -- cosmosdb
npm run fixtures:seed:all
npm run fixtures:validate:cosmosdb
```

The profile runs the Microsoft Linux vNext Cosmos DB emulator in HTTP gateway mode, publishes the gateway, health, and Data Explorer ports, and seeds `datapadplusplus` with `accounts`, `products`, `orders`, and `order_events` containers through the emulator's built-in `cosmoshell.sh` init flow. The validator checks the health probe, seeded database/container visibility, order/product query evidence, and seeded row volume. The existing cloud-contract Cosmos DB mock remains available for fast contract tests that do not need the full emulator.

For DynamoDB Local optional evidence, start and seed the `cloud-contract` profile, then run the DynamoDB validator:

```powershell
npm run fixtures:up:profile -- cloud-contract
npm run fixtures:seed:all
npm run fixtures:validate:dynamodb
```

The validator checks seeded table volume, consumed-capacity payloads, table/key/GSI/TTL metadata through a transient `fixture_dynamodb_contract` table, Query/GetItem/PartiQL read evidence, conditional item-edit before/after evidence with `attribute_exists` and `attribute_not_exists`, and local backup/import-export boundary evidence. The adapter now emits deterministic SigV4-shaped local/endpoint-override request evidence and diagnostics disabled reasons.

For opt-in live AWS validation, configure either `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `DATAPADPLUSPLUS_AWS_PROFILE`/`AWS_PROFILE`, then run:

```powershell
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE = '1'
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_REGION = 'us-east-1'
$env:DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE = '<optional-table-name>'
npm run fixtures:validate:dynamodb:cloud
```

The cloud validator signs DynamoDB, STS, CloudWatch, and IAM requests with AWS4-HMAC-SHA256 and checks credential identity, `ListTables`, `DescribeLimits`, optional table diagnostics, optional CloudWatch metrics, and optional IAM simulation. Set `DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER=assume-role` with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_ASSUME_ROLE_ARN` for STS AssumeRole, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER=web-identity` with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_ROLE_ARN` plus `DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_TOKEN_FILE`, or `DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER=ecs-task` / `ec2-instance` with `DATAPADPLUSPLUS_DYNAMODB_CLOUD_ALLOW_METADATA=1` to validate ECS task and EC2 metadata temporary-provider paths. Set `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_TABLE=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_CLOUDWATCH=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_IAM=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ASSUME_ROLE=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_WEB_IDENTITY=1`, `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ECS_TASK=1`, or `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_EC2_INSTANCE=1` to make those optional checks fail closed. Backup/create and S3 import/export execution remain preview-first; the validator only runs read-only preflights unless a later guarded executor explicitly promotes them.

For Elasticsearch/OpenSearch optional evidence, start and seed the `search` profile, then run the search validator:

```powershell
npm run fixtures:up:profile -- search
npm run fixtures:seed:all
npm run fixtures:validate:search
```

The validator checks seeded `products` and `orders` index volume, mappings, aggregation/profile responses, explicit-id document edit before/after evidence through transient `fixture-search-contract-*` indexes, slow-log settings, node search/indexing stats, shard/allocation diagnostic boundaries, bounded `_search` export plus `_bulk` import primitives through transient `fixture-search-import-*` indexes, and OpenSearch SQL, ISM, security, and Performance Analyzer plugin boundaries. Desktop file/cloud import-export, snapshot execution, production cloud auth, managed SigV4/IAM execution, OpenSearch SQL plugin execution, Performance Analyzer dashboards, and broader admin execution remain outside the scoped search native-complete claims until separately guarded.

For DuckDB local optional evidence, run the bundled DuckDB validator:

```powershell
npm run fixtures:validate:duckdb
```

The validator creates a temporary `.duckdb` file through the bundled Rust DuckDB runtime and checks bundled local-file read/EXPLAIN/profile query execution, catalog explorer roots, table inspection payloads, diagnostics templates, write SQL guard failures, plan-only file import boundaries, guarded CSV export/import, backup-folder execution, database-file preflight/read-only guard evidence, lock-boundary evidence for filesystem read/write and DuckDB open probes, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight for `schema.sql`, `load.sql`, detected formats, file counts, bytes, target write/open readiness, and explicit restore/admin/extension execution-boundary evidence for scoped-out destructive `IMPORT DATABASE`, admin/DDL, and extension execution. Docker is not required. Extension-loaded live JSON/Parquet execution and any promoted local OLAP mutation/admin/extension execution remain outside the scoped native-complete evidence until separately guarded.

For LiteDB local-file and sidecar dispatch evidence, run the LiteDB validator:

```powershell
npm run fixtures:validate:litedb
```

The validator runs focused Rust unit tests against temporary `.db` files and checks local-file read/write open preflight, read-only write blocking, password/encryption posture, lock-boundary metadata, configured sidecar read-dispatch through both a deterministic fixture-sidecar token and a spawned local sidecar-process fixture, bounded response normalization, process open-failure mapping, timeout clamps, redacted failure output, and sidecar-shaped document CRUD planning. Docker and a real .NET LiteDB engine sidecar are not required for the default gate. The opt-in `.NET` sidecar validator, run with `DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet` after building the sidecar project, creates temporary real LiteDB databases and validates collection listing, bounded reads, index metadata, guarded full-document insert/update/delete, before/after reads, read-only mutation blocking, `_id` mismatch blocking, missing-file error mapping, encrypted-file correct-password open/read evidence, wrong-password failure evidence, JSON collection export/import execution, overwrite blocking, read-only import blocking, post-import reads, file-storage import/export/delete with list and post-delete checks, guarded index create/drop, `_id` index drop blocking, guarded collection drop, post-drop collection listing, and secret/path redaction. Packaged sidecar distribution and exclusive writer-lock validation remain outside this checkpoint.

## Profiles

| Profile | Services | Notes |
| --- | --- | --- |
| default | PostgreSQL, MySQL, SQL Server, MongoDB, Redis, SQLite file | Fast path used by existing E2E. |
| `cache` | Valkey, Memcached | Lightweight cache fixtures. |
| `redis-stack` | Redis Stack | Optional Redis JSON/Search/TimeSeries/probabilistic module coverage, plus vector-set seed checks when the image supports vector commands; use `--require-vector` only for VADD-capable images. |
| `sqlplus` | MariaDB, CockroachDB, TimescaleDB | Additional SQL and PostgreSQL-wire engines. |
| `analytics` | ClickHouse, InfluxDB, Prometheus, DuckDB file | OLAP/time-series fixtures. |
| `search` | OpenSearch, Elasticsearch | Single-node, security-disabled, memory-limited. |
| `graph` | Neo4j, ArangoDB, JanusGraph | JanusGraph is heavier and may take longer to settle. |
| `widecolumn` | Cassandra | Heavy JVM service. |
| `oracle` | Oracle Free | Very heavy; start explicitly. |
| `cosmosdb` | Cosmos DB emulator vNext | Optional Microsoft emulator with seeded NoSQL containers and Data Explorer. |
| `cloud-contract` | DynamoDB Local, HTTP mocks for BigQuery/Snowflake/Cosmos DB/Neptune | Local substitutes for cloud-managed APIs. |

## Default Ports And Credentials

The fixture runner writes the actual ports it selected to `tests/fixtures/.generated.env`.
If a default port is blocked or reserved by Windows, the runner automatically chooses a nearby
available fallback and the debug fixture workspace reads that generated file. You can still force
a port by setting the matching environment variable before running `fixtures:up`, for example:

```powershell
$env:DATAPADPLUSPLUS_POSTGRES_PORT='55432'
npm run fixtures:up
```

VS Code debug tasks should run `fixtures:up` first so the generated environment file exists before the desktop app starts. This keeps debugger connection profiles aligned with any automatic port fallback.

If an existing local fixture container was created before the current credentials or health checks, `fixtures:up` may recreate only that stale fixture container and retry. This is expected for local test data; rerun `fixtures:seed` after `fixtures:up` to repopulate deterministic samples.

| Engine | Host Port | Database | User | Password |
| --- | ---: | --- | --- | --- |
| PostgreSQL | `DATAPADPLUSPLUS_POSTGRES_PORT` or 54329 | datapadplusplus | datapadplusplus | datapadplusplus |
| MySQL | 33060 | commerce | datapadplusplus | datapadplusplus |
| SQL Server | 14333 | datapadplusplus | sa | DataPadPlusPlus_pwd_123 |
| MongoDB | 27018 | catalog | datapadplusplus | datapadplusplus |
| Redis | 6380 | 0 | | |
| Redis Stack | 6382 | 0 | | |
| Valkey | 6381 | 0 | | |
| Memcached | 11212 | | | |
| MariaDB | 33061 | commerce | datapadplusplus | datapadplusplus |
| CockroachDB | 26257 | datapadplusplus | root/insecure | |
| TimescaleDB | 54330 | metrics | datapadplusplus | datapadplusplus |
| ClickHouse | 8124 | analytics | datapadplusplus | datapadplusplus |
| InfluxDB | 8087 | metrics | | |
| Prometheus | 9091 | | | |
| OpenSearch | 9201 | | | |
| Elasticsearch | 9202 | | | |
| Neo4j | 7475 / 7688 | neo4j | neo4j | datapadplusplus |
| ArangoDB | 8529 | datapadplusplus | root | datapadplusplus |
| Cassandra | 9043 | datapadplusplus | | |
| JanusGraph | 8183 | | | |
| Oracle Free | 1522 | FREEPDB1 | datapadplusplus | datapadplusplus |
| Cosmos DB emulator | 8082 / 18082 / 1235 | datapadplusplus | emulator | well-known emulator key |
| DynamoDB Local | 8001 | sharedDb | local | local |
| BigQuery mock | 19050 | analytics | token in password field | fixture-token |
| Snowflake mock | 19060 | DATAPADPLUSPLUS | token in password field | fixture-token |
| Cosmos DB mock | 19070 | datapadplusplus | | fixture-token |
| Neptune mock | 19080 | | | |

Seed data uses a shared commerce/operations domain: accounts, products, orders, line items, support tickets, sessions, events, metrics, and alerts. Scripts are designed to be safe to rerun and now load enough volume to exercise paging, virtualization, metadata browsing, export, relationship explorers, and large-value inspectors.

## Performance Seed Data

The core fixtures also include deterministic high-volume data for paging, virtualization, copy/export, and explorer performance testing:

| Engine | Object | Default volume |
| --- | --- | ---: |
| PostgreSQL | `orders`, `order_items`, `observability.audit_log`, `observability.perf_events`, transient `fixture_postgres_*` validation objects | 25,000 / 75,000 / 100,000 / 100,000 rows plus diagnostics, row-evidence, import/export, bounded-backup, and permission-denial primitives |
| MySQL | `orders`, `order_items`, `perf_inventory_events` | 25,000 / 75,000 / 100,000 rows |
| SQL Server | `dbo.orders`, `dbo.order_items`, `dbo.perf_events` | 25,000 / 75,000 / 100,000 rows |
| SQLite | `perf_events` | 100,000 rows |
| MongoDB | `catalog.perfDocuments`, `catalog.largeDocuments`, transient `fixture_mongodb_*` validation collections | 150,000 documents / 12 multi-MB documents plus import/export, duplicate-key, permission-denial, and management before/after evidence |
| Redis | `perf:session:*` plus `perf:manifest` | 100,000 keys |
| Redis Stack (`redis-stack`) | `json:account:1`, `ts:orders:throughput`, Bloom/Cuckoo/CMS/TopK/t-digest module keys, optional `vectors:products` | Small module evidence set |
| MariaDB (`sqlplus`) | `orders`, `order_items`, `perf_order_events` | 25,000 / 75,000 / 100,000 rows |
| CockroachDB (`sqlplus`) | `orders`, `order_items`, `support_tickets` | 25,000 / 75,000 / 5,000 rows |
| TimescaleDB (`sqlplus`) | `order_metrics`, `system_metrics`, transient `fixture_timescale_*` validation objects | 100,000 / 100,000 rows plus extension/catalog, row-evidence, permission-denial, continuous-aggregate, policy/job boundary, compressed chunk, Toolkit variant, aggregate lag, bounded file-copy, and failed-job diagnostic primitives |
| ClickHouse (`analytics`) | `analytics.events`, `analytics.order_items` | 250,000 / 75,000 rows |
| InfluxDB (`analytics`) | `service_health` | 50,000 points |
| Search engines (`search`) | `products`, `orders`, transient `fixture-search-contract-*`, and transient `fixture-search-import-*` indexes | 5,000 / 10,000 documents plus profile, document-evidence, diagnostics, and bounded import/export primitive evidence |
| Cassandra (`widecolumn`) | `accounts_by_id`, `products_by_sku`, `orders_by_account` | 500 / 1,000 / 10,000 rows |
| Oracle (`oracle`) | `orders`, `order_items`, `support_tickets`, transient `fixture_oracle_*` validation objects | 25,000 / 75,000 / 5,000 rows plus DBMS_XPLAN, SQL Monitor boundary, PL/SQL compile diagnostics, row identity, bounded SQLPlus export/import, restricted dictionary, and Data Pump/RMAN preview-boundary primitives |
| Cosmos DB emulator (`cosmosdb`) | `accounts`, `products`, `orders`, `order_events` | Seeded NoSQL containers with account/product/order documents plus Data Explorer and health probe evidence |
| DynamoDB Local (`cloud-contract`) | `accounts`, `products`, `orders`, `order_events`, transient `fixture_dynamodb_contract` validation table | 500 / 1,000 / 5,000 / 10,000 items plus local Query/GetItem/PartiQL, conditional-write, capacity, metadata, and boundary evidence |
| Cloud API mocks (`cloud-contract`) | BigQuery, Snowflake, Cosmos DB, Neptune responses | 50-100 rows/documents/nodes per query |
| Neo4j (`graph`) | Account/order graph | 500 accounts / 2,500 orders |
| ArangoDB (`graph`) | `accounts`, `orders` collections | 500 / 5,000 documents |
| Memcached (`cache`) | `product:fixture:*` plus domain keys | 500 generated keys |
| Valkey (`cache`) | `perf:session:*`, `perf:manifest`, `stream:orders` consumer group, `fixture:key-file:*` transient validation keys | 100,000 keys plus stream-group, permission-denial, and large key-file primitive evidence |

Redis/Valkey and InfluxDB high-volume seeds can be overridden for local experiments with `DATAPADPLUSPLUS_REDIS_PERF_KEYS` and `DATAPADPLUSPLUS_INFLUX_POINTS`.

## Resource Expectations

The default stack is intended for everyday debugging. `oracle`, `widecolumn`, `graph`, and `search` can consume several GB of memory and should be started only when needed. `fixtures:up:all` is deliberately opt-in.
