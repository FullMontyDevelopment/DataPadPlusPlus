import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RelationalObjectViewWorkspace } from '../../../../../../../src/app/components/workbench/datastores/common/sql/RelationalObjectViewWorkspace'

describe('RelationalObjectViewWorkspace', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('renders only available SQL object workflows and jumps to the selected section', () => {
    const onOpenQuery = vi.fn<(target: ScopedQueryTarget) => void>()
    render(
      <RelationalObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tableTab}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getByRole('button', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'SQL object summary' })).toHaveTextContent('SQL Server')
    expect(screen.getByRole('region', { name: 'SQL object summary' })).toHaveTextContent('datapadplusplus')
    expect(screen.getByLabelText('Object relationships')).toHaveTextContent('FK_Accounts_Parent')
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Indexes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Triggers' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grants' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Indexes' }))
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'table',
      label: 'Accounts',
      queryTemplate: 'select * from [dbo].[Accounts]',
    }))
  })

  it('plans SQL-family object actions through guarded operation previews', async () => {
    const onPlanOperation = vi.fn(async (request): Promise<OperationPlanResponse> => operationPlanResponse(request.operationId))

    render(
      <RelationalObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tableTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))

    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: connection.id,
      environmentId: environment.id,
      operationId: 'sqlserver.query.explain',
      objectName: '[dbo].[Accounts]',
      parameters: expect.objectContaining({
        schema: 'dbo',
        table: 'Accounts',
        columnName: 'id',
      }),
    })))
    expect(screen.getByText('Prepared')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create Index' }))

    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'sqlserver.index.create',
      objectName: '[dbo].[Accounts]',
      parameters: expect.objectContaining({
        indexName: 'idx_dbo_accounts_id',
      }),
    })))
  })
})

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  risk: 'low',
  color: '#22c55e',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const connection: ConnectionProfile = {
  id: 'conn-sqlserver',
  name: 'SQL Server',
  engine: 'sqlserver',
  family: 'sql',
  host: 'localhost',
  environmentIds: [],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlserver',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const tableTab: QueryTabState = {
  id: 'tab-table',
  title: 'Accounts',
  tabKind: 'object-view',
  connectionId: connection.id,
  environmentId: environment.id,
  family: 'sql',
  language: 'sql',
  editorLabel: 'SQL Server / Local',
  queryText: '',
  result: undefined,
  history: [],
  status: 'idle',
  dirty: false,
  objectViewState: {
    connectionId: connection.id,
    environmentId: environment.id,
    nodeId: 'sqlserver-table:dbo:Accounts',
    kind: 'table',
    label: 'Accounts',
    path: ['datapadplusplus', 'dbo', 'Tables', 'Accounts'],
    queryTemplate: 'select * from [dbo].[Accounts]',
    warnings: [],
      payload: {
      database: 'datapadplusplus',
      schema: 'dbo',
      tableName: 'Accounts',
      columns: [
        { name: 'id', type: 'int', nullable: false },
        { name: 'name', type: 'nvarchar(200)', nullable: false },
      ],
      indexes: [
        { name: 'PK_Accounts', type: 'clustered', columns: 'id', unique: true },
      ],
      foreignKeys: [
        { name: 'FK_Accounts_Parent', from: 'Accounts.parent_id', to: 'Accounts.id' },
      ],
    },
  },
}

function operationPlanResponse(operationId: string): OperationPlanResponse {
  return {
    connectionId: connection.id,
    environmentId: environment.id,
    plan: {
      operationId,
      engine: connection.engine,
      summary: `Prepared ${operationId}`,
      generatedRequest: 'select 1;',
      requestLanguage: 'sql',
      destructive: false,
      estimatedCost: 'No material cost expected.',
      estimatedScanImpact: 'Object-scoped.',
      requiredPermissions: ['read metadata/query privilege'],
      warnings: [],
    },
  }
}
