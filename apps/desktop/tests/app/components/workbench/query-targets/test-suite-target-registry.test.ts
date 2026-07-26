import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  DatastoreEngine,
} from '@datapadplusplus/shared-types'
import {
  DATASTORE_TEST_TARGET_PROVIDERS,
  datastoreTestTargetBreadcrumb,
  datastoreTestStarterQuery,
  inferredDatastoreTestLanguage,
  validateDatastoreTestTarget,
} from '../../../../../src/app/components/workbench/query-targets/test-suite-target-registry'

describe('datastore test target registry', () => {
  it('renders a stable missing-target breadcrumb for restored legacy state', () => {
    expect(datastoreTestTargetBreadcrumb(undefined)).toBe('Target required')
  })

  it('declares one bounded target provider for every enabled test engine', () => {
    expect(Object.keys(DATASTORE_TEST_TARGET_PROVIDERS)).toEqual([
      'postgresql',
      'sqlite',
      'mongodb',
      'redis',
      'valkey',
      'dynamodb',
    ])

    for (const engine of Object.keys(DATASTORE_TEST_TARGET_PROVIDERS) as DatastoreEngine[]) {
      const provider = DATASTORE_TEST_TARGET_PROVIDERS[engine]
      expect(provider?.engine).toBe(engine)
      expect(provider?.acceptedTargetKinds.size).toBeGreaterThan(0)
      expect(typeof provider?.starterQuery).toBe('function')
    }
  })

  it.each([
    ['postgresql', 'sql', { kind: 'table', label: 'orders', path: ['public'] }, 'select * from "public"."orders" limit 1;'],
    ['sqlite', 'sql', { kind: 'database', label: 'local.sqlite3' }, 'select 1;'],
    ['mongodb', 'mongodb', { kind: 'collection', label: 'products', path: ['catalog'] }, '"collection": "products"'],
    ['redis', 'redis', { kind: 'prefix', label: 'session:' }, 'SCAN 0 MATCH session:* COUNT 25'],
    ['valkey', 'redis', { kind: 'database', label: 'DB 0' }, 'PING'],
    ['dynamodb', 'json', { kind: 'table', label: 'orders' }, '"tableName": "orders"'],
  ] as const)(
    'infers %s language and generates a target-aware starter',
    (engine, language, target, expected) => {
      const connection = fixtureConnection(engine)
      expect(validateDatastoreTestTarget(connection, target)).toBeUndefined()
      expect(inferredDatastoreTestLanguage(connection)).toBe(language)
      expect(datastoreTestStarterQuery(connection, target)).toContain(expected)
    },
  )

  it('rejects target kinds outside the provider policy', () => {
    expect(
      validateDatastoreTestTarget(
        fixtureConnection('dynamodb'),
        { kind: 'index', label: 'gsi-1' },
      ),
    ).toMatch(/not a supported test-suite target/)
  })
})

function fixtureConnection(engine: DatastoreEngine): ConnectionProfile {
  const family =
    engine === 'postgresql' || engine === 'sqlite'
      ? 'sql'
      : engine === 'mongodb'
        ? 'document'
        : engine === 'redis' || engine === 'valkey'
          ? 'keyvalue'
          : 'widecolumn'
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    auth: {},
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  } as ConnectionProfile
}
