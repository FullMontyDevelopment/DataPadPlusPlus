import type { QueryTabState, WorkspaceWindowTarget } from '@datapadplusplus/shared-types'
import { tabCanDetach } from '../../../state/workspace-migration'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  MoveFirstIcon,
  MoveLastIcon,
  RenameIcon,
  SaveIcon,
} from '../icons'

interface EditorTabContextMenuProps {
  contextTab: QueryTabState
  contextTabIndex: number
  orderedTabIds: string[]
  lockedTabIds?: string[]
  currentWindowId?: string
  multiWindowEnabled?: boolean
  windowTargets?: WorkspaceWindowTarget[]
  tabsLength: number
  x: number
  y: number
  onBeginRename(tab: QueryTabState): void
  onCloseMenu(): void
  onCloseTab(tabId: string): void
  onCloseTabs(tabIds: string[]): void
  onMoveTabRelative(tabId: string, direction: 'left' | 'right'): void
  onMoveTabToEdge(tabId: string, edge: 'first' | 'last'): void
  onMoveTabToWindow?(tabId: string, destinationWindowId?: string): void
  onSaveTab(tabId: string): void
}

export function EditorTabContextMenu({
  contextTab,
  contextTabIndex,
  orderedTabIds,
  lockedTabIds = [],
  currentWindowId = 'main',
  multiWindowEnabled = false,
  windowTargets = [],
  tabsLength,
  x,
  y,
  onBeginRename,
  onCloseMenu,
  onCloseTab,
  onCloseTabs,
  onMoveTabRelative,
  onMoveTabToEdge,
  onMoveTabToWindow,
  onSaveTab,
}: EditorTabContextMenuProps) {
  const run = (action: () => void) => {
    onCloseMenu()
    action()
  }
  const canSaveTab =
    contextTab.tabKind !== 'explorer' &&
    contextTab.tabKind !== 'metrics' &&
    contextTab.tabKind !== 'object-view'
  const lockedTabs = new Set(lockedTabIds)
  const contextTabLocked = lockedTabs.has(contextTab.id)
  const canMoveAcrossWindows = multiWindowEnabled && tabCanDetach(contextTab)
  const moveDisabledReason = contextTabLocked
    ? 'Cancel the running query or wait for it to finish before moving this tab.'
    : !tabCanDetach(contextTab)
      ? 'Administrative tabs stay in the main DataPad++ window.'
      : !multiWindowEnabled
        ? 'Enable the experimental Multi-window Tabs plugin in Settings.'
        : undefined
  const closeOtherTabIds = orderedTabIds.filter(
    (tabId) => tabId !== contextTab.id,
  )
  const closeRightTabIds = orderedTabIds.slice(contextTabIndex + 1)
  const closeAllTabIds = orderedTabIds

  return (
    <div
      className="editor-tab-context-menu"
      role="menu"
      aria-label={`Tab options for ${contextTab.title}`}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Close tab ${contextTab.title}`}
        disabled={contextTabLocked}
        title={
          contextTabLocked
            ? 'Cancel the running query or wait for it to finish before closing this tab.'
            : undefined
        }
        onClick={() => run(() => onCloseTab(contextTab.id))}
      >
        <CloseIcon className="editor-tab-context-menu-icon" />
        <span>Close</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Close other tabs except ${contextTab.title}`}
        disabled={closeOtherTabIds.length === 0}
        onClick={() =>
          run(() => onCloseTabs(closeOtherTabIds))
        }
      >
        <CloseIcon className="editor-tab-context-menu-icon" />
        <span>Close Others</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Close tabs to the right of ${contextTab.title}`}
        disabled={closeRightTabIds.length === 0}
        onClick={() => run(() => onCloseTabs(closeRightTabIds))}
      >
        <ArrowRightIcon className="editor-tab-context-menu-icon" />
        <span>Close Tabs to the Right</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label="Close all tabs"
        disabled={closeAllTabIds.length === 0}
        onClick={() => run(() => onCloseTabs(closeAllTabIds))}
      >
        <CloseIcon className="editor-tab-context-menu-icon" />
        <span>Close All</span>
      </button>
      <div className="editor-tab-context-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Rename tab ${contextTab.title}`}
        onClick={() => run(() => onBeginRename(contextTab))}
      >
        <RenameIcon className="editor-tab-context-menu-icon" />
        <span>Rename</span>
      </button>
      {canSaveTab ? (
        <button
          type="button"
          role="menuitem"
          className="editor-tab-context-menu-item"
          aria-label={`Save tab ${contextTab.title}`}
          onClick={() => run(() => onSaveTab(contextTab.id))}
        >
          <SaveIcon className="editor-tab-context-menu-icon" />
          <span>Save</span>
        </button>
      ) : null}
      <div className="editor-tab-context-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Move tab ${contextTab.title} left`}
        disabled={contextTabIndex <= 0}
        onClick={() => run(() => onMoveTabRelative(contextTab.id, 'left'))}
      >
        <ArrowLeftIcon className="editor-tab-context-menu-icon" />
        <span>Move Left</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Move tab ${contextTab.title} right`}
        disabled={contextTabIndex < 0 || contextTabIndex >= tabsLength - 1}
        onClick={() => run(() => onMoveTabRelative(contextTab.id, 'right'))}
      >
        <ArrowRightIcon className="editor-tab-context-menu-icon" />
        <span>Move Right</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Move tab ${contextTab.title} first`}
        disabled={contextTabIndex <= 0}
        onClick={() => run(() => onMoveTabToEdge(contextTab.id, 'first'))}
      >
        <MoveFirstIcon className="editor-tab-context-menu-icon" />
        <span>Move First</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label={`Move tab ${contextTab.title} last`}
        disabled={contextTabIndex < 0 || contextTabIndex >= tabsLength - 1}
        onClick={() => run(() => onMoveTabToEdge(contextTab.id, 'last'))}
      >
        <MoveLastIcon className="editor-tab-context-menu-icon" />
        <span>Move Last</span>
      </button>
      {onMoveTabToWindow ? (
        <>
          <div className="editor-tab-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="editor-tab-context-menu-item"
            aria-label={`Move tab ${contextTab.title} to a new window`}
            disabled={!canMoveAcrossWindows || contextTabLocked}
            title={moveDisabledReason}
            onClick={() => run(() => onMoveTabToWindow(contextTab.id))}
          >
            <ArrowRightIcon className="editor-tab-context-menu-icon" />
            <span>Move to New Window</span>
          </button>
          {currentWindowId !== 'main' ? (
            <button
              type="button"
              role="menuitem"
              className="editor-tab-context-menu-item"
              aria-label={`Move tab ${contextTab.title} to the main window`}
              disabled={!canMoveAcrossWindows || contextTabLocked}
              title={moveDisabledReason}
              onClick={() => run(() => onMoveTabToWindow(contextTab.id, 'main'))}
            >
              <ArrowLeftIcon className="editor-tab-context-menu-icon" />
              <span>Move to Main Window</span>
            </button>
          ) : null}
          {windowTargets
            .filter((target) => target.windowId !== currentWindowId && target.windowId !== 'main')
            .map((target) => (
              <button
                key={target.windowId}
                type="button"
                role="menuitem"
                className="editor-tab-context-menu-item"
                aria-label={`Move tab ${contextTab.title} to window ${target.title}`}
                disabled={!canMoveAcrossWindows || contextTabLocked}
                title={moveDisabledReason}
                onClick={() => run(() => onMoveTabToWindow(contextTab.id, target.windowId))}
              >
                <ArrowRightIcon className="editor-tab-context-menu-icon" />
                <span>{`Move to Window: ${target.title}`}</span>
              </button>
            ))}
        </>
      ) : null}
    </div>
  )
}
