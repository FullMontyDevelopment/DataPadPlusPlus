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
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { ClockIcon, CopyIcon, DownloadIcon } from '../icons'
import { resultEditQueryText } from '../../../result-edit-context'
import { ResultPayloadView } from './ResultPayloadView'
import { TestRunResultsView } from './TestRunResultsView'
import { copyText, exportPayload, payloadToText } from './payload-export'
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
  onFetchDocumentNodeChildren?(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onPlanOperation?(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
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
  onFetchDocumentNodeChildren,
  onExecuteDataEdit,
  onPlanOperation,
}: ResultsViewProps) {
  const [operationMessage, setOperationMessage] = useState('')
  const acknowledgedRenderRef = useRef('')

  useEffect(() => {
    const activeExecution = activeTab?.activeExecution

    if (
      !activeTab ||
      !activeExecution ||
      !result ||
      (activeExecution.phase !== 'rendering' && activeExecution.phase !== 'paging')
    ) {
      return
    }

    const renderToken = [
      activeTab.id,
      activeExecution.executionId,
      activeExecution.phase,
      payload?.renderer ?? result.defaultRenderer ?? 'none',
      result.pageInfo?.bufferedRows ?? result.payloads?.length ?? 0,
      result.durationMs,
    ].join(':')

    if (acknowledgedRenderRef.current === renderToken) {
      return
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      acknowledgedRenderRef.current = renderToken
      onResultRendered(activeTab.id, activeExecution.executionId)
      return
    }

    let secondFrame: number | undefined
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        acknowledgedRenderRef.current = renderToken
        onResultRendered(activeTab.id, activeExecution.executionId)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) {
        window.cancelAnimationFrame(secondFrame)
      }
    }
  }, [
    activeTab,
    onResultRendered,
    payload,
    result,
  ])

  if (activeTab?.tabKind === 'test-suite') {
    return (
      <div className="panel-body-frame panel-body-frame--results">
        <TestRunResultsView run={activeTab.testRun} />
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
    ? formatDurationClock(result.durationMs)
    : ''
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

    exportPayload(payload, result)
    setOperationMessage('Result export prepared.')
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
        tabId={activeTab?.id}
        documentFooterControls={documentFooterControls}
        resultDurationMs={result?.durationMs}
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
            <strong className="result-runtime-label" title="Query runtime">
              <ClockIcon className="panel-inline-icon" />
              {runtimeLabel}
            </strong>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
