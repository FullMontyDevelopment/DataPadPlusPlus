import type {
  ExecutionCapabilities,
  QueryBuilderState,
  QueryViewMode,
} from '@datapadplusplus/shared-types'
import {
  ExplainIcon,
  ConsoleIcon,
  PlayIcon,
  SettingsIcon,
  StopIcon,
  TableIcon,
  JsonIcon,
  KeyValueIcon,
  ObjectDocumentIcon,
  EfficiencyIcon,
  GuideIcon,
} from './icons'

interface EditorToolbarProps {
  executionStatus: 'idle' | 'loading' | 'ready'
  capabilities: ExecutionCapabilities
  canCancelExecution: boolean
  onExecute(): void
  onExplain(): void
  onCancel(): void
  onOpenConnectionDrawer(): void
  onAddDocument?(): void
  onToggleDocumentEfficiency?(): void
  canToggleBuilderView: boolean
  canAddDocument?: boolean
  canToggleDocumentEfficiency?: boolean
  documentEfficiencyMode?: boolean
  builderKind?: QueryBuilderState['kind']
  queryWindowMode: QueryViewMode
  onToggleQueryWindowMode(mode: QueryViewMode): void
  executeLabel?: string
  executeAriaLabel?: string
  executeTitle?: string
  executeDisabled?: boolean
  executionLocked?: boolean
  showScriptingGuideToggle?: boolean
  scriptingGuideVisible?: boolean
  onToggleScriptingGuide?(): void
}

export function EditorToolbar({
  executionStatus,
  capabilities,
  canCancelExecution,
  onExecute,
  onExplain,
  onCancel,
  onOpenConnectionDrawer,
  onAddDocument = noop,
  onToggleDocumentEfficiency = noop,
  canToggleBuilderView,
  canAddDocument = false,
  canToggleDocumentEfficiency = false,
  documentEfficiencyMode = false,
  builderKind,
  queryWindowMode,
  onToggleQueryWindowMode,
  executeLabel = 'Run',
  executeAriaLabel = 'Run query',
  executeTitle = 'Run the current query against the selected connection and environment. Shortcut: Ctrl+Enter.',
  executeDisabled = false,
  executionLocked = false,
  showScriptingGuideToggle = false,
  scriptingGuideVisible = false,
  onToggleScriptingGuide = noop,
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
    <div className="editor-toolbar" aria-label="Editor toolbar" data-tour-id="editor-toolbar">
      <div className="toolbar-group" aria-label="Execution controls">
        <button
          type="button"
          className="toolbar-action toolbar-action--run"
          aria-label={executeAriaLabel}
          title={executeTitle}
          disabled={executionLocked || executionStatus === 'loading' || executeDisabled}
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
            executionLocked
              ? 'Wait for the running query to finish before requesting an explain plan.'
              : capabilities.canExplain
              ? 'Run an explain/plan request for the current query. Shortcut: Ctrl+Shift+E.'
              : 'Explain is not available for this datastore yet.'
          }
          disabled={executionLocked || !capabilities.canExplain}
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
                aria-pressed={mode === queryWindowMode}
                disabled={executionLocked}
                title={executionLocked ? 'Wait for the running query to finish before changing the query mode.' : label}
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
            title={
              executionLocked
                ? 'Wait for the running query to finish before adding a document.'
                : 'Add a document to the scoped MongoDB collection.'
            }
            disabled={executionLocked}
            onClick={onAddDocument}
          >
            <ObjectDocumentIcon className="toolbar-icon" />
          </button>
        </div>
      ) : null}

      {canToggleDocumentEfficiency ? (
        <div className="toolbar-group" aria-label="Document result loading">
          <button
            type="button"
            className={`toolbar-icon-action toolbar-icon-action--efficiency${
              documentEfficiencyMode ? ' is-active' : ''
            }`}
            aria-label={documentEfficiencyMode ? 'Efficiency mode on' : 'Efficiency mode off'}
            title={
              executionLocked
                ? 'Wait for the running query to finish before changing document loading mode.'
                : documentEfficiencyMode
                ? 'Efficiency mode is on. Click to fetch full documents instead of hydrating fields on expand.'
                : 'Efficiency mode is off. Click to fetch only top-level document fields until expanded.'
            }
            aria-pressed={documentEfficiencyMode}
            disabled={executionLocked}
            onClick={onToggleDocumentEfficiency}
          >
            <EfficiencyIcon className="toolbar-icon" />
            {documentEfficiencyMode ? (
              <span className="toolbar-efficiency-active-dot" aria-hidden="true" />
            ) : null}
          </button>
        </div>
      ) : null}

      <div className="toolbar-spacer" />

      {showScriptingGuideToggle ? (
        <div className="toolbar-group" aria-label="MongoDB scripting help">
          <button
            type="button"
            className={`toolbar-icon-action${scriptingGuideVisible ? ' is-active' : ''}`}
            aria-label={scriptingGuideVisible ? 'Hide scripting guide' : 'Show scripting guide'}
            title={scriptingGuideVisible ? 'Hide scripting guide' : 'Show scripting guide'}
            aria-pressed={scriptingGuideVisible}
            onClick={onToggleScriptingGuide}
          >
            <GuideIcon className="toolbar-icon" />
          </button>
        </div>
      ) : null}

      <div className="toolbar-group toolbar-group--context" aria-label="Execution context">
        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Change connection"
          title={
            executionLocked
              ? 'Wait for the running query to finish before changing its connection.'
              : 'Open the connection drawer to edit this profile, test it, or switch context.'
          }
          disabled={executionLocked}
          onClick={onOpenConnectionDrawer}
        >
          <SettingsIcon className="toolbar-icon" />
        </button>
      </div>

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
