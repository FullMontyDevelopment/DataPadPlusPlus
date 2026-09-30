import type { DocumentNodeChildrenRequest, DocumentPayload } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { completeDocumentCopyValue, prepareResultClipboardPayload, resultPayloadToClipboardText, resultValueToClipboardText } from '../../../../../src/app/components/workbench/results/result-copy'

const marker = { __datapadLazyNode: true, type: 'object', childCount: 1, path: ['nested'], loaded: false }
const request: DocumentNodeChildrenRequest = { tabId: 'tab', connectionId: 'mongo', environmentId: 'uat', database: 'fixture', collection: 'items', documentId: 'one', path: [] }
const full = { _id: 'one', nested: { value: '原始' }, large: { $numberLong: '9223372036854775807' }, binary: { $binary: { base64: 'AQID', subType: '00' } }, __datapadCustomerField: 'preserve', metadata: { preserve: true } }

describe('source-only result copying', () => {
  it('preserves datastore fields and native wrappers without silently removing names', () => {
    expect(JSON.parse(resultValueToClipboardText(full))).toEqual(full)
    expect(resultValueToClipboardText(' { "original": "text" } ')).toBe(' { "original": "text" } ')
  })
  it.each(['__datapadLazyNode', '__datapadTruncated', '__datapadUnsupported'])('rejects %s at any depth', key => {
    expect(() => resultValueToClipboardText({ nested: [{ [key]: true }] })).toThrow(/Nothing was copied/)
  })
  it('loads only incomplete documents with full-value mode and excludes presentation metadata', async () => {
    const fetch = vi.fn(async (input: DocumentNodeChildrenRequest) => ({ ...input, value: full, notices: [] }))
    const payload: DocumentPayload = { renderer: 'document', database: 'fixture', collection: 'items', hydrationMode: 'lazy', documents: [{ _id: 'one', nested: marker }, { _id: 'two', value: 2 }], metadata: { privateUi: true } }
    const prepared = await prepareResultClipboardPayload(payload, request, fetch)
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ ...request, mode: 'full-value' })
    expect(JSON.parse(resultPayloadToClipboardText(prepared))).toEqual([full, { _id: 'two', value: 2 }])
    expect(payload.documents[0]!.nested).toEqual(marker)
  })
  it.each(['absent', 'wrong-tab', 'wrong-id', 'wrong-path', 'incomplete', 'wrong-root'])('rejects %s hydration without a partial fallback', async kind => {
    const response = { ...request, value: full as unknown, notices: [] }
    if (kind === 'wrong-tab') response.tabId = 'other'
    if (kind === 'wrong-id') response.documentId = 'other'
    if (kind === 'wrong-path') response.path = ['other']
    if (kind === 'incomplete') response.value = { ...full, nested: marker }
    if (kind === 'wrong-root') response.value = { ...full, _id: 'other' }
    await expect(completeDocumentCopyValue(marker, request, async () => kind === 'absent' ? undefined : response)).rejects.toThrow()
  })
  it('copies only key-value data and refuses incomplete previews', () => {
    expect(resultPayloadToClipboardText({ renderer: 'keyvalue', entries: {}, value: 'original', metadata: { private: 1 } })).toBe('original')
    expect(() => resultPayloadToClipboardText({ renderer: 'keyvalue', entries: {}, value: 'partial', sampleTruncated: true })).toThrow(/Nothing was copied/)
  })
  it.each([
    [42, { $numberInt: '42' }],
    [{ $numberLong: '9223372036854775807' }, { $numberLong: '9223372036854775807' }],
    [{ $oid: '0123456789abcdef01234567' }, { $oid: '0123456789abcdef01234567' }],
  ])('matches native identity representations losslessly (%j)', async (previewId, fullId) => {
    const value = { ...full, _id: fullId }
    await expect(completeDocumentCopyValue(marker, { ...request, documentId: previewId }, async input => ({ ...input, value, notices: [] }))).resolves.toEqual(value)
  })
  it('copies batch data without query text, notices, identifiers or timing', () => {
    expect(JSON.parse(resultPayloadToClipboardText({ renderer: 'batch', sections: [{ id: 'ui-id', label: 'UI label', statement: 'private query', status: 'success', notices: [], defaultRenderer: 'keyvalue', rendererModes: ['keyvalue'], payloads: [{ renderer: 'keyvalue', entries: {}, value: 'source' }] }] }))).toEqual(['source'])
  })
})
