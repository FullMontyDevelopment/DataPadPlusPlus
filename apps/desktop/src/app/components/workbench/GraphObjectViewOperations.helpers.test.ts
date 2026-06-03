import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  graphOperationActions,
  graphOperationObjectName,
} from './GraphObjectViewOperations.helpers'

describe('graphOperationActions', () => {
  it('offers profile, metrics, index, and guarded drop previews for Neo4j labels and indexes', () => {
    const tab = objectViewTab('node-label', 'Account', {
      queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
    })

    const actions = graphOperationActions(
      connection('neo4j'),
      tab,
      'node-label',
      { label: 'Account', propertyName: 'email' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Create Index', 'Export'])
    expect(actions[0]).toMatchObject({
      operationId: 'neo4j.query.profile',
      objectName: 'Account',
      parameters: expect.objectContaining({
        label: 'Account',
        query: 'MATCH (n:`Account`) RETURN n LIMIT 25',
      }),
    })
    expect(actions.find((action) => action.label === 'Export')).toMatchObject({
      operationId: 'neo4j.data.import-export',
      objectName: 'Account',
      parameters: expect.objectContaining({
        format: 'graph-json',
      }),
    })

    const indexTab = objectViewTab('index', 'account_email_lookup')
    const indexActions = graphOperationActions(
      connection('neo4j'),
      indexTab,
      'index',
      { name: 'account_email_lookup', target: 'Account', properties: 'email' },
    )
    expect(indexActions.map((action) => action.label)).toEqual(['Metrics', 'Create Index', 'Drop Index'])
  })

  it('offers Neptune profile, metrics, access, and export previews without index actions', () => {
    const tab = objectViewTab('graph', 'analytics', {
      queryTemplate: 'g.V().limit(25)',
    })

    const actions = graphOperationActions(
      connection('neptune'),
      tab,
      'graph',
      { graphName: 'analytics' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Export'])
    expect(actions.find((action) => action.operationId === 'neptune.data.import-export')).toMatchObject({
      objectName: 'analytics',
      parameters: expect.objectContaining({
        format: 'neptune-bulk',
      }),
    })

    const securityActions = graphOperationActions(connection('neptune'), objectViewTab('security', 'Security'), 'security', {})
    expect(securityActions.map((action) => action.label)).toEqual(['Access'])
  })

  it('uses graph-specific target names for relationships and properties', () => {
    const relationshipTab = objectViewTab('relationship', 'PLACED')

    expect(graphOperationObjectName(connection('janusgraph'), relationshipTab, { type: 'PLACED' })).toBe('PLACED')
    expect(graphOperationObjectName(connection('arango'), objectViewTab('property-key', 'sku'), { name: 'sku' })).toBe('sku')
  })
})

function connection(engine: 'neo4j' | 'neptune' | 'arango' | 'janusgraph'): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family: 'graph',
    host: 'localhost',
    port: undefined,
    database: engine === 'neo4j' ? 'neo4j' : 'analytics',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function objectViewTab(kind: string, label: string, overrides: Record<string, unknown> = {}): QueryTabState {
  return {
    id: `tab-${kind}`,
    tabKind: 'object-view',
    connectionId: 'conn',
    environmentId: 'env-local',
    title: label,
    family: 'graph',
    language: 'cypher',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: 'conn',
      environmentId: 'env-local',
      nodeId: `${kind}:${label}`,
      label,
      kind,
      path: ['Graph'],
      warnings: [],
      payload: {},
      ...overrides,
    },
  } as unknown as QueryTabState
}
