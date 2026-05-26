import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildKeyValueEditRequest,
  buildRedisMemberDeleteRequest,
  keyValueCanEdit,
  parseKeyValueInput,
} from './keyvalue-edit-requests'

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
  auth: {
    secretRef: {
      id: 'secret-redis',
      provider: 'manual',
      service: 'DataPad++',
      account: 'conn-redis',
      label: 'Redis credential',
    },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const editContext = {
  connectionId: 'conn-redis',
  environmentId: 'env-dev',
  queryText: 'GET session:1',
}

describe('keyvalue edit requests', () => {
  it('builds concrete Redis value edits', () => {
    expect(
      buildKeyValueEditRequest({
        connection,
        editContext,
        editKind: 'set-key-value',
        key: 'session:1',
        value: { state: 'paused' },
      }),
    ).toEqual({
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'set-key-value',
      confirmationText: undefined,
      target: {
        objectKind: 'key',
        path: [],
        key: 'session:1',
      },
      changes: [
        {
          value: { state: 'paused' },
          valueType: 'object',
        },
      ],
    })
  })

  it('leaves destructive key deletion confirmation to runtime guardrails', () => {
    expect(
      buildKeyValueEditRequest({
        connection,
        editContext,
        editKind: 'delete-key',
        key: 'session:1',
      }),
    ).toMatchObject({
      editKind: 'delete-key',
      confirmationText: undefined,
      changes: [],
    })
  })

  it('builds Redis TTL persistence requests without fake value changes', () => {
    expect(
      buildKeyValueEditRequest({
        connection,
        editContext,
        editKind: 'persist-ttl',
        key: 'session:1',
      }),
    ).toEqual({
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      editKind: 'persist-ttl',
      confirmationText: undefined,
      target: {
        objectKind: 'key',
        path: [],
        key: 'session:1',
      },
      changes: [],
    })
  })

  it('builds Redis key rename requests with the destination key name', () => {
    expect(
      buildKeyValueEditRequest({
        connection,
        editContext,
        editKind: 'rename-key',
        key: 'session:1',
        newName: 'session:renamed',
      }),
    ).toMatchObject({
      editKind: 'rename-key',
      target: {
        objectKind: 'key',
        key: 'session:1',
      },
      changes: [
        {
          field: 'session:1',
          newName: 'session:renamed',
        },
      ],
    })
  })

  it('builds Redis member delete requests without targeting the member as a top-level key', () => {
    expect(
      buildRedisMemberDeleteRequest({
        connection,
        editContext,
        key: 'product:luna-lamp',
        member: 'sku',
        redisType: 'hash',
      }),
    ).toMatchObject({
      editKind: 'hash-delete-field',
      target: {
        objectKind: 'key-member',
        key: 'product:luna-lamp',
        path: ['sku'],
      },
      changes: [
        {
          field: 'sku',
        },
      ],
    })

    expect(
      buildRedisMemberDeleteRequest({
        connection,
        editContext,
        key: 'products:featured',
        member: 'luna-lamp',
        rawValue: 'luna-lamp',
        redisType: 'set',
      }),
    ).toMatchObject({
      editKind: 'set-remove-member',
      target: {
        key: 'products:featured',
      },
      changes: [
        {
          value: 'luna-lamp',
        },
      ],
    })
  })

  it('blocks read-only and non-keyvalue connections from key edits', () => {
    expect(keyValueCanEdit({ ...connection, readOnly: true }, editContext)).toBe(false)
    expect(
      buildKeyValueEditRequest({
        connection: { ...connection, readOnly: true },
        editContext,
        editKind: 'set-ttl',
        key: 'session:1',
        value: 60,
      }),
    ).toBeUndefined()
  })

  it('parses JSON-like input and preserves plain strings', () => {
    expect(parseKeyValueInput('{"state":"active"}')).toEqual({ state: 'active' })
    expect(parseKeyValueInput('42')).toBe(42)
    expect(parseKeyValueInput('plain text')).toBe('plain text')
  })
})
