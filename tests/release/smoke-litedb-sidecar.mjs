import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
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
  // Execute the exact compiler bundled for desktop/MCP against the packaged database runtime.
  const compiler = runInNewContext(`${readFileSync(new URL('../../apps/desktop/src-tauri/src/app/runtime/query_compiler.js', import.meta.url), 'utf8')}; DataPadQueryCompiler`)
  const defaults = { kind: 'litedb-find', collection: 'builder_checks', filterLogic: 'and', filters: [], filterGroups: [], sort: [], skip: 0, limit: 100 }
  const date = { $date: '2026-10-08T10:30:00.000Z' }
  const guid = { $guid: '9e107d9d-372b-4f7d-bb3a-17d63746f9a0' }
  const oid = { $oid: '507f1f77bcf86cd799439011' }
  for (const document of [
    { _id: 1, score: 10, name: 'alpha', tags: [], active: true, at: date, guid, oid, optional: null },
    { _id: 2, score: 20, name: 'beta', tags: ['a'], active: false, optional: 'present' },
    { _id: 3, score: 30, name: 'gamma', tags: ['a', 'b'] },
    { _id: 4, score: 40, name: 'delta', tags: null },
    { _id: 5, score: 50, name: "' OR true --", tags: 'not an array' },
    { _id: 6, score: 60, name: 'missing array' },
  ]) assert.equal(invoke('InsertDocument', { collection: defaults.collection, document }, { readOnly: false }).ok, true)
  const row = (operator, field = 'score', value = '20', valueType = 'number') => ({ id: 'f', field, operator, value, valueType })
  const runBuilder = (state) => {
    const compiled = compiler.compileSavedBuilder({ connection: { engine: 'litedb' }, builderState: { ...defaults, ...state } })
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors))
    const request = JSON.parse(compiled.queryText)
    const result = invoke('Find', request)
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return { ids: result.response.documents.map(item => item._id), request }
  }
  for (const [filter, expected] of [
    [row('eq'), [2]], [row('ne'), [1, 3, 4, 5, 6]], [row('gt'), [3, 4, 5, 6]],
    [row('gte'), [2, 3, 4, 5, 6]], [row('lt'), [1]], [row('lte'), [1, 2]],
    [row('in', 'score', '10, 30'), [1, 3]], [row('not-in', 'score', '10, 30'), [2, 4, 5, 6]],
    [row('contains', 'name', 'amm', 'string'), [3]], [row('starts-with', 'name', 'alp', 'string'), [1]],
    [row('eq', 'name', "' OR true --", 'string'), [5]], [row('eq', 'active', 'true', 'boolean'), [1]],
    [row('eq', 'at', '2026-10-08T12:30:00+02:00', 'date'), [1]],
    [row('eq', 'guid', guid.$guid, 'uuid'), [1]], [row('eq', 'oid', oid.$oid, 'objectId'), [1]],
    [row('is-null', 'optional'), [1, 3, 4, 5, 6]], [row('is-not-null', 'optional'), [2]],
    [row('has-items', 'tags'), [2, 3]], [row('has-no-items', 'tags'), [1]],
    [row('has-length', 'tags', '0'), [1]], [row('has-length', 'tags', '2'), [3]],
    [row('in', 'score', '[10, 30]', 'json'), [1, 3]],
  ]) {
    const result = runBuilder({ filters: [filter] })
    assert.deepEqual(result.ids.sort((a, b) => a - b), expected, `${filter.field}: ${filter.operator}`)
    const counted = invoke('Count', { ...result.request, operation: 'Count', limit: 1, skip: 100 })
    assert.equal(counted.ok, true)
    assert.equal(counted.response.count, expected.length)
  }
  assert.deepEqual(runBuilder({
    filters: [row('gte'), { ...row('eq', 'name', 'beta', 'string'), id: 'a', groupId: 'g' }, { ...row('eq', 'name', 'gamma', 'string'), id: 'b', groupId: 'g' }],
    filterGroups: [{ id: 'g', label: 'Names', logic: 'or' }], sort: [{ id: 'sort', field: 'score', direction: 'desc' }], skip: 1, limit: 1,
  }).ids, [2])
  assert.equal(compiler.compileSavedBuilder({ connection: { engine: 'litedb' }, builderState: { ...defaults, filters: [row('eq', 'score', 'invalid')] } }).ok, false)
  console.log('LiteDB shared compiler → packaged runtime: all 15 operators, native types, JSON lists, grouped filters, paging, sorting, filtered counts and invalid drafts passed.')
  console.log('Bundled LiteDB runtime: creation, overwrite protection, read-only Explorer metadata, collections, indexes and encrypted databases passed.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
