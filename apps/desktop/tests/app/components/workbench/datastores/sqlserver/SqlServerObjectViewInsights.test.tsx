import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SqlServerObjectViewInsights } from '../../../../../../src/app/components/workbench/datastores/sqlserver/SqlServerObjectViewInsights'

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
          statements: [
            {
              query: 'select * from dbo.Accounts',
              durationMs: 42,
              cpuMs: 12,
              logicalReads: 640,
              executions: 9,
            },
          ],
          ioStats: [{ name: 'datapadplusplus', type: 'ROWS', reads: 14, ioStallMs: 32 }],
          memoryGrants: [{ sessionId: 52, requestedKb: 8192, grantedKb: 8192, waitMs: 0 }],
          transactions: [{ id: '12345', state: 'active', ageSeconds: 12 }],
          sessions: [{ user: 'app_user', state: 'running', blockedBy: '' }],
          waits: [{ waitType: 'PAGEIOLATCH_SH', waitMs: 128 }],
          users: [{ name: 'dbo', type: 'SQL_USER', authenticationType: 'INSTANCE', login: 'sa' }],
          roles: [{ name: 'db_datareader', type: 'DATABASE_ROLE', memberCount: 2 }],
          roleMemberships: [{ role: 'db_datareader', member: 'reporting', memberType: 'SQL_USER' }],
          schemas: [{ name: 'reporting', owner: 'dbo', objectCount: 4 }],
          permissions: [{ principal: 'reporting', privilege: 'SELECT', object: 'dbo.Accounts', objectKind: 'OBJECT_OR_COLUMN' }],
          certificates: [{ name: 'App cert', subject: 'CN=app', status: 'active' }],
          symmetricKeys: [{ name: 'App symmetric key', algorithm: 'AES_256', keyLength: 256 }],
          asymmetricKeys: [{ name: 'App asymmetric key', algorithm: 'RSA_2048', keyLength: 2048 }],
          credentials: [{ name: 'etl_credential', identity: 'etl-runner', provider: 'EXTERNAL_DATA_SOURCE' }],
          audits: [{ name: 'Database audit', status: 'enabled', actionCount: 3 }],
          files: [{ name: 'datapadplusplus', type: 'ROWS', size: '64 MB', state: 'ONLINE' }],
          filegroups: [{ name: 'PRIMARY', type: 'ROWS_FILEGROUP', default: true, fileCount: 1, sizeMb: 64 }],
          partitionSchemes: [{ name: 'ps_month', function: 'pf_month', destinationCount: 12 }],
          partitionFunctions: [{ name: 'pf_month', type: 'RANGE', fanout: 12, boundary: 'right' }],
          partitionBoundaries: [{ partitionFunction: 'pf_month', boundary: 1, value: '2026-01-01', rangeSide: 'right' }],
          allocationUnits: [{ name: 'IN_ROW_DATA', totalMb: 64, usedMb: 48, dataMb: 42 }],
          agentServices: [{ name: 'SQL Server Agent', status: 'Running', startupType: 'Automatic' }],
          jobs: [{ name: 'Refresh cache', enabled: true, scheduled: true, lastRun: 'Succeeded', nextRun: '2026-06-05T12:00:00' }],
          schedules: [{ name: 'Every hour', enabled: true, frequency: 'Daily', jobCount: 1 }],
          alerts: [{ name: 'Severity 17', enabled: true, severity: 17 }],
          operators: [{ name: 'DBA', enabled: true, email: 'dba@example.com' }],
          proxies: [{ name: 'ETL proxy', enabled: true, credential: 'etl_credential' }],
          queryStoreStatus: { actualState: 'READ_WRITE', queryCaptureMode: 'AUTO', currentStorageMb: 18 },
          forcedPlans: [{ name: '42', queryText: 'select * from dbo.Accounts', forceFailureReason: '' }],
          regressedQueries: [{ name: '99', queryText: 'select * from dbo.Orders', regressionRatio: 2.4 }],
          eventSessionCount: 1,
          runningEventSessions: 1,
          eventSessions: [{ name: 'system_health', scope: 'server', status: 'running', eventCount: 14, targetCount: 2 }],
          eventSessionEvents: [{ sessionName: 'system_health', eventName: 'error_reported', package: 'sqlserver' }],
          eventTargets: [{ sessionName: 'system_health', targetName: 'ring_buffer', scope: 'server' }],
        }}
      />,
    )

    expect(screen.getByLabelText('SQL Server storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server index posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server workload posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server Extended Events posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQL Server Agent posture')).toBeInTheDocument()
    const storage = screen.getByLabelText('SQL Server storage posture')
    expect(within(storage).getByText('Filegroups')).toBeInTheDocument()
    expect(within(storage).getByText('Partitions')).toBeInTheDocument()
    expect(within(storage).getByText('Allocation')).toBeInTheDocument()
    const security = screen.getByLabelText('SQL Server security posture')
    expect(within(security).getByText('Schemas')).toBeInTheDocument()
    expect(within(security).getByText('Members')).toBeInTheDocument()
    expect(within(security).getByText('Keys')).toBeInTheDocument()
    expect(within(security).getByText('Credentials')).toBeInTheDocument()
    expect(within(security).getByText('Audits')).toBeInTheDocument()
    expect(screen.getByText('Top Queries')).toBeInTheDocument()
    expect(screen.getByText('Runtime Queries')).toBeInTheDocument()
    expect(screen.getByText('Memory Grants')).toBeInTheDocument()
    expect(screen.getByText('I/O Files')).toBeInTheDocument()
    expect(screen.getByText('Transactions')).toBeInTheDocument()
    expect(screen.getByText('READ_WRITE')).toBeInTheDocument()
    expect(screen.getByText('Forced Plans')).toBeInTheDocument()
    expect(screen.getByText('Regressions')).toBeInTheDocument()
    expect(screen.getByText('select * from dbo.Orders')).toBeInTheDocument()
    expect(screen.getByText('Extended Events')).toBeInTheDocument()
    expect(screen.getByText('ring_buffer')).toBeInTheDocument()
    expect(screen.getByText('system_health')).toBeInTheDocument()
    expect(screen.getByText('dbo.Orders')).toBeInTheDocument()
    expect(screen.getByText('Refresh cache')).toBeInTheDocument()
    const agent = screen.getByLabelText('SQL Server Agent posture')
    expect(within(agent).getByText('Running')).toBeInTheDocument()
    expect(within(agent).getByText('Alerts')).toBeInTheDocument()
    expect(within(agent).getByText('Operators')).toBeInTheDocument()
    expect(within(agent).getByText('Proxies')).toBeInTheDocument()
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
