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
npm run fixtures:up:profile -- search
npm run fixtures:up:all
npm run fixtures:seed:all
```

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
| `cache` | Valkey | `localhost` | `6381` | `0` | | | `redis://localhost:6381/0` | `GET account:1` |
| `cache` | Memcached | `localhost` | `11212` | | | | `localhost:11212` | `get account:1` |
| `redis-stack` | Redis Stack | `localhost` | `6382` | `0` | | | `redis://localhost:6382/0` | `JSON.GET json:account:1` |
| `sqlplus` | MariaDB | `localhost` | `33061` | `commerce` | `datapadplusplus` | `datapadplusplus` | `mysql://datapadplusplus:datapadplusplus@localhost:33061/commerce` | `select * from accounts limit 20;` |
| `sqlplus` | CockroachDB | `localhost` | `26257` | `datapadplusplus` | `root` | | `postgresql://root@localhost:26257/datapadplusplus?sslmode=disable` | `select * from accounts limit 20;` |
| `sqlplus` | CockroachDB SQL UI | `localhost` | `8080` | | | | `http://localhost:8080` | browser UI |
| `sqlplus` | TimescaleDB | `localhost` | `54330` | `metrics` | `datapadplusplus` | `datapadplusplus` | `postgres://datapadplusplus:datapadplusplus@localhost:54330/metrics` | `select * from order_metrics_recent;` |
| `analytics` | ClickHouse HTTP | `localhost` | `8124` | `analytics` | `datapadplusplus` | `datapadplusplus` | `http://localhost:8124` | `select * from analytics.events limit 20;` |
| `analytics` | ClickHouse native | `localhost` | `9001` | `analytics` | `datapadplusplus` | `datapadplusplus` | `clickhouse://datapadplusplus:datapadplusplus@localhost:9001/analytics` | `select * from analytics.events limit 20;` |
| `analytics` | InfluxDB 1.x | `localhost` | `8087` | `metrics` | | | `http://localhost:8087` | `select * from order_latency limit 20` |
| `analytics` | Prometheus | `localhost` | `9091` | | | | `http://localhost:9091` | `up` |
| `search` | OpenSearch | `localhost` | `9201` | | | | `http://localhost:9201` | `GET /products/_search` |
| `search` | Elasticsearch | `localhost` | `9202` | | | | `http://localhost:9202` | `GET /products/_search` |
| `graph` | Neo4j HTTP | `localhost` | `7475` | `neo4j` | `neo4j` | `datapadplusplus` | `http://localhost:7475` | `MATCH (n) RETURN n LIMIT 20` |
| `graph` | Neo4j Bolt | `localhost` | `7688` | `neo4j` | `neo4j` | `datapadplusplus` | `bolt://localhost:7688` | `MATCH (n) RETURN n LIMIT 20` |
| `graph` | ArangoDB | `localhost` | `8529` | `datapadplusplus` | `root` | `datapadplusplus` | `http://localhost:8529` | `FOR account IN accounts LIMIT 20 RETURN account` |
| `graph` | JanusGraph | `localhost` | `8183` | | | | `ws://localhost:8183/gremlin` | `g.V().limit(20)` |
| `widecolumn` | Cassandra | `localhost` | `9043` | `datapadplusplus` | | | `localhost:9043` | `select * from accounts_by_id limit 20;` |
| `oracle` | Oracle Free | `localhost` | `1522` | `FREEPDB1` | `datapadplusplus` | `datapadplusplus` | `//localhost:1522/FREEPDB1` | `select * from accounts fetch first 20 rows only` |
| `cloud-contract` | DynamoDB Local | `localhost` | `8001` | shared DB | `local` | `local` | `http://localhost:8001` | `Scan products` |
| `cloud-contract` | BigQuery mock | `localhost` | `19050` | `analytics` | token in password field | `fixture-token` | `http://localhost:19050` | mock query returns `cloud-contract-ok` |
| `cloud-contract` | Snowflake mock | `localhost` | `19060` | `DATAPADPLUSPLUS` | token in password field | `fixture-token` | `http://localhost:19060` | mock query returns `cloud-contract-ok` |
| `cloud-contract` | Cosmos DB mock | `localhost` | `19070` | `datapadplusplus` | | `fixture-token` | `http://localhost:19070` | mock query returns `order-101` |
| `cloud-contract` | Neptune mock | `localhost` | `19080` | | | | `http://localhost:19080` | mock graph query returns `cloud-contract-ok` |

## Seeded Objects

The deterministic fixture domain is intentionally repeatable but large enough for a real workbench feel:

| Family | Seeded objects |
| --- | --- |
| SQL engines | `accounts`, `products`, `orders`, `order_items`, `support_tickets`, summary views, and indexed performance/event tables where supported. |
| MongoDB | `catalog.accounts`, `catalog.products`, `catalog.orders`, `catalog.perfDocuments`, `catalog.largeDocuments`. |
| Redis / Valkey | `account:*`, `product:*`, `orders:recent`, `account:1:segments`, `products:inventory`, `stream:orders`, `perf:session:*`. |
| Memcached | `account:1`, `product:luna-lamp`, `cache:feature-flags`, `product:fixture:*`. |
| Search engines | `products` and `orders` indexes with thousands of nested documents. |
| Cassandra | `accounts_by_id`, `products_by_sku`, `orders_by_account` with partition-friendly row volume. |
| DynamoDB Local | `accounts`, `products`, `orders`, `order_events` with bulk item data. |
| Cloud API mocks | BigQuery/Snowflake/Cosmos DB/Neptune endpoints return table lists and 50-100 deterministic rows, documents, or nodes. |
| Time-series / analytics | `order_metrics`, `system_metrics`, `service_health`, `order_latency`, `analytics.events`, `analytics.order_items`. |
| Graph | Account/order nodes or collections, plus generated order relationships where the fixture engine supports quick local seeding. |
