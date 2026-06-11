import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  applyKeyValueEntryPatches,
  canDeleteRedisContextTarget,
  diffKeyValueEntries,
  keyValuePrimaryColumnLabel,
  keyValueEntriesVersion,
  keyValueRowsFromEntries,
  redisContextTargetKind,
  redisEditKindForValue,
  redisKeyOperationPlanRequest,
  redisMemberLabel,
  deleteRedisJsonPathValue,
  serializedKeyValue,
  setRedisJsonPathValue,
} from '../../../../../src/app/components/workbench/results/keyvalue-results-helpers'

describe('keyvalue results helpers', () => {
  it('versions incoming entries by result object identity and selected key scope', () => {
    const entries = { 'session:1': 'active' }

    expect(keyValueEntriesVersion(entries, { key: 'session:1', redisType: 'string' }))
      .toBe(keyValueEntriesVersion(entries, { key: 'session:1', redisType: 'string' }))
    expect(keyValueEntriesVersion({ 'session:1': 'active' }, { key: 'session:1', redisType: 'string' }))
      .not.toBe(keyValueEntriesVersion(entries, { key: 'session:1', redisType: 'string' }))
    expect(keyValueEntriesVersion(entries, { key: 'session:2', redisType: 'string' }))
      .not.toBe(keyValueEntriesVersion(entries, { key: 'session:1', redisType: 'string' }))
  })

  it('applies and diffs optimistic entry patches without mutating base entries', () => {
    const baseEntries = {
      a: 'one',
      b: 'two',
    }
    const nextEntries = applyKeyValueEntryPatches(baseEntries, {
      a: 'updated',
      b: undefined,
      c: 'three',
    })

    expect(nextEntries).toEqual({
      a: 'updated',
      c: 'three',
    })
    expect(baseEntries).toEqual({
      a: 'one',
      b: 'two',
    })
    expect(diffKeyValueEntries(baseEntries, nextEntries)).toEqual({
      a: 'updated',
      b: undefined,
      c: 'three',
    })
  })

  it('builds parsed rows from loaded entries', () => {
    expect(keyValueRowsFromEntries({
      plain: 'hello',
      json: '{"ok":true}',
    })).toEqual([
      {
        keyName: 'plain',
        rawValue: 'hello',
        parsedValue: 'hello',
      },
      {
        keyName: 'json',
        rawValue: '{"ok":true}',
        parsedValue: { ok: true },
      },
    ])
  })

  it('uses Redis-native labels and delete capabilities for selected values', () => {
    expect(keyValuePrimaryColumnLabel('hash')).toBe('Field')
    expect(keyValuePrimaryColumnLabel('list')).toBe('Index')
    expect(keyValuePrimaryColumnLabel('zset')).toBe('Member')
    expect(keyValuePrimaryColumnLabel('stream')).toBe('Entry ID')
    expect(keyValuePrimaryColumnLabel('timeseries')).toBe('Timestamp')
    expect(keyValuePrimaryColumnLabel('vectorset')).toBe('Element')
    expect(keyValuePrimaryColumnLabel('string')).toBe('Key')

    expect(redisMemberLabel('hash')).toBe('Field')
    expect(redisMemberLabel('zset')).toBe('Member')
    expect(redisMemberLabel('stream')).toBe('Entry')
    expect(redisMemberLabel('timeseries')).toBe('Sample')
    expect(redisMemberLabel('vectorset')).toBe('Element')
    expect(redisMemberLabel('list')).toBe('Item')

    expect(redisContextTargetKind('products', 'hash')).toBe('member')
    expect(redisContextTargetKind('products', 'string')).toBe('key')
    expect(canDeleteRedisContextTarget('products', 'list')).toBe(false)
    expect(canDeleteRedisContextTarget('products', 'hash')).toBe(true)
    expect(canDeleteRedisContextTarget('orders:stream', 'stream')).toBe(true)
    expect(canDeleteRedisContextTarget('metrics:cpu', 'timeseries')).toBe(true)
    expect(canDeleteRedisContextTarget('embeddings:articles', 'vectorset')).toBe(true)
  })

  it('maps value edits to typed Redis edit kinds', () => {
    expect(redisEditKindForValue('hash')).toBe('hash-set-field')
    expect(redisEditKindForValue('list')).toBe('list-set-index')
    expect(redisEditKindForValue('set')).toBe('set-add-member')
    expect(redisEditKindForValue('zset')).toBe('zset-add-member')
    expect(redisEditKindForValue('unknown')).toBe('hash-set-field')
  })

  it('serializes non-string values for local optimistic updates', () => {
    expect(serializedKeyValue('plain')).toBe('plain')
    expect(serializedKeyValue({ ok: true })).toBe('{"ok":true}')
  })

  it('applies local RedisJSON optimistic path updates', () => {
    const value = {
      profile: {
        name: 'Avery',
        roles: ['viewer', 'editor'],
        'legacy.flag': true,
      },
    }

    expect(setRedisJsonPathValue(value, '$.profile.name', 'Nova')).toEqual({
      profile: {
        name: 'Nova',
        roles: ['viewer', 'editor'],
        'legacy.flag': true,
      },
    })
    expect(deleteRedisJsonPathValue(value, '$.profile.roles[0]')).toEqual({
      profile: {
        name: 'Avery',
        roles: ['editor'],
        'legacy.flag': true,
      },
    })
    expect(deleteRedisJsonPathValue(value, '$.profile["legacy.flag"]')).toEqual({
      profile: {
        name: 'Avery',
        roles: ['viewer', 'editor'],
      },
    })
  })

  it('builds key import and export operation previews from key payloads', () => {
    expect(redisKeyOperationPlanRequest({
      connection,
      editContext,
      operation: 'export',
      payload: {
        key: 'session:1',
        redisType: 'hash',
      },
    })).toMatchObject({
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      operationId: 'redis.key.export',
      objectName: 'session:1',
      parameters: {
        key: 'session:1',
        redisType: 'hash',
        includeMetadata: true,
      },
    })

    expect(redisKeyOperationPlanRequest({
      connection,
      editContext,
      operation: 'import',
      payload: {
        key: 'session:1',
        redisType: 'hash',
      },
    })).toMatchObject({
      operationId: 'redis.key.import',
      parameters: {
        key: 'session:1',
        redisType: 'hash',
        validation: 'validate-before-write',
      },
    })
  })

  it('does not create operation previews without a concrete key scope', () => {
    expect(redisKeyOperationPlanRequest({
      connection,
      editContext,
      operation: 'export',
      payload: undefined,
    })).toBeUndefined()
  })
})

const connection: ConnectionProfile = {
  id: 'conn-redis',
  name: 'Redis',
  engine: 'redis',
  family: 'keyvalue',
  host: '127.0.0.1',
  port: 6379,
  database: '0',
  environmentIds: ['env-dev'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'redis',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const editContext = {
  connectionId: 'conn-redis',
  environmentId: 'env-dev',
  queryText: 'GET session:1',
}
