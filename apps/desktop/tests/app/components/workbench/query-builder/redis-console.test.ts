import { describe, expect, it } from 'vitest'
import { createDefaultRedisKeyBrowserState } from '../../../../../src/app/components/workbench/query-builder/redis-key-browser'
import { redisConsoleCommandFromQueryText } from '../../../../../src/app/components/workbench/query-builder/redis-console'

describe('redis console helpers', () => {
  it('turns key-browser JSON into a runnable SCAN command', () => {
    expect(
      redisConsoleCommandFromQueryText(`{
        "mode": "redis-key-browser",
        "pattern": "perf:*",
        "type": "all",
        "count": 250
      }`),
    ).toBe('SCAN 0 MATCH perf:* COUNT 250')
  })

  it('preserves real Redis console commands', () => {
    expect(redisConsoleCommandFromQueryText('HGETALL session:abc')).toBe(
      'HGETALL session:abc',
    )
  })

  it('preserves line-based Redis pipeline commands', () => {
    expect(redisConsoleCommandFromQueryText('PING\nDBSIZE\nINFO stats')).toBe(
      'PING\nDBSIZE\nINFO stats',
    )
  })

  it('uses the browser state as the default console command', () => {
    const state = {
      ...createDefaultRedisKeyBrowserState('orders:*', 50),
      typeFilter: 'hash' as const,
    }

    expect(redisConsoleCommandFromQueryText('', state)).toBe(
      'SCAN 0 MATCH orders:* COUNT 50 TYPE hash',
    )
  })
})
