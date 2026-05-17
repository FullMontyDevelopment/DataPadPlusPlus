import { useRef, useState } from 'react'
import type {
  BottomPanelTab,
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DiagnosticsReport,
  EnvironmentProfile,
  ExecutionCapabilities,
  ExecutionRequest,
  ExecutionResponse,
  ExecutionResultEnvelope,
  ExplorerInspectResponse,
  QueryTabState,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import type { WorkbenchMessage } from '../../state/app-state'
import { DetailsView } from './bottom-panel/DetailsView'
import { HistoryView } from './bottom-panel/HistoryView'
import { MessagesView } from './bottom-panel/MessagesView'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from './icons'
import { ResultsView } from './results/ResultsView'

const MIN_BOTTOM_PANEL_HEIGHT = 120
const MAX_BOTTOM_PANEL_HEIGHT = 900
const BUTTON_RESIZE_STEP = 96
const KEYBOARD_RESIZE_STEP = 24

interface BottomPanelProps {
  activeTab?: QueryTabState
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  activePanelTab: BottomPanelTab
  height: number
  activePayload?: ResultPayload
  activeRenderer?: string
  diagnostics?: DiagnosticsReport
  explorerInspection?: ExplorerInspectResponse
  lastExecution?: ExecutionResponse
  lastExecutionRequest?: ExecutionRequest
  capabilities: ExecutionCapabilities
  workbenchMessages: WorkbenchMessage[]
  onSelectPanelTab(tab: BottomPanelTab): void
  onSelectRenderer(renderer: string): void
  onLoadNextPage(): void
  onResize(nextHeight: number): void
  onClose(): void
  onConfirmExecution(guardrailId: string, mode: ExecutionRequest['mode']): void
  onApplyInspectionTemplate(queryTemplate?: string): void
  onRestoreHistory(queryText: string): void
  onExecuteDataEdit(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onDismissWorkbenchMessage(id: string): void
  onClearWorkbenchMessages(): void
}

export function BottomPanel({
  activeTab,
  activeConnection,
  activeEnvironment,
  activePanelTab,
  height,
  activePayload,
  activeRenderer,
  diagnostics,
  explorerInspection,
  lastExecution,
  lastExecutionRequest,
  capabilities,
  workbenchMessages,
  onSelectPanelTab,
  onSelectRenderer,
  onLoadNextPage,
  onResize,
  onClose,
  onConfirmExecution,
  onApplyInspectionTemplate,
  onRestoreHistory,
  onExecuteDataEdit,
  onDismissWorkbenchMessage,
  onClearWorkbenchMessages,
}: BottomPanelProps) {
  const hasPanelContext = Boolean(activeTab && activeConnection && activeEnvironment)
  const hasQueryContext = Boolean(
    hasPanelContext && activeTab?.tabKind !== 'explorer' && activeTab?.tabKind !== 'metrics',
  )
  const safePanelTab =
    activePanelTab === 'details' && hasPanelContext
      ? 'details'
      : hasQueryContext
        ? activePanelTab
        : 'messages'
  const messages = activeTab ? buildMessages(activeTab.result, activeTab, lastExecution) : []
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const lastPointerY = useRef(0)
  const draftHeight = useRef(height)

  const stopResizing = () => {
    isResizingRef.current = false
    setIsResizing(false)
  }

  return (
    <section
      className="bottom-panel"
      style={{ height }}
      aria-label="Bottom panel"
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize bottom panel"
        aria-orientation="horizontal"
        aria-valuemin={MIN_BOTTOM_PANEL_HEIGHT}
        aria-valuemax={MAX_BOTTOM_PANEL_HEIGHT}
        aria-valuenow={height}
        className={`pane-resize-handle pane-resize-handle--bottom${isResizing ? ' is-active' : ''}`}
        title="Drag to resize the bottom results panel."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          lastPointerY.current = event.clientY
          draftHeight.current = height
          isResizingRef.current = true
          setIsResizing(true)
        }}
        onPointerMove={(event) => {
          if (!isResizingRef.current) {
            return
          }

          const delta = lastPointerY.current - event.clientY
          lastPointerY.current = event.clientY
          draftHeight.current += delta
          onResize(draftHeight.current)
        }}
        onPointerUp={stopResizing}
        onPointerCancel={stopResizing}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onResize(height + KEYBOARD_RESIZE_STEP)
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            onResize(height - KEYBOARD_RESIZE_STEP)
          }
        }}
      />

      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist" aria-label="Bottom panel tabs">
          {(['results', 'messages', 'history', 'details'] as const).map((item) => {
            const disabled =
              item === 'messages'
                ? false
                : item === 'details'
                  ? !hasPanelContext
                  : !hasQueryContext

            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={safePanelTab === item}
                className={`bottom-panel-tab${safePanelTab === item ? ' is-active' : ''}`}
                disabled={disabled}
                title={
                  disabled
                    ? 'Open a query tab to use this panel.'
                    : `Show ${item} for the active query tab.`
                }
                onClick={() => onSelectPanelTab(item)}
              >
                {item}
              </button>
            )
          })}
        </div>

        <div className="bottom-panel-actions">
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Increase panel height"
            title="Increase results panel height."
            onClick={() => onResize(height + BUTTON_RESIZE_STEP)}
          >
            <ChevronUpPseudo />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Decrease panel height"
            title="Decrease results panel height."
            onClick={() => onResize(height - BUTTON_RESIZE_STEP)}
          >
            <ChevronDownIcon className="panel-inline-icon" />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Hide bottom panel"
            title="Hide the bottom results panel."
            onClick={onClose}
          >
            <CloseIcon className="panel-inline-icon" />
          </button>
        </div>
      </div>

      <div className="bottom-panel-body">
        {safePanelTab === 'results' ? (
          <ResultsView
            capabilities={capabilities}
            connection={activeConnection}
            activeTab={activeTab}
            activeEnvironment={activeEnvironment}
            payload={activePayload}
            renderer={activeRenderer}
            result={activeTab?.result}
            onSelectRenderer={onSelectRenderer}
            onLoadNextPage={onLoadNextPage}
            onExecuteDataEdit={onExecuteDataEdit}
          />
        ) : null}

        {safePanelTab === 'messages' ? (
          <MessagesView
            lastExecution={lastExecution}
            lastExecutionRequest={lastExecutionRequest}
            messages={messages}
            workbenchMessages={workbenchMessages}
            onConfirmExecution={onConfirmExecution}
            onDismissWorkbenchMessage={onDismissWorkbenchMessage}
            onClearWorkbenchMessages={onClearWorkbenchMessages}
          />
        ) : null}

        {safePanelTab === 'history' && activeTab ? (
          <HistoryView
            activeTab={activeTab}
            onRestoreHistory={onRestoreHistory}
          />
        ) : null}

        {safePanelTab === 'details' && activeTab && activeConnection && activeEnvironment ? (
          <DetailsView
            activeConnection={activeConnection}
            activeEnvironment={activeEnvironment}
            activeTab={activeTab}
            diagnostics={diagnostics}
            explorerInspection={explorerInspection}
            onApplyInspectionTemplate={onApplyInspectionTemplate}
          />
        ) : null}
      </div>
    </section>
  )
}

function buildMessages(
  result: ExecutionResultEnvelope | undefined,
  tab: QueryTabState,
  lastExecution: ExecutionResponse | undefined,
) {
  return [
    ...(tab.error ? [tab.error.message] : []),
    ...(result?.notices.map((notice) => notice.message) ?? []),
    ...(lastExecution?.diagnostics ?? []),
  ]
}

function ChevronUpPseudo() {
  return <ChevronRightIcon className="panel-inline-icon panel-inline-icon--up" />
}
