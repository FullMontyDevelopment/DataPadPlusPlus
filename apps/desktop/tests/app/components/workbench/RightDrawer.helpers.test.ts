import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import {
  defaultPortForEngine,
  engineFamily,
  engineOption,
  environmentAccentVariables,
  inferConnectionName,
  isCustomConnectionName,
  redactEnvironmentSecrets,
} from '../../../../src/app/components/workbench/RightDrawer.helpers'

describe('right drawer helper behavior', () => {
  it('derives engine metadata from the shared datastore backlog', () => {
    expect(engineFamily('mongodb')).toBe('document')
    expect(defaultPortForEngine('postgresql')).toBe(5432)
    expect(engineOption('cockroachdb')).toMatchObject({
      label: 'CockroachDB',
      family: 'sql',
    })
  })

  it('infers readable connection names without leaking template variables', () => {
    const snapshot = createSeedSnapshot()
    const postgres = snapshot.connections.find((item) => item.id === 'conn-analytics')!
    const sqlite = snapshot.connections.find((item) => item.id === 'conn-local-sqlite')!

    expect(inferConnectionName({ ...postgres, database: 'warehouse' })).toBe('warehouse')
    expect(inferConnectionName({ ...postgres, database: '${DB_NAME}', host: 'db.internal' })).toBe(
      'PostgreSQL db.internal',
    )
    expect(inferConnectionName(sqlite)).toBe('SQLite connection')
    expect(
      inferConnectionName({
        ...sqlite,
        database: 'C:\\data\\datapadplusplus.db',
        host: 'C:\\data\\datapadplusplus.db',
      }),
    ).toBe('datapadplusplus')
  })

  it('detects generated connection names as non-custom', () => {
    const snapshot = createSeedSnapshot()
    const postgres = snapshot.connections.find((item) => item.id === 'conn-analytics')!

    expect(
      isCustomConnectionName({
        ...postgres,
        name: 'PostgreSQL connection',
        database: '',
        host: 'localhost',
      }),
    ).toBe(false)
    expect(isCustomConnectionName({ ...postgres, name: 'Production analytics' })).toBe(true)
  })

  it('redacts inherited sensitive environment values from connection test output', () => {
    const snapshot = createSeedSnapshot()
    const environments = snapshot.environments.map((environment) =>
      environment.id === 'env-dev'
        ? {
            ...environment,
            variables: {
              ...environment.variables,
              PASSWORD: 'super-secret',
            },
            sensitiveKeys: ['PASSWORD'],
          }
        : environment,
    )

    expect(
      redactEnvironmentSecrets(
        'postgres://developer:super-secret@db.internal/datapadplusplus_dev',
        'env-prod',
        environments,
      ),
    ).toBe('postgres://developer:********@db.internal/datapadplusplus_dev')
  })

  it('normalizes short environment colors for drawer accents', () => {
    const style = environmentAccentVariables({
      ...createSeedSnapshot().environments[0]!,
      color: '#3af',
    }) as Record<string, string>

    expect(style['--connection-env-color']).toBe('#33aaff')
    expect(style['--connection-env-tint']).toBe('rgba(51, 170, 255, 0.1)')
    expect(style['--connection-env-border']).toBe('rgba(51, 170, 255, 0.45)')
  })
})
