import type { ExecutionResultEnvelope } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { projectDeferredResultPayload } from '../../../src/services/runtime/result-materialization'

describe('deferred result materialization', () => {
  it('projects JSON over the canonical MongoDB documents without copying them', () => {
    const documents = [{ _id: 'one', nested: { enabled: true } }]
    const result = mongoResult(documents)

    const payload = projectDeferredResultPayload(result, 'json')

    expect(payload).toMatchObject({ renderer: 'json' })
    if (payload?.renderer !== 'json') {
      throw new Error('Expected JSON payload')
    }
    expect(payload.value).toBe(documents)
  })

  it('materializes table and raw views only when requested', () => {
    const result = mongoResult([{ _id: 'one', name: 'Alpha' }])

    expect(projectDeferredResultPayload(result, 'table')).toEqual({
      renderer: 'table',
      columns: ['document'],
      rows: [['{"_id":"one","name":"Alpha"}']],
    })
    expect(projectDeferredResultPayload(result, 'raw')).toEqual({
      renderer: 'raw',
      text: '[\n  {\n    "_id": "one",\n    "name": "Alpha"\n  }\n]',
    })
  })

  it('preserves script console and operation metadata from a canonical batch', () => {
    const result: ExecutionResultEnvelope = {
      ...mongoResult([]),
      defaultRenderer: 'batch',
      rendererModes: ['batch', 'json', 'raw'],
      deferredRendererModes: ['json', 'raw'],
      payloads: [{
        renderer: 'batch',
        summary: 'Script complete',
        console: 'Starting scan',
        metadata: { operations: [{ method: 'countDocuments' }] },
        sections: [{
          id: 'section-1',
          label: 'countDocuments',
          status: 'success',
          defaultRenderer: 'json',
          rendererModes: ['json'],
          payloads: [{ renderer: 'json', value: 42 }],
          notices: [],
        }],
      }],
    }

    expect(projectDeferredResultPayload(result, 'json')).toEqual({
      renderer: 'json',
      value: {
        result: 42,
        operations: [{ method: 'countDocuments' }],
        console: 'Starting scan',
      },
    })
  })

  it('materializes print-only scripts from their single canonical JSON payload', () => {
    const result: ExecutionResultEnvelope = {
      ...mongoResult([]),
      defaultRenderer: 'raw',
      rendererModes: ['json', 'raw'],
      deferredRendererModes: ['raw'],
      payloads: [{
        renderer: 'json',
        value: {
          result: null,
          operations: [],
          console: 'starting\nfinished',
        },
      }],
    }

    expect(projectDeferredResultPayload(result, 'raw')).toEqual({
      renderer: 'raw',
      text: 'Console\n-------\nstarting\nfinished\n\nResult\n------\n{\n  "result": null,\n  "operations": [],\n  "console": "starting\\nfinished"\n}',
    })
  })
})

function mongoResult(
  documents: Array<Record<string, unknown>>,
): ExecutionResultEnvelope {
  return {
    id: 'result-mongodb',
    engine: 'mongodb',
    summary: `${documents.length} document(s)`,
    defaultRenderer: 'document',
    rendererModes: ['document', 'json', 'table', 'raw'],
    deferredRendererModes: ['json', 'table', 'raw'],
    payloads: [{ renderer: 'document', documents }],
    notices: [],
    executedAt: '2026-07-23T10:00:00.000Z',
    durationMs: 12,
  }
}
