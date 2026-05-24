import { useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  EnvironmentProfile,
  ExecutionCapabilities,
  ExecutionResultEnvelope,
  QueryTabState,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { ClockIcon, CopyIcon, DownloadIcon } from '../icons'
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
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
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
  onExecuteDataEdit,
}: ResultsViewProps) {
  const [operationMessage, setOperationMessage] = useState('')

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
                environmentId: activeEnvironment.id,
                queryText: activeTab.queryText,
              }
            : undefined
        }
        payload={payload}
        documentFooterControls={documentFooterControls}
        resultDurationMs={result?.durationMs}
        resultSummary={result?.summary}
        onExecuteDataEdit={onExecuteDataEdit}
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
