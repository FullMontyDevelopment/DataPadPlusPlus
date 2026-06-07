import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MysqlObjectViewInsights } from './MysqlObjectViewInsights'

describe('MysqlObjectViewInsights', () => {
  it('renders storage, index, security, and diagnostics posture without raw payload text', () => {
    render(
      <MysqlObjectViewInsights
        kind="diagnostics"
        payload={{
          engine: 'mysql',
          tableCount: 2,
          databaseSize: 2048,
          tables: [{ name: 'accounts', rows: 10, size: 1024, engine: 'InnoDB' }],
          statistics: [{ name: 'accounts', rows: 10, size: 1024, engine: 'InnoDB' }],
          indexes: [
            { name: 'PRIMARY', type: 'BTREE', columns: 'id', unique: true, usage: 10 },
            { name: 'accounts_email_idx', type: 'BTREE', columns: 'email', unique: false, usage: 8 },
          ],
          users: [{ name: 'app', host: '%', authenticationType: 'caching_sha2_password' }],
          permissions: [{ principal: 'app@%', privilege: 'SELECT', object: 'datapadplusplus' }],
          activeSessions: 2,
          sessions: [{ sessionId: 12, user: 'app', state: 'executing' }],
          slowQueries: [{ digest: 'SELECT * FROM accounts', avgMs: 4, rowsExamined: 100 }],
          statementDigests: [{ digest: 'SELECT * FROM orders', avgMs: 9, rowsExamined: 400 }],
          tableIo: [{ table: 'orders', index: 'orders_account_id_idx', totalMs: 22 }],
          metadataLocks: [{ object: 'orders', status: 'GRANTED' }],
          optimizerTrace: [{ enabled: 'enabled=off,one_line=off' }],
          innodbStatus: [{ name: 'Buffer pool hit rate', value: '99.1%', status: 'healthy' }],
          replication: [{ channel: 'default', lagSeconds: 0 }],
        }}
      />,
    )

    expect(screen.getByLabelText('MySQL storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL index posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL diagnostics posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL performance schema posture')).toBeInTheDocument()
    expect(screen.getAllByText('InnoDB').length).toBeGreaterThan(0)
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.getByText('Performance Schema')).toBeInTheDocument()
    expect(screen.queryByText(/raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('renders nothing for non MySQL-family payloads', () => {
    const { container } = render(
      <MysqlObjectViewInsights
        kind="table"
        payload={{
          engine: 'postgresql',
          tables: [{ name: 'accounts' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('treats status counters as diagnostics instead of storage metadata', () => {
    render(
      <MysqlObjectViewInsights
        kind="status-counters"
        payload={{
          engine: 'mysql',
          statistics: [
            { name: 'Questions', rows: 1200 },
            { name: 'Threads_running', rows: 3 },
          ],
          sessions: [{ sessionId: 11, user: 'app', state: 'executing' }],
        }}
      />,
    )

    expect(screen.getByLabelText('MySQL diagnostics posture')).toBeInTheDocument()
    expect(screen.queryByLabelText('MySQL storage posture')).not.toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Threads_running')).toBeInTheDocument()
  })

  it('renders MariaDB diagnostics and performance schema labels distinctly', () => {
    render(
      <MysqlObjectViewInsights
        kind="diagnostics"
        payload={{
          engine: 'mariadb',
          statistics: [
            { name: 'Threads_running', rows: 3 },
            { name: 'Aria_pagecache_reads', rows: 24 },
          ],
          sessions: [{ sessionId: 11, user: 'app', state: 'executing' }],
          statementDigests: [{ digest: 'SELECT * FROM orders', avgMs: 9, rowsExamined: 400 }],
          tableIo: [{ table: 'orders', index: 'orders_account_id_idx', totalMs: 22 }],
          metadataLocks: [{ object: 'orders', status: 'GRANTED' }],
          engines: [{ name: 'Aria', support: 'YES' }],
          roles: [{ name: 'reporting_read', host: '%' }],
          roleMappings: [{ name: 'reporting', host: '%', member: 'reporting_read', adminOption: 'N' }],
          serverVariables: [
            { name: 'version', value: '11.4.2-MariaDB', status: 'info' },
            { name: 'sql_mode', value: 'STRICT_TRANS_TABLES', status: 'info' },
            { name: 'default_storage_engine', value: 'Aria', status: 'info' },
          ],
          analyzeProfile: [{ name: 'ANALYZE FORMAT=JSON', status: 'preview', queryTemplate: 'analyze format=json select 1;' }],
        }}
      />,
    )

    expect(screen.getByLabelText('MariaDB storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MariaDB security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MariaDB diagnostics posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MariaDB performance schema posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MariaDB server variables posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MariaDB analyze profile posture')).toBeInTheDocument()
    expect(screen.queryByLabelText('MySQL diagnostics posture')).not.toBeInTheDocument()
    expect(screen.getByText('Aria_pagecache_reads')).toBeInTheDocument()
    expect(screen.getByText('reporting_read')).toBeInTheDocument()
    expect(screen.getByText('Role Mappings')).toBeInTheDocument()
    expect(screen.getAllByText('STRICT_TRANS_TABLES').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ANALYZE FORMAT=JSON').length).toBeGreaterThan(0)
    expect(screen.queryByText('Optimizer Trace')).not.toBeInTheDocument()
  })
})
