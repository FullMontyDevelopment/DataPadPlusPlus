import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeRenderedColumnWidths } from './data-grid-layout'
import {
  FIELD_POINTER_DRAG_DROP_EVENT,
  clearFieldDragData,
  type FieldPointerDragDetail,
} from './field-drag'
import { JsonTreeView } from './JsonTreeView'
import { ResultPayloadView } from './ResultPayloadView'

const writeTextSpy = vi.fn()

beforeEach(() => {
  writeTextSpy.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextSpy },
  })
})

afterEach(() => {
  clearFieldDragData()
})

describe('ResultPayloadView', () => {
  it('renders document payloads as an expandable table with closed child rows', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [
            {
              _id: 'account-1',
              profile: { name: 'Avery', plan: 'Team' },
            },
          ],
        }}
      />,
    )

    const documentTable = screen.getByRole('treegrid', { name: 'Document result table' })
    expect(within(documentTable).getByText('key / _id')).toBeInTheDocument()
    expect(within(documentTable).getByText('type')).toBeInTheDocument()
    expect(within(documentTable).getByText('value')).toBeInTheDocument()
    expect(within(documentTable).getByText('account-1')).toBeInTheDocument()
    expect(within(documentTable).getByText('{2 field(s)}')).toBeInTheDocument()
    expect(screen.queryByText('profile')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))

    expect(screen.getByText('profile')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand profile' }))
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('treats malformed null document payload arrays as empty results', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: null,
        } as unknown as Parameters<typeof ResultPayloadView>[0]['payload']}
      />,
    )

    expect(screen.getByText('No documents returned.')).toBeInTheDocument()
  })

  it('shows non-string document _id values as the root label value', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [{ _id: { $oid: '507f1f77bcf86cd799439011' }, status: 'active' }],
        }}
      />,
    )

    const documentTable = screen.getByRole('treegrid', { name: 'Document result table' })
    expect(within(documentTable).getByText('{"$oid":"507f1f77bcf86cd799439011"}')).toBeInTheDocument()
    expect(within(documentTable).queryByText('_id: {1 field(s)}')).not.toBeInTheDocument()
  })

  it('shows the execution summary in the document grid footer', () => {
    render(
      <ResultPayloadView
        resultDurationMs={1234}
        resultSummary="2 document(s) returned from Copy of Fixture MongoDB."
        payload={{
          renderer: 'document',
          documents: [
            { _id: 'account-1', status: 'active' },
            { _id: 'account-2', status: 'paused' },
          ],
        }}
      />,
    )

    expect(screen.getByText('2 document(s) loaded')).toBeInTheDocument()
    expect(screen.getByText('00:00:01.234')).toBeInTheDocument()
    expect(screen.queryByText(/returned from Copy of Fixture MongoDB/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/visible row\(s\)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/editable document result/i)).not.toBeInTheDocument()
  })

  it('renders metrics labels as readable text instead of raw JSON', () => {
    const executeDataEdit = vi.fn()

    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select id, status from dbo.orders',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'metrics',
          metrics: [
            {
              name: 'redis.ops_per_sec',
              value: 42,
              unit: 'ops/s',
              labels: { source: 'INFO stats', databaseName: 'cache' },
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Source: INFO stats; Database Name: cache')).toBeInTheDocument()
    expect(screen.queryByText(/"source"/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Row' })).not.toBeInTheDocument()
  })

  it('renders series point labels as readable text instead of raw JSON', () => {
    const executeDataEdit = vi.fn()

    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select id, status from dbo.orders',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'series',
          series: [
            {
              name: 'connections',
              unit: 'clients',
              points: [
                {
                  timestamp: '2026-05-22T10:00:00.000Z',
                  value: 3,
                  labels: { source: 'serverStatus.connections' },
                },
              ],
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Source: serverStatus.connections')).toBeInTheDocument()
    expect(screen.queryByText(/"source"/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Row' })).not.toBeInTheDocument()
  })

  it('copies document values from the expandable table', async () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'active' }))

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('active')
    })
  })

  it('filters loaded documents locally without rerunning or paging', async () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [
            {
              _id: 'account-1',
              profile: { name: 'Avery', plan: 'Team' },
            },
            {
              _id: 'account-2',
              profile: { name: 'Blake', plan: 'Solo' },
            },
          ],
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search loaded documents'), {
      target: { value: 'avery' },
    })

    expect(screen.getByText('Searching...')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('2 match(es)')).toBeInTheDocument()
    })
    expect(screen.getByText('account-1')).toBeInTheDocument()
    expect(screen.getByText('profile')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avery' })).toBeInTheDocument()
    expect(screen.queryByText('account-2')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search loaded documents'), {
      target: { value: '' },
    })

    await waitFor(() => {
      expect(screen.getByText('account-2')).toBeInTheDocument()
    })
  })

  it('opens a raw JSON side inspector from the document context menu', async () => {
    render(
      <ResultPayloadView
        connection={mongoConnection()}
        payload={{
          renderer: 'document',
          documents: [
            {
              _id: 'account-1',
              status: 'active',
              count: 7,
            },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'active' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Raw JSON' }))

    const inspector = screen.getByRole('complementary', {
      name: 'Document field raw JSON inspector',
    })
    expect(inspector).toBeInTheDocument()
    expect(within(inspector).getByText('status')).toBeInTheDocument()
    expect(within(inspector).getByLabelText('Selected field raw JSON')).toHaveTextContent('"active"')

    fireEvent.change(screen.getByLabelText('Search raw JSON'), {
      target: { value: 'active' },
    })

    expect(within(inspector).getByText('1/1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy Raw JSON' }))
    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('"active"')
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: '7' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Raw JSON' }))
    fireEvent.change(screen.getByLabelText('Change inspected field type count'), {
      target: { value: 'string' },
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Selected field raw JSON')).toHaveTextContent('"7"')
    })
  })

  it('uses visible document rows as pointer drag handles for query builder drops', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))

    const field = screen.getByText('status')
    const drops: FieldPointerDragDetail[] = []
    const onDrop = (event: Event) => {
      drops.push((event as CustomEvent<FieldPointerDragDetail>).detail)
    }
    window.addEventListener(FIELD_POINTER_DRAG_DROP_EVENT, onDrop)

    const valueCell = screen.getByRole('button', { name: 'active' })
    const row = field.closest('[role="row"]')

    expect(row).toHaveClass('is-field-draggable')
    expect(valueCell).not.toHaveAttribute('draggable')

    fireEvent.pointerDown(field, { button: 0, clientX: 10, clientY: 10, pointerId: 7 })
    fireEvent.pointerMove(window, { clientX: 18, clientY: 20, pointerId: 7 })
    expect(document.body).toHaveClass('is-field-pointer-dragging')
    fireEvent.pointerUp(window, { clientX: 30, clientY: 40, pointerId: 7 })

    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({
      clientX: 30,
      clientY: 40,
      payload: {
        fieldPath: 'status',
        value: 'active',
        valueLabel: 'active',
        valueType: 'string',
      },
    })
    expect(document.body).not.toHaveClass('is-field-pointer-dragging')

    window.removeEventListener(FIELD_POINTER_DRAG_DROP_EVENT, onDrop)
  })

  it('enables Mongo document inline edits, typed badges, and context actions', async () => {
    render(
      <ResultPayloadView
        connection={mongoConnection()}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active', count: 7 }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))

    expect(screen.queryByLabelText('Change type status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Change type count')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit value status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rename field status')).not.toBeInTheDocument()
    expect(screen.getAllByText('string')[0]).toHaveClass('is-string')
    expect(screen.getByText('number')).toHaveClass('is-number')

    fireEvent.doubleClick(screen.getByText('status'))
    const renameInput = screen.getByLabelText('Rename field status')
    fireEvent.change(renameInput, {
      target: { value: 'state' },
    })
    fireEvent.blur(renameInput)
    expect(screen.getByText('state')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    const valueInput = screen.getByLabelText('Edit value state')
    fireEvent.change(valueInput, {
      target: { value: 'paused' },
    })
    fireEvent.blur(valueInput)
    expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('number'))
    expect(screen.getByLabelText('Change type count')).toHaveClass('is-number')
    fireEvent.change(screen.getByLabelText('Change type count'), {
      target: { value: 'string' },
    })
    expect(screen.queryByLabelText('Change type count')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'paused' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }))

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('paused')
    })
  })

  it('executes Mongo document field edits with collection and document scope', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-mongo',
      environmentId: 'env-dev',
      editKind: 'set-field',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'mongodb.data-edit.set-field',
        engine: 'mongodb',
        summary: 'Updated document field.',
        generatedRequest: '{}',
        requestLanguage: 'mongodb',
        destructive: false,
        requiredPermissions: ['update collection document'],
        warnings: [],
      },
      messages: ['Updated document field.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={mongoConnection()}
        editContext={{
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "database": "catalog", "collection": "products", "filter": {}, "limit": 20 }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    const valueInput = screen.getByLabelText('Edit value status')
    fireEvent.change(valueInput, { target: { value: 'paused' } })
    fireEvent.blur(valueInput)

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-mongo',
        environmentId: 'env-dev',
        editKind: 'set-field',
        target: {
          objectKind: 'document',
          path: ['status'],
          database: 'catalog',
          collection: 'products',
          documentId: 'account-1',
        },
        changes: [
          {
            path: ['status'],
            value: 'paused',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument()
  })

  it('uses a confirm dialog instead of typed confirmation for guarded Mongo field edits', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-mongo',
      environmentId: 'env-qa',
      editKind: 'set-field',
      executionSupport: 'live',
      executed: Boolean(request.confirmationText),
      plan: {
        operationId: 'mongodb.data-edit.set-field',
        engine: 'mongodb',
        summary: 'Updated document field.',
        generatedRequest: '{}',
        requestLanguage: 'mongodb',
        destructive: false,
        requiredPermissions: ['update collection document'],
        confirmationText: 'CONFIRM QA',
        warnings: ['QA requires confirmation for risky work.'],
      },
      messages: request.confirmationText ? ['Updated document field.'] : [],
      warnings: request.confirmationText
        ? []
        : ['This data edit needs confirmation before it can run.'],
    }))

    render(
      <ResultPayloadView
        connection={mongoConnection()}
        editContext={{
          connectionId: 'conn-mongo',
          environmentId: 'env-qa',
          queryText: '{ "collection": "products", "filter": {}, "limit": 20 }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    const valueInput = screen.getByLabelText('Edit value status')
    fireEvent.change(valueInput, { target: { value: 'paused' } })
    fireEvent.blur(valueInput)

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Apply this document edit?' }),
      ).toBeInTheDocument()
    })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(executeDataEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledTimes(2)
    })
    expect(executeDataEdit).toHaveBeenCalledTimes(2)
    expect(executeDataEdit).toHaveBeenLastCalledWith(expect.objectContaining({
      confirmationText: 'CONFIRM QA',
    }))
    expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('confirms Mongo document field deletion before executing the edit', async () => {
    const executeDataEdit = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(
      <ResultPayloadView
        connection={mongoConnection()}
        editContext={{
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products", "filter": {}, "limit": 20 }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'active' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Field' }))

    expect(screen.getByRole('dialog', { name: 'Delete field status?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(executeDataEdit).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('clears stale document field confirmations when a new document payload arrives', () => {
    const executeDataEdit = vi.fn()
    const { rerender } = render(
      <ResultPayloadView
        connection={mongoConnection()}
        editContext={{
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products", "filter": {}, "limit": 20 }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'active' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Field' }))
    expect(screen.getByRole('dialog', { name: 'Delete field status?' })).toBeInTheDocument()

    rerender(
      <ResultPayloadView
        connection={mongoConnection()}
        editContext={{
          connectionId: 'conn-mongo',
          environmentId: 'env-dev',
          queryText: '{ "collection": "products", "filter": {}, "limit": 20 }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-2', status: 'paused' }],
        }}
      />,
    )

    expect(screen.queryByRole('dialog', { name: 'Delete field status?' })).not.toBeInTheDocument()
    expect(executeDataEdit).not.toHaveBeenCalled()
  })

  it('keeps non-editable document results read-only on double click', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'document',
          documents: [{ _id: 'account-1', status: 'active' }],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand account-1' }))
    fireEvent.doubleClick(screen.getByText('status'))
    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    const stringBadges = screen.getAllByText('string')
    expect(stringBadges).toHaveLength(2)
    fireEvent.doubleClick(stringBadges[1]!)

    expect(screen.queryByLabelText('Rename field status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit value status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Change type status')).not.toBeInTheDocument()
  })

  it('renders table payloads with compact filtering and keyboard copy shortcuts', async () => {
    const { container } = render(
      <ResultPayloadView
        payload={{
          renderer: 'table',
          columns: ['name', 'status'],
          rows: [
            ['Avery', 'active'],
            ['Blake', 'paused'],
          ],
        }}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Find in results'), {
      target: { value: 'avery' },
    })

    expect(screen.queryByText(/buffered row\(s\)/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy Selection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy Row' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy All' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avery' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Blake' })).not.toBeInTheDocument()
    expect(
      container.querySelector('.data-grid-row:not(.data-grid-row--header)'),
    ).toHaveStyle({ transform: 'translateY(30px)' })

    const averyCell = screen.getByRole('button', { name: 'Avery' })
    fireEvent.pointerDown(averyCell)
    fireEvent.keyDown(averyCell, { key: 'c', ctrlKey: true })

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('Avery')
    })

    const rowNumber = screen.getByRole('button', { name: 'Select row 1' })
    fireEvent.pointerDown(rowNumber)
    fireEvent.keyDown(rowNumber, { key: 'c', ctrlKey: true })

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith('Avery\tactive')
    })
  })

  it('executes SQL table cell edits through safe update-row requests', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'update-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'sqlserver.data-edit.update-row',
        engine: 'sqlserver',
        summary: 'Updated row.',
        generatedRequest: 'update [dbo].[orders] set [status] = @P1 where [order_id] = @P2;',
        requestLanguage: 'sql',
        destructive: false,
        requiredPermissions: ['update table row'],
        warnings: [],
      },
      messages: ['Updated row.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status from dbo.orders',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))
    const input = screen.getByLabelText('Edit status row 1')
    fireEvent.change(input, { target: { value: 'fulfilled' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        editKind: 'update-row',
        target: {
          objectKind: 'row',
          path: [],
          schema: 'dbo',
          table: 'orders',
          primaryKey: {
            order_id: 101,
          },
        },
        changes: [
          {
            field: 'status',
            value: 'fulfilled',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'fulfilled' })).toBeInTheDocument()
  })

  it('resets SQL table optimistic edits when a new table result payload arrives', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'update-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'sqlserver.data-edit.update-row',
        engine: 'sqlserver',
        summary: 'Updated row.',
        generatedRequest: 'update [dbo].[orders] set [status] = @P1 where [order_id] = @P2;',
        requestLanguage: 'sql',
        destructive: false,
        requiredPermissions: ['update table row'],
        warnings: [],
      },
      messages: ['Updated row.'],
      warnings: [],
    }))
    const props = {
      connection: sqlConnection(),
      editContext: {
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        queryText: 'select order_id, status from dbo.orders',
      },
      onExecuteDataEdit: executeDataEdit,
    }
    const { rerender } = render(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))
    fireEvent.change(screen.getByLabelText('Edit status row 1'), {
      target: { value: 'fulfilled' },
    })
    fireEvent.blur(screen.getByLabelText('Edit status row 1'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'fulfilled' })).toBeInTheDocument()
    })

    rerender(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['102', 'queued']],
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'fulfilled' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '101' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '102' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('cancels stale SQL cell editors when a new table payload arrives', () => {
    const executeDataEdit = vi.fn()
    const props = {
      connection: sqlConnection(),
      editContext: {
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        queryText: 'select order_id, status from dbo.orders',
      },
      onExecuteDataEdit: executeDataEdit,
    }
    const { rerender } = render(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))
    const staleInput = screen.getByLabelText('Edit status row 1')
    fireEvent.change(staleInput, { target: { value: 'fulfilled' } })

    rerender(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['102', 'queued']],
        }}
      />,
    )

    expect(screen.queryByLabelText('Edit status row 1')).not.toBeInTheDocument()
    fireEvent.blur(staleInput)
    expect(executeDataEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('cancels guarded SQL cell edit confirmations when a new table payload arrives', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: Boolean(request.confirmationText),
      plan: {
        operationId: 'sqlserver.data-edit.update-row',
        engine: 'sqlserver',
        summary: 'Updated row.',
        generatedRequest: 'update [dbo].[orders] set [status] = @P1 where [order_id] = @P2;',
        requestLanguage: 'sql',
        destructive: false,
        confirmationText: 'CONFIRM SQLSERVER UPDATE-ROW',
        requiredPermissions: ['update table row'],
        warnings: ['QA requires confirmation.'],
      },
      messages: request.confirmationText ? ['Updated row.'] : [],
      warnings: request.confirmationText ? [] : ['This data edit needs confirmation.'],
    }))
    const props = {
      connection: sqlConnection(),
      editContext: {
        connectionId: 'conn-sql',
        environmentId: 'env-qa',
        queryText: 'select order_id, status from dbo.orders',
      },
      onExecuteDataEdit: executeDataEdit,
    }
    const { rerender } = render(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))
    fireEvent.change(screen.getByLabelText('Edit status row 1'), {
      target: { value: 'fulfilled' },
    })
    fireEvent.blur(screen.getByLabelText('Edit status row 1'))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Apply this row edit?' })).toBeInTheDocument()
    })

    rerender(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['102', 'queued']],
        }}
      />,
    )

    expect(screen.queryByRole('dialog', { name: 'Apply this row edit?' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('keeps SQL table cells read-only when a primary key cannot be inferred', () => {
    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select status from dbo.orders',
        }}
        onExecuteDataEdit={vi.fn()}
        payload={{
          renderer: 'table',
          columns: ['status'],
          rows: [['processing']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))

    expect(screen.queryByLabelText('Edit status row 1')).not.toBeInTheDocument()
  })

  it('inserts SQL rows from the grid insert panel', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'insert-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'sqlserver.data-edit.insert-row',
        engine: 'sqlserver',
        summary: 'Inserted row.',
        generatedRequest: 'insert into [dbo].[orders] ([order_id], [status]) values (@P1, @P2);',
        requestLanguage: 'sql',
        destructive: false,
        requiredPermissions: ['insert-row on table'],
        warnings: [],
      },
      messages: ['Inserted row.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status from dbo.orders',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }))
    fireEvent.change(screen.getByLabelText('Insert order_id'), {
      target: { value: '103' },
    })
    fireEvent.change(screen.getByLabelText('Insert status'), {
      target: { value: 'queued' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        editKind: 'insert-row',
        target: {
          objectKind: 'row',
          path: [],
          schema: 'dbo',
          table: 'orders',
        },
        changes: [
          {
            field: 'order_id',
            value: 103,
            valueType: 'number',
          },
          {
            field: 'status',
            value: 'queued',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('deletes SQL rows from the context menu with a confirm/cancel action', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'delete-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'sqlserver.data-edit.delete-row',
        engine: 'sqlserver',
        summary: 'Deleted row.',
        generatedRequest: 'delete from [dbo].[orders] where [order_id] = @P1;',
        requestLanguage: 'sql',
        destructive: true,
        confirmationText: 'CONFIRM SQLSERVER DELETE-ROW',
        requiredPermissions: ['delete table row'],
        warnings: [],
      },
      messages: ['Deleted row.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={sqlConnection()}
        editContext={{
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status from dbo.orders',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [
            ['101', 'processing'],
            ['102', 'queued'],
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'processing' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Row' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        editKind: 'delete-row',
        confirmationText: 'CONFIRM SQLSERVER DELETE-ROW',
        target: {
          objectKind: 'row',
          path: [],
          schema: 'dbo',
          table: 'orders',
          primaryKey: {
            order_id: 101,
          },
        },
        changes: [],
      })
    })
    expect(screen.queryByRole('button', { name: 'processing' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('clears stale SQL row delete prompts when a new table payload arrives', () => {
    const executeDataEdit = vi.fn()
    const props = {
      connection: sqlConnection(),
      editContext: {
        connectionId: 'conn-sql',
        environmentId: 'env-dev',
        queryText: 'select order_id, status from dbo.orders',
      },
      onExecuteDataEdit: executeDataEdit,
    }
    const { rerender } = render(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['101', 'processing']],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'processing' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Row' }))
    expect(screen.getByRole('dialog', { name: 'Delete row 1?' })).toBeInTheDocument()

    rerender(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'table',
          columns: ['order_id', 'status'],
          rows: [['102', 'queued']],
        }}
      />,
    )

    expect(screen.queryByRole('dialog', { name: 'Delete row 1?' })).not.toBeInTheDocument()
    expect(executeDataEdit).not.toHaveBeenCalled()
  })

  it('executes DynamoDB table cell edits through safe update-item requests', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'update-item',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'dynamodb.data-edit.update-item',
        engine: 'dynamodb',
        summary: 'Updated item.',
        generatedRequest: 'UpdateItem',
        requestLanguage: 'query-dsl',
        destructive: false,
        requiredPermissions: ['write item/row with complete key'],
        warnings: [],
      },
      messages: ['Updated item.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={dynamoConnection()}
        editContext={{
          connectionId: 'conn-dynamodb',
          environmentId: 'env-dev',
          queryText: '{ "operation": "Query", "TableName": "Orders" }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['pk', 'sk', 'status'],
          rows: [['CUSTOMER#123', 'ORDER#1001', 'open']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'open' }))
    const input = screen.getByLabelText('Edit status row 1')
    fireEvent.change(input, { target: { value: 'closed' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-dynamodb',
        environmentId: 'env-dev',
        editKind: 'update-item',
        target: {
          objectKind: 'item',
          path: [],
          table: 'Orders',
          itemKey: {
            pk: 'CUSTOMER#123',
            sk: 'ORDER#1001',
          },
        },
        changes: [
          {
            field: 'status',
            value: 'closed',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'closed' })).toBeInTheDocument()
  })

  it('deletes DynamoDB items from the context menu with a confirm/cancel action', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'delete-item',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'dynamodb.data-edit.delete-item',
        engine: 'dynamodb',
        summary: 'Deleted item.',
        generatedRequest: 'DeleteItem',
        requestLanguage: 'query-dsl',
        destructive: true,
        confirmationText: 'CONFIRM DYNAMODB DELETE-ITEM',
        requiredPermissions: ['write item/row with complete key'],
        warnings: [],
      },
      messages: ['Deleted item.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={dynamoConnection()}
        editContext={{
          connectionId: 'conn-dynamodb',
          environmentId: 'env-dev',
          queryText: '{ "operation": "Query", "TableName": "Orders" }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['pk', 'sk', 'status'],
          rows: [
            ['CUSTOMER#123', 'ORDER#1001', 'open'],
            ['CUSTOMER#123', 'ORDER#1002', 'closed'],
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'open' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Row' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-dynamodb',
        environmentId: 'env-dev',
        editKind: 'delete-item',
        confirmationText: 'CONFIRM DYNAMODB DELETE-ITEM',
        target: {
          objectKind: 'item',
          path: [],
          table: 'Orders',
          itemKey: {
            pk: 'CUSTOMER#123',
            sk: 'ORDER#1001',
          },
        },
        changes: [],
      })
    })
    expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'closed' })).toBeInTheDocument()
  })

  it('puts DynamoDB items from the grid insert panel', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'put-item',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'dynamodb.data-edit.put-item',
        engine: 'dynamodb',
        summary: 'Put item.',
        generatedRequest: 'PutItem',
        requestLanguage: 'query-dsl',
        destructive: false,
        requiredPermissions: ['write item/row with complete key'],
        warnings: [],
      },
      messages: ['Put item.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={dynamoConnection()}
        editContext={{
          connectionId: 'conn-dynamodb',
          environmentId: 'env-dev',
          queryText: '{ "operation": "Query", "TableName": "Orders" }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['pk', 'sk', 'status', 'total'],
          rows: [['CUSTOMER#123', 'ORDER#1001', 'open', '10']],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }))
    fireEvent.change(screen.getByLabelText('Insert pk'), {
      target: { value: 'CUSTOMER#123' },
    })
    fireEvent.change(screen.getByLabelText('Insert sk'), {
      target: { value: 'ORDER#1003' },
    })
    fireEvent.change(screen.getByLabelText('Insert status'), {
      target: { value: 'queued' },
    })
    fireEvent.change(screen.getByLabelText('Insert total'), {
      target: { value: '42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-dynamodb',
        environmentId: 'env-dev',
        editKind: 'put-item',
        target: {
          objectKind: 'item',
          path: [],
          table: 'Orders',
          itemKey: {
            pk: 'CUSTOMER#123',
            sk: 'ORDER#1003',
          },
        },
        changes: [
          {
            field: 'pk',
            value: 'CUSTOMER#123',
            valueType: 'string',
          },
          {
            field: 'sk',
            value: 'ORDER#1003',
            valueType: 'string',
          },
          {
            field: 'status',
            value: 'queued',
            valueType: 'string',
          },
          {
            field: 'total',
            value: 42,
            valueType: 'number',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'queued' })).toBeInTheDocument()
  })

  it('builds Cassandra row edits only from complete CQL key predicates', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-cassandra',
      environmentId: 'env-dev',
      editKind: 'update-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'cassandra.data-edit.update-row',
        engine: 'cassandra',
        summary: 'Updated row.',
        generatedRequest:
          'update commerce.orders set status = ? where account_id = ? and order_id = ?;',
        requestLanguage: 'cql',
        destructive: false,
        requiredPermissions: ['write item/row with complete key'],
        warnings: [],
      },
      messages: ['Updated row.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={cassandraConnection()}
        editContext={{
          connectionId: 'conn-cassandra',
          environmentId: 'env-dev',
          queryText:
            "select account_id, order_id, status from commerce.orders where account_id = 'acct-1' and order_id = 'order-1' limit 20;",
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'table',
          columns: ['account_id', 'order_id', 'status'],
          rows: [['acct-1', 'order-1', 'open']],
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'open' }))
    const input = screen.getByLabelText('Edit status row 1')
    fireEvent.change(input, { target: { value: 'closed' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-cassandra',
        environmentId: 'env-dev',
        editKind: 'update-row',
        target: {
          objectKind: 'row',
          path: [],
          schema: 'commerce',
          table: 'orders',
          primaryKey: {
            account_id: 'acct-1',
            order_id: 'order-1',
          },
        },
        changes: [
          {
            field: 'status',
            value: 'closed',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'closed' })).toBeInTheDocument()
  })

  it('stretches table columns to fill the visible grid width', () => {
    expect(computeRenderedColumnWidths(['name', 'status'], {}, 448)).toEqual([200, 200])
    expect(computeRenderedColumnWidths(['name', 'status'], {}, 300)).toEqual([160, 160])
  })

  it('parses JSON-looking key-value entries into expandable trees', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:1': '{"user":"avery","cart":{"items":3}}',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand session:1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand session:1' }))

    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('"avery"')).toBeInTheDocument()
    expect(screen.getByText('cart')).toBeInTheDocument()
  })

  it('executes Redis value and TTL edits from key-value results', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: `redis.data-edit.${request.editKind}`,
        engine: 'redis',
        summary: 'Edited key.',
        generatedRequest: 'SET session:1 paused',
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Edited key.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'GET session:1',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:1': 'active',
          },
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    fireEvent.change(screen.getByLabelText('Edit value session:1'), {
      target: { value: 'paused' },
    })
    fireEvent.blur(screen.getByLabelText('Edit value session:1'))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'set-key-value',
        target: {
          objectKind: 'key',
          path: [],
          key: 'session:1',
        },
        changes: [
          {
            value: 'paused',
            valueType: 'string',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'paused' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set TTL' }))
    fireEvent.change(screen.getByLabelText('TTL seconds'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set TTL' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenLastCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'set-ttl',
        target: {
          objectKind: 'key',
          path: [],
          key: 'session:1',
        },
        changes: [
          {
            value: 60,
            valueType: 'number',
          },
        ],
      })
    })
  })

  it('resets Redis optimistic key edits when a new result payload arrives', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: `redis.data-edit.${request.editKind}`,
        engine: 'redis',
        summary: 'Edited key.',
        generatedRequest: 'SET session:1 paused',
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Edited key.'],
      warnings: [],
    }))

    const props = {
      connection: redisConnection(),
      editContext: {
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        queryText: 'GET session:1',
      },
      onExecuteDataEdit: executeDataEdit,
    }
    const { rerender } = render(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:1': 'active',
          },
        }}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'active' }))
    fireEvent.change(screen.getByLabelText('Edit value session:1'), {
      target: { value: 'paused' },
    })
    fireEvent.blur(screen.getByLabelText('Edit value session:1'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument()
    })

    rerender(
      <ResultPayloadView
        {...props}
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:2': 'fresh',
          },
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'paused' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'session:1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'session:2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fresh' })).toBeInTheDocument()
  })

  it('adds Redis keys from key-value results', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.set-key-value',
        engine: 'redis',
        summary: 'Added key.',
        generatedRequest: 'SET session:2 {"state":"new"}',
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Added key.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'SCAN 0',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:1': 'active',
          },
        }}
      />,
    )

    const [openAddButton] = screen.getAllByRole('button', { name: 'Add Key' })
    expect(openAddButton).toBeDefined()
    fireEvent.click(openAddButton!)
    fireEvent.change(screen.getByLabelText('New key name'), {
      target: { value: 'session:2' },
    })
    fireEvent.change(screen.getByLabelText('New key value'), {
      target: { value: '{"state":"new"}' },
    })
    const submitAddButton = screen.getAllByRole('button', { name: 'Add Key' }).at(-1)
    expect(submitAddButton).toBeDefined()
    fireEvent.click(submitAddButton!)

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'set-key-value',
        target: {
          objectKind: 'key',
          path: [],
          key: 'session:2',
        },
        changes: [
          {
            value: { state: 'new' },
            valueType: 'object',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'session:2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '{"state":"new"}' })).toBeInTheDocument()
  })

  it('deletes Redis keys directly through runtime guardrails', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.delete-key',
        engine: 'redis',
        summary: 'Deleted key.',
        generatedRequest: 'DEL session:1',
        requestLanguage: 'redis',
        destructive: true,
        confirmationText: 'CONFIRM REDIS DELETE-KEY',
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Deleted key.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'GET session:1',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          entries: {
            'session:1': 'active',
          },
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'active' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Key' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'delete-key',
        confirmationText: undefined,
        target: {
          objectKind: 'key',
          path: [],
          key: 'session:1',
        },
        changes: [],
      })
    })
    expect(screen.queryByRole('button', { name: 'active' })).not.toBeInTheDocument()
  })

  it('deletes the selected Redis key from the key detail view', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.delete-key',
        engine: 'redis',
        summary: 'Deleted key.',
        generatedRequest: 'DEL product:luna-lamp',
        requestLanguage: 'redis',
        destructive: true,
        confirmationText: 'CONFIRM REDIS DELETE-KEY',
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Deleted key.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'hash',
          entries: {
            sku: 'luna-lamp',
            stock: '18',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete key product:luna-lamp' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'delete-key',
        confirmationText: undefined,
        target: {
          objectKind: 'key',
          path: [],
          key: 'product:luna-lamp',
        },
        changes: [],
      })
    })
    expect(screen.queryByRole('button', { name: 'sku' })).not.toBeInTheDocument()
    expect(screen.getByText('Deleted product:luna-lamp.')).toBeInTheDocument()
  })

  it('removes TTL from the selected Redis key detail view', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.persist-ttl',
        engine: 'redis',
        summary: 'Removed TTL.',
        generatedRequest: 'PERSIST product:luna-lamp',
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Removed TTL.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'hash',
          ttl: '600s',
          entries: {
            sku: 'luna-lamp',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove TTL for product:luna-lamp' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'persist-ttl',
        target: {
          objectKind: 'key',
          path: [],
          key: 'product:luna-lamp',
        },
        changes: [],
      })
    })
    expect(screen.getByText('Removed TTL for product:luna-lamp.')).toBeInTheDocument()
  })

  it('renames the selected Redis key from the key detail view', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.rename-key',
        engine: 'redis',
        summary: 'Renamed key.',
        generatedRequest: 'RENAME product:luna-lamp product:luna-lamp:v2',
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Renamed key.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'string',
          entries: {
            'product:luna-lamp': 'active',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rename key product:luna-lamp' }))
    fireEvent.change(screen.getByLabelText('New key name'), {
      target: { value: 'product:luna-lamp:v2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'rename-key',
        target: {
          objectKind: 'key',
          path: [],
          key: 'product:luna-lamp',
        },
        changes: [
          {
            field: 'product:luna-lamp',
            newName: 'product:luna-lamp:v2',
          },
        ],
      })
    })
    expect(screen.getByText('Renamed product:luna-lamp to product:luna-lamp:v2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'active' })).toBeInTheDocument()
  })

  it('prepares a Redis key export plan from the key detail view', async () => {
    const onPlanOperation = vi.fn(async (
      request: OperationPlanRequest,
    ): Promise<OperationPlanResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      plan: {
        operationId: request.operationId,
        engine: 'redis',
        summary: 'Export key.',
        generatedRequest: JSON.stringify({ key: request.objectName }),
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['read concrete key'],
        warnings: [],
      },
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onPlanOperation={onPlanOperation}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'hash',
          ttl: '600s',
          memoryUsage: '144 B',
          entries: {
            sku: 'luna-lamp',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export key product:luna-lamp' }))

    await waitFor(() => {
      expect(onPlanOperation).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        operationId: 'redis.key.export',
        objectName: 'product:luna-lamp',
        parameters: {
          key: 'product:luna-lamp',
          redisType: 'hash',
          format: 'json',
          includeTtl: true,
          includeType: true,
          includeMetadata: true,
        },
      })
    })
    expect(screen.getByText('Export plan ready for product:luna-lamp.')).toBeInTheDocument()
  })

  it('prepares a Redis key import plan from the key detail view', async () => {
    const onPlanOperation = vi.fn(async (
      request: OperationPlanRequest,
    ): Promise<OperationPlanResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      plan: {
        operationId: request.operationId,
        engine: 'redis',
        summary: 'Import key.',
        generatedRequest: JSON.stringify({ key: request.objectName }),
        requestLanguage: 'redis',
        destructive: false,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onPlanOperation={onPlanOperation}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'hash',
          entries: {
            sku: 'luna-lamp',
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Import key product:luna-lamp' }))

    await waitFor(() => {
      expect(onPlanOperation).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        operationId: 'redis.key.import',
        objectName: 'product:luna-lamp',
        parameters: {
          key: 'product:luna-lamp',
          redisType: 'hash',
          format: 'json',
          mode: 'create-or-replace',
          ttl: 'preserve',
          validation: 'validate-before-write',
        },
      })
    })
    expect(screen.getByText('Import plan ready for product:luna-lamp.')).toBeInTheDocument()
  })

  it('deletes Redis hash fields from key detail context menus without deleting fake top-level keys', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'redis.data-edit.hash-delete-field',
        engine: 'redis',
        summary: 'Deleted field.',
        generatedRequest: 'HDEL product:luna-lamp sku',
        requestLanguage: 'redis',
        destructive: true,
        requiredPermissions: ['write concrete key'],
        warnings: [],
      },
      messages: ['Deleted field.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={redisConnection()}
        editContext={{
          connectionId: 'conn-redis',
          environmentId: 'env-dev',
          queryText: 'INSPECT product:luna-lamp',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'keyvalue',
          key: 'product:luna-lamp',
          redisType: 'hash',
          entries: {
            sku: 'luna-lamp',
            stock: '18',
          },
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'luna-lamp' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Field' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-redis',
        environmentId: 'env-dev',
        editKind: 'hash-delete-field',
        confirmationText: undefined,
        target: {
          objectKind: 'key-member',
          path: ['sku'],
          key: 'product:luna-lamp',
        },
        changes: [
          {
            field: 'sku',
            value: undefined,
            valueType: 'undefined',
          },
        ],
      })
    })
    expect(screen.queryByRole('button', { name: 'sku' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'stock' })).toBeInTheDocument()
  })

  it('shows actual returned documents in the JSON and Raw views', () => {
    const documents = [{ _id: 'product-1', sku: 'SKU-1' }]
    const { rerender } = render(
      <ResultPayloadView
        payload={{
          renderer: 'json',
          value: documents,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand result' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand [0]' }))

    expect(screen.getByText('sku')).toBeInTheDocument()
    expect(screen.getByText('"SKU-1"')).toBeInTheDocument()

    rerender(
      <ResultPayloadView
        payload={{
          renderer: 'raw',
          text: JSON.stringify(documents, null, 2),
        }}
      />,
    )

    expect(screen.getByLabelText('Raw result')).toHaveTextContent('SKU-1')
  })

  it('renders Redis RESP payloads as raw console text', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'resp',
          text: '*2\r\n$3\r\nsku\r\n:42',
        }}
      />,
    )

    expect(screen.getByLabelText('Raw result')).toHaveTextContent('$3')
    expect(screen.getByLabelText('Raw result')).toHaveTextContent(':42')
  })

  it('renders JSON payloads as trees while preserving primitive values', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'json',
          value: { ok: true, total: 42, message: 'ready' },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand result' }))

    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('total')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('"ready"')).toBeInTheDocument()
  })

  it('renders search hits as source and aggregation tree sections', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'searchHits',
          total: 1,
          hits: [
            {
              id: 'product-1',
              score: 1.25,
              source: { sku: 'SKU-1', inventory: { available: 7 } },
              highlights: { sku: ['<em>SKU</em>-1'] },
            },
          ],
          aggregations: { categories: { buckets: [{ key: 'coffee', doc_count: 1 }] } },
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'Search hits results' })).toBeInTheDocument()
    expect(screen.getByText('product-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand product-1' }))

    expect(screen.getByText('sku')).toBeInTheDocument()
    expect(screen.getByText('aggregations')).toBeInTheDocument()
  })

  it('refreshes search hit metadata when the source document stays the same', () => {
    const source = { sku: 'SKU-1' }
    const { rerender } = render(
      <ResultPayloadView
        payload={{
          renderer: 'searchHits',
          hits: [
            {
              id: 'product-1',
              score: 1.25,
              source,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('1.25')).toBeInTheDocument()

    rerender(
      <ResultPayloadView
        payload={{
          renderer: 'searchHits',
          hits: [
            {
              id: 'product-1',
              score: 2.5,
              source,
            },
          ],
        }}
      />,
    )

    expect(screen.queryByText('1.25')).not.toBeInTheDocument()
    expect(screen.getByText('2.5')).toBeInTheDocument()
  })

  it('updates search hit source documents through guarded search edit requests', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'elasticsearch.data-edit.update-document',
        engine: 'elasticsearch',
        summary: 'Updated document.',
        generatedRequest: 'POST /orders/_update/101?refresh=true',
        requestLanguage: 'query-dsl',
        destructive: false,
        requiredPermissions: ['write concrete index document'],
        warnings: [],
      },
      messages: ['Updated document.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={searchConnection()}
        editContext={{
          connectionId: 'conn-search',
          environmentId: 'env-dev',
          queryText: '{ "index": "orders", "body": { "query": { "match_all": {} } } }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'searchHits',
          total: 1,
          hits: [
            {
              id: '101',
              score: 1.25,
              source: { status: 'processing', total: 42 },
            },
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '101' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Update Document' }))
    fireEvent.change(screen.getByLabelText('Search document source JSON'), {
      target: { value: '{ "status": "fulfilled", "total": 42 }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-search',
        environmentId: 'env-dev',
        editKind: 'update-document',
        target: {
          objectKind: 'document',
          path: [],
          table: 'orders',
          documentId: '101',
        },
        changes: [
          {
            field: 'status',
            value: 'fulfilled',
            valueType: 'string',
          },
          {
            field: 'total',
            value: 42,
            valueType: 'number',
          },
        ],
      })
    })
    expect(screen.getByText(/fulfilled/)).toBeInTheDocument()
  })

  it('indexes new search documents from search hits results', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'elasticsearch.data-edit.index-document',
        engine: 'elasticsearch',
        summary: 'Indexed document.',
        generatedRequest: 'PUT /orders/_doc/102?refresh=true',
        requestLanguage: 'query-dsl',
        destructive: false,
        requiredPermissions: ['write concrete index document'],
        warnings: [],
      },
      messages: ['Indexed document.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={searchConnection()}
        editContext={{
          connectionId: 'conn-search',
          environmentId: 'env-dev',
          queryText: '{ "index": "orders", "body": { "query": { "match_all": {} } } }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'searchHits',
          total: 0,
          hits: [],
        }}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Document' })[0]!)
    fireEvent.change(screen.getByLabelText('Search document id'), {
      target: { value: '102' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Document' }).at(-1)!)
    fireEvent.change(screen.getByLabelText('Search document source JSON'), {
      target: { value: '{ "status": "queued", "total": 99 }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Index' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-search',
        environmentId: 'env-dev',
        editKind: 'index-document',
        target: {
          objectKind: 'document',
          path: [],
          table: 'orders',
          documentId: '102',
        },
        changes: [
          {
            field: 'status',
            value: 'queued',
            valueType: 'string',
          },
          {
            field: 'total',
            value: 99,
            valueType: 'number',
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: '102' })).toBeInTheDocument()
    expect(screen.getByText(/queued/)).toBeInTheDocument()
  })

  it('deletes search hit documents with a confirm/cancel action', async () => {
    const executeDataEdit = vi.fn(async (
      request: DataEditExecutionRequest,
    ): Promise<DataEditExecutionResponse> => ({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      editKind: request.editKind,
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'elasticsearch.data-edit.delete-document',
        engine: 'elasticsearch',
        summary: 'Deleted document.',
        generatedRequest: 'DELETE /orders/_doc/101?refresh=true',
        requestLanguage: 'query-dsl',
        destructive: true,
        confirmationText: 'CONFIRM ELASTICSEARCH DELETE-DOCUMENT',
        requiredPermissions: ['write concrete index document'],
        warnings: [],
      },
      messages: ['Deleted document.'],
      warnings: [],
    }))

    render(
      <ResultPayloadView
        connection={searchConnection()}
        editContext={{
          connectionId: 'conn-search',
          environmentId: 'env-dev',
          queryText: '{ "index": "orders", "body": { "query": { "match_all": {} } } }',
        }}
        onExecuteDataEdit={executeDataEdit}
        payload={{
          renderer: 'searchHits',
          total: 1,
          hits: [
            {
              id: '101',
              score: 1.25,
              source: { status: 'processing' },
            },
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '101' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Document' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith({
        connectionId: 'conn-search',
        environmentId: 'env-dev',
        editKind: 'delete-document',
        confirmationText: 'CONFIRM ELASTICSEARCH DELETE-DOCUMENT',
        target: {
          objectKind: 'document',
          path: [],
          table: 'orders',
          documentId: '101',
        },
        changes: [],
      })
    })
    expect(screen.queryByRole('button', { name: '101' })).not.toBeInTheDocument()
  })
})

describe('JsonTreeView', () => {
  it('caps expanded children so large payloads do not flood the DOM', () => {
    const value = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`key${index}`, index]),
    )

    render(<JsonTreeView value={value} label="large result" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand large result' }))

    const tree = screen.getByRole('tree', { name: 'large result JSON tree' })

    expect(within(tree).getByText('key0')).toBeInTheDocument()
    expect(within(tree).getByText('key249')).toBeInTheDocument()
    expect(within(tree).queryByText('key250')).not.toBeInTheDocument()
    expect(within(tree).getByText('50 more item(s)')).toBeInTheDocument()
  })
})

function mongoConnection(): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'Mongo',
    engine: 'mongodb',
    family: 'document',
    host: '127.0.0.1',
    port: 27017,
    database: 'catalog',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {
      username: 'datapadplusplus',
      secretRef: {
        id: 'secret-mongo',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-mongo',
        label: 'Mongo credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function sqlConnection(): ConnectionProfile {
  return {
    id: 'conn-sql',
    name: 'SQL Server',
    engine: 'sqlserver',
    family: 'sql',
    host: '127.0.0.1',
    port: 1433,
    database: 'datapadplusplus',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'sqlserver',
    auth: {
      username: 'sa',
      secretRef: {
        id: 'secret-sql',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-sql',
        label: 'SQL credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function redisConnection(): ConnectionProfile {
  return {
    id: 'conn-redis',
    name: 'Redis',
    engine: 'redis',
    family: 'keyvalue',
    host: '127.0.0.1',
    port: 6379,
    database: '0',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'redis',
    auth: {
      username: 'default',
      secretRef: {
        id: 'secret-redis',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-redis',
        label: 'Redis credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function dynamoConnection(): ConnectionProfile {
  return {
    id: 'conn-dynamodb',
    name: 'DynamoDB',
    engine: 'dynamodb',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 8001,
    database: 'local',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'dynamodb',
    auth: {
      username: 'local',
      secretRef: {
        id: 'secret-dynamodb',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-dynamodb',
        label: 'DynamoDB credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function cassandraConnection(): ConnectionProfile {
  return {
    id: 'conn-cassandra',
    name: 'Cassandra',
    engine: 'cassandra',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 9042,
    database: 'commerce',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cassandra',
    auth: {
      username: 'cassandra',
      secretRef: {
        id: 'secret-cassandra',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-cassandra',
        label: 'Cassandra credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function searchConnection(): ConnectionProfile {
  return {
    id: 'conn-search',
    name: 'Search',
    engine: 'elasticsearch',
    family: 'search',
    host: '127.0.0.1',
    port: 9200,
    database: '',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'elasticsearch',
    auth: {
      secretRef: {
        id: 'secret-search',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-search',
        label: 'Search credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
