export const declaredDatastoreEngines = [
  'postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite', 'oracle',
  'mongodb', 'dynamodb', 'cassandra', 'cosmosdb', 'litedb', 'redis', 'valkey',
  'memcached', 'neo4j', 'neptune', 'arango', 'janusgraph', 'influxdb', 'timescaledb',
  'prometheus', 'opentsdb', 'elasticsearch', 'opensearch', 'clickhouse', 'duckdb',
  'snowflake', 'bigquery',
] as const

export type DatastoreEngineId = (typeof declaredDatastoreEngines)[number]
