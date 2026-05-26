import { describe, expect, it } from 'vitest'
import {
  buildRows,
  compactValue,
  isDocumentLazyNode,
  isExpandableValue,
} from './document-grid-model'

describe('document-grid-model lazy nodes', () => {
  it('renders lazy object and array markers as expandable counted rows', () => {
    const objectMarker = {
      __datapadLazyNode: true,
      type: 'object' as const,
      childCount: 3,
      path: ['inventory'],
      loaded: false,
    }
    const arrayMarker = {
      __datapadLazyNode: true,
      type: 'array' as const,
      childCount: 2,
      path: ['channels'],
      loaded: false,
    }

    expect(isDocumentLazyNode(objectMarker)).toBe(true)
    expect(isExpandableValue(objectMarker)).toBe(true)
    expect(compactValue(objectMarker)).toBe('{3 field(s)}')
    expect(compactValue(arrayMarker)).toBe('[2 item(s)]')

    const rows = buildRows(
      [{ _id: 'doc-1', inventory: objectMarker, channels: arrayMarker }],
      new Set(['document-0']),
    )

    expect(rows.find((row) => row.fieldPath === 'inventory')).toMatchObject({
      type: 'object',
      valueLabel: '{3 field(s)}',
      expandable: true,
      lazy: true,
      childCount: 3,
    })
    expect(rows.find((row) => row.fieldPath === 'channels')).toMatchObject({
      type: 'array',
      valueLabel: '[2 item(s)]',
      expandable: true,
      lazy: true,
      childCount: 2,
    })
  })

  it('does not expose lazy marker internals as child rows', () => {
    const rows = buildRows(
      [
        {
          _id: 'doc-1',
          inventory: {
            __datapadLazyNode: true,
            type: 'object',
            childCount: 2,
            path: ['inventory'],
            loaded: false,
          },
        },
      ],
      new Set(['document-0', 'document-0.inventory']),
    )

    expect(rows.map((row) => row.fieldPath)).toEqual(['_id', '_id', 'inventory'])
  })
})
