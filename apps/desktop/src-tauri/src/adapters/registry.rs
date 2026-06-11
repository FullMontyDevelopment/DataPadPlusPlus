use super::contract::DatastoreAdapter;
use super::datastores::planned::{beta_adapter_for_engine, beta_manifests};
use super::datastores::{
    mariadb_adapter, ArangoDbAdapter, BigQueryAdapter, CassandraAdapter, ClickHouseAdapter,
    CockroachAdapter, CosmosDbAdapter, DuckDbAdapter, DynamoDbAdapter, ElasticsearchAdapter,
    InfluxDbAdapter, JanusGraphAdapter, LiteDbAdapter, MemcachedAdapter, MongoDbAdapter,
    MysqlLikeAdapter, Neo4jAdapter, NeptuneAdapter, OpenSearchAdapter, OpenTsdbAdapter,
    OracleAdapter, PostgresAdapter, PrometheusAdapter, RedisAdapter, SnowflakeAdapter,
    SqlServerAdapter, SqliteAdapter, TimescaleAdapter, ValkeyAdapter,
};
use super::*;

struct AdapterRegistration {
    engine: &'static str,
    adapter: fn() -> Box<dyn DatastoreAdapter>,
}

fn adapter_registrations() -> &'static [AdapterRegistration] {
    &[
        AdapterRegistration {
            engine: "postgresql",
            adapter: || Box::new(PostgresAdapter),
        },
        AdapterRegistration {
            engine: "cockroachdb",
            adapter: || Box::new(CockroachAdapter),
        },
        AdapterRegistration {
            engine: "timescaledb",
            adapter: || Box::new(TimescaleAdapter),
        },
        AdapterRegistration {
            engine: "sqlserver",
            adapter: || Box::new(SqlServerAdapter),
        },
        AdapterRegistration {
            engine: "mysql",
            adapter: || Box::new(MysqlLikeAdapter { engine: "mysql" }),
        },
        AdapterRegistration {
            engine: "mariadb",
            adapter: || Box::new(mariadb_adapter()),
        },
        AdapterRegistration {
            engine: "sqlite",
            adapter: || Box::new(SqliteAdapter),
        },
        AdapterRegistration {
            engine: "oracle",
            adapter: || Box::new(OracleAdapter),
        },
        AdapterRegistration {
            engine: "bigquery",
            adapter: || Box::new(BigQueryAdapter),
        },
        AdapterRegistration {
            engine: "clickhouse",
            adapter: || Box::new(ClickHouseAdapter),
        },
        AdapterRegistration {
            engine: "cosmosdb",
            adapter: || Box::new(CosmosDbAdapter),
        },
        AdapterRegistration {
            engine: "cassandra",
            adapter: || Box::new(CassandraAdapter),
        },
        AdapterRegistration {
            engine: "duckdb",
            adapter: || Box::new(DuckDbAdapter),
        },
        AdapterRegistration {
            engine: "dynamodb",
            adapter: || Box::new(DynamoDbAdapter),
        },
        AdapterRegistration {
            engine: "snowflake",
            adapter: || Box::new(SnowflakeAdapter),
        },
        AdapterRegistration {
            engine: "elasticsearch",
            adapter: || Box::new(ElasticsearchAdapter),
        },
        AdapterRegistration {
            engine: "opensearch",
            adapter: || Box::new(OpenSearchAdapter),
        },
        AdapterRegistration {
            engine: "arango",
            adapter: || Box::new(ArangoDbAdapter),
        },
        AdapterRegistration {
            engine: "prometheus",
            adapter: || Box::new(PrometheusAdapter),
        },
        AdapterRegistration {
            engine: "opentsdb",
            adapter: || Box::new(OpenTsdbAdapter),
        },
        AdapterRegistration {
            engine: "influxdb",
            adapter: || Box::new(InfluxDbAdapter),
        },
        AdapterRegistration {
            engine: "neo4j",
            adapter: || Box::new(Neo4jAdapter),
        },
        AdapterRegistration {
            engine: "janusgraph",
            adapter: || Box::new(JanusGraphAdapter),
        },
        AdapterRegistration {
            engine: "neptune",
            adapter: || Box::new(NeptuneAdapter),
        },
        AdapterRegistration {
            engine: "litedb",
            adapter: || Box::new(LiteDbAdapter),
        },
        AdapterRegistration {
            engine: "mongodb",
            adapter: || Box::new(MongoDbAdapter),
        },
        AdapterRegistration {
            engine: "redis",
            adapter: || Box::new(RedisAdapter),
        },
        AdapterRegistration {
            engine: "valkey",
            adapter: || Box::new(ValkeyAdapter),
        },
        AdapterRegistration {
            engine: "memcached",
            adapter: || Box::new(MemcachedAdapter),
        },
    ]
}

fn adapter_registration_for_engine(engine: &str) -> Option<&'static AdapterRegistration> {
    adapter_registrations()
        .iter()
        .find(|registration| registration.engine == engine)
}

pub fn manifests() -> Vec<AdapterManifest> {
    let mut manifests = adapter_registrations()
        .iter()
        .map(|registration| (registration.adapter)().manifest())
        .collect::<Vec<_>>();
    manifests.extend(beta_manifests());
    manifests
}

pub fn execution_capabilities(engine: &str) -> ExecutionCapabilities {
    adapter_registration_for_engine(engine)
        .map(|registration| (registration.adapter)().execution_capabilities())
        .or_else(|| beta_adapter_for_engine(engine).map(|adapter| adapter.execution_capabilities()))
        .unwrap_or_else(|| ExecutionCapabilities {
            can_cancel: false,
            can_explain: false,
            supports_live_metadata: false,
            editor_language: "text".into(),
            default_row_limit: 200,
        })
}

pub(crate) fn adapter_for_engine(engine: &str) -> Result<Box<dyn DatastoreAdapter>, CommandError> {
    adapter_registration_for_engine(engine)
        .map(|registration| (registration.adapter)())
        .or_else(|| {
            beta_adapter_for_engine(engine)
                .map(|adapter| Box::new(adapter) as Box<dyn DatastoreAdapter>)
        })
        .ok_or_else(|| {
            CommandError::new(
                "adapter-unsupported",
                format!("No adapter is registered for engine `{engine}`."),
            )
        })
}

#[cfg(test)]
#[path = "../../tests/unit/adapters/registry_tests.rs"]
mod tests;
