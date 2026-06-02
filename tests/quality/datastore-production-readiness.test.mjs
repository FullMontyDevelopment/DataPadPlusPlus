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
  objectViewRouter: 'apps/desktop/src/app/components/workbench/ObjectViewWorkspace.tsx',
  browserExplorer: 'apps/desktop/src/services/runtime/browser-explorer.ts',
  treeRegistry: 'apps/desktop/src/app/components/workbench/SideBar.datastore-tree-registry.ts',
  fallbackTree: 'apps/desktop/src/app/components/workbench/SideBar.connection-tree.ts',
  queryDefaults: 'apps/desktop/src/app/state/query-defaults.ts',
  workspaceHelpers: 'apps/desktop/src/app/workspace-helpers.ts',
  browserTabs: 'apps/desktop/src/services/runtime/browser-tabs.ts',
  browserTests: 'apps/desktop/src/services/runtime/browser-tests.ts',
  testSuiteWorkspace: 'apps/desktop/src/app/components/workbench/TestSuiteWorkspace.tsx',
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
