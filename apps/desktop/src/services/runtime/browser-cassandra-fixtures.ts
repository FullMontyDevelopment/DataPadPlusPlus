export function cassandraTables() {
  return [
    { name: 'orders_by_customer', partitionKey: 'customer_id', clusteringKey: 'order_day, order_id', rows: 125000, partitions: 8400, sstables: 12, indexes: 1, p95ReadMs: 6, tombstoneWarnings: 0, readPath: 'single partition' },
    { name: 'products_by_sku', partitionKey: 'sku', clusteringKey: '-', rows: 100000, partitions: 100000, sstables: 8, indexes: 1, p95ReadMs: 4, tombstoneWarnings: 1, readPath: 'point lookup' },
  ]
}

export function cassandraColumns(tableName: string) {
  return tableName === 'products_by_sku'
    ? [
        { name: 'sku', role: 'partition key', type: 'text', clusteringOrder: '-' },
        { name: 'name', role: 'regular', type: 'text', clusteringOrder: '-' },
        { name: 'inventory', role: 'regular', type: 'map<text,int>', clusteringOrder: '-' },
        { name: 'updated_at', role: 'regular', type: 'timestamp', clusteringOrder: '-' },
      ]
    : [
        { name: 'customer_id', role: 'partition key', type: 'uuid', clusteringOrder: '-' },
        { name: 'order_day', role: 'clustering', type: 'date', clusteringOrder: 'DESC' },
        { name: 'order_id', role: 'clustering', type: 'timeuuid', clusteringOrder: 'DESC' },
        { name: 'status', role: 'regular', type: 'text', clusteringOrder: '-' },
        { name: 'total', role: 'regular', type: 'decimal', clusteringOrder: '-' },
      ]
}

export function cassandraPrimaryKey(tableName: string) {
  return cassandraColumns(tableName)
    .filter((column) => column.role.includes('key') || column.role === 'clustering')
    .map((column, index) => ({ role: column.role, name: column.name, position: index + 1, type: column.type }))
}

export function cassandraIndexes() {
  return [
    { name: 'orders_status_sai', table: 'orders_by_customer', kind: 'SAI', target: 'status', options: 'case_sensitive=false' },
    { name: 'products_name_idx', table: 'products_by_sku', kind: 'secondary', target: 'name', options: 'default analyzer' },
  ]
}

export function cassandraTableOptions(tableName: string) {
  return [
    { option: 'compaction', value: tableName === 'orders_by_customer' ? 'TimeWindowCompactionStrategy' : 'SizeTieredCompactionStrategy', guidance: 'Match compaction to write/read and TTL patterns.' },
    { option: 'compression', value: 'LZ4Compressor', guidance: 'Default lightweight block compression.' },
    { option: 'bloom_filter_fp_chance', value: 0.01, guidance: 'Lower values use more memory and reduce false positives.' },
    { option: 'gc_grace_seconds', value: 864000, guidance: 'Review before lowering in replicated clusters.' },
  ]
}

export function cassandraTableDiagnostics(tableName: string) {
  return [
    { signal: 'Read latency p95', value: tableName === 'orders_by_customer' ? '6 ms' : '4 ms', status: 'Healthy', guidance: 'Bounded partition reads look healthy.' },
    { signal: 'Estimated partition size', value: tableName === 'orders_by_customer' ? '14 KB' : '2 KB', status: 'Healthy', guidance: 'No oversized partition warning in preview.' },
    { signal: 'Tombstones per read', value: tableName === 'products_by_sku' ? 120 : 4, status: tableName === 'products_by_sku' ? 'Watch' : 'Healthy', guidance: 'High tombstone reads can slow queries.' },
  ]
}

export function cassandraPermissions(keyspace: string) {
  return [
    { role: 'app_reader', resource: `keyspace/${keyspace}`, permission: 'SELECT' },
    { role: 'app_writer', resource: `keyspace/${keyspace}/orders_by_customer`, permission: 'SELECT, MODIFY' },
    { role: 'admin_preview', resource: `keyspace/${keyspace}`, permission: 'ALTER requires confirmation' },
  ]
}

export function cassandraPartitionKeyForTable(tableName: string) {
  return tableName === 'products_by_sku' ? 'sku' : 'customer_id'
}
