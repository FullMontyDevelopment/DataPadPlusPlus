import type { ConnectionProfile, DatastoreTreeNodeManifest } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { resolveManifestTreeLabel } from '../../../../src/app/components/workbench/SideBar.connection-tree-manifest'

describe('resolveManifestTreeLabel', () => {
  it('does not invent a database label when no database source exists', () => {
    const node: DatastoreTreeNodeManifest = {
      id: 'selected-database',
      label: '{{database}}',
      kind: 'database',
      requiresDatabase: true,
    }

    expect(resolveManifestTreeLabel(connection({ database: undefined }), node)).toBeUndefined()
  })

  it('uses explicit manifest defaults but never the generic word default', () => {
    const node: DatastoreTreeNodeManifest = {
      id: 'redis-db',
      label: 'DB {{database:0}}',
      kind: 'database',
    }

    expect(resolveManifestTreeLabel(connection({ database: undefined }), node)).toBe('DB 0')
  })
})

function connection(overrides: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: 'conn-1',
    name: 'Connection',
    engine: 'sqlserver',
    family: 'sql',
    host: 'localhost',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'database',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
