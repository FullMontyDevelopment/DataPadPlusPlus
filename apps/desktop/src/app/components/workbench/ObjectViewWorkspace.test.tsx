import { fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ConnectionProfile,
  DataEditExecutionResponse,
  EnvironmentProfile,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ObjectViewWorkspace } from './ObjectViewWorkspace'

describe('ObjectViewWorkspace', () => {
  it('renders a Mongo schema preview as a purpose-built field table', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Schema Preview',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'schema-preview:catalog:products',
            label: 'Schema Preview',
            kind: 'schema-preview',
            path: ['catalog', 'Collections', 'products'],
            summary: 'Schema preview ready.',
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              fields: [
                { path: '_id', type: 'objectId', count: 20 },
                { path: 'inventory.available', type: 'int32', count: 18 },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Schema Preview').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Understand document shape/i).length).toBeGreaterThan(0)
    expect(screen.getByText('inventory.available')).toBeInTheDocument()
    expect(screen.getByText('int32')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders Mongo index metadata and exposes guarded operation guidance', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.index.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Indexes',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'indexes:catalog:products',
            label: 'Indexes',
            kind: 'indexes',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              indexes: [
                { name: '_id_', key: { _id: 1 }, unique: true },
                { name: 'sku_1', key: { sku: 1 }, sparse: false },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('Index Manager').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Review collection access paths/i).length).toBeGreaterThan(0)
    expect(screen.getByText('_id_')).toBeInTheDocument()
    expect(screen.getByText('sku_1')).toBeInTheDocument()
    expect(screen.getByText('{"sku":1}')).toBeInTheDocument()
    expect(screen.getByText(/preview-only/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Create Index' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.create',
      objectName: 'products',
      parameters: expect.objectContaining({
        collection: 'products',
        indexName: 'field_1',
      }),
    }))

    const dropButtons = screen.getAllByRole('button', { name: 'Preview Drop' })
    expect(dropButtons).toHaveLength(2)
    fireEvent.click(dropButtons[1] as HTMLElement)
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.drop',
      parameters: expect.objectContaining({
        indexName: 'sku_1',
      }),
    }))
  })

  it('opens query templates from object views without making the object view saveable', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'view-pipeline:catalog:active_products',
            label: 'Pipeline',
            kind: 'pipeline',
            path: ['catalog', 'Views', 'active_products'],
            queryTemplate: '{ "database": "catalog", "collection": "active_products", "filter": {} }',
            warnings: [],
            payload: {
              database: 'catalog',
              view: 'active_products',
              pipeline: [{ $match: { active: true } }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Sample Results' })[0] as HTMLElement)

    expect(onOpenQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pipeline',
        label: 'Pipeline',
        preferredBuilder: 'mongo-aggregation',
      }),
    )
  })

  it('shows permission warnings for users and roles without failing the whole view', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Users',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'users:catalog',
            label: 'Users',
            kind: 'users',
            path: ['catalog'],
            warnings: ['not authorized on catalog to execute command usersInfo'],
            payload: {
              database: 'catalog',
              warning: 'usersInfo requires additional privileges',
              users: [],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    const warningList = screen.getByText('not authorized on catalog to execute command usersInfo')
      .closest('.object-view-warning-list')

    expect(screen.getAllByText(/Review database users/i).length).toBeGreaterThan(0)
    expect(warningList).not.toBeNull()
    expect(within(warningList as HTMLElement).getByText('usersInfo requires additional privileges')).toBeInTheDocument()
    expect(screen.getByText('No users were returned')).toBeInTheDocument()
    expect(screen.getByText(/usersInfo privileges/i)).toBeInTheDocument()
  })

  it('previews Mongo user management operations from the users view', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.user.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Users',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'users:catalog',
            label: 'Users',
            kind: 'users',
            path: ['catalog'],
            warnings: [],
            payload: {
              database: 'catalog',
              users: [{ user: 'reporting', roles: [{ role: 'read', db: 'catalog' }] }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('reporting_user'), { target: { value: 'analytics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Create User' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.create',
      objectName: 'analytics',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Preview Drop User' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.drop',
      objectName: 'reporting',
    }))
  })

  it('validates and uploads Mongo documents through guarded data edits', () => {
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: mongoConnection.id,
      environmentId: environment.id,
      editKind: 'insert-document',
      executionSupport: 'live',
      executed: true,
      plan: operationPlanResponse('mongodb.data-edit.insert-document').plan,
      messages: ['MongoDB inserted 1 document.'],
      warnings: [],
      metadata: { insertedId: 'new-product' },
    }))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'collection:catalog:products',
            label: 'products',
            kind: 'collection',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku', 'name'] } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
      />,
    )

    fireEvent.change(screen.getByLabelText('Document JSON'), { target: { value: '{ "sku": "only-sku" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByText('Missing required field(s): name')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Document JSON'), { target: { value: '{ "sku": "nova", "name": "Nova Chair" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Document' }))
    expect(onExecuteDataEdit).toHaveBeenCalledWith(expect.objectContaining({
      editKind: 'insert-document',
      target: expect.objectContaining({
        collection: 'products',
      }),
      changes: [expect.objectContaining({
        value: { sku: 'nova', name: 'Nova Chair' },
      })],
    }))
  })

  it('renders a Redis database overview with type distribution and key-browser handoff', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'DB 0',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:db:0',
            label: 'DB 0',
            kind: 'database',
            path: ['Databases'],
            summary: 'Inspection ready for redis:db:0.',
            warnings: [],
            payload: {
              database: 0,
              keyCount: 40010,
              scannedKeys: 100,
              typeCounts: [
                { type: 'hash', count: 99, examples: ['perf:session:000143'] },
                { type: 'zset', count: 1, examples: ['products:inventory'] },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Redis DB Overview').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Inspect the selected logical database/i).length).toBeGreaterThan(0)
    expect(screen.getByText('40010')).toBeInTheDocument()
    expect(screen.getByText('hash')).toBeInTheDocument()
    expect(screen.getByText('["products:inventory"]')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Browse DB Keys' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"databaseIndex": 0'),
    }))
  })

  it('renders Redis diagnostics as metrics instead of a generic payload dump', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'INFO',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:diagnostics:info',
            label: 'INFO',
            kind: 'diagnostics',
            path: ['Diagnostics'],
            warnings: [],
            payload: {
              command: 'INFO',
              text: '# Clients\nconnected_clients:1\n# Memory\nused_memory:7399232',
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Redis Diagnostics').length).toBeGreaterThan(0)
    expect(screen.getByText('Connected Clients')).toBeInTheDocument()
    expect(screen.queryByText('used_memory')).not.toBeInTheDocument()
    expect(screen.getByText('Used Memory')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders Oracle table metadata as a native object workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={oracleConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: oracleConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'ACCOUNTS',
          objectViewState: {
            connectionId: oracleConnection.id,
            environmentId: environment.id,
            nodeId: 'oracle-table:APP:ACCOUNTS',
            label: 'ACCOUNTS',
            kind: 'table',
            path: ['FREEPDB1', 'APP', 'Tables'],
            queryTemplate: 'select * from "APP"."ACCOUNTS" where rownum <= 100',
            warnings: [],
            payload: {
              engine: 'oracle',
              schema: 'APP',
              objectName: 'ACCOUNTS',
              service: 'FREEPDB1',
              rowCount: 128,
              columns: [
                { name: 'ID', type: 'NUMBER(19)', nullable: 'NO' },
                { name: 'STATUS', type: 'VARCHAR2(40)', nullable: 'YES' },
              ],
              indexes: [
                { name: 'ACCOUNTS_PK', uniqueness: 'UNIQUE', status: 'VALID', visibility: 'VISIBLE' },
              ],
              constraints: [
                { name: 'ACCOUNTS_PK', type: 'PRIMARY KEY', status: 'ENABLED', columns: 'ID' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Oracle Table').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Inspect table data entry points/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ID').length).toBeGreaterThan(0)
    expect(screen.getByText('NUMBER(19)')).toBeInTheDocument()
    expect(screen.getAllByText('ACCOUNTS_PK').length).toBeGreaterThan(0)
    expect(screen.queryByText('metadataViews')).not.toBeInTheDocument()
    expect(screen.queryByText('permissionSensitiveViews')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Data Query' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'sql-select',
      queryTemplate: expect.stringContaining('ACCOUNTS'),
    }))
  })

  it('renders Oracle performance warnings and plan rows without raw payload dumps', () => {
    render(
      <ObjectViewWorkspace
        connection={oracleConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: oracleConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'Execution Plan',
          objectViewState: {
            connectionId: oracleConnection.id,
            environmentId: environment.id,
            nodeId: 'oracle-explain-plan',
            label: 'Execution Plan',
            kind: 'execution-plan',
            path: ['Diagnostics'],
            warnings: ['DBMS_XPLAN output is available only after EXPLAIN PLAN has run.'],
            payload: {
              engine: 'oracle',
              service: 'FREEPDB1',
              elapsedMs: 12,
              planLines: [
                { id: 0, operation: 'SELECT STATEMENT', rows: 100, cost: 4 },
                { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'ACCOUNTS', rows: 100, cost: 4 },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Execution Plan').length).toBeGreaterThan(0)
    expect(screen.getByText('TABLE ACCESS FULL')).toBeInTheDocument()
    expect(screen.getByText('ACCOUNTS')).toBeInTheDocument()
    expect(screen.getByText('DBMS_XPLAN output is available only after EXPLAIN PLAN has run.')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })
})

function operationPlanResponse(operationId: string): OperationPlanResponse {
  return {
    connectionId: mongoConnection.id,
    environmentId: environment.id,
    plan: {
      operationId,
      engine: 'mongodb',
      summary: `Prepared ${operationId}.`,
      generatedRequest: '{ "ok": 1 }',
      requestLanguage: 'json',
      destructive: operationId.includes('.drop'),
      estimatedCost: 'Preview only.',
      estimatedScanImpact: 'Object scoped.',
      requiredPermissions: ['write/admin privilege for the target object'],
      warnings: ['Preview mode.'],
    },
  }
}

const mongoConnection: ConnectionProfile = {
  id: 'conn-mongo',
  name: 'MongoDB',
  engine: 'mongodb',
  family: 'document',
  host: 'localhost',
  port: 27017,
  database: 'catalog',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mongodb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const redisConnection: ConnectionProfile = {
  id: 'conn-redis',
  name: 'Redis',
  engine: 'redis',
  family: 'keyvalue',
  host: 'localhost',
  port: 6379,
  database: '0',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'redis',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const oracleConnection: ConnectionProfile = {
  id: 'conn-oracle',
  name: 'Oracle',
  engine: 'oracle',
  family: 'sql',
  host: 'localhost',
  port: 1521,
  database: 'FREEPDB1',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'oracle',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'APP' },
  oracleOptions: {
    connectMode: 'service-name',
    serviceName: 'FREEPDB1',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const baseObjectViewTab: QueryTabState = {
  id: 'tab-object-view',
  title: 'Object View',
  tabKind: 'object-view',
  connectionId: mongoConnection.id,
  environmentId: environment.id,
  family: 'document',
  language: 'json',
  editorLabel: 'Object view',
  queryText: '',
  status: 'success',
  dirty: false,
  history: [],
}
