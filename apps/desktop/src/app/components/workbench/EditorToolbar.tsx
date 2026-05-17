import type {
  ExecutionCapabilities,
  QueryBuilderState,
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
} from './icons'

type QueryWindowMode = 'both' | 'builder' | 'raw'

interface EditorToolbarProps {
  executionStatus: 'idle' | 'loading' | 'ready'
  capabilities: ExecutionCapabilities
  canCancelExecution: boolean
  bottomPanelVisible: boolean
  onExecute(): void
  onExplain(): void
  onCancel(): void
  onOpenConnectionDrawer(): void
  onToggleBottomPanel(): void
  canToggleBuilderView: boolean
  builderKind?: QueryBuilderState['kind']
  queryWindowMode: QueryWindowMode
  onToggleQueryWindowMode(mode: QueryWindowMode): void
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
  onExecute,
  onExplain,
  onCancel,
  onOpenConnectionDrawer,
  onToggleBottomPanel,
  canToggleBuilderView,
  builderKind,
  queryWindowMode,
  onToggleQueryWindowMode,
  executeLabel = 'Run',
  executeAriaLabel = 'Run query',
  executeTitle = 'Run the current query against the selected connection and environment. Shortcut: Ctrl+Enter.',
  executeDisabled = false,
}: EditorToolbarProps) {
  const queryWindowModeButtonLabels: Record<
    QueryWindowMode,
    { icon: typeof PlayIcon; text: string }
  > = {
    both: { icon: ColumnIcon, text: 'Show builder and raw' },
    builder: { icon: JsonIcon, text: 'Show builder only' },
    raw: { icon: TableIcon, text: 'Show raw query only' },
  }
  const redisModeButtonLabels: Record<
    QueryWindowMode,
    { icon: typeof PlayIcon; text: string }
  > = {
    both: { icon: ColumnIcon, text: 'Show key browser and console' },
    builder: { icon: KeyValueIcon, text: 'Show key browser' },
    raw: { icon: ConsoleIcon, text: 'Show Redis console' },
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
              : 'Cancel is unavailable until a cancellable query is running on a supported adapter.'
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
              : 'Explain is not implemented for this datastore adapter yet.'
          }
          disabled={!capabilities.canExplain}
          onClick={onExplain}
        >
          <ExplainIcon className="toolbar-icon" />
        </button>
      </div>

      {canToggleBuilderView ? (
        <div className="toolbar-group toolbar-group--query-layout" aria-label="Query window mode">
          {(
            [
              { mode: 'both' },
              { mode: 'builder' },
              { mode: 'raw' },
            ] as const
          ).map(({ mode }) => {
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
        aria-label="Toggle results panel"
        title="Show or hide the Results, Messages, and Details panel. Shortcut: Ctrl+J."
        onClick={onToggleBottomPanel}
      >
        <PanelIcon className="toolbar-icon" />
      </button>
    </div>
  )
}
