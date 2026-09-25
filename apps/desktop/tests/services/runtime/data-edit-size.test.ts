import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  validateDataEditExecutionRequest,
  validateDataEditPlanRequest,
  validateDocumentNodeChildrenRequest,
} from '../../../src/services/runtime/request-validation'

describe('datastore values are not command metadata', () => {
  it.each([
    ['mongodb', 'insert-document'], ['mongodb', 'update-document'],
    ['mongodb', 'set-field'], ['mongodb', 'add-field'],
    ['litedb', 'update-document'], ['cosmosdb', 'update-document'],
    ['arango', 'update-document'], ['dynamodb', 'put-item'],
    ['elasticsearch', 'index-document'], ['opensearch', 'update-document'],
    ['redis', 'set-key-value'], ['valkey', 'set-key-value'],
    ['postgresql', 'update-row'],
  ] as const)('allows >64 KiB data and baselines for %s %s', (engine, editKind) => {
    const value = { _id: 'large', content: 'Ω'.repeat(100 * 1024) }
    const request: DataEditPlanRequest = {
      connectionId: engine, environmentId: 'test', editKind,
      target: { objectKind: 'document', path: [], collection: 'items', expectedDocument: value },
      changes: [{ value }],
    }
    expect(validateDataEditPlanRequest(request)).toBe(request)
    expect(validateDataEditExecutionRequest(request).changes[0]?.value).toBe(value)
    expect(request.target.expectedDocument).toBe(value)
  })

  it('accepts a tiny change against a multi-megabyte concurrency baseline without stripping it', () => {
    const baseline = { _id: 1, data: 'x'.repeat(12 * 1024 * 1024) }
    const request: DataEditPlanRequest = {
      connectionId: 'mongo', environmentId: 'test', editKind: 'set-field',
      target: { objectKind: 'document', path: [], expectedDocument: baseline },
      changes: [{ path: ['enabled'], value: true }],
    }
    expect(validateDataEditExecutionRequest(request).target.expectedDocument).toBe(baseline)
  })

  it('allows large document identities during full-value hydration', () => {
    const request = {
      tabId: 'tab', connectionId: 'mongo', environmentId: 'test',
      collection: 'items', documentId: 'x'.repeat(70 * 1024), path: [],
      mode: 'full-value' as const,
    }
    expect(validateDocumentNodeChildrenRequest(request)).toBe(request)
  })
})
