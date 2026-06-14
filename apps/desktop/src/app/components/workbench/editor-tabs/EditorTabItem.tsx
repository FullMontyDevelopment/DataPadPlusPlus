import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
} from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { DatastoreIcon } from '../DatastoreIcon'
import { CloseIcon, DatabaseIcon, EnvironmentsIcon, ObjectServerIcon, RefreshIcon, SettingsIcon, WarningIcon } from '../icons'
import { colorWithAlpha, normalizeTabDisplayTitle } from './tab-title'

export interface EditorTabDropTarget {
  tabId: string
  placement: 'before' | 'after'
}

interface EditorTabItemProps {
  active: boolean
  connection?: ConnectionProfile
  draftTitle: string
  draggingTabId?: string
  dropTarget?: EditorTabDropTarget
  editing: boolean
  environment?: EnvironmentProfile
  tab: QueryTabState
  tabRef(element: HTMLDivElement | null): void
  onBeginRename(tab: QueryTabState): void
  onCancelRename(): void
  onCloseTab(tabId: string): void
  onCommitRename(tab: QueryTabState): void
  onContextMenu(event: MouseEvent<HTMLDivElement>, tab: QueryTabState): void
  onDraftTitleChange(title: string): void
  onDragEnd(): void
  onDragLeave(tabId: string): void
  onDragOver(event: DragEvent<HTMLDivElement>, tab: QueryTabState): void
  onDragStart(event: DragEvent<HTMLDivElement>, tab: QueryTabState): void
  onDrop(event: DragEvent<HTMLDivElement>, tab: QueryTabState): void
  onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, tab: QueryTabState): void
  onSelectTab(tabId: string): void
}

export function EditorTabItem({
  active,
  connection,
  draftTitle,
  draggingTabId,
  dropTarget,
  editing,
  environment,
  tab,
  tabRef,
  onBeginRename,
  onCancelRename,
  onCloseTab,
  onCommitRename,
  onContextMenu,
  onDraftTitleChange,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onKeyDown,
  onSelectTab,
}: EditorTabItemProps) {
  const environmentColor = environment?.color ?? '#3794ff'
  const tabStyle = {
    '--tab-env-color': environmentColor,
    '--tab-env-tint': colorWithAlpha(environmentColor, 0.16),
  } as CSSProperties
  const tabCanBeSaved =
    tab.tabKind !== 'explorer' &&
    tab.tabKind !== 'metrics' &&
    tab.tabKind !== 'object-view' &&
    tab.tabKind !== 'settings' &&
    tab.tabKind !== 'api-server'
  const tabRunning = Boolean(tab.activeExecution) || tab.status === 'queued' || tab.status === 'running'
  const showUnsavedChanges = tabCanBeSaved && tab.dirty && !tabRunning
  const connectionName =
    tab.tabKind === 'settings'
      ? 'Workspace settings'
      : tab.tabKind === 'api-server'
      ? 'API server'
      : tab.tabKind === 'environment'
      ? 'Workspace environment'
      : connection?.name ?? 'Unknown connection'
  const environmentName = environment?.label ?? 'No environment'
  const tooltip = `${tab.title}\nConnection: ${connectionName}\nEnvironment: ${environmentName}${
    tabRunning
      ? `\nStatus: ${tab.activeExecution?.phase ?? tab.status}`
      : ''
  }${
    tab.status === 'error' || tab.status === 'blocked'
      ? `\nStatus: ${tab.status}${tab.error?.message ? ` - ${tab.error.message}` : ''}`
      : ''
  }${
    tabCanBeSaved && tab.dirty ? '\nUnsaved changes' : ''
  }`
  const dropBefore = dropTarget?.tabId === tab.id && dropTarget.placement === 'before'
  const dropAfter = dropTarget?.tabId === tab.id && dropTarget.placement === 'after'
  const tabFailed = tab.status === 'error' || tab.status === 'blocked'

  return (
    <div
      ref={tabRef}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      draggable={!editing}
      className={`editor-tab${active ? ' is-active' : ''}${active && environment ? ' has-environment-color' : ''}${draggingTabId === tab.id ? ' is-dragging' : ''}${dropBefore ? ' is-drop-before' : ''}${dropAfter ? ' is-drop-after' : ''}${tabRunning ? ' is-running' : ''}${tabFailed ? ' is-error' : ''}`}
      style={tabStyle}
      title={tooltip}
      onClick={() => onSelectTab(tab.id)}
      onContextMenu={(event) => onContextMenu(event, tab)}
      onDoubleClick={() => onBeginRename(tab)}
      onDragStart={(event) => onDragStart(event, tab)}
      onDragOver={(event) => onDragOver(event, tab)}
      onDragLeave={() => onDragLeave(tab.id)}
      onDrop={(event) => onDrop(event, tab)}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => onKeyDown(event, tab)}
    >
      {tab.tabKind === 'settings' ? (
        <SettingsIcon
          className="editor-tab-fallback-icon"
          aria-label="Settings icon"
        />
      ) : tab.tabKind === 'api-server' ? (
        <ObjectServerIcon
          className="editor-tab-fallback-icon"
          aria-label="API Server icon"
        />
      ) : tab.tabKind === 'environment' ? (
        <EnvironmentsIcon
          className="editor-tab-fallback-icon"
          aria-label="Environment icon"
        />
      ) : connection ? (
        <DatastoreIcon
          className="editor-tab-datastore-icon"
          decorative={false}
          engine={connection.engine}
          label={`${connection.name} datastore icon`}
        />
      ) : (
        <DatabaseIcon
          className="editor-tab-fallback-icon"
          aria-label="Datastore icon"
        />
      )}
      {editing ? (
        <input
          aria-label={`Rename tab ${tab.title}`}
          autoFocus
          className="editor-tab-title-input"
          value={draftTitle}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onDraftTitleChange(event.target.value)}
          onBlur={() => onCommitRename(tab)}
          onKeyDown={(event) => {
            event.stopPropagation()

            if (event.key === 'Enter') {
              event.preventDefault()
              onCommitRename(tab)
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              onCancelRename()
            }
          }}
        />
      ) : (
        <span className="editor-tab-label">{normalizeTabDisplayTitle(tab.title)}</span>
      )}
      {showUnsavedChanges ? (
        <span className="editor-tab-dirty" title="Unsaved changes" aria-hidden="true" />
      ) : null}
      <EditorTabStatusIcon tab={tab} running={tabRunning} />
      {tab.pinned ? (
        <span className="editor-tab-pin" title="Pinned tab" aria-label="Pinned tab">
          Pinned
        </span>
      ) : null}
      <button
        type="button"
        className="editor-tab-close-button"
        aria-label={`Close tab ${tab.title}`}
        title={
          tabCanBeSaved && tab.savedQueryId && tab.dirty
            ? 'Close this saved query tab. You will be asked whether to save changes first.'
            : 'Close this tab and keep a recovery copy in closed tab history.'
        }
        onClick={(event) => {
          event.stopPropagation()
          onCloseTab(tab.id)
        }}
      >
        <CloseIcon className="editor-tab-close" />
      </button>
    </div>
  )
}

function EditorTabStatusIcon({
  running,
  tab,
}: {
  running: boolean
  tab: QueryTabState
}) {
  if (running) {
    const phase = tab.activeExecution?.phase
    return (
      <span
        className="editor-tab-status-icon editor-tab-status-icon--running"
        aria-label={phase === 'rendering' ? 'Query rendering' : tab.status === 'queued' ? 'Query queued' : 'Query running'}
        role="img"
      >
        <RefreshIcon className="editor-tab-status-svg" />
      </span>
    )
  }

  if (tab.status === 'error' || tab.status === 'blocked') {
    return (
      <span
        className="editor-tab-status-icon editor-tab-status-icon--error"
        aria-label={tab.status === 'blocked' ? 'Query blocked' : 'Query error'}
        role="img"
      >
        <WarningIcon className="editor-tab-status-svg" />
      </span>
    )
  }

  return null
}
