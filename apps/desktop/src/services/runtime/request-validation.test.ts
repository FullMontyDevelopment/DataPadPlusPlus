import { describe, expect, it } from 'vitest'
import {
  validateCreateObjectViewTabRequest,
  validateDataEditPlanRequest,
  validateExecutionRequest,
  validateExplorerRequest,
  validateOperationExecutionRequest,
  validateOperationPlanRequest,
  validateRedisKeyScanRequest,
  validateResultPageRequest,
  validateSaveQueryTabToLocalFileRequest,
} from './request-validation'

describe('runtime request validation', () => {
  it('clamps metadata and Redis scan limits before command execution', () => {
    expect(
      validateExplorerRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        limit: 999_999,
      }).limit,
    ).toBe(500)
    expect(
      validateRedisKeyScanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        databaseIndex: 999_999,
        count: 999_999,
        pageSize: 999_999,
      }),
    ).toMatchObject({
      databaseIndex: 1024,
      count: 1000,
      pageSize: 1000,
    })
  })

  it('rejects invalid IDs, operation IDs, and control characters', () => {
    expect(() =>
      validateExplorerRequest({
        connectionId: '',
        environmentId: 'env-1',
      }),
    ).toThrow(/Connection id is required/)
    expect(() =>
      validateOperationPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: '../drop',
      }),
    ).toThrow(/Operation id contains unsupported characters/)
    expect(() =>
      validateRedisKeyScanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        pattern: 'orders\u0000*',
      }),
    ).toThrow(/control characters/)
  })

  it('validates object-view requests without allowing arbitrary node identifiers', () => {
    expect(
      validateCreateObjectViewTabRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        nodeId: 'mongodb:catalog:users',
        label: 'Users',
        kind: 'mongo-users',
        path: ['catalog', 'Users'],
      }),
    ).toMatchObject({
      nodeId: 'mongodb:catalog:users',
      kind: 'mongo-users',
    })
    expect(() =>
      validateCreateObjectViewTabRequest({
        connectionId: 'conn-1',
        nodeId: '../catalog',
        label: 'Users',
        kind: 'mongo-users',
      }),
    ).toThrow(/Object view node id contains unsupported characters/)
  })

  it('rejects oversized command payloads and too many edit changes', () => {
    expect(() =>
      validateOperationPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: 'mongodb.index.create',
        parameters: { payload: 'x'.repeat(70 * 1024) },
      }),
    ).toThrow(/too large/)
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'set-field',
        target: {
          objectKind: 'document',
          path: ['catalog', 'users'],
          collection: 'users',
          documentId: 'user-1',
        },
        changes: Array.from({ length: 101 }, (_, index) => ({
          field: `field_${index}`,
          value: index,
        })),
      }),
    ).toThrow(/at most 100 changes/)
  })

  it('rejects unknown edit kinds and path segments that are too deep or empty', () => {
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'drop-everything' as never,
        target: { objectKind: 'document', path: [] },
        changes: [],
      }),
    ).toThrow(/Unsupported data edit kind/)
    expect(() =>
      validateDataEditPlanRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        editKind: 'set-field',
        target: {
          objectKind: 'document',
          path: [''],
          collection: 'users',
          documentId: 'user-1',
        },
        changes: [{ field: 'name', value: 'Ada' }],
      }),
    ).toThrow(/path segment is required/)
  })

  it('clamps operation row limits and validates local save paths', () => {
    expect(
      validateOperationExecutionRequest({
        connectionId: 'conn-1',
        environmentId: 'env-1',
        operationId: 'mongodb.diagnostics.metrics',
        rowLimit: 999_999,
      }).rowLimit,
    ).toBe(10_000)
    expect(
      validateSaveQueryTabToLocalFileRequest({
        tabId: 'tab-1',
        path: 'C:\\temp\\orders.sql',
      }),
    ).toMatchObject({ path: 'C:\\temp\\orders.sql' })
    expect(() =>
      validateSaveQueryTabToLocalFileRequest({
        tabId: 'tab-1',
        path: '..\\orders.sql',
      }),
    ).toThrow(/absolute file path/)
  })

  it('clamps execution and result paging limits while rejecting null-byte text', () => {
    expect(
      validateExecutionRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        rowLimit: 999_999,
      }).rowLimit,
    ).toBe(10_000)
    expect(
      validateResultPageRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        renderer: 'table',
        pageSize: 999_999,
        pageIndex: 999_999,
      }),
    ).toMatchObject({
      pageSize: 1000,
      pageIndex: 100000,
    })
    expect(() =>
      validateResultPageRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select 1',
        renderer: 'iframe',
      }),
    ).toThrow(/Unsupported result renderer/)
    expect(() =>
      validateExecutionRequest({
        tabId: 'tab-1',
        connectionId: 'conn-1',
        environmentId: 'env-1',
        language: 'sql',
        queryText: 'select\u0000 1',
      }),
    ).toThrow(/null bytes/)
  })
})
