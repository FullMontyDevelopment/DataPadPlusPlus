import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function clickHouseWarehousePayload(connection: ConnectionProfile) {
  if (connection.engine !== 'clickhouse') {
    return {}
  }

  return {
    engine: 'clickhouse',
    readRows: '12.4 M',
    readBytes: '1.8 GB',
    memoryUsage: '512 MB',
    activeParts: 12,
    compressedBytes: 884736000,
    queryLog: clickHouseQueryLog(),
    parts: clickHouseParts(),
    partitions: clickHousePartitions(),
    clusters: clickHouseClusters(),
    replicas: clickHouseReplicas(),
    merges: clickHouseMerges(),
    mutations: clickHouseMutations(),
    settings: clickHouseSettings(),
  }
}

function clickHouseQueryLog() {
  return [
    { queryId: 'ch-query-1001', type: 'QueryFinish', duration: '1.8 s', readRows: 12400000, readBytes: 1840000000, memoryUsage: 536870912 },
    { queryId: 'ch-query-1002', type: 'QueryFinish', duration: '240 ms', readRows: 84000, readBytes: 44000000, memoryUsage: 67108864 },
    { queryId: 'ch-query-1003', type: 'Exception', duration: '480 ms', readRows: 0, readBytes: 0, memoryUsage: 1048576 },
  ]
}

function clickHouseParts() {
  return [
    { name: '202605_1_12_2', partition: '202605', active: true, rows: 6200000, compressedBytes: 442368000, marks: 756 },
    { name: '202604_1_10_1', partition: '202604', active: true, rows: 6100000, compressedBytes: 425984000, marks: 742 },
    { name: '202603_1_4_1', partition: '202603', active: false, rows: 120000, compressedBytes: 16384000, marks: 24 },
  ]
}

function clickHousePartitions() {
  return [
    { partition: '202605', parts: 4, rows: 6200000, bytes: 442368000, minDate: '2026-05-01', maxDate: '2026-05-28' },
    { partition: '202604', parts: 6, rows: 6100000, bytes: 425984000, minDate: '2026-04-01', maxDate: '2026-04-30' },
  ]
}

function clickHouseClusters() {
  return [
    { cluster: 'default-cluster', shard: 1, replica: 1, host: 'ch-01', port: 9000, health: 'healthy' },
    { cluster: 'default-cluster', shard: 1, replica: 2, host: 'ch-02', port: 9000, health: 'healthy' },
    { cluster: 'default-cluster', shard: 2, replica: 1, host: 'ch-03', port: 9000, health: 'healthy' },
  ]
}

function clickHouseReplicas() {
  return [
    { database: 'default', table: 'orders', replica: 'ch-01', status: 'healthy', queueSize: 0, absoluteDelay: '0 s' },
    { database: 'default', table: 'orders', replica: 'ch-02', status: 'lagging', queueSize: 3, absoluteDelay: '14 s' },
  ]
}

function clickHouseMerges() {
  return [
    { database: 'default', table: 'orders', partition: '202605', progress: '42%', elapsed: '8 s' },
  ]
}

function clickHouseMutations() {
  return [
    { mutationId: 'mutation_12', table: 'orders', command: 'DELETE WHERE is_test = 1', status: 'running', partsToDo: 2 },
  ]
}

function clickHouseSettings() {
  return [
    { name: 'max_memory_usage', value: '10GiB', scope: 'session' },
    { name: 'max_threads', value: 8, scope: 'session' },
    { name: 'max_execution_time', value: 0, scope: 'session' },
  ]
}
