import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPayload, ExecutionResultEnvelope, ResultPayload } from '@datapadplusplus/shared-types'
import { ResultExportDialog } from '../../../../src/app/components/workbench/results/ResultExportDialog'

const mocks = vi.hoisted(() => ({
  desktop: true,
  context: vi.fn(),
  cancel: vi.fn(),
  format: vi.fn(),
}))
vi.mock('../../../../src/services/runtime/desktop-bridge', () => ({ isTauriRuntime: () => mocks.desktop }))
vi.mock('../../../../src/services/runtime/client', () => ({
  desktopClient: { getResultExportContext: mocks.context, cancelResultExport: mocks.cancel },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('../../../../src/app/components/workbench/results/payload-export-background', () => ({
  createResultExportFileInBackground: mocks.format,
}))

const payload = {
  renderer: 'document', hydrationMode: 'lazy', collection: 'orders',
  documents: Array.from({ length: 1500 }, (_, id) => ({ _id: id, nested: { __datapadLazyNode: true } })),
} as DocumentPayload
const result = {
  id: 'original-result', engine: 'mongodb', executedAt: '2026-10-20T10:00:00Z',
  defaultRenderer: 'document', payloads: [payload],
} as ExecutionResultEnvelope

describe('result export source and context', () => {
  beforeEach(() => {
    mocks.desktop = true
    mocks.context.mockResolvedValue({
      connectionName: 'Fixture Mongo', environmentName: 'UAT', database: 'catalog',
      fetchBatchSize: 500, fullQuerySupported: true, maximumExportedRows: null,
    })
    mocks.cancel.mockResolvedValue(true)
    mocks.format.mockResolvedValue({ contents: '[]', extension: 'json', mimeType: 'application/json', suggestedFileName: 'fixture' })
  })
  afterEach(() => vi.clearAllMocks())

  it('exports every accumulated document by session reference, never lazy placeholders', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<ResultExportDialog payload={payload} result={result} tabId="original-tab" onCancel={vi.fn()} onExport={onExport} />)
    expect(screen.getByRole('radio', { name: /Loaded results \(1.500\)/ })).toBeChecked()
    await screen.findByText('Fixture Mongo / UAT / catalog')
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    expect(onExport.mock.calls[0][0]).toMatchObject({
      resultReference: { tabId: 'original-tab', resultId: 'original-result', loadedRows: 1500, scope: 'loaded' },
    })
    expect(onExport.mock.calls[0][0].contents).toBeUndefined()
    expect(mocks.format).not.toHaveBeenCalled()
  })

  it('selects full results without sending current editor text or mutable connection settings', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<ResultExportDialog payload={payload} result={result} tabId="original-tab" onCancel={vi.fn()} onExport={onExport} />)
    await waitFor(() => expect(screen.getByLabelText('Full query results')).toBeEnabled())
    fireEvent.click(screen.getByLabelText('Full query results'))
    expect(screen.getByText(/data may have changed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    const request = onExport.mock.calls[0][0]
    expect(request.resultReference.scope).toBe('full-query')
    for (const key of ['queryText', 'connectionId', 'environmentId', 'sqlScope']) expect(request).not.toHaveProperty(key)
  })

  it('exports the canonical accumulated documents from an alternate JSON view', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<ResultExportDialog payload={{ renderer: 'json', value: payload.documents }} result={result} tabId="original-tab" onCancel={vi.fn()} onExport={onExport} />)
    await screen.findByText('Fixture Mongo / UAT / catalog')
    expect(screen.getByRole('radio', { name: /Loaded results \(1.500\)/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    expect(onExport.mock.calls[0][0].resultReference).toMatchObject({ renderer: 'document', loadedRows: 1500, scope: 'loaded' })
    expect(mocks.format).not.toHaveBeenCalled()
  })

  it.each([
    { renderer: 'keyvalue', entries: { sample: 'value' } },
    { renderer: 'raw', text: 'sample' },
    { renderer: 'graph', nodes: [], edges: [] },
  ])('offers native full export independently of the $renderer presentation', async value => {
    const alternate = value as ResultPayload
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<ResultExportDialog payload={alternate} result={{ ...result, payloads: [alternate] }} tabId="original-tab" onCancel={vi.fn()} onExport={onExport} />)
    await waitFor(() => expect(screen.getByLabelText('Full query results')).toBeEnabled())
    fireEvent.click(screen.getByLabelText('Full query results'))
    expect(screen.getByRole('radio', { name: /^JSON/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    expect(onExport.mock.calls[0][0]).toMatchObject({
      resultReference: { tabId: 'original-tab', resultId: result.id, renderer: alternate.renderer, scope: 'full-query', format: 'json' },
    })
    expect(mocks.format).not.toHaveBeenCalled()
  })

  it('keeps the captured reference stable while later results load and supports cancellation', async () => {
    const pending = Promise.withResolvers<void>()
    const onExport = vi.fn(() => pending.promise)
    const props = { payload, result, tabId: 'original-tab', onCancel: vi.fn(), onExport }
    const { rerender } = render(<ResultExportDialog {...props} />)
    await screen.findByText('Fixture Mongo / UAT / catalog')
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    rerender(<ResultExportDialog {...props} payload={{ ...payload, documents: [...payload.documents, { _id: 1500 }] }} />)
    expect(onExport.mock.calls[0][0].resultReference.loadedRows).toBe(1500)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }))
    expect(mocks.cancel).toHaveBeenCalledWith(onExport.mock.calls[0][0].exportId)
    expect(props.onCancel).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
  })

  it('does not offer live full-query execution in browser preview', () => {
    mocks.desktop = false
    render(<ResultExportDialog payload={payload} result={result} tabId="original-tab" onCancel={vi.fn()} onExport={vi.fn()} />)
    expect(screen.getByLabelText('Full query results')).toBeDisabled()
    expect(mocks.context).toHaveBeenCalledWith('original-tab', 'original-result')
  })

  it('waits for the matching result context and ignores stale context responses', async () => {
    const first = Promise.withResolvers<object>()
    const next = Promise.withResolvers<object>()
    mocks.context.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
    const props = { payload, result, tabId: 'original-tab', onCancel: vi.fn(), onExport: vi.fn() }
    const { rerender } = render(<ResultExportDialog {...props} />)
    expect(screen.getByRole('button', { name: 'Save As' })).toBeDisabled()
    rerender(<ResultExportDialog {...props} result={{ ...result, id: 'next-result' }} />)
    await act(async () => first.resolve({ connectionName: 'Wrong connection', fullQuerySupported: true }))
    expect(screen.getByRole('button', { name: 'Save As' })).toBeDisabled()
    expect(screen.queryByText('Wrong connection')).not.toBeInTheDocument()
    await act(async () => next.resolve({ connectionName: 'Correct connection', fullQuerySupported: false }))
    expect(screen.getByRole('button', { name: 'Save As' })).toBeEnabled()
    expect(screen.getByText('Correct connection')).toBeInTheDocument()
    expect(screen.getByLabelText('Full query results')).toBeDisabled()
  })

  it('restores focus and closes on Escape without starting an export', async () => {
    const origin = document.createElement('button')
    document.body.append(origin)
    origin.focus()
    const onCancel = vi.fn()
    const { unmount } = render(<ResultExportDialog payload={payload} onCancel={onCancel} onExport={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Loaded results \(1.500\)/ })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    unmount()
    expect(origin).toHaveFocus()
    origin.remove()
  })
})
