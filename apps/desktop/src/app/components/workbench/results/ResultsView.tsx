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

const RESULT_PAGE_SIZES = [10, 20, 50, 100]
const DEFAULT_RESULT_PAGE_SIZE = 20

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
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: DEFAULT_RESULT_PAGE_SIZE,
    resultId: '',
  })

  if (activeTab?.tabKind === 'test-suite') {
    return (
      <div className="panel-body-frame panel-body-frame--results">
        <TestRunResultsView run={activeTab.testRun} />
      </div>
    )
  }

  const resultId = result?.id ?? ''
  const usesDocumentPaging = connection?.family === 'document' && payload?.renderer === 'document'
  const pageSize = pagination.pageSize
  const pageIndex = usesDocumentPaging && pagination.resultId === resultId ? pagination.pageIndex : 0
  const itemCount = payloadItemCount(payload)
  const pageCount = usesDocumentPaging ? Math.max(1, Math.ceil(itemCount / pageSize)) : 1
  const safePageIndex = Math.min(pageIndex, pageCount - 1)
  const firstVisibleItem = itemCount === 0 ? 0 : safePageIndex * pageSize + 1
  const lastVisibleItem = usesDocumentPaging
    ? Math.min(itemCount, (safePageIndex + 1) * pageSize)
    : itemCount
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
  const documentFooterControls = payload && usesDocumentPaging ? (
    <div className="document-results-footer-controls">
      <div className="results-pagination-controls results-pagination-controls--compact">
        <button
          type="button"
          className="drawer-button"
          disabled={safePageIndex <= 0}
          onClick={() =>
            setPagination((current) => ({
              ...current,
              pageIndex: Math.max(0, safePageIndex - 1),
              resultId,
            }))
          }
        >
          Previous
        </button>
        <span>
          {firstVisibleItem}-{lastVisibleItem} of {itemCount}
        </span>
        <button
          type="button"
          className="drawer-button"
          disabled={safePageIndex >= pageCount - 1}
          onClick={() =>
            setPagination((current) => ({
              ...current,
              pageIndex: Math.min(pageCount - 1, safePageIndex + 1),
              resultId,
            }))
          }
        >
          Next
        </button>
        <label className="results-page-size">
          <span>Page size</span>
          <select
            aria-label="Page size"
            value={pageSize}
            onChange={(event) =>
              setPagination({
                pageIndex: 0,
                pageSize: Number(event.target.value),
                resultId,
              })
            }
          >
            {RESULT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result?.pageInfo?.hasMore ? (
        <>
          <span className="results-buffered-summary">
            {result.pageInfo.bufferedRows} buffered
          </span>
          <button
            type="button"
            className="drawer-button"
            title="Fetch the next bounded page of results and append it to the buffered view."
            onClick={onLoadNextPage}
          >
            Load More
          </button>
        </>
      ) : null}
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
            title="Copy the currently buffered result payload to the clipboard."
            onClick={() => void copyResult()}
          >
            <CopyIcon className="panel-inline-icon" />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-button"
            aria-label="Export result"
            disabled={!payload}
            title="Export the currently buffered result payload, not the entire remote result set."
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
        pageIndex={safePageIndex}
        pageSize={usesDocumentPaging ? pageSize : undefined}
        payload={payload}
        documentFooterControls={documentFooterControls}
        resultDurationMs={result?.durationMs}
        resultSummary={result?.summary}
        onExecuteDataEdit={onExecuteDataEdit}
      />

      {payload && !usesDocumentPaging && result?.pageInfo?.hasMore ? (
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

function payloadItemCount(payload: ResultPayload | undefined) {
  if (!payload) {
    return 0
  }

  if (payload.renderer === 'table') {
    return payload.rows.length
  }

  if (payload.renderer === 'document') {
    return payload.documents.length
  }

  if (payload.renderer === 'searchHits') {
    return payload.hits.length
  }

  if (payload.renderer === 'keyvalue') {
    return Object.keys(payload.entries).length
  }

  return 1
}
