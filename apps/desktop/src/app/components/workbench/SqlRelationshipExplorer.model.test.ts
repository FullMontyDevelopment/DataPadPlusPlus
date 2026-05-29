import type { ConnectionProfile, DatastoreEngine, StructureResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildForeignKeyPreviewSql,
  buildJoinSql,
  buildSelectSql,
  buildSqlRelationshipModel,
  isSqlStyleConnection,
} from './SqlRelationshipExplorer.model'

describe('SqlRelationshipExplorer model', () => {
  it('treats SQL and SQL-like engines as relationship explorer targets', () => {
    expect(isSqlStyleConnection(connection('postgresql', 'sql'))).toBe(true)
    expect(isSqlStyleConnection(connection('duckdb', 'embedded-olap'))).toBe(true)
    expect(isSqlStyleConnection(connection('bigquery', 'warehouse'))).toBe(true)
    expect(isSqlStyleConnection(connection('mongodb', 'document'))).toBe(false)
  })

  it('keeps declared foreign keys and only adds inferred links when requested', () => {
    const withoutInferred = buildSqlRelationshipModel(structure(), false)
    const withInferred = buildSqlRelationshipModel(structure(), true)

    expect(withoutInferred.edges).toHaveLength(1)
    expect(withInferred.edges).toHaveLength(2)
    expect(withInferred.edges.some((edge) => edge.inferred && edge.fromField === 'account_id')).toBe(true)
  })

  it('does not infer links over an existing declared relationship', () => {
    const model = buildSqlRelationshipModel(
      {
        ...structure(),
        edges: [
          ...structure().edges,
          {
            id: 'declared-account',
            from: 'public.transactions',
            to: 'public.accounts',
            label: 'account_id -> id',
            kind: 'foreign-key',
            fromField: 'account_id',
            toField: 'id',
          },
        ],
      },
      true,
    )

    expect(model.edges.filter((edge) => edge.to === 'public.accounts')).toHaveLength(1)
  })

  it('builds native SQL snippets for select, join, and guarded FK previews', () => {
    const model = buildSqlRelationshipModel(structure(), true)
    const transaction = expectNode(model, 'public.transactions')
    const edge = model.edges.find((candidate) => candidate.from === 'public.transactions')

    expect(buildSelectSql(transaction, 'sqlserver')).toContain('from [public].[transactions]')
    expect(buildJoinSql(transaction, edge, model, 'postgresql')).toContain('join "public"."accounts" as target')
    expect(buildForeignKeyPreviewSql(edge, model, 'mysql')).toContain('alter table `public`.`transactions`')
  })
})

function expectNode(model: ReturnType<typeof buildSqlRelationshipModel>, nodeId: string) {
  const node = model.nodeById.get(nodeId)
  expect(node).toBeTruthy()
  return node!
}

function structure(): StructureResponse {
  return {
    connectionId: 'connection-1',
    environmentId: 'env-1',
    engine: 'postgresql',
    summary: 'Loaded 3 tables.',
    groups: [{ id: 'public', label: 'public', kind: 'schema' }],
    nodes: [
      {
        id: 'public.accounts',
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'accounts',
        qualifiedName: 'public.accounts',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'name', dataType: 'text' },
        ],
      },
      {
        id: 'public.transactions',
        family: 'sql',
        label: 'transactions',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'transactions',
        qualifiedName: 'public.transactions',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'account_id', dataType: 'uuid' },
        ],
      },
      {
        id: 'public.transaction_notes',
        family: 'sql',
        label: 'transaction_notes',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'transaction_notes',
        qualifiedName: 'public.transaction_notes',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'transaction_id', dataType: 'uuid' },
        ],
      },
    ],
    edges: [
      {
        id: 'fk-notes-transactions',
        from: 'public.transaction_notes',
        to: 'public.transactions',
        label: 'transaction_id -> id',
        kind: 'foreign-key',
        fromField: 'transaction_id',
        toField: 'id',
      },
    ],
    metrics: [],
  }
}

function connection(
  engine: DatastoreEngine,
  family: 'sql' | 'document' | 'warehouse' | 'embedded-olap',
): ConnectionProfile {
  return {
    id: 'connection-1',
    name: 'Connection',
    engine,
    family,
    connectionMode: 'native',
    host: 'localhost',
    port: 1,
    database: 'database',
    tags: [],
    favorite: false,
    icon: engine,
    auth: { username: 'user' },
    environmentIds: ['env-1'],
    readOnly: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}
