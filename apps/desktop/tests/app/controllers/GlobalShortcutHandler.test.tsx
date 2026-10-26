import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GlobalShortcutHandler } from '../../../src/app/controllers/GlobalShortcutHandler'
import type { GlobalShortcutHandlerProps } from '../../../src/app/controllers/GlobalShortcutHandler'
import { defaultKeyboardShortcuts } from '../../../src/app/keyboard-shortcuts'
import { createBlankSnapshot } from '../../../src/app/data/workspace-factory'

function props(): GlobalShortcutHandlerProps {
  return { actions: { updateUiState: vi.fn(), reopenClosedTab: vi.fn() },
    activeTab: { id: 'test', title: 'Test', connectionId: 'test', environmentId: 'test', family: 'sql', language: 'sql',
      editorLabel: 'Test', queryText: 'select 1', status: 'idle', dirty: false, history: [] },
    activeTabIsEnvironment: false, activeTabIsApiServer: false, activeTabIsMcpServer: false,
    activeTabIsSecurityChecks: false, activeTabIsExplorer: false, activeTabIsMetrics: false,
    activeTabIsObjectView: false, activeTabIsSettings: false, activeTabIsTestSuite: false, activeTabIsWorkspaceSearch: false,
    bottomPanelVisibleRef: { current: true }, keyboardShortcuts: defaultKeyboardShortcuts() as GlobalShortcutHandlerProps['keyboardShortcuts'],
    openQueryTab: vi.fn(), requestCloseTab: vi.fn(), requestSaveQuery: vi.fn(), runCurrentTabQuery: vi.fn(), snapshot: createBlankSnapshot() }
}

describe('local keyboard scope', () => {
  it.each([['Space', ' '], ['ArrowUp', 'ArrowUp'], ['Enter', 'Enter'], ['Escape', 'Escape']])('does not run a remapped %s shortcut inside local controls', (shortcut, key) => {
    const current = props()
    current.keyboardShortcuts.runQuery = shortcut
    render(<><GlobalShortcutHandler {...current} />
      <section data-local-shortcut-keys="Space ArrowUp Enter Escape"><button>Local action</button></section>
      <button>Ordinary action</button></>)
    fireEvent.keyDown(screen.getByText('Local action'), { key })
    expect(current.runCurrentTabQuery).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByText('Ordinary action'), { key })
    expect(current.runCurrentTabQuery).toHaveBeenCalledOnce()
  })

  it('preserves modified Run and other application shortcuts', () => {
    const current = props()
    render(<><GlobalShortcutHandler {...current} /><button data-local-shortcut-keys="Space ArrowUp Enter Escape">Local action</button></>)
    const target = screen.getByText('Local action')
    fireEvent.keyDown(target, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(target, { key: 's', ctrlKey: true })
    fireEvent.keyDown(target, { key: 'F5' })
    expect(current.runCurrentTabQuery).toHaveBeenCalledTimes(2)
    expect(current.requestSaveQuery).toHaveBeenCalledWith('test')
  })
})
