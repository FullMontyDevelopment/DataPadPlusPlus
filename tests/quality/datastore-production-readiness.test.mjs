import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const files = {
  connection: 'packages/shared-types/src/connection.ts',
  completeness: 'packages/shared-types/src/datastore-completeness.ts',
  roadmap: 'packages/shared-types/src/datastore-roadmap.ts',
  treeManifest: 'packages/shared-types/src/datastore-tree-manifests.ts',
  rustTreeManifest: 'apps/desktop/src-tauri/src/adapters/common/tree_manifest.rs',
  rustRegistry: 'apps/desktop/src-tauri/src/adapters/registry.rs',
  rustModels: 'apps/desktop/src-tauri/src/domain/models.rs',
  rustProfiles: 'apps/desktop/src-tauri/src/app/runtime/profiles.rs',
  rustProfileOptions: 'apps/desktop/src-tauri/src/app/runtime/profile_options.rs',
  rustProfileOptionsCloud: 'apps/desktop/src-tauri/src/app/runtime/profile_options_cloud.rs',
  rustProfileOptionsGraph: 'apps/desktop/src-tauri/src/app/runtime/profile_options_graph.rs',
  rustProfileOptionsTimeseries: 'apps/desktop/src-tauri/src/app/runtime/profile_options_timeseries.rs',
  rustProfileOptionsWarehouse: 'apps/desktop/src-tauri/src/app/runtime/profile_options_warehouse.rs',
  memcachedProtocol: 'apps/desktop/src-tauri/src/adapters/datastores/memcached/protocol.rs',
  objectViewRouter: 'apps/desktop/src/app/components/workbench/ObjectViewWorkspace.tsx',
  browserExplorer: 'apps/desktop/src/services/runtime/browser-explorer.ts',
  connectionModes: 'apps/desktop/src/app/components/workbench/RightDrawer.connection-modes.tsx',
  requestValidationWorkspace: 'apps/desktop/src/services/runtime/request-validation-workspace.ts',
  treeRegistry: 'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
  fallbackTree: 'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
  queryDefaults: 'apps/desktop/src/app/state/query-defaults.ts',
  workspaceHelpers: 'apps/desktop/src/app/workspace-helpers.ts',
  browserTabs: 'apps/desktop/src/services/runtime/browser-tabs.ts',
  browserTests: 'apps/desktop/src/services/runtime/browser-tests.ts',
  testSuiteWorkspace: 'apps/desktop/src/app/components/workbench/TestSuiteWorkspace.tsx',
  browserOperationManifests: 'apps/desktop/src/services/runtime/browser-operation-manifests.ts',
  browserOperationManifestGeneric: 'apps/desktop/src/services/runtime/browser-operation-manifest-generic.ts',
  browserOperationManifestSpecialized: 'apps/desktop/src/services/runtime/browser-operation-manifest-specialized.ts',
  browserDocumentOperationManifests: 'apps/desktop/src/services/runtime/browser-document-operation-manifests.ts',
  browserDuckDbOperationManifests: 'apps/desktop/src/services/runtime/browser-duckdb-operation-manifests.ts',
  browserMemcachedOperationManifests: 'apps/desktop/src/services/runtime/browser-memcached-operation-manifests.ts',
  browserSearchOperationManifests: 'apps/desktop/src/services/runtime/browser-search-operation-manifests.ts',
  browserWaveFiveOperationManifests: 'apps/desktop/src/services/runtime/browser-wave5-operation-manifests.ts',
  browserWideColumnOperationManifests: 'apps/desktop/src/services/runtime/browser-widecolumn-operation-manifests.ts',
  browserOperations: 'apps/desktop/src/services/runtime/browser-operations.ts',
  browserDuckDbAdminOperations: 'apps/desktop/src/services/runtime/browser-duckdb-admin-operations.ts',
  browserCosmosOperations: 'apps/desktop/src/services/runtime/browser-cosmos-operations.ts',
  browserGraphOperations: 'apps/desktop/src/services/runtime/browser-graph-operations.ts',
  browserLiteDbOperations: 'apps/desktop/src/services/runtime/browser-litedb-operations.ts',
  browserMemcachedOperations: 'apps/desktop/src/services/runtime/browser-memcached-operations.ts',
  browserSearchOperations: 'apps/desktop/src/services/runtime/browser-search-operations.ts',
  browserSqlDialectOperations: 'apps/desktop/src/services/runtime/browser-sql-dialect-operations.ts',
  browserSqlOperations: 'apps/desktop/src/services/runtime/browser-sql-operations.ts',
  browserTimeSeriesOperations: 'apps/desktop/src/services/runtime/browser-timeseries-operations.ts',
  browserWarehouseOperations: 'apps/desktop/src/services/runtime/browser-warehouse-operations.ts',
  browserWideColumnOperations: 'apps/desktop/src/services/runtime/browser-widecolumn-operations.ts',
  browserOperationInspection: 'apps/desktop/src/services/runtime/browser-operation-inspection.ts',
  rustOperationManifest: 'apps/desktop/src-tauri/src/adapters/common/operations/manifest.rs',
  rustOperationPlanning: 'apps/desktop/src-tauri/src/adapters/common/operations/planning.rs',
  cassandraOperationActions: 'apps/desktop/src/app/components/workbench/CassandraObjectViewOperations.helpers.ts',
  cosmosOperationActions: 'apps/desktop/src/app/components/workbench/CosmosObjectViewOperations.helpers.ts',
  dynamoOperationActions: 'apps/desktop/src/app/components/workbench/DynamoObjectViewOperations.helpers.ts',
  graphOperationActions: 'apps/desktop/src/app/components/workbench/GraphObjectViewOperations.helpers.ts',
  liteDbOperationActions: 'apps/desktop/src/app/components/workbench/LiteDbObjectViewOperations.helpers.ts',
  memcachedOperationActions: 'apps/desktop/src/app/components/workbench/MemcachedObjectViewOperations.helpers.ts',
  searchOperationActions: 'apps/desktop/src/app/components/workbench/SearchObjectViewOperations.helpers.ts',
  timeSeriesOperationActions: 'apps/desktop/src/app/components/workbench/TimeSeriesObjectViewOperations.helpers.ts',
  warehouseOperationActions: 'apps/desktop/src/app/components/workbench/WarehouseObjectViewOperations.helpers.ts',
  cassandraObjectViewInsights: 'apps/desktop/src/app/components/workbench/CassandraObjectViewInsights.tsx',
  clickHouseObjectViewInsights: 'apps/desktop/src/app/components/workbench/ClickHouseObjectViewInsights.tsx',
  cloudWarehouseObjectViewInsights: 'apps/desktop/src/app/components/workbench/CloudWarehouseObjectViewInsights.tsx',
  cosmosObjectViewInsights: 'apps/desktop/src/app/components/workbench/CosmosObjectViewInsights.tsx',
  duckDbObjectViewInsights: 'apps/desktop/src/app/components/workbench/DuckDbObjectViewInsights.tsx',
  dynamoObjectViewInsights: 'apps/desktop/src/app/components/workbench/DynamoObjectViewInsights.tsx',
  graphObjectViewOperations: 'apps/desktop/src/app/components/workbench/GraphObjectViewOperations.helpers.ts',
  graphObjectViewWorkspace: 'apps/desktop/src/app/components/workbench/GraphObjectViewWorkspace.tsx',
  liteDbObjectViewInsights: 'apps/desktop/src/app/components/workbench/LiteDbObjectViewInsights.tsx',
  memcachedObjectViewInsights: 'apps/desktop/src/app/components/workbench/MemcachedObjectViewInsights.tsx',
  searchObjectViewInsights: 'apps/desktop/src/app/components/workbench/SearchObjectViewInsights.tsx',
  timeSeriesObjectViewInsights: 'apps/desktop/src/app/components/workbench/TimeSeriesObjectViewInsights.tsx',
  warehouseObjectViewInsights: 'apps/desktop/src/app/components/workbench/WarehouseObjectViewInsights.tsx',
}

const descriptorOwners = new Map([
  ['postgresql', 'PostgresObjectViewDescriptors.ts'],
  ['timescaledb', 'PostgresObjectViewDescriptors.ts'],
  ['cockroachdb', 'CockroachObjectViewDescriptors.ts'],
  ['sqlserver', 'SqlServerObjectViewDescriptors.ts'],
  ['sqlite', 'SqliteObjectViewDescriptors.ts'],
  ['duckdb', 'DuckDbObjectViewDescriptors.ts'],
  ['mysql', 'MysqlObjectViewDescriptors.ts'],
  ['mariadb', 'MysqlObjectViewDescriptors.ts'],
  ['oracle', 'OracleObjectViewDescriptors.ts'],
  ['mongodb', 'MongoObjectViewDescriptors.ts'],
  ['redis', 'RedisObjectViewDescriptors.ts'],
  ['valkey', 'RedisObjectViewDescriptors.ts'],
  ['memcached', 'MemcachedObjectViewDescriptors.ts'],
  ['elasticsearch', 'SearchObjectViewDescriptors.ts'],
  ['opensearch', 'SearchObjectViewDescriptors.ts'],
  ['dynamodb', 'DynamoObjectViewDescriptors.ts'],
  ['cassandra', 'CassandraObjectViewDescriptors.ts'],
  ['cosmosdb', 'CosmosObjectViewDescriptors.ts'],
  ['litedb', 'LiteDbObjectViewDescriptors.ts'],
  ['prometheus', 'PrometheusObjectViewDescriptors.ts'],
  ['influxdb', 'InfluxObjectViewDescriptors.ts'],
  ['opentsdb', 'OpenTsdbObjectViewDescriptors.ts'],
  ['neo4j', 'GraphObjectViewDescriptors.ts'],
  ['neptune', 'GraphObjectViewDescriptors.ts'],
  ['arango', 'GraphObjectViewDescriptors.ts'],
  ['janusgraph', 'GraphObjectViewDescriptors.ts'],
  ['clickhouse', 'WarehouseObjectViewDescriptors.ts'],
  ['snowflake', 'WarehouseObjectViewDescriptors.ts'],
  ['bigquery', 'WarehouseObjectViewDescriptors.ts'],
])

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath)
}

async function read(relativePath) {
  return readFile(absolutePath(relativePath), 'utf8')
}

function extractConstStringArray(source, constName) {
  const match = source.match(new RegExp(`export const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\] as const`))
  assert.ok(match, `Could not find ${constName}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

function extractBacklogBlock(source, engine) {
  const marker = `engine: '${engine}'`
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) {
    return undefined
  }

  const start = source.lastIndexOf('{', markerIndex)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  return undefined
}

function quotedValues(source) {
  return [...source.matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function extractBacklogEngines(source) {
  return [...source.matchAll(/engine: '([^']+)'/g)].map((entry) => entry[1])
}

function fieldValues(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*\\[([\\s\\S]*?)\\]`))
  return match ? quotedValues(match[1]) : []
}

function fieldValue(block, fieldName) {
  return block.match(new RegExp(`${fieldName}:\\s*'([^']+)'`))?.[1]
}

function objectViewFamilies(source) {
  return new Set([...source.matchAll(/connection\.family === '([^']+)'/g)].map((entry) => entry[1]))
}

function objectViewEngines(source) {
  return new Set([...source.matchAll(/connection\.engine === '([^']+)'/g)].map((entry) => entry[1]))
}

function extractProfileBlock(source, profileName) {
  const marker = `const ${profileName} = profile({`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `Could not find ${profileName}`)
  const start = markerIndex + `const ${profileName} = profile(`.length
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }
  throw new Error(`Could not parse ${profileName}`)
}

test('datastore engine contracts stay synchronized across roadmap and object views', async () => {
  const [connectionSource, roadmapSource, treeManifestSource, rustRegistrySource] = await Promise.all([
    read(files.connection),
    read(files.roadmap),
    read(files.treeManifest),
    read(files.rustRegistry),
  ])
  const engines = extractConstStringArray(connectionSource, 'DATASTORE_ENGINES')
  const backlogEngines = extractBacklogEngines(roadmapSource)
  const descriptorEngines = [...descriptorOwners.keys()]
  const failures = []

  assert.deepEqual(sorted(backlogEngines), sorted(engines))
  assert.deepEqual(sorted(descriptorEngines), sorted(engines))

  for (const engine of engines) {
    if (!new RegExp(`case '${engine}'`).test(treeManifestSource)) {
      failures.push(`${engine}: missing shared tree manifest case`)
    }
    if (!new RegExp(`"${engine}"\\s*=>`).test(rustRegistrySource)) {
      failures.push(`${engine}: missing Rust registry dispatch branch`)
    }
  }

  assert.deepEqual(failures, [])
})

test('every declared datastore has production-readiness wiring', async () => {
  const [
    connectionSource,
    roadmapSource,
    treeManifestSource,
    rustRegistrySource,
    objectViewRouterSource,
  ] = await Promise.all([
    read(files.connection),
    read(files.roadmap),
    read(files.treeManifest),
    read(files.rustRegistry),
    read(files.objectViewRouter),
  ])

  const engines = extractConstStringArray(connectionSource, 'DATASTORE_ENGINES')
  const routerEngines = objectViewEngines(objectViewRouterSource)
  const routerFamilies = objectViewFamilies(objectViewRouterSource)
  const failures = []

  for (const engine of engines) {
    const block = extractBacklogBlock(roadmapSource, engine)
    if (!block) {
      failures.push(`${engine}: missing DATASTORE_FEATURE_BACKLOG entry`)
      continue
    }

    const family = fieldValue(block, 'family')
    const connectionModes = fieldValues(block, 'connectionModes')
    const resultRenderers = fieldValues(block, 'resultRenderers')
    const capabilities = fieldValues(block, 'capabilities')

    if (!family) {
      failures.push(`${engine}: roadmap entry is missing family`)
    }
    if (connectionModes.length === 0) {
      failures.push(`${engine}: roadmap entry is missing connection modes`)
    }
    if (resultRenderers.length === 0 && !/\.\.\.[A-Za-z0-9_]+/.test(block)) {
      failures.push(`${engine}: roadmap entry is missing result renderers`)
    }
    if (capabilities.length === 0 && !/\.\.\.[A-Za-z0-9_]+/.test(block)) {
      failures.push(`${engine}: roadmap entry is missing capabilities`)
    }
    if (!new RegExp(`case '${engine}'`).test(treeManifestSource)) {
      failures.push(`${engine}: missing datastore tree manifest branch`)
    }
    if (!new RegExp(`"${engine}"\\s*=>`).test(rustRegistrySource)) {
      failures.push(`${engine}: missing Rust adapter registry branch`)
    }
    if (!routerEngines.has(engine) && !routerFamilies.has(family)) {
      failures.push(`${engine}: missing object-view workspace route`)
    }

    const descriptorFile = descriptorOwners.get(engine)
    if (!descriptorFile) {
      failures.push(`${engine}: missing descriptor owner contract`)
    } else {
      const descriptorPath = absolutePath(`apps/desktop/src/app/components/workbench/${descriptorFile}`)
      try {
        await access(descriptorPath)
      } catch {
        failures.push(`${engine}: descriptor file ${descriptorFile} does not exist`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore completeness profiles keep every native gap explicit', async () => {
  const completenessSource = await read(files.completeness)
  const criteria = extractConstStringArray(completenessSource, 'DATASTORE_COMPLETENESS_CRITERIA')
  const profiles = [
    'MONGO_PROFILE',
    'REDIS_PROFILE',
    'RELATIONAL_CORE_PROFILE',
    'SEARCH_PROFILE',
    'WIDE_COLUMN_PROFILE',
    'WAVE4_DOCUMENT_PROFILE',
    'WAVE4_CACHE_PROFILE',
    'WAVE4_ANALYTICS_PROFILE',
    'WAVE5_TIMESERIES_PROFILE',
    'WAVE5_GRAPH_PROFILE',
    'BETA_PROFILE',
  ]
  const failures = []

  for (const profileName of profiles) {
    const block = extractProfileBlock(completenessSource, profileName)

    for (const criterion of criteria) {
      const criterionPattern = new RegExp(`(?:'${criterion}'|${criterion}):\\s*(strong|partial|preview)\\(`)
      if (!criterionPattern.test(block)) {
        failures.push(`${profileName}: missing criterion ${criterion}`)
      }
    }

    const statusCalls = [...block.matchAll(/(strong|partial|preview)\(\s*'[^']*'\s*,\s*\[([\s\S]*?)\]\s*\)/g)]
    for (const [, status, nextBlock] of statusCalls) {
      if (status !== 'strong' && !/'[^']+'/.test(nextBlock)) {
        failures.push(`${profileName}: ${status} criterion is missing explicit next work`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('all declared datastores are explicitly accepted for the contract-complete gate', async () => {
  const [connectionSource, completenessSource] = await Promise.all([
    read(files.connection),
    read(files.completeness),
  ])
  const engines = extractConstStringArray(connectionSource, 'DATASTORE_ENGINES')
  const acceptedEngines = extractConstStringArray(
    completenessSource,
    'CONTRACT_COMPLETE_DATASTORE_ENGINES',
  )
  const failures = []

  assert.deepEqual(sorted(acceptedEngines), sorted(engines))

  for (const field of ['completionClaim', 'completionEvidence', 'residualRisk']) {
    if (!new RegExp(`${field}:`).test(completenessSource)) {
      failures.push(`DatastoreCompletenessSummary is missing ${field}`)
    }
  }

  for (const field of ['contractStatus', 'evidence', 'contractNote']) {
    if (!new RegExp(`${field}:`).test(completenessSource)) {
      failures.push(`DatastoreCompletenessCriterionStatus is missing ${field}`)
    }
  }

  for (const helper of [
    'contractIncompleteCriteriaForEngine',
    'isDatastoreContractComplete',
  ]) {
    if (!new RegExp(`export function ${helper}`).test(completenessSource)) {
      failures.push(`missing ${helper} helper`)
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore trees do not reintroduce fake sample leaves', async () => {
  const sources = await Promise.all([
    files.treeManifest,
    files.browserExplorer,
    files.treeRegistry,
    files.fallbackTree,
  ].map(async (file) => [file, await read(file)]))
  const forbiddenLabels = [
    /Sample documents/i,
    /Sampled keys/i,
    /sample table/i,
    /sample collection/i,
    /fake key-prefix/i,
  ]
  const failures = []

  for (const [file, source] of sources) {
    for (const label of forbiddenLabels) {
      if (label.test(source)) {
        failures.push(`${file}: contains forbidden tree label ${label}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore object trees have shared Rust and browser routing parity', async () => {
  const [treeManifestSource, rustTreeManifestSource, browserExplorerSource] = await Promise.all([
    read(files.treeManifest),
    read(files.rustTreeManifest),
    read(files.browserExplorer),
  ])
  const expectedRoots = new Map([
    ['elasticsearch', ['Indices', 'Data Streams', 'Diagnostics']],
    ['opensearch', ['Indices', 'Data Streams', 'Diagnostics']],
    ['dynamodb', ['Tables', 'Access', 'Diagnostics']],
    ['cassandra', ['Keyspaces', 'Cluster', 'Diagnostics']],
    ['cosmosdb', ['Account', 'Databases', 'Diagnostics']],
    ['litedb', ['Local Database', 'Collections', 'Diagnostics']],
    ['memcached', ['Server', 'Slabs', 'Diagnostics']],
    ['duckdb', ['Main Database', 'Extensions', 'Diagnostics']],
    ['clickhouse', ['Databases', 'Clusters', 'Diagnostics']],
    ['snowflake', ['Databases', 'Warehouses', 'Diagnostics']],
    ['bigquery', ['Datasets', 'Jobs', 'Diagnostics']],
    ['prometheus', ['Metrics', 'Labels', 'TSDB Status']],
    ['influxdb', ['Buckets', 'Measurements', 'Diagnostics']],
    ['opentsdb', ['Metrics', 'UID Metadata', 'Diagnostics']],
    ['neo4j', ['Node Labels', 'Relationship Types', 'Diagnostics']],
    ['arango', ['Graphs', 'Services', 'Diagnostics']],
    ['janusgraph', ['Node Labels', 'Relationship Types', 'Diagnostics']],
    ['neptune', ['Node Labels', 'Loader Jobs', 'Diagnostics']],
  ])
  const browserRouting = new Map([
    ['elasticsearch', /connection\.engine === 'elasticsearch' \|\| connection\.engine === 'opensearch'/],
    ['opensearch', /connection\.engine === 'elasticsearch' \|\| connection\.engine === 'opensearch'/],
    ['dynamodb', /connection\.engine === 'dynamodb'/],
    ['cassandra', /connection\.engine === 'cassandra'/],
    ['cosmosdb', /connection\.engine === 'cosmosdb'/],
    ['litedb', /connection\.engine === 'litedb'/],
    ['memcached', /connection\.engine === 'memcached'/],
    ['duckdb', /connection\.engine === 'duckdb'/],
    ['clickhouse', /connection\.family === 'warehouse'/],
    ['snowflake', /connection\.family === 'warehouse'/],
    ['bigquery', /connection\.family === 'warehouse'/],
    ['prometheus', /connection\.engine === 'prometheus'/],
    ['influxdb', /connection\.engine === 'influxdb'/],
    ['opentsdb', /connection\.engine === 'opentsdb'/],
    ['neo4j', /connection\.family === 'graph'/],
    ['arango', /connection\.family === 'graph'/],
    ['janusgraph', /connection\.family === 'graph'/],
    ['neptune', /connection\.family === 'graph'/],
  ])
  const failures = []

  for (const [engine, labels] of expectedRoots) {
    if (!new RegExp(`case '${engine}'`).test(treeManifestSource)) {
      failures.push(`${engine}: missing shared tree manifest branch`)
    }
    if (!new RegExp(`"${engine}"`).test(rustTreeManifestSource)) {
      failures.push(`${engine}: missing Rust tree manifest branch`)
    }
    if (!browserRouting.get(engine)?.test(browserExplorerSource)) {
      failures.push(`${engine}: missing browser explorer routing branch`)
    }

    for (const label of labels) {
      if (!treeManifestSource.includes(`'${label}'`) || !rustTreeManifestSource.includes(`"${label}"`)) {
        failures.push(`${engine}: missing shared/Rust root label ${label}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore connection flows have shared browser and Rust parity', async () => {
  const [
    connectionSource,
    completenessSource,
    requestValidationSource,
    connectionModesSource,
    rustModelsSource,
    rustProfilesSource,
    rustProfileOptionsSource,
    rustProfileOptionsCloudSource,
    rustProfileOptionsGraphSource,
    rustProfileOptionsTimeseriesSource,
    rustProfileOptionsWarehouseSource,
    memcachedProtocolSource,
  ] = await Promise.all([
    read(files.connection),
    read(files.completeness),
    read(files.requestValidationWorkspace),
    read(files.connectionModes),
    read(files.rustModels),
    read(files.rustProfiles),
    read(files.rustProfileOptions),
    read(files.rustProfileOptionsCloud),
    read(files.rustProfileOptionsGraph),
    read(files.rustProfileOptionsTimeseries),
    read(files.rustProfileOptionsWarehouse),
    read(files.memcachedProtocol),
  ])
  const contracts = [
    {
      label: 'search',
      profile: 'SEARCH_PROFILE',
      shared: 'SearchConnectionOptions',
      property: 'searchOptions',
      rustProperty: 'search_options',
      validator: 'validateSearchConnectionOptions',
      fieldComponent: 'RightDrawer.search-connection-fields.tsx',
      interpolator: 'interpolate_search_options',
      rustInterpolatorSource: rustProfileOptionsCloudSource,
    },
    {
      label: 'dynamodb',
      profile: 'WIDE_COLUMN_PROFILE',
      shared: 'DynamoDbConnectionOptions',
      property: 'dynamoDbOptions',
      rustProperty: 'dynamo_db_options',
      validator: 'validateDynamoDbConnectionOptions',
      fieldComponent: 'RightDrawer.dynamodb-connection-fields.tsx',
      interpolator: 'interpolate_dynamodb_options',
      rustInterpolatorSource: rustProfileOptionsCloudSource,
    },
    {
      label: 'cassandra',
      profile: 'WIDE_COLUMN_PROFILE',
      shared: 'CassandraConnectionOptions',
      property: 'cassandraOptions',
      rustProperty: 'cassandra_options',
      validator: 'validateCassandraConnectionOptions',
      fieldComponent: 'RightDrawer.cassandra-connection-fields.tsx',
      interpolator: 'interpolate_cassandra_options',
      rustInterpolatorSource: rustProfileOptionsCloudSource,
    },
    {
      label: 'cosmosdb',
      profile: 'WAVE4_DOCUMENT_PROFILE',
      shared: 'CosmosDbConnectionOptions',
      property: 'cosmosDbOptions',
      rustProperty: 'cosmos_db_options',
      validator: 'validateCosmosDbConnectionOptions',
      fieldComponent: 'RightDrawer.cosmosdb-connection-fields.tsx',
      interpolator: 'interpolate_cosmosdb_options',
      rustInterpolatorSource: rustProfileOptionsCloudSource,
    },
    {
      label: 'memcached',
      profile: 'WAVE4_CACHE_PROFILE',
      shared: 'MemcachedConnectionOptions',
      property: 'memcachedOptions',
      rustProperty: 'memcached_options',
      validator: 'validateMemcachedConnectionOptions',
      fieldComponent: 'RightDrawer.memcached-connection-fields.tsx',
      interpolator: 'interpolate_memcached_options',
      rustInterpolatorSource: rustProfileOptionsSource,
    },
    {
      label: 'timeseries',
      profile: 'WAVE5_TIMESERIES_PROFILE',
      shared: 'TimeSeriesConnectionOptions',
      property: 'timeSeriesOptions',
      rustProperty: 'time_series_options',
      validator: 'validateTimeSeriesConnectionOptions',
      fieldComponent: 'RightDrawer.timeseries-connection-fields.tsx',
      interpolator: 'interpolate_timeseries_options',
      rustInterpolatorSource: rustProfileOptionsTimeseriesSource,
    },
    {
      label: 'graph',
      profile: 'WAVE5_GRAPH_PROFILE',
      shared: 'GraphConnectionOptions',
      property: 'graphOptions',
      rustProperty: 'graph_options',
      validator: 'validateGraphConnectionOptions',
      fieldComponent: 'RightDrawer.graph-connection-fields.tsx',
      interpolator: 'interpolate_graph_options',
      rustInterpolatorSource: rustProfileOptionsGraphSource,
    },
    {
      label: 'warehouse',
      profile: 'WAVE4_ANALYTICS_PROFILE',
      shared: 'WarehouseConnectionOptions',
      property: 'warehouseOptions',
      rustProperty: 'warehouse_options',
      validator: 'validateWarehouseConnectionOptions',
      fieldComponent: 'RightDrawer.warehouse-connection-fields.tsx',
      interpolator: 'interpolate_warehouse_options',
      rustInterpolatorSource: rustProfileOptionsWarehouseSource,
    },
  ]
  const failures = []

  for (const contract of contracts) {
    const profileBlock = extractProfileBlock(completenessSource, contract.profile)
    if (!new RegExp(`'connection-flow':\\s*strong\\(`).test(profileBlock)) {
      failures.push(`${contract.label}: connection-flow is not strong in ${contract.profile}`)
    }
    if (!connectionSource.includes(`interface ${contract.shared}`)) {
      failures.push(`${contract.label}: missing shared ${contract.shared}`)
    }
    if (!connectionSource.includes(`${contract.property}?: ${contract.shared}`)) {
      failures.push(`${contract.label}: ConnectionProfile is missing ${contract.property}`)
    }
    if (!requestValidationSource.includes(contract.validator)) {
      failures.push(`${contract.label}: request validation is missing ${contract.validator}`)
    }
    if (!connectionModesSource.includes(contract.fieldComponent.replace(/^RightDrawer\./, 'RightDrawer.').replace(/\.tsx$/, ''))) {
      failures.push(`${contract.label}: connection drawer does not import ${contract.fieldComponent}`)
    }
    if (!rustModelsSource.includes(`struct ${contract.shared}`)) {
      failures.push(`${contract.label}: Rust model is missing ${contract.shared}`)
    }
    if (!rustModelsSource.includes(`pub ${contract.rustProperty}: Option<${contract.shared}>`)) {
      failures.push(`${contract.label}: Rust connection profile is missing ${contract.rustProperty}`)
    }
    if (!rustProfilesSource.includes(contract.rustProperty)) {
      failures.push(`${contract.label}: Rust profile resolution is missing ${contract.rustProperty}`)
    }
    if (!contract.rustInterpolatorSource.includes(contract.interpolator)) {
      failures.push(`${contract.label}: Rust interpolation is missing ${contract.interpolator}`)
    }
    try {
      await access(absolutePath(`apps/desktop/src/app/components/workbench/${contract.fieldComponent}`))
    } catch {
      failures.push(`${contract.label}: field component ${contract.fieldComponent} does not exist`)
    }
  }

  if (!memcachedProtocolSource.includes('memcached_address(connection)')) {
    failures.push('memcached: protocol does not use option-aware server routing')
  }
  if (!memcachedProtocolSource.includes('connect_timeout_ms')) {
    failures.push('memcached: protocol does not honor connect timeouts')
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore guarded operations have browser and Rust parity', async () => {
  const [
    completenessSource,
    browserOperationManifestsSource,
    browserOperationManifestGenericSource,
    browserOperationManifestSpecializedSource,
    browserDocumentOperationManifestsSource,
    browserDuckDbOperationManifestsSource,
    browserMemcachedOperationManifestsSource,
    browserSearchOperationManifestsSource,
    browserWaveFiveOperationManifestsSource,
    browserWideColumnOperationManifestsSource,
    browserOperationsSource,
    browserDuckDbAdminOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
    rustOperationManifestSource,
    rustOperationPlanningSource,
    cassandraOperationActionsSource,
    cosmosOperationActionsSource,
    dynamoOperationActionsSource,
    graphOperationActionsSource,
    liteDbOperationActionsSource,
    memcachedOperationActionsSource,
    searchOperationActionsSource,
    timeSeriesOperationActionsSource,
    warehouseOperationActionsSource,
  ] = await Promise.all([
    read(files.completeness),
    read(files.browserOperationManifests),
    read(files.browserOperationManifestGeneric),
    read(files.browserOperationManifestSpecialized),
    read(files.browserDocumentOperationManifests),
    read(files.browserDuckDbOperationManifests),
    read(files.browserMemcachedOperationManifests),
    read(files.browserSearchOperationManifests),
    read(files.browserWaveFiveOperationManifests),
    read(files.browserWideColumnOperationManifests),
    read(files.browserOperations),
    read(files.browserDuckDbAdminOperations),
    read(files.browserCosmosOperations),
    read(files.browserGraphOperations),
    read(files.browserLiteDbOperations),
    read(files.browserMemcachedOperations),
    read(files.browserSearchOperations),
    read(files.browserSqlDialectOperations),
    read(files.browserSqlOperations),
    read(files.browserTimeSeriesOperations),
    read(files.browserWarehouseOperations),
    read(files.browserWideColumnOperations),
    read(files.rustOperationManifest),
    read(files.rustOperationPlanning),
    read(files.cassandraOperationActions),
    read(files.cosmosOperationActions),
    read(files.dynamoOperationActions),
    read(files.graphOperationActions),
    read(files.liteDbOperationActions),
    read(files.memcachedOperationActions),
    read(files.searchOperationActions),
    read(files.timeSeriesOperationActions),
    read(files.warehouseOperationActions),
  ])
  const browserManifestSource = [
    browserOperationManifestsSource,
    browserOperationManifestGenericSource,
    browserOperationManifestSpecializedSource,
    browserDocumentOperationManifestsSource,
    browserDuckDbOperationManifestsSource,
    browserMemcachedOperationManifestsSource,
    browserSearchOperationManifestsSource,
    browserWaveFiveOperationManifestsSource,
    browserWideColumnOperationManifestsSource,
  ].join('\n')
  const browserPlannerSource = [
    browserOperationsSource,
    browserDuckDbAdminOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
  ].join('\n')
  const objectActionSource = [
    cassandraOperationActionsSource,
    cosmosOperationActionsSource,
    dynamoOperationActionsSource,
    graphOperationActionsSource,
    liteDbOperationActionsSource,
    memcachedOperationActionsSource,
    searchOperationActionsSource,
    timeSeriesOperationActionsSource,
    warehouseOperationActionsSource,
  ].join('\n')
  const contracts = [
    {
      label: 'search',
      profile: 'SEARCH_PROFILE',
      manifestTokens: ['index.force-merge', 'index.reindex', 'alias.put', 'pipeline.put', 'data.import-export', 'snapshot.restore'],
      plannerTokens: ['searchOperationRequest', 'index.force-merge', 'pipeline.put', 'data.import-export'],
      rustTokens: ['search_operation_request', 'index.force-merge', 'pipeline.put', 'data.import-export', 'snapshot.restore'],
      actionTokens: ['index.force-merge', 'pipeline.put', 'data.import-export'],
    },
    {
      label: 'wide-column',
      profile: 'WIDE_COLUMN_PROFILE',
      manifestTokens: ['dynamodb.capacity.update', 'dynamodb.ttl.update', 'dynamodb.backup.restore', 'data.import-export', 'data.backup-restore'],
      plannerTokens: ['wideColumnOperationRequest', 'capacity.update', 'ttl.update', 'data.import-export', 'data.backup-restore'],
      rustTokens: ['widecolumn_operation_request', 'dynamodb.capacity.update', 'cassandra.data.import-export', 'cassandra.data.backup-restore'],
      actionTokens: ['capacity.update', 'ttl.update', 'security.inspect', 'diagnostics.metrics', 'data.import-export'],
    },
    {
      label: 'document',
      profile: 'WAVE4_DOCUMENT_PROFILE',
      manifestTokens: ['cosmosdb.throughput.update', 'cosmosdb.consistency.update', 'cosmosdb.regions.failover', 'litedb.storage.compact', 'data.backup-restore'],
      plannerTokens: ['cosmosOperationRequest', 'liteDbOperationRequest', 'throughput.update', 'storage.compact', 'data.import-export'],
      rustTokens: ['cosmosdb_operation_request', 'litedb_operation_request', 'cosmosdb.throughput.update', 'litedb.storage.compact'],
      actionTokens: ['throughput.update', 'security.inspect', 'storage.compact', 'data.import-export'],
    },
    {
      label: 'cache',
      profile: 'WAVE4_CACHE_PROFILE',
      manifestTokens: ['memcached.stats.reset', 'memcached.cache.flush', 'memcached.key.delete', 'data.import-export'],
      plannerTokens: ['memcachedOperationRequest', 'stats.reset', 'cache.flush', 'key.delete', 'data.import-export'],
      rustTokens: ['memcached_operation_request', 'memcached.stats.reset', 'memcached.cache.flush', 'memcached.key.delete', 'memcached.data.import-export'],
      actionTokens: ['stats.reset', 'cache.flush', 'key.delete', 'data.import-export'],
    },
    {
      label: 'analytics',
      profile: 'WAVE4_ANALYTICS_PROFILE',
      manifestTokens: ['duckdb.table.analyze', 'duckdb.file.import', 'clickhouse.table.optimize', 'snowflake.table.clone', 'bigquery.table.copy', 'data.import-export'],
      plannerTokens: ['warehouseOperationRequest', 'table.clone', 'table.optimize', 'table.copy', 'data.import-export'],
      rustTokens: ['warehouse_operation_request', 'duckdb_operation_request', 'clickhouse.table.optimize', 'snowflake.table.clone', 'bigquery.table.copy'],
      actionTokens: ['table.clone', 'table.optimize', 'data.import-export', 'diagnostics.metrics', 'security.inspect'],
    },
    {
      label: 'time-series',
      profile: 'WAVE5_TIMESERIES_PROFILE',
      manifestTokens: ['prometheus.cardinality.analyze', 'influxdb.retention.update', 'opentsdb.uid.repair', 'data.import-export'],
      plannerTokens: ['timeSeriesOperationRequest', 'cardinality.analyze', 'retention.update', 'uid.repair', 'data.import-export'],
      rustTokens: ['timeseries_operation_request', 'prometheus.cardinality.analyze', 'influxdb.retention.update', 'opentsdb.uid.repair'],
      actionTokens: ['cardinality.analyze', 'retention.update', 'uid.repair', 'data.import-export'],
    },
    {
      label: 'graph',
      profile: 'WAVE5_GRAPH_PROFILE',
      manifestTokens: ['neptune.security.inspect', 'index.create', 'object.drop', 'data.import-export'],
      plannerTokens: ['graphOperationRequest', 'security.inspect', 'index.create', 'object.drop', 'data.import-export'],
      rustTokens: ['graph_operation_request', 'neptune.security.inspect', 'neo4j.data.import-export', 'index.create'],
      actionTokens: ['security.inspect', 'index.create', 'object.drop', 'data.import-export'],
    },
  ]
  const failures = []

  for (const contract of contracts) {
    const profileBlock = extractProfileBlock(completenessSource, contract.profile)
    if (!new RegExp(`'guarded-operations':\\s*strong\\(`).test(profileBlock)) {
      failures.push(`${contract.label}: guarded-operations is not strong in ${contract.profile}`)
    }
    if (!profileBlock.includes('browser planners') || !profileBlock.includes('Rust planners')) {
      failures.push(`${contract.label}: completeness note does not mention browser/Rust planner parity`)
    }
    for (const token of contract.manifestTokens) {
      if (!browserManifestSource.includes(token)) {
        failures.push(`${contract.label}: browser operation manifest missing ${token}`)
      }
    }
    for (const token of contract.plannerTokens) {
      if (!browserPlannerSource.includes(token)) {
        failures.push(`${contract.label}: browser operation planner missing ${token}`)
      }
    }
    for (const token of contract.rustTokens) {
      if (!rustOperationManifestSource.includes(token) && !rustOperationPlanningSource.includes(token)) {
        failures.push(`${contract.label}: Rust operation path missing ${token}`)
      }
    }
    for (const token of contract.actionTokens) {
      if (!objectActionSource.includes(token)) {
        failures.push(`${contract.label}: object-view operation actions missing ${token}`)
      }
    }
  }

  for (const source of [browserManifestSource, rustOperationManifestSource]) {
    if (!source.includes("executionSupport: 'plan-only'") && !source.includes('execution_support = if live_safe')) {
      failures.push('operation manifests do not keep plan-only execution support explicit')
    }
    if (!source.includes('disabledReason') && !source.includes('disabled_reason')) {
      failures.push('operation manifests do not keep disabled reasons explicit')
    }
  }
  if (!browserOperationsSource.includes('Preview mode generates guarded operation plans without mutating the datastore.')) {
    failures.push('browser operation plans do not keep preview-only mutation warning')
  }
  if (!rustOperationPlanningSource.includes('guarded operation plan before live mutation support')) {
    failures.push('Rust operation plans do not keep preview-only mutation warning')
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore diagnostics and performance contracts have preview, browser, and Rust parity', async () => {
  const [
    completenessSource,
    treeManifestSource,
    rustTreeManifestSource,
    browserOperationInspectionSource,
    browserOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
    rustOperationManifestSource,
    rustOperationPlanningSource,
    cassandraObjectViewInsightsSource,
    clickHouseObjectViewInsightsSource,
    cloudWarehouseObjectViewInsightsSource,
    cosmosObjectViewInsightsSource,
    duckDbObjectViewInsightsSource,
    dynamoObjectViewInsightsSource,
    graphObjectViewOperationsSource,
    graphObjectViewWorkspaceSource,
    liteDbObjectViewInsightsSource,
    memcachedObjectViewInsightsSource,
    searchObjectViewInsightsSource,
    timeSeriesObjectViewInsightsSource,
    warehouseObjectViewInsightsSource,
  ] = await Promise.all([
    read(files.completeness),
    read(files.treeManifest),
    read(files.rustTreeManifest),
    read(files.browserOperationInspection),
    read(files.browserOperations),
    read(files.browserCosmosOperations),
    read(files.browserGraphOperations),
    read(files.browserLiteDbOperations),
    read(files.browserMemcachedOperations),
    read(files.browserSearchOperations),
    read(files.browserSqlDialectOperations),
    read(files.browserSqlOperations),
    read(files.browserTimeSeriesOperations),
    read(files.browserWarehouseOperations),
    read(files.browserWideColumnOperations),
    read(files.rustOperationManifest),
    read(files.rustOperationPlanning),
    read(files.cassandraObjectViewInsights),
    read(files.clickHouseObjectViewInsights),
    read(files.cloudWarehouseObjectViewInsights),
    read(files.cosmosObjectViewInsights),
    read(files.duckDbObjectViewInsights),
    read(files.dynamoObjectViewInsights),
    read(files.graphObjectViewOperations),
    read(files.graphObjectViewWorkspace),
    read(files.liteDbObjectViewInsights),
    read(files.memcachedObjectViewInsights),
    read(files.searchObjectViewInsights),
    read(files.timeSeriesObjectViewInsights),
    read(files.warehouseObjectViewInsights),
  ])
  const treeSource = [treeManifestSource, rustTreeManifestSource].join('\n')
  const browserPlannerSource = [
    browserOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
  ].join('\n')
  const objectDiagnosticsSource = [
    cassandraObjectViewInsightsSource,
    clickHouseObjectViewInsightsSource,
    cloudWarehouseObjectViewInsightsSource,
    cosmosObjectViewInsightsSource,
    duckDbObjectViewInsightsSource,
    dynamoObjectViewInsightsSource,
    graphObjectViewOperationsSource,
    graphObjectViewWorkspaceSource,
    liteDbObjectViewInsightsSource,
    memcachedObjectViewInsightsSource,
    searchObjectViewInsightsSource,
    timeSeriesObjectViewInsightsSource,
    warehouseObjectViewInsightsSource,
  ].join('\n')
  const contracts = [
    {
      label: 'search',
      profile: 'SEARCH_PROFILE',
      treeTokens: ['Diagnostics', 'Shards', 'Segments'],
      plannerTokens: ['searchOperationRequest', 'query.profile', 'profile: true'],
      rustTokens: ['search_operation_request', 'query.profile', 'profile'],
      insightTokens: ['SearchObjectViewInsights', 'Lifecycle', 'cluster', 'diagnostics'],
    },
    {
      label: 'wide-column',
      profile: 'WIDE_COLUMN_PROFILE',
      treeTokens: ['Diagnostics', 'Capacity', 'Tracing'],
      plannerTokens: ['wideColumnOperationRequest', 'CloudWatch.GetMetricData', 'nodetool/JMX'],
      rustTokens: ['widecolumn_operation_request', 'CloudWatch.GetMetricData', 'nodetool/JMX'],
      insightTokens: ['DynamoObjectViewInsights', 'CassandraObjectViewInsights', 'capacity', 'compaction'],
    },
    {
      label: 'document',
      profile: 'WAVE4_DOCUMENT_PROFILE',
      treeTokens: ['Diagnostics', 'Throughput'],
      plannerTokens: ['cosmosOperationRequest', 'liteDbOperationRequest', 'NormalizedRUConsumption', 'inspect pages'],
      rustTokens: ['cosmosdb_operation_request', 'litedb_operation_request', 'NormalizedRUConsumption', 'inspect pages'],
      insightTokens: ['CosmosObjectViewInsights', 'LiteDbObjectViewInsights', 'RU Posture', 'file storage'],
    },
    {
      label: 'cache',
      profile: 'WAVE4_CACHE_PROFILE',
      treeTokens: ['Diagnostics', 'Stats', 'Slabs'],
      plannerTokens: ['memcachedOperationRequest', 'stats settings', 'stats slabs'],
      rustTokens: ['memcached_operation_request', 'stats settings', 'stats slabs'],
      insightTokens: ['MemcachedObjectViewInsights', 'Hit Rate', 'Evictions'],
    },
    {
      label: 'analytics',
      profile: 'WAVE4_ANALYTICS_PROFILE',
      treeTokens: ['Diagnostics', 'Jobs'],
      plannerTokens: ['warehouseOperationRequest', 'query.profile', 'system.query_log', 'slotMs'],
      rustTokens: ['warehouse_operation_request', 'query.profile', 'system.query_log', 'slotMs'],
      insightTokens: ['WarehouseObjectViewInsights', 'ClickHouseObjectViewInsights', 'CloudWarehouseObjectViewInsights', 'cost posture'],
    },
    {
      label: 'time-series',
      profile: 'WAVE5_TIMESERIES_PROFILE',
      treeTokens: ['Diagnostics', 'TSDB Status', 'Stats'],
      plannerTokens: ['timeSeriesOperationRequest', 'cardinality', '/api/v1/status/tsdb', '/metrics', '/api/stats'],
      rustTokens: ['timeseries_operation_request', 'cardinality', '/api/v1/status/tsdb', '/metrics', '/api/stats'],
      insightTokens: ['TimeSeriesObjectViewInsights', 'Time-series cardinality posture', 'diagnostics'],
    },
    {
      label: 'graph',
      profile: 'WAVE5_GRAPH_PROFILE',
      treeTokens: ['Diagnostics', 'Loader Jobs'],
      plannerTokens: ['graphOperationRequest', 'CloudWatch.GetMetricData', '/gremlin/profile', 'CALL dbms.queryJmx'],
      rustTokens: ['graph_operation_request', 'CloudWatch.GetMetricData', '/gremlin/profile', 'dbms.queryJmx'],
      insightTokens: ['GraphObjectViewWorkspace', 'diagnostics', 'diagnostics.metrics'],
    },
  ]
  const failures = []

  if (!browserOperationInspectionSource.includes('collectDiagnosticsLocally')) {
    failures.push('browser diagnostics collection helper is missing')
  }
  for (const token of ['renderer: \'metrics\'', 'renderer: \'series\'', 'renderer: \'chart\'', 'renderer: \'profile\'', 'renderer: \'costEstimate\'']) {
    if (!browserOperationInspectionSource.includes(token)) {
      failures.push(`browser diagnostics payload missing ${token}`)
    }
  }
  if (!browserOperationInspectionSource.includes('Browser preview diagnostics do not contact live engines.')) {
    failures.push('browser diagnostics helper does not keep live-sampling caveat')
  }
  if (!rustOperationManifestSource.includes('"diagnostics.metrics"')) {
    failures.push('Rust operation manifest does not expose diagnostics.metrics')
  }

  for (const contract of contracts) {
    const profileBlock = extractProfileBlock(completenessSource, contract.profile)
    if (!new RegExp(`'diagnostics-performance':\\s*strong\\(`).test(profileBlock)) {
      failures.push(`${contract.label}: diagnostics-performance is not strong in ${contract.profile}`)
    }
    if (!profileBlock.includes('browser diagnostics payloads') || !profileBlock.includes('Rust metrics')) {
      failures.push(`${contract.label}: completeness note does not mention browser/Rust diagnostics parity`)
    }
    if (!profileBlock.includes('Contract-only residual risk') || !profileBlock.includes('live')) {
      failures.push(`${contract.label}: completeness note does not keep live validation residual risk`)
    }
    for (const token of contract.treeTokens) {
      if (!treeSource.includes(token)) {
        failures.push(`${contract.label}: diagnostics tree missing ${token}`)
      }
    }
    for (const token of contract.plannerTokens) {
      if (!browserPlannerSource.includes(token)) {
        failures.push(`${contract.label}: browser diagnostics planner missing ${token}`)
      }
    }
    for (const token of contract.rustTokens) {
      if (!rustOperationManifestSource.includes(token) && !rustOperationPlanningSource.includes(token)) {
        failures.push(`${contract.label}: Rust diagnostics path missing ${token}`)
      }
    }
    for (const token of contract.insightTokens) {
      if (!objectDiagnosticsSource.includes(token)) {
        failures.push(`${contract.label}: object-view diagnostics posture missing ${token}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore object-view contracts have descriptor, posture, and action parity', async () => {
  const [completenessSource, objectViewRouterSource] = await Promise.all([
    read(files.completeness),
    read(files.objectViewRouter),
  ])
  const contracts = [
    {
      label: 'search',
      profile: 'SEARCH_PROFILE',
      descriptorFiles: ['SearchObjectViewDescriptors.ts'],
      workspaceTokens: ['SearchObjectViewWorkspace', 'SearchObjectViewInsights', 'SearchObjectViewOperations'],
      extraFiles: ['SearchObjectViewOperations.helpers.ts', 'SearchObjectViewPostures.tsx', 'SearchObjectViewWorkflows.ts'],
      descriptorTokens: ['cluster', 'mappings', 'segments', 'lifecycle', 'ingestion', 'security'],
      actionTokens: ['query.profile', 'index.force-merge', 'data.import-export'],
    },
    {
      label: 'wide-column',
      profile: 'WIDE_COLUMN_PROFILE',
      descriptorFiles: ['DynamoObjectViewDescriptors.ts', 'CassandraObjectViewDescriptors.ts'],
      workspaceTokens: ['DynamoObjectViewWorkspace', 'CassandraObjectViewWorkspace', 'WideColumnObjectViewOperations'],
      extraFiles: ['DynamoObjectViewOperations.helpers.ts', 'CassandraObjectViewOperations.helpers.ts', 'DynamoObjectViewInsights.tsx', 'CassandraObjectViewInsights.tsx', 'DynamoObjectViewWorkflows.ts', 'CassandraObjectViewWorkflows.ts'],
      descriptorTokens: ['capacity', 'ttl', 'streams', 'backups', 'primary-key', 'compaction', 'tracing', 'repairs'],
      actionTokens: ['capacity.update', 'ttl.update', 'diagnostics.metrics', 'data.import-export'],
    },
    {
      label: 'document',
      profile: 'WAVE4_DOCUMENT_PROFILE',
      descriptorFiles: ['CosmosObjectViewDescriptors.ts', 'LiteDbObjectViewDescriptors.ts'],
      workspaceTokens: ['CosmosObjectViewWorkspace', 'LiteDbObjectViewWorkspace', 'CosmosObjectViewInsights', 'LiteDbObjectViewInsights'],
      extraFiles: ['CosmosObjectViewOperations.helpers.ts', 'LiteDbObjectViewOperations.helpers.ts', 'CosmosObjectViewWorkflows.ts', 'LiteDbObjectViewWorkflows.ts'],
      descriptorTokens: ['partition-key', 'indexing-policy', 'throughput', 'regions', 'storage', 'checkpoint', 'compact', 'backup'],
      actionTokens: ['throughput.update', 'consistency.update', 'storage.compact', 'data.import-export'],
    },
    {
      label: 'cache',
      profile: 'WAVE4_CACHE_PROFILE',
      descriptorFiles: ['MemcachedObjectViewDescriptors.ts'],
      workspaceTokens: ['MemcachedObjectViewWorkspace', 'MemcachedObjectViewInsights'],
      extraFiles: ['MemcachedObjectViewOperations.helpers.ts', 'MemcachedObjectViewWorkflows.ts'],
      descriptorTokens: ['stats', 'settings', 'slabs', 'items', 'known-key', 'connections'],
      actionTokens: ['stats.reset', 'cache.flush', 'key.delete', 'data.import-export'],
    },
    {
      label: 'analytics',
      profile: 'WAVE4_ANALYTICS_PROFILE',
      descriptorFiles: ['DuckDbObjectViewDescriptors.ts', 'WarehouseObjectViewDescriptors.ts'],
      workspaceTokens: ['RelationalObjectViewWorkspace', 'WarehouseObjectViewWorkspace', 'DuckDbObjectViewInsights', 'ClickHouseObjectViewInsights', 'CloudWarehouseObjectViewInsights', 'WarehouseObjectViewOperations'],
      extraFiles: ['WarehouseObjectViewOperations.helpers.ts', 'WarehouseObjectViewWorkflows.ts', 'WarehouseObjectViewInsights.tsx'],
      descriptorTokens: ['extensions', 'pragmas', 'attached-databases', 'warehouses', 'jobs', 'stage', 'security'],
      actionTokens: ['query.profile', 'table.clone', 'table.optimize', 'data.import-export'],
    },
    {
      label: 'time-series',
      profile: 'WAVE5_TIMESERIES_PROFILE',
      descriptorFiles: ['PrometheusObjectViewDescriptors.ts', 'InfluxObjectViewDescriptors.ts', 'OpenTsdbObjectViewDescriptors.ts'],
      workspaceTokens: ['PrometheusObjectViewWorkspace', 'InfluxObjectViewWorkspace', 'OpenTsdbObjectViewWorkspace', 'TimeSeriesObjectViewInsights', 'TimeSeriesObjectViewOperations'],
      extraFiles: ['TimeSeriesObjectViewOperations.helpers.ts', 'PrometheusObjectViewWorkflows.ts', 'InfluxObjectViewWorkflows.ts', 'OpenTsdbObjectViewWorkflows.ts'],
      descriptorTokens: ['metric', 'labels', 'targets', 'rules', 'bucket', 'retention', 'uid', 'aggregators'],
      actionTokens: ['cardinality.analyze', 'retention.update', 'uid.repair', 'data.import-export'],
    },
    {
      label: 'graph',
      profile: 'WAVE5_GRAPH_PROFILE',
      descriptorFiles: ['GraphObjectViewDescriptors.ts'],
      workspaceTokens: ['GraphObjectViewWorkspace', 'GraphObjectViewOperations'],
      extraFiles: ['GraphObjectViewOperations.helpers.ts', 'GraphObjectViewWorkflows.ts'],
      descriptorTokens: ['node-label', 'relationship-type', 'constraints', 'indexes', 'procedures', 'security'],
      actionTokens: ['query.profile', 'diagnostics.metrics', 'index.create', 'data.import-export'],
    },
  ]
  const failures = []

  for (const contract of contracts) {
    const profileBlock = extractProfileBlock(completenessSource, contract.profile)
    if (!new RegExp(`'object-views':\\s*strong\\(`).test(profileBlock)) {
      failures.push(`${contract.label}: object-views is not strong in ${contract.profile}`)
    }
    if (!profileBlock.includes('descriptor-backed workflows') || !profileBlock.includes('focused descriptor tests')) {
      failures.push(`${contract.label}: completeness note does not mention descriptor-backed workflow parity`)
    }
    if (!profileBlock.includes('Contract-only residual risk') || !profileBlock.includes('live')) {
      failures.push(`${contract.label}: completeness note does not keep live object-view residual risk`)
    }

    const descriptorSources = await Promise.all(
      contract.descriptorFiles.map((file) =>
        read(`apps/desktop/src/app/components/workbench/${file}`),
      ),
    )
    const descriptorTestSources = await Promise.all(
      contract.descriptorFiles.map((file) =>
        read(`apps/desktop/src/app/components/workbench/${file.replace(/\.ts$/, '.test.ts')}`),
      ),
    )
    const workspaceSources = await Promise.all(
      contract.workspaceTokens.map(async (token) => {
        const fileName = token.endsWith('Operations') ? `${token}.tsx` : `${token}.tsx`
        try {
          return await read(`apps/desktop/src/app/components/workbench/${fileName}`)
        } catch {
          return objectViewRouterSource.includes(token) ? token : ''
        }
      }),
    )
    const extraSources = await Promise.all(
      contract.extraFiles.map((file) =>
        read(`apps/desktop/src/app/components/workbench/${file}`),
      ),
    )
    const objectViewSource = [
      ...descriptorSources,
      ...descriptorTestSources,
      ...workspaceSources,
      ...extraSources,
    ].join('\n')

    if (!descriptorTestSources.every((source) => source.includes("not.toBe('Open View')"))) {
      failures.push(`${contract.label}: descriptor tests do not reject generic Open View labels`)
    }
    for (const token of contract.workspaceTokens) {
      if (!objectViewSource.includes(token) && !objectViewRouterSource.includes(token)) {
        failures.push(`${contract.label}: object-view workspace path missing ${token}`)
      }
    }
    for (const token of contract.descriptorTokens) {
      if (!objectViewSource.includes(token)) {
        failures.push(`${contract.label}: descriptor/workspace source missing ${token}`)
      }
    }
    for (const token of contract.actionTokens) {
      if (!objectViewSource.includes(token)) {
        failures.push(`${contract.label}: object-view action source missing ${token}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('secondary datastore import/export contracts have browser and Rust parity', async () => {
  const [
    completenessSource,
    roadmapSource,
    browserOperationManifestGenericSource,
    browserOperationManifestsSource,
    browserOperationManifestSpecializedSource,
    browserDocumentOperationManifestsSource,
    browserDuckDbOperationManifestsSource,
    browserMemcachedOperationManifestsSource,
    browserSearchOperationManifestsSource,
    browserWaveFiveOperationManifestsSource,
    browserWideColumnOperationManifestsSource,
    browserOperationsSource,
    browserDuckDbAdminOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
    rustOperationManifestSource,
    rustOperationPlanningSource,
    cassandraOperationActionsSource,
    cosmosOperationActionsSource,
    dynamoOperationActionsSource,
    graphOperationActionsSource,
    liteDbOperationActionsSource,
    memcachedOperationActionsSource,
    searchOperationActionsSource,
    timeSeriesOperationActionsSource,
    warehouseOperationActionsSource,
  ] = await Promise.all([
    read(files.completeness),
    read(files.roadmap),
    read(files.browserOperationManifestGeneric),
    read(files.browserOperationManifests),
    read(files.browserOperationManifestSpecialized),
    read(files.browserDocumentOperationManifests),
    read(files.browserDuckDbOperationManifests),
    read(files.browserMemcachedOperationManifests),
    read(files.browserSearchOperationManifests),
    read(files.browserWaveFiveOperationManifests),
    read(files.browserWideColumnOperationManifests),
    read(files.browserOperations),
    read(files.browserDuckDbAdminOperations),
    read(files.browserCosmosOperations),
    read(files.browserGraphOperations),
    read(files.browserLiteDbOperations),
    read(files.browserMemcachedOperations),
    read(files.browserSearchOperations),
    read(files.browserSqlDialectOperations),
    read(files.browserSqlOperations),
    read(files.browserTimeSeriesOperations),
    read(files.browserWarehouseOperations),
    read(files.browserWideColumnOperations),
    read(files.rustOperationManifest),
    read(files.rustOperationPlanning),
    read(files.cassandraOperationActions),
    read(files.cosmosOperationActions),
    read(files.dynamoOperationActions),
    read(files.graphOperationActions),
    read(files.liteDbOperationActions),
    read(files.memcachedOperationActions),
    read(files.searchOperationActions),
    read(files.timeSeriesOperationActions),
    read(files.warehouseOperationActions),
  ])
  const browserManifestSource = [
    browserOperationManifestGenericSource,
    browserOperationManifestsSource,
    browserOperationManifestSpecializedSource,
    browserDocumentOperationManifestsSource,
    browserDuckDbOperationManifestsSource,
    browserMemcachedOperationManifestsSource,
    browserSearchOperationManifestsSource,
    browserWaveFiveOperationManifestsSource,
    browserWideColumnOperationManifestsSource,
  ].join('\n')
  const browserPlannerSource = [
    browserOperationsSource,
    browserDuckDbAdminOperationsSource,
    browserCosmosOperationsSource,
    browserGraphOperationsSource,
    browserLiteDbOperationsSource,
    browserMemcachedOperationsSource,
    browserSearchOperationsSource,
    browserSqlDialectOperationsSource,
    browserSqlOperationsSource,
    browserTimeSeriesOperationsSource,
    browserWarehouseOperationsSource,
    browserWideColumnOperationsSource,
  ].join('\n')
  const objectActionSource = [
    cassandraOperationActionsSource,
    cosmosOperationActionsSource,
    dynamoOperationActionsSource,
    graphOperationActionsSource,
    liteDbOperationActionsSource,
    memcachedOperationActionsSource,
    searchOperationActionsSource,
    timeSeriesOperationActionsSource,
    warehouseOperationActionsSource,
  ].join('\n')
  const contracts = [
    {
      label: 'search',
      profile: 'SEARCH_PROFILE',
      manifestTokens: ['data.import-export', 'snapshot.restore', 'data.backup-restore'],
      plannerTokens: ['searchOperationRequest', '/_search', '/_snapshot'],
      rustTokens: ['search_operation_request', '/_search', '/_snapshot'],
      actionTokens: ['data.import-export', 'snapshot.restore'],
    },
    {
      label: 'wide-column',
      profile: 'WIDE_COLUMN_PROFILE',
      manifestTokens: ['data.import-export', 'data.backup-restore', 'backup.create', 'backup.restore'],
      plannerTokens: ['wideColumnOperationRequest', 'DynamoDB.ExportTableToPointInTime', 'DynamoDB.ImportTable', 'cqlsh COPY', 'nodetool snapshot', 'sstableloader'],
      rustTokens: ['widecolumn_operation_request', 'DynamoDB.ExportTableToPointInTime', 'DynamoDB.ImportTable', 'cqlsh COPY', 'nodetool snapshot', 'sstableloader'],
      actionTokens: ['data.import-export', 'data.backup-restore', 'backup.create'],
    },
    {
      label: 'document',
      profile: 'WAVE4_DOCUMENT_PROFILE',
      manifestTokens: ['data.import-export', 'data.backup-restore'],
      plannerTokens: ['cosmosOperationRequest', 'liteDbOperationRequest', 'CosmosDB.ExportItems', 'LiteDB.ExportCollection', 'LiteDB.Backup'],
      rustTokens: ['cosmosdb_operation_request', 'litedb_operation_request', 'CosmosDB.ExportItems', 'LiteDB.ExportCollection', 'LiteDB.Backup'],
      actionTokens: ['data.import-export', 'data.backup-restore'],
    },
    {
      label: 'cache',
      profile: 'WAVE4_CACHE_PROFILE',
      manifestTokens: ['data.import-export'],
      plannerTokens: ['memcachedOperationRequest', 'lru_crawler metadump all', 'Values are not exported'],
      rustTokens: ['memcached_operation_request', 'lru_crawler metadump all', 'Values are not exported'],
      actionTokens: ['data.import-export', 'lru_crawler metadump'],
    },
    {
      label: 'analytics',
      profile: 'WAVE4_ANALYTICS_PROFILE',
      manifestTokens: ['data.import-export', 'data.backup-restore', 'duckdb.file.import'],
      plannerTokens: ['warehouseOperationRequest', 'duckDbOperationRequest', 'copy (select * from', 'BigQuery.ExtractJob', 'COPY INTO', 'INTO OUTFILE'],
      rustTokens: ['warehouse_operation_request', 'duckdb_operation_request', 'copy (select * from', 'BigQuery.ExtractJob', 'COPY INTO', 'INTO OUTFILE'],
      actionTokens: ['data.import-export', 'file.import'],
    },
    {
      label: 'time-series',
      profile: 'WAVE5_TIMESERIES_PROFILE',
      manifestTokens: ['data.import-export', 'prometheus.cardinality.analyze'],
      plannerTokens: ['timeSeriesOperationRequest', 'prometheus.range-export', 'line-protocol.export', 'line-protocol.import', '/api/query'],
      rustTokens: ['timeseries_operation_request', 'prometheus.range-export', 'line-protocol.export', 'line-protocol.import', '/api/query'],
      actionTokens: ['data.import-export', 'defaultExportFormat', 'result-snapshot-only'],
    },
    {
      label: 'graph',
      profile: 'WAVE5_GRAPH_PROFILE',
      manifestTokens: ['data.import-export'],
      plannerTokens: ['graphOperationRequest', 'Neptune.StartLoaderJob', '/_api/export', 'graph.export'],
      rustTokens: ['graph_operation_request', 'Neptune.StartLoaderJob', '/_api/export', 'neo4j.export'],
      actionTokens: ['data.import-export', 'neptune-bulk', 'graph-json'],
    },
  ]
  const failures = []
  const prometheusBlock = extractBacklogBlock(roadmapSource, 'prometheus') ?? ''

  if (!prometheusBlock.includes('supports_import_export')) {
    failures.push('prometheus: roadmap does not declare bounded export capability')
  }
  if (!browserOperationManifestGenericSource.includes("executionSupport: 'plan-only'")) {
    failures.push('browser generic import/export manifest does not remain plan-only')
  }
  if (!browserOperationManifestGenericSource.includes('adapter-specific file workflow')) {
    failures.push('browser generic import/export manifest does not keep file workflow disabled reason')
  }
  if (!rustOperationManifestSource.includes('"data.import-export"')) {
    failures.push('Rust generic import/export manifest is missing data.import-export')
  }

  for (const contract of contracts) {
    const profileBlock = extractProfileBlock(completenessSource, contract.profile)
    if (!new RegExp(`'import-export':\\s*strong\\(`).test(profileBlock)) {
      failures.push(`${contract.label}: import-export is not strong in ${contract.profile}`)
    }
    if (!profileBlock.includes('browser planners') || !profileBlock.includes('Rust planners')) {
      failures.push(`${contract.label}: completeness note does not mention browser/Rust import-export parity`)
    }
    if (!profileBlock.includes('Contract-only residual risk') || !profileBlock.includes('live')) {
      failures.push(`${contract.label}: completeness note does not keep live import/export residual risk`)
    }
    for (const token of contract.manifestTokens) {
      if (!browserManifestSource.includes(token)) {
        failures.push(`${contract.label}: browser import/export manifest missing ${token}`)
      }
    }
    for (const token of contract.plannerTokens) {
      if (!browserPlannerSource.includes(token)) {
        failures.push(`${contract.label}: browser import/export planner missing ${token}`)
      }
    }
    for (const token of contract.rustTokens) {
      if (!rustOperationManifestSource.includes(token) && !rustOperationPlanningSource.includes(token)) {
        failures.push(`${contract.label}: Rust import/export path missing ${token}`)
      }
    }
    for (const token of contract.actionTokens) {
      if (!objectActionSource.includes(token) && !browserPlannerSource.includes(token)) {
        failures.push(`${contract.label}: object-view import/export action missing ${token}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('production query starters do not invent fixture datastore objects', async () => {
  const productionSources = await Promise.all([
    files.treeManifest,
    files.rustTreeManifest,
    files.queryDefaults,
    files.workspaceHelpers,
    files.browserTabs,
    files.browserTests,
    files.testSuiteWorkspace,
    files.treeRegistry,
    files.fallbackTree,
  ].map(async (file) => [file, await read(file)]))
  const forbiddenDefaults = [
    /\{\{database:catalog\}\}/,
    /\{\{database:master\}\}/,
    /\{\{database:defaultdb\}\}/,
    /\{\{database:default\}\}/,
    /\{\{database:ORCLPDB1\}\}/,
    /defaultDatabase:\s*['"]catalog['"]/,
    /defaultDatabase:\s*['"]master['"]/,
    /defaultDatabase:\s*['"]defaultdb['"]/,
    /defaultDatabase:\s*['"]default['"]/,
    /defaultDatabase:\s*['"]ORCLPDB1['"]/,
    /NodeOptions::default_database\("catalog"\)/,
    /NodeOptions::default_database\("master"\)/,
    /NodeOptions::default_database\("defaultdb"\)/,
    /NodeOptions::default_database\("default"\)/,
    /NodeOptions::default_database\("ORCLPDB1"\)/,
    /"collection":\s*"products"/,
    /collection:\s*['"]products['"]/,
    /"tableName":\s*"products"/,
    /tableName:\s*['"]products['"]/,
    /"index":\s*"products/,
    /index:\s*['"]products/,
    /\|\|\s*['"]catalog['"]/,
    /\?\?\s*['"]catalog['"]/,
    /\|\|\s*['"]products['"]/,
    /\?\?\s*['"]products['"]/,
    /connection\.database\s*\|\|\s*['"]admin['"]/,
    /connection\.database\s*\|\|\s*['"]master['"]/,
    /connection\.database\s*\|\|\s*['"]defaultdb['"]/,
  ]
  const failures = []

  for (const [file, source] of productionSources) {
    for (const pattern of forbiddenDefaults) {
      if (pattern.test(source)) {
        failures.push(`${file}: contains production fixture/default object pattern ${pattern}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('database placeholders require explicit resolution rules', async () => {
  const source = await read(files.treeManifest)
  const lines = source.split(/\r?\n/)
  const failures = []

  for (const [index, line] of lines.entries()) {
    if (!line.includes('{{database')) {
      continue
    }

    const block = lines.slice(index, index + 24).join('\n')
    const hasInlineDefault = /\{\{database:[^}]+}}/.test(line)
    const hasExplicitDefault = /defaultDatabase:\s*['"][^'"]+['"]/.test(block)
    const requiresDatabase = /requiresDatabase:\s*true/.test(block)

    if (!hasInlineDefault && !hasExplicitDefault && !requiresDatabase) {
      const label = line.match(/['"]([^'"]*\{\{database[^'"]*)['"]/)?.[1] ?? '{{database}}'
      failures.push(`${label} on line ${index + 1}: missing requiresDatabase or explicit database default`)
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore object-view menu labels are workflow-specific', async () => {
  const descriptorDir = absolutePath('apps/desktop/src/app/components/workbench')
  const fileNames = await readdir(descriptorDir)
  const descriptorFiles = fileNames.filter((file) => file.endsWith('ObjectViewDescriptors.ts'))
  const failures = []

  for (const fileName of descriptorFiles) {
    const source = await read(`apps/desktop/src/app/components/workbench/${fileName}`)
    if (/descriptor\([^,\n]+,\s*['"]Open View['"]/.test(source) || /menuLabel:\s*['"]Open View['"]/.test(source)) {
      failures.push(`${fileName}: uses generic Open View menu label`)
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore object-view descriptors have focused contract tests', async () => {
  const descriptorDir = absolutePath('apps/desktop/src/app/components/workbench')
  const fileNames = await readdir(descriptorDir)
  const descriptorFiles = fileNames.filter((file) => file.endsWith('ObjectViewDescriptors.ts'))
  const testFiles = new Set(fileNames.filter((file) => file.endsWith('ObjectViewDescriptors.test.ts')))
  const failures = descriptorFiles
    .filter((file) => !testFiles.has(file.replace(/\.ts$/, '.test.ts')))
    .map((file) => `${file}: missing adjacent descriptor contract test`)

  assert.deepEqual(failures, [])
})
