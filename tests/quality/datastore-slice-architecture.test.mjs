import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

const roots = {
  roadmap: 'packages/shared-types/src/datastore-roadmap.ts',
  rustDatastores: 'apps/desktop/src-tauri/src/adapters/datastores',
  rustRegistry: 'apps/desktop/src-tauri/src/adapters/registry.rs',
  runtime: 'apps/desktop/src/services/runtime',
  runtimeSlices: 'apps/desktop/src/services/runtime/datastores',
  workbench: 'apps/desktop/src/app/components/workbench',
  workbenchSlices: 'apps/desktop/src/app/components/workbench/datastores',
}

const engineAliases = {
  cockroachdb: ['cockroach'],
  dynamodb: ['dynamo'],
  elasticsearch: ['search', 'elastic'],
  mariadb: ['mysql'],
  mongodb: ['mongo'],
  opensearch: ['search'],
  postgresql: ['postgres'],
  timescaledb: ['timescale'],
}

const familyAliases = {
  'embedded-olap': ['embedded-olap', 'olap'],
  document: ['document', 'documents', 'nosql'],
  graph: ['graph'],
  keyvalue: ['keyvalue', 'key-value'],
  search: ['search'],
  sql: ['sql', 'relational'],
  timeseries: ['timeseries', 'time-series'],
  warehouse: ['warehouse', 'cloud-warehouse'],
  widecolumn: ['widecolumn', 'wide-column'],
}

const legacyRuntimePrefixes = [
  'browser-arango',
  'browser-bigquery',
  'browser-cassandra',
  'browser-clickhouse',
  'browser-cloud-warehouse',
  'browser-cockroach',
  'browser-cosmos',
  'browser-duckdb',
  'browser-dynamo',
  'browser-dynamodb',
  'browser-graph',
  'browser-influx',
  'browser-litedb',
  'browser-memcached',
  'browser-mongo',
  'browser-mysql',
  'browser-neo4j',
  'browser-neptune',
  'browser-opentsdb',
  'browser-oracle',
  'browser-postgres',
  'browser-prometheus',
  'browser-redis',
  'browser-search',
  'browser-snowflake',
  'browser-sqlite',
  'browser-sqlserver',
  'browser-timescale',
  'browser-timeseries',
  'browser-warehouse',
  'browser-widecolumn',
  'request-validation-cassandra',
  'request-validation-cosmosdb',
  'request-validation-documents',
  'request-validation-dynamodb',
  'request-validation-graph',
  'request-validation-memcached',
  'request-validation-mongodb',
  'request-validation-mysql',
  'request-validation-postgres',
  'request-validation-search',
  'request-validation-sqlserver',
  'request-validation-timeseries',
  'request-validation-warehouse',
]

const legacyWorkbenchPrefixes = [
  'Arango',
  'BigQuery',
  'Cassandra',
  'ClickHouse',
  'CloudWarehouse',
  'Cockroach',
  'Cosmos',
  'DuckDb',
  'Dynamo',
  'Graph',
  'Influx',
  'LiteDb',
  'Memcached',
  'Mongo',
  'Mysql',
  'Neo4j',
  'Neptune',
  'OpenTsdb',
  'Oracle',
  'Postgres',
  'Prometheus',
  'Redis',
  'Relational',
  'Search',
  'Sqlite',
  'SqlServer',
  'TimeSeries',
  'Warehouse',
  'WideColumn',
]

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
    const roadmapFiles = await sourceFiles('packages/shared-types/src/datastore-roadmap', ['.ts'])
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

async function sourceFiles(relativePath, extensions) {
  const found = []

  for (const entry of await entries(relativePath)) {
    const child = path.join(relativePath, entry.name)

    if (entry.isDirectory()) {
      found.push(...await sourceFiles(child, extensions))
    } else if (extensions.includes(path.extname(entry.name))) {
      found.push(child.split(path.sep).join('/'))
    }
  }

  return found
}

function canonicalDatastores(roadmapSource) {
  return [...roadmapSource.matchAll(/engine:\s*'([^']+)'[\s\S]*?family:\s*'([^']+)'/g)]
    .map((match) => ({ engine: match[1], family: match[2] }))
}

function sliceTokens(engine, family) {
  return new Set([
    engine,
    ...(engineAliases[engine] ?? []),
    family,
    ...(familyAliases[family] ?? []),
  ])
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function resolveImport(file, specifier) {
  return normalizeRelativePath(path.normalize(path.join(path.dirname(file), specifier))).toLowerCase()
}

test('every datastore has native, runtime, and workbench slice entrypoints', async () => {
  const datastores = canonicalDatastores(await read(roots.roadmap))
  const failures = []

  for (const { engine } of datastores) {
    if (!(await exists(`${roots.rustDatastores}/${engine}/mod.rs`))) {
      failures.push(`${engine}: missing native Rust slice mod.rs`)
    }
    if (!(await exists(`${roots.runtimeSlices}/${engine}/index.ts`))) {
      failures.push(`${engine}: missing browser-runtime slice index.ts`)
    }
    if (!(await exists(`${roots.workbenchSlices}/${engine}/index.ts`))) {
      failures.push(`${engine}: missing workbench slice index.ts`)
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore family shared code lives in explicit common folders', async () => {
  const families = new Set(canonicalDatastores(await read(roots.roadmap)).map(({ family }) => family))
  const failures = []

  for (const family of families) {
    if (!(await exists(`${roots.rustDatastores}/common/${family}/mod.rs`))) {
      failures.push(`${family}: missing native Rust common folder`)
    }
    if (!(await exists(`${roots.runtimeSlices}/common/${family}/index.ts`))) {
      failures.push(`${family}: missing runtime common folder`)
    }
    if (!(await exists(`${roots.workbenchSlices}/common/${family}/index.ts`))) {
      failures.push(`${family}: missing workbench common folder`)
    }
  }

  assert.deepEqual(failures, [])
})

test('legacy shared roots do not contain datastore-prefixed implementation files', async () => {
  const runtimeFiles = (await entries(roots.runtime))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const workbenchFiles = (await entries(roots.workbench))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const failures = []

  for (const file of runtimeFiles) {
    if (legacyRuntimePrefixes.some((prefix) => file.startsWith(prefix))) {
      failures.push(`${roots.runtime}/${file}: move datastore runtime code into a slice folder`)
    }
  }

  for (const file of workbenchFiles) {
    if (legacyWorkbenchPrefixes.some((prefix) => file.startsWith(prefix))) {
      failures.push(`${roots.workbench}/${file}: move datastore workbench code into a slice folder`)
    }
  }

  assert.deepEqual(failures, [])
})

test('datastore slices only import their own slice, common family helpers, or public registries', async () => {
  const datastores = canonicalDatastores(await read(roots.roadmap))
  const failures = []

  for (const { engine, family } of datastores) {
    const tokens = sliceTokens(engine, family)
    const sliceRoots = [
      `${roots.runtimeSlices}/${engine}`,
      `${roots.workbenchSlices}/${engine}`,
    ]

    for (const sliceRoot of sliceRoots) {
      if (!(await exists(sliceRoot))) {
        continue
      }

      for (const file of await sourceFiles(sliceRoot, ['.ts', '.tsx'])) {
        const source = await read(file)
        const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])

        for (const specifier of imports) {
          if (!specifier.startsWith('.')) {
            continue
          }

          const resolved = resolveImport(file, specifier)
          const normalizedRoot = sliceRoot.toLowerCase()
          const runtimeCommon = `${roots.runtimeSlices}/common/`.toLowerCase()
          const workbenchCommon = `${roots.workbenchSlices}/common/`.toLowerCase()
          const runtimeDatastores = `${roots.runtimeSlices}/`.toLowerCase()
          const workbenchDatastores = `${roots.workbenchSlices}/`.toLowerCase()

          if (
            resolved.startsWith(`${normalizedRoot}/`) ||
            resolved === normalizedRoot ||
            resolved.startsWith(runtimeCommon) ||
            resolved.startsWith(workbenchCommon) ||
            resolved.endsWith('/registry') ||
            resolved.endsWith('/types')
          ) {
            continue
          }

          const referencesOtherSlice =
            (resolved.startsWith(runtimeDatastores) || resolved.startsWith(workbenchDatastores)) &&
            !resolved.includes(`/datastores/${engine}/`) &&
            !resolved.includes('/datastores/common/')

          const referencesLegacyPeer =
            /^(\.\.\/|\.\.\/\.\.\/|\.\/)(browser-|request-validation-|[A-Z][A-Za-z0-9]+ObjectView|Relational|TimeSeries|Warehouse)/.test(specifier)
            && ![...tokens].some((token) => specifier.toLowerCase().includes(token.toLowerCase()))

          if (referencesOtherSlice || referencesLegacyPeer) {
            failures.push(`${file}: imports cross-slice implementation ${specifier}`)
          }
        }
      }
    }
  }

  assert.deepEqual(failures, [])
})

test('native adapter registry uses one registration source for dispatch', async () => {
  const registrySource = await read(roots.rustRegistry)
  const failures = []

  if (!/fn adapter_registrations\(\)\s*->\s*&'static\s*\[AdapterRegistration\]/.test(registrySource)) {
    failures.push('registry.rs should expose one adapter_registrations() source')
  }
  if (!/pub fn manifests\(\)[\s\S]*adapter_registrations\(\)/.test(registrySource)) {
    failures.push('manifests() should derive from adapter_registrations()')
  }
  if (!/pub fn execution_capabilities\(engine: &str\)[\s\S]*adapter_registration_for_engine/.test(registrySource)) {
    failures.push('execution_capabilities() should derive from adapter_registrations()')
  }
  if (!/pub\(crate\) fn adapter_for_engine\(engine: &str\)[\s\S]*adapter_registration_for_engine/.test(registrySource)) {
    failures.push('adapter_for_engine() should derive from adapter_registrations()')
  }

  assert.deepEqual(failures, [])
})

test('runtime shell routers delegate through datastore slice registry', async () => {
  const shellRouters = [
    'apps/desktop/src/services/runtime/browser-explorer.ts',
    'apps/desktop/src/services/runtime/browser-operations.ts',
    'apps/desktop/src/services/runtime/browser-data-edit-requests.ts',
  ]
  const failures = []

  for (const file of shellRouters) {
    const source = await read(file)

    if (!source.includes('runtimeSliceForEngine')) {
      failures.push(`${file}: should delegate datastore-specific behavior through runtimeSliceForEngine()`)
    }

    const directDatastoreImports = [...source.matchAll(/from\s+['"]\.\/datastores\/(?!registry|types|common)([^'"]+)['"]/g)]
      .map((match) => match[0])

    for (const datastoreImport of directDatastoreImports) {
      failures.push(`${file}: shell router imports datastore implementation directly (${datastoreImport})`)
    }
  }

  assert.deepEqual(failures, [])
})

test('workbench shell routers delegate through datastore slice registry', async () => {
  const shellRouters = [
    'apps/desktop/src/app/components/workbench/ObjectViewWorkspace.tsx',
  ]
  const failures = []

  for (const file of shellRouters) {
    const source = await read(file)

    if (!source.includes('workbenchSliceForEngine')) {
      failures.push(`${file}: should delegate datastore-specific behavior through workbenchSliceForEngine()`)
    }

    const directDatastoreImports = [...source.matchAll(/from\s+['"]\.\/datastores\/(?!registry|types)([^'"]+)['"]/g)]
      .map((match) => match[0])

    for (const datastoreImport of directDatastoreImports) {
      failures.push(`${file}: shell router imports datastore implementation directly (${datastoreImport})`)
    }
  }

  assert.deepEqual(failures, [])
})

test('common family helpers do not import engine slices', async () => {
  const commonRoots = [
    roots.runtimeSlices,
    roots.workbenchSlices,
  ]
  const failures = []

  for (const root of commonRoots) {
    const commonRoot = `${root}/common`
    if (!(await exists(commonRoot))) {
      continue
    }

    for (const file of await sourceFiles(commonRoot, ['.ts', '.tsx'])) {
      const source = await read(file)
      const engineSliceImport = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((match) => match[1])
        .filter((specifier) => specifier.startsWith('.'))
        .find((specifier) => {
          const resolved = resolveImport(file, specifier)
          const rootPrefix = `${root}/`.toLowerCase()
          return resolved.startsWith(rootPrefix) &&
            !resolved.startsWith(`${root}/common/`.toLowerCase()) &&
            !resolved.endsWith('/registry') &&
            !resolved.endsWith('/types')
        })

      if (engineSliceImport) {
        failures.push(`${file}: common helper imports engine slice ${engineSliceImport}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})
