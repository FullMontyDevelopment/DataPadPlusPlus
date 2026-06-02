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

test('cloud contract mocks return realistic lists and row counts', async () => {
  const source = await read('tests/fixtures/cloud-contract/server.mjs')

  assert.match(source, /tableId: 'order_items'/)
  assert.match(source, /numRows: '250000'/)
  assert.match(source, /Array\.from\(\{ length: 100 \}/)
  assert.match(source, /DocumentCollections/)
  assert.match(source, /Array\.from\(\{ length: 50 \}/)
})
