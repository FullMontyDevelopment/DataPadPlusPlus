import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConnectionProfile, DataEditExecutionResponse, DocumentNodeChildrenRequest, DocumentNodeChildrenResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { DocumentResultsView } from '../../../../../src/app/components/workbench/results/DocumentResultsView'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 30 })),
    measureElement: vi.fn(),
  }),
}))
vi.mock('../../../../../src/app/components/workbench/DesktopCodeEditor', () => ({
  DesktopCodeEditor: ({ ariaLabel, value, onChange, readOnly }: { ariaLabel: string; value: string; onChange(value: string): void; readOnly: boolean }) =>
    <textarea aria-label={ariaLabel} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />,
}))

const connection: ConnectionProfile = {
  id: 'mongo', name: 'Fixture Mongo', engine: 'mongodb', family: 'document', host: 'localhost',
  database: 'fixture', environmentIds: ['dev'], tags: [], favorite: false, readOnly: false,
  icon: 'mongodb', auth: {}, createdAt: '', updatedAt: '',
}
const lazy = (type = 'object') => ({ __datapadLazyNode: true, type, childCount: 1, path: ['nested'], loaded: false })
const full = { _id: 'one', name: 'before', nested: { array: [1, { untouched: 'keep' }] }, date: { $date: '2026-09-10T00:00:00.000Z' } }
const preview = () => ({ ...full, nested: lazy() })
const success = (document: Record<string, unknown>): DataEditExecutionResponse => ({
  executed: true, messages: ['Saved.'], warnings: [], metadata: { documentEvidence: { beforeDocument: full, afterDocument: document } },
} as DataEditExecutionResponse)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const hydrated = (request: DocumentNodeChildrenRequest, value: unknown = full): DocumentNodeChildrenResponse => ({
  tabId: request.tabId, documentId: request.documentId, path: request.path, value, notices: [],
})
function setup(overrides: Partial<Parameters<typeof DocumentResultsView>[0]> = {}) {
  const fetch = vi.fn(async (request: DocumentNodeChildrenRequest) => hydrated(request))
  const execute = vi.fn(async () => success({ ...full, name: 'after' }))
  const props = {
    connection, documents: [preview(), { _id: 'two', nested: lazy() }],
    editContext: { connectionId: 'mongo', environmentId: 'dev', database: 'fixture', collection: 'items', queryText: '{}' },
    database: 'fixture', collection: 'items', tabId: 'tab', hydrationMode: 'lazy' as const,
    editMetadata: { adapterStrategy: 'mongodb' as const, protectedPaths: [['_id']] },
    onFetchDocumentNodeChildren: fetch, onExecuteDataEdit: execute, ...overrides,
  }
  const view = render(<DocumentResultsView {...props} />)
  return { ...view, props, fetch, execute }
}
async function expand() {
  // Let initial result/scope reset effects settle before user interaction.
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Expand one' }))
}
function fieldRow(field: string): HTMLElement {
  const fieldElement = document.querySelector(`[data-field-path="${field}"]`)
  if (!fieldElement) throw new Error(`Missing field ${field}`)
  return fieldElement.closest('[role="row"]') as HTMLElement
}
function inline(field = 'name') {
  fireEvent.doubleClick(fieldRow(field).querySelector('.document-data-grid-value')!)
}
async function menu(field: string | undefined, action: string) {
  const row = field ? fieldRow(field) : screen.getByRole('button', { name: 'Collapse one' }).closest('[role="row"]')!
  fireEvent.contextMenu(row)
  fireEvent.click(await screen.findByRole('menuitem', { name: action, exact: true }))
}

describe('efficiency-mode document editing', () => {
  it('loads only the selected root before inline editing and reuses authoritative evidence for repeated edits', async () => {
    const { fetch, execute } = setup()
    await expand()
    inline()
    const input = await screen.findByRole('textbox', { name: 'Edit value name' })
    expect(input).toHaveValue('before')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'one', path: [], mode: 'full-value' }))
    expect(screen.getByRole('button', { name: 'Expand nested' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit value name' })).not.toBeInTheDocument())
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ expectedDocument: full }) }))
    inline()
    expect(await screen.findByRole('textbox', { name: 'Edit value name' })).toHaveValue('after')
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit value name' }), { target: { value: 'again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ expectedDocument: { ...full, name: 'after' } }) }))
  })

  it('preserves a draft after a genuine conflict and never silently retries or reloads its baseline', async () => {
    const conflict = vi.fn(async () => ({ executed: false, messages: [], warnings: ['The document changed.'] } as unknown as DataEditExecutionResponse))
    const { fetch } = setup({ onExecuteDataEdit: conflict })
    await expand()
    inline()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit value name' }), { target: { value: 'my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(await screen.findByText('The document changed.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Edit value name' })).toHaveValue('my draft')
    expect(conflict).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['changed', 'missing'])('refreshes and requires review when the selected field is %s during loading', async (kind) => {
    const changed: Record<string, unknown> = { ...full, name: 'changed' }
    if (kind === 'missing') delete changed.name
    const { execute } = setup({ onFetchDocumentNodeChildren: async (request) => hydrated(request, changed) })
    await expand()
    inline()
    expect(await screen.findByText(/selected value changed while loading/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit value name' })).not.toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'refresh', 'scope', 'lock', 'reorder', 'unmount'])('ignores preparation after %s and suppresses duplicate requests', async (reason) => {
    const pending = deferred<DocumentNodeChildrenResponse>()
    const fetch = vi.fn(() => pending.promise)
    const { props, rerender, execute, unmount } = setup({ onFetchDocumentNodeChildren: fetch })
    await expand()
    inline()
    inline()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Loading complete document/)).toBeInTheDocument()
    if (reason === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }))
    if (reason === 'refresh') rerender(<DocumentResultsView {...props} documents={[preview()]} />)
    if (reason === 'reorder') rerender(<DocumentResultsView {...props} documents={[props.documents[1]!, props.documents[0]!]} />)
    if (reason === 'scope') rerender(<DocumentResultsView {...props} collection="other" />)
    if (reason === 'lock') rerender(<DocumentResultsView {...props} executionLocked />)
    if (reason === 'unmount') unmount()
    await act(async () => pending.resolve({ tabId: 'tab', documentId: 'one', path: [], value: full, notices: [] }))
    expect(screen.queryByRole('textbox', { name: 'Edit value name' })).not.toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps results unchanged after a loading failure and permits retry', async () => {
    const fetch = vi.fn<(request: DocumentNodeChildrenRequest) => Promise<DocumentNodeChildrenResponse>>()
      .mockRejectedValueOnce(new Error('Fixture hydration failed'))
      .mockImplementation(async (request) => hydrated(request))
    const { execute } = setup({ onFetchDocumentNodeChildren: fetch })
    await expand()
    inline()
    expect(await screen.findByText('Fixture hydration failed')).toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
    inline()
    expect(await screen.findByRole('textbox', { name: 'Edit value name' })).toHaveValue('before')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([null, [], { ...full, _id: 'wrong' }, { ...full, nested: lazy() }, { ...full, nested: { __datapadLazyNode: true } }, { ...full, nested: { __datapadTruncated: true } }, { ...full, nested: { __datapadUnsupported: true } }])('rejects incomplete or incorrectly identified hydration %#', async (value) => {
    const { execute } = setup({ onFetchDocumentNodeChildren: async (request) => hydrated(request, value) })
    await expand()
    inline()
    expect(await screen.findByText(/could not be loaded losslessly/)).toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
  })

  it('discards older subtree responses after full preparation without altering expansion state', async () => {
    const child = deferred<DocumentNodeChildrenResponse>()
    const fetch = vi.fn((request: DocumentNodeChildrenRequest) => request.path.length ? child.promise : Promise.resolve(hydrated(request)))
    const { execute } = setup({ onFetchDocumentNodeChildren: fetch })
    await expand()
    fireEvent.click(screen.getByRole('button', { name: 'Expand nested' }))
    inline()
    const input = await screen.findByRole('textbox', { name: 'Edit value name' })
    await act(async () => child.resolve({ tabId: 'tab', documentId: 'one', path: ['nested'], value: { array: lazy('array') }, notices: [] }))
    expect(screen.getByRole('button', { name: 'Expand nested' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ expectedDocument: full }) })))
  })

  it.each(['Rename Field', 'Add Field', 'Remove Field', 'Edit Raw JSON', 'Delete Document'])('prepares before opening %s', async (action) => {
    const { fetch, execute } = setup()
    await expand()
    await menu(action === 'Delete Document' ? undefined : 'name', action)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ path: [], mode: 'full-value' })))
    if (action === 'Rename Field') {
      const input = await screen.findByRole('textbox', { name: 'Rename field name' })
      fireEvent.change(input, { target: { value: 'title' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    } else if (action === 'Add Field') {
      fireEvent.change(await screen.findByRole('textbox', { name: 'New field name' }), { target: { value: 'added' } })
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Add document field' })).getByRole('button', { name: 'Add Field' }))
    } else if (action === 'Edit Raw JSON') {
      const input = await screen.findByRole('textbox', { name: 'Edit selected value raw JSON' })
      fireEvent.change(input, { target: { value: '"after"' } })
      fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    } else {
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    }
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ expectedDocument: full }) })))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves typed BSON dates when editing', async () => {
    const { execute } = setup()
    await expand()
    inline('date')
    const input = await screen.findByRole('textbox', { name: 'Edit value date' })
    expect(input).toHaveValue('2026-09-10T00:00:00.000Z')
    fireEvent.change(input, { target: { value: '2026-09-11T00:00:00Z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ changes: [expect.objectContaining({ value: { $date: '2026-09-11T00:00:00.000Z' } })] })))
  })

  it('does not hydrate full-mode results', async () => {
    const { fetch, execute } = setup({ documents: [full], hydrationMode: 'full' })
    await expand()
    inline()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit value name' }), { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalled())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('prepares nested fields in a partially expanded document without collapsing the tree', async () => {
    const loaded = { ...full, nested: { ready: 'nested value', array: [1, 2] } }
    const { execute } = setup({
      documents: [{ ...loaded, nested: { ready: 'nested value', array: lazy('array') } }],
      onFetchDocumentNodeChildren: async (request) => hydrated(request, loaded),
    })
    await expand()
    fireEvent.click(screen.getByRole('button', { name: 'Expand nested' }))
    inline('nested.ready')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit value nested.ready' }), { target: { value: 'changed' } })
    expect(screen.getByRole('button', { name: 'Collapse nested' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand array' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ expectedDocument: loaded }), changes: [expect.objectContaining({ path: ['nested', 'ready'] })] })))
  })

  it('prepares whole-document raw editing and revalidates protected identity', async () => {
    const { execute } = setup()
    await expand()
    await menu(undefined, 'Edit Raw JSON')
    const input = await screen.findByRole('textbox', { name: 'Edit selected value raw JSON' })
    expect(input).toHaveValue(JSON.stringify(full, null, 2))
    fireEvent.change(input, { target: { value: JSON.stringify({ ...full, _id: 'wrong' }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Protected field _id')
    fireEvent.change(input, { target: { value: JSON.stringify({ ...full, name: 'after' }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ editKind: 'update-document', target: expect.objectContaining({ expectedDocument: full }) })))
  })

  it.each(['Edit Raw JSON', 'type'])('prepares edits initiated from the read-only JSON inspector: %s', async (action) => {
    const { fetch, execute } = setup()
    await expand()
    await menu('name', 'View Raw JSON')
    await screen.findByRole('textbox', { name: 'Selected field raw JSON' })
    expect(fetch).not.toHaveBeenCalled()
    if (action === 'type') {
      fireEvent.change(screen.getByRole('combobox', { name: 'Change inspected field type name' }), { target: { value: 'boolean' } })
      await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ editKind: 'change-field-type', target: expect.objectContaining({ expectedDocument: full }) })))
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Edit Raw JSON' }))
      await screen.findByRole('textbox', { name: 'Edit selected value raw JSON' })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit Raw JSON' }))
      await screen.findByRole('textbox', { name: 'Edit selected value raw JSON' })
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ path: [], mode: 'full-value' }))
  })

  it('blocks same-document expansion while preparation is running', async () => {
    const pending = deferred<DocumentNodeChildrenResponse>()
    const fetch = vi.fn(() => pending.promise)
    setup({ onFetchDocumentNodeChildren: fetch })
    await expand()
    inline()
    fireEvent.click(screen.getByRole('button', { name: 'Expand nested' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ tabId: 'tab', documentId: 'one', path: [], value: full, notices: [] }))
    expect(await screen.findByRole('textbox', { name: 'Edit value name' })).toBeInTheDocument()
  })

  it('keeps raw and Add Field drafts after failed writes', async () => {
    const execute = vi.fn(async () => ({ executed: false, messages: [], warnings: ['Conflict.'] } as unknown as DataEditExecutionResponse))
    setup({ onExecuteDataEdit: execute })
    await expand()
    await menu('name', 'Add Field')
    fireEvent.change(await screen.findByRole('textbox', { name: 'New field name' }), { target: { value: 'added' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'New field value' }), { target: { value: 'draft' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Field' }))
    await screen.findByText('Conflict.')
    expect(screen.getByRole('textbox', { name: 'New field value' })).toHaveValue('draft')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await menu('name', 'Edit Raw JSON')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit selected value raw JSON' }), { target: { value: '"raw draft"' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Edit selected value raw JSON' })).toHaveValue('"raw draft"')
  })

  it('ignores a successful old write response after the result is replaced', async () => {
    const pending = deferred<DataEditExecutionResponse>()
    const { props, rerender } = setup({ onExecuteDataEdit: () => pending.promise })
    await expand()
    inline()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit value name' }), { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    rerender(<DocumentResultsView {...props} documents={[{ _id: 'other', name: 'new result' }]} />)
    await act(async () => pending.resolve(success({ ...full, name: 'after' })))
    expect(screen.getByRole('button', { name: 'other', exact: true })).toBeInTheDocument()
    expect(screen.queryByText('after')).not.toBeInTheDocument()
  })
})
