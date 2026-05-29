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
          innodbStatus: [{ name: 'Buffer pool hit rate', value: '99.1%', status: 'healthy' }],
          replication: [{ channel: 'default', lagSeconds: 0 }],
        }}
      />,
    )

    expect(screen.getByLabelText('MySQL storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL index posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('MySQL diagnostics posture')).toBeInTheDocument()
    expect(screen.getAllByText('InnoDB').length).toBeGreaterThan(0)
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
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
})
