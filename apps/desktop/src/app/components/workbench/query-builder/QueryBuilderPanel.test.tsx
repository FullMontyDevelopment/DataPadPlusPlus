import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import type { QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIELD_DRAG_MIME,
  FIELD_DRAG_PAYLOAD_MIME,
  clearFieldDragData,
} from '../results/field-drag'
import { ResultPayloadView } from '../results/ResultPayloadView'
import { createDefaultCqlPartitionBuilderState } from './cql-partition'
import { createDefaultDynamoDbKeyConditionBuilderState } from './dynamodb-key-condition'
import { createDefaultMongoAggregationBuilderState } from './mongo-aggregation'
import { createDefaultMongoFindBuilderState } from './mongo-find'
import { QueryBuilderPanel } from './QueryBuilderPanel'
import { createDefaultRedisKeyBrowserState } from './redis-key-browser'
import { createDefaultSearchDslBuilderState } from './search-dsl'
import { createDefaultSqlSelectBuilderState } from './sql-select'

describe('QueryBuilderPanel', () => {
  afterEach(() => {
    clearFieldDragData()
  })

  it('adds dragged result fields to filter, projection, and sort sections', () => {
    const onBuilderStateChange = vi.fn()
    const tab = mongoTab()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={tab} />)

    expect(screen.queryByText('Live query')).not.toBeInTheDocument()
    expect(screen.queryByText('Mongo Find Builder')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'products' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Collection')).toHaveValue('products')
    expect(screen.getByLabelText('Fetch size')).toHaveValue(20)
    expect(within(screen.getByLabelText('Mongo query scope')).getByText('products')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter group logic Group 1')).not.toBeInTheDocument()

    dropField(section('Filters'), 'profile.status')
    expect(screen.getByLabelText('Filter field')).toHaveValue('profile.status')
    expect(screen.getByLabelText('Apply filter profile.status')).toBeChecked()
    fireEvent.click(screen.getByLabelText('Apply filter profile.status'))
    expect(screen.getByLabelText('Apply filter profile.status')).not.toBeChecked()
    expect(screen.queryByLabelText('Filter group logic Group 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    fireEvent.change(screen.getByLabelText('Filter group logic Group 1'), {
      target: { value: 'or' },
    })
    expect(screen.getByLabelText('Filter group logic Group 1')).toHaveValue('or')
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    expect(screen.getByLabelText('Filter group logic Group 2')).toHaveValue('and')

    dropField(section('Projection'), 'profile.name')
    expect(screen.getByLabelText('Projection field')).toHaveValue('profile.name')
    expect(screen.getByLabelText('Projection mode profile.name')).toHaveValue('include')
    fireEvent.change(screen.getByLabelText('Projection mode profile.name'), {
      target: { value: 'exclude' },
    })
    expect(screen.getByLabelText('Projection mode profile.name')).toHaveValue('exclude')

    dropField(section('Sort'), 'createdAt')
    expect(screen.getByLabelText('Sort field')).toHaveValue('createdAt')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('shows the Mongo database and collection for scoped query tabs', () => {
    render(
      <BuilderHarness
        onBuilderStateChange={vi.fn()}
        tab={mongoTab({
          scopedTarget: {
            kind: 'collection',
            label: 'products',
            scope: 'collection:catalog:products',
          },
        })}
      />,
    )

    const scope = screen.getByLabelText('Mongo query scope')
    expect(within(scope).getByText('catalog')).toBeInTheDocument()
    expect(within(scope).getByText('products')).toBeInTheDocument()
  })

  it('adds a Mongo filter from the Filters section header', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    const filtersSection = section('Filters')
    const rootAddFilterButton = within(filtersSection).getAllByRole('button', {
      name: 'Add Filter',
    })[0] as HTMLElement

    fireEvent.click(rootAddFilterButton)

    expect(screen.getByLabelText('Filter field')).toHaveValue('')
    expect(within(screen.getByLabelText('Filter operator')).getByRole('option', {
      name: 'Contains',
    })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Apply filter/)).toBeChecked()
    expect(screen.queryByLabelText('Filter group logic Group 1')).not.toBeInTheDocument()
    expect(onBuilderStateChange).toHaveBeenCalledOnce()
  })

  it('clears the only Mongo filter group back to an empty filter section', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    const group = filterGroup('Group 1')
    fireEvent.click(within(group).getByRole('button', { name: 'Add Filter' }))

    expect(within(group).getByLabelText('Filter field')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'Clear Group 1' }))

    expect(screen.queryByLabelText('Filter group logic Group 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
    expect(screen.getByText('No filters.')).toBeInTheDocument()
  })

  it('keeps existing ungrouped filters outside a newly added Mongo group', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    dropField(section('Filters'), 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

    const group = filterGroup('Group 1')
    expect(screen.getByLabelText('Filter field')).toHaveValue('status')
    expect(within(group).queryByLabelText('Filter field')).not.toBeInTheDocument()
    expect(within(group).getByText('No filters in this group.')).toBeInTheDocument()
  })

  it('allows Mongo filter groups to be disabled and enabled', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    const group = filterGroup('Group 1')
    const toggle = within(group).getByLabelText('Apply group Group 1')

    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    expect(toggle).not.toBeChecked()
    expect(group).toHaveClass('is-disabled')

    fireEvent.click(toggle)

    expect(toggle).toBeChecked()
    expect(group).not.toHaveClass('is-disabled')
  })

  it('drops Mongo result fields into the filter group under the pointer', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

    const firstGroup = filterGroup('Group 1')
    const secondGroup = filterGroup('Group 2')
    dropField(secondGroup, 'category')

    expect(within(firstGroup).queryByLabelText('Filter field')).not.toBeInTheDocument()
    expect(within(secondGroup).getByLabelText('Filter field')).toHaveValue('category')
    expect(onBuilderStateChange).toHaveBeenCalledTimes(3)
  })

  it('treats the whole Mongo builder panel as a valid field drop target', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    const builder = screen.getByLabelText('MongoDB query builder')
    const dataTransfer = createFieldDataTransfer('sku')

    fireEvent.dragOver(builder, { dataTransfer })

    expect(builder).toHaveClass('is-drag-over')
    expect(dataTransfer.dropEffect).toBe('copy')

    fireEvent.drop(builder, { dataTransfer })

    expect(screen.getByLabelText('Filter field')).toHaveValue('sku')
    expect(builder).not.toHaveClass('is-drag-over')
  })

  it('renders a Mongo aggregation builder with editable pipeline stages', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <BuilderHarness
        initialBuilderState={createDefaultMongoAggregationBuilderState('orders', 20)}
        onBuilderStateChange={onBuilderStateChange}
        tab={mongoTab()}
      />,
    )

    expect(screen.getByRole('region', { name: 'MongoDB aggregation builder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Collection')).toHaveValue('orders')
    expect(screen.getByLabelText('Fetch size')).toHaveValue(20)

    fireEvent.click(screen.getByRole('button', { name: 'Add Stage' }))

    const stages = screen.getAllByLabelText('Aggregation stage')
    expect(stages.at(-1)).toHaveValue('$match')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('adds document result fields to the Mongo builder section they are dropped on', () => {
    const onBuilderStateChange = vi.fn()
    const tab = mongoTab()

    render(
      <div>
        <ResultPayloadView
          payload={{
            renderer: 'document',
            documents: [
              {
                _id: 'product-1',
                profile: { name: 'Lamp', status: 'active' },
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }}
        />
        <BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={tab} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand profile' }))

    pointerDragDocumentFieldToTarget('profile.status', section('Filters'))
    expect(screen.getByLabelText('Filter field')).toHaveValue('profile.status')
    expect(screen.getByLabelText('Value type')).toHaveValue('string')
    expect(screen.getByLabelText('Filter value')).toHaveValue('active')

    pointerDragDocumentFieldToTarget('profile.name', section('Projection'))
    expect(screen.getByLabelText('Projection field')).toHaveValue('profile.name')

    pointerDragDocumentFieldToTarget('createdAt', section('Sort'))
    expect(screen.getByLabelText('Sort field')).toHaveValue('createdAt')
    expect(onBuilderStateChange).toHaveBeenCalledTimes(3)
  })

  it('keeps native Mongo document types when fields are dropped into filters', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <div>
        <ResultPayloadView
          payload={{
            renderer: 'document',
            documents: [
              {
                _id: { $oid: '507f1f77bcf86cd799439011' },
                createdAt: { $date: { $numberLong: '1778925741369' } },
              },
            ],
          }}
        />
        <BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Expand {"$oid":"507f1f77bcf86cd799439011"}',
    }))

    pointerDragDocumentFieldToTarget('createdAt', section('Filters'))

    expect(screen.getByLabelText('Filter field')).toHaveValue('createdAt')
    expect(screen.getByLabelText('Filter operator')).toHaveValue('gte')
    expect(screen.getByLabelText('Value type')).toHaveValue('date')
    expect(screen.getByLabelText('Filter value')).toHaveValue('2026-05-16T10:02:21.369Z')
  })

  it('accepts document field pointer drops when native drag data is not involved', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <div>
        <ResultPayloadView
          payload={{
            renderer: 'document',
            documents: [{ _id: 'product-1', sku: 'luna-lamp' }],
          }}
        />
        <BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))

    pointerDragDocumentFieldToTarget('sku', screen.getByLabelText('Collection'))

    expect(screen.getByLabelText('Filter field')).toHaveValue('sku')
    expect(screen.getByLabelText('Filter value')).toHaveValue('luna-lamp')
    expect(onBuilderStateChange).toHaveBeenCalledOnce()
  })

  it('drops document fields on nested filter inputs before native controls can swallow the drop', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <div>
        <ResultPayloadView
          payload={{
            renderer: 'document',
            documents: [{ _id: 'product-1', sku: 'luna-lamp', category: 'lighting' }],
          }}
        />
        <BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))
    dropField(section('Filters'), 'sku')

    pointerDragDocumentFieldToTarget('category', screen.getByLabelText('Filter value'))

    expect(screen.getAllByLabelText('Filter field').at(-1)).toHaveValue('category')
    expect(screen.getAllByLabelText('Filter value').at(-1)).toHaveValue('lighting')
    expect(onBuilderStateChange).toHaveBeenCalledTimes(2)
  })

  it('routes fallback builder drops to the nearest Mongo section', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <div>
        <ResultPayloadView
          payload={{
            renderer: 'document',
            documents: [{ _id: 'product-1', createdAt: '2026-01-01T00:00:00.000Z' }],
          }}
        />
        <BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))

    pointerDragDocumentFieldToTarget('createdAt', section('Sort'))

    expect(screen.getByLabelText('Sort field')).toHaveValue('createdAt')
    expect(onBuilderStateChange).toHaveBeenCalledOnce()
  })

  it('does not reuse a stale document field after drag state is cleared', () => {
    const onBuilderStateChange = vi.fn()

    render(<BuilderHarness onBuilderStateChange={onBuilderStateChange} tab={mongoTab()} />)

    const builder = screen.getByLabelText('MongoDB query builder')
    fireEvent.dragOver(builder, {
      dataTransfer: createFieldDataTransfer('', {
        includeCustomPayload: false,
        includeFieldMime: false,
        includeText: false,
      }),
    })
    fireEvent.drop(builder, {
      dataTransfer: createFieldDataTransfer('', {
        includeCustomPayload: false,
        includeFieldMime: false,
        includeText: false,
      }),
    })

    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
    expect(onBuilderStateChange).not.toHaveBeenCalled()
  })

  it('renders a SQL SELECT builder with drag targets and compact table controls', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <BuilderHarness
        connectionEngine="postgresql"
        initialBuilderState={createDefaultSqlSelectBuilderState('accounts', 'public', 20)}
        onBuilderStateChange={onBuilderStateChange}
        tab={sqlTab()}
      />,
    )

    expect(screen.getByRole('region', { name: 'SQL SELECT builder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Schema')).toHaveValue('public')
    expect(screen.getByLabelText('Table')).toHaveValue('accounts')

    dropField(section('Columns'), 'email')
    expect(screen.getByLabelText('Selected column')).toHaveValue('email')

    dropField(section('Filters'), 'status')
    expect(screen.getByLabelText('Filter field')).toHaveValue('status')
    fireEvent.change(screen.getByLabelText('Filter value'), {
      target: { value: 'active' },
    })

    dropField(section('Sort'), 'created_at')
    expect(screen.getByLabelText('Sort field')).toHaveValue('created_at')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('renders a DynamoDB key-condition builder with field drop zones', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <BuilderHarness
        connectionEngine="dynamodb"
        initialBuilderState={createDefaultDynamoDbKeyConditionBuilderState('Orders', 20)}
        onBuilderStateChange={onBuilderStateChange}
        tab={dynamoDbTab()}
      />,
    )

    expect(screen.getByRole('region', { name: 'DynamoDB key-condition builder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Table')).toHaveValue('Orders')
    expect(screen.getByLabelText('Partition key field')).toHaveValue('pk')

    dropField(section('Filters'), 'status')
    expect(screen.getByLabelText('Filter field')).toHaveValue('status')

    dropField(section('Projection'), 'total')
    expect(screen.getByLabelText('Projection field')).toHaveValue('total')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('renders a CQL partition builder with partition and projection drop zones', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <BuilderHarness
        connectionEngine="cassandra"
        initialBuilderState={createDefaultCqlPartitionBuilderState('events_by_customer', 'app', 20)}
        onBuilderStateChange={onBuilderStateChange}
        tab={cassandraTab()}
      />,
    )

    expect(screen.getByRole('region', { name: 'CQL partition query builder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Keyspace')).toHaveValue('app')
    expect(screen.getByLabelText('Table')).toHaveValue('events_by_customer')

    dropField(section('Filters'), 'status')
    expect(screen.getAllByLabelText('Condition field').at(-1)).toHaveValue('status')

    dropField(section('Columns'), 'event_id')
    expect(screen.getByLabelText('Selected column')).toHaveValue('event_id')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('renders a Search Query DSL builder with filters, source fields, and aggregations', () => {
    const onBuilderStateChange = vi.fn()

    render(
      <BuilderHarness
        connectionEngine="elasticsearch"
        initialBuilderState={createDefaultSearchDslBuilderState('products', 20)}
        onBuilderStateChange={onBuilderStateChange}
        tab={searchTab()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Search Query DSL builder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Index')).toHaveValue('products')
    fireEvent.change(screen.getByLabelText('Search query mode'), {
      target: { value: 'match' },
    })
    fireEvent.change(screen.getByLabelText('Search field'), {
      target: { value: 'name' },
    })
    fireEvent.change(screen.getByLabelText('Search value'), {
      target: { value: 'lamp' },
    })

    dropField(section('Filters'), 'status.keyword')
    expect(screen.getByLabelText('Filter field')).toHaveValue('status.keyword')

    dropField(section('Source Fields'), 'sku')
    expect(screen.getByLabelText('Source Fields field')).toHaveValue('sku')

    dropField(section('Aggregations'), 'status.keyword')
    expect(screen.getByLabelText('Aggregation field')).toHaveValue('status.keyword')
    expect(onBuilderStateChange).toHaveBeenCalled()
  })

  it('opens Redis tabs as a key browser and inspects selected keys', async () => {
    const onBuilderStateChange = vi.fn()
    const onInspectRedisKey = vi.fn()
    const onScanRedisKeys = vi.fn().mockResolvedValue({
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      cursor: '0',
      scannedCount: 3,
      keys: [
        {
          key: 'product:luna-lamp',
          type: 'hash',
          ttlLabel: 'No limit',
          memoryUsageLabel: '120 B',
          length: 4,
        },
      ],
      usedTypeFilterFallback: false,
      moduleTypes: [],
      warnings: [],
    })

    render(
      <BuilderHarness
        connectionEngine="redis"
        initialBuilderState={createDefaultRedisKeyBrowserState('*', 100)}
        onBuilderStateChange={onBuilderStateChange}
        onInspectRedisKey={onInspectRedisKey}
        onScanRedisKeys={onScanRedisKeys}
        tab={redisTab()}
      />,
    )

    expect(screen.getByLabelText('Redis key browser')).toBeInTheDocument()
    expect(screen.getByLabelText('Redis database index')).toHaveValue(0)
    expect(screen.getByLabelText('Redis key type')).toHaveValue('all')
    expect(screen.getByLabelText('Redis TTL filter')).toHaveValue('all')
    expect(screen.getByLabelText('Redis namespace delimiter')).toHaveValue(':')
    expect(screen.getByLabelText('Filter by key name or pattern')).toHaveValue('*')
    await waitFor(() =>
      expect(onScanRedisKeys).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseIndex: 0,
          delimiter: ':',
          filters: { ttl: 'all' },
        }),
      ),
    )
    fireEvent.change(screen.getByLabelText('Redis database index'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Redis TTL filter'), { target: { value: 'expiring' } })
    expect(onBuilderStateChange).toHaveBeenCalledWith(
      'tab-redis',
      expect.objectContaining({ databaseIndex: 2 }),
    )
    expect(onBuilderStateChange).toHaveBeenCalledWith(
      'tab-redis',
      expect.objectContaining({ filters: expect.objectContaining({ ttl: 'expiring' }) }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /product1/ })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /product1/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'product:luna-lamp' })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'product:luna-lamp' }))

    expect(onInspectRedisKey).toHaveBeenCalledWith({
      tabId: 'tab-redis',
      connectionId: 'conn-redis',
      environmentId: 'env-dev',
      key: 'product:luna-lamp',
      sampleSize: 100,
    })
  })

  it('deletes Redis keys through the guarded edit flow without an extra dialog', async () => {
    const onExecuteDataEdit = vi.fn().mockResolvedValue({
      executed: true,
      operationId: 'redis.data-edit.delete-key',
      summary: 'Deleted key.',
      warnings: [],
      messages: ['Deleted key.'],
    })
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(
      <BuilderHarness
        connectionEngine="redis"
        initialBuilderState={createDefaultRedisKeyBrowserState('*', 100)}
        onBuilderStateChange={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
        onScanRedisKeys={vi.fn().mockResolvedValue({
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          cursor: '0',
          scannedCount: 1,
          keys: [
            {
              key: 'product:luna-lamp',
              type: 'string',
              ttlLabel: 'No limit',
              memoryUsageLabel: '80 B',
            },
          ],
          usedTypeFilterFallback: false,
          moduleTypes: [],
          warnings: [],
        })}
        tab={redisTab()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /product1/ })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /product1/ }))
    await waitFor(() => expect(screen.getByText('product:luna-lamp')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete product:luna-lamp' }))

    await waitFor(() => expect(onExecuteDataEdit).toHaveBeenCalledTimes(1))
    expect(
      screen.queryByRole('dialog', { name: 'Delete Redis key product:luna-lamp?' }),
    ).not.toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onExecuteDataEdit).toHaveBeenCalledWith(expect.objectContaining({
      editKind: 'delete-key',
      target: expect.objectContaining({ key: 'product:luna-lamp' }),
    }))
    confirmSpy.mockRestore()
  })
})

function BuilderHarness({
  connectionEngine = 'mongodb',
  initialBuilderState,
  onInspectRedisKey,
  onScanRedisKeys,
  onExecuteDataEdit,
  onBuilderStateChange,
  tab,
}: {
  connectionEngine?: 'mongodb' | 'postgresql' | 'dynamodb' | 'cassandra' | 'elasticsearch' | 'redis'
  initialBuilderState?: QueryBuilderState
  onExecuteDataEdit?: ComponentProps<typeof QueryBuilderPanel>['onExecuteDataEdit']
  onInspectRedisKey?: ComponentProps<typeof QueryBuilderPanel>['onInspectRedisKey']
  onScanRedisKeys?: ComponentProps<typeof QueryBuilderPanel>['onScanRedisKeys']
  onBuilderStateChange(tabId: string, builderState: QueryBuilderState): void
  tab: QueryTabState
}) {
  const [builderState, setBuilderState] = useState<QueryBuilderState>(
    initialBuilderState ?? createDefaultMongoFindBuilderState('products'),
  )

  return (
    <QueryBuilderPanel
      connection={{
        id: `conn-${connectionEngine}`,
        name: connectionEngine,
        engine: connectionEngine,
        family:
          connectionEngine === 'mongodb'
            ? 'document'
            : connectionEngine === 'redis'
              ? 'keyvalue'
            : connectionEngine === 'dynamodb'
              ? 'widecolumn'
            : connectionEngine === 'cassandra'
                ? 'widecolumn'
                : connectionEngine === 'elasticsearch'
                  ? 'search'
                  : 'sql',
        host: '127.0.0.1',
        environmentIds: ['env-dev'],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: connectionEngine,
        auth: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }}
      tab={tab}
      builderState={builderState}
      collectionOptions={['products', 'inventory', 'orders']}
      tableOptions={['accounts', 'orders', 'Orders']}
      onBuilderStateChange={(tabId, nextBuilderState) => {
        setBuilderState(nextBuilderState)
        onBuilderStateChange(tabId, nextBuilderState)
      }}
      onExecuteDataEdit={onExecuteDataEdit}
      onInspectRedisKey={onInspectRedisKey}
      onScanRedisKeys={onScanRedisKeys}
    />
  )
}

function redisTab(): QueryTabState {
  const builderState: QueryBuilderState = createDefaultRedisKeyBrowserState('*')

  return {
    id: 'tab-redis',
    title: 'Console 1.redis',
    connectionId: 'conn-redis',
    environmentId: 'env-dev',
    family: 'keyvalue',
    language: 'redis',
    editorLabel: 'Redis console',
    queryText: 'SCAN 0 MATCH * COUNT 100',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
  }
}

function searchTab(): QueryTabState {
  const builderState: QueryBuilderState = createDefaultSearchDslBuilderState('products')

  return {
    id: 'tab-search',
    title: 'products.json',
    connectionId: 'conn-search',
    environmentId: 'env-dev',
    family: 'search',
    language: 'query-dsl',
    editorLabel: 'Search DSL editor',
    queryText: '{}',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
  }
}

function cassandraTab(): QueryTabState {
  const builderState: QueryBuilderState = createDefaultCqlPartitionBuilderState(
    'events_by_customer',
    'app',
  )

  return {
    id: 'tab-cassandra',
    title: 'events_by_customer.cql',
    connectionId: 'conn-cassandra',
    environmentId: 'env-dev',
    family: 'widecolumn',
    language: 'cql',
    editorLabel: 'CQL editor',
    queryText: 'select * from app.events_by_customer limit 20;',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
  }
}

function dynamoDbTab(): QueryTabState {
  const builderState: QueryBuilderState = createDefaultDynamoDbKeyConditionBuilderState('Orders')

  return {
    id: 'tab-dynamodb',
    title: 'Orders.json',
    connectionId: 'conn-dynamodb',
    environmentId: 'env-dev',
    family: 'widecolumn',
    language: 'json',
    editorLabel: 'Document query',
    queryText: '{}',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
  }
}

function sqlTab(): QueryTabState {
  const builderState: QueryBuilderState = createDefaultSqlSelectBuilderState(
    'accounts',
    'public',
  )

  return {
    id: 'tab-sql',
    title: 'accounts.sql',
    connectionId: 'conn-postgresql',
    environmentId: 'env-dev',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL editor',
    queryText: 'select * from public.accounts limit 20;',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
  }
}

function section(title: string) {
  return screen.getByRole('heading', { name: title }).closest('section') as HTMLElement
}

function filterGroup(label: string) {
  return screen.getByLabelText(`Filter group ${label}`) as HTMLElement
}

function dropField(target: HTMLElement, field: string) {
  const dataTransfer = createFieldDataTransfer(field)

  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

function pointerDragDocumentFieldToTarget(field: string, target: HTMLElement) {
  const source = screen.getAllByTitle(`Drag ${field} to the query builder`).at(-1) as HTMLElement
  const builder = screen.getByLabelText('MongoDB query builder') as HTMLElement
  const builderRect = vi.spyOn(builder, 'getBoundingClientRect').mockReturnValue({
    bottom: 500,
    height: 500,
    left: 0,
    right: 500,
    toJSON: () => ({}),
    top: 0,
    width: 500,
    x: 0,
    y: 0,
  })
  const originalElementFromPoint = document.elementFromPoint
  const elementFromPoint = vi.fn().mockReturnValue(target)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPoint,
  })

  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 600, pointerId: 3 })
  fireEvent.pointerMove(window, { clientX: 18, clientY: 590, pointerId: 3 })
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 3 })

  expect(builder).toHaveClass('is-drag-over')

  fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 3 })

  builderRect.mockRestore()
  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    })
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint')
  }
}

function createFieldDataTransfer(
  field = '',
  options: {
    includeCustomPayload?: boolean
    includeFieldMime?: boolean
    includeText?: boolean
  } = {},
) {
  const includeCustomPayload = options.includeCustomPayload ?? true
  const includeFieldMime = options.includeFieldMime ?? true
  const includeText = options.includeText ?? true
  const data = new Map<string, string>()

  if (includeFieldMime) {
    data.set(FIELD_DRAG_MIME, field)
  }

  if (includeText) {
    data.set('text/plain', field)
  }

  return {
    effectAllowed: '',
    dropEffect: 'copy',
    types: Array.from(data.keys()),
    getData: (type: string) =>
      includeCustomPayload || type !== FIELD_DRAG_PAYLOAD_MIME
        ? data.get(type) ?? ''
        : '',
    setData: (type: string, value: string) => {
      data.set(type, value)
    },
  }
}

function mongoTab(overrides: Partial<QueryTabState> = {}): QueryTabState {
  const builderState: QueryBuilderState = createDefaultMongoFindBuilderState('products')

  return {
    id: 'tab-mongo',
    title: 'products.find.json',
    connectionId: 'conn-mongo',
    environmentId: 'env-dev',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'Document query',
    queryText: '{}',
    status: 'idle',
    dirty: false,
    history: [],
    builderState,
    ...overrides,
  }
}
