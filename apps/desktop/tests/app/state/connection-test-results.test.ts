import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  buildConnectionTestFailure,
  fixtureWarningsForConnection,
} from '../../../src/app/state/connection-test-results'

describe('connection test results', () => {
  it('builds a drawer-friendly failure result when the runtime rejects a test', () => {
    const profile = connectionProfile({
      engine: 'mongodb',
      family: 'document',
      port: 27017,
      database: 'admin',
      username: '',
    })

    const result = buildConnectionTestFailure(profile, new Error('connection refused'))

    expect(result.ok).toBe(false)
    expect(result.engine).toBe('mongodb')
    expect(result.message).toContain('connection refused')
    expect(result.resolvedHost).toBe('localhost')
    expect(result.warnings).toContain(
      'DataPad++ Docker fixtures expose MongoDB on localhost:27018.',
    )
  })

  it('redacts typed secret values from frontend fallback connection failures', () => {
    const result = buildConnectionTestFailure(
      connectionProfile({
        engine: 'mongodb',
        family: 'document',
        port: 27018,
        database: 'catalog',
        username: 'datapadplusplus',
      }),
      new Error('Authentication failed for password inline-secret-value'),
      'inline-secret-value',
    )

    expect(result.message).not.toContain('inline-secret-value')
    expect(result.message).toContain('********')
  })

  it('adds fixture hints only for local connections with mismatched fixture values', () => {
    const warnings = fixtureWarningsForConnection(
      connectionProfile({
        engine: 'mongodb',
        family: 'document',
        port: 27017,
        database: 'admin',
        username: 'root',
      }),
    )

    expect(warnings).toEqual([
      'DataPad++ Docker fixtures expose MongoDB on localhost:27018.',
      'Fixture database is "catalog".',
      'Fixture user is "datapadplusplus".',
      'This fixture connection needs a password before it can be tested.',
    ])

    expect(
      fixtureWarningsForConnection(
        connectionProfile({
          engine: 'mongodb',
          family: 'document',
          port: 27017,
          database: 'catalog',
          username: 'datapadplusplus',
        }),
        'datapadplusplus',
      ),
    ).toEqual(['DataPad++ Docker fixtures expose MongoDB on localhost:27018.'])

    expect(
      fixtureWarningsForConnection(
        connectionProfile({
          engine: 'mongodb',
          family: 'document',
          host: 'mongo.internal',
          port: 27017,
          database: 'admin',
          username: 'root',
        }),
      ),
    ).toEqual([])
  })
})

function connectionProfile(
  overrides: Partial<ConnectionProfile> & {
    username?: string
  },
): ConnectionProfile {
  const { username, ...profileOverrides } = overrides

  return {
    id: 'conn-test',
    name: 'Test connection',
    engine: overrides.engine ?? 'postgresql',
    family: overrides.family ?? 'sql',
    host: overrides.host ?? 'localhost',
    port: overrides.port,
    database: overrides.database,
    connectionString: overrides.connectionString,
    connectionMode: 'native',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'DB',
    group: undefined,
    color: undefined,
    notes: undefined,
    auth: {
      username,
      authMechanism: undefined,
      sslMode: undefined,
      cloudProvider: undefined,
      principal: undefined,
      secretRef: undefined,
    },
    createdAt: '1',
    updatedAt: '1',
    ...profileOverrides,
  }
}
