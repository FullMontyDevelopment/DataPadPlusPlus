import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function cloudWarehousePayload(connection: ConnectionProfile) {
  if (connection.engine === 'snowflake') {
    return snowflakePayload()
  }

  if (connection.engine === 'bigquery') {
    return bigQueryPayload()
  }

  return {}
}

function snowflakePayload() {
  return {
    creditsConsumed: '0.42',
    queued: 1,
    running: 4,
    queryHistory: [
      { queryId: 'sf-query-1001', warehouse: 'ANALYTICS_XS', status: 'succeeded', duration: '1.8 s', bytesScanned: '128 MB', credits: '0.04' },
      { queryId: 'sf-query-1002', warehouse: 'LOAD_WH', status: 'succeeded', duration: '12 s', bytesScanned: '3.4 GB', credits: '0.31' },
      { queryId: 'sf-query-1003', warehouse: 'ANALYTICS_XS', status: 'failed', duration: '480 ms', bytesScanned: '0 B', credits: '0.00' },
    ],
    warehouseLoad: [
      { warehouse: 'ANALYTICS_XS', state: 'running', queued: 1, running: 4, credits: '0.24', load: '42%' },
      { warehouse: 'LOAD_WH', state: 'suspended', queued: 0, running: 0, credits: '0.00', load: '0%' },
    ],
    credits: [
      { warehouse: 'ANALYTICS_XS', window: 'last hour', credits: '0.24', queries: 18 },
      { warehouse: 'LOAD_WH', window: 'last hour', credits: '0.18', queries: 3 },
    ],
    streams: [
      { name: 'orders_stream', table: 'orders', stale: 'no', mode: 'append_only' },
      { name: 'accounts_stream', table: 'accounts', stale: 'no', mode: 'standard' },
    ],
    shares: [
      { name: 'ANALYTICS_SHARE', kind: 'outbound', objects: 4, status: 'active' },
    ],
  }
}

function bigQueryPayload() {
  return {
    totalBytesProcessed: '1.2 TB',
    totalSlotMs: '84.2 K',
    estimatedCost: '$6.00',
    jobTimeline: [
      { jobId: 'bq-job-1001', state: 'DONE', duration: '1.8 s', bytesProcessed: '128 MB', slotMs: 1800 },
      { jobId: 'bq-job-1002', state: 'DONE', duration: '12 s', bytesProcessed: '3.4 GB', slotMs: 14800 },
      { jobId: 'bq-job-1003', state: 'FAILED', duration: '480 ms', bytesProcessed: '0 B', slotMs: 120 },
    ],
    reservations: [
      { name: 'default-reservation', slots: 500, assignedProjects: 2, idleSlots: 120, autoscale: 'enabled' },
      { name: 'etl-reservation', slots: 250, assignedProjects: 1, idleSlots: 40, autoscale: 'disabled' },
    ],
    slotUsage: [
      { reservation: 'default-reservation', window: 'last 15 min', slotMs: 58200, utilization: '76%' },
      { reservation: 'etl-reservation', window: 'last 15 min', slotMs: 26000, utilization: '54%' },
    ],
    scheduledQueries: [
      { name: 'refresh_daily_revenue', schedule: 'every 1 hours', state: 'enabled', lastRun: '18 min ago' },
      { name: 'sync_product_catalog', schedule: 'every 24 hours', state: 'enabled', lastRun: '4 h ago' },
    ],
    tableStorage: [
      { table: 'orders', bytes: '88 GB', longTermBytes: '12 GB', partitions: 420, clustering: 'customer_id, sku' },
      { table: 'accounts', bytes: '640 MB', longTermBytes: '0 B', partitions: 1, clustering: 'region' },
    ],
    iamBindings: [
      { principal: 'group:analytics@example.com', role: 'roles/bigquery.dataViewer', resource: 'analytics', status: 'active' },
      { principal: 'serviceAccount:loader@example.com', role: 'roles/bigquery.jobUser', resource: 'project', status: 'active' },
    ],
  }
}
