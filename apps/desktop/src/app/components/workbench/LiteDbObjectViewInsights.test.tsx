import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiteDbObjectViewInsights } from './LiteDbObjectViewInsights'

describe('LiteDbObjectViewInsights', () => {
  it('renders collection, index, storage, and file-storage posture without raw payload text', () => {
    render(
      <LiteDbObjectViewInsights
        kind="database"
        payload={{
          documentCount: 100428,
          fileSize: '18.4 MB',
          collections: [
            { name: 'products', documentCount: 100000, indexes: 3, avgDocumentSize: '182 B' },
            { name: 'accounts', documentCount: 428, indexes: 2, avgDocumentSize: '1.4 KB' },
          ],
          fields: [
            { path: 'sku', types: 'String', presence: '100%', example: 'luna-lamp', warning: '' },
            { path: 'tags[]', types: 'String[]', presence: '72%', example: 'lighting', warning: 'array values' },
          ],
          indexes: [
            { collection: 'products', name: 'sku', expression: '$.sku', unique: true, status: 'ready' },
            { collection: 'products', name: 'inventory_available', expression: '$.inventory.available', unique: false, status: 'ready' },
          ],
          storage: [
            { name: 'Free pages', value: 18, status: 'watch', guidance: 'Consider shrink.' },
            { name: 'Journal', value: 'enabled', status: 'healthy' },
          ],
          files: [
            { id: 'invoice/2026/001', filename: 'invoice-001.pdf', length: '86 KB', chunks: 2 },
          ],
          chunks: [
            { fileId: 'invoice/2026/001', chunk: 0, size: '64 KB', status: 'ok' },
            { fileId: 'invoice/2026/001', chunk: 1, size: '22 KB', status: 'ok' },
          ],
          diagnostics: [
            { signal: 'File Storage', value: '1 file', status: 'healthy' },
          ],
        }}
      />,
    )

    const collection = screen.getByRole('region', { name: 'LiteDB collection posture' })
    expect(collection).toHaveTextContent(/100[\s,]*428/)
    expect(within(collection).getByText('sku')).toBeInTheDocument()

    const indexes = screen.getByRole('region', { name: 'LiteDB index posture' })
    expect(within(indexes).getByText('$.sku')).toBeInTheDocument()

    const storage = screen.getByRole('region', { name: 'LiteDB storage posture' })
    expect(within(storage).getByText('18.4 MB')).toBeInTheDocument()
    expect(within(storage).getByText('enabled')).toBeInTheDocument()

    const fileStorage = screen.getByRole('region', { name: 'LiteDB file storage posture' })
    expect(within(fileStorage).getByText('2')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/databaseFile/i)).not.toBeInTheDocument()
  })

  it('stays hidden for unknown LiteDB object kinds', () => {
    const { container } = render(<LiteDbObjectViewInsights kind="unknown" payload={{ collections: [{ name: 'x' }] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
