import { fireEvent, render, screen } from '@testing-library/react'
import type { QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { EditorTabContextMenu } from '../../../../../src/app/components/workbench/editor-tabs/EditorTabContextMenu'

describe('EditorTabContextMenu', () => {
  it('keeps running tabs out of bulk close operations', () => {
    const onCloseTabs = vi.fn()

    render(
      <EditorTabContextMenu
        contextTab={queryTab('tab-idle')}
        contextTabIndex={1}
        orderedTabIds={['tab-running-left', 'tab-idle', 'tab-running-right']}
        lockedTabIds={['tab-running-left', 'tab-running-right']}
        tabsLength={3}
        x={0}
        y={0}
        onBeginRename={vi.fn()}
        onCloseMenu={vi.fn()}
        onCloseTab={vi.fn()}
        onCloseTabs={onCloseTabs}
        onMoveTabRelative={vi.fn()}
        onMoveTabToEdge={vi.fn()}
        onSaveTab={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))

    expect(onCloseTabs).toHaveBeenCalledWith(['tab-idle'])
  })

  it('disables direct close for a running tab', () => {
    render(
      <EditorTabContextMenu
        contextTab={queryTab('tab-running')}
        contextTabIndex={0}
        orderedTabIds={['tab-running']}
        lockedTabIds={['tab-running']}
        tabsLength={1}
        x={0}
        y={0}
        onBeginRename={vi.fn()}
        onCloseMenu={vi.fn()}
        onCloseTab={vi.fn()}
        onCloseTabs={vi.fn()}
        onMoveTabRelative={vi.fn()}
        onMoveTabToEdge={vi.fn()}
        onSaveTab={vi.fn()}
      />,
    )

    expect(screen.getByRole('menuitem', { name: 'Close tab Query' })).toBeDisabled()
  })
})

function queryTab(id: string): QueryTabState {
  return {
    id,
    connectionId: 'connection',
    environmentId: 'environment',
    title: 'Query',
    editorLabel: 'SQL query',
    language: 'sql',
    queryText: 'select 1',
    status: 'idle',
    dirty: false,
    pinned: false,
    history: [],
  }
}
