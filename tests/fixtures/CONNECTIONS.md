# DataPad++ Fixture Connection Details

Use this file when creating manual DataPad++ connection profiles for Docker/local fixtures.

Run core fixtures:

```powershell
npm run fixtures:up
npm run fixtures:seed
```

Run optional fixtures:

```powershell
npm run fixtures:up:profile -- sqlplus
npm run fixtures:up:profile -- redis-stack
npm run fixtures:up:profile -- cache
npm run fixtures:up:profile -- search
npm run fixtures:up:profile -- cosmosdb
npm run fixtures:up:all
npm run fixtures:seed:all
npm run fixtures:validate:postgres
npm run fixtures:validate:mongodb
npm run fixtures:validate:redis -- --require-stack --require-valkey
npm run fixtures:validate:timescale
npm run fixtures:validate:oracle
npm run fixtures:validate:cosmosdb
npm run fixtures:validate:dynamodb
npm run fixtures:validate:search
npm run fixtures:validate:duckdb
npm run fixtures:validate:litedb
DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet
```

The PostgreSQL validator creates and removes transient `fixture_postgres_*` tables, routines, and a `fixture_postgres_readonly` role to check row evidence, diagnostics, import/export primitives, bounded backup evidence, and permission denial. Full `pg_dump`/`pg_restore` execution stays outside the scoped native-complete fixture claim unless promoted later.

Add `--require-vector` to the Redis validator only when the selected Redis Stack image exposes `VADD`; the default Redis native-complete fixture path treats vector-set live evidence as image-dependent and optional.

The TimescaleDB validator creates and removes transient `fixture_timescale_*` hypertables, continuous aggregates, a retention-policy job, a bounded CSV copy table, a failing scheduled job, and a `fixture_timescale_readonly` role to check extension/catalog metadata, hypertable row evidence, restricted catalog visibility, permission denial, policy/job boundaries, compressed chunk, aggregate lag, Toolkit variant, bounded file-copy, and failed-job diagnostic evidence. Live policy/file execution stays preview-first unless a later TimescaleDB slice promotes those guarded workflows.

The Oracle validator creates and removes transient `fixture_oracle_*` package, procedure, row-evidence, and file-workflow objects to check seeded volume, dictionary/security/storage metadata, DBMS_XPLAN output, SQL Monitor visibility or permission-boundary evidence, PL/SQL source and compile errors, row identity and DML `RETURNING` primitives, bounded SQLPlus export/import evidence, restricted dictionary denial evidence, and Data Pump/RMAN preview-boundary wording. Desktop Oracle SQLPlus query and primary-key/ROWID row-edit execution are now configurable per connection; Data Pump and RMAN execution stay outside the scoped claim until guarded executors are added.

The Cosmos DB emulator validator checks the optional Microsoft Linux vNext emulator profile. It verifies the health probe, seeded `datapadplusplus` database, `accounts`, `products`, `orders`, and `order_events` containers, and query evidence for seeded product/order documents. This is separate from the lightweight cloud-contract Cosmos DB mock.

The DynamoDB Local validator creates and removes a transient `fixture_dynamodb_contract` table to check key/GSI/TTL metadata, Query/GetItem/PartiQL read evidence, consumed-capacity payloads, conditional item-edit before/after evidence, and local backup/import-export boundary wording. The adapter now has deterministic SigV4-shaped local/endpoint-override request evidence and diagnostics disabled reasons. Live AWS validation is available separately through `DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE=1 npm run fixtures:validate:dynamodb:cloud`; it signs DynamoDB, STS, CloudWatch, and IAM requests with AWS4-HMAC-SHA256, validates environment/shared-profile plus opt-in STS AssumeRole, web identity, ECS task, and EC2 metadata credential providers, and keeps table, CloudWatch, IAM, and provider strictness behind explicit `DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_*` flags. S3 import/export and backup execution stay preview-first.

The search validator creates and removes transient `fixture-search-contract-*` and `fixture-search-import-*` indexes to check seeded search volume, mappings, aggregation/profile payloads, explicit-id document edit before/after evidence, slow-log/allocation diagnostics, bounded `_search` export plus `_bulk` import primitives, and OpenSearch SQL, ISM, security, and Performance Analyzer plugin boundaries. Desktop file/cloud import-export, snapshot execution, production cloud auth, managed SigV4/IAM execution, OpenSearch SQL plugin execution, Performance Analyzer dashboards, and broader admin execution stay outside the scoped search native-complete claims.

The DuckDB validator creates a temporary `.duckdb` file through the bundled Rust DuckDB runtime to check bundled local-file read/EXPLAIN/profile query execution, catalog explorer roots, table inspection payloads, diagnostics templates, write SQL guard failures, plan-only file import boundaries, guarded CSV export/import, backup-folder execution, database-file preflight/read-only guard evidence, lock-boundary evidence for filesystem read/write and DuckDB open probes, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight for `schema.sql`, `load.sql`, detected formats, file counts, bytes, target write/open readiness, and explicit restore/admin/extension execution-boundary evidence for scoped-out destructive `IMPORT DATABASE`, admin/DDL, and extension execution. Docker is not required. Extension-loaded live JSON/Parquet execution and any promoted local OLAP mutation/admin/extension execution stay outside the scoped native-complete fixture claim.

The LiteDB validator creates temporary `.db` files to check local-file read/write open preflight, read-only write blocking, password/encryption posture, lock-boundary metadata, configured sidecar read-dispatch evidence through deterministic fixture-token and spawned local sidecar-process paths, bounded response normalization, process open-failure mapping, timeout clamps, redacted failure output, and sidecar-shaped document CRUD planning. Docker and a real .NET LiteDB engine sidecar are not required for the default gate. The opt-in `.NET` sidecar validator, run with `DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet` after building the sidecar project, creates temporary real LiteDB databases and validates collection listing, bounded reads, index metadata, guarded full-document insert/update/delete, before/after reads, read-only mutation blocking, `_id` mismatch blocking, missing-file error mapping, encrypted-file correct-password open/read evidence, wrong-password failure evidence, JSON collection export/import execution, overwrite blocking, read-only import blocking, post-import reads, file-storage import/export/delete with list and post-delete checks, guarded index create/drop, `_id` index drop blocking, guarded collection drop, post-drop collection listing, and secret/path redaction. Packaged sidecar distribution and exclusive writer-lock validation stay outside this checkpoint.

The fixture runner writes the actual selected ports to `tests/fixtures/.generated.env`. If a default port is blocked, use the generated value instead of the default below.

## Core Fixtures

| Engine | Host | Port | Database | User | Password | Connection string / path | Smoke query |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| PostgreSQL | `localhost` | `54329` | `datapadplusplus` | `datapadplusplus` | `datapadplusplus` | `postgres://datapadplusplus:datapadplusplus@localhost:54329/datapadplusplus` | `select * from public.accounts limit 20;` |
| MySQL | `localhost` | `33060` | `commerce` | `datapadplusplus` | `datapadplusplus` | `mysql://datapadplusplus:datapadplusplus@localhost:33060/commerce` | `select * from accounts limit 20;` |
| SQL Server | `localhost` | `14333` | `datapadplusplus` | `sa` | `DataPadPlusPlus_pwd_123` | `Server=localhost,14333;Database=datapadplusplus;User Id=sa;Password=DataPadPlusPlus_pwd_123;TrustServerCertificate=True;` | `select top 20 * from dbo.accounts;` |
| MongoDB | `localhost` | `27018` | `catalog` | `datapadplusplus` | `datapadplusplus` | `mongodb://datapadplusplus:datapadplusplus@localhost:27018/catalog?authSource=admin` | `{ "collection": "products", "filter": {}, "limit": 20 }` |
| Redis | `localhost` | `6380` | `0` | | | `redis://localhost:6380/0` | `GET account:1` |
| SQLite | local file | | main | | | `C:\Users\gmont\source\repos\DataPad++\tests\fixtures\sqlite\datapadplusplus.sqlite3` | `select * from accounts limit 20;` |

## Optional Profiles

| Profile | Engine | Host | Port | Database / keyspace | User | Password | Connection string / endpoint | Smoke query |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `cache` | Valkey | `localhost` | `6381` | `0` | | | `redis://localhost:6381/0` | `GET account:1`, `HGETALL product:luna-lamp` |
| `cache` | Memcached | `localhost` | `11212` | | | | `localhost:11212` | `get account:1` |
| `redis-stack` | Redis Stack | `localhost` | `6382` | `0` | | | `redis://localhost:6382/0` | `JSON.GET json:account:1`, `TS.RANGE ts:orders:throughput - +` |
| `sqlplus` | MariaDB | `localhost` | `33061` | `commerce` | `datapadplusplus` | `datapadplusplus` | `mysql://datapadplusplus:datapadplusplus@localhost:33061/commerce` | `select * from accounts limit 20;` |
| `sqlplus` | CockroachDB | `localhost` | `26257` | `datapadplusplus` | `root` | | `postgresql://root@localhost:26257/datapadplusplus?sslmode=disable` | `select * from accounts limit 20;` |
| `sqlplus` | CockroachDB SQL UI | `localhost` | `8080` | | | | `http://localhost:8080` | browser UI |
| `sqlplus` | TimescaleDB | `localhost` | `54330` | `metrics` | `datapadplusplus` | `datapadplusplus` | `postgres://datapadplusplus:datapadplusplus@localhost:54330/metrics` | `select * from order_metrics_recent;`, `npm run fixtures:validate:timescale` |
| `analytics` | ClickHouse HTTP | `localhost` | `8124` | `analytics` | `datapadplusplus` | `datapadplusplus` | `http://localhost:8124` | `select * from analytics.events limit 20;` |
| `analytics` | ClickHouse native | `localhost` | `9001` | `analytics` | `datapadplusplus` | `datapadplusplus` | `clickhouse://datapadplusplus:datapadplusplus@localhost:9001/analytics` | `select * from analytics.events limit 20;` |
| local | DuckDB temporary file | local file | | | | | created by `npm run fixtures:validate:duckdb` | bundled local-file read/EXPLAIN/profile plus guarded CSV export/import, backup-folder, database-file preflight/read-only guard evidence, lock-boundary evidence, JSON/Parquet preloaded-extension-only boundary evidence, restore-package preflight, and restore/admin/extension execution-boundary evidence |
| local | LiteDB temporary file | local file | | | | | created by `npm run fixtures:validate:litedb`; optional real-engine file created by `fixtures:validate:litedb:dotnet` | local-file read/write open preflight, read-only write blocking, encryption posture, lock-boundary metadata, fixture-token dispatch, local sidecar-process evidence, and opt-in .NET sidecar collection/find/index/document/encryption/import-export/file-storage/management validation |
| `analytics` | InfluxDB 1.x | `localhost` | `8087` | `metrics` | | | `http://localhost:8087` | `select * from order_latency limit 20` |
| `analytics` | Prometheus | `localhost` | `9091` | | | | `http://localhost:9091` | `up` |
| `search` | OpenSearch | `localhost` | `9201` | | | | `http://localhost:9201` | `GET /products/_search`, `npm run fixtures:validate:search` |
| `search` | Elasticsearch | `localhost` | `9202` | | | | `http://localhost:9202` | `GET /products/_search`, `npm run fixtures:validate:search` |
| `graph` | Neo4j HTTP | `localhost` | `7475` | `neo4j` | `neo4j` | `datapadplusplus` | `http://localhost:7475` | `MATCH (n) RETURN n LIMIT 20` |
| `graph` | Neo4j Bolt | `localhost` | `7688` | `neo4j` | `neo4j` | `datapadplusplus` | `bolt://localhost:7688` | `MATCH (n) RETURN n LIMIT 20` |
| `graph` | ArangoDB | `localhost` | `8529` | `datapadplusplus` | `root` | `datapadplusplus` | `http://localhost:8529` | `FOR account IN accounts LIMIT 20 RETURN account` |
| `graph` | JanusGraph | `localhost` | `8183` | | | | `ws://localhost:8183/gremlin` | `g.V().limit(20)` |
| `widecolumn` | Cassandra | `localhost` | `9043` | `datapadplusplus` | | | `localhost:9043` | `select * from accounts_by_id limit 20;` |
| `oracle` | Oracle Free | `localhost` | `1522` | `FREEPDB1` | `datapadplusplus` | `datapadplusplus` | `//localhost:1522/FREEPDB1` | `select * from accounts fetch first 20 rows only`, `npm run fixtures:validate:oracle` |
| `cosmosdb` | Cosmos DB emulator gateway | `localhost` | `8082` | `datapadplusplus` | emulator | well-known emulator key | `http://localhost:8082` | `SELECT * FROM c WHERE c.id = 'order-101'`, `npm run fixtures:validate:cosmosdb` |
| `cosmosdb` | Cosmos DB emulator health | `localhost` | `18082` | | | | `http://localhost:18082/ready` | health probe |
| `cosmosdb` | Cosmos DB Data Explorer | `localhost` | `1235` | | | | `http://localhost:1235` | browser UI |
| `cloud-contract` | DynamoDB Local | `localhost` | `8001` | shared DB | `local` | `local` | `http://localhost:8001` | `Scan products`, `npm run fixtures:validate:dynamodb` |
| `cloud-contract` | BigQuery mock | `localhost` | `19050` | `analytics` | token in password field | `fixture-token` | `http://localhost:19050` | mock query returns `cloud-contract-ok` |
| `cloud-contract` | Snowflake mock | `localhost` | `19060` | `DATAPADPLUSPLUS` | token in password field | `fixture-token` | `http://localhost:19060` | mock query returns `cloud-contract-ok` |
| `cloud-contract` | Cosmos DB mock | `localhost` | `19070` | `datapadplusplus` | | `fixture-token` | `http://localhost:19070` | mock query returns `order-101` |
| `cloud-contract` | Neptune mock | `localhost` | `19080` | | | | `http://localhost:19080` | mock graph query returns `cloud-contract-ok` |

The Cosmos DB emulator profile writes selected ports to `DATAPADPLUSPLUS_COSMOSDB_EMULATOR_PORT`, `DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT`, and `DATAPADPLUSPLUS_COSMOSDB_EXPLORER_PORT` in `tests/fixtures/.generated.env` when defaults are unavailable.

## Seeded Objects

The deterministic fixture domain is intentionally repeatable but large enough for a real workbench feel:

| Family | Seeded objects |
| --- | --- |
| SQL engines | `accounts`, `products`, `orders`, `order_items`, `support_tickets`, summary views, and indexed performance/event tables where supported. Oracle also creates and removes transient `fixture_oracle_package`, `fixture_oracle_invalid`, `fixture_oracle_row_edit`, `fixture_oracle_row_evidence`, and `fixture_oracle_file_workflow` objects to prove DBMS_XPLAN, SQL Monitor boundary, PL/SQL compile diagnostics, row identity, bounded SQLPlus export/import, restricted dictionary, and Data Pump/RMAN preview-boundary evidence. |
| MongoDB | `catalog.accounts`, `catalog.products`, `catalog.orders`, `catalog.perfDocuments`, `catalog.largeDocuments`; the MongoDB validator also creates and removes transient `fixture_mongodb_import_export`, `fixture_mongodb_import_export_failures`, `fixture_mongodb_management`, `fixture_mongodb_readonly`, and `fixture_mongodb_management_user` objects to prove import/export, duplicate-key, validator, permission-denial, and management before/after primitives. |
| Redis / Valkey | `account:*`, `product:*`, `orders:recent`, `account:1:segments`, `products:inventory`, `stream:orders` with `fulfillment` consumer-group state, `perf:session:*`; the Redis validator also creates and removes transient `fixture:key-file:*` keys and a read-only ACL user to prove Valkey core key-file, large key-file, and permission-denial primitives. |
| Redis Stack | `json:account:1`, `ts:orders:throughput`, `bf:seen-orders`, `cf:skus`, `cms:regions`, `topk:products`, `tdigest:latency`, and optional `vectors:products` when vector commands are available. |
| Memcached | `account:1`, `product:luna-lamp`, `cache:feature-flags`, `product:fixture:*`. |
| Search engines | `products` and `orders` indexes with thousands of nested documents; the search validator also creates and removes transient `fixture-search-contract-*` and `fixture-search-import-*` indexes to prove profile, document-evidence, diagnostics, and bounded import/export primitive evidence. |
| Cassandra | `accounts_by_id`, `products_by_sku`, `orders_by_account` with partition-friendly row volume. |
| Cosmos DB emulator | `datapadplusplus.accounts`, `datapadplusplus.products`, `datapadplusplus.orders`, `datapadplusplus.order_events` seeded through `cosmoshell.sh` init scripts. |
| DynamoDB Local | `accounts`, `products`, `orders`, `order_events` with bulk item data; the validator also creates and removes `fixture_dynamodb_contract` to prove local key/GSI/TTL metadata, Query/GetItem/PartiQL reads, conditional item-edit evidence, consumed-capacity payloads, and backup/import-export boundary signals. |
| Cloud API mocks | BigQuery/Snowflake/Cosmos DB/Neptune endpoints return table lists and 50-100 deterministic rows, documents, or nodes. |
| Time-series / analytics | `order_metrics`, `system_metrics`, `service_health`, `order_latency`, `analytics.events`, `analytics.order_items`; the TimescaleDB validator also creates and removes transient `fixture_timescale_row_edit`, `fixture_timescale_policy_metrics`, `fixture_timescale_order_hourly`, `fixture_timescale_compressed_metrics`, `fixture_timescale_lag_hourly`, `fixture_timescale_file_import`, `fixture_timescale_failed_job`, and `fixture_timescale_readonly` objects to prove row evidence, permission denial, policy/job boundaries, compressed chunks, aggregate lag, Toolkit variants, bounded file-copy evidence, and failed-job diagnostics. The DuckDB validator creates a temporary `.duckdb` file to prove bundled local-file read/EXPLAIN/profile, catalog, diagnostics, guarded CSV export/import, backup-folder, database-file preflight/read-only guard, lock-boundary evidence, JSON/Parquet preloaded-extension-only boundary, restore-package preflight, restore/admin/extension execution-boundary, and guard-boundary evidence without Docker. The LiteDB default validator creates temporary `.db` files to prove local-file preflight, read/write open probes, read-only write blocking, encryption posture, lock-boundary metadata, fixture-token and local sidecar-process read dispatch, bounded response, process open-failure, timeout, and redaction evidence without Docker or a real .NET LiteDB engine sidecar; the opt-in .NET validator creates real LiteDB sidecar databases for collection/find/index/open-failure, encrypted-file, document CRUD, JSON collection import/export, file-storage import/export/delete, and index/collection management checks. |
| Graph | Account/order nodes or collections, plus generated order relationships where the fixture engine supports quick local seeding. |
