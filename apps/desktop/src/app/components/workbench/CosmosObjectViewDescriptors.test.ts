import { describe, expect, it } from 'vitest'
import {
  COSMOS_OBJECT_VIEW_KINDS,
  cosmosObjectViewMenuLabel,
  getCosmosObjectViewDescriptor,
  isCosmosObjectViewKind,
} from './CosmosObjectViewDescriptors'

describe('CosmosObjectViewDescriptors', () => {
  it('covers native Cosmos DB account, database, container, and admin surfaces', () => {
    expect(COSMOS_OBJECT_VIEW_KINDS).toEqual(
      expect.arrayContaining([
        'account',
        'databases',
        'database',
        'containers',
        'container',
        'items',
        'partition-key',
        'indexing-policy',
        'throughput',
        'change-feed',
        'stored-procedures',
        'triggers',
        'udfs',
        'conflicts',
        'regions',
        'consistency',
        'security',
        'diagnostics',
      ]),
    )
  })

  it('uses workflow-specific labels instead of generic open-view wording', () => {
    expect(cosmosObjectViewMenuLabel('container')).toBe('Open Container')
    expect(cosmosObjectViewMenuLabel('indexing policy')).toBe('Review Indexing Policy')
    expect(cosmosObjectViewMenuLabel('stored-procedures')).toBe('Manage Stored Procedures')
    expect(cosmosObjectViewMenuLabel('container')).not.toBe('Open View')
  })

  it('identifies implemented kinds and falls back safely for unknown nodes', () => {
    expect(isCosmosObjectViewKind('partition key')).toBe(true)
    expect(isCosmosObjectViewKind('throughput')).toBe(true)
    expect(isCosmosObjectViewKind('role')).toBe(false)
    expect(getCosmosObjectViewDescriptor('unknown')).toMatchObject({
      menuLabel: 'Inspect Cosmos DB Object',
      title: 'Cosmos DB Object',
    })
  })
})
