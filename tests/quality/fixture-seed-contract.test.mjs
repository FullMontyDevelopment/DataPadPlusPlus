import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath)
}

async function read(relativePath) {
  const splitRustSources = new Map([
    [
      'apps/desktop/src-tauri/src/adapters/common/operations/planning.rs',
      'apps/desktop/src-tauri/src/adapters/common/operations/planning',
    ],
    [
      'apps/desktop/src-tauri/src/adapters/common/operations/manifest.rs',
      'apps/desktop/src-tauri/src/adapters/common/operations/manifest',
    ],
  ])
  const splitFolder = splitRustSources.get(relativePath)
  if (splitFolder) {
    const folder = absolutePath(splitFolder)
    const files = await recursiveFiles(folder)
    const facadePath = await exists(relativePath)
      ? absolutePath(relativePath)
      : path.join(folder, 'mod.rs')
    return [
      await readFile(facadePath, 'utf8'),
      ...(await Promise.all(files
        .filter((file) => file !== facadePath)
        .map((file) => readFile(file, 'utf8')))),
    ].join('\n')
  }
  return readFile(absolutePath(relativePath), 'utf8')
}

async function recursiveFiles(folder) {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const child = path.join(folder, entry.name)
    if (entry.isDirectory()) files.push(...await recursiveFiles(child))
    else if (entry.name.endsWith('.rs')) files.push(child)
  }
  return files
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

test('screenshot launcher seeds running fixtures before resetting and opening the workspace', async () => {
  const [launcher, workspaceHelper] = await Promise.all([
    read('tests/fixtures/launch-screenshot-seed.mjs'),
    read('tests/fixtures/screenshot-workspace.mjs'),
  ])
  const seedIndex = launcher.indexOf("[join(fixtureDir, 'seed.mjs')")
  const resetIndex = launcher.indexOf('prepareScreenshotWorkspace(workspaceDir')
  const launchIndex = launcher.indexOf('const child = spawn(command')

  assert.ok(seedIndex >= 0, 'Screenshot launcher must invoke the fixture seed runner.')
  assert.ok(seedIndex < resetIndex, 'Fixture validation must happen before resetting the workspace.')
  assert.ok(resetIndex < launchIndex, 'The workspace must be prepared before DataPad++ launches.')
  assert.match(launcher, /DATAPADPLUSPLUS_SCREENSHOT_SEED_FIXTURES/)
  assert.match(launcher, /seedResult\.status !== 0/)
  assert.match(workspaceHelper, /rmSync\(workspaceDirectory, \{ recursive: true, force: true \}\)/)
  assert.match(workspaceHelper, /mkdirSync\(workspaceDirectory, \{ recursive: true \}\)/)
})

test('CockroachDB fixture seeding verifies the configured database before debug startup', async () => {
  const seedSource = await read('tests/fixtures/seed.mjs')

  assert.match(seedSource, /--database=datapadplusplus/)
  assert.match(seedSource, /--execute=select count\(\*\) from accounts/)
  assert.match(seedSource, /CockroachDB fixture seed verification failed/)
})

test('JanusGraph fixture startup is restart-safe and readiness-gated', async () => {
  const composeSource = await read('tests/fixtures/docker-compose.yml')

  assert.match(composeSource, /JANUS_STORAGE_TIMEOUT: ''/)
  assert.match(composeSource, /janusgraph\.graph\.replace-instance-if-exists: 'true'/)
  assert.match(composeSource, /\/dev\/tcp\/127\.0\.0\.1\/8182/)
  assert.match(composeSource, /start_period: 15s/)
})

test('Cassandra fixture query targets the seeded partitioned table', async () => {
  const [catalogSource, seedSource] = await Promise.all([
    read('apps/desktop/src-tauri/src/app/runtime/fixtures/catalog/extended.rs'),
    read('tests/fixtures/cassandra/init/001_seed.cql'),
  ])

  assert.match(seedSource, /create table if not exists orders_by_account/)
  assert.match(catalogSource, /CASSANDRA_FIXTURE_QUERY/)
  assert.doesNotMatch(catalogSource, /datapadplusplus\.orders limit 25/)
})

test('DynamoDB fixture query uses the native scan request contract', async () => {
  const catalogSource = await read('apps/desktop/src-tauri/src/app/runtime/fixtures/catalog/cloud.rs')

  assert.match(catalogSource, /DYNAMODB_FIXTURE_QUERY/)
  assert.doesNotMatch(catalogSource, /\"table\": \"orders\"/)
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

test('TimescaleDB optional fixtures cover native metadata and guarded boundary evidence', async () => {
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
    read('tests/fixtures/validate-timescale-fixtures.mjs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:timescale": "node tests\/fixtures\/validate-timescale-fixtures\.mjs"/)
  assert.match(validatorSource, /TimescaleDB: extension and native catalog surfaces/)
  assert.match(validatorSource, /TimescaleDB: hypertable row-edit before\/after evidence/)
  assert.match(validatorSource, /TimescaleDB: restricted catalog and permission-denied evidence/)
  assert.match(validatorSource, /TimescaleDB: continuous aggregate and policy\/job boundary evidence/)
  assert.match(validatorSource, /TimescaleDB: compressed chunks and aggregate lag evidence/)
  assert.match(validatorSource, /TimescaleDB: Toolkit variant and time-bucket function evidence/)
  assert.match(validatorSource, /TimescaleDB: bounded file export\/import evidence/)
  assert.match(validatorSource, /TimescaleDB: failed job diagnostic evidence/)
  assert.match(validatorSource, /fixture_timescale_row_edit/)
  assert.match(validatorSource, /fixture_timescale_compressed_metrics/)
  assert.match(validatorSource, /fixture_timescale_file_import/)
  assert.match(validatorSource, /fixture_timescale_failed_job/)
  assert.match(validatorSource, /fixture_timescale_readonly/)
  assert.match(validatorSource, /timescaledb_information\.hypertables/)
  assert.match(validatorSource, /timescaledb_information\.jobs/)
  assert.match(validatorSource, /timescaledb_information\.job_errors/)
  assert.match(validatorSource, /timescaledb_information\.job_history/)
  assert.match(validatorSource, /job_stats/)
  assert.match(validatorSource, /timescaledb_information\.chunks/)
  assert.match(validatorSource, /timescaledb_toolkit/)
  assert.match(validatorSource, /bounded CSV export\/import/)
  assert.match(validatorSource, /RETURNING/)
  assert.match(validatorSource, /live policy\/file execution remains preview-first/)
  assert.match(readmeSource, /fixtures:validate:timescale/)
  assert.match(readmeSource, /compressed chunk[\s\S]*aggregate lag[\s\S]*Toolkit[\s\S]*bounded (?:CSV|file-copy)[\s\S]*failed-job/)
  assert.match(strategySource, /TimescaleDB optional fixture evidence path/)
  assert.match(strategySource, /compressed chunk[\s\S]*aggregate lag[\s\S]*Toolkit[\s\S]*bounded file-copy[\s\S]*failed-job/)
  assert.match(connectionsSource, /fixtures:validate:timescale/)
  assert.match(connectionsSource, /fixture_timescale_readonly/)
  assert.match(connectionsSource, /fixture_timescale_compressed_metrics/)
  assert.match(connectionsSource, /fixture_timescale_failed_job/)
  assert.match(completenessSource, /'timescaledb',/)
  assert.match(completenessSource, /optional TimescaleDB fixture validator/)
})

test('Oracle optional fixtures cover native diagnostics and preview boundary evidence', async () => {
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
    read('tests/fixtures/validate-oracle-fixtures.mjs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:oracle": "node tests\/fixtures\/validate-oracle-fixtures\.mjs"/)
  assert.match(validatorSource, /Oracle: seeded relational and volume fixtures/)
  assert.match(validatorSource, /Oracle: dictionary, security, and storage surfaces/)
  assert.match(validatorSource, /Oracle: DBMS_XPLAN and SQL Monitor boundary evidence/)
  assert.match(validatorSource, /Oracle: PL\/SQL source and compile diagnostics/)
  assert.match(validatorSource, /Oracle: row identity and DML evidence primitives/)
  assert.match(validatorSource, /Oracle: SQLPlus export\/import and backup boundary evidence/)
  assert.match(validatorSource, /Oracle: restricted dictionary denial evidence/)
  assert.match(validatorSource, /fixture_oracle_package/)
  assert.match(validatorSource, /fixture_oracle_invalid/)
  assert.match(validatorSource, /fixture_oracle_row_edit/)
  assert.match(validatorSource, /fixture_oracle_file_workflow/)
  assert.match(validatorSource, /dbms_xplan\.display/)
  assert.match(validatorSource, /v\$sql_monitor/)
  assert.match(validatorSource, /sys\.user\$/)
  assert.match(validatorSource, /set markup csv on/)
  assert.match(validatorSource, /RMAN backup database plus archivelog/)
  assert.match(validatorSource, /Data Pump\/RMAN execution remains preview-first outside the scoped claim/)
  assert.match(readmeSource, /fixtures:validate:oracle/)
  assert.match(readmeSource, /Desktop Oracle uses the bundled managed runtime by default, with SQLPlus available as an explicit legacy fallback/)
  assert.match(readmeSource, /DBMS_XPLAN[\s\S]*SQL Monitor[\s\S]*PL\/SQL[\s\S]*row identity[\s\S]*Data Pump\/RMAN/)
  assert.match(strategySource, /Oracle optional fixture evidence path/)
  assert.match(strategySource, /Desktop Oracle uses the bundled managed runtime by default, with SQLPlus available as an explicit legacy fallback/)
  assert.match(strategySource, /DBMS_XPLAN[\s\S]*SQL Monitor[\s\S]*restricted dictionary[\s\S]*Data Pump\/RMAN/)
  assert.match(connectionsSource, /fixtures:validate:oracle/)
  assert.match(connectionsSource, /Desktop Oracle uses the bundled managed runtime by default, with SQLPlus available as an explicit legacy fallback/)
  assert.match(connectionsSource, /fixture_oracle_package/)
  assert.match(connectionsSource, /fixture_oracle_file_workflow/)
  assert.match(completenessSource, /optional Oracle fixture coverage/)
  assert.match(completenessSource, /bundled managed ODP\.NET runtime by default/)
  assert.match(completenessSource, /primary-key or ROWID identity/)
})

test('DynamoDB Local optional fixtures cover local query, edit, and boundary evidence', async () => {
  const [
    packageSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
    cloudValidatorSource,
    seedSource,
    completenessSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-dynamodb-fixtures.mjs'),
    read('tests/fixtures/validate-dynamodb-cloud.mjs'),
    read('tests/fixtures/seed.mjs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:dynamodb": "node tests\/fixtures\/validate-dynamodb-fixtures\.mjs"/)
  assert.match(packageSource, /"fixtures:validate:dynamodb:cloud": "node tests\/fixtures\/validate-dynamodb-cloud\.mjs"/)
  assert.match(seedSource, /function dynamodbLocalAuthHeaders\(port\)/)
  assert.match(seedSource, /Credential=local\/\$\{dateStamp\}\/us-east-1\/dynamodb\/aws4_request/)
  assert.match(validatorSource, /DynamoDB Local: seeded table volume and consumed-capacity payloads/)
  assert.match(validatorSource, /DynamoDB Local: table, key, GSI, and TTL metadata surfaces/)
  assert.match(validatorSource, /DynamoDB Local: Query, GetItem, and PartiQL read evidence/)
  assert.match(validatorSource, /DynamoDB Local: conditional item edit before\/after evidence/)
  assert.match(validatorSource, /DynamoDB Local: backup and import\/export boundary evidence/)
  assert.match(validatorSource, /fixture_dynamodb_contract/)
  assert.match(validatorSource, /ReturnConsumedCapacity: 'TOTAL'/)
  assert.match(validatorSource, /ExecuteStatement/)
  assert.match(validatorSource, /attribute_not_exists/)
  assert.match(validatorSource, /attribute_exists/)
  assert.match(validatorSource, /ConditionalCheckFailedException/)
  assert.match(validatorSource, /ExportTableToPointInTime/)
  assert.match(cloudValidatorSource, /DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE/)
  assert.match(cloudValidatorSource, /function signAwsRequest/)
  assert.match(cloudValidatorSource, /DynamoDB_20120810/)
  assert.match(cloudValidatorSource, /GraniteServiceVersion20100801/)
  assert.match(cloudValidatorSource, /SimulatePrincipalPolicy/)
  assert.match(cloudValidatorSource, /GetCallerIdentity/)
  assert.match(cloudValidatorSource, /DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER/)
  assert.match(cloudValidatorSource, /AssumeRole/)
  assert.match(cloudValidatorSource, /AssumeRoleWithWebIdentity/)
  assert.match(cloudValidatorSource, /AWS_CONTAINER_CREDENTIALS_RELATIVE_URI/)
  assert.match(cloudValidatorSource, /DATAPADPLUSPLUS_DYNAMODB_CLOUD_ALLOW_METADATA/)
  assert.match(cloudValidatorSource, /169\.254\.169\.254/)
  assert.match(readmeSource, /fixtures:validate:dynamodb/)
  assert.match(readmeSource, /fixtures:validate:dynamodb:cloud/)
  assert.match(readmeSource, /conditional item-edit before\/after evidence/)
  assert.match(readmeSource, /DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE\s*=\s*'1'|DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE=1/)
  assert.match(readmeSource, /STS AssumeRole/)
  assert.match(readmeSource, /EC2 metadata/)
  assert.match(strategySource, /DynamoDB Local optional fixture evidence path/)
  assert.match(strategySource, /DynamoDB AWS cloud optional validation path/)
  assert.match(strategySource, /Query[\s\S]*GetItem[\s\S]*PartiQL[\s\S]*conditional item-edit/)
  assert.match(strategySource, /DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ASSUME_ROLE/)
  assert.match(connectionsSource, /fixtures:validate:dynamodb/)
  assert.match(connectionsSource, /fixtures:validate:dynamodb:cloud/)
  assert.match(connectionsSource, /fixture_dynamodb_contract/)
  assert.match(connectionsSource, /web identity/)
  assert.match(connectionsSource, /ECS task/)
  assert.match(completenessSource, /optional DynamoDB Local fixture validator/)
  assert.match(completenessSource, /optional AWS cloud validator/)
  assert.match(completenessSource, /Native-complete for the scoped DynamoDB/)
  assert.match(completenessSource, /conditional-write expression planning/)
})

test('Cosmos DB emulator optional fixtures cover setup, seed, and validation paths', async () => {
  const [
    packageSource,
    composeSource,
    composeRunnerSource,
    seedSource,
    initSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/docker-compose.yml'),
    read('tests/fixtures/compose.mjs'),
    read('tests/fixtures/seed.mjs'),
    read('tests/fixtures/cosmosdb/init/001_seed.csh'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-cosmosdb-fixtures.mjs'),
  ])

  assert.match(packageSource, /"fixtures:validate:cosmosdb": "node tests\/fixtures\/validate-cosmosdb-fixtures\.mjs"/)
  assert.match(composeSource, /mcr\.microsoft\.com\/cosmosdb\/linux\/azure-cosmos-emulator:vnext-latest/)
  assert.match(composeSource, /profiles: \['cosmosdb'\]/)
  assert.match(composeSource, /ENABLE_INIT_DATA: 'true'/)
  assert.match(composeSource, /DATAPADPLUSPLUS_COSMOSDB_EMULATOR_PORT/)
  assert.match(composeSource, /DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT/)
  assert.match(composeSource, /DATAPADPLUSPLUS_COSMOSDB_EXPLORER_PORT/)
  assert.match(composeSource, /\.\/cosmosdb\/init:\/init:ro/)
  assert.match(composeRunnerSource, /'cosmosdb'/)
  assert.match(composeRunnerSource, /DATAPADPLUSPLUS_COSMOSDB_EMULATOR_PORT/)
  assert.match(composeRunnerSource, /DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT/)
  assert.match(composeRunnerSource, /DATAPADPLUSPLUS_COSMOSDB_EXPLORER_PORT/)
  assert.match(seedSource, /function seedCosmosDbEmulator\(\)/)
  assert.match(seedSource, /datapadplusplus-cosmosdb/)
  assert.match(seedSource, /SELECT VALUE COUNT\(1\) FROM c/)
  assert.match(initSource, /mkdb datapadplusplus/)
  assert.match(initSource, /mkcon accounts \/id/)
  assert.match(initSource, /mkcon products \/sku/)
  assert.match(initSource, /mkcon orders \/accountId/)
  assert.match(initSource, /mkcon order_events \/pk/)
  assert.match(initSource, /order-101/)
  assert.match(initSource, /luna-lamp/)
  assert.match(validatorSource, /Cosmos DB emulator: health endpoint ready/)
  assert.match(validatorSource, /cosmoshell\.sh/)
  assert.match(validatorSource, /DATAPADPLUSPLUS_COSMOSDB_HEALTH_PORT/)
  assert.match(validatorSource, /order-101/)
  assert.match(validatorSource, /luna-lamp/)
  assert.match(readmeSource, /fixtures:up:profile -- cosmosdb/)
  assert.match(readmeSource, /fixtures:validate:cosmosdb/)
  assert.match(readmeSource, /Microsoft Linux vNext Cosmos DB emulator/)
  assert.match(connectionsSource, /Cosmos DB emulator gateway/)
  assert.match(connectionsSource, /DATAPADPLUSPLUS_COSMOSDB/)
  assert.match(connectionsSource, /fixtures:validate:cosmosdb/)
  assert.match(strategySource, /Cosmos DB emulator optional fixture evidence path/)
  assert.match(strategySource, /lightweight cloud-contract Cosmos DB mock/)
})

test('Search optional fixtures cover profile, document evidence, diagnostics, and boundary primitives', async () => {
  const [
    packageSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
    seedSource,
    completenessSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-search-fixtures.mjs'),
    read('tests/fixtures/seed.mjs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:search": "node tests\/fixtures\/validate-search-fixtures\.mjs"/)
  assert.match(seedSource, /async function seedSearch\(\)/)
  assert.match(seedSource, /bulkIndexSearchDocuments\(port, 'products'/)
  assert.match(validatorSource, /OpenSearch/)
  assert.match(validatorSource, /Elasticsearch/)
  assert.match(validatorSource, /mapping, aggregation, and profile evidence/)
  assert.match(validatorSource, /explicit-id document edit before\/after evidence/)
  assert.match(validatorSource, /slow-log and allocation diagnostic evidence/)
  assert.match(validatorSource, /bounded import\/export primitive boundary evidence/)
  assert.match(validatorSource, /OpenSearch SQL, ISM, security, and Performance Analyzer boundary evidence/)
  assert.match(validatorSource, /fixture-search-contract/)
  assert.match(validatorSource, /fixture-search-import/)
  assert.match(validatorSource, /\/_settings\?filter_path=\*\*\.search\.slowlog\*/)
  assert.match(validatorSource, /\/_cluster\/allocation\/explain/)
  assert.match(validatorSource, /\/_bulk\?refresh=true/)
  assert.match(validatorSource, /\/_plugins\/_sql/)
  assert.match(validatorSource, /\/_plugins\/_ism\/explain\/products/)
  assert.match(validatorSource, /\/_plugins\/_security\/api\/roles/)
  assert.match(validatorSource, /\/_plugins\/_performanceanalyzer\/metrics/)
  assert.match(readmeSource, /fixtures:validate:search/)
  assert.match(readmeSource, /Desktop file\/cloud import-export/)
  assert.match(strategySource, /Elasticsearch\/OpenSearch optional fixture evidence path/)
  assert.match(strategySource, /aggregation\/profile/)
  assert.match(connectionsSource, /fixtures:validate:search/)
  assert.match(connectionsSource, /fixture-search-contract/)
  assert.match(connectionsSource, /fixture-search-import/)
  assert.match(completenessSource, /Native-complete for the scoped Elasticsearch/)
  assert.match(completenessSource, /Native-complete for the scoped OpenSearch/)
  assert.match(completenessSource, /optional search fixture validator/)
  assert.match(completenessSource, /desktop file\/cloud import-export/)
})

test('DuckDB optional fixtures cover local read, profile, file workflow, and guard evidence', async () => {
  const [
    packageSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
    integrationSource,
    completenessSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-duckdb-fixtures.mjs'),
    read('apps/desktop/src-tauri/tests/adapters_integration.rs'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:duckdb": "node tests\/fixtures\/validate-duckdb-fixtures\.mjs"/)
  assert.match(validatorSource, /duckdb_local_file_fixture_validates_read_profile_catalog_and_guard_boundaries/)
  assert.match(validatorSource, /DuckDB: bundled local-file read, EXPLAIN, profile, catalog, diagnostics, guarded CSV export\/import, backup-folder, database-file preflight\/read-only guard, explicit lock-boundary, JSON\/Parquet preloaded-extension-only boundary, restore-package preflight, restore\/admin\/extension execution-boundary, and guard-boundary evidence/)
  assert.match(integrationSource, /duckdb_local_file_fixture_validates_read_profile_catalog_and_guard_boundaries/)
  assert.match(integrationSource, /create table orders as/)
  assert.match(integrationSource, /EXPLAIN ANALYZE/)
  assert.match(integrationSource, /duckdb-write-preview-only/)
  assert.match(integrationSource, /duckdb\.file\.import/)
  assert.match(integrationSource, /read_csv_auto/)
  assert.match(integrationSource, /duckdb\.data\.import-export/)
  assert.match(integrationSource, /duckdb\.data\.backup-restore/)
  assert.match(integrationSource, /databasePreflight/)
  assert.match(integrationSource, /lockBoundary/)
  assert.match(integrationSource, /crossProcessContentionValidated/)
  assert.match(integrationSource, /exclusiveWriterLockValidated/)
  assert.match(integrationSource, /formatPreflight/)
  assert.match(integrationSource, /extensionExecutionBoundary/)
  assert.match(integrationSource, /scoped-out-until-preloaded-extension/)
  assert.match(integrationSource, /required-extension-not-loaded/)
  assert.match(integrationSource, /restorePreflight/)
  assert.match(integrationSource, /restoreExecutionBoundary/)
  assert.match(integrationSource, /restore-execution-scoped-out/)
  assert.match(integrationSource, /adminExecutionBoundary/)
  assert.match(integrationSource, /extensionExecutionBoundary/)
  assert.match(integrationSource, /duckdb-admin-execution-scoped-out/)
  assert.match(integrationSource, /duckdb-extension-execution-scoped-out/)
  assert.match(integrationSource, /hasSchemaSql/)
  assert.match(integrationSource, /hasLoadSql/)
  assert.match(integrationSource, /requires the `json` extension to be loaded/)
  assert.match(integrationSource, /requires the `parquet` extension to be loaded/)
  assert.match(integrationSource, /read-only on disk/)
  assert.match(integrationSource, /exportedCount/)
  assert.match(integrationSource, /insertedCount/)
  assert.match(integrationSource, /fileCount/)
  assert.match(readmeSource, /fixtures:validate:duckdb/)
  assert.match(readmeSource, /bundled local-file read\/EXPLAIN\/profile/)
  assert.match(readmeSource, /guarded CSV export\/import[\s\S]*backup-folder execution[\s\S]*database-file preflight\/read-only guard evidence[\s\S]*lock-boundary evidence[\s\S]*JSON\/Parquet preloaded-extension-only boundary evidence[\s\S]*restore-package preflight[\s\S]*restore\/admin\/extension execution-boundary evidence/)
  assert.match(strategySource, /DuckDB optional fixture evidence path/)
  assert.match(strategySource, /local-file read[\s\S]*EXPLAIN[\s\S]*profile[\s\S]*catalog[\s\S]*CSV export\/import[\s\S]*backup-folder[\s\S]*read-only[\s\S]*lock-boundary[\s\S]*JSON\/Parquet preloaded-extension-only boundary[\s\S]*restore-package[\s\S]*restore\/admin\/extension execution-boundary/)
  assert.match(connectionsSource, /fixtures:validate:duckdb/)
  assert.match(connectionsSource, /temporary `.duckdb` file/)
  assert.match(connectionsSource, /guarded CSV export\/import/)
  assert.match(connectionsSource, /database-file preflight\/read-only guard/)
  assert.match(connectionsSource, /lock-boundary/)
  assert.match(connectionsSource, /JSON\/Parquet preloaded-extension-only boundary/)
  assert.match(connectionsSource, /restore-package preflight/)
  assert.match(connectionsSource, /restore\/admin\/extension execution-boundary evidence/)
  assert.match(completenessSource, /DUCKDB_PROFILE/)
  assert.match(completenessSource, /optional DuckDB fixture validator/)
  assert.match(completenessSource, /bundled local-file read\/EXPLAIN\/profile/)
  assert.match(completenessSource, /guarded live CSV export, CSV import, CSV backup-folder[\s\S]*database file access\/read-only preflight[\s\S]*JSON\/Parquet extension-backed format preflight[\s\S]*preloaded-extension-only[\s\S]*boundar[\s\S]*restore-package preflight[\s\S]*restore execution-boundary/)
  assert.match(completenessSource, /structured extension install\/load gates/)
  assert.match(completenessSource, /structured analyze\/checkpoint\/object admin-scope gates/)
  assert.match(completenessSource, /explicit admin\/extension execution-boundary evidence/)
})

test('LiteDB optional fixtures cover local-file preflight and sidecar boundary evidence', async () => {
  const [
    packageSource,
    readmeSource,
    connectionsSource,
    strategySource,
    validatorSource,
    dotnetValidatorSource,
    connectionSource,
    querySource,
    importExportSource,
    managementSource,
    queryTestsSource,
    importExportTestsSource,
    managementTestsSource,
    browserPlannerSource,
    browserManifestSource,
    rustPlannerSource,
    operationManifestSource,
    contractSource,
    sidecarProjectSource,
    sidecarProgramSource,
    sidecarReadmeSource,
    completenessSource,
  ] = await Promise.all([
    read('package.json'),
    read('tests/fixtures/README.md'),
    read('tests/fixtures/CONNECTIONS.md'),
    read('docs/testing/strategy.md'),
    read('tests/fixtures/validate-litedb-fixtures.mjs'),
    read('tests/fixtures/validate-litedb-dotnet-sidecar.mjs'),
    read('apps/desktop/src-tauri/src/adapters/datastores/litedb/connection.rs'),
    read('apps/desktop/src-tauri/src/adapters/datastores/litedb/query.rs'),
    read('apps/desktop/src-tauri/src/adapters/datastores/litedb/import_export.rs'),
    read('apps/desktop/src-tauri/src/adapters/datastores/litedb/management.rs'),
    read('apps/desktop/src-tauri/tests/unit/adapters/datastores/litedb/query_tests.rs'),
    read('apps/desktop/src-tauri/tests/unit/adapters/datastores/litedb/import_export_tests.rs'),
    read('apps/desktop/src-tauri/tests/unit/adapters/datastores/litedb/management_tests.rs'),
    read('apps/desktop/src/services/runtime/datastores/litedb/browser-litedb-operations.ts'),
    read('apps/desktop/src/services/runtime/browser-operation-manifests.ts'),
    read('apps/desktop/src-tauri/src/adapters/common/operations/planning.rs'),
    read('apps/desktop/src-tauri/src/adapters/common/operations/manifest.rs'),
    read('apps/desktop/src-tauri/src/adapters/datastores/litedb/mod.rs'),
    read('apps/desktop/src-tauri/sidecars/litedb/DataPadPlusPlus.LiteDbSidecar.csproj'),
    read('apps/desktop/src-tauri/sidecars/litedb/Program.cs'),
    read('apps/desktop/src-tauri/sidecars/litedb/README.md'),
    read('packages/shared-types/src/datastore-completeness.ts'),
  ])

  assert.match(packageSource, /"fixtures:validate:litedb": "node tests\/fixtures\/validate-litedb-fixtures\.mjs"/)
  assert.match(packageSource, /"fixtures:validate:litedb:dotnet": "node tests\/fixtures\/validate-litedb-dotnet-sidecar\.mjs"/)
  assert.match(validatorSource, /const testName = 'litedb_sidecar'/)
  assert.match(validatorSource, /LiteDB: local-file preflight plus fixture-token and local sidecar-process read dispatch, bounded response normalization, process open-failure mapping, timeout, and redaction evidence/)
  assert.match(validatorSource, /DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 npm run fixtures:validate:litedb:dotnet/)
  assert.match(validatorSource, /JSON collection import\/export execution/)
  assert.match(validatorSource, /index\/collection management execution/)
  assert.match(validatorSource, /file-storage import\/export\/delete/)
  assert.match(dotnetValidatorSource, /DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE/)
  assert.match(dotnetValidatorSource, /DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED/)
  assert.match(dotnetValidatorSource, /operation: 'SeedFixture'/)
  assert.match(dotnetValidatorSource, /operation: 'ListCollections'/)
  assert.match(dotnetValidatorSource, /operation: 'Find'/)
  assert.match(dotnetValidatorSource, /operation: 'ListIndexes'/)
  assert.match(dotnetValidatorSource, /operation: 'ValidateEncryptedFile'/)
  assert.match(dotnetValidatorSource, /operation: 'InsertDocument'/)
  assert.match(dotnetValidatorSource, /operation: 'UpdateDocument'/)
  assert.match(dotnetValidatorSource, /operation: 'DeleteDocument'/)
  assert.match(dotnetValidatorSource, /operation: 'ExportCollection'/)
  assert.match(dotnetValidatorSource, /operation: 'ImportCollection'/)
  assert.match(dotnetValidatorSource, /operation: 'EnsureIndex'/)
  assert.match(dotnetValidatorSource, /operation: 'DropIndex'/)
  assert.match(dotnetValidatorSource, /operation: 'DropCollection'/)
  assert.match(dotnetValidatorSource, /operation: 'ImportFile'/)
  assert.match(dotnetValidatorSource, /operation: 'ListFiles'/)
  assert.match(dotnetValidatorSource, /operation: 'ExportFile'/)
  assert.match(dotnetValidatorSource, /operation: 'DeleteFile'/)
  assert.match(dotnetValidatorSource, /litedb-id-mismatch/)
  assert.match(dotnetValidatorSource, /litedb-file-missing/)
  assert.match(dotnetValidatorSource, /litedb-encrypted-open-failed/)
  assert.match(dotnetValidatorSource, /litedb-export-target-exists/)
  assert.match(dotnetValidatorSource, /litedb-file-export-target-exists/)
  assert.match(dotnetValidatorSource, /litedb-index-drop-blocked/)
  assert.match(dotnetValidatorSource, /fileStorageWorkflowValidated/)
  assert.match(dotnetValidatorSource, /importedProducts/)
  assert.match(dotnetValidatorSource, /files\/terms\.txt/)
  assert.match(dotnetValidatorSource, /super-secret-encrypted-fixture-password/)
  assert.match(dotnetValidatorSource, /super-secret-fixture-password/)
  assert.match(connectionSource, /litedb_local_file_preflight/)
  assert.match(connectionSource, /filesystem-read-open/)
  assert.match(connectionSource, /filesystem-write-open/)
  assert.match(connectionSource, /exclusiveWriterLockValidated/)
  assert.match(connectionSource, /dotnet-litedb-sidecar/)
  assert.match(querySource, /execute_litedb_sidecar_operation/)
  assert.match(querySource, /litedb-sidecar-live-read/)
  assert.match(querySource, /ValidateEncryptedFile/)
  assert.match(querySource, /ExportCollection/)
  assert.match(querySource, /ImportCollection/)
  assert.match(querySource, /ListFiles/)
  assert.match(querySource, /ExportFile/)
  assert.match(querySource, /ImportFile/)
  assert.match(querySource, /DeleteFile/)
  assert.match(querySource, /fileStorageWorkflowValidated/)
  assert.match(querySource, /EnsureIndex/)
  assert.match(querySource, /DropIndex/)
  assert.match(querySource, /DropCollection/)
  assert.match(querySource, /managementExecutionValidated/)
  assert.match(querySource, /live-read-dispatch/)
  assert.match(querySource, /live-mutation-dispatch/)
  assert.match(querySource, /litedb_sidecar_response_from_stdout/)
  assert.match(querySource, /datapad-fixture-sidecar/)
  assert.match(querySource, /local-sidecar-process/)
  assert.match(querySource, /processDispatchValidated/)
  assert.match(querySource, /engineRuntimeValidated/)
  assert.match(importExportSource, /execute_litedb_file_operation/)
  assert.match(importExportSource, /litedb\.data\.import-export/)
  assert.match(importExportSource, /litedb\.file-storage\.import/)
  assert.match(importExportSource, /litedb\.file-storage\.export/)
  assert.match(importExportSource, /litedb\.file-storage\.delete/)
  assert.match(importExportSource, /Live LiteDB collection import was blocked because this connection is read-only/)
  assert.match(importExportSource, /Live LiteDB file-storage import was blocked because this connection is read-only/)
  assert.match(importExportSource, /ExportCollection/)
  assert.match(importExportSource, /ImportCollection/)
  assert.match(importExportSource, /ExportFile/)
  assert.match(importExportSource, /ImportFile/)
  assert.match(importExportSource, /DeleteFile/)
  assert.match(managementSource, /execute_litedb_management_operation/)
  assert.match(managementSource, /litedb\.index\.create/)
  assert.match(managementSource, /litedb\.index\.drop/)
  assert.match(managementSource, /litedb\.object\.drop/)
  assert.match(managementSource, /Live LiteDB management execution was blocked because this connection is read-only/)
  assert.match(managementSource, /EnsureIndex/)
  assert.match(managementSource, /DropIndex/)
  assert.match(managementSource, /DropCollection/)
  assert.match(queryTestsSource, /litedb_sidecar_read_dispatch_contract_returns_bounded_rows/)
  assert.match(queryTestsSource, /LITEDB_PROCESS_SIDECAR_SOURCE/)
  assert.match(queryTestsSource, /litedb_sidecar_local_process_dispatch_contract_returns_bounded_rows/)
  assert.match(queryTestsSource, /litedb_sidecar_local_process_open_failure_redacts_error_output/)
  assert.match(importExportTestsSource, /litedb_file_storage_export_uses_sidecar_boundary/)
  assert.match(importExportTestsSource, /litedb_file_storage_import_uses_sidecar_boundary/)
  assert.match(importExportTestsSource, /litedb_file_storage_import_blocks_read_only_connection/)
  assert.match(importExportTestsSource, /litedb_file_storage_delete_uses_sidecar_boundary/)
  assert.match(managementTestsSource, /litedb_index_create_uses_sidecar_management_boundary/)
  assert.match(managementTestsSource, /litedb_index_drop_uses_sidecar_management_boundary/)
  assert.match(managementTestsSource, /litedb_object_drop_blocks_read_only_connection/)
  assert.match(browserManifestSource, /litedb\.index\.create/)
  assert.match(browserManifestSource, /litedb\.index\.drop/)
  assert.match(browserManifestSource, /litedb\.object\.drop/)
  assert.match(browserManifestSource, /litedb\.file-storage\.import/)
  assert.match(browserManifestSource, /litedb\.file-storage\.export/)
  assert.match(browserManifestSource, /litedb\.file-storage\.delete/)
  assert.match(browserManifestSource, /Run guarded LiteDB index or collection management/)
  assert.match(browserManifestSource, /configured sidecar/)
  assert.match(browserManifestSource, /Run guarded LiteDB file-storage import, export, or delete/)
  assert.match(operationManifestSource, /litedb\.index\.create/)
  assert.match(operationManifestSource, /litedb\.index\.drop/)
  assert.match(operationManifestSource, /litedb\.object\.drop/)
  assert.match(operationManifestSource, /litedb\.file-storage\.import/)
  assert.match(operationManifestSource, /litedb\.file-storage\.export/)
  assert.match(operationManifestSource, /litedb\.file-storage\.delete/)
  assert.match(operationManifestSource, /Run guarded LiteDB index or collection management/)
  assert.match(operationManifestSource, /configured sidecar/)
  assert.match(operationManifestSource, /Run guarded LiteDB file-storage import, export, or delete/)
  assert.match(contractSource, /execute_litedb_management_operation/)
  assert.match(contractSource, /litedb\.file-storage\.import/)
  assert.match(sidecarProjectSource, /<PackageReference Include="LiteDB" Version="5\.0\.21" \/>/)
  assert.match(sidecarProgramSource, /new LiteDatabase\(BuildConnectionString/)
  assert.match(sidecarProgramSource, /"ListCollections" => ListCollections/)
  assert.match(sidecarProgramSource, /"Find" or "Query" => Find/)
  assert.match(sidecarProgramSource, /"FindById" => FindById/)
  assert.match(sidecarProgramSource, /"ListIndexes" => ListIndexes/)
  assert.match(sidecarProgramSource, /"ValidateEncryptedFile" => ValidateEncryptedFile/)
  assert.match(sidecarProgramSource, /"ExportCollection" => ExportCollection/)
  assert.match(sidecarProgramSource, /"ImportCollection" => ImportCollection/)
  assert.match(sidecarProgramSource, /"ListFiles" => ListFiles/)
  assert.match(sidecarProgramSource, /"ExportFile" => ExportFile/)
  assert.match(sidecarProgramSource, /"ImportFile" => ImportFile/)
  assert.match(sidecarProgramSource, /"DeleteFile" => DeleteFile/)
  assert.match(sidecarProgramSource, /"InsertDocument" => InsertDocument/)
  assert.match(sidecarProgramSource, /"UpdateDocument" => UpdateDocument/)
  assert.match(sidecarProgramSource, /"DeleteDocument" => DeleteDocument/)
  assert.match(sidecarProgramSource, /"EnsureIndex" => EnsureIndex/)
  assert.match(sidecarProgramSource, /"DropIndex" => DropIndex/)
  assert.match(sidecarProgramSource, /"DropCollection" => DropCollection/)
  assert.match(sidecarProgramSource, /litedb-id-mismatch/)
  assert.match(sidecarProgramSource, /litedb-encrypted-open-failed/)
  assert.match(sidecarProgramSource, /litedb-export-target-exists/)
  assert.match(sidecarProgramSource, /litedb-import-source-missing/)
  assert.match(sidecarProgramSource, /litedb-file-storage-target-exists/)
  assert.match(sidecarProgramSource, /litedb-file-export-target-exists/)
  assert.match(sidecarProgramSource, /litedb-index-drop-blocked/)
  assert.match(sidecarProgramSource, /FileStorage\.Upload/)
  assert.match(sidecarProgramSource, /FileStorage\.Download/)
  assert.match(sidecarProgramSource, /RedactSidecarMessage/)
  assert.match(sidecarProgramSource, /SELECT \$ FROM \$indexes/)
  assert.match(sidecarProgramSource, /DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED/)
  assert.match(sidecarProgramSource, /litedb-file-missing/)
  assert.match(sidecarReadmeSource, /DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE/)
  assert.match(sidecarReadmeSource, /ValidateEncryptedFile/)
  assert.match(sidecarReadmeSource, /ExportCollection/)
  assert.match(sidecarReadmeSource, /ImportCollection/)
  assert.match(sidecarReadmeSource, /ListFiles/)
  assert.match(sidecarReadmeSource, /ExportFile/)
  assert.match(sidecarReadmeSource, /ImportFile/)
  assert.match(sidecarReadmeSource, /DeleteFile/)
  assert.match(sidecarReadmeSource, /EnsureIndex/)
  assert.match(sidecarReadmeSource, /DropIndex/)
  assert.match(sidecarReadmeSource, /DropCollection/)
  assert.match(browserPlannerSource, /localFilePreflight/)
  assert.match(browserPlannerSource, /sidecarExecutionBoundary/)
  assert.match(browserPlannerSource, /plan-only-until-sidecar/)
  assert.match(browserPlannerSource, /file-storage-import/)
  assert.match(browserPlannerSource, /file-storage-export/)
  assert.match(browserPlannerSource, /file-storage-delete/)
  assert.match(rustPlannerSource, /litedb_local_file_preflight_plan/)
  assert.match(rustPlannerSource, /exclusive-writer-lock-not-validated/)
  assert.match(rustPlannerSource, /file-storage-import/)
  assert.match(rustPlannerSource, /file-storage-export/)
  assert.match(rustPlannerSource, /file-storage-delete/)
  assert.match(readmeSource, /fixtures:validate:litedb/)
  assert.match(readmeSource, /fixtures:validate:litedb:dotnet/)
  assert.match(readmeSource, /local-file read\/write open preflight/)
  assert.match(readmeSource, /spawned local sidecar-process fixture/)
  assert.match(readmeSource, /temporary real LiteDB database/)
  assert.match(strategySource, /LiteDB optional fixture evidence path/)
  assert.match(strategySource, /deterministic fixture-sidecar token/)
  assert.match(strategySource, /spawned local sidecar-process fixture/)
  assert.match(strategySource, /optional real LiteDB engine sidecar validator/)
  assert.match(strategySource, /collection listing, bounded reads, index metadata/)
  assert.match(strategySource, /encrypted-file correct-password open\/read evidence/)
  assert.match(strategySource, /file-storage import\/export\/delete/)
  assert.match(connectionsSource, /fixtures:validate:litedb/)
  assert.match(connectionsSource, /fixtures:validate:litedb:dotnet/)
  assert.match(connectionsSource, /local sidecar-process evidence/)
  assert.match(connectionsSource, /opt-in \.NET sidecar collection\/find\/index\/document\/encryption\/import-export\/file-storage\/management validation/)
  assert.match(completenessSource, /optional real \.NET LiteDB sidecar validator/)
  assert.match(completenessSource, /local sidecar-process bounded response/)
  assert.match(completenessSource, /file-storage import\/export\/delete/)
  assert.match(completenessSource, /packaged sidecar distribution and exclusive writer-lock validation remain residual risks/)
})

test('cloud contract mocks return realistic lists and row counts', async () => {
  const source = await read('tests/fixtures/cloud-contract/server.mjs')

  assert.match(source, /tableId: 'order_items'/)
  assert.match(source, /numRows: '250000'/)
  assert.match(source, /Array\.from\(\{ length: 100 \}/)
  assert.match(source, /DocumentCollections/)
  assert.match(source, /Array\.from\(\{ length: 50 \}/)
})
