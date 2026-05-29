import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile, StructureResponse } from '@datapadplusplus/shared-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqlRelationshipExplorerWorkspace } from './SqlRelationshipExplorerWorkspace'

afterEach(() => cleanup())

describe('SqlRelationshipExplorerWorkspace', () => {
  it('renders SQL objects as a visual relationship explorer with a virtual catalog', () => {
    renderExplorer()

    expect(screen.getByRole('img', { name: 'SQL table relationship diagram' })).toBeInTheDocument()
    expect(screen.getByText('Catalog')).toBeInTheDocument()
    expect(screen.getAllByText('accounts').length).toBeGreaterThan(0)
    expect(screen.getByText('2 link(s)')).toBeInTheDocument()
  })

  it('opens a scoped query from the selected table inspector', () => {
    const onOpenQuery = vi.fn()
    renderExplorer({ onOpenQuery })

    fireEvent.click(within(screen.getByLabelText('Table catalog')).getByText('accounts'))
    fireEvent.click(screen.getByRole('button', { name: /^Query$/u }))

    expect(onOpenQuery).toHaveBeenCalledTimes(1)
    expect(onOpenQuery.mock.calls[0]?.[1]).toContain('from "public"."accounts"')
  })

  it('hides the relationship details panel until selected and lets users collapse it', () => {
    renderExplorer()

    expect(screen.queryByRole('complementary', { name: 'Relationship details' })).not.toBeInTheDocument()
    expect(screen.queryByText('Select a table or view.')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByLabelText('Table catalog')).getByText('accounts'))
    expect(screen.getByRole('complementary', { name: 'Relationship details' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse relationship details panel' }))
    expect(screen.queryByRole('complementary', { name: 'Relationship details' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show relationship details' }))
    expect(screen.getByRole('complementary', { name: 'Relationship details' })).toBeInTheDocument()
  })

  it('toggles inferred relationships without forcing a metadata refresh', () => {
    const onRefresh = vi.fn()
    renderExplorer({ onRefresh })

    fireEvent.click(screen.getByTitle('Show inferred relationships'))

    expect(screen.getByText('3 link(s)')).toBeInTheDocument()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('keeps all graph nodes visible and toggles selection off on repeated select', () => {
    renderExplorer()

    fireEvent.click(screen.getByRole('button', { name: 'Select public.accounts' }))

    expect(screen.getByRole('button', { name: 'Select public.transactions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select public.users' })).toHaveClass('is-dimmed')

    fireEvent.click(screen.getByRole('button', { name: 'Select public.accounts' }))

    expect(screen.getByRole('button', { name: 'Select public.users' })).not.toHaveClass('is-dimmed')
  })

  it('places dependent tables in a separate graph column from referenced tables', () => {
    renderExplorer()

    const accountPosition = graphX(screen.getByRole('button', { name: 'Select public.accounts' }))
    const transactionPosition = graphX(screen.getByRole('button', { name: 'Select public.transactions' }))

    expect(transactionPosition).toBeGreaterThan(accountPosition)
  })

  it('renders relationship ends with cardinality notation', () => {
    renderExplorer()

    const labels = [...document.querySelectorAll('.sql-rel-cardinality-badge text')].map((label) => label.textContent)

    expect(labels).toContain('N')
    expect(labels).toContain('1')
  })

  it('keeps the graph overview hidden until requested', () => {
    renderExplorer()

    expect(document.querySelector('.sql-rel-minimap')).toBeNull()

    fireEvent.click(screen.getByTitle('Show overview'))

    expect(document.querySelector('.sql-rel-minimap')).toBeTruthy()
    expect(screen.getByTitle('Hide overview')).toHaveClass('is-active')
  })

  it('uses inferred relationships automatically when no declared links are available', () => {
    renderExplorer({ structure: { ...structure(), edges: [] } })

    expect(screen.getByText('3 link(s)')).toBeInTheDocument()
    expect(screen.getByTitle('Hide inferred relationships')).toBeInTheDocument()
  })

  it('expands table cards to show additional columns without leaving the graph', () => {
    renderExplorer({ structure: wideAccountsStructure() })

    expect(screen.queryByText('updated_at')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all columns for public.accounts' }))

    expect(screen.getByText('updated_at')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer columns for public.accounts' })).toBeInTheDocument()
    expect(document.querySelector('.sql-rel-node-row-line')).toBeTruthy()
    expect(document.querySelector('.sql-rel-node-column-divider')).toBeTruthy()
  })

  it('refreshes with bounded SQL graph options', () => {
    const onRefresh = vi.fn()
    renderExplorer({ onRefresh })

    fireEvent.click(screen.getByTitle('Refresh relationship metadata'))

    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'relationships',
        maxNodes: 320,
        maxEdges: 1000,
      }),
    )
  })

  it('filters the catalog by schema', () => {
    renderExplorer()

    fireEvent.change(screen.getByTitle('Schema'), { target: { value: 'audit' } })

    const catalog = screen.getByLabelText('Table catalog')
    expect(within(catalog).getByText('audit_log')).toBeInTheDocument()
    expect(within(catalog).queryByText('accounts')).not.toBeInTheDocument()
  })
})

function renderExplorer(overrides: Partial<Parameters<typeof SqlRelationshipExplorerWorkspace>[0]> = {}) {
  return render(
    <SqlRelationshipExplorerWorkspace
      activeConnection={connection()}
      activeEnvironment={environment()}
      status="ready"
      structure={structure()}
      onRefresh={vi.fn()}
      onInspectNode={vi.fn()}
      onOpenQuery={vi.fn()}
      onOpenObjectView={vi.fn()}
      {...overrides}
    />,
  )
}

function graphX(element: HTMLElement) {
  const transform = element.getAttribute('transform') ?? ''
  const match = /translate\(([-\d.]+)/u.exec(transform)
  return Number(match?.[1] ?? 0)
}

function connection(): ConnectionProfile {
  return {
    id: 'connection-1',
    name: 'Postgres QA',
    engine: 'postgresql',
    family: 'sql',
    connectionMode: 'native',
    host: 'localhost',
    port: 5432,
    database: 'datapadplusplus',
    tags: [],
    favorite: false,
    icon: 'postgresql',
    auth: { username: 'user' },
    environmentIds: ['env-1'],
    readOnly: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function environment(): EnvironmentProfile {
  return {
    id: 'env-1',
    label: 'QA',
    risk: 'low',
    color: '#38d996',
    variables: {},
    variableDefinitions: [],
    sensitiveKeys: [],
    requiresConfirmation: false,
    safeMode: false,
    exportable: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function structure(): StructureResponse {
  return {
    connectionId: 'connection-1',
    environmentId: 'env-1',
    engine: 'postgresql',
    summary: 'Loaded tables.',
    groups: [
      { id: 'public', label: 'public', kind: 'schema' },
      { id: 'audit', label: 'audit', kind: 'schema' },
    ],
    nodes: [
      {
        id: 'public.accounts',
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'accounts',
        qualifiedName: 'public.accounts',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'name', dataType: 'text' },
        ],
      },
      {
        id: 'public.transactions',
        family: 'sql',
        label: 'transactions',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'transactions',
        qualifiedName: 'public.transactions',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'account_id', dataType: 'uuid' },
          { name: 'user_id', dataType: 'uuid' },
        ],
      },
      {
        id: 'public.users',
        family: 'sql',
        label: 'users',
        kind: 'table',
        groupId: 'public',
        schema: 'public',
        objectName: 'users',
        qualifiedName: 'public.users',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'email', dataType: 'text' },
        ],
      },
      {
        id: 'audit.audit_log',
        family: 'sql',
        label: 'audit_log',
        kind: 'table',
        groupId: 'audit',
        schema: 'audit',
        objectName: 'audit_log',
        qualifiedName: 'audit.audit_log',
        fields: [
          { name: 'id', dataType: 'uuid', primary: true },
          { name: 'transaction_id', dataType: 'uuid' },
        ],
      },
    ],
    edges: [
      {
        id: 'fk-transactions-accounts',
        from: 'public.transactions',
        to: 'public.accounts',
        label: 'account_id -> id',
        kind: 'foreign-key',
        fromField: 'account_id',
        toField: 'id',
      },
      {
        id: 'fk-audit-transactions',
        from: 'audit.audit_log',
        to: 'public.transactions',
        label: 'transaction_id -> id',
        kind: 'foreign-key',
        fromField: 'transaction_id',
        toField: 'id',
      },
    ],
    metrics: [],
  }
}

function wideAccountsStructure(): StructureResponse {
  const base = structure()
  return {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === 'public.accounts'
        ? {
            ...node,
            fields: [
              { name: 'id', dataType: 'uuid', primary: true },
              { name: 'name', dataType: 'text' },
              { name: 'status', dataType: 'text' },
              { name: 'tier', dataType: 'text' },
              { name: 'updated_at', dataType: 'timestamp' },
              { name: 'created_at', dataType: 'timestamp' },
            ],
          }
        : node,
    ),
  }
}
