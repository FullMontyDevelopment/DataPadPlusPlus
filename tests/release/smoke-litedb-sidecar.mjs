import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { litedbContext } from './litedb-sidecar-config.mjs'

const argument = process.argv.indexOf('--binary')
const binary = argument < 0 ? litedbContext().destination : process.argv[argument + 1]
if (!binary) throw new Error('The bundled LiteDB runtime path is required.')
const directory = mkdtempSync(join(tmpdir(), 'datapad-litedb-smoke-'))
const databasePath = join(directory, 'native.db')
const invoke = (operation, request = {}, options = {}) => {
  const result = spawnSync(binary, [], {
    input: JSON.stringify({ engine: 'litedb', protocolVersion: 1, databasePath, operation, request, rowLimit: 100, readOnly: true, ...options }),
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  assert.equal(result.status, 0, 'The packaged LiteDB runtime must execute successfully.')
  assert.equal(result.stderr, '')
  return JSON.parse(result.stdout)
}
try {
  assert.equal(invoke('CreateDatabase', {}, { readOnly: false }).ok, true)
  assert.equal(invoke('TestConnection').response.engineOpenValidated, true)
  assert.deepEqual(invoke('ListCollections').response.collections, [])
  const pristine = readFileSync(databasePath)
  assert.equal(invoke('CreateDatabase', {}, { readOnly: false }).ok, false)
  assert.deepEqual(readFileSync(databasePath), pristine, 'Creation must never overwrite an existing file.')
  assert.equal(invoke('InsertDocument', { collection: 'orders', document: { _id: 1, name: 'Unicode café 日本語', amount: 12.5 } }, { readOnly: false }).ok, true)
  assert.equal(invoke('EnsureIndex', { collection: 'orders', name: 'amount_idx', expression: '$.amount', unique: false }, { readOnly: false }).ok, true)
  const before = readFileSync(databasePath)
  assert.deepEqual(invoke('ListCollections').response.collections, [{ name: 'orders' }])
  const metadata = invoke('GetMetadata').response
  assert.equal(metadata.collectionCount, 1)
  assert.equal(metadata.documentCount, 1)
  assert.equal(metadata.indexCount, 2)
  assert.equal(metadata.pragmas.find(row => row.name === 'USER_VERSION').value, 1)
  assert.equal(invoke('ListIndexes').response.indexes.length, 2)
  assert.deepEqual(readFileSync(databasePath), before, 'Explorer reads must not alter database content.')
  assert.equal(invoke('InsertDocument', { collection: 'orders', document: { _id: 2 } }).ok, false)
  const encrypted = { databasePath: join(directory, 'encrypted.db'), password: 'smoke-only-password' }
  assert.equal(invoke('CreateDatabase', {}, { ...encrypted, readOnly: false }).ok, true)
  assert.equal(invoke('GetMetadata', {}, encrypted).ok, true)
  assert.equal(invoke('GetMetadata', {}, { ...encrypted, password: 'wrong-password' }).ok, false)
  console.log('Bundled LiteDB runtime: creation, overwrite protection, read-only Explorer metadata, collections, indexes and encrypted databases passed.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
