use super::*;

mod cassandra;
mod cockroach;
mod cosmos;
mod dynamodb;
mod embedded;
mod generic;
mod graph;
mod keyvalue;
mod litedb;
mod mongodb;
mod mysql;
mod oracle;
mod postgres;
mod search;
mod sqlserver;
mod timeseries;
mod warehouse;

use cassandra::*;
use cockroach::*;
use cosmos::*;
use dynamodb::*;
use embedded::*;
use generic::*;
use graph::*;
use keyvalue::*;
use litedb::*;
use mongodb::*;
use mysql::*;
use oracle::*;
use postgres::*;
use search::*;
use sqlserver::*;
use timeseries::*;
use warehouse::*;

pub(super) fn tree_roots(engine: &str, family: &str) -> Vec<DatastoreTreeNodeManifest> {
    match engine {
        "mongodb" => mongo_tree(),
        "redis" | "valkey" => redis_tree(engine),
        "memcached" => memcached_tree(),
        "sqlserver" => sqlserver_tree(),
        "sqlite" => sqlite_tree(),
        "duckdb" => embedded_sql_tree(engine),
        "mysql" | "mariadb" => mysql_tree(engine),
        "oracle" => oracle_tree(),
        "cockroachdb" => cockroach_tree(),
        "postgresql" | "timescaledb" => postgres_family_tree(engine),
        "elasticsearch" | "opensearch" => search_tree(),
        "dynamodb" => dynamodb_tree(),
        "cassandra" => cassandra_tree(),
        "prometheus" => prometheus_tree(),
        "influxdb" => influx_tree(),
        "opentsdb" => open_tsdb_tree(),
        "neo4j" | "neptune" | "arango" | "janusgraph" => graph_tree(engine),
        "bigquery" => bigquery_tree(),
        "snowflake" | "clickhouse" => warehouse_tree(engine),
        "cosmosdb" => cosmos_tree(),
        "litedb" => litedb_tree(),
        _ => generic_tree(family),
    }
}
