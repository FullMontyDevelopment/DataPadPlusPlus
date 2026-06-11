import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { normalizeQueryWindowMode } from '../../src/app/query-window-mode'

describe('normalizeQueryWindowMode', () => {
  it('defaults SQL builder-capable tabs to the raw editor', () => {
    expect(
      normalizeQueryWindowMode(undefined, 'sql-select', connection('postgresql', 'sql')),
    ).toBe('raw')
  })

  it('keeps explicitly selected SQL builder mode', () => {
    expect(
      normalizeQueryWindowMode('builder', 'sql-select', connection('postgresql', 'sql')),
    ).toBe('builder')
  })

  it('defaults non-SQL builder-capable tabs to builder mode', () => {
    expect(
      normalizeQueryWindowMode(undefined, 'mongo-find', connection('mongodb', 'document')),
    ).toBe('builder')
  })

  it('allows script mode only for MongoDB tabs', () => {
    expect(
      normalizeQueryWindowMode('script', 'mongo-find', connection('mongodb', 'document')),
    ).toBe('script')
    expect(
      normalizeQueryWindowMode('script', 'sql-select', connection('postgresql', 'sql')),
    ).toBe('raw')
  })
})

function connection(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    icon: engine,
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
