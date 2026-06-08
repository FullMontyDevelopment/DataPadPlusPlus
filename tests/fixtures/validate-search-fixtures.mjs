import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const engines = [
  {
    label: 'OpenSearch',
    key: 'opensearch',
    container: 'datapadplusplus-opensearch',
    portKey: 'DATAPADPLUSPLUS_OPENSEARCH_PORT',
    fallbackPort: 9201,
  },
  {
    label: 'Elasticsearch',
    key: 'elasticsearch',
    container: 'datapadplusplus-elasticsearch',
    portKey: 'DATAPADPLUSPLUS_ELASTICSEARCH_PORT',
    fallbackPort: 9202,
  },
]
const checks = []
const notes = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function generatedEnvValue(key) {
  const generatedEnvPath = path.join(process.cwd(), 'tests', 'fixtures', '.generated.env')
  if (!existsSync(generatedEnvPath)) {
    return undefined
  }

  const line = readFileSync(generatedEnvPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${key}=`))

  return line?.slice(key.length + 1).trim()
}

function fixturePort(key, fallback) {
  const value = process.env[key] ?? generatedEnvValue(key) ?? String(fallback)
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${key} must be a positive integer port, got ${JSON.stringify(value)}`)
  }
  return port
}

function endpoint(engine) {
  return `http://127.0.0.1:${fixturePort(engine.portKey, engine.fallbackPort)}`
}

async function searchJson(engine, method, requestPath, body) {
  const response = await globalThis.fetch(`${endpoint(engine)}${requestPath}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    const error = new Error(`${engine.label} ${method} ${requestPath} failed: ${response.status} ${text}`)
    error.status = response.status
    error.bodyText = text
    throw error
  }

  return text ? JSON.parse(text) : {}
}

async function searchRaw(engine, method, requestPath, body, headers = {}) {
  const response = await globalThis.fetch(`${endpoint(engine)}${requestPath}`, {
    method,
    headers,
    body,
  })
  const text = await response.text()
  return { status: response.status, ok: response.ok, text }
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function expectAtLeast(value, expected, label) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < expected) {
    throw new Error(`${label} expected at least ${expected}, got ${JSON.stringify(value)}`)
  }
}

async function waitForSearch(engine) {
  let lastError
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await searchJson(engine, 'GET', '/')
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Timed out waiting for ${engine.label} at ${endpoint(engine)}: ${lastError?.message ?? 'unknown error'}`)
}

async function deleteIndexIfExists(engine, index) {
  const response = await searchRaw(engine, 'DELETE', `/${encodeURIComponent(index)}`)
  if (!response.ok && response.status !== 404) {
    throw new Error(`${engine.label} failed to delete transient index ${index}: ${response.status} ${response.text}`)
  }
}

async function validateSeededVolume(engine) {
  const indices = await searchJson(engine, 'GET', '/_cat/indices?format=json')
  expect(Array.isArray(indices), `${engine.label} _cat indices did not return an array`)
  expect(indices.some((index) => index.index === 'products'), `${engine.label} products index missing`)
  expect(indices.some((index) => index.index === 'orders'), `${engine.label} orders index missing`)

  const products = await searchJson(engine, 'GET', '/products/_count')
  const orders = await searchJson(engine, 'GET', '/orders/_count')
  expectAtLeast(products.count, 5000, `${engine.label} products count`)
  expectAtLeast(orders.count, 10000, `${engine.label} orders count`)
}

async function validateQueryProfileAndAggregations(engine) {
  const mapping = await searchJson(engine, 'GET', '/products/_mapping')
  expect(mapping.products?.mappings?.properties?.category?.type === 'keyword', `${engine.label} products category mapping missing`)
  expect(mapping.products?.mappings?.properties?.price?.type === 'double', `${engine.label} products price mapping missing`)

  const result = await searchJson(engine, 'POST', '/products/_search', {
    size: 5,
    profile: true,
    query: {
      bool: {
        filter: [
          { term: { category: 'lighting' } },
        ],
      },
    },
    aggs: {
      categories: { terms: { field: 'category', size: 6 } },
      price_stats: { stats: { field: 'price' } },
    },
    sort: [{ updated_at: 'desc' }],
  })

  expectAtLeast(result.hits?.hits?.length, 1, `${engine.label} profiled search hits`)
  expectAtLeast(result.aggregations?.categories?.buckets?.length, 1, `${engine.label} terms aggregation buckets`)
  expect(typeof result.aggregations?.price_stats?.avg === 'number', `${engine.label} stats aggregation average missing`)
  expectAtLeast(result.profile?.shards?.length, 1, `${engine.label} profile shards`)
}

async function validateDocumentEvidence(engine) {
  const index = `fixture-search-contract-${engine.key}`
  await deleteIndexIfExists(engine, index)
  await searchJson(engine, 'PUT', `/${index}`, {
    mappings: {
      properties: {
        status: { type: 'keyword' },
        count: { type: 'integer' },
      },
    },
  })

  try {
    await searchJson(engine, 'PUT', `/${index}/_doc/evidence-1?refresh=true`, {
      status: 'created',
      count: 1,
    })
    const before = await searchJson(engine, 'GET', `/${index}/_doc/evidence-1?realtime=true`)
    expect(before.found === true, `${engine.label} before document evidence missing`)
    expect(before._source?.status === 'created', `${engine.label} before document source mismatch`)

    await searchJson(engine, 'POST', `/${index}/_update/evidence-1?refresh=true`, {
      doc: {
        status: 'updated',
        count: 2,
      },
    })
    const after = await searchJson(engine, 'GET', `/${index}/_doc/evidence-1?realtime=true`)
    expect(after._source?.status === 'updated', `${engine.label} after document evidence missing`)
    expect(after._source?.count === 2, `${engine.label} after document count mismatch`)

    await searchJson(engine, 'DELETE', `/${index}/_doc/evidence-1?refresh=true`)
    const deleted = await searchRaw(engine, 'GET', `/${index}/_doc/evidence-1?realtime=true`)
    expect(deleted.status === 404, `${engine.label} delete evidence expected 404, got ${deleted.status}`)
  } finally {
    await deleteIndexIfExists(engine, index).catch((error) => {
      notes.push(`${engine.label} transient document-evidence cleanup failed: ${error.message}`)
    })
  }
}

async function validateDiagnostics(engine) {
  const settings = await searchJson(engine, 'GET', '/_settings?filter_path=**.search.slowlog*')
  expect(settings && typeof settings === 'object', `${engine.label} slow-log settings response was not an object`)

  const nodeStats = await searchJson(engine, 'GET', '/_nodes/stats/indices/search,indexing')
  expectAtLeast(nodeStats._nodes?.total, 1, `${engine.label} node stats node count`)

  const shards = await searchJson(engine, 'GET', '/_cat/shards?format=json&bytes=b')
  expect(Array.isArray(shards), `${engine.label} cat shards did not return an array`)
  expect(shards.some((shard) => shard.index === 'products'), `${engine.label} products shard row missing`)

  const allocation = await searchRaw(engine, 'GET', '/_cluster/allocation/explain')
  expect(
    allocation.ok || allocation.status === 400,
    `${engine.label} allocation explain expected success or no-unassigned-shard boundary, got ${allocation.status}`,
  )
}

async function validateImportExportBoundary(engine) {
  const index = `fixture-search-import-${engine.key}`
  await deleteIndexIfExists(engine, index)

  try {
    const exported = await searchJson(engine, 'POST', '/products/_search', {
      size: 3,
      sort: ['_doc'],
      query: { match_all: {} },
    })
    const hits = exported.hits?.hits ?? []
    expect(hits.length === 3, `${engine.label} bounded export expected 3 hits`)

    const lines = hits.flatMap((hit) => [
      JSON.stringify({ index: { _index: index, _id: hit._id } }),
      JSON.stringify(hit._source),
    ])
    const bulk = await searchRaw(engine, 'POST', '/_bulk?refresh=true', `${lines.join('\n')}\n`, {
      'content-type': 'application/x-ndjson',
    })
    expect(bulk.ok, `${engine.label} fixture bulk import failed: ${bulk.status} ${bulk.text}`)
    const bulkResult = JSON.parse(bulk.text)
    expect(bulkResult.errors === false, `${engine.label} fixture bulk import reported item errors`)

    const imported = await searchJson(engine, 'GET', `/${index}/_count`)
    expect(imported.count === 3, `${engine.label} fixture bulk import count mismatch`)

    const snapshots = await searchRaw(engine, 'GET', '/_snapshot/_all')
    expect(
      snapshots.ok || snapshots.status === 404 || snapshots.status === 400,
      `${engine.label} snapshot repository boundary returned unexpected status ${snapshots.status}`,
    )
    notes.push(`${engine.label} fixture validated bounded _search export and _bulk import primitives; desktop file/cloud import-export and snapshot execution remain outside the scoped native-complete claim.`)
  } finally {
    await deleteIndexIfExists(engine, index).catch((error) => {
      notes.push(`${engine.label} transient import/export cleanup failed: ${error.message}`)
    })
  }
}

function expectBoundaryStatus(engine, label, response, allowedStatuses) {
  if (response.ok) {
    return
  }

  expect(
    allowedStatuses.includes(response.status),
    `${engine.label} ${label} expected success or ${allowedStatuses.join('/')} boundary, got ${response.status}: ${response.text}`,
  )
}

async function validateOpenSearchPluginBoundaries(engine) {
  const sql = await searchRaw(engine, 'POST', '/_plugins/_sql', JSON.stringify({
    query: 'select * from products limit 5',
  }), {
    'content-type': 'application/json',
  })
  expectBoundaryStatus(engine, 'OpenSearch SQL plugin boundary evidence', sql, [
    400,
    404,
    405,
    501,
  ])
  if (sql.ok) {
    const payload = sql.text ? JSON.parse(sql.text) : {}
    expect(
      Array.isArray(payload.schema) || Array.isArray(payload.datarows),
      `${engine.label} OpenSearch SQL plugin response did not include schema or datarows`,
    )
    notes.push(`${engine.label} OpenSearch SQL plugin boundary evidence responded with a native payload.`)
  } else {
    notes.push(`${engine.label} OpenSearch SQL plugin boundary evidence returned ${sql.status}; SQL plugin execution remains optional outside the scoped native-complete claim.`)
  }

  const ism = await searchRaw(engine, 'GET', '/_plugins/_ism/explain/products')
  expectBoundaryStatus(engine, 'ISM plugin boundary evidence', ism, [
    400,
    404,
    405,
    501,
  ])

  const security = await searchRaw(engine, 'GET', '/_plugins/_security/api/roles')
  expectBoundaryStatus(engine, 'security plugin boundary evidence', security, [
    401,
    403,
    404,
    405,
    501,
  ])

  const performanceAnalyzer = await searchRaw(engine, 'GET', '/_plugins/_performanceanalyzer/metrics')
  expectBoundaryStatus(engine, 'Performance Analyzer boundary evidence', performanceAnalyzer, [
    400,
    404,
    405,
    501,
  ])

  notes.push(`${engine.label} OpenSearch ISM, security, and Performance Analyzer boundary evidence keeps plugin-specific surfaces explicit; managed SigV4/IAM, OpenSearch SQL execution, Performance Analyzer dashboards, and broader live admin execution remain outside the scoped native-complete claim unless separately validated.`)
}

const missing = engines.filter((engine) => !containerRunning(engine.container))
if (missing.length > 0) {
  throw new Error(
    `Search fixtures are not fully running (${missing.map((engine) => engine.container).join(', ')}). Run \`npm run fixtures:up:profile -- search && npm run fixtures:seed:all\` first.`,
  )
}

for (const engine of engines) {
  await waitForSearch(engine)
  await record(`${engine.label}: seeded index volume`, () => validateSeededVolume(engine))
  await record(`${engine.label}: mapping, aggregation, and profile evidence`, () => validateQueryProfileAndAggregations(engine))
  await record(`${engine.label}: explicit-id document edit before/after evidence`, () => validateDocumentEvidence(engine))
  await record(`${engine.label}: slow-log and allocation diagnostic evidence`, () => validateDiagnostics(engine))
  await record(`${engine.label}: bounded import/export primitive boundary evidence`, () => validateImportExportBoundary(engine))
  if (engine.key === 'opensearch') {
    await record(`${engine.label}: OpenSearch SQL, ISM, security, and Performance Analyzer boundary evidence`, () => validateOpenSearchPluginBoundaries(engine))
  }
}

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error.message)
  }
}

for (const note of notes) {
  console.log(`note - ${note}`)
}

if (failures.length > 0) {
  process.exitCode = 1
}
