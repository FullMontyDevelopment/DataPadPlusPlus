import { describe, expect, it } from 'vitest'
import { sameDocumentIdentity, visibleValueMatches } from '../../../../../src/app/components/workbench/results/use-document-edit-preparation'

describe('document edit preparation comparisons', () => {
  it.each([
    [{ $binary: { base64: 'ABEiM0RVZneImaq7zN3u/w==', subType: '04' } }, { $uuid: '00112233-4455-6677-8899-aabbccddeeff' }],
    [{ $date: { $numberLong: '0' } }, { $date: '1970-01-01T00:00:00.000Z' }],
    [{ $numberLong: '42' }, 42], [{ $numberInt: '42' }, 42], [{ $numberDouble: '42.0' }, 42],
    [{ tenant: 'one', count: { $numberInt: '42' } }, { tenant: 'one', count: 42 }],
    [{ $numberLong: '9223372036854775807' }, { $numberLong: '9223372036854775807' }],
  ])('recognizes canonical and readable BSON identities %#', (left, right) => {
    expect(sameDocumentIdentity(left, right)).toBe(true)
    expect(sameDocumentIdentity(right, left)).toBe(true)
  })

  it.each([
    [{ $binary: { base64: 'ABEiM0RVZneImaq7zN3u/w==', subType: '03' } }, { $uuid: '00112233-4455-6677-8899-aabbccddeeff' }],
    [{ $binary: { base64: 'broken', subType: '04' } }, { $uuid: '00112233-4455-6677-8899-aabbccddeeff' }],
    ['42', 42], [{ $numberLong: '9223372036854775807' }, Number('9223372036854775807')],
    [{ $numberDouble: 'NaN' }, null], [{ $oid: '00112233445566778899aabb' }, { $oid: '00112233445566778899aabc' }],
  ])('rejects changed, ambiguous, or rounded identities %#', (left, right) => {
    expect(sameDocumentIdentity(left, right)).toBe(false)
  })

  it('ignores unavailable descendants but detects changed or removed visible fields', () => {
    const marker = { __datapadLazyNode: true, type: 'array', childCount: 2, path: ['items'], loaded: false }
    const preview = { name: 'before', items: marker }
    expect(visibleValueMatches(preview, { items: [1, { native: { $numberLong: '9223372036854775807' } }], name: 'before' })).toBe(true)
    expect(visibleValueMatches(preview, { items: null, name: 'before' })).toBe(false)
    expect(visibleValueMatches(preview, { items: [], name: 'after' })).toBe(false)
    expect(visibleValueMatches(preview, { items: [] })).toBe(false)
    expect(visibleValueMatches({ items: [1, marker] }, { items: [2, []] })).toBe(false)
  })

  it('does not mistake lossless numeric wrappers for a changed visible number', () => {
    expect(visibleValueMatches({ n: 1, f: 1.0, a: [2] }, { n: { $numberInt: '1' }, f: { $numberDouble: '1.0' }, a: [{ $numberLong: '2' }] })).toBe(true)
    expect(visibleValueMatches(1, { $numberInt: '2' })).toBe(false)
    expect(visibleValueMatches('1', { $numberInt: '1' })).toBe(false)
  })
})
