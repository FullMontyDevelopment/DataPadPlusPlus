import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DocumentNodeChildrenRequest,
  DocumentNodeChildrenResponse,
  OperationPlanRequest,
  OperationPlanResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import type { ReactNode } from 'react'
import { BatchResultsView } from './BatchResultsView'
import { CostEstimateResultsView } from './CostEstimateResultsView'
import { DataGridView } from './DataGridView'
import { dataGridRowsVersion } from './data-grid-row-patches'
import type { DocumentEditContext } from './document-edit-context'
import { DocumentResultsView } from './DocumentResultsView'
import { GenericPlanPayloadView } from './GenericPlanPayloadView'
import { GraphResultsView } from './GraphResultsView'
import { JsonTreeView } from './JsonTreeView'
import { KeyValueResultsView } from './KeyValueResultsView'
import { MongoExplainPlanView } from '../datastores/mongodb/MongoExplainPlanView'
import { ProfileResultsView } from './ProfileResultsView'
import { RawResultView } from './RawResultView'
import { SearchHitsResultsView } from '../datastores/common/search/SearchHitsResultsView'
import { formatResultCellValue } from './result-cell-format'

export function ResultPayloadView({
  connection,
  pageIndex = 0,
  pageSize,
  payload,
  resultId,
  tabId,
  resultDurationMs,
  resultRuntimeTitle,
  resultSummary,
  documentResetToken,
  executionLocked = false,
  editContext,
  documentFooterControls,
  onFetchDocumentNodeChildren,
  onExecuteDataEdit,
  onPlanOperation,
}: {
  connection?: ConnectionProfile
  documentFooterControls?: ReactNode
  editContext?: DocumentEditContext
  pageIndex?: number
  pageSize?: number
  payload?: ResultPayload
  resultId?: string
  tabId?: string
  resultDurationMs?: number
  resultRuntimeTitle?: string
  resultSummary?: string
  documentResetToken?: string
  executionLocked?: boolean
  onFetchDocumentNodeChildren?(
    request: DocumentNodeChildrenRequest,
  ): Promise<DocumentNodeChildrenResponse | undefined>
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onPlanOperation?(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
}) {
  if (!payload) {
    return <p className="panel-footnote">No result yet.</p>
  }

  if (payload.renderer === 'batch') {
    return (
      <BatchResultsView
        payload={payload}
        renderPayload={(sectionPayload, sectionIndex) => (
          <ResultPayloadView
            connection={connection}
            documentFooterControls={documentFooterControls}
            editContext={editContext}
            pageIndex={0}
            pageSize={undefined}
            payload={sectionPayload}
            resultId={resultId ? `${resultId}:batch:${sectionIndex}` : undefined}
            tabId={tabId ? `${tabId}:batch:${sectionIndex}` : undefined}
            resultDurationMs={resultDurationMs}
            resultRuntimeTitle={resultRuntimeTitle}
            resultSummary={resultSummary}
            documentResetToken={documentResetToken}
            executionLocked={executionLocked}
            onFetchDocumentNodeChildren={onFetchDocumentNodeChildren}
            onExecuteDataEdit={executionLocked ? undefined : onExecuteDataEdit}
            onPlanOperation={executionLocked ? undefined : onPlanOperation}
          />
        )}
      />
    )
  }

  if (payload.renderer === 'table') {
    const columns = arrayValue<unknown>(payload.columns).map(formatResultCellValue)
    const rows = tableRowsValue(payload.rows)
    const pageVersion = `${pageIndex}:${pageSize ?? 'all'}`
    const dataVersion = resultId
      ? `${resultId}:${pageVersion}`
      : `${dataGridRowsVersion(rows, columns)}:${pageVersion}`

    return (
      <DataGridView
        key={dataVersion}
        connection={connection}
        editContext={editContext}
        columns={columns}
        rows={sliceItems(rows, pageIndex, pageSize)}
        executionLocked={executionLocked}
        onExecuteDataEdit={executionLocked ? undefined : onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'document') {
    const documents = arrayValue<Record<string, unknown>>(payload.documents)

    return (
      <DocumentResultsView
        connection={connection}
        editContext={editContext}
        documents={documents}
        database={payload.database}
        collection={payload.collection}
        footerControls={documentFooterControls}
        hydrationMode={payload.hydrationMode}
        tabId={tabId}
        resultDurationMs={resultDurationMs}
        resultRuntimeTitle={resultRuntimeTitle}
        resultSummary={resultSummary}
        documentResetToken={documentResetToken}
        executionLocked={executionLocked}
        onFetchDocumentNodeChildren={onFetchDocumentNodeChildren}
        onExecuteDataEdit={executionLocked ? undefined : onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'keyvalue') {
    const entries = stringRecordValue(payload.entries)
    const safePayload = {
      ...payload,
      entries,
    }

    return (
      <KeyValueResultsView
        key={keyValuePayloadKey(entries, payload.key)}
        connection={connection}
        editContext={editContext}
        entries={sliceRecord(entries, pageIndex, pageSize)}
        payload={safePayload}
        executionLocked={executionLocked}
        onExecuteDataEdit={executionLocked ? undefined : onExecuteDataEdit}
        onPlanOperation={executionLocked ? undefined : onPlanOperation}
      />
    )
  }

  if (payload.renderer === 'json') {
    return (
      <div className="json-tree-list">
        <JsonTreeView value={payload.value} label="result" />
      </div>
    )
  }

  if (payload.renderer === 'searchHits') {
    const hits = arrayValue<Extract<ResultPayload, { renderer: 'searchHits' }>['hits'][number]>(
      payload.hits,
    )

    return (
      <SearchHitsResultsView
        connection={connection}
        editContext={editContext}
        payload={{
          ...payload,
          hits: sliceItems(hits, pageIndex, pageSize),
        }}
        executionLocked={executionLocked}
        onExecuteDataEdit={executionLocked ? undefined : onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'graph') {
    return <GraphResultsView payload={payload} />
  }

  if (payload.renderer === 'chart') {
    return <ChartResultView payload={payload} />
  }

  if (payload.renderer === 'plan') {
    return connection?.engine === 'mongodb'
      ? <MongoExplainPlanView payload={payload} />
      : <GenericPlanPayloadView connection={connection} payload={payload} />
  }

  if (payload.renderer === 'profile') {
    return <ProfileResultsView payload={payload} />
  }

  if (payload.renderer === 'costEstimate') {
    return <CostEstimateResultsView payload={payload} />
  }

  if (payload.renderer === 'metrics') {
    const metrics = arrayValue<Extract<ResultPayload, { renderer: 'metrics' }>['metrics'][number]>(
      payload.metrics,
    )

    return (
      <DataGridView
        columns={['metric', 'value', 'unit', 'labels']}
        rows={metrics.map((metric) => [
          metric.name,
          String(metric.value),
          metric.unit ?? '',
          formatLabels(metric.labels),
        ])}
      />
    )
  }

  if (payload.renderer === 'series') {
    const seriesPayloads = arrayValue<Extract<ResultPayload, { renderer: 'series' }>['series'][number]>(
      payload.series,
    )

    return (
      <DataGridView
        columns={['series', 'timestamp', 'value', 'unit', 'labels']}
        rows={seriesPayloads.flatMap((series) =>
          arrayValue<typeof series.points[number]>(series.points).map((point) => [
            series.name,
            point.timestamp,
            String(point.value),
            series.unit ?? '',
            formatLabels(point.labels),
          ]),
        )}
      />
    )
  }

  if (payload.renderer === 'schema') {
    const items = arrayValue<Extract<ResultPayload, { renderer: 'schema' }>['items'][number]>(
      payload.items,
    )

    return (
      <div className="details-grid">
        {items.map((item) => (
          <div key={item.label} className="detail-row">
            <span>{item.label}</span>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
    )
  }

  return <RawResultView text={payload.renderer === 'raw' || payload.renderer === 'resp' ? payload.text : JSON.stringify(payload, null, 2)} />
}

function ChartResultView({ payload }: { payload: Extract<ResultPayload, { renderer: 'chart' }> }) {
  const seriesPayloads = arrayValue<Extract<ResultPayload, { renderer: 'chart' }>['series'][number]>(
    payload.series,
  )
  const points = seriesPayloads.flatMap((series) => arrayValue<typeof series.points[number]>(series.points))
  const max = Math.max(...points.map((point) => point.y), 1)
  const min = Math.min(...points.map((point) => point.y), 0)
  const span = Math.max(max - min, 1)

  return (
    <div className="result-chart-view" aria-label={`${payload.chartType} chart`}>
      {seriesPayloads.map((series) => (
        <section key={series.name} className="result-chart-series">
          <header>
            <strong>{series.name}</strong>
            <span>{payload.yAxis ?? 'Value'}</span>
          </header>
          <div className="result-bar-chart" aria-hidden="true">
            {arrayValue<typeof series.points[number]>(series.points).slice(0, 48).map((point, index) => {
              const height = Math.max(3, ((point.y - min) / span) * 100)
              return (
                <span
                  key={`${String(point.x)}-${index}`}
                  className="result-bar-chart-item"
                  style={{ height: `${height}%` }}
                  title={`${String(point.x)}: ${point.y}`}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}


function sliceRecord(
  entries: Record<string, string>,
  pageIndex: number,
  pageSize: number | undefined,
) {
  if (!pageSize || pageSize <= 0) {
    return entries
  }

  return Object.fromEntries(
    Object.entries(entries).slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
  )
}

function sliceItems<T>(items: T[], pageIndex: number, pageSize: number | undefined) {
  if (!pageSize || pageSize <= 0) {
    return items
  }

  const start = Math.max(0, pageIndex) * pageSize
  return items.slice(start, start + pageSize)
}

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function tableRowsValue(value: unknown): string[][] {
  return arrayValue<unknown>(value).map((row) =>
    Array.isArray(row)
      ? row.map(formatResultCellValue)
      : [formatResultCellValue(row)],
  )
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringRecordValue(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordValue(value)).map(([key, entry]) => [key, String(entry ?? '')]),
  )
}

function formatLabels(labels: Record<string, string> | undefined) {
  const entries = Object.entries(labels ?? {})
  if (entries.length === 0) {
    return ''
  }

  return entries
    .map(([key, value]) => `${readableLabel(key)}: ${value}`)
    .join('; ')
}

function readableLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function keyValuePayloadKey(entries: Record<string, string>, key?: string) {
  return Object.entries(entries)
    .map(([entryKey, value]) => `${key ?? 'entries'}:${entryKey}:${value}`)
    .join('|')
}
