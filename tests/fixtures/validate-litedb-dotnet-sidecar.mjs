import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const encryptedDatabasePath = path.join(workspace, 'encrypted-fixture.db')
  const exportPath = path.join(workspace, 'products-export.json')
  const encryptedPassword = 'super-secret-encrypted-fixture-password'
  const wrongEncryptedPassword = 'wrong-super-secret-encrypted-fixture-password'

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

  const exportCollection = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ExportCollection',
    request: {
      collection: 'products',
      targetPath: exportPath,
      format: 'json',
      limit: 10,
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(exportCollection.ok, true)
  assert.equal(exportCollection.response.exportedCount, 3)
  assert.equal(exportCollection.response.totalCount, 3)
  assert.equal(exportCollection.response.truncated, false)
  assert.equal(exportCollection.response.evidence.fileWorkflowValidated, true)
  assert.equal(exportCollection.response.evidence.readOnlyEnvelope, true)
  assert.equal(existsSync(exportPath), true)
  assert.deepEqual(
    JSON.parse(readFileSync(exportPath, 'utf8')).map((document) => document.sku),
    ['tea-001', 'coffee-001', 'pen-001'],
  )

  const overwriteBlocked = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ExportCollection',
    request: {
      collection: 'products',
      targetPath: exportPath,
      format: 'json',
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(overwriteBlocked.ok, false)
  assert.equal(overwriteBlocked.code, 'litedb-export-target-exists')

  const readOnlyImport = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ImportCollection',
    request: {
      collection: 'importedProducts',
      sourcePath: exportPath,
      format: 'json',
      mode: 'insert',
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(readOnlyImport.ok, false)
  assert.equal(readOnlyImport.code, 'litedb-readonly-required')

  const importCollection = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ImportCollection',
    request: {
      collection: 'importedProducts',
      sourcePath: exportPath,
      format: 'json',
      mode: 'insert',
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(importCollection.ok, true)
  assert.equal(importCollection.response.importedCount, 3)
  assert.equal(importCollection.response.beforeCount, 0)
  assert.equal(importCollection.response.afterCount, 3)
  assert.equal(importCollection.response.evidence.fileWorkflowValidated, true)
  assert.equal(importCollection.response.evidence.mutationExecutionValidated, true)

  const importedFind = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'Find',
    request: { collection: 'importedProducts', limit: 3 },
    rowLimit: 3,
    readOnly: true,
  })

  assert.equal(importedFind.ok, true)
  assert.deepEqual(
    importedFind.response.documents.map((document) => document.sku),
    ['tea-001', 'coffee-001', 'pen-001'],
  )

  const readOnlyEnsureIndex = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'EnsureIndex',
    request: {
      collection: 'products',
      indexName: 'idx_products_price',
      field: 'price',
      unique: false,
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(readOnlyEnsureIndex.ok, false)
  assert.equal(readOnlyEnsureIndex.code, 'litedb-readonly-required')

  const ensureIndex = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'EnsureIndex',
    request: {
      collection: 'products',
      indexName: 'idx_products_price',
      field: 'price',
      unique: false,
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(ensureIndex.ok, true)
  assert.equal(ensureIndex.response.operation, 'EnsureIndex')
  assert.equal(ensureIndex.response.indexName, 'idx_products_price')
  assert.equal(ensureIndex.response.evidence.managementExecutionValidated, true)
  assert.ok(ensureIndex.response.indexes.some((index) => index.name === 'idx_products_price'))

  const dropIndex = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'DropIndex',
    request: {
      collection: 'products',
      indexName: 'idx_products_price',
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(dropIndex.ok, true)
  assert.equal(dropIndex.response.operation, 'DropIndex')
  assert.equal(dropIndex.response.dropped, true)
  assert.equal(dropIndex.response.evidence.managementExecutionValidated, true)
  assert.equal(dropIndex.response.indexes.some((index) => index.name === 'idx_products_price'), false)

  const dropIdIndex = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'DropIndex',
    request: {
      collection: 'products',
      indexName: '_id',
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(dropIdIndex.ok, false)
  assert.equal(dropIdIndex.code, 'litedb-index-drop-blocked')

  const dropCollection = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'DropCollection',
    request: {
      collection: 'importedProducts',
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(dropCollection.ok, true)
  assert.equal(dropCollection.response.operation, 'DropCollection')
  assert.equal(dropCollection.response.dropped, true)
  assert.equal(dropCollection.response.evidence.managementExecutionValidated, true)

  const collectionsAfterDrop = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ListCollections',
    request: {},
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(collectionsAfterDrop.ok, true)
  assert.equal(
    collectionsAfterDrop.response.collections.some(
      (collection) => collection.name === 'importedProducts',
    ),
    false,
  )

  const storedSourcePath = path.join(workspace, 'stored-source.txt')
  const storedExportPath = path.join(workspace, 'stored-export.txt')
  writeFileSync(storedSourcePath, 'LiteDB stored file fixture\n', 'utf8')

  const readOnlyFileImport = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ImportFile',
    request: {
      fileId: 'files/terms.txt',
      sourcePath: storedSourcePath,
      filename: 'terms.txt',
      contentType: 'text/plain',
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(readOnlyFileImport.ok, false)
  assert.equal(readOnlyFileImport.code, 'litedb-readonly-required')

  const importFile = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ImportFile',
    request: {
      fileId: 'files/terms.txt',
      sourcePath: storedSourcePath,
      filename: 'terms.txt',
      contentType: 'text/plain',
      metadata: { category: 'fixture' },
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(importFile.ok, true)
  assert.equal(importFile.response.operation, 'ImportFile')
  assert.equal(importFile.response.afterFile.id, 'files/terms.txt')
  assert.equal(importFile.response.afterFile.filename, 'terms.txt')
  assert.equal(importFile.response.bytesRead, readFileSync(storedSourcePath).length)
  assert.equal(importFile.response.evidence.fileStorageWorkflowValidated, true)
  assert.equal(importFile.response.evidence.mutationExecutionValidated, true)

  const listFiles = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ListFiles',
    request: {},
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(listFiles.ok, true)
  assert.equal(listFiles.response.operation, 'ListFiles')
  assert.equal(listFiles.response.evidence.fileStorageWorkflowValidated, true)
  assert.ok(listFiles.response.files.some((file) => file.id === 'files/terms.txt'))

  const exportFile = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ExportFile',
    request: {
      fileId: 'files/terms.txt',
      targetPath: storedExportPath,
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(exportFile.ok, true)
  assert.equal(exportFile.response.operation, 'ExportFile')
  assert.equal(exportFile.response.file.id, 'files/terms.txt')
  assert.equal(exportFile.response.evidence.fileStorageWorkflowValidated, true)
  assert.equal(existsSync(storedExportPath), true)
  assert.equal(readFileSync(storedExportPath, 'utf8'), 'LiteDB stored file fixture\n')

  const overwriteFileBlocked = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ExportFile',
    request: {
      fileId: 'files/terms.txt',
      targetPath: storedExportPath,
    },
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(overwriteFileBlocked.ok, false)
  assert.equal(overwriteFileBlocked.code, 'litedb-file-export-target-exists')

  const deleteFile = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'DeleteFile',
    request: {
      fileId: 'files/terms.txt',
    },
    rowLimit: 10,
    readOnly: false,
  })

  assert.equal(deleteFile.ok, true)
  assert.equal(deleteFile.response.operation, 'DeleteFile')
  assert.equal(deleteFile.response.deleted, true)
  assert.equal(deleteFile.response.beforeFile.id, 'files/terms.txt')
  assert.equal(deleteFile.response.afterFile, null)
  assert.equal(deleteFile.response.evidence.fileStorageWorkflowValidated, true)

  const listFilesAfterDelete = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath,
    operation: 'ListFiles',
    request: {},
    rowLimit: 10,
    readOnly: true,
  })

  assert.equal(listFilesAfterDelete.ok, true)
  assert.equal(
    listFilesAfterDelete.response.files.some((file) => file.id === 'files/terms.txt'),
    false,
  )

  const encryptedSeed = runSidecar(
    {
      engine: 'litedb',
      protocolVersion: 1,
      databasePath: encryptedDatabasePath,
      password: encryptedPassword,
      operation: 'SeedFixture',
      request: {
        collection: 'secureProducts',
        documents: [
          { _id: 'secure-1', sku: 'sealed-tea-001', category: 'encrypted' },
          { _id: 'secure-2', sku: 'sealed-coffee-001', category: 'encrypted' },
        ],
      },
      rowLimit: 50,
      readOnly: false,
    },
    {
      DATAPADPLUSPLUS_LITEDB_SIDECAR_ALLOW_FIXTURE_SEED: '1',
    },
  )

  assert.equal(encryptedSeed.ok, true)
  assert.equal(encryptedSeed.response.inserted, 2)

  const encryptedProbe = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath: encryptedDatabasePath,
    password: encryptedPassword,
    operation: 'ValidateEncryptedFile',
    request: {},
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(encryptedProbe.ok, true)
  assert.equal(encryptedProbe.response.encryptedFile.passwordConfigured, true)
  assert.equal(encryptedProbe.response.encryptedFile.passwordMaterial, 'redacted')
  assert.equal(encryptedProbe.response.encryptedFile.engineOpenValidated, true)
  assert.equal(encryptedProbe.response.encryptedFile.readProbeValidated, true)
  assert.equal(encryptedProbe.response.encryptedFile.databasePathMaterial, 'redacted')
  assert.deepEqual(encryptedProbe.response.encryptedFile.collections, ['secureProducts'])

  const encryptedFind = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath: encryptedDatabasePath,
    password: encryptedPassword,
    operation: 'Find',
    request: { collection: 'secureProducts', limit: 2 },
    rowLimit: 2,
    readOnly: true,
  })

  assert.equal(encryptedFind.ok, true)
  assert.deepEqual(
    encryptedFind.response.documents.map((document) => document.sku),
    ['sealed-tea-001', 'sealed-coffee-001'],
  )

  const encryptedWrongPassword = runSidecar({
    engine: 'litedb',
    protocolVersion: 1,
    databasePath: encryptedDatabasePath,
    password: wrongEncryptedPassword,
    operation: 'ValidateEncryptedFile',
    request: {},
    rowLimit: 50,
    readOnly: true,
  })

  assert.equal(encryptedWrongPassword.ok, false)
  assert.equal(encryptedWrongPassword.code, 'litedb-encrypted-open-failed')
  assert.equal(JSON.stringify(encryptedWrongPassword).includes(wrongEncryptedPassword), false)
  assert.equal(JSON.stringify(encryptedWrongPassword).includes(encryptedPassword), false)
  assert.equal(JSON.stringify(encryptedWrongPassword).includes(encryptedDatabasePath), false)

  console.log('LiteDB .NET sidecar live validation passed with read, guarded document CRUD, encrypted-file success/failure, collection import/export, file-storage import/export/delete, and index/collection management execution evidence.')
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
