import { fireEvent, render, screen, within } from '@testing-library/react'
import type { AdapterManifest, ConnectionProfile, EnvironmentProfile } from '@datapadplusplus/shared-types'
import { datastoreTreeForEngine } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionTreeNode } from './SideBar.helpers'
import { ConnectionObjectTree } from './SideBar.connection-object-tree'

describe('ConnectionObjectTree', () => {
  it('renders adapter-manifest structural folders while live metadata is unavailable', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(mongoConnection())}
        connection={mongoConnection()}
        explorerStatus="loading"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('catalog')).toBeInTheDocument()

    expandTreeItem('catalog')

    expect(screen.getByText('Collections')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('GridFS')).toBeInTheDocument()
    expect(screen.queryByText('Time Series Collections')).not.toBeInTheDocument()
    expect(screen.queryByText('Capped Collections')).not.toBeInTheDocument()
    expect(screen.queryByText('Search Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('Vector Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('products')).not.toBeInTheDocument()
  })

  it('shows an empty live metadata state without falling back to structural folders', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(mongoConnection())}
        connection={mongoConnection()}
        explorerNodes={[]}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('No live metadata objects found.')).toBeInTheDocument()
    expect(screen.queryByText('catalog')).not.toBeInTheDocument()
  })

  it('uses adapter-manifest Object Explorer folders for SQL Server', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(sqlServerConnection())}
        connection={sqlServerConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('datapadplusplus')

    expect(screen.getByText('Database Diagrams')).toBeInTheDocument()
    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('Stored Procedures')).toBeInTheDocument()
    expect(screen.getByText('Functions')).toBeInTheDocument()
    expect(screen.getByText('Query Store')).toBeInTheDocument()
    expect(screen.getAllByText('Extended Events').length).toBeGreaterThan(0)
    expect(screen.getByText('CDC')).toBeInTheDocument()
    expect(screen.getByText('Change Tracking')).toBeInTheDocument()
    expect(screen.getByText('Service Broker')).toBeInTheDocument()
    expect(screen.getByText('SQL Server Agent')).toBeInTheDocument()
  })

  it('does not nest live SQL Server category folders inside duplicate category folders', () => {
    render(
      <ConnectionObjectTree
        connection={sqlServerConnection()}
        explorerNodes={[
          {
            id: 'database:datapadplusplus',
            label: 'datapadplusplus',
            kind: 'database',
            detail: 'online',
            family: 'sql',
            path: ['Fixture SQL Server', 'Databases'],
            scope: 'database:datapadplusplus',
            expandable: true,
          },
          {
            id: 'sqlserver:datapadplusplus:tables',
            label: 'Tables',
            kind: 'tables',
            detail: 'Base, system, external, and graph tables',
            family: 'sql',
            path: ['Fixture SQL Server', 'Databases', 'datapadplusplus'],
            scope: 'sqlserver:datapadplusplus:tables',
            expandable: true,
          },
          {
            id: 'table:datapadplusplus:dbo:accounts',
            label: 'dbo.accounts',
            kind: 'table',
            detail: 'base table',
            family: 'sql',
            path: ['Fixture SQL Server', 'Databases', 'datapadplusplus', 'tables'],
            scope: 'table:datapadplusplus:dbo:accounts',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={vi.fn()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('datapadplusplus')
    expandTreeItem('Tables')

    expect(screen.getAllByText('Tables')).toHaveLength(1)
    expect(screen.getByText('dbo.accounts')).toBeInTheDocument()
  })

  it('uses SQLite-owned file database folders', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(sqliteConnection())}
        connection={sqliteConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Main Database')

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('Indexes')).toBeInTheDocument()
    expect(screen.getByText('Triggers')).toBeInTheDocument()
    expect(screen.queryByText('Virtual Tables')).not.toBeInTheDocument()
    expect(screen.queryByText('FTS Tables')).not.toBeInTheDocument()
    expect(screen.queryByText('RTree Tables')).not.toBeInTheDocument()
    expect(screen.queryByText('Generated Columns')).not.toBeInTheDocument()
    expect(screen.getByText('Pragmas')).toBeInTheDocument()
    expect(screen.queryByText('accounts')).not.toBeInTheDocument()
  })

  it('uses Oracle-owned enterprise object folders and PL/SQL actions', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(oracleConnection())}
        connection={oracleConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('FREEPDB1')

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('Packages')).toBeInTheDocument()
    expect(screen.getByText('Procedures')).toBeInTheDocument()
    expect(screen.queryByText('Database Links')).not.toBeInTheDocument()
    expect(screen.queryByText('Data Guard')).not.toBeInTheDocument()
    expect(screen.queryByText('RAC')).not.toBeInTheDocument()

    fireEvent.contextMenu(treeItemForLabel('Packages'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Packages' })
    expect(within(menu).getByRole('menuitem', { name: 'Create Package...' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Refresh Packages' })).not.toBeInTheDocument()
  })

  it('uses Oracle-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={oracleConnection()}
        explorerNodes={[
          {
            id: 'oracle-performance',
            label: 'Performance',
            kind: 'performance',
            detail: 'Sessions and waits',
            family: 'sql',
            path: ['Fixture Oracle'],
            scope: 'oracle:performance',
            expandable: true,
          },
          {
            id: 'oracle-sessions',
            label: 'Sessions',
            kind: 'sessions',
            detail: 'Active sessions',
            family: 'sql',
            path: ['Fixture Oracle', 'Performance'],
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Performance')
    fireEvent.contextMenu(treeItemForLabel('Sessions'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Sessions' })
    expect(within(menu).getByRole('menuitem', { name: 'Review Sessions' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Review Sessions' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-oracle',
      expect.objectContaining({
        id: 'oracle-sessions',
        kind: 'sessions',
      }),
    )
  })

  it('marks queryable leaf objects as clickable and opens a scoped query on click', () => {
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    const productsRow = treeItemForLabel('products')

    expect(productsRow).toHaveClass('is-queryable')
    expect(within(productsRow).getByText('Query')).toBeInTheDocument()

    fireEvent.click(within(productsRow).getByRole('button', { name: 'Query' }))

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        kind: 'collection',
        label: 'products',
        preferredBuilder: 'mongo-find',
        scope: 'collection:catalog:products',
      }),
    )
  })

  it('opens appropriate queryable object actions from the context menu', () => {
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for products' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Documents' }))

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({ label: 'products' }),
    )
  })

  it('renders Mongo native collection admin children without sample document nodes', () => {
    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')
    expandTreeItem('products')

    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('Schema Preview')).toBeInTheDocument()
    expect(screen.getByText('Indexes')).toBeInTheDocument()
    expect(screen.getByText('Validation Rules')).toBeInTheDocument()
    expect(screen.getByText('Aggregations')).toBeInTheDocument()
    expect(screen.queryByText('Sample documents')).not.toBeInTheDocument()
  })

  it('opens Mongo metadata leaves as object-view tabs on normal click', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')
    expandTreeItem('products')
    fireEvent.click(treeItemForLabel('Schema Preview'))

    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        id: 'schema-preview:catalog:products',
        kind: 'schema-preview',
        label: 'Schema Preview',
      }),
    )
    expect(onOpenScopedQuery).not.toHaveBeenCalled()
  })

  it('keeps Mongo Documents as a scoped query entry instead of an object view', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')
    expandTreeItem('products')
    fireEvent.click(treeItemForLabel('Documents'))

    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        kind: 'documents',
        label: 'Documents',
        scope: 'collection:catalog:products',
      }),
    )
    expect(onOpenObjectView).not.toHaveBeenCalled()
  })

  it('shows specific Mongo view labels rather than generic Open View for metadata menu items', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')
    expandTreeItem('products')
    fireEvent.contextMenu(treeItemForLabel('Schema Preview'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Schema Preview' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Schema Preview' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open Query' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Schema Preview' }))

    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({ id: 'schema-preview:catalog:products' }),
    )

    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })
    const indexesMenu = screen.getByRole('menu', { name: 'Object options for Indexes' })
    expect(within(indexesMenu).getByRole('menuitem', { name: 'Manage Indexes' })).toBeInTheDocument()
    expect(within(indexesMenu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
  })

  it('offers Mongo collection admin templates and inspect from the object menu', () => {
    const onInspectNode = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onInspectNode={onInspectNode}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for products' })
    expect(within(menu).getByRole('menuitem', { name: 'Inspect' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Documents' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Aggregation Pipeline' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Create Index...' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Update Validation Rules...' })).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Inspect' }))

    expect(onInspectNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'collection:catalog:products',
        kind: 'collection',
        scope: 'collection:catalog:products',
      }),
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
            detail: '51 key(s)',
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

  it('keeps Redis structure while overlaying partial live metadata', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(redisConnection())}
        connection={redisConnection()}
        explorerNodes={[
          {
            id: 'redis:diagnostics:info',
            label: 'INFO',
            kind: 'diagnostics',
            detail: 'Server INFO sections',
            family: 'keyvalue',
          },
          {
            id: 'redis:cluster',
            label: 'Cluster',
            kind: 'cluster',
            detail: 'Cluster slots, nodes, and failover status',
            family: 'keyvalue',
            scope: 'cluster',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('Databases')).toBeInTheDocument()
    expect(screen.getByText('Lua Scripts')).toBeInTheDocument()
    expect(screen.getByText('ACL / Security')).toBeInTheDocument()
    expect(screen.getByText('Cluster')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()

    expandTreeItem('Databases')
    expandTreeItem('DB 0')

    expect(screen.getByText('Strings')).toBeInTheDocument()
    expect(screen.getByText('Hashes')).toBeInTheDocument()

    expandTreeItem('Diagnostics')

    expect(screen.getByText('INFO')).toBeInTheDocument()
    expect(screen.getAllByText('Databases')).toHaveLength(1)
  })

  it('uses Redis-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(redisConnection())}
        connection={redisConnection()}
        explorerNodes={[
          {
            id: 'redis:db:0:hash',
            label: 'Hashes',
            kind: 'hash',
            detail: 'Hash maps',
            family: 'keyvalue',
            path: ['Fixture Redis', 'DB 0'],
            scope: 'db:0:type:hash',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={vi.fn()}
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('DB 0')
    fireEvent.contextMenu(treeItemForLabel('Hashes'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Hashes' })
    expect(within(menu).getByRole('menuitem', { name: 'Browse Hashes' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Browse Hashes' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-redis',
      expect.objectContaining({
        id: 'redis:db:0:hash',
        kind: 'hash',
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

    expandTreeItem('User Schemas')
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
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')
    expandTreeItem('products')

    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Indexes' })

    expect(within(menu).queryByRole('menuitem', { name: 'Open Query' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Refresh indexes' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Copy Name' })).toBeInTheDocument()
  })

  it('does not show object action affordances for unavailable structural leaves', () => {
    render(
      <ConnectionObjectTree
        connection={redisConnection()}
        nodes={[
          {
            id: 'module-search',
            label: 'Search Indexes',
            kind: 'search-indexes',
            detail: 'Redis module metadata unavailable',
          },
        ]}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    const row = treeItemForLabel('Search Indexes')

    expect(
      within(row).queryByRole('button', { name: 'Object actions for Search Indexes' }),
    ).not.toBeInTheDocument()

    fireEvent.contextMenu(row, { clientX: 24, clientY: 32 })

    expect(
      screen.queryByRole('menu', { name: 'Object options for Search Indexes' }),
    ).not.toBeInTheDocument()
  })

  it('hides optional Redis module folders until live metadata reports them', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(redisConnection())}
        connection={redisConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('DB 0')

    expect(screen.getByText('Strings')).toBeInTheDocument()
    expect(screen.getByText('Hashes')).toBeInTheDocument()
    expect(screen.queryByText('JSON')).not.toBeInTheDocument()
    expect(screen.queryByText('Search Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('Vector Indexes')).not.toBeInTheDocument()
    expect(screen.queryByText('Cluster')).not.toBeInTheDocument()
    expect(screen.queryByText('Sentinel')).not.toBeInTheDocument()
  })

  it('uses datastore/object icons and environment tint for object rows', () => {
    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        environment={localEnvironment()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onOpenScopedQuery={vi.fn()}
      />,
    )

    const databasesRow = treeItemForLabel('catalog')

    expect(databasesRow).toHaveClass('has-environment-accent')
    expect(databasesRow.getAttribute('style')).toContain('--connection-env-color')
    expect(databasesRow.querySelector('.tree-kind-icon--database')).not.toBeNull()

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    const productsRow = treeItemForLabel('products')

    expect(productsRow).toHaveClass('has-environment-accent')
    expect(productsRow.querySelector('.tree-kind-icon--collection')).not.toBeNull()
  })

  it('uses distinct icons for common SQL object kinds', () => {
    render(
      <ConnectionObjectTree
        connection={postgresConnection()}
        nodes={[
          {
            id: 'schema-public',
            label: 'public',
            kind: 'schema',
            children: [
              { id: 'table-accounts', label: 'accounts', kind: 'table' },
              { id: 'view-active', label: 'active_accounts', kind: 'view' },
              { id: 'proc-refresh', label: 'refresh_accounts', kind: 'stored-procedure' },
              { id: 'fn-score', label: 'account_score', kind: 'function' },
              { id: 'ix-accounts', label: 'ix_accounts_status', kind: 'index' },
            ],
          },
        ]}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('public')

    expect(treeItemForLabel('accounts').querySelector('.tree-kind-icon--table')).not.toBeNull()
    expect(
      treeItemForLabel('active_accounts').querySelector('.tree-kind-icon--view'),
    ).not.toBeNull()
    expect(
      treeItemForLabel('refresh_accounts').querySelector('.tree-kind-icon--procedure'),
    ).not.toBeNull()
    expect(
      treeItemForLabel('account_score').querySelector('.tree-kind-icon--function'),
    ).not.toBeNull()
    expect(
      treeItemForLabel('ix_accounts_status').querySelector('.tree-kind-icon--index'),
    ).not.toBeNull()
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
            detail: 'Documents, validators, and indexes',
            family: 'document',
            path: ['catalog', 'Collections'],
            scope: 'collection:catalog:customers',
            queryTemplate: '{ "collection": "customers", "filter": {} }',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={onLoadExplorerScope}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    expect(screen.getByText('customers')).toBeInTheDocument()
    expect(screen.queryByText('products')).not.toBeInTheDocument()

    expandTreeItem('customers')

    expect(onLoadExplorerScope).toHaveBeenCalledWith('conn-mongo', 'collection:catalog:customers')
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

function sqlServerConnection(): ConnectionProfile {
  return {
    id: 'conn-sqlserver',
    name: 'Fixture SQL Server',
    engine: 'sqlserver',
    family: 'sql',
    host: 'localhost',
    port: 1433,
    database: 'datapadplusplus',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'sqlserver',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function oracleConnection(): ConnectionProfile {
  return {
    id: 'conn-oracle',
    name: 'Fixture Oracle',
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
}

function adapterManifestFor(connection: ConnectionProfile): AdapterManifest {
  const defaultLanguage: AdapterManifest['defaultLanguage'] =
    connection.family === 'keyvalue'
      ? 'redis'
      : connection.family === 'document'
        ? 'mongodb'
        : 'sql'

  return {
    id: `adapter-${connection.engine}`,
    engine: connection.engine,
    family: connection.family,
    label: `${connection.engine} adapter`,
    maturity: 'mvp',
    capabilities: [],
    defaultLanguage,
    tree: datastoreTreeForEngine(connection.engine, connection.family),
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

function mongoExplorerNodes() {
  return [
    {
      id: 'database:catalog',
      label: 'catalog',
      kind: 'database',
      detail: 'MongoDB database',
      family: 'document',
      scope: 'database:catalog',
      expandable: true,
    },
    {
      id: 'collections:catalog',
      label: 'Collections',
      kind: 'collections',
      detail: 'Document collections',
      family: 'document',
      path: ['catalog'],
      scope: 'collections:catalog',
      expandable: true,
    },
    {
      id: 'collection:catalog:products',
      label: 'products',
      kind: 'collection',
      detail: 'Collection',
      family: 'document',
      path: ['catalog', 'Collections'],
      scope: 'collection:catalog:products',
      queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {} }',
      expandable: true,
    },
    {
      id: 'documents:catalog:products',
      label: 'Documents',
      kind: 'documents',
      detail: 'Collection documents',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'collection:catalog:products',
      queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {} }',
    },
    {
      id: 'schema-preview:catalog:products',
      label: 'Schema Preview',
      kind: 'schema-preview',
      detail: 'Inferred BSON field paths',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'schema-preview:catalog:products',
    },
    {
      id: 'indexes:catalog:products',
      label: 'Indexes',
      kind: 'indexes',
      detail: 'Collection indexes',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'indexes:catalog:products',
      expandable: true,
    },
    {
      id: 'validation-rules:catalog:products',
      label: 'Validation Rules',
      kind: 'validation-rules',
      detail: 'Collection validator',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'validation-rules:catalog:products',
    },
    {
      id: 'aggregations:catalog:products',
      label: 'Aggregations',
      kind: 'aggregations',
      detail: 'Aggregation pipeline template',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'aggregation:catalog:products',
      queryTemplate: '{ "database": "catalog", "collection": "products", "pipeline": [] }',
    },
  ] satisfies Parameters<typeof ConnectionObjectTree>[0]['explorerNodes']
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

function sqliteConnection(): ConnectionProfile {
  return {
    id: 'conn-sqlite',
    name: 'Fixture SQLite',
    engine: 'sqlite',
    family: 'sql',
    host: 'tests/fixtures/sqlite/datapadplusplus.sqlite3',
    port: undefined,
    database: 'tests/fixtures/sqlite/datapadplusplus.sqlite3',
    connectionString: undefined,
    connectionMode: 'local-file',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'sqlite',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    sqliteOptions: {
      openMode: 'read-write',
      foreignKeys: true,
    },
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
