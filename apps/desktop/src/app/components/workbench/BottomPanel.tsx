import { useEffect, useRef, useState } from 'react'
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
const MIN_RESULTS_SIDE_WIDTH = 320
const MAX_RESULTS_SIDE_WIDTH = 2400
const MIN_EDITOR_WIDTH_WITH_RIGHT_RESULTS = 120
const BUTTON_RESIZE_STEP = 96
const KEYBOARD_RESIZE_STEP = 24
type ResultsDock = 'bottom' | 'right'

interface BottomPanelProps {
  activeTab?: QueryTabState
  activeConnection?: ConnectionProfile
  activeEnvironment?: EnvironmentProfile
  activePanelTab: BottomPanelTab
  dock?: ResultsDock
  height: number
  sideWidth?: number
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
  onResize(nextSize: number): void
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
  dock = 'bottom',
  height,
  sideWidth = 420,
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
    hasPanelContext &&
      activeTab?.tabKind !== 'explorer' &&
      activeTab?.tabKind !== 'metrics' &&
      activeTab?.tabKind !== 'object-view',
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
  const panelRef = useRef<HTMLElement | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement | null>(null)
  const lastPointerX = useRef(0)
  const lastPointerY = useRef(0)
  const draftSize = useRef(dock === 'right' ? sideWidth : height)
  const resizeFrame = useRef<number | undefined>(undefined)
  const isRightDock = dock === 'right'

  const clampPanelSize = (nextSize: number) =>
    isRightDock ? clampPanelWidth(nextSize, panelRef.current) : clampPanelHeight(nextSize)

  const applyDraftSize = (nextSize: number) => {
    const clampedSize = clampPanelSize(nextSize)
    draftSize.current = clampedSize
    if (isRightDock) {
      const workbenchElement = panelRef.current?.closest<HTMLElement>('.ads-workbench')

      if (workbenchElement) {
        workbenchElement.style.setProperty('--results-side-width', `${clampedSize}px`)
      } else {
        panelRef.current?.style.setProperty('width', `${clampedSize}px`)
      }
    } else {
      panelRef.current?.style.setProperty('height', `${clampedSize}px`)
    }
    resizeHandleRef.current?.setAttribute('aria-valuenow', String(Math.round(clampedSize)))
  }

  const scheduleDraftSize = (nextSize: number) => {
    draftSize.current = clampPanelSize(nextSize)
    if (resizeFrame.current !== undefined) {
      return
    }

    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = undefined
      applyDraftSize(draftSize.current)
    })
  }

  const stopResizing = () => {
    if (!isResizingRef.current) {
      return
    }

    if (resizeFrame.current !== undefined) {
      window.cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = undefined
      applyDraftSize(draftSize.current)
    }

    document.body.classList.remove(isRightDock ? 'is-results-side-resizing' : 'is-bottom-panel-resizing')
    isResizingRef.current = false
    setIsResizing(false)
    onResize(draftSize.current)
  }

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== undefined) {
        window.cancelAnimationFrame(resizeFrame.current)
      }
      document.body.classList.remove('is-bottom-panel-resizing')
      document.body.classList.remove('is-results-side-resizing')
    }
  }, [])

  return (
    <section
      ref={panelRef}
      className={`bottom-panel bottom-panel--${dock}${isResizing ? ' is-resizing' : ''}`}
      style={isRightDock ? undefined : { height }}
      aria-label={isRightDock ? 'Right results panel' : 'Bottom panel'}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        tabIndex={0}
        aria-label={isRightDock ? 'Resize right results panel' : 'Resize bottom panel'}
        aria-orientation={isRightDock ? 'vertical' : 'horizontal'}
        aria-valuemin={isRightDock ? MIN_RESULTS_SIDE_WIDTH : MIN_BOTTOM_PANEL_HEIGHT}
        aria-valuemax={isRightDock ? MAX_RESULTS_SIDE_WIDTH : MAX_BOTTOM_PANEL_HEIGHT}
        aria-valuenow={isRightDock ? sideWidth : height}
        className={`pane-resize-handle pane-resize-handle--${isRightDock ? 'results-side' : 'bottom'}${isResizing ? ' is-active' : ''}`}
        title={`Drag to resize the ${isRightDock ? 'right' : 'bottom'} results panel.`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          lastPointerX.current = event.clientX
          lastPointerY.current = event.clientY
          draftSize.current = clampPanelSize(isRightDock ? sideWidth : height)
          isResizingRef.current = true
          document.body.classList.add(isRightDock ? 'is-results-side-resizing' : 'is-bottom-panel-resizing')
          setIsResizing(true)
        }}
        onPointerMove={(event) => {
          if (!isResizingRef.current) {
            return
          }

          const delta = isRightDock
            ? lastPointerX.current - event.clientX
            : lastPointerY.current - event.clientY
          lastPointerX.current = event.clientX
          lastPointerY.current = event.clientY
          scheduleDraftSize(draftSize.current + delta)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResizing()
        }}
        onKeyDown={(event) => {
          if (!isRightDock && event.key === 'ArrowUp') {
            event.preventDefault()
            onResize(clampPanelHeight(height + KEYBOARD_RESIZE_STEP))
          }

          if (!isRightDock && event.key === 'ArrowDown') {
            event.preventDefault()
            onResize(clampPanelHeight(height - KEYBOARD_RESIZE_STEP))
          }

          if (isRightDock && event.key === 'ArrowLeft') {
            event.preventDefault()
            onResize(clampPanelWidth(sideWidth + KEYBOARD_RESIZE_STEP, panelRef.current))
          }

          if (isRightDock && event.key === 'ArrowRight') {
            event.preventDefault()
            onResize(clampPanelWidth(sideWidth - KEYBOARD_RESIZE_STEP, panelRef.current))
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
            aria-label={isRightDock ? 'Increase panel width' : 'Increase panel height'}
            title={`Increase results panel ${isRightDock ? 'width' : 'height'}.`}
            onClick={() =>
              onResize(
                isRightDock
                  ? clampPanelWidth(sideWidth + BUTTON_RESIZE_STEP, panelRef.current)
                  : clampPanelHeight(height + BUTTON_RESIZE_STEP),
              )
            }
          >
            <ChevronUpPseudo />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label={isRightDock ? 'Decrease panel width' : 'Decrease panel height'}
            title={`Decrease results panel ${isRightDock ? 'width' : 'height'}.`}
            onClick={() =>
              onResize(
                isRightDock
                  ? clampPanelWidth(sideWidth - BUTTON_RESIZE_STEP, panelRef.current)
                  : clampPanelHeight(height - BUTTON_RESIZE_STEP),
              )
            }
          >
            <ChevronDownIcon className="panel-inline-icon" />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Hide results panel"
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

function clampPanelHeight(nextHeight: number) {
  return Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.min(MAX_BOTTOM_PANEL_HEIGHT, nextHeight))
}

function clampPanelWidth(nextWidth: number, panelElement?: HTMLElement | null) {
  return Math.max(
    MIN_RESULTS_SIDE_WIDTH,
    Math.min(getMaxPanelWidth(panelElement), nextWidth),
  )
}

function getMaxPanelWidth(panelElement?: HTMLElement | null) {
  const parentWidth = panelElement?.parentElement?.clientWidth
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const availableWidth = parentWidth && parentWidth > 0 ? parentWidth : viewportWidth

  if (!availableWidth || availableWidth <= MIN_RESULTS_SIDE_WIDTH) {
    return MAX_RESULTS_SIDE_WIDTH
  }

  return Math.max(
    MIN_RESULTS_SIDE_WIDTH,
    Math.min(MAX_RESULTS_SIDE_WIDTH, availableWidth - MIN_EDITOR_WIDTH_WITH_RIGHT_RESULTS),
  )
}

function ChevronUpPseudo() {
  return <ChevronRightIcon className="panel-inline-icon panel-inline-icon--up" />
}
