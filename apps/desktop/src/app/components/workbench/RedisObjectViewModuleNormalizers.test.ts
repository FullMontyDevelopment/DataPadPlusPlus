import { describe, expect, it } from 'vitest'
import {
  isRedisModuleViewKind,
  redisModuleCards,
  redisModuleCommandRows,
  redisModuleDisabledRows,
  redisModuleIndexRows,
  redisModuleKeyRows,
} from './RedisObjectViewModuleNormalizers'

describe('RedisObjectViewModuleNormalizers', () => {
  it('classifies Redis Stack module view kinds', () => {
    expect(isRedisModuleViewKind('json')).toBe(true)
    expect(isRedisModuleViewKind('timeseries')).toBe(true)
    expect(isRedisModuleViewKind('search-index')).toBe(true)
    expect(isRedisModuleViewKind('stream')).toBe(false)
  })

  it('renders module key details without falling back to raw JSON', () => {
    const payload = {
      database: 0,
      moduleKind: 'json',
      keys: [
        {
          key: 'profile:1',
          type: 'json',
          ttlSeconds: -1,
          memoryUsageBytes: 512,
          moduleDetails: {
            jsonType: ['object'],
            objectLength: [3],
            memoryBytes: [512],
          },
        },
      ],
      moduleCommands: [
        { command: 'JSON.TYPE', purpose: 'Inspect JSON path type', evidence: 'optional live read-only probe' },
      ],
      disabledActions: {
        edit: 'JSON writes are guarded separately.',
      },
    }

    expect(redisModuleCards('json', payload)).toEqual([
      ['Module', 'JSON'],
      ['Keys', '1'],
      ['Read probes', '1'],
      ['Guarded gaps', '1'],
    ])
    expect(redisModuleKeyRows(payload.keys)).toEqual([
      ['profile:1', 'JSON', '-1', '512', 'jsonType: ["object"], objectLength: [3], memoryBytes: [512]'],
    ])
    expect(redisModuleCommandRows(payload.moduleCommands)).toEqual([
      ['JSON.TYPE', 'Inspect JSON path type', 'optional live read-only probe'],
    ])
    expect(redisModuleDisabledRows(payload)).toEqual([
      ['edit', 'JSON writes are guarded separately.'],
    ])
  })

  it('summarizes RediSearch index metadata from FT.INFO records', () => {
    expect(redisModuleIndexRows([
      {
        name: 'idx:orders',
        moduleDetails: {
          numDocs: 42,
          attributes: [
            ['identifier', '$.status', 'attribute', 'status', 'type', 'TAG'],
          ],
          indexDefinition: {
            prefixes: ['order:'],
          },
        },
      },
    ])).toEqual([
      ['idx:orders', '42', 'status', 'order:', 'numDocs: 42, attributes: [["identifier","$.status","attribute","status","type","TAG"]], indexDefinition: {"prefixes":["order:"]}'],
    ])
  })
})
