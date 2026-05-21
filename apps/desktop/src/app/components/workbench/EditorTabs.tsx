import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { EditorTabContextMenu } from './editor-tabs/EditorTabContextMenu'
import { EditorTabItem, type EditorTabDropTarget } from './editor-tabs/EditorTabItem'
import { useTabStripScroll } from './editor-tabs/useTabStripScroll'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
} from './icons'

interface TabContextMenuState {
  tabId: string
  x: number
  y: number
}

interface EditorTabsProps {
  tabs: QueryTabState[]
  activeTabId: string
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  onSelectTab(tabId: string): void
  onCloseTab(tabId: string): void
  onRenameTab(tabId: string, title: string): void
  onSaveTab(tabId: string): void
  onReorderTabs(orderedTabIds: string[]): void
  onCloseTabs(tabIds: string[]): void
}

export function EditorTabs({
  tabs,
  activeTabId,
  connections,
  environments,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onSaveTab,
  onReorderTabs,
  onCloseTabs,
}: EditorTabsProps) {
  const [editingTabId, setEditingTabId] = useState<string>()
  const [draftTitle, setDraftTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<TabContextMenuState>()
  const [draggingTabId, setDraggingTabId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<EditorTabDropTarget>()
  const stripRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const { scrollState, scrollTabs, scrollTabsOnWheel } = useTabStripScroll(stripRef, tabs.length)

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeContextMenu = () => setContextMenu(undefined)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', closeContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeContextMenu)
    return () => {
      window.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeContextMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    const activeTab = tabRefs.current.get(activeTabId)

    activeTab?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTabId, tabs])

  const beginRename = (tab: QueryTabState) => {
    setEditingTabId(tab.id)
    setDraftTitle(tab.title)
    onSelectTab(tab.id)
  }

  const commitRename = (tab: QueryTabState) => {
    const nextTitle = draftTitle.trim()
    setEditingTabId(undefined)

    if (nextTitle && nextTitle !== tab.title) {
      onRenameTab(tab.id, nextTitle)
    }
  }

  const openContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    tab: QueryTabState,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectTab(tab.id)
    setContextMenu({
      tabId: tab.id,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const orderedTabIds = tabs.map((tab) => tab.id)

  const moveTab = (tabId: string, targetIndex: number) => {
    const sourceIndex = orderedTabIds.indexOf(tabId)

    if (sourceIndex < 0) {
      return
    }

    const nextOrder = [...orderedTabIds]
    const [movedTabId] = nextOrder.splice(sourceIndex, 1)

    if (!movedTabId) {
      return
    }

    const clampedTargetIndex = Math.min(
      Math.max(targetIndex, 0),
      nextOrder.length,
    )
    nextOrder.splice(clampedTargetIndex, 0, movedTabId)

    if (nextOrder.some((id, index) => id !== orderedTabIds[index])) {
      onReorderTabs(nextOrder)
    }
  }

  const moveTabRelative = (tabId: string, direction: 'left' | 'right') => {
    const index = orderedTabIds.indexOf(tabId)

    if (index < 0) {
      return
    }

    moveTab(tabId, direction === 'left' ? index - 1 : index + 1)
  }

  const moveTabToEdge = (tabId: string, edge: 'first' | 'last') => {
    moveTab(tabId, edge === 'first' ? 0 : orderedTabIds.length - 1)
  }

  const dropTab = (
    event: DragEvent<HTMLDivElement>,
    targetTab: QueryTabState,
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const sourceTabId =
      draggingTabId || event.dataTransfer.getData('application/x-datapadplusplus-tab-id')

    setDraggingTabId(undefined)
    setDropTarget(undefined)

    if (!sourceTabId || sourceTabId === targetTab.id) {
      return
    }

    const sourceIndex = orderedTabIds.indexOf(sourceTabId)
    const targetIndex = orderedTabIds.indexOf(targetTab.id)

    if (sourceIndex < 0 || targetIndex < 0) {
      return
    }

    const placement = dropPlacement(event)
    const adjustedTargetIndex =
      placement === 'after' && sourceIndex > targetIndex
        ? targetIndex + 1
        : placement === 'after'
          ? targetIndex
          : sourceIndex < targetIndex
            ? targetIndex - 1
            : targetIndex

    moveTab(sourceTabId, adjustedTargetIndex)
  }

  const tabKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    tab: QueryTabState,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectTab(tab.id)
    }

    if (event.key === 'F2') {
      event.preventDefault()
      beginRename(tab)
    }

    if (event.altKey && event.shiftKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      moveTabRelative(tab.id, 'left')
    }

    if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
      event.preventDefault()
      moveTabRelative(tab.id, 'right')
    }
  }

  const contextTab = contextMenu
    ? tabs.find((tab) => tab.id === contextMenu.tabId)
    : undefined
  const contextTabIndex = contextTab ? orderedTabIds.indexOf(contextTab.id) : -1

  return (
    <div className="editor-tabs-shell">
      <button
        type="button"
        className="editor-tab-scroll-button"
        aria-label="Scroll tabs left"
        title="Scroll tabs left"
        disabled={!scrollState.canScrollLeft}
        onClick={() => scrollTabs('left')}
      >
        <ArrowLeftIcon className="editor-tab-scroll-icon" />
      </button>

      <div
        ref={stripRef}
        className="editor-tabs"
        role="tablist"
        aria-label="Editor tabs"
        onWheel={scrollTabsOnWheel}
      >
        {tabs.map((tab) => {
          const connection = connections.find((item) => item.id === tab.connectionId)
          const environment = environments.find((item) => item.id === tab.environmentId)

          return (
            <EditorTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              connection={connection}
              draftTitle={draftTitle}
              draggingTabId={draggingTabId}
              dropTarget={dropTarget}
              editing={editingTabId === tab.id}
              environment={environment}
              tabRef={(element) => {
                if (element) {
                  tabRefs.current.set(tab.id, element)
                } else {
                  tabRefs.current.delete(tab.id)
                }
              }}
              onBeginRename={beginRename}
              onCancelRename={() => setEditingTabId(undefined)}
              onCloseTab={onCloseTab}
              onCommitRename={commitRename}
              onContextMenu={openContextMenu}
              onDraftTitleChange={setDraftTitle}
              onDragEnd={() => {
                setDraggingTabId(undefined)
                setDropTarget(undefined)
              }}
              onDragLeave={(tabId) => {
                if (dropTarget?.tabId === tabId) {
                  setDropTarget(undefined)
                }
              }}
              onDragOver={(event, targetTab) => {
                if (!draggingTabId || draggingTabId === targetTab.id) {
                  return
                }

                event.preventDefault()
                setDropTarget({
                  tabId: targetTab.id,
                  placement: dropPlacement(event),
                })
              }}
              onDragStart={(event) => {
                setDraggingTabId(tab.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-datapadplusplus-tab-id', tab.id)
              }}
              onDrop={dropTab}
              onKeyDown={tabKeyDown}
              onSelectTab={onSelectTab}
            />
          )
        })}
      </div>

      <button
        type="button"
        className="editor-tab-scroll-button"
        aria-label="Scroll tabs right"
        title="Scroll tabs right"
        disabled={!scrollState.canScrollRight}
        onClick={() => scrollTabs('right')}
      >
        <ArrowRightIcon className="editor-tab-scroll-icon" />
      </button>

      {contextMenu && contextTab ? (
        <EditorTabContextMenu
          contextTab={contextTab}
          contextTabIndex={contextTabIndex}
          orderedTabIds={orderedTabIds}
          tabsLength={tabs.length}
          x={contextMenu.x}
          y={contextMenu.y}
          onBeginRename={beginRename}
          onCloseMenu={() => setContextMenu(undefined)}
          onCloseTab={onCloseTab}
          onCloseTabs={onCloseTabs}
          onMoveTabRelative={moveTabRelative}
          onMoveTabToEdge={moveTabToEdge}
          onSaveTab={onSaveTab}
        />
      ) : null}
    </div>
  )
}

function dropPlacement(event: DragEvent<HTMLDivElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientX > rect.left + rect.width / 2 ? 'after' : 'before'
}
