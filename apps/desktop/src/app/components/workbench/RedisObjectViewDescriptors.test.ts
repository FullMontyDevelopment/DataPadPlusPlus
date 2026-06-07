import { describe, expect, it } from 'vitest'
import {
  getRedisObjectViewDescriptor,
  isRedisObjectViewKind,
  redisObjectViewMenuLabel,
} from './RedisObjectViewDescriptors'

describe('RedisObjectViewDescriptors', () => {
  it('uses Redis-specific operation labels', () => {
    expect(redisObjectViewMenuLabel('database')).toBe('Open DB Overview')
    expect(redisObjectViewMenuLabel('keys')).toBe('Browse Keys')
    expect(redisObjectViewMenuLabel('pubsub-channel')).toBe('Review Pub/Sub Channels')
    expect(redisObjectViewMenuLabel('stream-groups')).toBe('Review Consumer Groups')
    expect(redisObjectViewMenuLabel('stream-pending')).toBe('Review Pending Entries')
    expect(redisObjectViewMenuLabel('search-index')).toBe('Manage Search Indexes')
    expect(redisObjectViewMenuLabel('security')).toBe('Manage ACL / Security')
    expect(redisObjectViewMenuLabel('database')).not.toBe('Open View')
  })

  it('normalizes supported object kinds', () => {
    expect(isRedisObjectViewKind('hash')).toBe(true)
    expect(isRedisObjectViewKind('pubsub-subscriber')).toBe(true)
    expect(isRedisObjectViewKind('stream-consumers')).toBe(true)
    expect(isRedisObjectViewKind('vectorset')).toBe(true)
    expect(isRedisObjectViewKind('lua-scripts')).toBe(true)
    expect(isRedisObjectViewKind('acl-users')).toBe(false)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getRedisObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect Redis Metadata')
    expect(descriptor.purpose).toContain('Redis metadata')
  })

  it('adapts shared descriptors for Valkey object views', () => {
    const descriptor = getRedisObjectViewDescriptor('databases', 'valkey')
    const fallback = getRedisObjectViewDescriptor('unknown-feature', 'valkey')

    expect(descriptor.title).toBe('Valkey Databases')
    expect(descriptor.purpose).toContain('Valkey databases')
    expect(fallback.menuLabel).toBe('Inspect Valkey Metadata')
  })
})
