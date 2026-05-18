import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCapabilities } from '../../workspace-helpers'
import { BottomPanel } from './BottomPanel'

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
