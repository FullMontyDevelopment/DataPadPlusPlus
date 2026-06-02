import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { ConnectionContextMenu } from './SideBar.connection-context-menu'

describe('ConnectionContextMenu', () => {
  it('shows Metrics only for metrics-capable adapters', () => {
    const onOpenConnectionMetrics = vi.fn()
    const { rerender } = renderMenu({
      adapterManifest: {
        id: 'postgresql',
        engine: 'postgresql',
        family: 'sql',
        label: 'PostgreSQL',
        maturity: 'mvp',
        defaultLanguage: 'sql',
        capabilities: ['supports_metrics_collection'],
      },
      onOpenConnectionMetrics,
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open metrics for Metrics DB' }))

    expect(onOpenConnectionMetrics).toHaveBeenCalledWith('conn-metrics')

    rerender(
      <ConnectionContextMenu
        {...defaultProps({ onOpenConnectionMetrics })}
        connection={{ ...connection, engine: 'sqlite', family: 'sql' }}
        adapterManifest={{
          id: 'sqlite',
          engine: 'sqlite',
          family: 'sql',
          label: 'SQLite',
          maturity: 'mvp',
          defaultLanguage: 'sql',
          capabilities: [],
        }}
      />,
    )

    expect(screen.queryByRole('menuitem', { name: /Open metrics/i })).not.toBeInTheDocument()
  })

  it('can expose Test Connection when the caller supports it', () => {
    const onClose = vi.fn()
    const onTestConnection = vi.fn()

    renderMenu({ onClose, onTestConnection })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Test connection Metrics DB' }))

    expect(onClose).toHaveBeenCalled()
    expect(onTestConnection).toHaveBeenCalledWith('conn-metrics')
  })
})

function renderMenu(overrides: Partial<Parameters<typeof ConnectionContextMenu>[0]> = {}) {
  return render(<ConnectionContextMenu {...defaultProps(overrides)} />)
}

function defaultProps(
  overrides: Partial<Parameters<typeof ConnectionContextMenu>[0]> = {},
): Parameters<typeof ConnectionContextMenu>[0] {
  return {
    connection,
    position: { x: 10, y: 10 },
    onClose: vi.fn(),
    onCreateTab: vi.fn(),
    onDeleteConnection: vi.fn(),
    onDuplicateConnection: vi.fn(),
    onOpenConnectionDrawer: vi.fn(),
    onOpenConnectionExplorer: vi.fn(),
    onOpenConnectionMetrics: vi.fn(),
    ...overrides,
  }
}

const connection: ConnectionProfile = {
  id: 'conn-metrics',
  name: 'Metrics DB',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  environmentIds: ['env-dev'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'M',
  auth: {},
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
}
