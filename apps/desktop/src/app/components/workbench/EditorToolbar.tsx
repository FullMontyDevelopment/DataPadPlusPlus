import type {
  ExecutionCapabilities,
  QueryBuilderState,
  QueryViewMode,
} from '@datapadplusplus/shared-types'
import {
  ExplainIcon,
  PanelIcon,
  ColumnIcon,
  ConsoleIcon,
  PlayIcon,
  SettingsIcon,
  StopIcon,
  TableIcon,
  JsonIcon,
  KeyValueIcon,
  ObjectDocumentIcon,
} from './icons'

type ResultsDock = 'bottom' | 'right'

interface EditorToolbarProps {
  executionStatus: 'idle' | 'loading' | 'ready'
  capabilities: ExecutionCapabilities
  canCancelExecution: boolean
  bottomPanelVisible: boolean
  resultsDock?: ResultsDock
  onExecute(): void
  onExplain(): void
  onCancel(): void
  onOpenConnectionDrawer(): void
  onToggleBottomPanel(): void
  onToggleResultsDock?(): void
  onAddDocument?(): void
  canToggleBuilderView: boolean
  canAddDocument?: boolean
  builderKind?: QueryBuilderState['kind']
  queryWindowMode: QueryViewMode
  onToggleQueryWindowMode(mode: QueryViewMode): void
  executeLabel?: string
  executeAriaLabel?: string
  executeTitle?: string
  executeDisabled?: boolean
}

export function EditorToolbar({
  executionStatus,
  capabilities,
  canCancelExecution,
  bottomPanelVisible,
  resultsDock = 'bottom',
  onExecute,
  onExplain,
  onCancel,
  onOpenConnectionDrawer,
  onToggleBottomPanel,
  onToggleResultsDock = noop,
  onAddDocument = noop,
  canToggleBuilderView,
  canAddDocument = false,
  builderKind,
  queryWindowMode,
  onToggleQueryWindowMode,
  executeLabel = 'Run',
  executeAriaLabel = 'Run query',
  executeTitle = 'Run the current query against the selected connection and environment. Shortcut: Ctrl+Enter.',
  executeDisabled = false,
}: EditorToolbarProps) {
  const queryWindowModeButtonLabels: Record<
    QueryViewMode,
    { icon: typeof PlayIcon; text: string }
  > = {
    builder: { icon: JsonIcon, text: 'Query Builder' },
    raw: { icon: TableIcon, text: 'Raw' },
    script: { icon: ConsoleIcon, text: 'Scripting' },
  }
  const redisModeButtonLabels: Record<
    QueryViewMode,
    { icon: typeof PlayIcon; text: string }
  > = {
    builder: { icon: KeyValueIcon, text: 'Key Browser' },
    raw: { icon: ConsoleIcon, text: 'Redis Console' },
    script: { icon: ConsoleIcon, text: 'Scripting' },
  }
  const modeLabels =
    builderKind === 'redis-key-browser'
      ? redisModeButtonLabels
      : queryWindowModeButtonLabels

  return (
    <div className="editor-toolbar" aria-label="Editor toolbar">
      <div className="toolbar-group" aria-label="Execution controls">
        <button
          type="button"
          className="toolbar-action toolbar-action--run"
          aria-label={executeAriaLabel}
          title={executeTitle}
          disabled={executionStatus === 'loading' || executeDisabled}
          onClick={onExecute}
        >
          <PlayIcon className="toolbar-icon" />
          <span>{executionStatus === 'loading' ? 'Running' : executeLabel}</span>
        </button>

        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Cancel query"
          title={
            canCancelExecution
              ? 'Cancel the currently running query for this tab.'
              : 'Cancel is unavailable until a supported datastore is running a cancellable query.'
          }
          disabled={!canCancelExecution}
          onClick={onCancel}
        >
          <StopIcon className="toolbar-icon" />
        </button>

        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Explain query"
          title={
            capabilities.canExplain
              ? 'Run an explain/plan request for the current query. Shortcut: Ctrl+Shift+E.'
              : 'Explain is not available for this datastore yet.'
          }
          disabled={!capabilities.canExplain}
          onClick={onExplain}
        >
          <ExplainIcon className="toolbar-icon" />
        </button>
      </div>

      {canToggleBuilderView ? (
        <div className="toolbar-group toolbar-group--query-layout" aria-label="Query window mode">
          {queryWindowModesForBuilder(builderKind).map((mode) => {
            const label = modeLabels[mode].text
            const Icon = modeLabels[mode].icon

            return (
              <button
                type="button"
                key={mode}
                className={`toolbar-icon-action${
                  mode === queryWindowMode ? ' is-active' : ''
                }`}
                aria-label={label}
                title={label}
                aria-pressed={mode === queryWindowMode}
                onClick={() => onToggleQueryWindowMode(mode)}
              >
                <Icon className="toolbar-icon" />
              </button>
            )
          })}
        </div>
      ) : null}

      {canAddDocument ? (
        <div className="toolbar-group" aria-label="MongoDB document actions">
          <button
            type="button"
            className="toolbar-icon-action"
            aria-label="Add document"
            title="Add a document to the scoped MongoDB collection."
            onClick={onAddDocument}
          >
            <ObjectDocumentIcon className="toolbar-icon" />
          </button>
        </div>
      ) : null}

      <div className="toolbar-spacer" />

      <div className="toolbar-group toolbar-group--context" aria-label="Execution context">
        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Change connection"
          title="Open the connection drawer to edit this profile, test it, or switch context."
          onClick={onOpenConnectionDrawer}
        >
          <SettingsIcon className="toolbar-icon" />
        </button>
      </div>

      <button
        type="button"
        className={`toolbar-icon-action${bottomPanelVisible ? ' is-active' : ''}`}
        aria-label={bottomPanelVisible ? 'Toggle results panel' : 'Show results panel'}
        title="Show or hide the Results, Messages, and Details panel. Shortcut: Ctrl+J."
        onClick={onToggleBottomPanel}
      >
        <PanelIcon className="toolbar-icon" />
      </button>
      <button
        type="button"
        className={`toolbar-icon-action${resultsDock === 'right' ? ' is-active' : ''}`}
        aria-label={resultsDock === 'right' ? 'Dock results to bottom' : 'Dock results to right'}
        title={resultsDock === 'right' ? 'Dock Results below the editor.' : 'Dock Results beside the editor.'}
        onClick={onToggleResultsDock}
      >
        <ColumnIcon className="toolbar-icon" />
      </button>
    </div>
  )
}

function noop() {
  // Optional in focused unit tests and non-query workspaces.
}

function queryWindowModesForBuilder(builderKind?: QueryBuilderState['kind']): QueryViewMode[] {
  if (builderKind === 'mongo-find' || builderKind === 'mongo-aggregation') {
    return ['builder', 'raw', 'script']
  }

  return ['builder', 'raw']
}
