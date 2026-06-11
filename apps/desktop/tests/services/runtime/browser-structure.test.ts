import { describe, expect, it } from 'vitest'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'
import { createStructureResponseLocally } from '../../../src/services/runtime/browser-structure'

describe('browser structure preview', () => {
  it('renders Redis as a keyspace overview instead of prefix samples', () => {
    const snapshot = createBlankSnapshot()
    snapshot.connections = [keyValueConnection('redis')]

    const response = createStructureResponseLocally(snapshot, {
      connectionId: 'conn-redis',
      environmentId: 'env-local',
      limit: 120,
    })

    expect(response.summary).toContain('Redis keyspace overview')
    expect(response.groups).toEqual([
      expect.objectContaining({ id: 'db:0', label: 'DB 0', kind: 'database' }),
    ])
    expect(response.nodes.map((node) => node.label)).toEqual(['Hashes', 'Sorted Sets', 'Strings'])
    expect(response.nodes.map((node) => node.label)).not.toContain('session:*')
    expect(response.nodes[0]?.fields?.[0]).toEqual(expect.objectContaining({
      name: 'perf:session:000143',
      dataType: 'hash',
    }))
  })

  it('renders Valkey preview structure with Valkey-specific copy', () => {
    const snapshot = createBlankSnapshot()
    snapshot.connections = [keyValueConnection('valkey')]

    const response = createStructureResponseLocally(snapshot, {
      connectionId: 'conn-valkey',
      environmentId: 'env-local',
      limit: 120,
    })

    expect(response.summary).toContain('Valkey keyspace overview')
    expect(response.groups).toEqual([
      expect.objectContaining({
        id: 'db:0',
        label: 'DB 0',
        kind: 'database',
        detail: 'Logical Valkey database',
      }),
    ])
  })
})

function keyValueConnection(engine: 'redis' | 'valkey') {
  const label = engine === 'valkey' ? 'Valkey' : 'Redis'

  return {
    id: `conn-${engine}`,
    name: label,
    engine,
    family: 'keyvalue' as const,
    host: 'localhost',
    port: 6379,
    database: '0',
    connectionString: undefined,
    connectionMode: 'native' as const,
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
