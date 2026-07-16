use super::*;

pub(super) fn reference(label: &str, url: &str, source: &str) -> DatastoreSecurityFindingReference {
    DatastoreSecurityFindingReference {
        label: label.into(),
        url: url.into(),
        source: Some(source.into()),
    }
}

pub(super) fn postgres_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "PostgreSQL Client Authentication",
        "https://www.postgresql.org/docs/current/auth-pg-hba-conf.html",
        "postgresql",
    )]
}

pub(super) fn mongodb_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "MongoDB Security Checklist",
        "https://www.mongodb.com/docs/manual/administration/security-checklist/",
        "mongodb",
    )]
}

pub(super) fn redis_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "Redis Security",
        "https://redis.io/docs/latest/operate/oss_and_stack/management/security/",
        "redis",
    )]
}

pub(super) fn sqlserver_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "SQL Server Security Best Practices",
        "https://learn.microsoft.com/en-us/sql/relational-databases/security/sql-server-security-best-practices",
        "microsoft",
    )]
}

pub(super) fn search_security_references(engine: &str) -> Vec<DatastoreSecurityFindingReference> {
    if engine == "opensearch" {
        vec![reference(
            "OpenSearch Security Best Practices",
            "https://docs.opensearch.org/latest/security/configuration/best-practices/",
            "opensearch",
        )]
    } else {
        vec![reference(
            "Elasticsearch Security",
            "https://www.elastic.co/guide/en/elasticsearch/reference/current/secure-cluster.html",
            "elastic",
        )]
    }
}

pub(super) fn duckdb_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "DuckDB Securing Extensions",
        "https://duckdb.org/docs/lts/operations_manual/securing_duckdb/securing_extensions.html",
        "duckdb",
    )]
}

pub(super) fn sqlite_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "SQLite PRAGMA Reference",
        "https://sqlite.org/pragma.html",
        "sqlite",
    )]
}

pub(super) fn prometheus_security_reference() -> DatastoreSecurityFindingReference {
    reference(
        "Prometheus Security Model",
        "https://prometheus.io/docs/operating/security/",
        "prometheus",
    )
}

pub(super) fn memcached_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "Memcached TLS Support",
        "https://docs.memcached.org/features/tls/",
        "memcached",
    )]
}

pub(super) fn cassandra_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "Apache Cassandra Security",
        "https://cassandra.apache.org/doc/4.1/cassandra/operating/security.html",
        "apache",
    )]
}

pub(super) fn cosmos_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "Azure Cosmos DB Security",
        "https://learn.microsoft.com/en-us/azure/cosmos-db/security",
        "microsoft",
    )]
}

pub(super) fn dynamodb_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "DynamoDB Security Best Practices",
        "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices-security.html",
        "aws",
    )]
}

pub(super) fn oracle_security_references() -> Vec<DatastoreSecurityFindingReference> {
    vec![reference(
        "Oracle Database Security",
        "https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/keeping-your-oracle-database-secure.html",
        "oracle",
    )]
}

pub(super) fn time_series_security_references(
    engine: &str,
) -> Vec<DatastoreSecurityFindingReference> {
    if engine == "prometheus" {
        vec![prometheus_security_reference()]
    } else if engine == "influxdb" {
        vec![reference(
            "InfluxDB Security",
            "https://docs.influxdata.com/influxdb/v2/admin/security/",
            "influxdata",
        )]
    } else {
        vec![prometheus_security_reference()]
    }
}

pub(super) fn graph_security_references(engine: &str) -> Vec<DatastoreSecurityFindingReference> {
    if engine == "neo4j" {
        vec![reference(
            "Neo4j Security Settings",
            "https://neo4j.com/docs/operations-manual/current/configuration/configuration-settings/",
            "neo4j",
        )]
    } else {
        Vec::new()
    }
}

pub(super) fn warehouse_security_references(
    engine: &str,
) -> Vec<DatastoreSecurityFindingReference> {
    match engine {
        "snowflake" => vec![reference(
            "Snowflake Network Policies",
            "https://docs.snowflake.com/en/user-guide/network-policies",
            "snowflake",
        )],
        "bigquery" => vec![reference(
            "BigQuery Security",
            "https://cloud.google.com/bigquery/docs/best-practices-security",
            "google-cloud",
        )],
        "clickhouse" => vec![reference(
            "ClickHouse Access Control",
            "https://clickhouse.com/docs/operations/access-rights",
            "clickhouse",
        )],
        _ => Vec::new(),
    }
}
