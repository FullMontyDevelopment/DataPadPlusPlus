import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import type { ReactNode } from 'react'
import { DataGridView } from './DataGridView'
import type { DocumentEditContext } from './document-edit-context'
import { DocumentResultsView } from './DocumentResultsView'
import { JsonTreeView } from './JsonTreeView'
import { KeyValueResultsView } from './KeyValueResultsView'
import { GenericPlanPayloadView, MongoExplainPlanView } from './MongoExplainPlanView'
import { RawResultView } from './RawResultView'
import { SearchHitsResultsView } from './SearchHitsResultsView'

export function ResultPayloadView({
  connection,
  pageIndex = 0,
  pageSize,
  payload,
  resultDurationMs,
  resultSummary,
  editContext,
  documentFooterControls,
  onExecuteDataEdit,
}: {
  connection?: ConnectionProfile
  documentFooterControls?: ReactNode
  editContext?: DocumentEditContext
  pageIndex?: number
  pageSize?: number
  payload?: ResultPayload
  resultDurationMs?: number
  resultSummary?: string
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
}) {
  if (!payload) {
    return <p className="panel-footnote">No result yet.</p>
  }

  if (payload.renderer === 'table') {
    return (
      <DataGridView
        connection={connection}
        editContext={editContext}
        columns={payload.columns}
        rows={sliceItems(payload.rows, pageIndex, pageSize)}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'document') {
    return (
      <DocumentResultsView
        connection={connection}
        editContext={editContext}
        documents={payload.documents}
        footerControls={documentFooterControls}
        resultDurationMs={resultDurationMs}
        resultSummary={resultSummary}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'keyvalue') {
    return (
      <KeyValueResultsView
        key={keyValuePayloadKey(payload.entries, payload.key)}
        connection={connection}
        editContext={editContext}
        entries={sliceRecord(payload.entries, pageIndex, pageSize)}
        payload={payload}
        onExecuteDataEdit={onExecuteDataEdit}
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
    return (
      <SearchHitsResultsView
        key={searchHitsPayloadKey(payload.hits)}
        connection={connection}
        editContext={editContext}
        payload={{
          ...payload,
          hits: sliceItems(payload.hits, pageIndex, pageSize),
        }}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'graph') {
    return <GraphTree payload={payload} />
  }

  if (payload.renderer === 'chart') {
    return <ChartResultView payload={payload} />
  }

  if (payload.renderer === 'plan') {
    return connection?.engine === 'mongodb'
      ? <MongoExplainPlanView payload={payload} />
      : <GenericPlanPayloadView payload={payload} />
  }

  if (payload.renderer === 'metrics') {
    return (
      <DataGridView
        connection={connection}
        editContext={editContext}
        columns={['metric', 'value', 'unit', 'labels']}
        rows={payload.metrics.map((metric) => [
          metric.name,
          String(metric.value),
          metric.unit ?? '',
          formatLabels(metric.labels),
        ])}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'series') {
    return (
      <DataGridView
        connection={connection}
        editContext={editContext}
        columns={['series', 'timestamp', 'value', 'unit', 'labels']}
        rows={payload.series.flatMap((series) =>
          series.points.map((point) => [
            series.name,
            point.timestamp,
            String(point.value),
            series.unit ?? '',
            formatLabels(point.labels),
          ]),
        )}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (payload.renderer === 'schema') {
    return (
      <div className="details-grid">
        {payload.items.map((item) => (
          <div key={item.label} className="detail-row">
            <span>{item.label}</span>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
    )
  }

  return <RawResultView text={payload.renderer === 'raw' ? payload.text : JSON.stringify(payload, null, 2)} />
}

function ChartResultView({ payload }: { payload: Extract<ResultPayload, { renderer: 'chart' }> }) {
  const points = payload.series.flatMap((series) => series.points)
  const max = Math.max(...points.map((point) => point.y), 1)
  const min = Math.min(...points.map((point) => point.y), 0)
  const span = Math.max(max - min, 1)

  return (
    <div className="result-chart-view" aria-label={`${payload.chartType} chart`}>
      {payload.series.map((series) => (
        <section key={series.name} className="result-chart-series">
          <header>
            <strong>{series.name}</strong>
            <span>{payload.yAxis ?? 'Value'}</span>
          </header>
          <div className="result-bar-chart" aria-hidden="true">
            {series.points.slice(0, 48).map((point, index) => {
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

function searchHitsPayloadKey(hits: Extract<ResultPayload, { renderer: 'searchHits' }>['hits']) {
  return hits
    .map((hit, index) => {
      const rawHit = hit as typeof hit & { _id?: string; _source?: unknown }
      return `${index}:${hit.id ?? rawHit._id ?? JSON.stringify(hit.source ?? rawHit._source)}`
    })
    .join('|')
}

function GraphTree({ payload }: { payload: Extract<ResultPayload, { renderer: 'graph' }> }) {
  return (
    <div className="json-tree-list">
      <JsonTreeView
        value={{
          nodes: payload.nodes,
          edges: payload.edges,
        }}
        label="graph"
      />
    </div>
  )
}
