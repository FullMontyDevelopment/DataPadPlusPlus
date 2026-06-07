import { describe, expect, it } from 'vitest'
import {
  functionListSummary,
  normalizeFunctionLibraries,
} from './RedisObjectViewNormalizers'

describe('RedisObjectViewNormalizers', () => {
  it('normalizes FUNCTION LIST map-shaped replies', () => {
    const libraries = normalizeFunctionLibraries({
      value: [
        [
          { key: 'library_name', value: 'orders' },
          { key: 'engine', value: 'LUA' },
          {
            key: 'functions',
            value: [
              [
                { key: 'name', value: 'reserve' },
                { key: 'flags', value: ['no-writes'] },
              ],
              [
                { key: 'name', value: 'release' },
                { key: 'flags', value: [] },
              ],
            ],
          },
        ],
      ],
    })

    expect(libraries).toHaveLength(1)
    expect(libraries[0]).toMatchObject({
      libraryName: 'orders',
      engine: 'LUA',
    })
    expect(functionListSummary(libraries[0]?.functions)).toBe('reserve, release')
  })
})
