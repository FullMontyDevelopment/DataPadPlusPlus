import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SqlServerObjectViewInsights } from './SqlServerObjectViewInsights'

describe('SqlServerObjectViewInsights', () => {
  it('renders SQL Server storage, index, workload, security, and Agent posture without raw payload text', () => {
    render(
      <SqlServerObjectViewInsights
        kind="diagnostics"
        payload={{
          engine: 'sqlserver',
          tableCount: 2,
          rowCount: 476,
          databaseSize: '64 MB',
          tables: [{ name: 'Accounts', rows: 128 }],
          indexes: [
            { name: 'PK_Accounts', unique: true, usage: 'seek 14 / scan 1' },
            { name: 'IX_Accounts_status', unique: false, usage: 'seek 8 / scan 0' },
          ],
          missingIndexes: [{ table: 'dbo.Orders', impact: 'medium' }],
          queryStore: [{ name: 'Top Queries', durationMs: 18, executions: 14 }],
          sessions: [{ user: 'app_user', state: 'running', blockedBy: '' }],
          waits: [{ waitType: 'PAGEIOLATCH_SH', waitMs: 128 }],
          users: [{ name: 'dbo', type: 'SQL_USER', authenticationType: 'INSTANCE' }],
          roles: [{ name: 'db_datareader', type: 'DATABASE_ROLE' }],
          permissions: [{ principal: 'reporting', privilege: 'SELECT', object: 'dbo.Accounts' }],
          files: [{ name: 'datapadplusplus', type: 'ROWS', size: '64 MB', state: 'ONLINE' }],
          jobs: [{ name: 'Refresh cache', enabled: true, scheduled: true, lastRun: 'Succeeded' }],
        }}
      />,
    )

    expect(screen.getByLabelText('SQL Server storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server index posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server workload posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server Agent posture')).toBeInTheDocument()
    expect(screen.getByText('Top Queries')).toBeInTheDocument()
    expect(screen.getByText('dbo.Orders')).toBeInTheDocument()
    expect(screen.getByText('Refresh cache')).toBeInTheDocument()
    expect(screen.queryByText(/raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('renders nothing for non SQL Server payloads', () => {
    const { container } = render(
      <SqlServerObjectViewInsights
        kind="table"
        payload={{
          engine: 'postgresql',
          tables: [{ name: 'accounts' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
