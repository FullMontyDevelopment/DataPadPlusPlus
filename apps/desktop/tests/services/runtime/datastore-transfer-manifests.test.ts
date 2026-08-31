import { describe, expect, it } from 'vitest'
import { DATASTORE_ENGINES } from '@datapadplusplus/shared-types'
import {
  datastoreTransferManifest,
  isDatastoreTransferOperation,
} from '../../../src/services/runtime/datastore-transfer-manifests'

describe('datastore transfer manifests', () => {
  it('declares import, export, backup, and restore for every datastore', () => {
    for (const engine of DATASTORE_ENGINES) {
      const manifest = datastoreTransferManifest(engine)
      expect(manifest.engine).toBe(engine)
      expect(manifest.capabilities.map((item) => item.action)).toEqual([
        'import',
        'export',
        'backup',
        'restore',
      ])
      for (const capability of manifest.capabilities) {
        expect(capability.formats.length).toBeGreaterThan(0)
        expect(capability.destinationKinds.length).toBeGreaterThan(0)
        expect(capability.operationId).toMatch(new RegExp(`^${engine}\\.`))
      }
    }
  })

  it('promotes only the currently executable Wave 1 paths', () => {
    for (const engine of [
      'postgresql', 'mysql', 'mariadb', 'sqlserver', 'sqlite', 'mongodb',
      'redis', 'valkey', 'litedb', 'duckdb',
    ] as const) {
      const capabilities = datastoreTransferManifest(engine).capabilities
      expect(capabilities.find((item) => item.action === 'import')?.executionSupport).toBe('live')
      expect(capabilities.find((item) => item.action === 'export')?.executionSupport).toBe('live')
    }
    expect(datastoreTransferManifest('sqlite').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('live')
    expect(datastoreTransferManifest('duckdb').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('live')
  })

  it('does not mislabel custom logical packages as native backups', () => {
    for (const engine of ['postgresql', 'mysql', 'mariadb'] as const) {
      const backup = datastoreTransferManifest(engine).capabilities.find((item) => item.action === 'backup')
      expect(backup?.executionSupport).toBe('unsupported')
      expect(backup?.disabledReason).toContain('vendor tooling')
    }
    expect(datastoreTransferManifest('sqlserver').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('plan-only')
  })

  it('recognizes generic and engine-specific transfer operations', () => {
    expect(isDatastoreTransferOperation('postgresql.data.import-export')).toBe(true)
    expect(isDatastoreTransferOperation('sqlite.table.export')).toBe(true)
    expect(isDatastoreTransferOperation('mongodb.collection.import')).toBe(true)
    expect(isDatastoreTransferOperation('postgresql.table.analyze')).toBe(false)
  })
})
