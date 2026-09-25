import { describe, expect, it } from 'vitest'
import {
  containsUnavailableValue,
  rawDocumentValidationErrors,
  validateDocumentFieldName,
} from '../../../../../src/app/components/workbench/results/document-edit-validation'

describe('document edit validation', () => {
  it.each(['mongodb', 'litedb'] as const)('does not measure %s BSON as JSON text', (adapterStrategy) => {
    const document = { _id: 1, escaped: '\u0001'.repeat(3 * 1024 * 1024) }
    expect(new TextEncoder().encode(JSON.stringify(document)).length).toBeGreaterThan(16 * 1024 * 1024)
    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 1 }, nextDocument: document, protectedPaths: [['_id']],
      metadata: { adapterStrategy, protectedPaths: [['_id']], maxDocumentBytes: 16 * 1024 * 1024 },
    })).toEqual([])
  })

  it('still checks JSON datastore limits using UTF-8 bytes, not character count', () => {
    const document = { id: 'one', content: 'Ω'.repeat(1024 * 1024) }
    expect(rawDocumentValidationErrors({
      beforeDocument: { id: 'one' }, nextDocument: document, protectedPaths: [['id']],
      metadata: { adapterStrategy: 'cosmosdb', protectedPaths: [['id']], maxDocumentBytes: 2 * 1024 * 1024 },
    })).toEqual([expect.stringContaining('configured limit')])
  })

  it.each(['mongodb', 'litedb'] as const)('validates large %s binary values without a regex stack overflow', (adapterStrategy) => {
    const base64 = 'AAAA'.repeat(512 * 1024)
    const document = { _id: 1, data: { $binary: adapterStrategy === 'mongodb' ? { base64, subType: '00' } : base64 } }
    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 1 }, nextDocument: document, protectedPaths: [['_id']],
      metadata: { adapterStrategy, protectedPaths: [['_id']], maxDocumentBytes: 16 * 1024 * 1024 },
    })).toEqual([])
  })

  it.each(['', 'profile.name', '$internal', '__proto__'])(
    'rejects unsafe field name %j',
    (fieldName) => {
      expect(validateDocumentFieldName({
        fieldName,
        parent: {},
        parentPath: [],
        protectedPaths: [['_id']],
      })).toBeTruthy()
    },
  )

  it('rejects duplicate and protected fields', () => {
    expect(validateDocumentFieldName({
      fieldName: 'name',
      parent: { name: 'Ada' },
      parentPath: [],
      protectedPaths: [['_id']],
    })).toContain('already exists')
    expect(validateDocumentFieldName({
      fieldName: '_id',
      parent: {},
      parentPath: [],
      protectedPaths: [['_id']],
    })).toContain('protected')
  })

  it('blocks protected raw JSON changes and unloaded placeholders', () => {
    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 'one', name: 'Ada' },
      nextDocument: { _id: 'two', name: 'Ada' },
      protectedPaths: [['_id']],
    })).toContain('Protected field _id cannot be changed.')

    const lazy = {
      __datapadLazyNode: true,
      type: 'object',
      childCount: 1,
      path: ['profile'],
      loaded: false,
    }
    expect(containsUnavailableValue({ profile: lazy })).toBe(true)
  })

  it('validates MongoDB and LiteDB native Extended JSON shapes', () => {
    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 'one' },
      nextDocument: { _id: 'one', owner: { $oid: 'bad' } },
      protectedPaths: [['_id']],
      metadata: { adapterStrategy: 'mongodb', protectedPaths: [['_id']] },
    })[0]).toContain('$oid')

    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 1 },
      nextDocument: { _id: 1, owner: { $guid: '00112233-4455-4677-8899-aabbccddeeff' } },
      protectedPaths: [['_id']],
      metadata: { adapterStrategy: 'litedb', protectedPaths: [['_id']] },
    })).toEqual([])

    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 'one' },
      nextDocument: { _id: 'one', createdAt: { $date: '2026-08-08' } },
      protectedPaths: [['_id']],
      metadata: { adapterStrategy: 'mongodb', protectedPaths: [['_id']] },
    })[0]).toContain('timezone-bearing')

    expect(rawDocumentValidationErrors({
      beforeDocument: { _id: 'one' },
      nextDocument: { _id: 'one', stamp: { $timestamp: { t: '1', i: 2 } } },
      protectedPaths: [['_id']],
      metadata: { adapterStrategy: 'mongodb', protectedPaths: [['_id']] },
    })[0]).toContain('$timestamp')
  })
})
