import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const files = {
  connection: 'packages/shared-types/src/connection.ts',
  roadmap: 'packages/shared-types/src/datastore-roadmap.ts',
  treeManifest: 'packages/shared-types/src/datastore-tree-manifests.ts',
  rustRegistry: 'apps/desktop/src-tauri/src/adapters/registry.rs',
  objectViewRouter: 'apps/desktop/src/app/components/workbench/ObjectViewWorkspace.tsx',
  browserExplorer: 'apps/desktop/src/services/runtime/browser-explorer.ts',
  treeRegistry: 'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
  fallbackTree: 'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
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
