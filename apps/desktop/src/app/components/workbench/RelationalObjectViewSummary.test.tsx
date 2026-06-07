import { render, screen } from '@testing-library/react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { RelationalObjectViewSummary } from './RelationalObjectViewSummary'
import { relationshipRows, summaryStats } from './RelationalObjectViewSummary.helpers'

describe('RelationalObjectViewSummary', () => {
  it('renders a compact native table summary with relationships', () => {
    render(
      <RelationalObjectViewSummary
        connection={connection('sqlserver')}
        kind="table"
        payload={{
          database: 'sales',
          schema: 'dbo',
          tableName: 'orders',
          columns: [
            { name: 'id', type: 'int' },
            { name: 'account_id', type: 'int' },
          ],
          indexes: [{ name: 'ix_orders_account_id' }],
          foreignKeys: [
            {
              name: 'fk_orders_accounts',
              from: 'orders.account_id',
              to: 'accounts.id',
            },
          ],
          permissions: [{ principal: 'reporting', privilege: 'SELECT' }],
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'SQL object summary' })).toBeInTheDocument()
    expect(screen.getByText('SQL Server')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
    expect(screen.getByText('Columns')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('Object relationships')).toHaveTextContent('fk_orders_accounts')
  })

  it('summarizes security and diagnostic surfaces without requiring table metadata', () => {
    expect(summaryStats('security', {
      users: [{ name: 'app' }],
      roles: [{ name: 'reader' }],
      permissions: [{ principal: 'app' }],
      roleMemberships: [{ role: 'app', memberOf: 'reader' }],
      defaultPrivileges: [{ principal: 'reader', privilege: 'SELECT' }],
    }).map((stat) => stat.label)).toEqual(['Users', 'Roles', 'Memberships', 'Grants'])

    expect(summaryStats('diagnostics', {
      activeSessions: 7,
      blockedSessions: 1,
      waits: [{ waitType: 'PAGEIOLATCH' }],
      locks: [{ mode: 'S' }],
    }).map((stat) => `${stat.label}:${stat.value}`)).toContain('Blocked:1')

    expect(summaryStats('extensions', {
      extensions: [{ name: 'uuid-ossp', updateAvailable: true }],
      extensionObjects: [{ object: 'function uuid_generate_v4()' }],
    }).map((stat) => `${stat.label}:${stat.value}`)).toEqual([
      'Extensions:1',
      'Updates:1',
      'Objects:1',
    ])
  })

  it('normalizes native foreign-key endpoint shapes', () => {
    expect(relationshipRows({
      foreignKeys: [
        {
          name: 'orders_account_id_fkey',
          table: 'orders',
          columns: 'account_id',
          referencedTable: 'accounts',
          referencedColumns: 'id',
        },
      ],
    })).toEqual([
      {
        name: 'orders_account_id_fkey',
        from: 'orders.account_id',
        to: 'accounts.id',
      },
    ])
  })
})

function connection(engine: ConnectionProfile['engine']): ConnectionProfile {
  return {
    id: 'connection-1',
    name: 'Connection',
    engine,
    family: 'sql',
    connectionMode: 'native',
    host: 'localhost',
    tags: [],
    favorite: false,
    icon: engine,
    auth: {},
    environmentIds: [],
    readOnly: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}
