import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, LiteDbFindBuilderState, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { QueryBuilderPanel } from '../../../../../src/app/components/workbench/query-builder/QueryBuilderPanel'
import { buildLiteDbFindQueryText, createDefaultLiteDbFindBuilderState, liteDbFieldPath, parseLiteDbFindQueryText } from '../../../../../src/app/components/workbench/datastores/litedb/litedb-find'
import { compileQueryBuilderState, builderStateWithCompiledQueryText } from '../../../../../src/app/controllers/query-builder-routing'
import { buildQueryBuilderCountText } from '../../../../../src/app/components/workbench/query-builder/query-builder-count'
import { builderStateForTab } from '../../../../../src/app/workspace-helpers'
import { createSeedSnapshot } from '../../../../fixtures/seed-workspace'
import { createScopedQueryTabInSnapshot } from '../../../../../src/services/runtime/browser-tabs'
import { branchNodeForPath } from '../../../../../src/app/components/workbench/SideBar.datastore-tree-registry'
import { explorerNodeTarget } from '../../../../../src/app/components/workbench/SideBar.helpers'
import { builderStateForQueryTarget } from '../../../../../src/app/components/workbench/query-targets/query-target-change'

const state = () => createDefaultLiteDbFindBuilderState('Client')
const filter = (patch: Partial<LiteDbFindBuilderState['filters'][number]> = {}): LiteDbFindBuilderState['filters'][number] => ({ id: 'f1', field: 'age', operator: 'gte', valueType: 'number', value: '20', ...patch })
const base = createSeedSnapshot()
const connection = { ...base.connections[0]!, engine: 'litedb', family: 'document', database: 'C:\\data\\db.db' } as ConnectionProfile
const tab = { ...base.tabs[0]!, id: 'lite-tab', connectionId: connection.id, family: 'document', queryText: '', status: 'idle', builderState: state() } as QueryTabState

describe('LiteDB query builder adapter', () => {
  it('compiles native parameterized grouping without embedding values or database paths', () => {
    const draft: LiteDbFindBuilderState = { ...state(), filterGroups: [{ id: 'g', label: 'Status', logic: 'or' }], filters: [filter(), filter({ id: 'f2', groupId: 'g', field: 'status', operator: 'eq', valueType: 'string', value: 'active' }), filter({ id: 'f3', groupId: 'g', field: 'status', operator: 'eq', valueType: 'string', value: "' OR true --" })], sort: [{ id: 's', field: 'age', direction: 'desc' }], skip: 2, limit: 10 }
    const request = JSON.parse(buildLiteDbFindQueryText(draft))
    expect(request.filter).toBe('($.\u005b"age"\u005d >= @p0) AND (($.["status"] = @p1) OR ($.["status"] = @p2))')
    expect(request.parameters).toEqual({ p0: 20, p1: 'active', p2: "' OR true --" })
    expect(request).toMatchObject({ operation: 'Find', collection: 'Client', skip: 2, limit: 10, orderBy: { direction: 'desc' } })
    expect(request).not.toHaveProperty('database')
    const counted = JSON.parse(buildQueryBuilderCountText(draft)!)
    expect(counted).toMatchObject({ operation: 'Count', filter: request.filter, parameters: request.parameters })
    expect(counted).not.toHaveProperty('limit')
    expect(counted).not.toHaveProperty('skip')
    expect(counted).not.toHaveProperty('orderBy')
  })

  it.each([
    ['date', '2026-10-08T12:30:00+02:00', { $date: '2026-10-08T10:30:00.000Z' }],
    ['uuid', '9E107D9D-372B-4F7D-BB3A-17D63746F9A0', { $guid: '9e107d9d-372b-4f7d-bb3a-17d63746f9a0' }],
    ['objectId', '507f1f77bcf86cd799439011', { $oid: '507f1f77bcf86cd799439011' }],
    ['json', '{"$numberLong":"9223372036854775807"}', { $numberLong: '9223372036854775807' }],
    ['boolean', 'false', false], ['null', '', null], ['string', '2026-10-08', '2026-10-08'],
  ] as const)('preserves explicitly selected %s values', (valueType, value, expected) => {
    const request = JSON.parse(buildLiteDbFindQueryText({ ...state(), filters: [filter({ operator: 'eq', valueType, value })] }))
    expect(request.parameters.p0).toEqual(expected)
  })

  it.each(['', 'bad', 'Infinity'])('blocks invalid numeric drafts %s without replacing the last valid query', value => {
    const draft = { ...state(), filters: [filter({ value })], lastAppliedQueryText: 'previous query' }
    expect(compileQueryBuilderState(draft, connection).ok).toBe(false)
    expect(builderStateWithCompiledQueryText(draft, connection).lastAppliedQueryText).toBe('previous query')
  })

  it('rejects invalid groups, multi-sort, blank fields, and invalid paging', () => {
    for (const patch of [
      { filters: [filter({ field: '' })] }, { filters: [filter({ groupId: 'missing' })] },
      { skip: -1 }, { limit: NaN }, { limit: 0 },
      { sort: [{ id: 'a', field: 'a', direction: 'asc' as const }, { id: 'b', field: 'b', direction: 'asc' as const }] },
    ]) expect(compileQueryBuilderState({ ...state(), ...patch }, connection).ok).toBe(false)
  })

  it('ignores disabled invalid filters and groups and quotes unusual field names', () => {
    const request = JSON.parse(buildLiteDbFindQueryText({ ...state(), filters: [filter({ enabled: false, value: 'bad' }), filter({ id: 'b', groupId: 'g', value: 'bad' })], filterGroups: [{ id: 'g', label: 'Off', logic: 'or', enabled: false }] }))
    expect(request.filter).toEqual({})
    expect(liteDbFieldPath('客户.weird " name')).toBe('$.["客户"].["weird \\" name"]')
  })

  it('adopts existing empty Find requests but never silently rewrites custom raw filters', () => {
    expect(parseLiteDbFindQueryText('{"operation":"Find","collection":"Client","filter":{},"limit":100}')?.limit).toBe(100)
    expect(parseLiteDbFindQueryText('{"operation":"Find","collection":"Client","filter":"age > 5"}')).toBeUndefined()
    expect(parseLiteDbFindQueryText('{"operation":"DropCollection","collection":"Client"}')).toBeUndefined()
    expect(builderStateForTab({ ...tab, builderState: undefined, queryText: '{"operation":"Find","collection":"Client","filter":{}}' }, connection, {})?.kind).toBe('litedb-find')
  })

  it('creates a scoped browser-mode builder using the collection, not the filename', () => {
    const snapshot = { ...base, connections: [connection] }
    const next = createScopedQueryTabInSnapshot(snapshot, { connectionId: connection.id, environmentId: tab.environmentId, target: { kind: 'collection', label: 'Client', path: ['db.db', 'Collections'], scope: 'litedb:collection:Client', preferredBuilder: 'litedb-find' } })
    const opened = next.tabs.find(item => item.id === next.ui.activeTabId)!
    expect(opened.builderState).toMatchObject({ kind: 'litedb-find', collection: 'Client' })
    expect(JSON.parse(opened.queryText)).toMatchObject({ operation: 'Find', collection: 'Client' })
  })

  it('offers the builder for new unscoped LiteDB tabs without executing an empty collection', () => {
    const draft = builderStateForTab({ ...tab, builderState: undefined, queryText: '{"collection":"","filter":{},"limit":20}' }, connection, {})
    expect(draft?.kind).toBe('litedb-find')
    expect(compileQueryBuilderState(draft!, connection).ok).toBe(false)
  })

  it('uses LiteDB builder routing on real and synthesized Explorer collection nodes', () => {
    const node = branchNodeForPath(connection, ['db.db', 'Collections', 'Client'])
    expect(node.builderKind).toBe('litedb-find')
    expect(node.scope).toBe('litedb:collection:Client')
    expect(JSON.parse(node.queryTemplate!)).toMatchObject({ operation: 'Find', collection: 'Client' })
    const target = explorerNodeTarget({ id: 'client', connectionId: connection.id, kind: 'collection', label: 'Client', path: ['db.db', 'Collections'], scope: 'litedb:collection:Client', expandable: true }, connection)
    expect(target.preferredBuilder).toBe('litedb-find')
    const draft = { ...state(), filters: [filter()], skip: 3 }
    expect(builderStateForQueryTarget(draft, connection, { ...target, label: 'Orders', scope: 'litedb:collection:Orders' }))
      .toEqual({ ...draft, collection: 'Orders' })
    expect(connection.database).toBe('C:\\data\\db.db')
  })

  it('builds an editable OR group and delegates Count with the complete saved draft', () => {
    const count = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState<QueryBuilderState>({ ...state(), filters: [filter()] })
      return <QueryBuilderPanel connection={connection} tab={tab} builderState={draft} onBuilderStateChange={(_, next) => setDraft(next)} onCount={count} />
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    fireEvent.change(screen.getByLabelText('Group 1 logic'), { target: { value: 'or' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Filter' })[1]!)
    fireEvent.change(screen.getByLabelText('Filter 2 field'), { target: { value: 'name' } })
    fireEvent.change(screen.getByLabelText('Filter 2 value'), { target: { value: 'Client' } })
    fireEvent.click(screen.getByRole('button', { name: 'Count' }))
    expect(count).toHaveBeenCalledTimes(1)
    const counted = count.mock.calls[0]![1] as LiteDbFindBuilderState
    expect(counted.filterGroups[0]?.logic).toBe('or')
    expect(counted.filters[1]?.groupId).toBe(counted.filterGroups[0]?.id)
    expect(JSON.parse(buildLiteDbFindQueryText(counted)).parameters).toEqual({ p0: 20, p1: 'Client' })
    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'contains' } })
    expect(screen.getByLabelText('Filter 1 type')).toHaveValue('string')
    fireEvent.click(screen.getByRole('button', { name: 'Add Sort' }))
    fireEvent.change(screen.getByLabelText('Sort field'), { target: { value: 'name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Sort' }))
    expect(screen.getByLabelText('Sort field')).toHaveFocus()
  })

  it('uses shared typed controls, hides unary values, and blocks Count for invalid drafts', () => {
    const count = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState<QueryBuilderState>({ ...state(), filters: [filter()] })
      return <QueryBuilderPanel connection={connection} tab={tab} builderState={draft} onBuilderStateChange={(_, next) => setDraft(next)} onCount={count} theme="light" />
    }
    render(<Harness />)
    expect(screen.getByLabelText('LiteDB query builder')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter 1 value'), { target: { value: 'bad' } })
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'is-null' } })
    expect(screen.queryByLabelText('Filter 1 type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter 1 value')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Count' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'has-length' } })
    expect(screen.queryByLabelText('Filter 1 type')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('inputmode', 'numeric')
  })

  it('locks editing and Count while a query is running', () => {
    render(<QueryBuilderPanel connection={connection} tab={tab} builderState={state()} executionLocked onBuilderStateChange={vi.fn()} onCount={vi.fn()} />)
    expect(screen.getByLabelText('Collection')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
  })
})
