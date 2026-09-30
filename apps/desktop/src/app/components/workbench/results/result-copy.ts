import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse, ResultPayload } from '@datapadplusplus/shared-types'
import { containsUnavailableValue } from './document-edit-validation'
import { serializePayloadForExport } from './payload-export-serializers'
import { sameDocumentIdentity } from './use-document-edit-preparation'

export function assertCompleteCopyValue(value: unknown) {
  if (containsUnavailableValue(value)) {
    throw new Error('This value is not fully loaded. Load the complete value or rerun without efficiency mode before copying. Nothing was copied.')
  }
}

export function resultValueToClipboardText(value: unknown) {
  assertCompleteCopyValue(value)
  if (value === undefined) throw new Error('This value is unavailable. Nothing was copied.')
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

type FetchDocument = (request: DocumentNodeChildrenRequest) => Promise<DocumentNodeChildrenResponse | undefined>

export async function completeDocumentCopyValue(
  value: unknown,
  request: DocumentNodeChildrenRequest | undefined,
  fetch: FetchDocument | undefined,
) {
  if (!containsUnavailableValue(value)) return value
  if (!fetch || !request) { assertCompleteCopyValue(value); return value }
  const response = await fetch({ ...request, mode: 'full-value' })
  if (!response || response.tabId !== request.tabId ||
      !sameDocumentIdentity(response.documentId, request.documentId) ||
      JSON.stringify(response.path) !== JSON.stringify(request.path)) {
    throw new Error('The complete value could not be loaded for this result. Nothing was copied.')
  }
  assertCompleteCopyValue(response.value)
  if (request.path.length === 0 && (!response.value || typeof response.value !== 'object' ||
      Array.isArray(response.value) || !sameDocumentIdentity((response.value as Record<string, unknown>)._id, request.documentId))) {
    throw new Error('The loaded document does not match this result. Nothing was copied.')
  }
  return response.value
}

export async function prepareResultClipboardPayload(
  payload: ResultPayload,
  context: Omit<DocumentNodeChildrenRequest, 'documentId' | 'path' | 'collection'> | undefined,
  fetch: FetchDocument | undefined,
): Promise<ResultPayload> {
  if (payload.renderer === 'document') {
    const documents: Array<Record<string, unknown>> = []
    for (const document of payload.documents) {
      const request = context && payload.collection && document._id !== undefined
        ? { ...context, database: payload.database ?? context.database, collection: payload.collection, documentId: document._id, path: [] }
        : undefined
      documents.push(await completeDocumentCopyValue(document, request, fetch) as Record<string, unknown>)
    }
    return { ...payload, documents }
  }
  if (payload.renderer === 'batch') {
    const sections = []
    for (const section of payload.sections) {
      const selected = section.payloads.find(item => item.renderer === section.defaultRenderer) ?? section.payloads[0]
      if (!selected) throw new Error('This result section is unavailable. Nothing was copied.')
      const prepared = await prepareResultClipboardPayload(selected, context, fetch)
      if (prepared.renderer === 'batch') throw new Error('Nested result sections are unsupported.')
      sections.push({ ...section, payloads: [prepared] })
    }
    return { ...payload, sections }
  }
  return payload
}

// Clipboard data is separate from export/diagnostic envelopes. Never remove
// user fields by prefix: a datastore may legitimately contain such names.
export function resultPayloadToClipboardText(payload: ResultPayload): string {
  if (payload.renderer === 'table') return serializePayloadForExport(payload, 'csv')
  return resultValueToClipboardText(payloadClipboardValue(payload))
}

function payloadClipboardValue(payload: ResultPayload): unknown {
  if (payload.renderer === 'batch') {
    return payload.sections.map(section => {
      const selected = section.payloads.find(item => item.renderer === section.defaultRenderer) ?? section.payloads[0]
      if (!selected) return null
      return payloadClipboardValue(selected)
    })
  }
  if (payload.renderer === 'keyvalue') {
    if (payload.sampleTruncated || payload.preview?.truncated) {
      throw new Error('This result contains a value preview. Use View Value to load and copy the complete value. Nothing was copied.')
    }
    return payload.value !== undefined ? payload.value : payload.members ?? payload.entries
  }
  switch (payload.renderer) {
    case 'raw': case 'resp': return payload.text
    case 'document': return payload.documents
    case 'json': case 'plan': return payload.value
    case 'table': return payload.rows.map(row => Object.fromEntries(payload.columns.map((column, index) => [column, row[index]])))
    case 'schema': return payload.items
    case 'graph': return { nodes: payload.nodes.map(node => node.raw ?? node), edges: payload.edges.map(edge => edge.raw ?? edge) }
    case 'chart': case 'series': return payload.series
    case 'diff': return { before: payload.before, after: payload.after }
    case 'metrics': return payload.metrics
    case 'searchHits': return payload.hits.map(hit => hit.source)
    case 'profile': return payload.stages
    case 'costEstimate': return payload.details ?? { currency: payload.currency, estimatedBytes: payload.estimatedBytes, estimatedCredits: payload.estimatedCredits, estimatedCost: payload.estimatedCost }
  }
}
