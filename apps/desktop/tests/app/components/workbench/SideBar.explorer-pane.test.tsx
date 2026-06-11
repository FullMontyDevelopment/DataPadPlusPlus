import { fireEvent, render, screen } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ExplorerPane } from '../../../../src/app/components/workbench/SideBar.explorer-pane'

describe('ExplorerPane', () => {
  it('renders explorer rows with datastore/object icons and environment tint', () => {
    render(
      <ExplorerPane
        activeConnection={postgresConnection()}
        activeEnvironment={localEnvironment()}
        explorerFilter=""
        explorerItems={explorerNodes()}
        explorerStatus="ready"
        explorerSummary="Loaded 2 nodes."
        onExplorerFilterChange={vi.fn()}
        onInspectExplorerNode={vi.fn()}
        onOpenScopedQuery={vi.fn()}
        onRefreshExplorer={vi.fn()}
        onSelectExplorerNode={vi.fn()}
      />,
    )

    const schemaRow = treeItemForLabel('public')
    const tableRow = treeItemForLabel('accounts')

    expect(schemaRow).toHaveClass('has-environment-accent')
    expect(schemaRow.getAttribute('style')).toContain('--connection-env-color')
    expect(schemaRow.querySelector('.tree-kind-icon')).not.toBeNull()
    expect(tableRow.querySelector('.tree-icon')).not.toBeNull()
  })

  it('still selects nodes from the tinted explorer row', () => {
    const onSelectExplorerNode = vi.fn()

    render(
      <ExplorerPane
        activeConnection={postgresConnection()}
        activeEnvironment={localEnvironment()}
        explorerFilter=""
        explorerItems={explorerNodes()}
        explorerStatus="ready"
        explorerSummary="Loaded 2 nodes."
        onExplorerFilterChange={vi.fn()}
        onInspectExplorerNode={vi.fn()}
        onOpenScopedQuery={vi.fn()}
        onRefreshExplorer={vi.fn()}
        onSelectExplorerNode={onSelectExplorerNode}
      />,
    )

    fireEvent.click(treeItemForLabel('accounts'))

    expect(onSelectExplorerNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'table-public-accounts' }),
    )
  })

  it('inspects nodes from the context menu instead of normal click', () => {
    const onInspectExplorerNode = vi.fn()
    const onSelectExplorerNode = vi.fn()

    render(
      <ExplorerPane
        activeConnection={postgresConnection()}
        activeEnvironment={localEnvironment()}
        explorerFilter=""
        explorerItems={explorerNodes()}
        explorerStatus="ready"
        explorerSummary="Loaded 2 nodes."
        onExplorerFilterChange={vi.fn()}
        onInspectExplorerNode={onInspectExplorerNode}
        onOpenScopedQuery={vi.fn()}
        onRefreshExplorer={vi.fn()}
        onSelectExplorerNode={onSelectExplorerNode}
      />,
    )

    fireEvent.click(treeItemForLabel('accounts'))

    expect(onSelectExplorerNode).toHaveBeenCalled()
    expect(onInspectExplorerNode).not.toHaveBeenCalled()

    fireEvent.contextMenu(treeItemForLabel('accounts'), { clientX: 12, clientY: 24 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect accounts' }))

    expect(onInspectExplorerNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'table-public-accounts' }),
    )
  })
})

function treeItemForLabel(label: string) {
  const row = screen.getByText(label).closest('button')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Explorer row ${label} was not found.`)
  }

  return row
}

function explorerNodes(): ExplorerNode[] {
  return [
    {
      id: 'schema-public',
      label: 'public',
      kind: 'schema',
      family: 'sql',
      path: ['PostgreSQL connection'],
      detail: 'schema',
      expandable: true,
    },
    {
      id: 'table-public-accounts',
      label: 'accounts',
      kind: 'table',
      family: 'sql',
      path: ['PostgreSQL connection', 'public'],
      detail: 'table',
      queryTemplate: 'select * from public.accounts limit 100;',
    },
  ]
}

function postgresConnection(): ConnectionProfile {
  return {
    id: 'conn-postgres',
    name: 'PostgreSQL connection',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'catalog',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'postgresql',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function localEnvironment(): EnvironmentProfile {
  return {
    id: 'env-local',
    label: 'Local',
    color: '#22c55e',
    risk: 'low',
    variables: {},
    sensitiveKeys: [],
    inheritsFrom: undefined,
    requiresConfirmation: false,
    safeMode: false,
    exportable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
