import { describe, expect, it } from 'vitest'
import {
  getLiteDbObjectViewDescriptor,
  isLiteDbObjectViewKind,
  liteDbObjectViewMenuLabel,
  LITEDB_OBJECT_VIEW_KINDS,
} from './LiteDbObjectViewDescriptors'

describe('LiteDbObjectViewDescriptors', () => {
  it('covers native LiteDB object-view kinds', () => {
    expect(LITEDB_OBJECT_VIEW_KINDS).toEqual(
      expect.arrayContaining([
        'database',
        'collections',
        'collection',
        'documents',
        'schema',
        'indexes',
        'index',
        'file-storage',
        'files',
        'chunks',
        'storage',
        'settings',
        'diagnostics',
      ]),
    )
  })

  it('uses workflow-specific labels instead of generic open-view wording', () => {
    expect(liteDbObjectViewMenuLabel('collection')).toBe('Open Collection')
    expect(liteDbObjectViewMenuLabel('file storage')).toBe('Browse File Storage')
    expect(liteDbObjectViewMenuLabel('indexes')).toBe('Manage Indexes')
    expect(liteDbObjectViewMenuLabel('collection')).not.toBe('Open View')
  })

  it('identifies implemented kinds and falls back safely for unknown nodes', () => {
    expect(isLiteDbObjectViewKind('storage')).toBe(true)
    expect(isLiteDbObjectViewKind('schema')).toBe(true)
    expect(isLiteDbObjectViewKind('role')).toBe(false)
    expect(getLiteDbObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect LiteDB Object',
      title: 'LiteDB Object',
    })
  })
})
