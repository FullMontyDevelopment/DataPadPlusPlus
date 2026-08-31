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
      'redis', 'valkey', 'litedb', 'duckdb', 'memcached', 'timescaledb', 'clickhouse', 'arango',
      'cassandra',
      'elasticsearch', 'opensearch',
    ] as const) {
      const capabilities = datastoreTransferManifest(engine).capabilities
      expect(capabilities.find((item) => item.action === 'import')?.executionSupport).toBe('live')
      expect(capabilities.find((item) => item.action === 'export')?.executionSupport).toBe('live')
    }
    expect(datastoreTransferManifest('sqlite').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('live')
    expect(datastoreTransferManifest('duckdb').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('live')
  })

  it('requires explicit Memcached import metadata without claiming key enumeration', () => {
    const manifest = datastoreTransferManifest('memcached')
    const importCapability = manifest.capabilities.find((item) => item.action === 'import')
    const exportCapability = manifest.capabilities.find((item) => item.action === 'export')

    expect(importCapability?.executionSupport).toBe('live')
    expect(importCapability?.supportsMultipleObjects).toBe(false)
    expect(importCapability?.formats.map((item) => item.id)).toEqual(['raw'])
    expect(importCapability?.options?.map((item) => item.id)).toEqual(['flags', 'expirySeconds'])
    expect(exportCapability?.options).toBeUndefined()
  })

  it('does not mislabel custom logical packages as native backups', () => {
    for (const engine of ['postgresql', 'mysql', 'mariadb'] as const) {
      const backup = datastoreTransferManifest(engine).capabilities.find((item) => item.action === 'backup')
      expect(backup?.executionSupport).toBe('unsupported')
      expect(backup?.disabledReason).toContain('vendor tooling')
    }
    expect(datastoreTransferManifest('sqlserver').capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('plan-only')
  })

  it('advertises driver-native PostgreSQL COPY formats separately from portable conversions', () => {
    const formats = datastoreTransferManifest('postgresql').capabilities
      .find((item) => item.action === 'export')?.formats
    expect(formats?.map((item) => [item.id, item.fidelity])).toEqual([
      ['text', 'native'],
      ['csv', 'native'],
      ['binary-copy', 'native'],
      ['json', 'portable'],
      ['ndjson', 'portable'],
    ])
  })

  it('keeps TimescaleDB COPY live and its external-tool backup unavailable', () => {
    const capabilities = datastoreTransferManifest('timescaledb').capabilities
    const exported = capabilities.find((item) => item.action === 'export')
    expect(exported?.executionSupport).toBe('live')
    expect(exported?.formats.map((item) => item.id)).toEqual(['text', 'csv', 'binary-copy'])
    expect(exported?.options?.map((item) => item.id)).toEqual(['timeColumn', 'start', 'end'])
    expect(capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('unsupported')
  })

  it('advertises only native ClickHouse HTTP streaming formats', () => {
    const capabilities = datastoreTransferManifest('clickhouse').capabilities
    const imported = capabilities.find((item) => item.action === 'import')
    const exported = capabilities.find((item) => item.action === 'export')
    expect(imported?.executionSupport).toBe('live')
    expect(imported?.requiresExistingTarget).toBe(true)
    expect(exported?.formats.map((item) => [item.id, item.fidelity])).toEqual([
      ['csv', 'native'],
      ['tsv', 'native'],
      ['json-each-row', 'native'],
      ['parquet', 'native'],
    ])
    expect(capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('plan-only')
  })

  it('advertises complete ArangoDB JSON collection transfer without a lossy CSV claim', () => {
    const capabilities = datastoreTransferManifest('arango').capabilities
    const imported = capabilities.find((item) => item.action === 'import')
    expect(imported?.executionSupport).toBe('live')
    expect(imported?.scope).toBe('collection')
    expect(imported?.formats.map((item) => item.id)).toEqual(['json', 'ndjson'])
    expect(capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('plan-only')
  })

  it('advertises only streaming native Cassandra CQL JSON Lines', () => {
    const capabilities = datastoreTransferManifest('cassandra').capabilities
    const imported = capabilities.find((item) => item.action === 'import')
    const exported = capabilities.find((item) => item.action === 'export')
    expect(imported?.executionSupport).toBe('live')
    expect(imported?.requiresExistingTarget).toBe(true)
    expect(exported?.formats.map((item) => [item.id, item.fidelity])).toEqual([
      ['cql-json-lines', 'native'],
    ])
    expect(capabilities.find((item) => item.action === 'backup')?.executionSupport).toBe('unsupported')
  })

  it('uses a mappings, settings, and Bulk NDJSON folder for search transfers', () => {
    for (const engine of ['elasticsearch', 'opensearch'] as const) {
      const capabilities = datastoreTransferManifest(engine).capabilities
      const imported = capabilities.find((item) => item.action === 'import')
      const exported = capabilities.find((item) => item.action === 'export')
      expect(imported?.executionSupport).toBe('live')
      expect(imported?.requiresExistingTarget).toBe(false)
      expect(imported?.destinationKinds).toEqual(['local-folder'])
      expect(imported?.formats.map((item) => [item.id, item.fidelity])).toEqual([
        ['search-transfer-folder', 'native'],
      ])
      expect(imported?.options?.map((item) => item.id)).toEqual(['targetIndex'])
      expect(exported?.supportsMultipleObjects).toBe(false)
    }
  })

  it('recognizes generic and engine-specific transfer operations', () => {
    expect(isDatastoreTransferOperation('postgresql.data.import-export')).toBe(true)
    expect(isDatastoreTransferOperation('sqlite.table.export')).toBe(true)
    expect(isDatastoreTransferOperation('mongodb.collection.import')).toBe(true)
    expect(isDatastoreTransferOperation('postgresql.table.analyze')).toBe(false)
  })
})
