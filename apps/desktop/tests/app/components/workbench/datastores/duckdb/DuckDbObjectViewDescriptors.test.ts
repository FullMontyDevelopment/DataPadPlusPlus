import { describe, expect, it } from 'vitest'
import {
  DUCKDB_OBJECT_VIEW_KINDS,
  duckDbObjectViewMenuLabel,
  getDuckDbObjectViewDescriptor,
  isDuckDbObjectViewKind,
} from '../../../../../../src/app/components/workbench/datastores/duckdb/DuckDbObjectViewDescriptors'

describe('DuckDbObjectViewDescriptors', () => {
  it('covers DuckDB-local analytics surfaces', () => {
    expect(DUCKDB_OBJECT_VIEW_KINDS).toEqual(
      expect.arrayContaining([
        'database',
        'schemas',
        'schema',
        'tables',
        'table',
        'views',
        'view',
        'indexes',
        'extensions',
        'attached-databases',
        'files',
        'pragmas',
        'functions',
        'statistics',
        'diagnostics',
      ]),
    )
  })

  it('uses operation-specific menu labels', () => {
    expect(duckDbObjectViewMenuLabel('table')).toBe('Open Table')
    expect(duckDbObjectViewMenuLabel('extensions')).toBe('Manage Extensions')
    expect(duckDbObjectViewMenuLabel('attached databases')).toBe('Open Attached Databases')
    expect(duckDbObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('recognizes known object kinds and falls back safely', () => {
    expect(isDuckDbObjectViewKind('pragmas')).toBe(true)
    expect(isDuckDbObjectViewKind('function')).toBe(true)
    expect(isDuckDbObjectViewKind('unknown')).toBe(false)
    expect(getDuckDbObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect DuckDB Object',
      title: 'DuckDB Object',
    })
  })
})
