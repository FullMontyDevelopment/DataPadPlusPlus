import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { EditorTabs } from '../../../../../src/app/components/workbench/EditorTabs'

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
