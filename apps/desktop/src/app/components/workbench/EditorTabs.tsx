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
  WorkspaceWindowTarget,
} from '@datapadplusplus/shared-types'
import { EditorTabContextMenu } from './editor-tabs/EditorTabContextMenu'
import { EditorTabItem, type EditorTabDropTarget } from './editor-tabs/EditorTabItem'
import { useTabStripScroll } from './editor-tabs/useTabStripScroll'
import { useTabPointerReorder } from './editor-tabs/useTabPointerReorder'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
} from './icons'

interface TabContextMenuState {
  originElement?: HTMLElement | null
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
  currentWindowId?: string
  multiWindowEnabled?: boolean
  crossWindowDragSupported?: boolean
  windowTargets?: WorkspaceWindowTarget[]
  onMoveTabToWindow?(tabId: string, destinationWindowId?: string): void
  onStartCrossWindowDrag?(tabId: string): void
  onDropCrossWindowTab?(beforeTabId?: string): void
  onEndCrossWindowDrag?(tabId: string, x: number, y: number, dropped: boolean): void
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
  currentWindowId = 'main',
  multiWindowEnabled = false,
  crossWindowDragSupported = false,
  windowTargets = [],
  onMoveTabToWindow,
  onStartCrossWindowDrag,
  onDropCrossWindowTab,
  onEndCrossWindowDrag,
}: EditorTabsProps) {
  const [editingTabId, setEditingTabId] = useState<string>()
  const [draftTitle, setDraftTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<TabContextMenuState>()
  const [draggingTabId, setDraggingTabId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<EditorTabDropTarget>()
  const stripRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const nativeDraggable = multiWindowEnabled && crossWindowDragSupported
  const pointerReorder = useTabPointerReorder(
    stripRef, tabRefs, tabs.map((tab) => tab.id), onReorderTabs,
  )
  const { scrollState, scrollTabs, scrollTabsOnWheel } = useTabStripScroll(stripRef, tabs.length)
  const environmentsById = new Map(
    environments.map((environment) => [environment.id, environment]),
  )

  useEffect(() => {
    // Background execution updates must not pull the strip away from a drag target.
    if (draggingTabId || pointerReorder.draggingTabId) return
    const activeTab = tabRefs.current.get(activeTabId)

    activeTab?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTabId, tabs, draggingTabId, pointerReorder.draggingTabId])

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
      originElement: event.currentTarget,
      tabId: tab.id,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const orderedTabIds = tabs.map((tab) => tab.id)
  const lockedTabIds = tabs
    .filter((tab) =>
      Boolean(tab.activeExecution) || tab.status === 'running' || tab.status === 'queued')
    .map((tab) => tab.id)

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
    if (!draggingTabId && (!nativeDraggable
      || !event.dataTransfer.types.includes('application/x-datapadplusplus-tab-id'))) return
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

    if (sourceIndex < 0) {
      const placement = dropPlacement(event)
      onDropCrossWindowTab?.(
        placement === 'before' ? targetTab.id : orderedTabIds[targetIndex + 1],
      )
      return
    }

    if (targetIndex < 0) {
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
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const bounds = tabRefs.current.get(tab.id)?.getBoundingClientRect()
      setContextMenu({
        originElement: event.currentTarget,
        tabId: tab.id,
        x: bounds?.left ?? 0,
        y: bounds?.bottom ?? 0,
      })
      return
    }

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
    <div className="editor-tabs-shell" data-tour-id="editor-tabs">
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
        className={`editor-tabs${draggingTabId || pointerReorder.draggingTabId ? ' is-reordering' : ''}`}
        role="tablist"
        aria-label="Editor tabs"
        onWheel={scrollTabsOnWheel}
        onDragOver={(event) => {
          if (!draggingTabId && (!nativeDraggable
            || !event.dataTransfer.types.includes('application/x-datapadplusplus-tab-id'))) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const lastTab = tabs.at(-1)
          if (event.target === event.currentTarget && lastTab) {
            setDropTarget({ tabId: lastTab.id, placement: 'after' })
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget(undefined)
          }
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (!draggingTabId && (!nativeDraggable
            || !event.dataTransfer.types.includes('application/x-datapadplusplus-tab-id'))) return
          event.preventDefault()
          if (draggingTabId) {
            moveTab(draggingTabId, orderedTabIds.length - 1)
          } else {
            onDropCrossWindowTab?.()
          }
          setDraggingTabId(undefined)
          setDropTarget(undefined)
        }}
      >
        {tabs.map((tab) => {
          const connection = connections.find((item) => item.id === tab.connectionId)
          const environment = environmentsById.get(tab.environmentId)

          return (
            <EditorTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              connection={connection}
              draftTitle={draftTitle}
              draggingTabId={pointerReorder.draggingTabId ?? draggingTabId}
              dropTarget={pointerReorder.dropTarget ?? dropTarget}
              editing={editingTabId === tab.id}
              nativeDraggable={nativeDraggable}
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
              onDragEnd={(event) => {
                setDraggingTabId(undefined)
                setDropTarget(undefined)
                onEndCrossWindowDrag?.(
                  tab.id,
                  event.screenX,
                  event.screenY,
                  event.dataTransfer.dropEffect !== 'none',
                )
              }}
              onDragLeave={(tabId) => {
                if (dropTarget?.tabId === tabId) {
                  setDropTarget(undefined)
                }
              }}
              onDragOver={(event, targetTab) => {
                if ((!draggingTabId && (!nativeDraggable
                  || !event.dataTransfer.types.includes('application/x-datapadplusplus-tab-id')))
                  || draggingTabId === targetTab.id) {
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget({
                  tabId: targetTab.id,
                  placement: dropPlacement(event),
                })
              }}
              onDragStart={(event) => {
                if (!nativeDraggable) {
                  event.preventDefault()
                  return
                }
                // Hand off only after the WebView actually starts a native drag.
                // Merely advertising support must not disable local pointer reordering.
                pointerReorder.cancel()
                setContextMenu(undefined)
                setDraggingTabId(tab.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-datapadplusplus-tab-id', tab.id)
                onStartCrossWindowDrag?.(tab.id)
              }}
              onDrop={dropTab}
              onKeyDown={tabKeyDown}
              onSelectTab={(tabId) => {
                if (!pointerReorder.suppressClick()) onSelectTab(tabId)
              }}
              onPointerDown={(event, tabId) => {
                setContextMenu(undefined)
                pointerReorder.onPointerDown(event, tabId)
              }}
              onPointerMove={pointerReorder.onPointerMove}
              onPointerUp={pointerReorder.onPointerUp}
              onPointerCancel={pointerReorder.cancel}
            />
          )
        })}
      </div>

      <span className="sr-only" aria-live="polite">{pointerReorder.announcement}</span>

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
          lockedTabIds={lockedTabIds}
          currentWindowId={currentWindowId}
          multiWindowEnabled={multiWindowEnabled}
          windowTargets={windowTargets}
          tabsLength={tabs.length}
          x={contextMenu.x}
          y={contextMenu.y}
          originElement={contextMenu.originElement}
          onBeginRename={beginRename}
          onCloseMenu={() => setContextMenu(undefined)}
          onCloseTab={onCloseTab}
          onCloseTabs={onCloseTabs}
          onMoveTabRelative={moveTabRelative}
          onMoveTabToEdge={moveTabToEdge}
          onMoveTabToWindow={onMoveTabToWindow}
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
