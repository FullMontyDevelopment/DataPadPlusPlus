import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const roots = {
  packageJson: 'package.json',
  roadmap: 'packages/shared-types/src/datastore-roadmap.ts',
  rustRegistry: 'apps/desktop/src-tauri/src/adapters/registry.rs',
  runtimeRegistry: 'apps/desktop/src/services/runtime/datastores/registry.ts',
  workbenchRegistry: 'apps/desktop/src/app/components/workbench/datastores/registry.ts',
  rustDatastoreTests: 'apps/desktop/src-tauri/tests/unit/adapters/datastores',
  runtimeDatastoreTests: 'apps/desktop/tests/services/runtime/datastores',
  workbenchDatastoreTests: 'apps/desktop/tests/app/components/workbench/datastores',
}

const engineTestAliases = {
  rust: {
    cockroachdb: ['postgresql/cockroach_tests.rs', 'postgresql/cockroach'],
    elasticsearch: ['search'],
    mariadb: ['mysql'],
    opensearch: ['search'],
    timescaledb: ['postgresql/timescale'],
    valkey: ['redis'],
  },
  runtime: {
    arango: ['runtime-slice-registry.test.ts'],
    bigquery: ['runtime-slice-registry.test.ts'],
    cassandra: ['runtime-slice-registry.test.ts'],
    clickhouse: ['runtime-slice-registry.test.ts'],
    cockroachdb: ['runtime-slice-registry.test.ts'],
    cosmosdb: ['runtime-slice-registry.test.ts'],
    duckdb: ['runtime-slice-registry.test.ts'],
    dynamodb: ['runtime-slice-registry.test.ts'],
    elasticsearch: ['runtime-slice-registry.test.ts'],
    influxdb: ['runtime-slice-registry.test.ts'],
    janusgraph: ['runtime-slice-registry.test.ts'],
    litedb: ['runtime-slice-registry.test.ts'],
    mariadb: ['runtime-slice-registry.test.ts'],
    memcached: ['runtime-slice-registry.test.ts'],
    mysql: ['runtime-slice-registry.test.ts'],
    neo4j: ['runtime-slice-registry.test.ts'],
    neptune: ['runtime-slice-registry.test.ts'],
    opensearch: ['runtime-slice-registry.test.ts'],
    opentsdb: ['runtime-slice-registry.test.ts'],
    oracle: ['runtime-slice-registry.test.ts'],
    postgresql: ['runtime-slice-registry.test.ts'],
    prometheus: ['runtime-slice-registry.test.ts'],
    redis: ['common/keyvalue/browser-redis-explorer.test.ts', 'runtime-slice-registry.test.ts'],
    snowflake: ['runtime-slice-registry.test.ts'],
    sqlite: ['runtime-slice-registry.test.ts'],
    sqlserver: ['runtime-slice-registry.test.ts'],
    timescaledb: ['runtime-slice-registry.test.ts'],
    valkey: ['common/keyvalue/browser-redis-explorer.test.ts', 'runtime-slice-registry.test.ts'],
  },
  workbench: {
    arango: ['workbench-slice-registry.test.ts'],
    bigquery: ['workbench-slice-registry.test.ts'],
    elasticsearch: ['common/search', 'workbench-slice-registry.test.ts'],
    janusgraph: ['workbench-slice-registry.test.ts'],
    mariadb: ['common/sql', 'workbench-slice-registry.test.ts'],
    mysql: ['common/sql', 'workbench-slice-registry.test.ts'],
    neo4j: ['common/graph', 'workbench-slice-registry.test.ts'],
    neptune: ['common/graph', 'workbench-slice-registry.test.ts'],
    opensearch: ['common/search', 'workbench-slice-registry.test.ts'],
    redis: ['common/keyvalue', 'workbench-slice-registry.test.ts'],
    snowflake: ['common/warehouse', 'workbench-slice-registry.test.ts'],
    valkey: ['common/keyvalue', 'workbench-slice-registry.test.ts'],
  },
}

const allowedNonEngineTestRoots = {
  rust: ['common', 'planned', 'search'],
  runtime: ['common'],
  workbench: ['common'],
}

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath)
}

async function exists(relativePath) {
  try {
    await access(absolutePath(relativePath))
    return true
  } catch {
    return false
  }
}

async function read(relativePath) {
  if (relativePath === roots.roadmap) {
    const roadmapFiles = await sourceFiles('packages/shared-types/src/datastore-roadmap')
    return (await Promise.all([
      readFile(absolutePath(relativePath), 'utf8'),
      ...roadmapFiles.map((file) => readFile(absolutePath(file), 'utf8')),
    ])).join('\n')
  }
  return readFile(absolutePath(relativePath), 'utf8')
}

async function entries(relativePath) {
  return readdir(absolutePath(relativePath), { withFileTypes: true })
}

async function sourceFiles(relativePath, predicate = () => true) {
  if (!(await exists(relativePath))) {
    return []
  }

  const found = []

  for (const entry of await entries(relativePath)) {
    const child = path.join(relativePath, entry.name)

    if (entry.isDirectory()) {
      found.push(...await sourceFiles(child, predicate))
    } else if (predicate(entry.name)) {
      found.push(child.split(path.sep).join('/'))
    }
  }

  return found
}

function canonicalDatastores(roadmapSource) {
  return [...roadmapSource.matchAll(/engine:\s*'([^']+)'[\s\S]*?family:\s*'([^']+)'/g)]
    .map((match) => ({ engine: match[1], family: match[2] }))
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }

  return [...duplicates].sort()
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function registryEngineImports(source) {
  return [...source.matchAll(/from\s+['"]\.\/(?!types['"])([^'"]+)['"]/g)]
    .map((match) => match[1].split('/')[0])
    .filter((engine) => engine !== 'common')
}

function testRootForLayer(layer) {
  if (layer === 'rust') {
    return roots.rustDatastoreTests
  }
  if (layer === 'runtime') {
    return roots.runtimeDatastoreTests
  }
  return roots.workbenchDatastoreTests
}

function isTestFile(layer, fileName) {
  if (layer === 'rust') {
    return fileName.endsWith('.rs')
  }
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName)
}

async function coveragePathsFor(layer, engine) {
  const root = testRootForLayer(layer)
  const directRoot = `${root}/${engine}`
  const directCoverage = await sourceFiles(directRoot, (fileName) => isTestFile(layer, fileName))
  const aliasCoverage = []

  for (const alias of engineTestAliases[layer]?.[engine] ?? []) {
    const aliasPath = `${root}/${alias}`
    if ((await exists(aliasPath)) && isTestFile(layer, path.basename(aliasPath))) {
      aliasCoverage.push(aliasPath)
      continue
    }

    aliasCoverage.push(...await sourceFiles(aliasPath, (fileName) => isTestFile(layer, fileName)))
  }

  return [...directCoverage, ...aliasCoverage]
}

test('every datastore has an explicit test coverage path in each vertical slice layer', async () => {
  const datastores = canonicalDatastores(await read(roots.roadmap))
  const failures = []

  for (const { engine } of datastores) {
    for (const layer of ['rust', 'runtime', 'workbench']) {
      const coveragePaths = await coveragePathsFor(layer, engine)

      if (coveragePaths.length === 0) {
        failures.push(`${engine}: missing ${layer} test coverage path`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore test roots use canonical engine names, common, or documented shared implementations', async () => {
  const engines = new Set(canonicalDatastores(await read(roots.roadmap)).map(({ engine }) => engine))
  const failures = []

  for (const layer of ['rust', 'runtime', 'workbench']) {
    const root = testRootForLayer(layer)
    const allowedRoots = new Set([...engines, ...allowedNonEngineTestRoots[layer]])

    for (const entry of await entries(root)) {
      if (entry.isDirectory() && !allowedRoots.has(entry.name)) {
        failures.push(`${root}/${entry.name}: test root is not a canonical engine or allowed common root`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore registry smoke tests derive expected engines from the shared roadmap', async () => {
  const registrySmokeTests = {
    runtime: `${roots.runtimeDatastoreTests}/runtime-slice-registry.test.ts`,
    workbench: `${roots.workbenchDatastoreTests}/workbench-slice-registry.test.ts`,
  }
  const failures = []

  for (const file of Object.values(registrySmokeTests)) {
    const source = await read(file)

    if (!source.includes('DATASTORE_ENGINES')) {
      failures.push(`${file}: registry smoke test should derive expected engines from DATASTORE_ENGINES`)
    }
    if (!/toEqual\(\[\.\.\.[A-Z_]+_ENGINES\]\.sort\(\)\)/.test(source)) {
      failures.push(`${file}: registry smoke test should compare against the complete sorted engine list`)
    }
  }

  const runtimeRegistrySource = await read(registrySmokeTests.runtime)
  const workbenchRegistrySource = await read(registrySmokeTests.workbench)

  for (const token of [
    'DATASTORE_FEATURE_BACKLOG',
    'createExplorerNodes',
    'inspectExplorerNodeLocally',
    'buildOperationManifestsForConnection',
    'planOperationLocally',
  ]) {
    if (!runtimeRegistrySource.includes(token)) {
      failures.push(`${registrySmokeTests.runtime}: missing runtime behavior smoke for ${token}`)
    }
  }

  const runtimeOperationContractSource = await read(`${roots.runtimeDatastoreTests}/runtime-operation-contract.test.ts`)
  const runtimeDataEditContractSource = await read(`${roots.runtimeDatastoreTests}/runtime-data-edit-contract.test.ts`)
  const workbenchObjectRoutingSource = await read(`${roots.workbenchDatastoreTests}/workbench-object-view-routing.test.ts`)

  for (const token of [
    'DATASTORE_FEATURE_BACKLOG',
    'buildOperationManifestsForConnection',
    'planOperationLocally',
    'can prepare a guarded plan for every advertised operation',
  ]) {
    if (!runtimeOperationContractSource.includes(token)) {
      failures.push(`${roots.runtimeDatastoreTests}/runtime-operation-contract.test.ts: missing operation contract coverage for ${token}`)
    }
  }

  for (const token of [
    'DATASTORE_FEATURE_BACKLOG',
    'buildDatastoreExperiences',
    'planDataEditLocally',
    'runtimeSliceForEngine',
    'routes every editable datastore through a typed runtime slice data-edit hook',
  ]) {
    if (!runtimeDataEditContractSource.includes(token)) {
      failures.push(`${roots.runtimeDatastoreTests}/runtime-data-edit-contract.test.ts: missing data-edit contract coverage for ${token}`)
    }
  }

  for (const token of [
    'objectViewWorkspace',
    'relationalDescriptor',
    'relationalInsights',
    'warehouseInsights',
  ]) {
    if (!workbenchRegistrySource.includes(token)) {
      failures.push(`${registrySmokeTests.workbench}: missing workbench hook smoke for ${token}`)
    }
  }

  for (const token of [
    'DATASTORE_FEATURE_BACKLOG',
    'createExplorerNodes',
    'buildConnectionObjectTreeFromExplorerNodes',
    'isObjectViewNode',
    'recognizes object-view nodes produced by every runtime datastore slice',
  ]) {
    if (!workbenchObjectRoutingSource.includes(token)) {
      failures.push(`${roots.workbenchDatastoreTests}/workbench-object-view-routing.test.ts: missing object-view routing coverage for ${token}`)
    }
  }

  assert.deepEqual(failures, [])
})

test('native, runtime, and workbench registries contain exactly one entry per roadmap engine', async () => {
  const expectedEngines = canonicalDatastores(await read(roots.roadmap)).map(({ engine }) => engine)
  const registrySources = {
    native: {
      file: roots.rustRegistry,
      engines: [...(await read(roots.rustRegistry))
        .matchAll(/AdapterRegistration\s*\{\s*engine:\s*"([^"]+)"/g)]
        .map((match) => match[1]),
    },
    runtime: {
      file: roots.runtimeRegistry,
      engines: registryEngineImports(await read(roots.runtimeRegistry)),
    },
    workbench: {
      file: roots.workbenchRegistry,
      engines: registryEngineImports(await read(roots.workbenchRegistry)),
    },
  }
  const expectedSorted = [...expectedEngines].sort()
  const failures = []

  for (const [layer, registry] of Object.entries(registrySources)) {
    const duplicates = duplicateValues(registry.engines)

    if (duplicates.length > 0) {
      failures.push(`${registry.file}: duplicate ${layer} registry engine entries: ${duplicates.join(', ')}`)
    }

    const actualSorted = sortedUnique(registry.engines)
    if (actualSorted.join('\n') !== expectedSorted.join('\n')) {
      const missing = expectedSorted.filter((engine) => !actualSorted.includes(engine))
      const extra = actualSorted.filter((engine) => !expectedSorted.includes(engine))

      if (missing.length > 0) {
        failures.push(`${registry.file}: missing ${layer} registry engines: ${missing.join(', ')}`)
      }
      if (extra.length > 0) {
        failures.push(`${registry.file}: extra ${layer} registry engines: ${extra.join(', ')}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('aggregate quality gates include datastore coverage and test-target linting', async () => {
  const packageJson = JSON.parse(await read(roots.packageJson))
  const scripts = packageJson.scripts ?? {}
  const failures = []

  if (!/node --test tests\/quality\/\*\.test\.mjs/.test(scripts['quality:test'] ?? '')) {
    failures.push('quality:test should run every tests/quality/*.test.mjs file')
  }
  if (!/\bquality:test\b/.test(scripts['check:all'] ?? '')) {
    failures.push('check:all should include quality:test')
  }
  if (!/\brust:clippy\b/.test(scripts['check:native'] ?? '')) {
    failures.push('check:native should include rust:clippy')
  }
  if (!/--all-targets/.test(scripts['rust:clippy'] ?? '')) {
    failures.push('rust:clippy should lint Rust tests with --all-targets')
  }

  assert.deepEqual(failures, [])
})
