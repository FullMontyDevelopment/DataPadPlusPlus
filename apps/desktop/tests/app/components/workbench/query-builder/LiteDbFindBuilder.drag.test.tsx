import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, LiteDbFindBuilderState, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { QueryBuilderPanel } from '../../../../../src/app/components/workbench/query-builder/QueryBuilderPanel'
import { ResultPayloadView } from '../../../../../src/app/components/workbench/results/ResultPayloadView'
import { buildLiteDbFindQueryText, createDefaultLiteDbFindBuilderState } from '../../../../../src/app/components/workbench/datastores/litedb/litedb-find'
import { liteDbFilterFromDrop } from '../../../../../src/app/components/workbench/datastores/litedb/litedb-filter-drop'
import { moveQueryBuilderFilter } from '../../../../../src/app/components/workbench/query-builder/useQueryBuilderFilterDrag'
import {
  beginFieldPointerDrag, moveFieldPointerDrag, dropFieldPointerDrag, cancelFieldPointerDrag,
  clearFieldDragData, FIELD_DRAG_PAYLOAD_MIME, type FieldDragPayload,
} from '../../../../../src/app/components/workbench/results/field-drag'
import { createSeedSnapshot } from '../../../../fixtures/seed-workspace'

const seed = createSeedSnapshot()
const connection = { ...seed.connections[0], engine: 'litedb', family: 'document' } as ConnectionProfile
const tab = { ...seed.tabs[0], id: 'lite-drag', connectionId: connection.id, status: 'idle', queryText: '', activeExecution: undefined } as QueryTabState
const empty = () => createDefaultLiteDbFindBuilderState('Client')
const row = (id: string, groupId?: string) => ({ id, field: id, groupId, operator: 'eq' as const, valueType: 'string' as const, value: id })
const grouped = (): LiteDbFindBuilderState => ({ ...empty(), filters: [row('name'), row('status')], filterGroups: [{ id: 'g', label: 'Group 1', logic: 'or' }] })
const originalElementFromPoint = document.elementFromPoint

function Harness({ initial = empty(), onChange = vi.fn(), ...props }: {
  initial?: LiteDbFindBuilderState
  onChange?: ReturnType<typeof vi.fn>
} & Partial<ComponentProps<typeof QueryBuilderPanel>>) {
  const [draft, setDraft] = useState<QueryBuilderState>(initial)
  return <QueryBuilderPanel connection={connection} tab={tab} builderState={draft} onCount={vi.fn()}
    onBuilderStateChange={(id, next) => { setDraft(next); onChange(id, next) }} {...props} />
}
const builder = () => screen.getByLabelText('LiteDB query builder')
const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!
const group = () => screen.getByLabelText('Filter group Group 1')
const latest = (change: ReturnType<typeof vi.fn>) => change.mock.calls.at(-1)![1] as LiteDbFindBuilderState

function pointAt(target: Element) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) })
  vi.spyOn(builder(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 } as DOMRect)
}
function pointerDrop(target: Element, payload: FieldDragPayload) {
  pointAt(target)
  act(() => { beginFieldPointerDrag(payload); moveFieldPointerDrag(40, 40) })
  act(() => dropFieldPointerDrag(40, 40))
}
function htmlDrop(target: Element, payload: FieldDragPayload) {
  const dataTransfer = { types: [FIELD_DRAG_PAYLOAD_MIME], getData: (type: string) => type === FIELD_DRAG_PAYLOAD_MIME ? JSON.stringify(payload) : '', dropEffect: 'none' }
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

afterEach(() => {
  clearFieldDragData()
  vi.restoreAllMocks()
  if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint })
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

describe('LiteDB result-field drops', () => {
  it('drags an actual document result into the builder in desktop pointer mode', () => {
    const onChange = vi.fn()
    render(<><ResultPayloadView payload={{ renderer: 'document', documents: [{ _id: 'client-1', name: 'Alice' }] }} /><Harness onChange={onChange} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Expand client-1' }))
    const source = screen.getAllByTitle('Drag name to the query builder').at(-1)!
    pointAt(section('Filters'))
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 600, pointerId: 3 })
    fireEvent.pointerMove(window, { clientX: 18, clientY: 590, pointerId: 3 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 3 })
    expect(section('Filters')).toHaveClass('is-drag-over')
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 3 })
    expect(onChange).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Filter 1 value')).toHaveValue('Alice')
    expect(JSON.parse(latest(onChange).lastAppliedQueryText!).parameters).toEqual({ p0: 'Alice' })
    expect(builder()).not.toHaveClass('is-drag-over')
  })

  it.each([['pointer', pointerDrop], ['HTML', htmlDrop]] as const)('routes %s drops to groups, inputs, root and the single sort without duplicate filters', (_, drop) => {
    const onChange = vi.fn()
    render(<Harness initial={grouped()} onChange={onChange} />)
    drop(group(), { fieldPath: 'age', value: 42 })
    expect(latest(onChange).filters.at(-1)).toMatchObject({ groupId: 'g', field: 'age', valueType: 'number', value: '42' })
    drop(screen.getByLabelText('Filter 3 value'), { fieldPath: 'active', value: false })
    expect(latest(onChange).filters.at(-1)).toMatchObject({ groupId: 'g', field: 'active', valueType: 'boolean', value: 'false' })
    drop(screen.getByLabelText('Ungrouped filters'), { fieldPath: 'name', value: 'Bob' })
    expect(latest(onChange).filters.at(-1)?.groupId).toBeUndefined()
    drop(section('Sort'), { fieldPath: 'age' })
    fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'desc' } })
    drop(screen.getByLabelText('Sort field'), { fieldPath: 'name' })
    expect(latest(onChange).sort).toEqual([expect.objectContaining({ field: 'name', direction: 'desc' })])
    expect(latest(onChange).filters).toHaveLength(5)
    expect(onChange).toHaveBeenCalledTimes(6)
    expect(screen.getByRole('button', { name: 'Count' })).toBeEnabled()
  })

  it.each([
    [{ $date: '2026-10-08T10:00:00.000Z' }, 'date', '2026-10-08T10:00:00.000Z'],
    [{ $guid: '9e107d9d-372b-4f7d-bb3a-17d63746f9a0' }, 'uuid', '9e107d9d-372b-4f7d-bb3a-17d63746f9a0'],
    [{ $oid: '507f1f77bcf86cd799439011' }, 'objectId', '507f1f77bcf86cd799439011'],
    [{ $numberLong: '9223372036854775807' }, 'json', '{"$numberLong":"9223372036854775807"}'],
    [{ $numberDecimal: '123456789.123456789' }, 'json', '{"$numberDecimal":"123456789.123456789"}'],
    [{ $binary: 'AQID' }, 'json', '{"$binary":"AQID"}'],
    [['a', 'b'], 'json', '["a","b"]'], [{ nested: true }, 'json', '{"nested":true}'],
    [null, 'null', ''], [false, 'boolean', 'false'], [0, 'number', '0'],
    ['2026-10-08', 'string', '2026-10-08'], ['9e107d9d-372b-4f7d-bb3a-17d63746f9a0', 'string', '9e107d9d-372b-4f7d-bb3a-17d63746f9a0'],
  ])('preserves native and ordinary result value %j', (value, valueType, text) => {
    const dropped = liteDbFilterFromDrop({ fieldPath: 'value', value })
    expect(dropped).toMatchObject({ valueType, value: text })
    const request = JSON.parse(buildLiteDbFindQueryText({ ...empty(), filters: [dropped] }))
    expect(request.parameters.p0).toEqual(value)
  })

  it('preserves the last valid query when a field-only drop still needs a value', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    pointerDrop(section('Filters'), { fieldPath: 'name', value: 'Alice' })
    pointerDrop(section('Filters'), { fieldPath: 'age' })
    const valid = latest(onChange).lastAppliedQueryText
    fireEvent.change(screen.getByLabelText('Filter 2 type'), { target: { value: 'number' } })
    expect(valid).toBeTruthy()
    expect(latest(onChange).lastAppliedQueryText).toBe(valid)
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
  })

  it.each(['cancel', 'outside', 'overlay', 'blur'] as const)('does not apply %s drops and clears feedback', action => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    pointAt(section('Filters'))
    act(() => { beginFieldPointerDrag({ fieldPath: 'name', value: 'Alice' }); moveFieldPointerDrag(40, 40) })
    expect(builder()).toHaveClass('is-drag-over')
    if (action === 'cancel') act(() => cancelFieldPointerDrag())
    if (action === 'blur') fireEvent.blur(window)
    if (action === 'overlay') pointAt(document.body)
    act(() => dropFieldPointerDrag(action === 'outside' ? 600 : 40, 40))
    expect(onChange).not.toHaveBeenCalled()
    expect(builder()).not.toHaveClass('is-drag-over')
  })

  it('ignores drops after locking or changing the tab, environment or collection', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Harness onChange={onChange} />)
    for (const props of [{ executionLocked: true }, { tab: { ...tab, id: 'other' } }, { tab: { ...tab, environmentId: 'other' } }, { builderState: { ...empty(), collection: 'Orders' } }]) {
      rerender(<Harness onChange={onChange} />)
      pointAt(section('Filters'))
      act(() => { beginFieldPointerDrag({ fieldPath: 'name' }); moveFieldPointerDrag(40, 40) })
      rerender(<Harness onChange={onChange} {...props} />)
      pointAt(section('Filters'))
      act(() => dropFieldPointerDrag(40, 40))
      expect(onChange).not.toHaveBeenCalled()
    }
    rerender(<Harness onChange={onChange} executionLocked />)
    htmlDrop(section('Filters'), { fieldPath: 'name' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('only updates the destination when more than one builder is mounted', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(<><Harness onChange={first} /><Harness onChange={second} tab={{ ...tab, id: 'second' }} /></>)
    const builders = screen.getAllByLabelText('LiteDB query builder')
    const target = within(builders[1]!).getByRole('heading', { name: 'Filters' })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    builders.forEach(element => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 500, bottom: 500 } as DOMRect))
    act(() => { beginFieldPointerDrag({ fieldPath: 'active', value: true }); moveFieldPointerDrag(40, 40) })
    act(() => dropFieldPointerDrag(40, 40))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    expect(latest(second).filters[0]).toMatchObject({ field: 'active', value: 'true', valueType: 'boolean' })
  })
})

describe('LiteDB filter movement and presentation', () => {
  it('matches shared section, group and row styling without duplicating toolbar controls', () => {
    render(<Harness initial={grouped()} executionControlsInToolbar />)
    expect(screen.queryByLabelText('Collection')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Fetch size')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Count' })).not.toBeInTheDocument()
    expect(within(section('Filters')).getAllByRole('button').slice(0, 2).map(button => button.textContent)).toEqual(['Add Filter', 'Add Group'])
    expect(group()).toHaveClass('query-builder-filter-group')
    expect(group().querySelector('.query-builder-filter-group-header')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter 1 field').closest('.query-builder-row')).toHaveClass('query-builder-row--draggable')
    expect(screen.getByText('Drop a result field to filter')).toBeInTheDocument()
    expect(screen.getByText('Drop a result field to order')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Projection' })).not.toBeInTheDocument()
  })

  it('keeps Collection focus while typing and Count alongside paging in standalone hosts', () => {
    render(<Harness initial={{ ...empty(), collection: '' }} />)
    const collection = screen.getByLabelText('Collection')
    collection.focus()
    fireEvent.change(collection, { target: { value: 'C' } })
    expect(collection).toHaveFocus()
    fireEvent.change(collection, { target: { value: 'Client' } })
    expect(collection).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Count' }).closest('.litedb-query-builder-controls')).toBeInTheDocument()
  })

  it('moves filters into and out of groups and reorders them with pointer feedback', () => {
    const onChange = vi.fn()
    render(<Harness initial={grouped()} onChange={onChange} />)
    const drag = (field: string, target: Element, y = 40) => {
      const handle = screen.getByRole('button', { name: `Drag filter ${field}` })
      pointAt(target)
      fireEvent.pointerDown(handle, { button: 0, pointerId: 7 })
      fireEvent.pointerMove(window, { clientX: 40, clientY: y, pointerId: 7 })
      expect(target).toHaveClass('is-row-drop-target')
      fireEvent.pointerUp(window, { clientX: 40, clientY: y, pointerId: 7 })
      expect(target).not.toHaveClass('is-row-drop-target')
    }
    drag('name', group())
    expect(latest(onChange).filters.find(item => item.id === 'name')?.groupId).toBe('g')
    drag('name', screen.getByLabelText('Ungrouped filters'))
    expect(latest(onChange).filters.map(item => item.id)).toEqual(['status', 'name'])
    const target = screen.getByRole('button', { name: 'Drag filter status' }).closest('.query-builder-row')!
    drag('name', target, 0)
    expect(latest(onChange).filters.map(item => item.id)).toEqual(['name', 'status'])
    expect(latest(onChange).filters.every(item => !item.groupId)).toBe(true)
  })

  it.each(['escape', 'cancel', 'outside', 'sort', 'lock', 'unmount'] as const)('cancels filter movement on %s', reason => {
    const onChange = vi.fn()
    const { rerender, unmount } = render(<Harness initial={grouped()} onChange={onChange} />)
    pointAt(group())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Drag filter name' }), { button: 0, pointerId: 7 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 7 })
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    if (reason === 'cancel') fireEvent.pointerCancel(window, { pointerId: 7 })
    if (reason === 'outside') pointAt(document.body)
    if (reason === 'sort') pointAt(section('Sort'))
    if (reason === 'lock') rerender(<Harness initial={grouped()} onChange={onChange} executionLocked />)
    if (reason === 'unmount') unmount()
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 7 })
    expect(onChange).not.toHaveBeenCalled()
    expect(document.querySelector('.is-row-dragging')).not.toBeInTheDocument()
  })

  it('supports keyboard reordering without changing groups or values', () => {
    const onChange = vi.fn()
    render(<Harness initial={grouped()} onChange={onChange} />)
    const handle = screen.getByRole('button', { name: 'Drag filter name' })
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(latest(onChange).filters).toEqual([row('status'), row('name')])
    expect(handle).toHaveFocus()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(latest(onChange).filters).toEqual([row('name'), row('status')])
  })

  it('moves only the identified row without mutating the existing draft', () => {
    const rows = [row('a'), row('b', 'g'), row('c', 'g')]
    expect(moveQueryBuilderFilter(rows, 'a', { groupId: 'g', rowId: 'b', placement: 'after' })).toEqual([row('b', 'g'), row('a', 'g'), row('c', 'g')])
    expect(rows[0]?.groupId).toBeUndefined()
    expect(moveQueryBuilderFilter(rows, 'missing', { placement: 'after' })).toBe(rows)
    expect(moveQueryBuilderFilter(rows, 'a', { rowId: 'a', placement: 'before' })).toBe(rows)
  })
})
