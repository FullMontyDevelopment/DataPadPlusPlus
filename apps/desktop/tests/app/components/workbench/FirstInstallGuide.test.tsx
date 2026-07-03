import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type {
  ConnectionProfile,
  FirstInstallGuideStepId,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
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
  it('resumes legacy started guides at the welcome step', async () => {
    const snapshot = createGuideSaveStepSnapshot()
    snapshot.preferences.firstInstallGuide = { status: 'started' }

    render(
      <FirstInstallGuide
        {...guideProps()}
        snapshot={snapshot}
      />,
    )

    expect(
      await screen.findByRole('dialog', { name: 'Welcome to DataPad++' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()
  })

  it('clamps later persisted steps back to the connection save step without a saved connection', async () => {
    const onOpenConnection = vi.fn()
    const snapshot = createGuideSaveStepSnapshot()
    snapshot.preferences.firstInstallGuide = { status: 'started', currentStepId: 'query' }

    render(
      <FirstInstallGuide
        {...guideProps({ onOpenConnection })}
        snapshot={snapshot}
      />,
    )

    expect(await screen.findByRole('dialog', { name: 'Test and save' })).toBeInTheDocument()
    await waitFor(() => {
      expect(onOpenConnection).toHaveBeenCalledWith('folder-guide')
    })
  })

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

  it('backs out of a guide-opened folder dialog', async () => {
    const onCloseCreateFolder = vi.fn()

    render(
      <FirstInstallGuide
        {...guideProps({ onCloseCreateFolder })}
        snapshot={createGuideSaveStepSnapshot('folder')}
      />,
    )

    const guide = await screen.findByRole('dialog', { name: 'Organize the Library' })
    fireEvent.click(within(guide).getByRole('button', { name: 'Create Folder' }))
    fireEvent.click(within(guide).getByRole('button', { name: 'Back' }))

    expect(onCloseCreateFolder).toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'Welcome to DataPad++' })).toBeInTheDocument()
  })

  it('backs out of a guide-opened connection panel', async () => {
    const onOpenConnection = vi.fn()
    const onCloseConnectionPanel = vi.fn()
    const snapshot = createGuideSaveStepSnapshot('save')

    const { rerender } = render(
      <FirstInstallGuide
        {...guideProps({ onCloseConnectionPanel, onOpenConnection })}
        snapshot={snapshot}
      />,
    )

    await waitFor(() => {
      expect(onOpenConnection).toHaveBeenCalledWith('folder-guide')
    })

    const openedSnapshot = createGuideSaveStepSnapshot('save')
    openedSnapshot.ui.rightDrawer = 'connection'
    rerender(
      <FirstInstallGuide
        {...guideProps({ onCloseConnectionPanel, onOpenConnection })}
        snapshot={openedSnapshot}
        connectionDraftOpen
      />,
    )

    const guide = await screen.findByRole('dialog', { name: 'Test and save' })
    fireEvent.click(within(guide).getByRole('button', { name: 'Back' }))

    expect(onCloseConnectionPanel).toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'Create a connection' })).toBeInTheDocument()
  })
})

function createGuideSaveStepSnapshot(
  currentStepId: FirstInstallGuideStepId = 'save',
): WorkspaceSnapshot {
  const snapshot = createBlankBootstrapPayload().snapshot
  snapshot.preferences.firstInstallGuide = { status: 'started', currentStepId }
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
    onStepChange: vi.fn(),
    onOpenLibrary: vi.fn(),
    onRequestCreateFolder: vi.fn(),
    onCloseCreateFolder: vi.fn(),
    onOpenConnection: vi.fn(),
    onOpenConnectionPanel: vi.fn(),
    onCloseConnectionPanel: vi.fn(),
    onOpenExplorer: vi.fn(),
    onOpenQuery: vi.fn(),
    onOpenSettings: vi.fn(),
    onShowResults: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onRestoreUiState: vi.fn(),
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
