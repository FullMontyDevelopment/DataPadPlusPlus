import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildSearchDocumentEditRequest,
  buildSearchDocumentIndexRequest,
  searchHitId,
  searchHitIndex,
  searchHitSource,
} from '../../../../../src/app/components/workbench/results/search-hit-edit-requests'

const connection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Search',
  engine: 'opensearch',
  family: 'search',
  host: '127.0.0.1',
  port: 9200,
  database: '',
  environmentIds: ['env-dev'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'opensearch',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const editContext = {
  connectionId: 'conn-search',
  environmentId: 'env-dev',
  queryText: '{ "index": "orders", "body": { "query": { "match_all": {} } } }',
}

describe('search hit edit requests', () => {
  it('normalizes raw and typed search hit shapes', () => {
    const rawHit = {
      _index: 'orders-2026',
      _id: '101',
      _source: { status: 'processing' },
      source: {},
    }

    expect(searchHitId(rawHit)).toBe('101')
    expect(searchHitIndex(rawHit, editContext)).toBe('orders-2026')
    expect(searchHitSource(rawHit)).toEqual({})
  })

  it('builds top-level partial document update requests', () => {
    expect(
      buildSearchDocumentEditRequest({
        connection,
        editContext,
        editKind: 'update-document',
        hit: { id: '101', source: { status: 'processing' } },
        source: { status: 'fulfilled', total: 42 },
      }),
    ).toEqual({
      connectionId: 'conn-search',
      environmentId: 'env-dev',
      editKind: 'update-document',
      confirmationText: undefined,
      target: {
        objectKind: 'document',
        path: [],
        table: 'orders',
        documentId: '101',
      },
      changes: [
        {
          field: 'status',
          value: 'fulfilled',
          valueType: 'string',
        },
        {
          field: 'total',
          value: 42,
          valueType: 'number',
        },
      ],
    })
  })

  it('requires confirmation for destructive document deletes', () => {
    expect(
      buildSearchDocumentEditRequest({
        connection,
        editContext,
        editKind: 'delete-document',
        hit: { id: '101', source: { status: 'processing' } },
      }),
    ).toMatchObject({
      editKind: 'delete-document',
      confirmationText: 'CONFIRM OPENSEARCH DELETE-DOCUMENT',
      changes: [],
    })
  })

  it('builds full document index requests from an index-scoped search query', () => {
    expect(
      buildSearchDocumentIndexRequest({
        connection,
        editContext,
        documentId: '102',
        source: { status: 'queued', total: 99 },
      }),
    ).toEqual({
      connectionId: 'conn-search',
      environmentId: 'env-dev',
      editKind: 'index-document',
      target: {
        objectKind: 'document',
        path: [],
        table: 'orders',
        documentId: '102',
      },
      changes: [
        {
          field: 'status',
          value: 'queued',
          valueType: 'string',
        },
        {
          field: 'total',
          value: 99,
          valueType: 'number',
        },
      ],
    })
  })

  it('blocks indexing without a document id or index target', () => {
    expect(
      buildSearchDocumentIndexRequest({
        connection,
        editContext: { ...editContext, queryText: '{ "body": {} }' },
        documentId: '102',
        source: { status: 'queued' },
      }),
    ).toBeUndefined()
    expect(
      buildSearchDocumentIndexRequest({
        connection,
        editContext,
        documentId: ' ',
        source: { status: 'queued' },
      }),
    ).toBeUndefined()
  })
})
