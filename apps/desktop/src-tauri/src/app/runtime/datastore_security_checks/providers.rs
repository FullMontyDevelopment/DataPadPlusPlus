#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DeepProbeKind {
    None,
    Postgres,
    MySql,
    SqlServer,
    MongoDb,
    Redis,
    Sqlite,
    DuckDb,
    Search,
}

pub(super) struct SecurityCheckProvider {
    pub engines: &'static [&'static str],
    pub version_query: Option<(&'static str, &'static str)>,
    pub product: Option<(&'static str, &'static str, &'static str)>,
    pub deep_probe: DeepProbeKind,
    pub version_not_applicable: bool,
}

macro_rules! provider {
    ($engines:expr, $query:expr, $product:expr, $probe:ident, $na:expr) => {
        SecurityCheckProvider { engines: $engines, version_query: $query, product: $product, deep_probe: DeepProbeKind::$probe, version_not_applicable: $na }
    };
}

pub(super) static SECURITY_CHECK_PROVIDERS: &[SecurityCheckProvider] = &[
    provider!(&["postgresql"], Some(("sql", "select version() as version")), Some(("PostgreSQL", "postgresql", "postgresql")), Postgres, false),
    provider!(&["cockroachdb", "cockroach"], Some(("sql", "select version() as version")), Some(("CockroachDB", "cockroachlabs", "cockroachdb")), Postgres, false),
    provider!(&["sqlserver", "mssql"], Some(("sql", "select cast(serverproperty('ProductVersion') as nvarchar(128)) as version")), Some(("Microsoft SQL Server", "microsoft", "sql_server")), SqlServer, false),
    provider!(&["mysql"], Some(("sql", "select version() as version")), Some(("MySQL", "oracle", "mysql")), MySql, false),
    provider!(&["mariadb"], Some(("sql", "select version() as version")), Some(("MariaDB", "mariadb", "mariadb")), MySql, false),
    provider!(&["sqlite"], Some(("sql", "select sqlite_version() as version")), Some(("SQLite", "sqlite", "sqlite")), Sqlite, false),
    provider!(&["oracle"], None, None, None, false),
    provider!(&["mongodb"], Some(("json", r#"{"operation":"runCommand","database":"admin","command":{"buildInfo":1}}"#)), Some(("MongoDB", "mongodb", "mongodb")), MongoDb, false),
    provider!(&["dynamodb"], None, None, None, true),
    provider!(&["cassandra"], Some(("cql", "select release_version from system.local")), Some(("Apache Cassandra", "apache", "cassandra")), None, false),
    provider!(&["cosmosdb"], None, None, None, true),
    provider!(&["litedb"], None, Some(("LiteDB", "litedb", "litedb")), None, false),
    provider!(&["redis"], Some(("text", "INFO server")), Some(("Redis", "redis", "redis")), Redis, false),
    provider!(&["valkey"], Some(("text", "INFO server")), Some(("Valkey", "valkey", "valkey")), Redis, false),
    provider!(&["memcached"], Some(("text", "version")), Some(("Memcached", "memcached", "memcached")), None, false),
    provider!(&["neo4j"], Some(("cypher", "CALL dbms.components() YIELD versions RETURN versions")), Some(("Neo4j", "neo4j", "neo4j")), None, false),
    provider!(&["neptune"], None, None, None, true),
    provider!(&["arango", "arangodb"], None, Some(("ArangoDB", "arangodb", "arangodb")), None, false),
    provider!(&["janusgraph"], None, None, None, true),
    provider!(&["influxdb"], None, Some(("InfluxDB", "influxdata", "influxdb")), None, false),
    provider!(&["timescaledb"], Some(("sql", "select version() as version")), Some(("TimescaleDB", "timescale", "timescaledb")), Postgres, false),
    provider!(&["prometheus"], None, None, None, true),
    provider!(&["opentsdb"], None, None, None, true),
    provider!(&["elasticsearch"], None, Some(("Elasticsearch", "elastic", "elasticsearch")), Search, false),
    provider!(&["opensearch"], None, Some(("OpenSearch", "opensearch", "opensearch")), Search, false),
    provider!(&["clickhouse"], Some(("sql", "select version() as version")), Some(("ClickHouse", "clickhouse", "clickhouse")), None, false),
    provider!(&["duckdb"], Some(("sql", "select version() as version")), Some(("DuckDB", "duckdb", "duckdb")), DuckDb, false),
    provider!(&["snowflake"], None, None, None, true),
    provider!(&["bigquery"], None, None, None, true),
];

pub(super) fn security_check_provider(engine: &str) -> Option<&'static SecurityCheckProvider> {
    SECURITY_CHECK_PROVIDERS
        .iter()
        .find(|provider| provider.engines.contains(&engine))
}

#[cfg(test)]
pub(super) fn security_provider_registration_count(engine: &str) -> usize {
    SECURITY_CHECK_PROVIDERS
        .iter()
        .filter(|provider| provider.engines.contains(&engine))
        .count()
}
