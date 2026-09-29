import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { ConnectionProfile, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { EditorToolbar } from '../../../../../src/app/components/workbench/EditorToolbar'
import { QueryBuilderExecutionControls } from '../../../../../src/app/components/workbench/query-builder/QueryBuilderExecutionControls'
import { QueryBuilderPanel } from '../../../../../src/app/components/workbench/query-builder/QueryBuilderPanel'
import { createDefaultMongoFindBuilderState } from '../../../../../src/app/components/workbench/query-builder/mongo-find'
import { createDefaultMongoAggregationBuilderState } from '../../../../../src/app/components/workbench/query-builder/mongo-aggregation'
import { createDefaultSqlSelectBuilderState } from '../../../../../src/app/components/workbench/query-builder/sql-select'
import { createDefaultCosmosSqlBuilderState } from '../../../../../src/app/components/workbench/query-builder/cosmos-sql'
import { createDefaultCqlPartitionBuilderState } from '../../../../../src/app/components/workbench/query-builder/cql-partition'
import { createDefaultDynamoDbKeyConditionBuilderState } from '../../../../../src/app/components/workbench/query-builder/dynamodb-key-condition'
import { createDefaultSearchDslBuilderState } from '../../../../../src/app/components/workbench/query-builder/search-dsl'
import { createDefaultRedisKeyBrowserState } from '../../../../../src/app/components/workbench/query-builder/redis-key-browser'
import { compileQueryBuilderState } from '../../../../../src/app/controllers/query-builder-routing'

const sqlEngines: ConnectionProfile['engine'][] = [
  'postgresql', 'mysql', 'mariadb', 'sqlite', 'sqlserver', 'cockroachdb',
  'oracle', 'duckdb', 'timescaledb', 'snowflake', 'bigquery',
]
const cases: { engine: ConnectionProfile['engine']; builder: QueryBuilderState }[] = [
  { engine: 'mongodb', builder: createDefaultMongoFindBuilderState('orders') },
  { engine: 'mongodb', builder: createDefaultMongoAggregationBuilderState('orders') },
  ...sqlEngines.map(engine => ({ engine, builder: createDefaultSqlSelectBuilderState('orders', 'public') })),
  { engine: 'cosmosdb', builder: createDefaultCosmosSqlBuilderState('orders', 'catalog') },
  { engine: 'dynamodb', builder: createDefaultDynamoDbKeyConditionBuilderState('orders') },
  { engine: 'cassandra', builder: createDefaultCqlPartitionBuilderState('orders', 'catalog') },
  { engine: 'elasticsearch', builder: createDefaultSearchDslBuilderState('orders') },
  { engine: 'opensearch', builder: createDefaultSearchDslBuilderState('orders') },
]

describe('QueryBuilderExecutionControls', () => {
  it.each(cases)('moves $engine / $builder.kind controls to the toolbar and preserves native compilation', async ({ engine, builder }) => {
    const onChange = vi.fn()
    const onCount = vi.fn().mockResolvedValue(undefined)
    render(<Harness engine={engine} initialState={builder} onChange={onChange} onCount={onCount} />)
    const toolbar = screen.getByLabelText('Editor toolbar')
    const resultControls = within(toolbar).getByRole('group', { name: 'Query result controls' })
    const panel = document.querySelector('.query-builder-workspace') as HTMLElement
    expect(within(panel).queryByLabelText('Fetch size')).not.toBeInTheDocument()
    expect(within(panel).queryByLabelText('Limit')).not.toBeInTheDocument()
    expect(within(panel).queryByLabelText('Size')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Count' })).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Fetch size')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Count' })).toHaveLength(1)
    const countButton = within(resultControls).getByRole('button', { name: 'Count' })
    expect(countButton).toHaveClass('toolbar-icon-action')
    expect(countButton).toHaveTextContent(/^$/)
    expect(countButton).toHaveAttribute('title', 'Count all records matching the current builder filters')
    expect(countButton.querySelector('svg')).toBeInTheDocument()
    expect(toolbar.children[1]).toBe(resultControls)
    const input = within(resultControls).getByLabelText('Fetch size')
    input.focus()
    fireEvent.change(input, { target: { value: '37' } })
    expect(input).toHaveFocus()
    expect(input).toHaveValue(37)
    const next = onChange.mock.calls.at(-1)?.[1] as QueryBuilderState
    expect(next).toMatchObject(builder.kind === 'search-dsl' ? { size: 37 } : { limit: 37 })
    const compiled = compileQueryBuilderState(next, connection(engine), tab(builder))
    expect(compiled.ok).toBe(true)
    if (compiled.ok) expect(next.lastAppliedQueryText).toBe(compiled.queryText)
    fireEvent.click(within(resultControls).getByRole('button', { name: 'Count' }))
    await waitFor(() => expect(onCount).toHaveBeenCalledExactlyOnceWith('tab-fixture', next))
  })

  it.each(['redis', 'valkey'] as const)('moves %s Count without inventing a result limit or changing SCAN settings', async (engine) => {
    const onChange = vi.fn()
    const onCount = vi.fn().mockResolvedValue(undefined)
    const builder = { ...createDefaultRedisKeyBrowserState('orders:*'), scanCount: 250, pageSize: 100 }
    render(<Harness engine={engine} initialState={builder} onChange={onChange} onCount={onCount} />)
    expect(screen.queryByLabelText('Fetch size')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Redis key browser')).queryByRole('button', { name: 'Count' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByLabelText('Editor toolbar')).getByRole('button', { name: 'Count' }))
    await waitFor(() => expect(onCount).toHaveBeenCalledExactlyOnceWith('tab-fixture', builder))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('allows clearing and replacing the size without applying incomplete, fractional, or unsafe limits', () => {
    const onChange = vi.fn()
    render(<Harness initialState={createDefaultMongoFindBuilderState('orders')} onChange={onChange} />)
    const input = screen.getByLabelText('Fetch size')
    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue(null)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '45' } })
    expect(onChange).toHaveBeenLastCalledWith('tab-fixture', expect.objectContaining({ limit: 45, database: 'catalog' }))
    onChange.mockClear()
    for (const value of ['0', '-1', '1.5', '9007199254740992']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.blur(input)
      expect(input).toHaveValue(45)
    }
  })

  it.each(['elasticsearch', 'opensearch'] as const)('preserves %s zero-hit aggregation requests', (engine) => {
    const onChange = vi.fn()
    render(<Harness engine={engine} initialState={createDefaultSearchDslBuilderState('orders')} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Fetch size'), { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith('tab-fixture', expect.objectContaining({ size: 0 }))
    expect(screen.getByLabelText('Fetch size')).toHaveAttribute('aria-invalid', 'false')
  })

  it('finishes size editing with Enter without swallowing the Run keyboard shortcut', () => {
    const shortcut = vi.fn()
    render(<div onKeyDown={shortcut}>
      <Harness initialState={createDefaultMongoFindBuilderState('orders')} onChange={vi.fn()} />
    </div>)
    const input = screen.getByLabelText('Fetch size')
    input.focus()
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(shortcut).toHaveBeenCalledOnce()
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).not.toHaveFocus()
    expect(shortcut).toHaveBeenCalledOnce()
  })

  it.each(['lock', 'queued', 'running'] as const)('disables size changes and Count during %s', (state) => {
    const builder = createDefaultMongoFindBuilderState('orders')
    const queryTab = tab(builder)
    if (state === 'queued') queryTab.status = 'queued'
    if (state === 'running') queryTab.activeExecution = { executionId: 'fixture', phase: 'server', startedAt: '' }
    const onCount = vi.fn()
    const onChange = vi.fn()
    render(<QueryBuilderExecutionControls tab={queryTab} builderState={builder} executionLocked={state === 'lock'} onBuilderStateChange={onChange} onCount={onCount} />)
    expect(screen.getByLabelText('Fetch size')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Count' }))
    expect(onCount).not.toHaveBeenCalled()
  })

  it('disables Count for missing targets and invalid filters but allows fixing the fetch size', () => {
    const builder = createDefaultMongoFindBuilderState('')
    const onCount = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(<QueryBuilderExecutionControls tab={tab(builder)} builderState={builder} onBuilderStateChange={onChange} onCount={onCount} />)
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
    const invalid = { ...builder, collection: 'orders', filters: [{ id: 'invalid', field: 'price', operator: 'eq' as const, valueType: 'number' as const, value: 'no' }] }
    rerender(<QueryBuilderExecutionControls tab={tab(invalid)} builderState={invalid} onBuilderStateChange={onChange} onCount={onCount} />)
    expect(screen.getByRole('button', { name: 'Count' })).toBeDisabled()
    expect(screen.getByLabelText('Fetch size')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Fetch size'), { target: { value: '60' } })
    expect(onChange).toHaveBeenCalledWith('tab-fixture', expect.objectContaining({ limit: 60, lastAppliedQueryText: invalid.lastAppliedQueryText }))
  })

  it('keeps Count busy and prevents duplicate submissions until completion', async () => {
    const result = Promise.withResolvers<void>()
    const onCount = vi.fn(() => result.promise)
    render(<Harness initialState={createDefaultMongoFindBuilderState('orders')} onChange={vi.fn()} onCount={onCount} />)
    fireEvent.click(screen.getByRole('button', { name: 'Count' }))
    const counting = screen.getByRole('button', { name: 'Counting...' })
    expect(counting).toBeDisabled()
    expect(counting).toHaveAttribute('aria-busy', 'true')
    expect(counting).toHaveTextContent(/^$/)
    expect(counting.querySelector('.connection-metadata-spinner')).toBeInTheDocument()
    fireEvent.click(counting)
    expect(onCount).toHaveBeenCalledOnce()
    await act(async () => result.resolve())
    expect(screen.getByRole('button', { name: 'Count' })).toBeEnabled()
  })

  it('uses the newly selected tab and result size, not an incomplete draft from another tab', () => {
    const first = createDefaultMongoFindBuilderState('orders', 20)
    const second = createDefaultMongoFindBuilderState('users', 80)
    const onChange = vi.fn()
    const onCount = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<QueryBuilderExecutionControls tab={tab(first)} builderState={first} onBuilderStateChange={onChange} onCount={onCount} />)
    fireEvent.change(screen.getByLabelText('Fetch size'), { target: { value: '' } })
    const nextTab = { ...tab(second), id: 'tab-next' }
    rerender(<QueryBuilderExecutionControls tab={nextTab} builderState={second} onBuilderStateChange={onChange} onCount={onCount} />)
    expect(screen.getByLabelText('Fetch size')).toHaveValue(80)
    fireEvent.change(screen.getByLabelText('Fetch size'), { target: { value: '90' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('tab-next', expect.objectContaining({ collection: 'users', limit: 90 }))
  })
})

function connection(engine: ConnectionProfile['engine']): ConnectionProfile {
  return {
    id: 'connection', name: 'Fixture', engine, family: 'document', database: 'catalog',
    host: 'localhost', auth: {}, tags: [], environmentIds: ['fixture'], favorite: false,
    readOnly: false, icon: engine, createdAt: '', updatedAt: '',
  }
}

function tab(builderState: QueryBuilderState): QueryTabState {
  return {
    id: 'tab-fixture', connectionId: 'connection', environmentId: 'fixture', title: 'Fixture',
    family: 'document', language: 'json', editorLabel: 'Query', queryText: '',
    queryViewMode: 'builder', builderState, status: 'idle', dirty: false, history: [],
  }
}

function Harness({ initialState, engine = 'mongodb', onChange, onCount }: {
  initialState: QueryBuilderState
  engine?: ConnectionProfile['engine']
  onChange(tabId: string, builder: QueryBuilderState): void
  onCount?(tabId: string, builder: QueryBuilderState): Promise<void>
}) {
  const [builderState, setBuilderState] = useState(initialState)
  const queryTab = tab(builderState)
  const profile = connection(engine)
  const update = (tabId: string, next: QueryBuilderState) => { setBuilderState(next); onChange(tabId, next) }
  return <>
    <EditorToolbar
      capabilities={{ canCancel: true, canExplain: true, supportsLiveMetadata: true, editorLanguage: 'sql', defaultRowLimit: 100 }}
      executionStatus="idle" canCancelExecution={false} canToggleBuilderView builderKind={builderState.kind} queryWindowMode="builder"
      onExecute={vi.fn()} onCancel={vi.fn()} onExplain={vi.fn()} onOpenConnectionDrawer={vi.fn()} onToggleQueryWindowMode={vi.fn()}
      queryExecutionControls={<QueryBuilderExecutionControls tab={queryTab} connection={profile} builderState={builderState} onBuilderStateChange={update} onCount={onCount} />}
    />
    <QueryBuilderPanel tab={queryTab} connection={profile} builderState={builderState} executionControlsInToolbar onBuilderStateChange={update} onCount={onCount} />
  </>
}
