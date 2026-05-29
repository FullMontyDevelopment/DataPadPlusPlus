import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PostgresObjectViewInsights } from './PostgresObjectViewInsights'

describe('PostgresObjectViewInsights', () => {
  it('renders PostgreSQL storage, index, security, and activity posture without raw payload text', () => {
    render(
      <PostgresObjectViewInsights
        kind="diagnostics"
        payload={{
          engine: 'postgresql',
          tableCount: 2,
          rowCount: 476,
          size: '280 KB',
          tables: [{ name: 'accounts', rows: 128, size: '96 KB' }],
          extensions: [{ name: 'pg_stat_statements', version: '1.10' }],
          indexes: [
            { name: 'accounts_pkey', columns: 'id', unique: true, valid: true },
            { name: 'orders_updated_at_idx', columns: 'updated_at', unique: false, valid: true },
          ],
          indexHealth: [
            { index: 'accounts_pkey', scans: 96, bloatRisk: 'low' },
            { index: 'orders_updated_at_idx', scans: 0, bloatRisk: 'review' },
          ],
          roles: [{ name: 'app', login: true, superuser: false, memberships: 'reporting' }],
          permissions: [{ principal: 'reporting', privilege: 'SELECT', object: 'public.accounts' }],
          activeSessions: 4,
          blockedSessions: 1,
          sessions: [{ user: 'app', state: 'active', blockedBy: '' }],
          locks: [{ object: 'public.accounts', mode: 'AccessShareLock', granted: true }],
          statements: [{ query: 'select * from public.accounts where status = $1', meanMs: 3.4 }],
        }}
      />,
    )

    expect(screen.getByLabelText('PostgreSQL storage posture')).toBeInTheDocument()
    expect(screen.getByLabelText('PostgreSQL index posture')).toBeInTheDocument()
    expect(screen.getByLabelText('PostgreSQL security posture')).toBeInTheDocument()
    expect(screen.getByLabelText('PostgreSQL activity posture')).toBeInTheDocument()
    expect(screen.getByText('Extensions')).toBeInTheDocument()
    expect(screen.getByText('orders_updated_at_idx')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.queryByText(/raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('renders nothing for non PostgreSQL payloads', () => {
    const { container } = render(
      <PostgresObjectViewInsights
        kind="table"
        payload={{
          engine: 'mysql',
          tables: [{ name: 'accounts' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
