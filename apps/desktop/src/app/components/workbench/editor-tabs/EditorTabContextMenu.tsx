import type { QueryTabState } from '@datapadplusplus/shared-types'
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
  tabsLength: number
  x: number
  y: number
  onBeginRename(tab: QueryTabState): void
  onCloseMenu(): void
  onCloseTab(tabId: string): void
  onCloseTabs(tabIds: string[]): void
  onMoveTabRelative(tabId: string, direction: 'left' | 'right'): void
  onMoveTabToEdge(tabId: string, edge: 'first' | 'last'): void
  onSaveTab(tabId: string): void
}

export function EditorTabContextMenu({
  contextTab,
  contextTabIndex,
  orderedTabIds,
  tabsLength,
  x,
  y,
  onBeginRename,
  onCloseMenu,
  onCloseTab,
  onCloseTabs,
  onMoveTabRelative,
  onMoveTabToEdge,
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
        disabled={tabsLength <= 1}
        onClick={() =>
          run(() => onCloseTabs(orderedTabIds.filter((tabId) => tabId !== contextTab.id)))
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
        disabled={contextTabIndex < 0 || contextTabIndex >= tabsLength - 1}
        onClick={() => run(() => onCloseTabs(orderedTabIds.slice(contextTabIndex + 1)))}
      >
        <ArrowRightIcon className="editor-tab-context-menu-icon" />
        <span>Close Tabs to the Right</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="editor-tab-context-menu-item"
        aria-label="Close all tabs"
        disabled={tabsLength === 0}
        onClick={() => run(() => onCloseTabs(orderedTabIds))}
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
    </div>
  )
}
