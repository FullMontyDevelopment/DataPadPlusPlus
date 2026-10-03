import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { EditorTabs } from '../../../../../src/app/components/workbench/EditorTabs'

afterEach(() => vi.restoreAllMocks())

describe('EditorTabs pointer reordering', () => {
  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])('reorders without native drag events with multi-window %s and native capability %s', (multiWindowEnabled, crossWindowDragSupported) => {
    const onReorderTabs = vi.fn()
    const onStartCrossWindowDrag = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), multiWindowEnabled, crossWindowDragSupported,
      onReorderTabs, onStartCrossWindowDrag })
    const { headers } = layoutTabs()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 285)
    expect(headers[0]).toHaveClass('is-dragging')
    expect(headers[2]).toHaveClass('is-drop-after')
    pointer(headers[0], 'up', 285)
    expect(onReorderTabs).toHaveBeenCalledExactlyOnceWith(['tab-two', 'tab-three', 'tab-one'])
    expect(onStartCrossWindowDrag).not.toHaveBeenCalled()
  })

  it.each([
    [0, 245, ['tab-two', 'tab-one', 'tab-three']],
    [0, 285, ['tab-two', 'tab-three', 'tab-one']],
    [2, 45, ['tab-three', 'tab-one', 'tab-two']],
    [2, 85, ['tab-one', 'tab-three', 'tab-two']],
    [0, 390, ['tab-two', 'tab-three', 'tab-one']],
  ])('moves tab %s to the indicated insertion point at %s', (sourceIndex, x, expected) => {
    const onReorderTabs = vi.fn()
    const onSelectTab = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), onReorderTabs, onSelectTab })
    const { headers } = layoutTabs()
    const source = headers[sourceIndex]
    pointer(source, 'down', sourceIndex * 100 + 50)
    pointer(source, 'move', x)
    expect(source).toHaveClass('is-dragging')
    expect(screen.getByRole('tablist')).toHaveClass('is-reordering')
    expect(headers.some((header) => header.matches('.is-drop-before, .is-drop-after'))).toBe(true)
    expect(onReorderTabs).not.toHaveBeenCalled()
    pointer(source, 'up', x)
    fireEvent.click(source)
    expect(onReorderTabs).toHaveBeenCalledExactlyOnceWith(expected)
    expect(onSelectTab).not.toHaveBeenCalled()
    expect(source).not.toHaveClass('is-dragging')
    expect(source).toHaveFocus()
    expect(headers.every((header) => !header.matches('.is-drop-before, .is-drop-after'))).toBe(true)
  })

  it('keeps normal clicks and tiny pointer movements as selection, not reordering', () => {
    const onSelectTab = vi.fn()
    const onReorderTabs = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), onSelectTab, onReorderTabs })
    const { headers } = layoutTabs()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 52)
    expect(headers[0]).not.toHaveClass('is-dragging')
    pointer(headers[0], 'up', 52)
    fireEvent.click(headers[0])
    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(tabOne.id)
    expect(onReorderTabs).not.toHaveBeenCalled()
  })

  it.each(['escape', 'blur', 'pointercancel', 'lostpointercapture', 'outside', 'same-place'])('cancels safely on %s', (reason) => {
    const onReorderTabs = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), onReorderTabs })
    const { headers } = layoutTabs()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 285)
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    if (reason === 'blur') fireEvent.blur(window)
    if (reason === 'pointercancel') fireEvent.pointerCancel(headers[0])
    if (reason === 'lostpointercapture') fireEvent.lostPointerCapture(headers[0])
    pointer(headers[0], 'up', reason === 'outside' ? 500 : reason === 'same-place' ? 50 : 285)
    expect(onReorderTabs).not.toHaveBeenCalled()
    expect(headers[0]).not.toHaveClass('is-dragging')
  })

  it('cancels if tabs are removed or reordered during the gesture', () => {
    const onReorderTabs = vi.fn()
    const { rerender } = renderEditorTabs({ tabs: threeTabs(), onReorderTabs })
    const { headers } = layoutTabs()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 285)
    rerender(<EditorTabs {...defaultEditorTabsProps} tabs={[tabOne, tabTwo]} onReorderTabs={onReorderTabs} />)
    pointer(headers[0], 'up', 285)
    expect(onReorderTabs).not.toHaveBeenCalled()
    expect(headers[0]).not.toHaveClass('is-dragging')
  })

  it('does not snap back to the active tab when background execution updates during a drag', () => {
    const onReorderTabs = vi.fn()
    const { rerender } = renderEditorTabs({ tabs: threeTabs(), activeTabId: tabOne.id, onReorderTabs })
    const { headers } = layoutTabs()
    const scrollIntoView = vi.fn()
    Object.defineProperty(headers[0], 'scrollIntoView', { configurable: true, value: scrollIntoView })
    pointer(headers[1], 'down', 150)
    pointer(headers[1], 'move', 285)
    rerender(<EditorTabs {...defaultEditorTabsProps} activeTabId={tabOne.id}
      tabs={threeTabs().map((tab) => ({ ...tab, status: 'running' }))} onReorderTabs={onReorderTabs} />)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(headers[1]).toHaveClass('is-dragging')
    pointer(headers[1], 'up', 285)
    expect(onReorderTabs).toHaveBeenCalledExactlyOnceWith(['tab-one', 'tab-three', 'tab-two'])
  })

  it('does not start a drag from a close button, rename input, or secondary pointer', () => {
    const onReorderTabs = vi.fn()
    const onCloseTab = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), onReorderTabs, onCloseTab })
    const { headers } = layoutTabs()
    const close = screen.getByRole('button', { name: 'Close tab Query 1.sql' })
    pointer(close, 'down', 50)
    pointer(headers[0], 'move', 285)
    pointer(headers[0], 'up', 285)
    fireEvent.click(close)
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith(tabOne.id)
    fireEvent.pointerDown(headers[0], { pointerId: 1, button: 2, clientX: 50, clientY: 15 })
    pointer(headers[0], 'move', 285)
    pointer(headers[0], 'up', 285)
    fireEvent.doubleClick(headers[0])
    pointer(screen.getByRole('textbox', { name: /Rename tab/ }), 'down', 50)
    pointer(headers[0], 'move', 285)
    pointer(headers[0], 'up', 285)
    expect(onReorderTabs).not.toHaveBeenCalled()
  })

  it('preserves selection, pins, drafts, and environment identity when applying the order', () => {
    const tabs = [{ ...tabOne, pinned: true, dirty: true }, tabTwo]
    const onReorderTabs = vi.fn()
    const { rerender } = renderEditorTabs({ tabs, activeTabId: tabTwo.id, environments, onReorderTabs })
    const { headers } = layoutTabs()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 185)
    pointer(headers[0], 'up', 185)
    expect(onReorderTabs).toHaveBeenCalledExactlyOnceWith([tabTwo.id, tabOne.id])
    rerender(<EditorTabs {...defaultEditorTabsProps} tabs={[tabs[1], tabs[0]]} activeTabId={tabTwo.id} environments={environments} />)
    expectTabEnvironment('Query 1', 'env-one', '#ef4444', false)
    expectTabEnvironment('Query 2', 'env-two', '#22c55e', true)
    expect(screen.getByRole('img', { name: 'Pinned tab' })).toBeInTheDocument()
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()
    expect(tabs[0].queryText).toBe('select 1;')
  })

  it('scrolls while holding at an edge and stops on cancellation', () => {
    let nextFrame: FrameRequestCallback | undefined
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame = callback
      return 42
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    renderEditorTabs({ tabs: threeTabs() })
    const { headers, strip } = layoutTabs()
    Object.defineProperties(strip, { scrollWidth: { value: 900 }, clientWidth: { value: 400 } })
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 395)
    act(() => nextFrame?.(16))
    expect(strip.scrollLeft).toBeGreaterThan(0)
    pointer(headers[0], 'move', 5)
    act(() => nextFrame?.(32))
    expect(strip.scrollLeft).toBe(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(cancelFrame).toHaveBeenCalledWith(42)
    const count = frames.mock.calls.length
    act(() => nextFrame?.(48))
    expect(frames).toHaveBeenCalledTimes(count)
  })

  it('retains keyboard reordering and explains it in the tooltip', () => {
    const onReorderTabs = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), onReorderTabs })
    const { headers } = layoutTabs()
    expect(headers[0]).toHaveAttribute('title', expect.stringContaining('Drag to reorder'))
    expect(headers[0]).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight')
    fireEvent.keyDown(headers[1], { key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(onReorderTabs).toHaveBeenLastCalledWith(['tab-two', 'tab-one', 'tab-three'])
    fireEvent.keyDown(headers[1], { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(onReorderTabs).toHaveBeenLastCalledWith(['tab-one', 'tab-three', 'tab-two'])
  })
})

function threeTabs(): QueryTabState[] {
  return [tabOne, tabTwo, { ...tabOne, id: 'tab-three', title: 'Query 3.sql' }]
}

function layoutTabs() {
  const strip = screen.getByRole('tablist')
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 35))
  const headers = screen.getAllByRole('tab')
  headers.forEach((header, index) => {
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(index * 100, 0, 100, 35))
  })
  return { strip, headers }
}

function pointer(target: HTMLElement, phase: 'down' | 'move' | 'up', x: number) {
  const dispatch = { down: fireEvent.pointerDown, move: fireEvent.pointerMove, up: fireEvent.pointerUp }[phase]
  dispatch(target, { pointerId: 1, button: 0, clientX: x, clientY: 15, isPrimary: true })
}

describe('EditorTabs environment accents', () => {
  it('keeps colors attached to environment identity across selection, reorder, and updates', () => {
    const { rerender } = renderEditorTabs({
      tabs: [tabOne, tabTwo],
      activeTabId: tabOne.id,
      environments,
    })

    expectTabEnvironment('Query 1', 'env-one', '#ef4444', true)
    expectTabEnvironment('Query 2', 'env-two', '#22c55e', false)

    rerender(
      <EditorTabs
        {...defaultEditorTabsProps}
        tabs={[tabTwo, tabOne]}
        activeTabId={tabTwo.id}
        environments={[
          { ...environmentTwo, color: '#0ea5e9' },
          { ...environmentOne, color: '#f97316' },
        ]}
      />,
    )

    expectTabEnvironment('Query 1', 'env-one', '#f97316', false)
    expectTabEnvironment('Query 2', 'env-two', '#0ea5e9', true)

    rerender(
      <EditorTabs
        {...defaultEditorTabsProps}
        tabs={[{ ...tabOne, environmentId: 'env-two' }, tabTwo]}
        activeTabId={tabOne.id}
        environments={environments}
      />,
    )

    expectTabEnvironment('Query 1', 'env-two', '#22c55e', true)
  })

  it('does not apply a fallback or another tab color when an environment is missing', () => {
    renderEditorTabs({
      tabs: [tabOne, tabTwo],
      activeTabId: tabTwo.id,
      environments: [environmentOne],
    })

    expectTabEnvironment('Query 1', 'env-one', '#ef4444', false)
    const unresolvedTab = screen.getByRole('tab', { name: /Query 2/ })
    expect(unresolvedTab).toHaveClass('is-active')
    expect(unresolvedTab).not.toHaveClass('has-environment-color')
    expect(unresolvedTab.style.getPropertyValue('--tab-env-color')).toBe('')
    expect(unresolvedTab).not.toHaveAttribute('data-environment-id')
  })
})

describe('EditorTabs multi-window movement', () => {
  it('keeps native dragging gated to enabled, supported multi-window sessions', () => {
    const { rerender } = renderEditorTabs({ tabs: threeTabs(), multiWindowEnabled: true })
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('draggable', 'false')
    rerender(<EditorTabs {...defaultEditorTabsProps} tabs={threeTabs()} multiWindowEnabled crossWindowDragSupported />)
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('draggable', 'true')
  })

  it('reorders through native drag events and appends onto empty strip space', () => {
    const onReorderTabs = vi.fn()
    const onStartCrossWindowDrag = vi.fn()
    const onEndCrossWindowDrag = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), multiWindowEnabled: true, crossWindowDragSupported: true,
      onReorderTabs, onStartCrossWindowDrag, onEndCrossWindowDrag })
    const { headers, strip } = layoutTabs()
    const dataTransfer = tabDataTransfer()
    pointer(headers[0], 'down', 50)
    pointer(headers[0], 'move', 245)
    expect(headers[2]).toHaveClass('is-drop-before')
    nativeDrag(headers[0], 'dragstart', dataTransfer, 50)
    expect(headers[2]).not.toHaveClass('is-drop-before')
    fireEvent.pointerCancel(headers[0])
    nativeDrag(headers[2], 'dragover', dataTransfer, 285)
    expect(headers[2]).toHaveClass('is-drop-after')
    nativeDrag(headers[2], 'drop', dataTransfer, 285)
    expect(onReorderTabs).toHaveBeenLastCalledWith(['tab-two', 'tab-three', 'tab-one'])
    pointer(headers[0], 'up', 285)
    expect(onReorderTabs).toHaveBeenCalledTimes(1)
    nativeDrag(headers[0], 'dragend', dataTransfer, 285)
    expect(onStartCrossWindowDrag).toHaveBeenCalledWith(tabOne.id)
    expect(onEndCrossWindowDrag).toHaveBeenCalledWith(tabOne.id, 0, 0, true)
    nativeDrag(headers[1], 'dragstart', dataTransfer, 150)
    expect(nativeDrag(strip, 'dragover', dataTransfer, 390)).toBe(false)
    expect(headers[2]).toHaveClass('is-drop-after')
    nativeDrag(strip, 'drop', dataTransfer, 390)
    expect(onReorderTabs).toHaveBeenLastCalledWith(['tab-one', 'tab-three', 'tab-two'])
    expect(strip).not.toHaveClass('is-reordering')
  })

  it('ignores file drags but retains cross-window tab insertion', () => {
    const onDropCrossWindowTab = vi.fn()
    renderEditorTabs({ tabs: threeTabs(), multiWindowEnabled: true, crossWindowDragSupported: true, onDropCrossWindowTab })
    const { headers, strip } = layoutTabs()
    const fileData = { ...tabDataTransfer(), types: ['Files'] }
    expect(nativeDrag(strip, 'dragover', fileData, 390)).toBe(true)
    nativeDrag(strip, 'drop', fileData, 390)
    nativeDrag(headers[1], 'drop', fileData, 145)
    expect(onDropCrossWindowTab).not.toHaveBeenCalled()
    const foreignTab = tabDataTransfer('foreign-tab')
    nativeDrag(headers[1], 'dragover', foreignTab, 185)
    nativeDrag(headers[1], 'drop', foreignTab, 185)
    expect(onDropCrossWindowTab).toHaveBeenCalledExactlyOnceWith('tab-three')
  })

  it('offers accessible new, main, and existing-window move commands', () => {
    const onMoveTabToWindow = vi.fn()
    renderEditorTabs({
      tabs: [tabOne],
      activeTabId: tabOne.id,
      currentWindowId: 'editor-source',
      multiWindowEnabled: true,
      windowTargets: [
        { windowId: 'main', role: 'main', title: 'DataPad++', activeTabId: '', tabCount: 0 },
        { windowId: 'editor-target', role: 'editor', title: 'Orders', activeTabId: 'orders', tabCount: 1 },
      ],
      onMoveTabToWindow,
    })

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Query 1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /to the main window/i }))
    expect(onMoveTabToWindow).toHaveBeenCalledWith(tabOne.id, 'main')

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Query 1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /to window Orders/i }))
    expect(onMoveTabToWindow).toHaveBeenCalledWith(tabOne.id, 'editor-target')

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Query 1/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /to a new window/i }))
    expect(onMoveTabToWindow).toHaveBeenCalledWith(tabOne.id)
  })

  it('keeps administrative and running tabs from moving', () => {
    const settingsTab: QueryTabState = {
      ...tabOne,
      id: 'settings',
      title: 'Settings',
      tabKind: 'settings',
    }
    const { rerender } = renderEditorTabs({
      tabs: [settingsTab],
      activeTabId: settingsTab.id,
      multiWindowEnabled: true,
      onMoveTabToWindow: vi.fn(),
    })

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Settings/ }))
    expect(screen.getByRole('menuitem', { name: /to a new window/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /to a new window/i })).toHaveAttribute(
      'title',
      'Administrative tabs stay in the main DataPad++ window.',
    )

    rerender(
      <EditorTabs
        {...defaultEditorTabsProps}
        tabs={[{ ...tabOne, status: 'queued' }]}
        activeTabId={tabOne.id}
        multiWindowEnabled
        onMoveTabToWindow={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Query 1/ }))
    expect(screen.getByRole('menuitem', { name: /to a new window/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /to a new window/i })).toHaveAttribute(
      'title',
      'Cancel the running query or wait for it to finish before moving this tab.',
    )
  })

  it('opens the move commands from the keyboard context-menu shortcut', () => {
    renderEditorTabs({
      tabs: [tabOne],
      activeTabId: tabOne.id,
      multiWindowEnabled: true,
      onMoveTabToWindow: vi.fn(),
    })

    fireEvent.keyDown(screen.getByRole('tab', { name: /Query 1/ }), {
      key: 'F10',
      shiftKey: true,
    })

    expect(screen.getByRole('menuitem', { name: /to a new window/i })).toBeEnabled()
  })
})

function tabDataTransfer(tabId = '') {
  let value = tabId
  return {
    types: ['application/x-datapadplusplus-tab-id'],
    effectAllowed: 'none', dropEffect: 'none',
    setData: (_type: string, id: string) => { value = id },
    getData: () => value,
  }
}

function nativeDrag(target: HTMLElement, type: string, dataTransfer: ReturnType<typeof tabDataTransfer>, x: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 15 })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return fireEvent(target, event)
}

function renderEditorTabs(
  overrides: Partial<Parameters<typeof EditorTabs>[0]> = {},
) {
  return render(<EditorTabs {...defaultEditorTabsProps} {...overrides} />)
}

function expectTabEnvironment(
  title: string,
  environmentId: string,
  color: string,
  active: boolean,
) {
  const renderedTab = screen.getByRole('tab', { name: new RegExp(title) })
  expect(renderedTab).toHaveAttribute('data-environment-id', environmentId)
  expect(renderedTab).toHaveClass('has-environment-color')
  if (active) {
    expect(renderedTab).toHaveClass('is-active')
  } else {
    expect(renderedTab).not.toHaveClass('is-active')
  }
  expect(renderedTab.style.getPropertyValue('--tab-env-color')).toBe(color)
}

const tabOne: QueryTabState = {
  id: 'tab-one',
  title: 'Query 1.sql',
  connectionId: 'conn-one',
  environmentId: 'env-one',
  family: 'sql',
  language: 'sql',
  editorLabel: 'SQL editor',
  queryText: 'select 1;',
  status: 'idle',
  dirty: false,
  history: [],
}

const tabTwo: QueryTabState = {
  ...tabOne,
  id: 'tab-two',
  title: 'Query 2.sql',
  connectionId: 'conn-two',
  environmentId: 'env-two',
  queryText: 'select 2;',
}

const environmentOne: EnvironmentProfile = {
  id: 'env-one',
  label: 'Development',
  color: '#ef4444',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: true,
  exportable: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const environmentTwo: EnvironmentProfile = {
  ...environmentOne,
  id: 'env-two',
  label: 'Production',
  color: '#22c55e',
  risk: 'high',
}

const environments = [environmentOne, environmentTwo]

const connectionOne: ConnectionProfile = {
  id: 'conn-one',
  name: 'Primary SQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'app',
  environmentIds: ['env-one'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PG',
  auth: {},
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const connectionTwo: ConnectionProfile = {
  ...connectionOne,
  id: 'conn-two',
  name: 'Secondary SQL',
  environmentIds: ['env-two'],
}

const defaultEditorTabsProps: Parameters<typeof EditorTabs>[0] = {
  tabs: [],
  activeTabId: '',
  connections: [connectionOne, connectionTwo],
  environments: [],
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onRenameTab: vi.fn(),
  onSaveTab: vi.fn(),
  onReorderTabs: vi.fn(),
  onCloseTabs: vi.fn(),
}
