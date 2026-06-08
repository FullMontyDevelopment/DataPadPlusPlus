import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const projectPath = path.join(
  root,
  'apps',
  'desktop',
  'src-tauri',
  'sidecars',
  'litedb',
  'DataPadPlusPlus.LiteDbSidecar.csproj',
)
const assemblyPath = path.join(
  path.dirname(projectPath),
  'bin',
  'Debug',
  'net8.0',
  'datapadplusplus-litedb-sidecar.dll',
)

if (process.env.DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE !== '1') {
  console.log(
    'LiteDB .NET sidecar live validation skipped. Set DATAPADPLUSPLUS_LITEDB_DOTNET_VALIDATE=1 after building the sidecar to run real engine validation.',
  )
  process.exit(0)
}

const workspace = mkdtempSync(path.join(tmpdir(), 'datapad-litedb-sidecar-'))

if (!existsSync(assemblyPath) || process.env.DATAPADPLUSPLUS_LITEDB_DOTNET_BUILD === '1') {
  const buildArgs = ['build', projectPath, '-v', 'minimal']

  if (process.env.DATAPADPLUSPLUS_LITEDB_DOTNET_RESTORE !== '1') {
    buildArgs.splice(2, 0, '--no-restore')
  }

  const build = spawnSync('dotnet', buildArgs, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  })

  assert.equal(
    build.status,
    0,
    [
      `dotnet build exited with ${build.status}`,
      `stdout: ${build.stdout}`,
      `stderr: ${build.stderr}`,
      'Set DATAPADPLUSPLUS_LITEDB_DOTNET_RESTORE=1 when the LiteDB package has not been restored yet.',
    ].join('\n'),
  )
}

try {
  const databasePath = path.join(workspace, 'fixture.db')

  const seed = runSidecar(
    {
      engine: 'litedb',
      protocolVersion: 1,
      databasePath,
      operation: 'SeedFixture',
      request: {
        collection: 'products',
        documents: [
          { _id: 1, sku: 'tea-001', category: 'pantry', price: 8.5 },
          { _id: 2, sku: 'coffee-001', category: 'pantry', price: 13.25 },
          { _id: 3, sku: 'pen-001', category: 'office', price: 2.1 },
        ],
      },
      rowLimit: 50,
      readOnly: false,
    },
    {
      DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED: '1',
    },
  )

  assert.equal(seed.ok, true)
  assert.equal(seed.response.inserted, 3)

  const collections = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ListCollections',
    request: {},
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(collections.ok, true)
  assert.deepEqual(
    collections.response.collections.map((collection) => collection.name),
    ['products'],
  )

  const find = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'Find',
    request: { collection: 'products', limit: 3 },
    rowLimit: 2,
    readOnly: true,
  })

  assert.equal(find.ok, true)
  assert.equal(find.response.documents.length, 3)
  assert.equal(find.response.hasMore, true)
  assert.deepEqual(
    find.response.documents.map((document) => document.sku),
    ['tea-001', 'coffee-001', 'pen-001'],
  )

  const indexes = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ListIndexes',
    request: { collection: 'products' },
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(indexes.ok, true)
  assert.ok(indexes.response.indexes.some((index) => index.name === '_id'))
  assert.ok(indexes.response.indexes.some((index) => index.name === 'category'))

  const readOnlyMutation = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'InsertDocument',
    request: {
      collection: 'products',
      id: 4,
      document: { _id: 4, sku: 'blocked-001', category: 'fixture' },
    },
    rowLimit: 2,
    readOnly: true,
  })

  assert.equal(readOnlyMutation.ok, false)
  assert.equal(readOnlyMutation.code, 'litedb-readonly-required')

  const insert = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'InsertDocument',
    request: {
      collection: 'products',
      id: 4,
      document: { _id: 4, sku: 'marker-004', category: 'fixture', price: 1.25 },
    },
    rowLimit: 2,
    readOnly: false,
  })

  assert.equal(insert.ok, true)
  assert.equal(insert.response.insertedCount, 1)
  assert.equal(insert.response.afterDocument.sku, 'marker-004')
  assert.equal(insert.response.evidence.after.matched, true)
  assert.equal(insert.response.evidence.mutationExecutionValidated, true)

  const update = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'UpdateDocument',
    request: {
      collection: 'products',
      id: 4,
      document: { _id: 4, sku: 'marker-004-updated', category: 'fixture', price: 2.5 },
    },
    rowLimit: 2,
    readOnly: false,
  })

  assert.equal(update.ok, true)
  assert.equal(update.response.matchedCount, 1)
  assert.equal(update.response.modifiedCount, 1)
  assert.equal(update.response.beforeDocument.sku, 'marker-004')
  assert.equal(update.response.afterDocument.sku, 'marker-004-updated')
  assert.equal(update.response.evidence.before.matched, true)
  assert.equal(update.response.evidence.after.matched, true)

  const idMismatch = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'UpdateDocument',
    request: {
      collection: 'products',
      id: 4,
      document: { _id: 5, sku: 'bad-id', category: 'fixture' },
    },
    rowLimit: 2,
    readOnly: false,
  })

  assert.equal(idMismatch.ok, false)
  assert.equal(idMismatch.code, 'litedb-id-mismatch')

  const remove = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'DeleteDocument',
    request: { collection: 'products', id: 4 },
    rowLimit: 2,
    readOnly: false,
  })

  assert.equal(remove.ok, true)
  assert.equal(remove.response.deletedCount, 1)
  assert.equal(remove.response.beforeDocument.sku, 'marker-004-updated')
  assert.equal(remove.response.afterDocument, null)
  assert.equal(remove.response.evidence.after.matched, false)

  const missing = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath: path.join(workspace, 'missing.db'),
    password: 'super-secret-fixture-password',
    operation: 'Find',
    request: { collection: 'products' },
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'litedb-file-missing')
  assert.equal(JSON.stringify(missing).includes('super-secret-fixture-password'), false)

  console.log('LiteDB .NET sidecar live validation passed with read and guarded document CRUD evidence.')
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

function runSidecar(request, extraEnv = {}) {
  const result = spawnSync('dotnet', [assemblyPath], {
    cwd: root,
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
    timeout: 120_000,
  })

  assert.equal(
    result.status,
    0,
    [
      `dotnet run exited with ${result.status}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n'),
  )

  return JSON.parse(result.stdout)
}
