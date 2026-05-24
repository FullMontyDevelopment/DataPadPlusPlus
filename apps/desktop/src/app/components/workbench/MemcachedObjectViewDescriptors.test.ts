import { describe, expect, it } from 'vitest'
import {
  getMemcachedObjectViewDescriptor,
  isMemcachedObjectViewKind,
  memcachedObjectViewMenuLabel,
  MEMCACHED_OBJECT_VIEW_KINDS,
} from './MemcachedObjectViewDescriptors'

describe('MemcachedObjectViewDescriptors', () => {
  it('covers native Memcached metadata surfaces', () => {
    expect(MEMCACHED_OBJECT_VIEW_KINDS).toEqual(
      expect.arrayContaining([
        'server',
        'stats',
        'slabs',
        'slab',
        'items',
        'item-class',
        'settings',
        'connections',
        'diagnostics',
      ]),
    )
  })

  it('uses specific workflow labels instead of generic view labels', () => {
    expect(memcachedObjectViewMenuLabel('stats')).toBe('Open Stats')
    expect(memcachedObjectViewMenuLabel('ITEMS')).toBe('Review Item Classes')
    expect(memcachedObjectViewMenuLabel('slab')).toBe('Open Slab Class')
    expect(memcachedObjectViewMenuLabel('stats')).not.toBe('Open View')
  })

  it('identifies implemented kinds and falls back safely for unknown nodes', () => {
    expect(isMemcachedObjectViewKind('settings')).toBe(true)
    expect(isMemcachedObjectViewKind('item class')).toBe(true)
    expect(isMemcachedObjectViewKind('key')).toBe(false)
    expect(getMemcachedObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect Memcached Object',
      title: 'Memcached Object',
    })
  })
})
