import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExecutionResultEnvelope,
  GuardrailDecision,
  QueryTabState,
  ResolvedEnvironment,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { evaluateGuardrails } from './environment-guardrails'
import { createId } from './query-defaults'

export function simulateExecution(
  connection: ConnectionProfile,
  environment: EnvironmentProfile,
  resolvedEnvironment: ResolvedEnvironment,
  tab: QueryTabState,
): { guardrail: GuardrailDecision; result?: ExecutionResultEnvelope } {
  const guardrail = evaluateGuardrails(
    connection,
    environment,
    resolvedEnvironment,
    tab.queryText,
    true,
  )

  if (guardrail.status === 'block') {
    return { guardrail }
  }

  const executedAt = new Date().toISOString()
  let payloads: ResultPayload[]
  let summary: string
  let rendererModes: ExecutionResultEnvelope['rendererModes']
  let defaultRenderer: ExecutionResultEnvelope['defaultRenderer']

  if (connection.family === 'document') {
    payloads = documentPayloads(tab.queryViewMode === 'script')
    summary =
      tab.queryViewMode === 'script'
        ? '2 documents returned from MongoDB script preview.'
        : '2 documents returned from MongoDB adapter preview.'
    rendererModes = ['document', 'json', 'raw', 'table']
    defaultRenderer = 'document'
  } else if (connection.family === 'keyvalue') {
    payloads = keyValuePayloads(executedAt)
    summary = 'Redis key inspection simulated successfully.'
    rendererModes = ['keyvalue', 'json', 'raw']
    defaultRenderer = 'keyvalue'
  } else if (connection.family === 'graph') {
    payloads = graphPayloads(connection.engine)
    summary = 'Graph preview returned 2 nodes and 1 relationship.'
    rendererModes = ['graph', 'table', 'json']
    defaultRenderer = 'graph'
  } else if (connection.family === 'timeseries') {
    payloads = timeSeriesPayloads(executedAt)
    summary = 'Time-series preview returned 1 series.'
    rendererModes = ['series', 'chart', 'metrics']
    defaultRenderer = 'series'
  } else if (connection.family === 'search') {
    payloads = searchPayloads(connection.engine)
    summary = 'Search preview returned 2 hits.'
    rendererModes = ['searchHits', 'json', 'metrics']
    defaultRenderer = 'searchHits'
  } else if (connection.family === 'widecolumn') {
    payloads = wideColumnPayloads(connection.engine)
    summary = 'Wide-column preview returned 2 items.'
    rendererModes = ['table', 'metrics', 'json']
    defaultRenderer = 'table'
  } else {
    payloads = sqlPayloads(connection.engine, executedAt)
    summary = '3 rows returned from SQL adapter preview.'
    rendererModes = ['table', 'schema', 'json']
    defaultRenderer = 'table'
  }

  return {
    guardrail,
    result: {
      id: createId('result'),
      engine: connection.engine,
      summary,
      defaultRenderer,
      rendererModes,
      payloads,
      notices:
        guardrail.status === 'confirm'
          ? [
              {
                code: 'guardrail-confirm',
                level: 'warning',
                message: guardrail.reasons[0] ?? 'Confirmation required.',
              },
            ]
          : [],
      executedAt,
      durationMs: 184,
      truncated: true,
      rowLimit: 500,
      pageInfo: {
        pageSize: 500,
        pageIndex: 0,
        bufferedRows: resultPayloadSize(payloads[0]),
        hasMore: true,
      },
    },
  }
}

function documentPayloads(isScript = false): ResultPayload[] {
  const documents = [
    {
      _id: 'itm-2048',
      sku: 'luna-lamp',
      inventory: { reserved: 4, available: 18 },
      channels: ['web', 'store', 'partner'],
    },
    {
      _id: 'itm-2049',
      sku: 'aurora-desk',
      inventory: { reserved: 1, available: 8 },
      channels: ['web'],
    },
  ]

  return [
    {
      renderer: 'document',
      documents,
    },
    {
      renderer: 'json',
      value: isScript
        ? {
            statements: [
              {
                statement: 1,
                operation: 'find',
                collection: 'products',
                documents,
              },
            ],
            documents,
          }
        : {
            status: 'ok',
            sampleCount: 2,
          },
    },
    {
      renderer: 'raw',
      text: JSON.stringify(isScript ? { statements: 1, documents } : documents, null, 2),
    },
  ]
}

function keyValuePayloads(executedAt: string): ResultPayload[] {
  return [
    {
      renderer: 'keyvalue',
      entries: {
        userId: 'a1b2c3',
        region: 'eu-west-1',
        lastSeenAt: executedAt,
        flags: 'mfa, trusted-device',
      },
      ttl: '23m 11s',
      memoryUsage: '4.8 KB',
    },
    {
      renderer: 'raw',
      text: 'SCAN 0 MATCH session:* COUNT 25\nHGETALL session:9f2d7e1a\nTTL session:9f2d7e1a',
    },
  ]
}

function graphPayloads(engine: ConnectionProfile['engine']): ResultPayload[] {
  return [
    {
      renderer: 'graph',
      nodes: [
        { id: 'customer-1', label: 'Customer', kind: 'node' },
        { id: 'order-1', label: 'Order', kind: 'node' },
      ],
      edges: [
        {
          id: 'placed-1',
          from: 'customer-1',
          to: 'order-1',
          label: 'PLACED',
          kind: 'relationship',
        },
      ],
    },
    {
      renderer: 'table',
      columns: ['from', 'relationship', 'to'],
      rows: [['Customer', 'PLACED', 'Order']],
    },
    {
      renderer: 'json',
      value: {
        engine,
        nodeCount: 2,
        edgeCount: 1,
      },
    },
  ]
}

function timeSeriesPayloads(executedAt: string): ResultPayload[] {
  return [
    {
      renderer: 'series',
      series: [
        {
          name: 'request_rate',
          unit: 'rps',
          points: [
            { timestamp: executedAt, value: 42 },
            { timestamp: executedAt, value: 47 },
          ],
        },
      ],
    },
    {
      renderer: 'chart',
      chartType: 'line',
      xAxis: 'time',
      yAxis: 'request_rate',
      series: [
        {
          name: 'request_rate',
          points: [
            { x: 't-1', y: 42 },
            { x: 't', y: 47 },
          ],
        },
      ],
    },
    {
      renderer: 'metrics',
      metrics: [
        { name: 'series_returned', value: 1 },
        { name: 'points_returned', value: 2 },
      ],
    },
  ]
}

function searchPayloads(engine: ConnectionProfile['engine']): ResultPayload[] {
  return [
    {
      renderer: 'searchHits',
      total: 2,
      hits: [
        {
          id: 'doc-1',
          score: 1.23,
          source: { title: 'Universal connector', status: 'active' },
        },
        {
          id: 'doc-2',
          score: 0.94,
          source: { title: 'Roadmap backlog', status: 'planned' },
        },
      ],
      aggregations: {
        status: { active: 1, planned: 1 },
      },
    },
    {
      renderer: 'metrics',
      metrics: [
        { name: 'hits_total', value: 2 },
        { name: 'took_ms', value: 8, unit: 'ms' },
      ],
    },
    {
      renderer: 'json',
      value: {
        engine,
        total: 2,
        aggregations: { status: { active: 1, planned: 1 } },
      },
    },
  ]
}

function wideColumnPayloads(engine: ConnectionProfile['engine']): ResultPayload[] {
  return [
    {
      renderer: 'table',
      columns: ['partition_key', 'sort_key', 'status'],
      rows: [
        ['CUSTOMER#123', 'ORDER#1001', 'open'],
        ['CUSTOMER#123', 'ORDER#1002', 'closed'],
      ],
    },
    {
      renderer: 'metrics',
      metrics: [
        { name: 'items_returned', value: 2 },
        { name: 'read_units', value: 1.5 },
      ],
    },
    {
      renderer: 'json',
      value: {
        engine,
        itemCount: 2,
      },
    },
  ]
}

function sqlPayloads(engine: ConnectionProfile['engine'], executedAt: string): ResultPayload[] {
  return [
    {
      renderer: 'table',
      columns: ['table_name', 'rows_estimate', 'last_vacuum'],
      rows: [
        ['accounts', '128804', '2026-04-23 14:10'],
        ['transactions', '9843212', '2026-04-23 13:58'],
        ['alerts', '440', '2026-04-23 14:02'],
      ],
    },
    {
      renderer: 'schema',
      items: [
        { label: 'accounts', detail: 'pk_accounts, idx_accounts_email' },
        { label: 'transactions', detail: 'pk_transactions, idx_txn_created' },
      ],
    },
    {
      renderer: 'json',
      value: {
        adapter: engine,
        rowCount: 3,
        executedAt,
      },
    },
  ]
}

function resultPayloadSize(payload: ResultPayload | undefined) {
  if (!payload) {
    return 0
  }

  if (payload.renderer === 'table') {
    return Array.isArray(payload.rows) ? payload.rows.length : 0
  }

  if (payload.renderer === 'document') {
    return Array.isArray(payload.documents) ? payload.documents.length : 0
  }

  if (payload.renderer === 'keyvalue') {
    return payload.entries && typeof payload.entries === 'object' && !Array.isArray(payload.entries)
      ? Object.keys(payload.entries).length
      : 0
  }

  if (payload.renderer === 'schema') {
    return Array.isArray(payload.items) ? payload.items.length : 0
  }

  return 1
}
