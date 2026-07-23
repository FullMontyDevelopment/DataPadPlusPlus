import { describe, expect, it } from 'vitest'
import {
  buildRows,
  collectExpandableRowIdsCooperative,
  compactValue,
  createDocumentTreeIndex,
  createDocumentTreeIndexCooperative,
  documentRowId,
  documentValueTypeLabel,
  isDocumentLazyNode,
  isExpandableValue,
  rowAtDocumentRowId,
} from '../../../../../src/app/components/workbench/results/document-grid-model'

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
      new Set([documentRowId(0, [])]),
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
      new Set([documentRowId(0, []), documentRowId(0, ['inventory'])]),
    )

    expect(rows.map((row) => row.fieldPath)).toEqual(['_id', '_id', 'inventory'])
  })

  it('renders Extended JSON BSON scalars as native terminal values', () => {
    const createdAt = { $date: '2026-05-29T10:00:00.000Z' }
    const ownerId = { $oid: '60a840ad652b980ac314bb89' }
    const sessionId = { $uuid: '00112233-4455-6677-8899-aabbccddeeff' }
    const modifiedAt = { $date: { $numberLong: '1770036000000' } }
    const total = { $numberDecimal: '12.50' }

    expect(isExpandableValue(createdAt)).toBe(false)
    expect(isExpandableValue(ownerId)).toBe(false)
    expect(compactValue(createdAt)).toBe('ISODate("2026-05-29T10:00:00.000Z")')
    expect(compactValue(ownerId)).toBe('ObjectId("60a840ad652b980ac314bb89")')
    expect(compactValue(sessionId)).toBe(
      'UUID("00112233-4455-6677-8899-aabbccddeeff")',
    )
    expect(compactValue(modifiedAt)).toBe('ISODate("2026-02-02T12:40:00.000Z")')
    expect(compactValue(total)).toBe('Decimal128("12.50")')

    const rows = buildRows(
      [{ _id: ownerId, ownerId, sessionId, createdAt, modifiedAt, total }],
      new Set([documentRowId(0, [])]),
    )

    expect(rows[0]).toMatchObject({
      label: 'ObjectId("60a840ad652b980ac314bb89")',
      fieldPath: '_id',
    })
    expect(rows.find((row) => row.fieldPath === 'createdAt')).toMatchObject({
      type: 'date',
      expandable: false,
      valueLabel: 'ISODate("2026-05-29T10:00:00.000Z")',
    })
    expect(rows.find((row) => row.fieldPath === 'ownerId')).toMatchObject({
      type: 'objectid',
      expandable: false,
      valueLabel: 'ObjectId("60a840ad652b980ac314bb89")',
    })
    expect(rows.find((row) => row.fieldPath === 'sessionId')).toMatchObject({
      type: 'uuid',
      expandable: false,
      valueLabel: 'UUID("00112233-4455-6677-8899-aabbccddeeff")',
    })
    expect(documentValueTypeLabel('objectid')).toBe('ObjectId')
    expect(documentValueTypeLabel('uuid')).toBe('UUID')
    expect(documentValueTypeLabel('date')).toBe('Date')
  })

  it('keeps typed paths and row ids distinct for unusual MongoDB field names', () => {
    const rows = buildRows(
      [
        {
          _id: 1,
          'a.b': { '[0]': 'literal' },
          a: { b: ['array value'] },
        },
      ],
      new Set([
        documentRowId(0, []),
        documentRowId(0, ['a.b']),
        documentRowId(0, ['a']),
        documentRowId(0, ['a', 'b']),
      ]),
    )

    const dotted = rows.find((row) => row.path.length === 1 && row.path[0] === 'a.b')
    const nested = rows.find((row) => row.path.length === 2 && row.path.join('.') === 'a.b')
    const bracketKey = rows.find((row) => row.path.at(-1) === '[0]')
    const arrayItem = rows.find((row) => row.path.at(-1) === 0)

    expect(dotted?.id).not.toBe(nested?.id)
    expect(dotted?.fieldPath).toBe('["a.b"]')
    expect(bracketKey?.path.at(-1)).toBe('[0]')
    expect(bracketKey?.fieldPath).toBe('["a.b"]["[0]"]')
    expect(arrayItem?.path.at(-1)).toBe(0)
    expect(arrayItem?.fieldPath).toBe('a.b[0]')
  })

  it('bounds inline scalar previews without changing the complete value', () => {
    const value = 'x'.repeat(3_000)
    const rows = buildRows(
      [{ _id: 'doc-1', description: value }],
      new Set([documentRowId(0, [])]),
    )
    const row = rows.find((item) => item.fieldPath === 'description')

    expect(row?.value).toBe(value)
    expect(row?.valueLabel.length).toBeLessThan(value.length)
    expect(row?.valueLabel).toMatch(/3.000 characters/)
  })

  it('resolves an inspector row directly without expanding the full tree', () => {
    const documents = [{
      _id: 'doc-1',
      profile: { contact: { email: 'ada@example.test' } },
    }]
    const row = rowAtDocumentRowId(
      documents,
      documentRowId(0, ['profile', 'contact', 'email']),
    )

    expect(row).toMatchObject({
      fieldPath: 'profile.contact.email',
      value: 'ada@example.test',
      depth: 3,
    })
  })

  it('collects deeply expandable paths cooperatively', async () => {
    const documents = [{
      _id: 'doc-1',
      nested: { list: [{ child: { enabled: true } }] },
    }]

    await expect(collectExpandableRowIdsCooperative(documents)).resolves.toEqual([
      documentRowId(0, []),
      documentRowId(0, ['nested']),
      documentRowId(0, ['nested', 'list']),
      documentRowId(0, ['nested', 'list', 0]),
      documentRowId(0, ['nested', 'list', 0, 'child']),
    ])
  })

  it('indexes expanded and search-visible rows without flattening the tree', () => {
    const documents = [
      { _id: 'doc-1', profile: { name: 'Ada' } },
      { _id: 'doc-2', profile: { name: 'Grace' } },
    ]
    const expanded = new Set([
      documentRowId(0, []),
      documentRowId(0, ['profile']),
    ])
    const visible = new Set([
      documentRowId(0, []),
      documentRowId(0, ['profile']),
      documentRowId(0, ['profile', 'name']),
    ])
    const index = createDocumentTreeIndex(documents, expanded, visible)

    expect(index.rowCount).toBe(3)
    expect(Array.from({ length: index.rowCount }, (_, row) => index.rowAt(row)?.fieldPath))
      .toEqual(['_id', 'profile', 'profile.name'])
  })

  it('builds the complete expanded index cooperatively', async () => {
    const documents = [{ _id: 'doc-1', nested: { enabled: true } }]
    const expanded = new Set([
      documentRowId(0, []),
      documentRowId(0, ['nested']),
    ])
    const index = await createDocumentTreeIndexCooperative(documents, expanded)

    expect(index.rowCount).toBe(4)
    expect(Array.from({ length: index.rowCount }, (_, row) => index.rowAt(row)?.fieldPath))
      .toEqual(['_id', '_id', 'nested', 'nested.enabled'])
  })
})
