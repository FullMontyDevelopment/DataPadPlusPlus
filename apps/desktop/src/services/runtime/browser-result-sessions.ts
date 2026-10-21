import type { ExecutionRequest, ExecutionResponse, ResultExportContext, ResultPageRequest, ResultPageResponse, ResultPayload, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { fetchResultPageLocally } from './browser-structure'

interface BrowserResultSession {
  resultId: string
  request: ExecutionRequest
  maximum: number | null
  loaded: number
  pageIndex: number
  hasMore: boolean
  pageSize: number
  context: Pick<ResultExportContext, 'connectionName' | 'environmentName' | 'database' | 'schema'>
}

// Preview-only, runtime state. Neither requests nor results go into localStorage.
const sessions = new Map<string, BrowserResultSession>()

function prune(snapshot: WorkspaceSnapshot) {
  for (const [tabId, session] of sessions) {
    if (!snapshot.tabs.some(tab => tab.id === tabId && tab.result?.id === session.resultId)) sessions.delete(tabId)
  }
}

export function captureBrowserResultSession(snapshot: WorkspaceSnapshot, request: ExecutionRequest, response: ExecutionResponse) {
  prune(snapshot)
  const result = response.result
  if (!result) return
  const maximum = snapshot.preferences.queryResults?.maximumLoadedRows ?? null
  if (maximum !== null) result.payloads = result.payloads.map(payload => limitPayload(payload, maximum))
  const primary = result.payloads.find(payload => payload.renderer === result.defaultRenderer)
  const loaded = payloadSize(primary)
  const capped = maximum !== null && loaded >= maximum
  if (result.pageInfo) {
    result.pageInfo = { ...result.pageInfo, bufferedRows: loaded, hasMore: result.pageInfo.hasMore && !capped }
    if (capped) result.notices.push({ code: 'result-loaded-limit', level: 'info', message: 'Maximum loaded rows reached. Change Queries & Results settings and run again to load more.' })
  }
  const tab = snapshot.tabs.find(tab => tab.id === request.tabId)
  if (tab) tab.result = result
  response.tab.result = result
  sessions.set(request.tabId, {
    resultId: result.id, request: structuredClone(request), maximum, loaded,
    pageIndex: result.pageInfo?.pageIndex ?? 0,
    hasMore: result.pageInfo?.hasMore ?? false,
    pageSize: result.pageInfo?.pageSize ?? request.rowLimit ?? 500,
    context: {
      connectionName: snapshot.connections.find(connection => connection.id === request.connectionId)?.name,
      environmentName: snapshot.environments.find(environment => environment.id === request.environmentId)?.label,
      database: request.sqlScope?.database,
      schema: request.sqlScope?.schema,
    },
  })
}

export function browserResultExportContext(snapshot: WorkspaceSnapshot, tabId: string, resultId: string): ResultExportContext {
  prune(snapshot)
  const session = sessions.get(tabId)
  if (session && session.resultId !== resultId) throw new Error('The result changed. Export the current result instead.')
  return {
    ...session?.context,
    fetchBatchSize: session?.pageSize,
    maximumLoadedRows: session?.maximum,
    maximumExportedRows: snapshot.preferences.queryResults?.maximumExportedRows ?? null,
    fullQuerySupported: false,
  }
}

export function fetchBrowserSessionPage(snapshot: WorkspaceSnapshot, request: ResultPageRequest): ResultPageResponse {
  prune(snapshot)
  const session = sessions.get(request.tabId)
  if (!session || session.resultId !== request.resultId || !session.hasMore ||
      request.pageIndex !== session.pageIndex + 1) {
    throw new Error('The result changed or has no further pages. Run the query again.')
  }
  const page = fetchResultPageLocally(snapshot, {
    ...request,
    connectionId: session.request.connectionId,
    environmentId: session.request.environmentId,
    queryText: session.request.queryText,
    selectedText: session.request.selectedText,
    sqlScope: session.request.sqlScope,
    scopedTarget: session.request.scopedTarget,
    pageSize: session.pageSize,
    renderer: snapshot.tabs.find(tab => tab.id === request.tabId)?.result?.payloads.some(payload => payload.renderer === 'document')
      ? 'document' : request.renderer,
  })
  if (session.maximum !== null) page.payload = limitPayload(page.payload, Math.max(0, session.maximum - session.loaded))
  session.loaded += payloadSize(page.payload)
  session.pageIndex = page.pageInfo.pageIndex
  const capped = session.maximum !== null && session.loaded >= session.maximum
  session.hasMore = page.pageInfo.hasMore && !capped
  page.resultId = session.resultId
  page.pageInfo = { ...page.pageInfo, bufferedRows: session.loaded, hasMore: session.hasMore }
  if (capped) page.notices.push('Maximum loaded rows reached. Change Queries & Results settings and run again to load more.')
  return page
}

function payloadSize(payload?: ResultPayload): number {
  if (payload?.renderer === 'document') return payload.documents.length
  if (payload?.renderer === 'table') return payload.rows.length
  if (payload?.renderer === 'keyvalue') return payload.entries
    ? Object.keys(payload.entries).length : payload.members?.length ?? (payload.value !== undefined ? 1 : 0)
  if (payload?.renderer === 'schema') return payload.items.length
  return 0
}

function limitPayload(payload: ResultPayload, maximum: number): ResultPayload {
  if (payload.renderer === 'document') return { ...payload, documents: payload.documents.slice(0, maximum) }
  if (payload.renderer === 'table') return { ...payload, rows: payload.rows.slice(0, maximum) }
  if (payload.renderer === 'keyvalue') return {
    ...payload,
    entries: Object.fromEntries(Object.entries(payload.entries ?? {}).slice(0, maximum)),
    members: payload.members?.slice(0, maximum),
  }
  if (payload.renderer === 'schema') return { ...payload, items: payload.items.slice(0, maximum) }
  return payload
}
