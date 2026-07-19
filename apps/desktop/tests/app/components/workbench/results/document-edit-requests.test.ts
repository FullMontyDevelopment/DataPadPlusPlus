import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildDocumentDeleteRequest,
  buildDocumentEditRequest,
} from '../../../../../src/app/components/workbench/results/document-edit-requests'
import type { DocumentGridRow } from '../../../../../src/app/components/workbench/results/document-grid-model'

describe('document-edit-requests', () => {
  it('builds guarded Mongo document delete requests for root document rows', () => {
    expect(
      buildDocumentDeleteRequest(
        mongoConnection(),
        {
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "database": "catalog", "collection": "products", "filter": {} }',
        },
        [{ _id: 'product-1', status: 'active' }],
        rootRow(),
      ),
    ).toEqual({
      connectionId: 'conn-mongo',
      environmentId: 'env-dev',
      editKind: 'delete-document',
      confirmationText: 'CONFIRM MONGODB DELETE-DOCUMENT',
      target: {
        objectKind: 'document',
        path: [],
        database: 'catalog',
        collection: 'products',
        documentId: 'product-1',
      },
      changes: [],
    })
  })

  it('does not build document deletes for child fields or documents without stable identity', () => {
    expect(
      buildDocumentDeleteRequest(
        mongoConnection(),
        {
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products" }',
        },
        [{ _id: 'product-1', status: 'active' }],
        { ...rootRow(), path: ['status'], fieldPath: 'status' },
      ),
    ).toBeUndefined()

    expect(
      buildDocumentDeleteRequest(
        mongoConnection(),
        {
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products" }',
        },
        [{ status: 'active' }],
        rootRow(),
      ),
    ).toBeUndefined()
  })

  it.each([
    ['ObjectId', { $oid: '507f1f77bcf86cd799439011' }],
    ['UUID', { $uuid: '9e107d9d-372b-4f7d-bb3a-17d63746f9a0' }],
  ])('preserves raw MongoDB %s identity and resolved target context', (_label, documentId) => {
    const documents = [{ _id: documentId, status: 'active' }]

    expect(
      buildDocumentDeleteRequest(
        mongoConnection(),
        {
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          database: 'resolved-database',
          collection: 'resolved-collection',
          queryText: '{ "database": "stale", "collection": "stale", "filter": {} }',
        },
        documents,
        { ...rootRow(), value: documents[0] },
      ),
    ).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({
          database: 'resolved-database',
          collection: 'resolved-collection',
          documentId,
        }),
      }),
    )
  })

  it('keeps field edit requests unguarded by UI confirmation text', () => {
    expect(
      buildDocumentEditRequest(
        mongoConnection(),
        {
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products" }',
        },
        [{ _id: 'product-1', status: 'active' }],
        { ...rootRow(), path: ['status'], fieldPath: 'status' },
        'unset-field',
        [{ path: ['status'] }],
      ),
    ).toEqual({
      connectionId: 'conn-mongo',
      environmentId: 'env-dev',
      editKind: 'unset-field',
      target: {
        objectKind: 'document',
        path: ['status'],
        collection: 'products',
        documentId: 'product-1',
      },
      changes: [{ path: ['status'] }],
    })
  })
})

function rootRow(): DocumentGridRow {
  return {
    id: 'document-0',
    depth: 0,
    label: 'product-1',
    fieldPath: '_id',
    type: 'object',
    value: { _id: 'product-1', status: 'active' },
    valueLabel: '{2 field(s)}',
    expandable: true,
    lazy: false,
    documentIndex: 0,
    parentPath: [],
    path: [],
  }
}

function mongoConnection(): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'Mongo',
    engine: 'mongodb',
    family: 'document',
    host: '127.0.0.1',
    port: 27017,
    database: 'catalog',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
