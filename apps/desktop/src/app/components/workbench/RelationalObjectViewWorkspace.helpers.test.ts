import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  descriptorForConnection,
  displayCellValue,
  labelForColumn,
  metricCardsForPayload,
  normalizeKind,
  objectViewWarnings,
  relationalQueryTargetFromObjectView,
  relationalSections,
  relationalWorkflows,
} from './RelationalObjectViewWorkspace.helpers'

describe('RelationalObjectViewWorkspace helpers', () => {
  it('builds native workflow chips for scoped table views', () => {
    const connection = connectionFor('sqlserver')
    const descriptor = descriptorForConnection(connection, 'table')

    expect(relationalWorkflows(connection, 'table', descriptor, true).map((workflow) => workflow.label)).toEqual([
      'Data',
      'Columns',
      'Indexes',
      'Grants',
    ])
  })

  it('normalizes sections using preferred SQL-family columns', () => {
    const sections = relationalSections('database', {
      tables: [{
        schema: 'dbo',
        name: 'Accounts',
        rows: 20,
        owner: 'app',
        extraSignal: 'kept',
      }],
    }, descriptorForConnection(connectionFor('sqlserver'), 'database'))

    expect(sections).toHaveLength(1)
    expect(sections[0]?.title).toBe('Tables')
    expect(sections[0]?.columns).toEqual(['schema', 'name', 'rows', 'owner', 'extraSignal'])
    expect(sections[0]?.rows).toEqual([['dbo', 'Accounts', '20', 'app', 'kept']])
  })

  it('summarizes SQL text instead of dumping raw command text', () => {
    expect(displayCellValue('definition', 'select * from accounts where id = 1')).toBe('SELECT statement (35 chars)')
    expect(labelForColumn('defaultSchema')).toBe('Default Schema')
  })

  it('derives metrics, warnings, normalized kinds, and query targets', () => {
    const tab = {
      id: 'tab-sql-table',
      title: 'Accounts',
      tabKind: 'object-view',
      connectionId: 'conn-sql',
      error: { message: 'Runtime warning' },
      objectViewState: {
        connectionId: 'conn-sql',
        nodeId: 'sqlserver-table:dbo:Accounts',
        kind: 'table',
        label: 'Accounts',
        path: ['datapadplusplus', 'dbo', 'Tables', 'Accounts'],
        queryTemplate: 'select * from [dbo].[Accounts]',
        warnings: ['Metadata warning'],
      },
    } as QueryTabState

    expect(relationalQueryTargetFromObjectView(tab)).toMatchObject({
      kind: 'table',
      label: 'Accounts',
      queryTemplate: 'select * from [dbo].[Accounts]',
    })
    expect(metricCardsForPayload('table', { rowCount: 10 }, connectionFor('postgresql'))).toContainEqual({
      label: 'Rows',
      value: '10',
    })
    expect(objectViewWarnings(tab, { warnings: ['Payload warning'] })).toEqual([
      'Metadata warning',
      'Runtime warning',
      'Payload warning',
    ])
    expect(normalizeKind('Query Store')).toBe('query-store')
  })
})

function connectionFor(engine: ConnectionProfile['engine']): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family: 'sql',
    host: 'localhost',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
