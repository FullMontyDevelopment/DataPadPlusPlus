export function mongoExplainPreview() {
  return {
    queryPlanner: {
      namespace: 'catalog.products',
      parsedQuery: { sku: { $eq: 'luna-lamp' } },
      winningPlan: {
        stage: 'FETCH',
        filter: { 'inventory.available': { $gt: 0 } },
        inputStage: {
          stage: 'IXSCAN',
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
          isMultiKey: false,
        },
      },
      rejectedPlans: [
        {
          stage: 'FETCH',
          inputStage: {
            stage: 'IXSCAN',
            indexName: 'inventory_available_1',
            direction: 'forward',
            keyPattern: { 'inventory.available': 1 },
          },
        },
      ],
    },
    executionStats: {
      executionSuccess: true,
      nReturned: 1,
      executionTimeMillis: 3,
      totalKeysExamined: 1,
      totalDocsExamined: 1,
      executionStages: {
        stage: 'FETCH',
        nReturned: 1,
        works: 2,
        advanced: 1,
        docsExamined: 1,
        inputStage: {
          stage: 'IXSCAN',
          nReturned: 1,
          works: 2,
          advanced: 1,
          keysExamined: 1,
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
        },
      },
    },
    serverInfo: {
      host: 'browser-preview',
      version: '7.0.0-preview',
    },
    ok: 1,
  }
}
