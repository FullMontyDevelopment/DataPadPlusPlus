import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { ConnectionProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createBlankBootstrapPayload } from '../../../../src/app/data/workspace-factory'
import { FirstInstallGuide } from '../../../../src/app/components/workbench/FirstInstallGuide'
import {
  getGuidePopoverStyle,
  type SpotlightState,
} from '../../../../src/app/components/workbench/FirstInstallGuide.placement'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
}

function styleFor(spotlight: SpotlightState, placement: 'top' | 'right' | 'bottom' | 'left') {
  return getGuidePopoverStyle(spotlight, placement) as { top: number; left: number }
}

describe('FirstInstallGuide placement', () => {
  afterEach(() => {
    setViewport(1024, 768)
  })

  it('keeps right-side placement for top-edge controls and clamps vertically', () => {
    setViewport(1200, 800)

    const style = styleFor({ top: 24, left: 280, width: 32, height: 32 }, 'right')

    expect(style.left).toBe(326)
    expect(style.top).toBe(16)
  })

  it('falls back when the preferred side has no room', () => {
    setViewport(900, 700)

    const style = styleFor({ top: 96, left: 780, width: 96, height: 44 }, 'right')

    expect(style.left).toBe(524)
    expect(style.top).toBe(154)
  })

  it('keeps the popover inside narrow viewports', () => {
    setViewport(390, 680)

    const style = styleFor({ top: 580, left: 140, width: 80, height: 64 }, 'bottom')

    expect(style.left).toBe(16)
    expect(style.top).toBe(306)
  })
})

describe('FirstInstallGuide save step', () => {
  it('opens a missing connection draft panel automatically', async () => {
    const onOpenConnection = vi.fn()
    const openedSnapshot = createGuideSaveStepSnapshot()
    openedSnapshot.ui.rightDrawer = 'connection'
    const closedSnapshot = createGuideSaveStepSnapshot()

    const { rerender } = render(
      <FirstInstallGuide
        {...guideProps({ onOpenConnection })}
        snapshot={openedSnapshot}
        connectionDraftOpen
      />,
    )

    expect(await screen.findByRole('dialog', { name: 'Test and save' })).toBeInTheDocument()

    rerender(
      <FirstInstallGuide
        {...guideProps({ onOpenConnection })}
        snapshot={closedSnapshot}
        connectionDraftOpen={false}
      />,
    )

    await waitFor(() => {
      expect(onOpenConnection).toHaveBeenCalledWith('folder-guide')
    })
  })

  it('opens a saved connection panel automatically when Step 4 is revisited', async () => {
    const onOpenConnectionPanel = vi.fn()
    const openedSnapshot = createGuideSaveStepSnapshot()
    openedSnapshot.ui.rightDrawer = 'connection'
    const savedSnapshot = createGuideSaveStepSnapshot()
    savedSnapshot.connections = [testConnection]
    savedSnapshot.ui.activeConnectionId = testConnection.id

    const { rerender } = render(
      <FirstInstallGuide
        {...guideProps({ onOpenConnectionPanel })}
        snapshot={openedSnapshot}
        connectionDraftOpen
      />,
    )

    expect(await screen.findByRole('dialog', { name: 'Test and save' })).toBeInTheDocument()

    rerender(
      <FirstInstallGuide
        {...guideProps({ onOpenConnectionPanel })}
        snapshot={savedSnapshot}
        connectionDraftOpen={false}
      />,
    )

    await waitFor(() => {
      expect(onOpenConnectionPanel).toHaveBeenCalledWith('conn-guide')
    })
  })
})

function createGuideSaveStepSnapshot(): WorkspaceSnapshot {
  const snapshot = createBlankBootstrapPayload().snapshot
  snapshot.preferences.firstInstallGuide = { status: 'started' }
  snapshot.libraryNodes = [
    {
      id: 'folder-guide',
      kind: 'folder',
      name: 'Getting Started',
      tags: [],
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    },
  ]
  return snapshot
}

function guideProps(
  overrides: Partial<ComponentProps<typeof FirstInstallGuide>> = {},
): ComponentProps<typeof FirstInstallGuide> {
  return {
    snapshot: createGuideSaveStepSnapshot(),
    connectionDraftOpen: false,
    startRequestRevision: 0,
    onStart: vi.fn(),
    onSkip: vi.fn(),
    onComplete: vi.fn(),
    onOpenLibrary: vi.fn(),
    onRequestCreateFolder: vi.fn(),
    onOpenConnection: vi.fn(),
    onOpenConnectionPanel: vi.fn(),
    onOpenExplorer: vi.fn(),
    onOpenQuery: vi.fn(),
    onOpenSettings: vi.fn(),
    onShowResults: vi.fn(),
    ...overrides,
  }
}

const testConnection: ConnectionProfile = {
  id: 'conn-guide',
  name: 'Guide PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  environmentIds: [],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {},
  createdAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
}
