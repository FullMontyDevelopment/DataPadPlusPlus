import { describe, expect, it } from 'vitest'
import {
  getSqliteObjectViewDescriptor,
  isSqliteObjectViewKind,
  sqliteObjectViewMenuLabel,
} from '../../../../../../src/app/components/workbench/datastores/sqlite/SqliteObjectViewDescriptors'

describe('SqliteObjectViewDescriptors', () => {
  it('uses SQLite-specific operation labels', () => {
    expect(sqliteObjectViewMenuLabel('table')).toBe('Open Table')
    expect(sqliteObjectViewMenuLabel('foreign keys')).toBe('Open Foreign Keys')
    expect(sqliteObjectViewMenuLabel('pragma')).toBe('Open Pragma')
    expect(sqliteObjectViewMenuLabel('maintenance')).toBe('Open Maintenance')
    expect(sqliteObjectViewMenuLabel('dependencies')).toBe('Open Dependencies')
    expect(sqliteObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes SQLite object kinds', () => {
    expect(isSqliteObjectViewKind('virtual tables')).toBe(true)
    expect(isSqliteObjectViewKind('generated_columns')).toBe(true)
    expect(isSqliteObjectViewKind('foreign-keys')).toBe(true)
    expect(isSqliteObjectViewKind('maintenance')).toBe(true)
    expect(isSqliteObjectViewKind('dependencies')).toBe(true)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getSqliteObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect SQLite Object')
    expect(descriptor.purpose).toContain('SQLite metadata')
  })
})
