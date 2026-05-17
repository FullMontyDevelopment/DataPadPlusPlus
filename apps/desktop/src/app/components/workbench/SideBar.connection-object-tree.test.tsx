import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionTreeNode } from './SideBar.helpers'
import { ConnectionObjectTree } from './SideBar.connection-object-tree'

describe('ConnectionObjectTree', () => {
  it('marks queryable leaf objects as clickable and opens a scoped query on click', () => {
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('catalog')
    expandTreeItem('Collections')

    const productsRow = treeItemForLabel('products')

    expect(productsRow).toHaveClass('is-queryable')
    expect(within(productsRow).getByText('Query')).toBeInTheDocument()

    fireEvent.click(productsRow)

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        kind: 'collection',
        label: 'products',
        preferredBuilder: 'mongo-find',
        scope: 'collection:products',
      }),
    )
  })

  it('opens appropriate queryable object actions from the context menu', () => {
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('catalog')
    expandTreeItem('Collections')

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for products' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Query' }))

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({ label: 'products' }),
    )
  })

  it('opens Redis prefixes through the visible Query button', () => {
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={redisConnection()}
        explorerNodes={[
          {
            id: 'prefix-perf',
            label: 'perf:*',
            kind: 'prefix',
            detail: '51 sampled key(s)',
            family: 'keyvalue',
            path: ['Fixture Redis'],
            scope: 'prefix:perf:',
            queryTemplate: 'SCAN 0 MATCH perf:* COUNT 50',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={vi.fn()}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Key Prefixes')
    const prefixRow = treeItemForLabel('perf:*')
    const queryButton = within(prefixRow).getByRole('button', { name: 'Query' })

    fireEvent.click(queryButton)

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-redis',
      expect.objectContaining({
        label: 'perf:*',
        preferredBuilder: 'redis-key-browser',
        scope: 'prefix:perf:',
        queryTemplate: expect.stringContaining('"pattern": "perf:*"'),
      }),
    )
  })

  it('does not render an expander for remote nodes that cannot be loaded', () => {
    render(
      <ConnectionObjectTree
        connection={redisConnection()}
        explorerNodes={[
          {
            id: 'prefix-perf',
            label: 'perf:*',
            kind: 'prefix',
            detail: 'metadata only',
            family: 'keyvalue',
            path: ['Fixture Redis'],
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Key Prefixes')
    const prefixRow = treeItemForLabel('perf:*')

    expect(prefixRow).not.toHaveAttribute('aria-expanded')
    expect(
      within(prefixRow).queryByRole('button', { name: /Expand perf:\*/ }),
    ).not.toBeInTheDocument()
  })

  it('shows datastore-specific management actions and scoped refresh options', () => {
    const onOpenScopedQuery = vi.fn()
    const onLoadExplorerScope = vi.fn()

    render(
      <ConnectionObjectTree
        connection={postgresConnection()}
        explorerNodes={[
          {
            id: 'schema-public',
            label: 'public',
            kind: 'schema',
            family: 'sql',
            path: ['Fixture Postgres'],
            scope: 'schema:public',
            detail: 'schema',
            expandable: true,
          },
          {
            id: 'public.accounts',
            label: 'accounts',
            kind: 'BASE TABLE',
            family: 'sql',
            path: ['Fixture Postgres', 'public'],
            scope: 'table:public.accounts',
            detail: 'table',
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={onLoadExplorerScope}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Schemas')
    expandTreeItem('public')
    expandTreeItem('Tables')

    fireEvent.contextMenu(treeItemForLabel('accounts'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for accounts' })
    expect(within(menu).getByRole('menuitem', { name: 'View Columns' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Create Index...' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Drop Table...' })).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Refresh table' }))
    expect(onLoadExplorerScope).toHaveBeenCalledWith('conn-postgres', 'table:public.accounts')
  })

  it('does not show query actions for non-queryable object groups', () => {
    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('catalog')

    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Indexes' })

    expect(within(menu).queryByRole('menuitem', { name: 'Open Query' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Expand' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Copy Name' })).toBeInTheDocument()
  })

  it('uses datastore/object icons and environment tint for object rows', () => {
    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        environment={localEnvironment()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    const databasesRow = treeItemForLabel('Databases')

    expect(databasesRow).toHaveClass('has-environment-accent')
    expect(databasesRow.getAttribute('style')).toContain('--connection-env-color')
    expect(databasesRow.querySelector('.tree-node-datastore-icon')).not.toBeNull()

    expandTreeItem('Databases')
    expandTreeItem('catalog')
    expandTreeItem('Collections')

    const productsRow = treeItemForLabel('products')

    expect(productsRow).toHaveClass('has-environment-accent')
    expect(productsRow.querySelector('.tree-icon')).not.toBeNull()
  })

  it('loads large child collections in batches of 100', () => {
    const nodes: ConnectionTreeNode[] = [
      {
        id: 'keys',
        label: 'Keys',
        kind: 'keys',
        detail: 'large keyspace',
        children: Array.from({ length: 105 }, (_item, index) => ({
          id: `key-${index + 1}`,
          label: `key-${index + 1}`,
          kind: 'string',
          detail: 'fixture key',
        })),
      },
    ]

    render(
      <ConnectionObjectTree
        connection={redisConnection()}
        nodes={nodes}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Keys')

    expect(screen.getByText('key-100')).toBeInTheDocument()
    expect(screen.queryByText('key-101')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more Keys items' }))

    expect(screen.getByText('key-101')).toBeInTheDocument()
    expect(screen.getByText('key-105')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more Keys items' })).not.toBeInTheDocument()
  })

  it('uses live explorer nodes instead of sample datastore children', () => {
    const onLoadExplorerScope = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={[
          {
            id: 'customers',
            label: 'customers',
            kind: 'collection',
            detail: 'Documents, indexes, and samples',
            family: 'document',
            path: ['Fixture MongoDB'],
            scope: 'collection:customers',
            queryTemplate: '{ "collection": "customers", "filter": {} }',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={onLoadExplorerScope}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('catalog')
    expandTreeItem('Collections')

    expect(screen.getByText('customers')).toBeInTheDocument()
    expect(screen.queryByText('products')).not.toBeInTheDocument()

    expandTreeItem('customers')

    expect(onLoadExplorerScope).toHaveBeenCalledWith('conn-mongo', 'collection:customers')
  })
})

function expandTreeItem(label: string) {
  fireEvent.click(treeItemForLabel(label))
}

function postgresConnection(): ConnectionProfile {
  return {
    id: 'conn-postgres',
    name: 'Fixture Postgres',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'datapadplusplus',
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

function treeItemForLabel(label: string) {
  const row = screen.getByText(label).closest('[role="treeitem"]')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Tree item ${label} was not found.`)
  }

  return row
}

function mongoConnection(): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'Fixture MongoDB',
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
}

function redisConnection(): ConnectionProfile {
  return {
    id: 'conn-redis',
    name: 'Fixture Redis',
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
