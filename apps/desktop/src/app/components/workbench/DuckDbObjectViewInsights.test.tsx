import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DuckDbObjectViewInsights } from './DuckDbObjectViewInsights'

describe('DuckDbObjectViewInsights', () => {
  it('renders local file, file analytics, extension, and maintenance posture without raw payload text', () => {
    render(
      <DuckDbObjectViewInsights
        kind="table"
        payload={{
          engine: 'duckdb',
          database: 'datapad.duckdb',
          databaseSize: '86 MB',
          tableCount: 3,
          tables: [{ name: 'orders', rows: '1.2 M', size: '58 MB' }],
          files: [{ name: 'orders_2026.parquet', format: 'parquet', size: '58 MB' }],
          extensions: [
            { name: 'parquet', version: 'loaded', schema: 'installed' },
            { name: 'httpfs', version: 'available', schema: 'not installed' },
          ],
          attachedDatabases: [{ name: 'main', status: 'read-write' }],
          pragmas: [
            { name: 'memory_limit', value: '80%' },
            { name: 'threads', value: 'auto' },
          ],
          checks: [{ name: 'Query Guard', status: 'bounded' }],
          statistics: [{ name: 'orders', rows: '1.2 M', scans: '42', lastAnalyze: 'auto' }],
        }}
      />,
    )

    expect(within(screen.getByRole('region', { name: 'DuckDB local file posture' })).getByText('datapad.duckdb')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'DuckDB file analytics posture' })).getByText('orders_2026.parquet')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'DuckDB extension posture' })).getByText('httpfs')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'DuckDB maintenance posture' })).getByText('80%')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('stays hidden for non-DuckDB payloads', () => {
    const { container } = render(<DuckDbObjectViewInsights kind="table" payload={{ engine: 'sqlite' }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
