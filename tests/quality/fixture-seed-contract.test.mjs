import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath)
}

async function read(relativePath) {
  return readFile(absolutePath(relativePath), 'utf8')
}

async function exists(relativePath) {
  try {
    await access(absolutePath(relativePath))
    return true
  } catch {
    return false
  }
}

test('fixture seed runner executes all datastore init scripts in order', async () => {
  const seedSource = await read('tests/fixtures/seed.mjs')
  const requiredFolders = [
    'postgres',
    'mysql',
    'sqlserver',
    'mariadb',
    'cockroach',
    'timescaledb',
    'clickhouse',
    'cassandra',
    'oracle',
  ]
  const failures = []

  assert.match(seedSource, /function fixtureInitScripts\(folder/)
  assert.match(seedSource, /function seedSqlFolderWithStdin\(/)

  for (const folder of requiredFolders) {
    if (!seedSource.includes(`fixtureInitScripts('${folder}'`) && !seedSource.includes(`'${folder}',`)) {
      failures.push(`${folder}: seed runner is not wired to read the init folder`)
    }
  }

  assert.deepEqual(failures, [])
})

test('fixture datastores include richer real-world data scripts', async () => {
  const expectedScripts = [
    'tests/fixtures/postgres/init/002_real_world.sql',
    'tests/fixtures/mysql/init/002_real_world.sql',
    'tests/fixtures/sqlserver/init/002_real_world.sql',
    'tests/fixtures/mariadb/init/002_real_world.sql',
    'tests/fixtures/cockroach/init/002_real_world.sql',
    'tests/fixtures/timescaledb/init/002_real_world.sql',
    'tests/fixtures/clickhouse/init/002_real_world.sql',
    'tests/fixtures/oracle/init/002_real_world.sql',
  ]
  const missing = []

  for (const script of expectedScripts) {
    if (!(await exists(script))) {
      missing.push(script)
    }
  }

  assert.deepEqual(missing, [])

  const checks = [
    ['tests/fixtures/postgres/init/002_real_world.sql', /order_items[\s\S]*support_tickets[\s\S]*audit_log/i],
    ['tests/fixtures/mysql/init/002_real_world.sql', /order_items[\s\S]*support_tickets[\s\S]*foreign key[\s\S]*order_fulfillment_summary/i],
    ['tests/fixtures/sqlserver/init/002_real_world.sql', /dbo\.order_items[\s\S]*dbo\.support_tickets[\s\S]*foreign key[\s\S]*order_fulfillment_summary/i],
    ['tests/fixtures/cockroach/init/002_real_world.sql', /order_items[\s\S]*support_tickets[\s\S]*foreign key[\s\S]*order_fulfillment_summary/i],
    ['tests/fixtures/timescaledb/init/002_real_world.sql', /system_metrics[\s\S]*generate_series\(1, 100000\)/i],
    ['tests/fixtures/clickhouse/init/002_real_world.sql', /analytics\.events[\s\S]*numbers\(250000\)[\s\S]*analytics\.order_items/i],
    ['tests/fixtures/oracle/init/002_real_world.sql', /order_items[\s\S]*support_tickets[\s\S]*foreign key[\s\S]*order_fulfillment_summary/i],
  ]
  const failures = []

  for (const [script, pattern] of checks) {
    const source = await read(script)
    if (!pattern.test(source)) {
      failures.push(`${script}: missing expected real-world fixture objects`)
    }
  }

  assert.deepEqual(failures, [])
})

test('fixture volume defaults stay large enough for workbench performance coverage', async () => {
  const [seedSource, mongoSource, readmeSource, connectionsSource] = await Promise.all([
    read('tests/fixtures/seed.mjs'),
    read('tests/fixtures/mongodb/init/001_seed.js'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
  ])

  assert.match(seedSource, /DATAPADPLUSPLUS_REDIS_PERF_KEYS \?\? '100000'/)
  assert.match(seedSource, /DATAPADPLUSPLUS_INFLUX_POINTS \?\? '50000'/)
  assert.match(seedSource, /bulkIndexSearchDocuments\(port, 'products', generatedProducts\)/)
  assert.match(seedSource, /bulkIndexSearchDocuments\(port, 'orders', generatedOrders\)/)
  assert.match(seedSource, /BatchWriteItem/)
  assert.match(seedSource, /orders_by_account/)
  assert.match(mongoSource, /const largeDocumentTargetCount = 12/)
  assert.match(mongoSource, /const perfTargetCount = 150000/)
  assert.match(readmeSource, /150,000 documents \/ 12 multi-MB documents/)
  assert.match(readmeSource, /100,000 keys/)
  assert.match(readmeSource, /250,000 \/ 75,000 rows/)
  assert.match(readmeSource, /50-100 rows\/documents\/nodes per query/)
  assert.match(connectionsSource, /catalog\.largeDocuments/)
  assert.match(connectionsSource, /order_events/)
})

test('Redis optional fixtures cover module and stream-group evidence paths', async () => {
  const [packageSource, seedSource, readmeSource, connectionsSource, strategySource, validatorSource] =
    await Promise.all([
      read('package.json'),
      read('tests/fixtures/seed.mjs'),
      read('tests/fixtures/README.md'),
      read('tests/fixtures/CONNECTIONS.md'),
      read('docs/testing/strategy.md'),
      read('tests/fixtures/validate-redis-fixtures.mjs'),
    ])

  assert.match(packageSource, /"fixtures:validate:redis": "node tests\/fixtures\/validate-redis-fixtures\.mjs"/)
  assert.match(seedSource, /XGROUP[\s\S]*CREATE[\s\S]*stream:orders[\s\S]*fulfillment/)
  assert.match(seedSource, /XREADGROUP[\s\S]*GROUP[\s\S]*fulfillment[\s\S]*worker-1/)
  assert.match(seedSource, /JSON\.SET[\s\S]*json:account:1/)
  assert.match(seedSource, /TS\.ADD[\s\S]*ts:orders:throughput/)
  assert.match(seedSource, /BF\.RESERVE[\s\S]*bf:seen-orders/)
  assert.match(seedSource, /CF\.RESERVE[\s\S]*cf:skus/)
  assert.match(seedSource, /CMS\.INITBYDIM[\s\S]*cms:regions/)
  assert.match(seedSource, /TOPK\.RESERVE[\s\S]*topk:products/)
  assert.match(seedSource, /TDIGEST\.CREATE[\s\S]*tdigest:latency/)
  assert.match(seedSource, /VADD[\s\S]*vectors:products/)
  assert.match(validatorSource, /--require-stack/)
  assert.match(validatorSource, /--require-vector/)
  assert.match(validatorSource, /JSON\.GET/)
  assert.match(validatorSource, /TS\.RANGE/)
  assert.match(validatorSource, /BF\.EXISTS/)
  assert.match(validatorSource, /DUMP/)
  assert.match(validatorSource, /RESTORE/)
  assert.match(validatorSource, /fixture:snapshot:tdigest:latency/)
  assert.match(validatorSource, /VGETATTR/)
  assert.match(validatorSource, /Valkey.*core key file export\/import primitives/s)
  assert.match(validatorSource, /fixture:key-file:stream/)
  assert.match(validatorSource, /Valkey: permission failure evidence for guarded writes/)
  assert.match(validatorSource, /fixture_valkey_readonly/)
  assert.match(validatorSource, /Valkey: large key file export\/import primitives/)
  assert.match(validatorSource, /fixture:key-file:large:stream/)
  assert.match(readmeSource, /fixtures:validate:redis -- --require-stack --require-valkey/)
  assert.match(readmeSource, /--require-vector/)
  assert.match(readmeSource, /permission-denied guarded writes/)
  assert.match(strategySource, /large key-file primitives/)
  assert.match(strategySource, /--require-vector/)
  assert.match(connectionsSource, /stream:orders` with `fulfillment` consumer-group state/)
  assert.match(connectionsSource, /large key-file, and permission-denial primitives/)
  assert.match(connectionsSource, /tdigest:latency[\s\S]*vectors:products/)
  assert.match(strategySource, /Redis reference-engine fixture evidence path/)
})

test('MongoDB optional fixtures cover import-export and permission evidence paths', async () => {
  const [packageSource, readmeSource, connectionsSource, strategySource, validatorSource] =
    await Promise.all([
      read('package.json'),
      read('tests/fixtures/README.md'),
      read('tests/fixtures/CONNECTIONS.md'),
      read('docs/testing/strategy.md'),
      read('tests/fixtures/validate-mongodb-fixtures.mjs'),
    ])

  assert.match(packageSource, /"fixtures:validate:mongodb": "node tests\/fixtures\/validate-mongodb-fixtures\.mjs"/)
  assert.match(validatorSource, /MongoDB: seeded catalog and large collections/)
  assert.match(validatorSource, /MongoDB: collection export\/import primitives/)
  assert.match(validatorSource, /MongoDB: duplicate-key and validator failure evidence/)
  assert.match(validatorSource, /MongoDB: permission-specific diagnostics denial evidence/)
  assert.match(validatorSource, /MongoDB: management before\/after evidence/)
  assert.match(validatorSource, /fixture_mongodb_readonly/)
  assert.match(validatorSource, /serverStatus/)
  assert.match(validatorSource, /currentOp/)
  assert.match(validatorSource, /fixture_mongodb_import_export/)
  assert.match(validatorSource, /fixture_mongodb_management/)
  assert.match(readmeSource, /fixtures:validate:mongodb/)
  assert.match(readmeSource, /duplicate-key and validator failure evidence/)
  assert.match(strategySource, /MongoDB reference-engine fixture evidence path/)
  assert.match(connectionsSource, /fixture_mongodb_import_export/)
  assert.match(connectionsSource, /fixture_mongodb_readonly/)
})

test('PostgreSQL optional fixtures cover native-complete evidence paths', async () => {
  const [
    packageSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
    completenessSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-postgres-fixtures.mjs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:postgres": "node tests\/fixtures\/validate-postgres-fixtures\.mjs"/)
  assert.match(validatorSource, /PostgreSQL: seeded relational and volume fixtures/)
  assert.match(validatorSource, /PostgreSQL: catalog, security, and extension surfaces/)
  assert.match(validatorSource, /PostgreSQL: diagnostics, locks, and session action primitives/)
  assert.match(validatorSource, /pg_cancel_backend/)
  assert.match(validatorSource, /pg_terminate_backend/)
  assert.match(validatorSource, /PostgreSQL: rendered profile and routine primitives/)
  assert.match(validatorSource, /EXPLAIN ANALYZE/)
  assert.match(validatorSource, /PostgreSQL: row-edit before\/after evidence primitives/)
  assert.match(validatorSource, /PostgreSQL: table import\/export and bounded backup primitives/)
  assert.match(validatorSource, /PostgreSQL: permission-denied guard evidence/)
  assert.match(validatorSource, /fixture_postgres_readonly/)
  assert.match(validatorSource, /full pg_dump\/pg_restore parity remains outside the scoped claim/)
  assert.match(readmeSource, /fixtures:validate:postgres/)
  assert.match(readmeSource, /bounded logical backup/)
  assert.match(strategySource, /PostgreSQL reference-engine fixture evidence path/)
  assert.match(strategySource, /`?pg_dump`?\/`?pg_restore`? execution remains outside the scoped native-complete claim/)
  assert.match(connectionsSource, /fixtures:validate:postgres/)
  assert.match(connectionsSource, /fixture_postgres_readonly/)
  assert.match(completenessSource, /'postgresql',/)
  assert.match(completenessSource, /Native-complete for the scoped PostgreSQL workflow/)
})

test('cloud contract mocks return realistic lists and row counts', async () => {
  const source = await read('tests/fixtures/cloud-contract/server.mjs')

  assert.match(source, /tableId: 'order_items'/)
  assert.match(source, /numRows: '250000'/)
  assert.match(source, /Array\.from\(\{ length: 100 \}/)
  assert.match(source, /DocumentCollections/)
  assert.match(source, /Array\.from\(\{ length: 50 \}/)
})
