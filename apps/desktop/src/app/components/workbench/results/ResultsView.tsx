import { useEffect, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
  EnvironmentProfile,
  ExecutionCapabilities,
  ExecutionResultEnvelope,
  ExportResultFileRequest,
  ExportResultFileResponse,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { ClockIcon, CopyIcon, DownloadIcon } from '../icons'
import { resultEditQueryText } from '../../../result-edit-context'
import { ResultPayloadView } from './ResultPayloadView'
import { ResultExportDialog } from './ResultExportDialog'
import { TestRunResultsView } from './TestRunResultsView'
import { copyText, payloadToText } from './payload-export'
import { formatDurationClock } from './result-runtime'

interface ResultsViewProps {
  capabilities: ExecutionCapabilities
  connection?: ConnectionProfile
  activeTab?: QueryTabState
  activeEnvironment?: EnvironmentProfile
  payload?: ResultPayload
  renderer?: string
  result?: ExecutionResultEnvelope
  onSelectRenderer(renderer: string): void
  onLoadNextPage(): void
  onResultRendered(tabId: string, executionId: string): void
  onExportResultFile?(
    request: ExportResultFileRequest,
  ): Promise<ExportResultFileResponse | undefined>
  onFetchDocumentNodeChildren?(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onPlanOperation?(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
  onEditConnection?(): void
}

export function ResultsView({
  capabilities,
  connection,
  activeTab,
  activeEnvironment,
  payload,
  renderer,
  result,
  onSelectRenderer,
  onLoadNextPage,
  onResultRendered,
  onExportResultFile,
  onFetchDocumentNodeChildren,
  onExecuteDataEdit,
  onPlanOperation,
  onEditConnection,
}: ResultsViewProps) {
  const [operationMessage, setOperationMessage] = useState('')
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const acknowledgedRenderRef = useRef('')
  const activeTabId = activeTab?.id
  const activeExecutionId = activeTab?.activeExecution?.executionId
  const activeExecutionPhase = activeTab?.activeExecution?.phase
  const shouldAcknowledgeRender = Boolean(
    activeTabId &&
      activeExecutionId &&
      result &&
      (activeExecutionPhase === 'rendering' || activeExecutionPhase === 'paging'),
  )
  const renderToken = shouldAcknowledgeRender
    ? [
        activeTabId,
        activeExecutionId,
        activeExecutionPhase,
        payload?.renderer ?? result?.defaultRenderer ?? 'none',
        result?.pageInfo?.bufferedRows ?? result?.payloads?.length ?? 0,
        result?.durationMs,
      ].join(':')
    : ''

  useEffect(() => {
    if (!shouldAcknowledgeRender || !activeTabId || !activeExecutionId) {
      return
    }

    if (acknowledgedRenderRef.current === renderToken) {
      return
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      acknowledgedRenderRef.current = renderToken
      onResultRendered(activeTabId, activeExecutionId)
      return
    }

    let secondFrame: number | undefined
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        acknowledgedRenderRef.current = renderToken
        onResultRendered(activeTabId, activeExecutionId)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) {
        window.cancelAnimationFrame(secondFrame)
      }
    }
  }, [
    activeExecutionId,
    activeTabId,
    onResultRendered,
    renderToken,
    shouldAcknowledgeRender,
  ])

  if (activeTab?.tabKind === 'test-suite') {
    return (
      <div className="panel-body-frame panel-body-frame--results">
        <TestRunResultsView run={activeTab.testRun} />
      </div>
    )
  }

  if (activeTab?.error) {
    return (
      <div className="panel-body-frame panel-body-frame--results">
        <div className="result-error-state" role="alert">
          <strong>{activeTab.error.code}</strong>
          <span>{activeTab.error.message}</span>
          {onEditConnection ? (
            <button type="button" className="drawer-button" onClick={onEditConnection}>
              Edit Connection
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const usesDocumentPayload = connection?.family === 'document' && payload?.renderer === 'document'
  const footerMessages = [
    result?.summary && payload?.renderer !== 'document' ? result.summary : undefined,
    result?.truncated && !result.pageInfo?.hasMore
      ? `Result set truncated at ${result.rowLimit ?? capabilities.defaultRowLimit} rows.`
      : undefined,
    operationMessage || undefined,
  ].filter((message): message is string => Boolean(message))
  const runtimeLabel = result && payload?.renderer !== 'document'
    ? formatDurationClock(result.displayDurationMs ?? result.durationMs)
    : ''
  const runtimeTitle = result?.serverDurationMs !== undefined
    ? `Visible total: ${formatDurationClock(result.displayDurationMs ?? result.durationMs)} / Server: ${formatDurationClock(result.serverDurationMs)}`
    : 'Query runtime'
  const documentFooterControls = payload && usesDocumentPayload && result?.pageInfo?.hasMore ? (
    <div className="document-results-footer-controls">
      <button
        type="button"
        className="drawer-button"
        title="Fetch the next chunk of documents and append it to the loaded results."
        onClick={onLoadNextPage}
      >
        Load More
      </button>
    </div>
  ) : undefined

  const copyResult = async () => {
    if (!payload) {
      return
    }

    try {
      await copyText(payloadToText(payload))
      setOperationMessage('Result copied to clipboard.')
    } catch {
      setOperationMessage('Unable to copy result to clipboard.')
    }
  }

  const exportResult = () => {
    if (!payload) {
      return
    }

    setExportDialogOpen(true)
  }

  const saveExportFile = async (request: ExportResultFileRequest) => {
    if (!onExportResultFile) {
      throw new Error('Result file export is unavailable.')
    }

    const response = await onExportResultFile(request)

    if (response?.saved) {
      setOperationMessage('Result exported.')
    }

    setExportDialogOpen(false)
  }

  return (
    <div className="panel-body-frame panel-body-frame--results">
      <div className="panel-title-row panel-title-row--compact">
        <div className="panel-title-actions">
          <div className="renderer-switcher">
            {(result?.rendererModes ?? []).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`renderer-chip${renderer === mode ? ' is-active' : ''}`}
                title={`Render this result as ${mode}.`}
                onClick={() => onSelectRenderer(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Copy result"
            disabled={!payload}
            title="Copy the current result to the clipboard."
            onClick={() => void copyResult()}
          >
            <CopyIcon className="panel-inline-icon" />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Export result"
            disabled={!payload}
            title="Export the current result."
            onClick={exportResult}
          >
            <DownloadIcon className="panel-inline-icon" />
          </button>
        </div>
      </div>

      <ResultPayloadView
        connection={connection}
        editContext={
          activeTab && activeEnvironment
            ? {
                connectionId: activeTab.connectionId,
                environmentId: activeTab.environmentId,
                queryText: resultEditQueryText(activeTab, result),
                ...(payload?.renderer === 'document' && payload.database
                  ? { database: payload.database }
                  : {}),
                ...(payload?.renderer === 'document' && payload.collection
                  ? { collection: payload.collection }
                  : {}),
              }
            : undefined
        }
        payload={payload}
        resultId={result?.id}
        tabId={activeTab?.id}
        documentFooterControls={documentFooterControls}
        resultDurationMs={result?.displayDurationMs ?? result?.durationMs}
        resultRuntimeTitle={runtimeTitle}
        resultSummary={result?.summary}
        onFetchDocumentNodeChildren={onFetchDocumentNodeChildren}
        onExecuteDataEdit={onExecuteDataEdit}
        onPlanOperation={onPlanOperation}
      />

      {payload && !usesDocumentPayload && result?.pageInfo?.hasMore ? (
        <div className="panel-page-row">
          <span>
            Showing {result.pageInfo.bufferedRows} buffered item(s). Copy/export uses the buffered result only.
          </span>
          <button
            type="button"
            className="drawer-button"
            title="Fetch the next bounded page of results and append it to the buffered view."
            onClick={onLoadNextPage}
          >
            Load More
          </button>
        </div>
      ) : null}

      {footerMessages.length > 0 || runtimeLabel ? (
        <div className="results-status-footer">
          <span>{footerMessages.join(' / ')}</span>
          {runtimeLabel ? (
            <strong className="result-runtime-label" title={runtimeTitle}>
              <ClockIcon className="panel-inline-icon" />
              {runtimeLabel}
            </strong>
          ) : null}
        </div>
      ) : null}

      {exportDialogOpen && payload ? (
        <ResultExportDialog
          payload={payload}
          result={result}
          onCancel={() => setExportDialogOpen(false)}
          onExport={saveExportFile}
        />
      ) : null}
    </div>
  )
}
