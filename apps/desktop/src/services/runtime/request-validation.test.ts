import { describe, expect, it } from 'vitest'
import {
  validateCreateLibraryFolderRequest,
  validateCreateObjectViewTabRequest,
  validateConnectionProfile,
  validateConnectionTestRequest,
  validateDataEditPlanRequest,
  validateEnvironmentProfile,
  validateExecutionRequest,
  validateExplorerRequest,
  validateOperationExecutionRequest,
  validateOperationPlanRequest,
  validateRedisKeyScanRequest,
  validateResultPageRequest,
  validateSaveQueryTabToLibraryRequest,
  validateSaveQueryTabToLocalFileRequest,
  validateSetLibraryNodeEnvironmentRequest,
  validateUpdateQueryBuilderStateRequest,
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

  it('normalizes and validates library mutation requests', () => {
    expect(
      validateCreateLibraryFolderRequest({
        name: '  Queries  ',
        parentId: '',
        environmentId: ' env-qa ',
      }),
    ).toMatchObject({
      name: 'Queries',
      parentId: undefined,
      environmentId: 'env-qa',
    })

    expect(
      validateSetLibraryNodeEnvironmentRequest({
        nodeId: 'node-1',
        environmentId: ' ',
      }),
    ).toMatchObject({ environmentId: undefined })

    expect(
      validateSaveQueryTabToLibraryRequest({
        tabId: 'tab-1',
        name: '  Report  ',
        kind: 'query',
        tags: ['  sql  ', ''],
      }),
    ).toMatchObject({
      name: 'Report',
      kind: 'query',
      tags: ['sql'],
    })

    expect(() =>
      validateSaveQueryTabToLibraryRequest({
        tabId: 'tab-1',
        name: 'Report',
        kind: 'folder' as never,
        tags: [],
      }),
    ).toThrow(/Unsupported Library item kind/)
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

  it('rejects plaintext connection-string secrets and normalizes profile tags', () => {
    expect(
      validateConnectionProfile({
        id: 'conn-1',
        name: '  Reporting  ',
        engine: 'postgresql',
        family: 'sql',
        host: 'localhost',
        environmentIds: [' env-qa '],
        tags: ['  finance  ', ''],
        favorite: false,
        readOnly: false,
        icon: 'database',
        auth: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      name: 'Reporting',
      environmentIds: ['env-qa'],
      tags: ['finance'],
    })

    expect(() =>
      validateConnectionProfile({
        id: 'conn-1',
        name: 'Reporting',
        engine: 'postgresql',
        family: 'sql',
        host: 'localhost',
        connectionString: 'postgres://user:secret@localhost/catalog',
        environmentIds: ['env-qa'],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'database',
        auth: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/embedded passwords/)
  })

  it('normalizes nullable connection profile fields without raw runtime crashes', () => {
    const profile = validateConnectionProfile({
      id: 'conn-1',
      name: '  Reporting  ',
      engine: 'postgresql',
      family: 'sql',
      host: null,
      port: null,
      database: null,
      connectionMode: null,
      environmentIds: null,
      tags: null,
      favorite: false,
      readOnly: false,
      icon: null,
      auth: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never)

    expect(profile).toMatchObject({
      name: 'Reporting',
      host: '',
      database: undefined,
      environmentIds: [],
      tags: [],
      icon: 'database',
      auth: {},
    })

    expect(() =>
      validateConnectionTestRequest({
        environmentId: 'env-qa',
        profile: {
          ...profile,
          tags: 'oops',
        } as never,
      }),
    ).toThrow(/Profile tags must be an array/)

    expect(
      validateConnectionTestRequest({
        environmentId: 'env-qa',
        profile,
        secret: null,
      } as never).secret,
    ).toBeUndefined()
  })

  it('rejects plaintext secret environment variables and duplicate names', () => {
    expect(() =>
      validateEnvironmentProfile({
        id: 'env-qa',
        label: 'QA',
        color: '#8ab4f8',
        risk: 'medium',
        variables: {},
        sensitiveKeys: [],
        variableDefinitions: [
          {
            key: 'API_TOKEN',
            kind: 'secret',
            value: 'plain-secret',
          },
        ],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/cannot store plaintext/)

    expect(() =>
      validateEnvironmentProfile({
        id: 'env-qa',
        label: 'QA',
        color: '#8ab4f8',
        risk: 'medium',
        variables: {},
        sensitiveKeys: [],
        variableDefinitions: [
          { key: 'db_host', kind: 'text', value: 'localhost' },
          { key: 'DB_HOST', kind: 'text', value: '127.0.0.1' },
        ],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/duplicated/)
  })

  it('validates query builder state size and unsupported view modes', () => {
    expect(() =>
      validateUpdateQueryBuilderStateRequest({
        tabId: 'tab-1',
        builderState: { payload: 'x'.repeat(70 * 1024) } as never,
      }),
    ).toThrow(/too large/)

    expect(() =>
      validateUpdateQueryBuilderStateRequest({
        tabId: 'tab-1',
        builderState: { kind: 'mongo-find' } as never,
        queryViewMode: 'both' as never,
      }),
    ).toThrow(/Unsupported query view mode/)
  })
})
