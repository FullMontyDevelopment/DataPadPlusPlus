import { describe, expect, it } from 'vitest'
import type { ExecutionRequest } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import { applyExecutionRequestLocally } from '../../../src/services/runtime/browser-execution'
import { browserResultExportContext, captureBrowserResultSession, fetchBrowserSessionPage } from '../../../src/services/runtime/browser-result-sessions'

function run(maximum: number | null) {
  const snapshot = createSeedSnapshot()
  snapshot.preferences.queryResults = { fetchBatchSize: 500, maximumLoadedRows: maximum, maximumExportedRows: null }
  const tab = snapshot.tabs.find(item => item.id === 'tab-sql-ops')!
  const request: ExecutionRequest = {
    tabId: tab.id, connectionId: tab.connectionId, environmentId: tab.environmentId,
    language: tab.language, queryText: tab.queryText, rowLimit: 500,
  }
  const executed = applyExecutionRequestLocally(snapshot, request)
  const result = executed.response.result!
  result.payloads = [{ renderer: 'table', columns: ['id', 'name'], rows: Array.from({ length: 500 }, (_, id) => [String(id), 'source']) }]
  result.defaultRenderer = 'table'
  result.pageInfo = { pageSize: 500, pageIndex: 0, bufferedRows: 500, hasMore: true }
  captureBrowserResultSession(executed.snapshot, request, executed.response)
  return { ...executed, request, result }
}

describe('browser result sessions', () => {
  it('caps the first batch without using zero as unlimited', () => {
    const { result } = run(2)
    expect(result.payloads[0]).toMatchObject({ rows: [['0', 'source'], ['1', 'source']] })
    expect(result.pageInfo).toMatchObject({ bufferedRows: 2, hasMore: false })
  })

  it('keeps the original batch and cumulative cap after settings and drafts change', () => {
    const { snapshot, request, result } = run(650)
    snapshot.preferences.queryResults!.maximumLoadedRows = null
    snapshot.preferences.queryResults!.fetchBatchSize = 250
    expect(browserResultExportContext(snapshot, request.tabId, result.id)).toMatchObject({
      fetchBatchSize: 500, maximumLoadedRows: 650, fullQuerySupported: false,
    })
    const page = fetchBrowserSessionPage(snapshot, {
      ...request, queryText: 'select changed_draft', renderer: 'table', resultId: result.id,
      pageSize: 1, pageIndex: 1,
    })
    expect(page.payload).toMatchObject({ renderer: 'table' })
    if (page.payload.renderer !== 'table') throw new Error('table expected')
    expect(page.payload.rows).toHaveLength(150)
    expect(page.payload.rows[0]?.[0]).toBe('501')
    expect(page.pageInfo).toMatchObject({ pageSize: 500, bufferedRows: 650, hasMore: false })
    expect(() => fetchBrowserSessionPage(snapshot, { ...request, renderer: 'table', resultId: result.id, pageIndex: 1 })).toThrow()
  })

  it('accumulates 1500 with unlimited totals and rejects replaced results', () => {
    const { snapshot, request, result } = run(null)
    for (const index of [1, 2]) {
      const page = fetchBrowserSessionPage(snapshot, { ...request, renderer: 'table', resultId: result.id, pageIndex: index })
      expect(page.pageInfo.bufferedRows).toBe((index + 1) * 500)
    }
    const another = run(null)
    expect(() => fetchBrowserSessionPage(another.snapshot, { ...request, renderer: 'table', resultId: result.id, pageIndex: 1 })).toThrow(/changed/)
  })
})
