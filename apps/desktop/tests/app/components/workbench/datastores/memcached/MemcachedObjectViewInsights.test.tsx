import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemcachedObjectViewInsights } from '../../../../../../src/app/components/workbench/datastores/memcached/MemcachedObjectViewInsights'

describe('MemcachedObjectViewInsights', () => {
  it('renders cache, slab, item, and connection posture without raw command text', () => {
    render(
      <MemcachedObjectViewInsights
        kind="server"
        payload={{
          hitRate: '99.2%',
          stats: [
            { metric: 'curr_items', value: 12842, unit: 'items', section: 'items' },
            { metric: 'bytes', value: '42.8 MB', unit: 'memory', section: 'memory' },
            { metric: 'limit_maxbytes', value: '256 MB', unit: 'memory', section: 'memory' },
            { metric: 'evictions', value: 12, unit: 'items', section: 'items' },
          ],
          slabs: [
            { classId: '1', chunkSize: '96 B', usedChunks: 2048, freeChunks: 512, totalPages: 2, memory: '192 KB' },
            { classId: '2', chunkSize: '240 B', usedChunks: 48128, freeChunks: 1280, totalPages: 12, memory: '11.0 MB' },
          ],
          items: [
            { classId: '1', number: 1024, age: '4m', evicted: 0, outOfMemory: 0, reclaimed: 12 },
            { classId: '2', number: 9004, age: '18m', evicted: 7, outOfMemory: 0, reclaimed: 481 },
          ],
          connections: [
            { name: 'current', value: 18, unit: 'clients', status: 'healthy' },
            { name: 'max', value: 1024, unit: 'clients', status: 'configured' },
            { name: 'rejected', value: 0, unit: 'clients', status: 'healthy' },
          ],
          diagnostics: [
            { signal: 'Hit Rate', value: '99.2%', status: 'healthy' },
            { signal: 'Connection Pressure', value: '1.8%', status: 'healthy' },
          ],
        }}
      />,
    )

    const cache = screen.getByRole('region', { name: 'Memcached cache posture' })
    expect(within(cache).getByText('99.2%')).toBeInTheDocument()
    expect(within(cache).getByText('42.8 MB / 256 MB')).toBeInTheDocument()

    const slabs = screen.getByRole('region', { name: 'Memcached slab posture' })
    expect(within(slabs).getByText('Class 2')).toBeInTheDocument()
    expect(within(slabs).getByText('240 B')).toBeInTheDocument()

    const items = screen.getByRole('region', { name: 'Memcached item posture' })
    expect(items).toHaveTextContent(/10[\s,]*028/)
    expect(within(items).getByText('493')).toBeInTheDocument()

    const connections = screen.getByRole('region', { name: 'Memcached connection posture' })
    expect(within(connections).getByText('1.8%')).toBeInTheDocument()
    expect(screen.queryByText('stats slabs')).not.toBeInTheDocument()
    expect(screen.queryByText('flush_all')).not.toBeInTheDocument()
  })

  it('stays hidden for unknown Memcached object kinds', () => {
    const { container } = render(<MemcachedObjectViewInsights kind="unknown" payload={{ stats: [{ metric: 'x' }] }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
