import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { connectionUsesManagedOracleRuntime } from '../../../src/app/state/oracle-runtime'

describe('Oracle runtime metadata gating', () => {
  it('defaults Oracle profiles to the managed runtime', () => {
    expect(connectionUsesManagedOracleRuntime(connection())).toBe(true)
  })

  it.each(['contract', 'sqlplus'] as const)(
    'does not start managed metadata for %s profiles',
    (executionRuntime) => {
      expect(
        connectionUsesManagedOracleRuntime(
          connection({ oracleOptions: { executionRuntime } }),
        ),
      ).toBe(false)
    },
  )

  it('does not interfere with non-Oracle metadata loading', () => {
    expect(connectionUsesManagedOracleRuntime(connection({ engine: 'postgresql' }))).toBe(true)
  })
})

function connection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'oracle-runtime-test',
    name: 'Oracle runtime test',
    engine: 'oracle',
    family: 'sql',
    host: '127.0.0.1',
    environmentIds: ['local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: '',
    auth: {},
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}
