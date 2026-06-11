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
} from '../../../../../../../src/app/components/workbench/datastores/common/sql/RelationalObjectViewWorkspace.helpers'

describe('RelationalObjectViewWorkspace helpers', () => {
  it('builds native workflow chips for scoped table views', () => {
    const connection = connectionFor('sqlserver')
    const descriptor = descriptorForConnection(connection, 'table')

    expect(relationalWorkflows(connection, 'table', descriptor, true).map((workflow) => workflow.label)).toEqual([
      'Data',
      'Columns',
      'Indexes',
      'Constraints',
      'Triggers',
      'Grants',
    ])
  })

  it('keeps workflow chips aligned to sections that are present in the payload', () => {
    const connection = connectionFor('sqlserver')
    const descriptor = descriptorForConnection(connection, 'table')
    const workflows = relationalWorkflows(
      connection,
      'table',
      descriptor,
      true,
      new Set(['columns', 'indexes', 'permissions']),
    )

    expect(workflows.map((workflow) => workflow.label)).toEqual(['Data', 'Columns', 'Indexes', 'Grants'])
    expect(workflows.find((workflow) => workflow.label === 'Indexes')).toMatchObject({
      targetSection: 'indexes',
    })
  })

  it('renders MySQL performance_schema diagnostics as focused sections and workflows', () => {
    const connection = connectionFor('mysql')
    const descriptor = descriptorForConnection(connection, 'performance-schema')
    const sections = relationalSections('performance-schema', {
      statementDigests: [{ digest: 'SELECT * FROM orders', count: 42, avgMs: 9.7, rowsExamined: 4200 }],
      tableIo: [{ schema: 'shop', table: 'orders', index: 'orders_account_id_idx', operations: 420, totalMs: 61.4 }],
      metadataLocks: [{ schema: 'shop', object: 'orders', lockType: 'SHARED_READ', status: 'GRANTED', sessionId: 11 }],
      optimizerTrace: [{ name: 'optimizer_trace', enabled: 'enabled=off,one_line=off', traceLimit: 1 }],
    }, descriptor)
    const workflows = relationalWorkflows(
      connection,
      'performance-schema',
      descriptor,
      false,
      new Set(sections.map((section) => section.key)),
    )

    expect(sections.map((section) => section.key)).toEqual([
      'statementDigests',
      'tableIo',
      'metadataLocks',
      'optimizerTrace',
    ])
    expect(sections.find((section) => section.key === 'statementDigests')?.columns).toEqual([
      'digest',
      'count',
      'avgMs',
      'rowsExamined',
    ])
    expect(workflows.map((workflow) => workflow.label)).toEqual([
      'Digests',
      'I/O',
      'Locks',
      'Optimizer',
    ])
  })

  it('renders MariaDB role mappings, server variables, and analyze profile as focused sections', () => {
    const connection = connectionFor('mariadb')
    const securityDescriptor = descriptorForConnection(connection, 'security')
    const securitySections = relationalSections('security', {
      roles: [{ name: 'reporting_read', host: '%', isRole: 'Y' }],
      roleMappings: [{ name: 'reporting', host: '%', member: 'reporting_read', adminOption: 'N' }],
      permissions: [{ principal: 'reporting@%', privilege: 'SELECT', object: 'shop' }],
    }, securityDescriptor)
    const diagnosticsDescriptor = descriptorForConnection(connection, 'diagnostics')
    const diagnosticsSections = relationalSections('diagnostics', {
      serverVariables: [{ name: 'sql_mode', value: 'STRICT_TRANS_TABLES', status: 'info' }],
      analyzeProfile: [{ name: 'ANALYZE FORMAT=JSON', status: 'preview', queryTemplate: 'analyze format=json select 1;' }],
      engines: [{ name: 'Aria', support: 'YES', transactions: 'NO' }],
    }, diagnosticsDescriptor)

    expect(securityDescriptor.title).toBe('MariaDB Users / Privileges')
    expect(securitySections.map((section) => section.key)).toEqual(['roles', 'roleMappings', 'permissions'])
    expect(securitySections.find((section) => section.key === 'roleMappings')?.columns).toEqual([
      'name',
      'host',
      'member',
      'adminOption',
    ])
    expect(diagnosticsSections.map((section) => section.key)).toEqual(['serverVariables', 'analyzeProfile', 'engines'])
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
    expect(sections[0]?.key).toBe('tables')
    expect(sections[0]?.title).toBe('Tables')
    expect(sections[0]?.columns).toEqual(['schema', 'name', 'rows', 'owner', 'extraSignal'])
    expect(sections[0]?.rows).toEqual([['dbo', 'Accounts', '20', 'app', 'kept']])
  })

  it('normalizes PostgreSQL extension and security sections with native columns', () => {
    const sections = relationalSections('security', {
      roles: [{ name: 'app', createRole: false, createDb: false, memberCount: 1 }],
      roleMemberships: [{ role: 'app', memberOf: 'reporting', adminOption: false, grantor: 'postgres' }],
      permissions: [{ principal: 'reporting', privilege: 'SELECT', object: 'public.accounts', objectKind: 'relation', grantable: false }],
      defaultPrivileges: [{ schema: 'public', owner: 'app', objectKind: 'tables', principal: 'reporting', privilege: 'SELECT' }],
    }, descriptorForConnection(connectionFor('postgresql'), 'security'))

    expect(sections.map((section) => section.key)).toEqual([
      'roles',
      'roleMemberships',
      'permissions',
      'defaultPrivileges',
    ])
    expect(sections.find((section) => section.key === 'permissions')?.columns).toEqual([
      'principal',
      'privilege',
      'object',
      'objectKind',
      'grantable',
    ])

    const extensionSections = relationalSections('extension', {
      extensions: [{ name: 'uuid-ossp', version: '1.1', defaultVersion: '1.2', updateAvailable: true }],
      extensionObjects: [{ extension: 'uuid-ossp', catalog: 'pg_proc', object: 'function uuid_generate_v4()', dependency: 'extension member' }],
    }, descriptorForConnection(connectionFor('postgresql'), 'extension'))

    expect(extensionSections.map((section) => section.key)).toEqual(['extensions', 'extensionObjects'])
  })

  it('does not duplicate storage file sections', () => {
    const sections = relationalSections('storage', {
      files: [{ name: 'datapadplusplus', type: 'ROWS', path: '/tmp/datapadplusplus.mdf', size: '32 MB' }],
    }, descriptorForConnection(connectionFor('sqlserver'), 'storage'))

    expect(sections.map((section) => section.title)).toEqual(['Files'])
    expect(sections[0]?.columns).toEqual(['name', 'type', 'size', 'path'])
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
