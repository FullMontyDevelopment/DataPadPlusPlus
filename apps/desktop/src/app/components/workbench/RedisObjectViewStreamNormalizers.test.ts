import { describe, expect, it } from 'vitest'
import {
  normalizePendingEntries,
  normalizePendingSummary,
  normalizeStreamConsumers,
  normalizeStreamEntries,
  normalizeStreamGroups,
  normalizeStreamInfo,
} from './RedisObjectViewStreamNormalizers'

describe('RedisObjectViewStreamNormalizers', () => {
  it('normalizes XINFO STREAM facts from RESP arrays', () => {
    expect(normalizeStreamInfo({
      value: ['length', 12, 'groups', 2, 'last-generated-id', '171-0'],
    })).toMatchObject({
      length: 12,
      groups: 2,
      lastGeneratedId: '171-0',
    })
  })

  it('normalizes consumer groups and consumers from XINFO replies', () => {
    expect(normalizeStreamGroups({
      value: [
        ['name', 'payments', 'consumers', 2, 'pending', 7, 'last-delivered-id', '170-0'],
      ],
    })).toEqual([
      {
        name: 'payments',
        consumers: 2,
        pending: 7,
        lastDeliveredId: '170-0',
      },
    ])

    expect(normalizeStreamConsumers({
      value: [
        ['name', 'worker-1', 'pending', 3, 'idle', 42],
      ],
    })).toEqual([
      {
        name: 'worker-1',
        pending: 3,
        idle: 42,
      },
    ])
  })

  it('normalizes XRANGE entries into field summaries', () => {
    expect(normalizeStreamEntries({
      entries: [
        ['171-0', ['order_id', '42', 'status', 'paid']],
      ],
    })).toEqual([
      {
        id: '171-0',
        fields: {
          orderId: '42',
          status: 'paid',
        },
        detail: 'orderId: 42, status: paid',
      },
    ])
  })

  it('normalizes XPENDING summaries and extended pending entries', () => {
    expect(normalizePendingSummary({
      pendingSummary: [
        2,
        '170-0',
        '171-0',
        [['name', 'worker-1', 'pending', 2]],
      ],
    })).toEqual({
      pending: 2,
      smallestId: '170-0',
      largestId: '171-0',
      consumers: 'worker-1 2 pending',
    })

    expect(normalizePendingEntries({
      pendingEntries: [
        ['170-0', 'worker-1', 5000, 3],
      ],
    })).toEqual([
      {
        id: '170-0',
        consumer: 'worker-1',
        idleMs: 5000,
        deliveries: 3,
      },
    ])
  })
})
