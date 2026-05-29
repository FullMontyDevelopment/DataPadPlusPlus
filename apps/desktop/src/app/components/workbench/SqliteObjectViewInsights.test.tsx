import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SqliteObjectViewInsights } from './SqliteObjectViewInsights'

describe('SqliteObjectViewInsights', () => {
  it('renders local file, maintenance, and schema posture without raw SQL dumps', () => {
    render(
      <SqliteObjectViewInsights
        kind="maintenance"
        payload={{
          engine: 'sqlite',
          database: 'main',
          tableCount: 2,
          indexCount: 2,
          quickCheckStatus: 'ok',
          freelistCount: 0,
          tables: [{ name: 'accounts', rows: 128 }],
          views: [{ name: 'active_accounts' }],
          indexes: [
            { name: 'accounts_pkey', columns: 'id', unique: true },
            { name: 'orders_account_id_idx', columns: 'account_id', unique: false },
          ],
          triggers: [{ name: 'orders_updated_at', event: 'after update' }],
          pragmas: [
            { name: 'journal_mode', value: 'wal' },
            { name: 'page_size', value: 4096 },
          ],
          checks: [{ name: 'quick_check', status: 'ok' }],
          maintenance: [{ name: 'Vacuum', status: 'preview' }],
          attachedDatabases: [{ name: 'main', status: 'ready' }],
        }}
      />,
    )

    expect(screen.getByLabelText('SQLite file posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQLite maintenance posture')).toBeInTheDocument()
    expect(screen.getByLabelText('SQLite schema posture')).toBeInTheDocument()
    expect(screen.getAllByText('ok').length).toBeGreaterThan(0)
    expect(screen.getByText('wal')).toBeInTheDocument()
    expect(screen.queryByText(/create table/i)).not.toBeInTheDocument()
  })

  it('renders nothing for non SQLite payloads', () => {
    const { container } = render(
      <SqliteObjectViewInsights
        kind="table"
        payload={{
          engine: 'duckdb',
          tables: [{ name: 'accounts' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
