import { fireEvent, render, screen } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile, QueryTabState } from '@datapadplusplus/shared-types'
import type { ComponentProps, CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCapabilities } from '../../../../src/app/workspace-helpers'
import { BottomPanel } from '../../../../src/app/components/workbench/BottomPanel'

type BottomPanelProps = ComponentProps<typeof BottomPanel>

const originalRequestAnimationFrame = window.requestAnimationFrame
const originalCancelAnimationFrame = window.cancelAnimationFrame
const originalInnerWidth = window.innerWidth
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture
const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture
let animationFrameCallbacks: FrameRequestCallback[] = []

describe('BottomPanel resizing', () => {
  beforeEach(() => {
    animationFrameCallbacks = []
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback)
        return animationFrameCallbacks.length
      }),
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  afterEach(() => {
    restoreProperty(window, 'requestAnimationFrame', originalRequestAnimationFrame)
    restoreProperty(window, 'cancelAnimationFrame', originalCancelAnimationFrame)
    restoreProperty(window, 'innerWidth', originalInnerWidth)
    restoreProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture)
    restoreProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleasePointerCapture)
    restoreProperty(HTMLElement.prototype, 'hasPointerCapture', originalHasPointerCapture)
    document.body.classList.remove('is-bottom-panel-resizing')
    document.body.classList.remove('is-results-side-resizing')
    vi.restoreAllMocks()
  })

  it('updates the panel height locally while dragging and commits once on release', () => {
    const onResize = vi.fn()
    renderBottomPanel({ height: 260, onResize })

    const panel = screen.getByLabelText('Bottom panel')
    const handle = screen.getByRole('separator', { name: 'Resize bottom panel' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 220 })
    flushAnimationFrames()

    expect(panel).toHaveStyle({ height: '340px' })
    expect(handle).toHaveAttribute('aria-valuenow', '340')
    expect(onResize).not.toHaveBeenCalled()
    expect(document.body).toHaveClass('is-bottom-panel-resizing')

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 220 })

    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(340)
    expect(document.body).not.toHaveClass('is-bottom-panel-resizing')
  })

  it('clamps drag and keyboard resize requests to supported panel bounds', () => {
    const onResize = vi.fn()
    renderBottomPanel({ height: 130, onResize })

    const handle = screen.getByRole('separator', { name: 'Resize bottom panel' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 500 })
    flushAnimationFrames()
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 500 })

    expect(onResize).toHaveBeenCalledWith(120)

    onResize.mockClear()
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onResize).toHaveBeenCalledWith(120)
  })

  it('lets right-docked results resize across most of the workbench', () => {
    restoreProperty(window, 'innerWidth', 1200)
    const onResize = vi.fn()
    renderBottomPanel({ dock: 'right', sideWidth: 420, onResize })

    const panel = screen.getByLabelText('Right results panel')
    const handle = screen.getByRole('separator', { name: 'Resize right results panel' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 })
    flushAnimationFrames()

    expect(panel).toHaveStyle({ width: '1080px' })
    expect(handle).toHaveAttribute('aria-valuenow', '1080')
    expect(document.body).toHaveClass('is-results-side-resizing')

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200 })

    expect(onResize).toHaveBeenCalledWith(1080)
    expect(document.body).not.toHaveClass('is-results-side-resizing')
  })

  it('updates the owning workbench grid width while right-dock dragging', () => {
    restoreProperty(window, 'innerWidth', 1200)
    const onResize = vi.fn()
    renderBottomPanelInWorkbench({ dock: 'right', sideWidth: 420, onResize })

    const panel = screen.getByLabelText('Right results panel')
    const workbench = panel.closest('.ads-workbench') as HTMLElement
    const handle = screen.getByRole('separator', { name: 'Resize right results panel' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 900 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 })
    flushAnimationFrames()

    expect(workbench.style.getPropertyValue('--results-side-width')).toBe('620px')
    expect(panel).not.toHaveStyle({ width: '620px' })

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700 })
    expect(onResize).toHaveBeenCalledWith(620)
  })

  it('summarizes inspection metadata without dumping raw payloads in Details', () => {
    renderBottomPanel({
      activePanelTab: 'details',
      activeConnection: testConnection,
      activeEnvironment: testEnvironment,
      activeTab: testQueryTab,
      explorerInspection: {
        nodeId: 'mongodb:database:catalog:collection:products',
        summary: 'Products collection metadata is loaded.',
        queryTemplate: '{ "collection": "products", "filter": {} }',
        payload: {
          collectionName: 'products',
          password: 'super-secret',
          connectionString: 'mongodb://admin:secret-pass@localhost:27017/catalog?token=abc123',
          indexes: [{ name: '_id_' }, { name: 'sku_1' }],
          validationRules: { required: ['sku'] },
        },
      },
    })

    expect(screen.getByText('Products collection metadata is loaded.')).toBeInTheDocument()
    expect(screen.getByText('A starter query is available for this object. Apply it to the active query tab to review or run.')).toBeInTheDocument()
    expect(screen.getByText('Collection Name')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('Stored securely')).toBeInTheDocument()
    expect(screen.getByText('mongodb://admin:<redacted>@localhost:27017/catalog?token=<redacted>')).toBeInTheDocument()
    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret-pass/)).not.toBeInTheDocument()
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument()
    expect(screen.getByText('2 item(s)')).toBeInTheDocument()
    expect(screen.queryByText(/"collection"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"indexes"/)).not.toBeInTheDocument()
  })
})

function renderBottomPanel(overrides: Partial<BottomPanelProps> = {}) {
  const props: BottomPanelProps = {
    activePanelTab: 'messages',
    height: 260,
    capabilities: defaultCapabilities(),
    workbenchMessages: [],
    onSelectPanelTab: vi.fn(),
    onSelectRenderer: vi.fn(),
    onLoadNextPage: vi.fn(),
    onResize: vi.fn(),
    onClose: vi.fn(),
    onConfirmExecution: vi.fn(),
    onApplyInspectionTemplate: vi.fn(),
    onRestoreHistory: vi.fn(),
    onExecuteDataEdit: vi.fn(async () => undefined),
    onDismissWorkbenchMessage: vi.fn(),
    onClearWorkbenchMessages: vi.fn(),
    ...overrides,
  }

  return render(<BottomPanel {...props} />)
}

function renderBottomPanelInWorkbench(overrides: Partial<BottomPanelProps> = {}) {
  const props: BottomPanelProps = {
    activePanelTab: 'messages',
    height: 260,
    capabilities: defaultCapabilities(),
    workbenchMessages: [],
    onSelectPanelTab: vi.fn(),
    onSelectRenderer: vi.fn(),
    onLoadNextPage: vi.fn(),
    onResize: vi.fn(),
    onClose: vi.fn(),
    onConfirmExecution: vi.fn(),
    onApplyInspectionTemplate: vi.fn(),
    onRestoreHistory: vi.fn(),
    onExecuteDataEdit: vi.fn(async () => undefined),
    onDismissWorkbenchMessage: vi.fn(),
    onClearWorkbenchMessages: vi.fn(),
    ...overrides,
  }

  return render(
    <div
      className="ads-workbench"
      style={{ '--results-side-width': `${props.sideWidth ?? 420}px` } as CSSProperties}
    >
      <div className="workbench-center has-right-results">
        <main className="editor-workspace" />
        <BottomPanel {...props} />
      </div>
    </div>,
  )
}

function flushAnimationFrames() {
  const callbacks = animationFrameCallbacks
  animationFrameCallbacks = []
  callbacks.forEach((callback) => callback(0))
}

function restoreProperty<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
) {
  if (value === undefined) {
    delete target[key]
    return
  }

  Object.defineProperty(target, key, {
    configurable: true,
    value,
  })
}

const testConnection: ConnectionProfile = {
  id: 'conn-mongo',
  name: 'MongoDB',
  engine: 'mongodb',
  family: 'document',
  host: 'localhost',
  port: 27017,
  database: 'catalog',
  environmentIds: [],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mongodb',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const testEnvironment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const testQueryTab: QueryTabState = {
  id: 'tab-query',
  title: 'Products Query',
  tabKind: 'query',
  connectionId: testConnection.id,
  environmentId: testEnvironment.id,
  family: 'document',
  language: 'json',
  editorLabel: 'MongoDB / Local',
  queryText: '{ "collection": "products", "filter": {} }',
  status: 'idle',
  dirty: false,
  history: [],
}
