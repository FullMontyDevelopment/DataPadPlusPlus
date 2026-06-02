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
- Stop and remove volumes: `npm run fixtures:down`

Run seeded Rust fixture tests with:

```powershell
$env:DATAPADPLUSPLUS_FIXTURE_RUN='1'
npm run rust:test
```

`DATAPADPLUSPLUS_*` is the current fixture environment prefix. Older `DATANAUT_*` and `UNIVERSALITY_*` variables may still be read as compatibility fallbacks, but new scripts and docs should use the DataPad++ prefix.

## Profiles

| Profile | Services | Notes |
| --- | --- | --- |
| default | PostgreSQL, MySQL, SQL Server, MongoDB, Redis, SQLite file | Fast path used by existing E2E. |
| `cache` | Valkey, Memcached | Lightweight cache fixtures. |
| `redis-stack` | Redis Stack | Optional Redis JSON/Search/TimeSeries/probabilistic module coverage. |
| `sqlplus` | MariaDB, CockroachDB, TimescaleDB | Additional SQL and PostgreSQL-wire engines. |
| `analytics` | ClickHouse, InfluxDB, Prometheus, DuckDB file | OLAP/time-series fixtures. |
| `search` | OpenSearch, Elasticsearch | Single-node, security-disabled, memory-limited. |
| `graph` | Neo4j, ArangoDB, JanusGraph | JanusGraph is heavier and may take longer to settle. |
| `widecolumn` | Cassandra | Heavy JVM service. |
| `oracle` | Oracle Free | Very heavy; start explicitly. |
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
| PostgreSQL | `orders`, `order_items`, `observability.audit_log`, `observability.perf_events` | 25,000 / 75,000 / 100,000 / 100,000 rows |
| MySQL | `orders`, `order_items`, `perf_inventory_events` | 25,000 / 75,000 / 100,000 rows |
| SQL Server | `dbo.orders`, `dbo.order_items`, `dbo.perf_events` | 25,000 / 75,000 / 100,000 rows |
| SQLite | `perf_events` | 100,000 rows |
| MongoDB | `catalog.perfDocuments`, `catalog.largeDocuments` | 150,000 documents / 12 multi-MB documents |
| Redis | `perf:session:*` plus `perf:manifest` | 100,000 keys |
| MariaDB (`sqlplus`) | `orders`, `order_items`, `perf_order_events` | 25,000 / 75,000 / 100,000 rows |
| CockroachDB (`sqlplus`) | `orders`, `order_items`, `support_tickets` | 25,000 / 75,000 / 5,000 rows |
| TimescaleDB (`sqlplus`) | `order_metrics`, `system_metrics` | 100,000 / 100,000 rows |
| ClickHouse (`analytics`) | `analytics.events`, `analytics.order_items` | 250,000 / 75,000 rows |
| InfluxDB (`analytics`) | `service_health` | 50,000 points |
| Search engines (`search`) | `products`, `orders` indexes | 5,000 / 10,000 documents |
| Cassandra (`widecolumn`) | `accounts_by_id`, `products_by_sku`, `orders_by_account` | 500 / 1,000 / 10,000 rows |
| Oracle (`oracle`) | `orders`, `order_items`, `support_tickets` | 25,000 / 75,000 / 5,000 rows |
| DynamoDB Local (`cloud-contract`) | `accounts`, `products`, `orders`, `order_events` | 500 / 1,000 / 5,000 / 10,000 items |
| Cloud API mocks (`cloud-contract`) | BigQuery, Snowflake, Cosmos DB, Neptune responses | 50-100 rows/documents/nodes per query |
| Neo4j (`graph`) | Account/order graph | 500 accounts / 2,500 orders |
| ArangoDB (`graph`) | `accounts`, `orders` collections | 500 / 5,000 documents |
| Memcached (`cache`) | `product:fixture:*` plus domain keys | 500 generated keys |
| Valkey (`cache`) | `perf:session:*` plus `perf:manifest` | 100,000 keys |

Redis/Valkey and InfluxDB high-volume seeds can be overridden for local experiments with `DATAPADPLUSPLUS_REDIS_PERF_KEYS` and `DATAPADPLUSPLUS_INFLUX_POINTS`.

## Resource Expectations

The default stack is intended for everyday debugging. `oracle`, `widecolumn`, `graph`, and `search` can consume several GB of memory and should be started only when needed. `fixtures:up:all` is deliberately opt-in.
