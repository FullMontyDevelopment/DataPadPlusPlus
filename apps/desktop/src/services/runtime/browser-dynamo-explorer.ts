import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

export function createDynamoExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      dynamoNode(connection, 'dynamodb:tables', 'Tables', 'tables', 'DynamoDB tables and item counts', 'dynamodb:tables', [], true),
      dynamoNode(connection, 'dynamodb:security', 'Access', 'security', 'IAM-style access and table policies', 'dynamodb:security', [], true),
      dynamoNode(connection, 'dynamodb:diagnostics', 'Diagnostics', 'diagnostics', 'Capacity, throttles, hot partitions, and alarms', 'dynamodb:diagnostics', [], true),
    ]
  }

  if (scope === 'dynamodb:tables') {
    return dynamoTables().map((table) =>
      dynamoNode(
        connection,
        `table:${table.name}`,
        table.name,
        'table',
        `${table.status} / ${table.billingMode} / ${table.items.toLocaleString()} items`,
        `table:${table.name}`,
        ['Tables'],
        true,
        dynamoQueryTemplate(table.name),
      ),
    )
  }

  if (scope.startsWith('table:')) {
    const table = scope.replace('table:', '') || 'Orders'
    return [
      dynamoNode(connection, `items:${table}`, 'Items', 'items', 'Partition-key query and bounded scan', undefined, ['Tables', table], false, dynamoQueryTemplate(table)),
      dynamoNode(connection, `keys:${table}`, 'Keys', 'keys', 'Partition and sort key schema', undefined, ['Tables', table]),
      dynamoNode(connection, `gsi:${table}`, 'Global Secondary Indexes', 'global-secondary-indexes', 'GSIs and projected attributes', undefined, ['Tables', table]),
      dynamoNode(connection, `lsi:${table}`, 'Local Secondary Indexes', 'local-secondary-indexes', 'LSIs and alternate sort keys', undefined, ['Tables', table]),
      dynamoNode(connection, `streams:${table}`, 'Streams', 'streams', 'Stream status and view type', undefined, ['Tables', table]),
      dynamoNode(connection, `ttl:${table}`, 'TTL', 'ttl', 'Time-to-live attribute and status', undefined, ['Tables', table]),
      dynamoNode(connection, `capacity:${table}`, 'Capacity', 'capacity', 'Consumed capacity and throttles', undefined, ['Tables', table]),
      dynamoNode(connection, `permissions:${table}`, 'Permissions', 'permissions', 'Visible table and index permissions', undefined, ['Tables', table]),
    ]
  }

  if (scope === 'dynamodb:security') {
    return [
      dynamoNode(connection, 'dynamodb:security:permissions', 'Permissions', 'permissions', 'Visible table, stream, and index privileges', undefined, ['Access']),
      dynamoNode(connection, 'dynamodb:security:policies', 'Table Policies', 'security', 'Resource policies and disabled action reasons', undefined, ['Access']),
    ]
  }

  if (scope === 'dynamodb:diagnostics') {
    return [
      dynamoNode(connection, 'dynamodb:diagnostics:capacity', 'Capacity', 'capacity', 'Read/write usage, throttles, and latency', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:hot-partitions', 'Hot Partitions', 'hot-partitions', 'High-traffic partition keys', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:alarms', 'Alarms', 'alarms', 'Capacity, latency, and stream alarms', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:backups', 'Backups', 'backups', 'PITR and on-demand backups', undefined, ['Diagnostics']),
    ]
  }

  return []
}

export function dynamoInspectQueryTemplate(nodeId: string) {
  const tableName = dynamoTableNameFromNodeId(nodeId)

  if (tableName) {
    return dynamoQueryTemplate(tableName)
  }

  return JSON.stringify({ operation: 'ListTables', limit: 20 }, null, 2)
}

export function dynamoInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const region = dynamoRegion(connection)

  if (nodeId === 'dynamodb:tables') {
    return {
      engine: 'dynamodb',
      region,
      objectView: 'tables',
      tables: dynamoTables(),
    }
  }

  if (nodeId.startsWith('table:')) {
    return dynamoTablePayload(connection, nodeId.replace('table:', '') || 'Orders', 'table')
  }

  if (nodeId.startsWith('items:')) {
    return dynamoTablePayload(connection, nodeId.replace('items:', '') || 'Orders', 'items')
  }

  if (nodeId.startsWith('keys:')) {
    return dynamoTablePayload(connection, nodeId.replace('keys:', '') || 'Orders', 'keys')
  }

  if (nodeId.startsWith('gsi:')) {
    return dynamoTablePayload(connection, nodeId.replace('gsi:', '') || 'Orders', 'global-secondary-indexes')
  }

  if (nodeId.startsWith('lsi:')) {
    return dynamoTablePayload(connection, nodeId.replace('lsi:', '') || 'Orders', 'local-secondary-indexes')
  }

  if (nodeId.startsWith('streams:')) {
    return dynamoTablePayload(connection, nodeId.replace('streams:', '') || 'Orders', 'streams')
  }

  if (nodeId.startsWith('ttl:')) {
    return dynamoTablePayload(connection, nodeId.replace('ttl:', '') || 'Orders', 'ttl')
  }

  if (nodeId.startsWith('capacity:')) {
    return dynamoTablePayload(connection, nodeId.replace('capacity:', '') || 'Orders', 'capacity')
  }

  if (nodeId.startsWith('permissions:')) {
    return dynamoTablePayload(connection, nodeId.replace('permissions:', '') || 'Orders', 'permissions')
  }

  if (nodeId.startsWith('dynamodb:security')) {
    return {
      engine: 'dynamodb',
      region,
      objectView: nodeId.endsWith(':permissions') ? 'permissions' : 'security',
      permissions: dynamoPermissions(),
      warnings: nodeId.endsWith(':policies')
        ? ['Resource policy preview is deterministic in browser mode; live policy inspection depends on IAM permissions.']
        : [],
    }
  }

  if (nodeId.startsWith('dynamodb:diagnostics')) {
    return dynamoDiagnosticsPayload(connection, nodeId)
  }

  return {
    engine: 'dynamodb',
    region,
    objectView: 'tables',
    tables: dynamoTables(),
  }
}

function dynamoNode(
  _connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'widecolumn',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

function dynamoTablePayload(connection: ConnectionProfile, tableName: string, objectView: string) {
  const table = dynamoTables().find((candidate) => candidate.name === tableName) ?? dynamoTables()[0]!
  const payload = {
    engine: 'dynamodb',
    region: dynamoRegion(connection),
    objectView,
    tableName: table.name,
    objectName: table.name,
    status: table.status,
    billingMode: table.billingMode,
    itemCount: table.items,
    storage: table.storage,
    readCapacity: table.readCapacity,
    writeCapacity: table.writeCapacity,
    tables: [table],
    items: dynamoItems(table.name),
    keys: dynamoKeys(table.name),
    globalSecondaryIndexes: dynamoGlobalSecondaryIndexes(table.name),
    localSecondaryIndexes: dynamoLocalSecondaryIndexes(table.name),
    streams: dynamoStreams(table.name),
    ttl: dynamoTtl(table.name),
    capacity: dynamoCapacity(table.name),
    hotPartitions: dynamoHotPartitions(table.name),
    alarms: dynamoAlarms(table.name),
    backups: dynamoBackups(table.name),
    permissions: dynamoPermissions().filter((permission) => permission.resource.includes(table.name) || permission.resource === '*'),
  }

  if (objectView === 'items') {
    return { ...payload, tables: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'keys') {
    return { ...payload, tables: [], items: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'global-secondary-indexes') {
    return { ...payload, tables: [], items: [], keys: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'local-secondary-indexes') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'streams') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'ttl') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'capacity') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'permissions') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [] }
  }

  return payload
}

function dynamoDiagnosticsPayload(connection: ConnectionProfile, nodeId: string) {
  const region = dynamoRegion(connection)
  const base = {
    engine: 'dynamodb',
    region,
    objectView: 'diagnostics',
    capacity: dynamoTables().flatMap((table) => dynamoCapacity(table.name)),
    hotPartitions: dynamoTables().flatMap((table) => dynamoHotPartitions(table.name)),
    alarms: dynamoTables().flatMap((table) => dynamoAlarms(table.name)),
    backups: dynamoTables().flatMap((table) => dynamoBackups(table.name)),
    streams: dynamoTables().flatMap((table) => dynamoStreams(table.name)),
  }

  if (nodeId.endsWith(':capacity')) {
    return { ...base, objectView: 'capacity', hotPartitions: [], alarms: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':hot-partitions')) {
    return { ...base, objectView: 'hot-partitions', capacity: [], alarms: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':alarms')) {
    return { ...base, objectView: 'alarms', capacity: [], hotPartitions: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':backups')) {
    return { ...base, objectView: 'backups', capacity: [], hotPartitions: [], alarms: [], streams: [] }
  }

  return base
}

function dynamoQueryTemplate(tableName: string) {
  return JSON.stringify({
    operation: 'Query',
    tableName,
    keyConditionExpression: '#pk = :pk',
    expressionAttributeNames: { '#pk': 'pk' },
    expressionAttributeValues: { ':pk': { S: 'CUSTOMER#123' } },
    limit: 20,
  }, null, 2)
}

function dynamoTableNameFromNodeId(nodeId: string) {
  if (nodeId.startsWith('table:')) {
    return nodeId.replace('table:', '')
  }

  if (/^(items|keys|gsi|lsi|streams|ttl|capacity|permissions):/.test(nodeId)) {
    return nodeId.split(':')[1]
  }

  return undefined
}

function dynamoRegion(connection: ConnectionProfile) {
  return connection.database || 'local'
}

function dynamoTables() {
  return [
    { name: 'Orders', status: 'ACTIVE', billingMode: 'PAY_PER_REQUEST', items: 482000, storage: '1.4 GB', partitionKey: 'pk', sortKey: 'sk', readCapacity: 'on-demand', writeCapacity: 'on-demand' },
    { name: 'Products', status: 'ACTIVE', billingMode: 'PROVISIONED', items: 100000, storage: '420 MB', partitionKey: 'sku', sortKey: '-', readCapacity: 120, writeCapacity: 40 },
  ]
}

function dynamoItems(tableName: string) {
  return tableName === 'Products'
    ? [
        { partitionKey: 'SKU#luna-lamp', sortKey: 'PROFILE', status: 'active', total: 18, updatedAt: '2026-05-21T11:29:08Z' },
        { partitionKey: 'SKU#aurora-desk', sortKey: 'PROFILE', status: 'active', total: 8, updatedAt: '2026-05-21T11:29:08Z' },
      ]
    : [
        { partitionKey: 'CUSTOMER#123', sortKey: 'ORDER#2026-0001', status: 'paid', total: 49.99, updatedAt: '2026-05-20T09:12:00Z' },
        { partitionKey: 'CUSTOMER#123', sortKey: 'ORDER#2026-0002', status: 'processing', total: 129.5, updatedAt: '2026-05-21T10:00:00Z' },
      ]
}

function dynamoKeys(tableName: string) {
  return tableName === 'Products'
    ? [
        { attribute: 'sku', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
      ]
    : [
        { attribute: 'pk', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
        { attribute: 'sk', type: 'RANGE', keyRole: 'sort', attributeType: 'S' },
      ]
}

function dynamoGlobalSecondaryIndexes(tableName: string) {
  return tableName === 'Products'
    ? [
        { name: 'category-updatedAt-index', partitionKey: 'category', sortKey: 'updatedAt', projection: 'ALL', status: 'ACTIVE', items: 100000, capacity: 'shared provisioned' },
      ]
    : [
        { name: 'customer-status-index', partitionKey: 'customerId', sortKey: 'status', projection: 'INCLUDE total, updatedAt', status: 'ACTIVE', items: 482000, capacity: 'on-demand' },
      ]
}

function dynamoLocalSecondaryIndexes(tableName: string) {
  return tableName === 'Orders'
    ? [{ name: 'createdAt-lsi', sortKey: 'createdAt', projection: 'KEYS_ONLY', items: 482000, storage: '94 MB' }]
    : []
}

function dynamoStreams(tableName: string) {
  return [
    { status: tableName === 'Orders' ? 'ENABLED' : 'DISABLED', viewType: tableName === 'Orders' ? 'NEW_AND_OLD_IMAGES' : '-', arn: tableName === 'Orders' ? `arn:aws:dynamodb:local:000000000000:table/${tableName}/stream/2026-05-20T00:00:00.000` : '-', shards: tableName === 'Orders' ? 4 : 0, consumers: tableName === 'Orders' ? 1 : 0 },
  ]
}

function dynamoTtl(tableName: string) {
  return [
    { attribute: tableName === 'Orders' ? 'expiresAt' : '-', status: tableName === 'Orders' ? 'ENABLED' : 'DISABLED', sampleExpiringItems: tableName === 'Orders' ? 1240 : 0, oldestExpiry: tableName === 'Orders' ? '2026-05-24T00:00:00Z' : '-' },
  ]
}

function dynamoCapacity(tableName: string) {
  return [
    { resource: tableName, readUnits: tableName === 'Orders' ? 84 : 22, writeUnits: tableName === 'Orders' ? 31 : 6, readThrottleEvents: tableName === 'Orders' ? 2 : 0, writeThrottleEvents: 0, latencyP95: tableName === 'Orders' ? '12 ms' : '7 ms' },
    ...dynamoGlobalSecondaryIndexes(tableName).map((index) => ({ resource: `${tableName}/${index.name}`, readUnits: 18, writeUnits: 4, readThrottleEvents: 0, writeThrottleEvents: 0, latencyP95: '8 ms' })),
  ]
}

function dynamoHotPartitions(tableName: string) {
  return [
    { partitionKey: tableName === 'Orders' ? 'CUSTOMER#123' : 'CATEGORY#lighting', readPercent: tableName === 'Orders' ? '18%' : '11%', writePercent: tableName === 'Orders' ? '9%' : '4%', throttles: tableName === 'Orders' ? 2 : 0, recommendation: tableName === 'Orders' ? 'Review access pattern or add write sharding if sustained.' : 'Healthy.' },
  ]
}

function dynamoAlarms(tableName: string) {
  return [
    { name: `${tableName}-read-throttle`, state: tableName === 'Orders' ? 'ALARM' : 'OK', metric: 'ReadThrottleEvents', threshold: '> 0 for 5m', updatedAt: '2026-05-21T09:00:00Z' },
    { name: `${tableName}-latency-p95`, state: 'OK', metric: 'SuccessfulRequestLatency', threshold: '> 100ms p95', updatedAt: '2026-05-21T09:00:00Z' },
  ]
}

function dynamoBackups(tableName: string) {
  return [
    { name: `${tableName}-daily`, type: 'PITR', status: 'ENABLED', createdAt: 'continuous', size: tableName === 'Orders' ? '1.4 GB' : '420 MB' },
  ]
}

function dynamoPermissions() {
  return [
    { principal: 'app-writer', action: 'dynamodb:GetItem, Query, PutItem, UpdateItem', resource: 'Orders', effect: 'Allow', condition: 'environment = qa' },
    { principal: 'reporting-role', action: 'dynamodb:Query', resource: 'Products', effect: 'Allow', condition: '-' },
    { principal: 'admin-preview', action: 'dynamodb:*', resource: '*', effect: 'Deny in safe mode', condition: 'requires confirmation' },
  ]
}
