import { describe, expect, it } from 'vitest'
import type { ExecutionResultEnvelope } from '@datapadplusplus/shared-types'
import {
  fetchDocumentNodeChildrenFromResult,
  summarizeDocumentResultForEfficiencyMode,
} from './browser-document-efficiency'

describe('browser document efficiency helpers', () => {
  it('matches document ids without relying on object key order', () => {
    const result = documentResult([
      {
        _id: { $compound: { region: 'us', id: 7 } },
        payload: { total: 10 },
      },
    ])

    const response = fetchDocumentNodeChildrenFromResult(result, {
      tabId: 'tab-docs',
      connectionId: 'conn-docs',
      environmentId: 'env-qa',
      collection: 'orders',
      documentId: { $compound: { id: 7, region: 'us' } },
      path: ['payload'],
    })

    expect(response.value).toEqual({ total: 10 })
  })

  it('walks numeric array path segments safely', () => {
    const result = documentResult([
      {
        _id: 1,
        items: [{ sku: 'lamp' }, { sku: 'desk' }],
      },
    ])

    const response = fetchDocumentNodeChildrenFromResult(result, {
      tabId: 'tab-docs',
      connectionId: 'conn-docs',
      environmentId: 'env-qa',
      collection: 'orders',
      documentId: 1,
      path: ['items', '1'],
    })

    expect(response.value).toEqual({ sku: 'desk' })
  })

  it('summarizes nested documents without collapsing native BSON scalars', () => {
    const result = summarizeDocumentResultForEfficiencyMode(documentResult([
      {
        _id: { $oid: '660000000000000000000001' },
        createdAt: { $date: { $numberLong: '1778925741369' } },
        payload: { nested: true },
      },
    ]))
    const payload = result.payloads[0]

    expect(payload?.renderer).toBe('document')
    if (payload?.renderer !== 'document') {
      throw new Error('Expected document payload.')
    }

    expect(payload.documents[0]?.createdAt).toEqual({ $date: { $numberLong: '1778925741369' } })
    expect(payload.documents[0]?.payload).toMatchObject({
      __datapadLazyNode: true,
      type: 'object',
      childCount: 1,
    })
  })
})

function documentResult(documents: Array<Record<string, unknown>>): ExecutionResultEnvelope {
  return {
    id: 'result-docs',
    engine: 'mongodb',
    summary: 'Documents',
    executedAt: '2026-05-20T00:00:00.000Z',
    durationMs: 1,
    defaultRenderer: 'document',
    rendererModes: ['document', 'json', 'raw'],
    payloads: [
      {
        renderer: 'document',
        documents,
      },
    ],
    notices: [],
  }
}
