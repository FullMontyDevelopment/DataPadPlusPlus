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

    expect(screen.queryByText('Linked Servers')).not.toBeInTheDocument()
    expandTreeItem('Server Objects')
    expect(screen.getByText('Linked Servers')).toBeInTheDocument()
    expect(screen.getByText('Endpoints')).toBeInTheDocument()

    expect(screen.queryByText('Availability Groups')).not.toBeInTheDocument()
    expandTreeItem('Always On High Availability')
    expect(screen.getByText('Availability Groups')).toBeInTheDocument()
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

  it('uses LiteDB-owned local file folders without document-store admin clutter', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(liteDbConnection())}
        connection={liteDbConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Local Database')

    expect(screen.getByText('Collections')).toBeInTheDocument()
    expect(screen.getByText('Indexes')).toBeInTheDocument()
    expect(screen.getByText('File Storage')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
    expect(screen.queryByText('Roles')).not.toBeInTheDocument()
    expect(screen.queryByText('Security')).not.toBeInTheDocument()
  })

  it('uses LiteDB-specific object view labels and collection query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={liteDbConnection()}
        explorerNodes={[
          {
            id: 'litedb:database',
            label: 'catalog.db',
            kind: 'database',
            detail: 'LiteDB local file overview',
            family: 'document',
            path: ['catalog.db'],
            scope: 'litedb:database',
            expandable: true,
          },
          {
            id: 'litedb:collections',
            label: 'Collections',
            kind: 'collections',
            detail: 'Document collections',
            family: 'document',
            path: ['catalog.db'],
            scope: 'litedb:collections',
            expandable: true,
          },
          {
            id: 'litedb:collection:products',
            label: 'products',
            kind: 'collection',
            detail: '100000 documents',
            family: 'document',
            path: ['catalog.db', 'Collections'],
            scope: 'litedb:collection:products',
            queryTemplate: '{ "collection": "products", "filter": {}, "limit": 20 }',
            expandable: true,
          },
          {
            id: 'litedb:indexes',
            label: 'Indexes',
            kind: 'indexes',
            detail: 'Collection index definitions',
            family: 'document',
            path: ['catalog.db'],
            scope: 'litedb:indexes',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('catalog.db')
    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })

    const indexMenu = screen.getByRole('menu', { name: 'Object options for Indexes' })
    expect(within(indexMenu).getByRole('menuitem', { name: 'Manage Indexes' })).toBeInTheDocument()
    expect(within(indexMenu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
    fireEvent.click(within(indexMenu).getByRole('menuitem', { name: 'Manage Indexes' }))
    expect(onOpenObjectView).toHaveBeenCalledWith('conn-litedb', expect.objectContaining({
      id: 'litedb:indexes',
      kind: 'indexes',
    }))

    expandTreeItem('Collections')
    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })
    const collectionMenu = screen.getByRole('menu', { name: 'Object options for products' })
    expect(within(collectionMenu).getByRole('menuitem', { name: 'Open Collection' })).toBeInTheDocument()
    expect(within(collectionMenu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    fireEvent.click(within(collectionMenu).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith('conn-litedb', expect.objectContaining({
      label: 'products',
      queryTemplate: expect.stringContaining('"collection": "products"'),
    }))
  })

  it('uses Cosmos DB-owned account folders instead of generic document folders', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(cosmosConnection())}
        connection={cosmosConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Account')
    expandTreeItem('Databases')
    expandTreeItem('catalog')

    expect(screen.getByText('Containers')).toBeInTheDocument()
    expect(screen.getByText('Throughput')).toBeInTheDocument()
    expect(screen.getByText('Regions')).toBeInTheDocument()
    expect(screen.getByText('Consistency')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
    expect(screen.queryByText('Collections')).not.toBeInTheDocument()
    expect(screen.queryByText('Roles')).not.toBeInTheDocument()
  })

  it('uses Cosmos DB-specific object view labels and item query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={cosmosConnection()}
        explorerNodes={[
          {
            id: 'cosmos:account',
            label: 'datapad-cosmos',
            kind: 'account',
            detail: 'Cosmos DB account overview',
            family: 'document',
            path: ['datapad-cosmos'],
            scope: 'cosmos:account',
            expandable: true,
          },
          {
            id: 'cosmos:database:catalog',
            label: 'catalog',
            kind: 'database',
            detail: '3 containers',
            family: 'document',
            path: ['datapad-cosmos', 'Databases'],
            scope: 'cosmos:database:catalog',
            expandable: true,
          },
          {
            id: 'cosmos:containers:catalog',
            label: 'Containers',
            kind: 'containers',
            detail: 'Container inventory',
            family: 'document',
            path: ['datapad-cosmos', 'Databases', 'catalog'],
            scope: 'cosmos:containers:catalog',
            expandable: true,
          },
          {
            id: 'cosmos:container:catalog:products',
            label: 'products',
            kind: 'container',
            detail: '/tenantId | autoscale',
            family: 'document',
            path: ['datapad-cosmos', 'Databases', 'catalog', 'Containers'],
            scope: 'cosmos:container:catalog:products',
            queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {}, "limit": 20 }',
            expandable: true,
          },
          {
            id: 'cosmos:indexing-policy:catalog:products',
            label: 'Indexing Policy',
            kind: 'indexing-policy',
            detail: 'included and excluded paths',
            family: 'document',
            path: ['datapad-cosmos', 'Databases', 'catalog', 'Containers', 'products'],
            scope: 'cosmos:indexing-policy:catalog:products',
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('datapad-cosmos')
    expandTreeItem('Databases')
    expandTreeItem('catalog')
    expandTreeItem('Containers')
    expandTreeItem('products')

    fireEvent.contextMenu(treeItemForLabel('Indexing Policy'), { clientX: 24, clientY: 32 })
    const policyMenu = screen.getByRole('menu', { name: 'Object options for Indexing Policy' })
    expect(within(policyMenu).getByRole('menuitem', { name: 'Review Indexing Policy' })).toBeInTheDocument()
    expect(within(policyMenu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
    fireEvent.click(within(policyMenu).getByRole('menuitem', { name: 'Review Indexing Policy' }))
    expect(onOpenObjectView).toHaveBeenCalledWith('conn-cosmos', expect.objectContaining({
      id: 'cosmos:indexing-policy:catalog:products',
      kind: 'indexing-policy',
    }))

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })
    const containerMenu = screen.getByRole('menu', { name: 'Object options for products' })
    expect(within(containerMenu).getByRole('menuitem', { name: 'Open Container' })).toBeInTheDocument()
    expect(within(containerMenu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    fireEvent.click(within(containerMenu).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith('conn-cosmos', expect.objectContaining({
      label: 'products',
      queryTemplate: expect.stringContaining('"collection": "products"'),
    }))
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

  it('uses CockroachDB-owned cluster and database folders', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(cockroachConnection())}
        connection={cockroachConnection()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('defaultdb')
    expandTreeItem('User Schemas')

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('Sequences')).toBeInTheDocument()
    expect(screen.getByText('Zone Configurations')).toBeInTheDocument()

    expandTreeItem('Cluster')

    expect(screen.getByText('Nodes')).toBeInTheDocument()
    expect(screen.getByText('Ranges')).toBeInTheDocument()
    expect(screen.getByText('Regions / Localities')).toBeInTheDocument()
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Cluster Settings')).toBeInTheDocument()
  })

  it('uses CockroachDB-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={cockroachConnection()}
        explorerNodes={[
          {
            id: 'cockroach:cluster',
            label: 'Cluster',
            kind: 'cluster',
            detail: 'Nodes, ranges, regions, and jobs',
            family: 'sql',
            path: ['Fixture Cockroach'],
            scope: 'cockroach:cluster',
            expandable: true,
          },
          {
            id: 'cockroach:cluster:ranges',
            label: 'Ranges',
            kind: 'ranges',
            detail: 'Range distribution',
            family: 'sql',
            path: ['Fixture Cockroach', 'Cluster'],
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Cluster')
    fireEvent.contextMenu(treeItemForLabel('Ranges'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Ranges' })
    expect(within(menu).getByRole('menuitem', { name: 'Review Ranges' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Review Ranges' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-cockroach',
      expect.objectContaining({
        id: 'cockroach:cluster:ranges',
        kind: 'ranges',
      }),
    )
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
    expect(within(menu).queryByRole('menuitem', { name: 'Sample Schema Preview' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Schema Preview' }))

    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({ id: 'schema-preview:catalog:products' }),
    )

    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })
    const indexesMenu = screen.getByRole('menu', { name: 'Object options for Indexes' })
    expect(within(indexesMenu).getByRole('menuitem', { name: 'Manage Indexes' })).toBeInTheDocument()
    expect(within(indexesMenu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
    expect(within(indexesMenu).queryByRole('menuitem', { name: 'List Indexes' })).not.toBeInTheDocument()
  })

  it('offers Mongo collection admin templates and inspect from the object menu', () => {
    const onInspectNode = vi.fn()

    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mongoConnection()}
        explorerNodes={mongoExplorerNodes()}
        explorerStatus="ready"
        onInspectNode={onInspectNode}
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('catalog')
    expandTreeItem('Collections')

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for products' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Documents' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Collection Overview' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Inspect' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Add Document...' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Aggregation Pipeline' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Create Index...' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Update Validation Rules...' })).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add Document...' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        id: 'insert-document:catalog:products',
        kind: 'insert-document',
        label: 'Add Document',
        path: ['catalog', 'Collections', 'products'],
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })
    const createMenu = screen.getByRole('menu', { name: 'Object options for products' })
    fireEvent.click(within(createMenu).getByRole('menuitem', { name: 'Create Index...' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
      expect.objectContaining({
        id: 'create-index:catalog:products',
        kind: 'create-index',
        label: 'Create Index',
        path: ['catalog', 'Collections', 'products'],
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('products'), { clientX: 24, clientY: 32 })
    const overviewMenu = screen.getByRole('menu', { name: 'Object options for products' })
    fireEvent.click(within(overviewMenu).getByRole('menuitem', { name: 'Open Collection Overview' }))

    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mongo',
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

  it('uses Memcached cache-server folders without Redis-style key-prefix browsing', () => {
    render(
      <ConnectionObjectTree
        adapterManifest={adapterManifestFor(memcachedConnection())}
        connection={memcachedConnection()}
        onOpenObjectView={vi.fn()}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Server')

    expect(screen.getByText('Stats')).toBeInTheDocument()
    expect(screen.getByText('Slabs')).toBeInTheDocument()
    expect(screen.getByText('Item Classes')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Connections')).toBeInTheDocument()
    expect(screen.queryByText('session:*')).not.toBeInTheDocument()
    expect(screen.queryByText('cache:*')).not.toBeInTheDocument()
    expect(screen.queryByText('Key Prefixes')).not.toBeInTheDocument()
  })

  it('uses Memcached-specific object view labels and no query action', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={memcachedConnection()}
        explorerNodes={[
          {
            id: 'memcached:stats',
            label: 'Stats',
            kind: 'stats',
            detail: 'Operational counters and hit rate',
            family: 'keyvalue',
            path: ['Fixture Memcached', 'Server'],
            scope: 'memcached:stats',
          },
        ]}
        explorerStatus="ready"
        onLoadExplorerScope={vi.fn()}
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Server')
    fireEvent.contextMenu(treeItemForLabel('Stats'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Stats' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Stats' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open Query' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Stats' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-memcached',
      expect.objectContaining({
        id: 'memcached:stats',
        kind: 'stats',
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

  it('uses PostgreSQL-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={postgresConnection()}
        explorerNodes={[
          {
            id: 'schema-public',
            label: 'public',
            kind: 'schema',
            detail: 'User schema',
            family: 'sql',
            path: ['Fixture Postgres', 'User Schemas'],
            scope: 'schema:public',
            expandable: true,
          },
          {
            id: 'public.accounts',
            label: 'accounts',
            kind: 'table',
            family: 'sql',
            path: ['Fixture Postgres', 'User Schemas', 'public', 'Tables'],
            scope: 'table:public.accounts',
            detail: 'table',
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('User Schemas')
    expandTreeItem('public')
    expandTreeItem('Tables')
    fireEvent.contextMenu(treeItemForLabel('accounts'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for accounts' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Table' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Table' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-postgres',
      expect.objectContaining({
        id: 'public.accounts',
        kind: 'table',
      }),
    )
  })

  it('uses SQL Server-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={sqlServerConnection()}
        explorerNodes={[
          {
            id: 'database:datapadplusplus',
            label: 'datapadplusplus',
            kind: 'database',
            detail: 'ONLINE',
            family: 'sql',
            path: ['Fixture SQL Server', 'Databases'],
            scope: 'database:datapadplusplus',
            expandable: true,
          },
          {
            id: 'sqlserver:datapadplusplus:query-store',
            label: 'Query Store',
            kind: 'query-store',
            detail: 'Runtime stats and plans',
            family: 'sql',
            path: ['Fixture SQL Server', 'Databases', 'datapadplusplus'],
            scope: 'sqlserver:datapadplusplus:query-store',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('datapadplusplus')
    fireEvent.contextMenu(treeItemForLabel('Query Store'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Query Store' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Query Store' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Query Store' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-sqlserver',
      expect.objectContaining({
        id: 'sqlserver:datapadplusplus:query-store',
        kind: 'query-store',
      }),
    )
  })

  it('uses MySQL-specific object view labels instead of generic Open View', () => {
    const onOpenObjectView = vi.fn()

    render(
      <ConnectionObjectTree
        connection={mysqlConnection()}
        explorerNodes={[
          {
            id: 'database:datapadplusplus',
            label: 'datapadplusplus',
            kind: 'database',
            detail: 'MySQL database',
            family: 'sql',
            path: ['Fixture MySQL', 'Databases'],
            scope: 'database:datapadplusplus',
            expandable: true,
          },
          {
            id: 'mysql:datapadplusplus:indexes',
            label: 'Indexes',
            kind: 'indexes',
            detail: 'Schema-level index list',
            family: 'sql',
            path: ['Fixture MySQL', 'Databases', 'datapadplusplus'],
            scope: 'mysql:datapadplusplus:indexes',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('datapadplusplus')
    fireEvent.contextMenu(treeItemForLabel('Indexes'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Indexes' })
    expect(within(menu).getByRole('menuitem', { name: 'Manage Indexes' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Manage Indexes' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-mysql',
      expect.objectContaining({
        id: 'mysql:datapadplusplus:indexes',
        kind: 'indexes',
      }),
    )
  })

  it('uses search-specific object view labels and Query DSL builder targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={searchConnection()}
        explorerNodes={[
          {
            id: 'search:indices',
            label: 'Indices',
            kind: 'indices',
            detail: 'Searchable indices',
            family: 'search',
            scope: 'search:indices',
            expandable: true,
          },
          {
            id: 'index:products-v1',
            label: 'products-v1',
            kind: 'index',
            detail: 'green / 100,000 docs',
            family: 'search',
            path: ['Indices'],
            scope: 'index:products-v1',
            queryTemplate: '{ "index": "products-v1", "body": { "query": { "match_all": {} } } }',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Indices')
    fireEvent.contextMenu(treeItemForLabel('products-v1'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for products-v1' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Index' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Index' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-search',
      expect.objectContaining({
        id: 'index:products-v1',
        kind: 'index',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('products-v1'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for products-v1' })).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-search',
      expect.objectContaining({
        preferredBuilder: 'search-dsl',
        queryTemplate: expect.stringContaining('products-v1'),
      }),
    )
  })

  it('uses DynamoDB-specific object view labels and key-condition builder targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={dynamoConnection()}
        explorerNodes={[
          {
            id: 'dynamodb:tables',
            label: 'Tables',
            kind: 'tables',
            detail: 'DynamoDB tables',
            family: 'widecolumn',
            scope: 'dynamodb:tables',
            expandable: true,
          },
          {
            id: 'table:Orders',
            label: 'Orders',
            kind: 'table',
            detail: 'ACTIVE / PAY_PER_REQUEST',
            family: 'widecolumn',
            path: ['Tables'],
            scope: 'table:Orders',
            queryTemplate: '{ "operation": "Query", "tableName": "Orders", "limit": 20 }',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Tables')
    fireEvent.contextMenu(treeItemForLabel('Orders'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Orders' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Table' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Table' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-dynamodb',
      expect.objectContaining({
        id: 'table:Orders',
        kind: 'table',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('Orders'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for Orders' })).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-dynamodb',
      expect.objectContaining({
        preferredBuilder: 'dynamodb-key-condition',
        queryTemplate: expect.stringContaining('Orders'),
      }),
    )
  })

  it('uses Cassandra-specific object view labels and CQL builder targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()
    render(
      <ConnectionObjectTree
        connection={cassandraConnection()}
        explorerNodes={[
          {
            id: 'keyspace:app',
            label: 'app',
            kind: 'keyspace',
            detail: 'Application keyspace',
            family: 'widecolumn',
            scope: 'keyspace:app',
            expandable: true,
          },
          {
            id: 'table:app:orders_by_customer',
            label: 'orders_by_customer',
            kind: 'table',
            detail: 'customer_id partition key',
            family: 'widecolumn',
            path: ['Keyspaces', 'app', 'Tables'],
            scope: 'table:app.orders_by_customer',
            queryTemplate: 'select * from "app"."orders_by_customer" where customer_id = ? limit 20;',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Keyspaces')
    expandTreeItem('app')
    expandTreeItem('Tables')
    fireEvent.contextMenu(treeItemForLabel('orders_by_customer'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for orders_by_customer' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Table' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Table' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-cassandra',
      expect.objectContaining({
        id: 'table:app:orders_by_customer',
        kind: 'table',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('orders_by_customer'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for orders_by_customer' })).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-cassandra',
      expect.objectContaining({
        preferredBuilder: 'cql-partition',
        queryTemplate: expect.stringContaining('customer_id'),
      }),
    )
  })

  it('uses Prometheus-specific object view labels and PromQL query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={prometheusConnection()}
        explorerNodes={[
          {
            id: 'prometheus:metrics',
            label: 'Metrics',
            kind: 'metrics',
            detail: 'Metric families',
            family: 'timeseries',
            scope: 'prometheus:metrics',
            expandable: true,
          },
          {
            id: 'metric:http_requests_total',
            label: 'http_requests_total',
            kind: 'metric',
            detail: 'counter | 840 series',
            family: 'timeseries',
            path: ['Metrics'],
            scope: 'metric:http_requests_total',
            queryTemplate: 'http_requests_total',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Metrics')
    fireEvent.contextMenu(treeItemForLabel('http_requests_total'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for http_requests_total' })
    expect(within(menu).getByRole('menuitem', { name: 'Open PromQL Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Metric' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Metric' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-prometheus',
      expect.objectContaining({
        id: 'metric:http_requests_total',
        kind: 'metric',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('http_requests_total'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for http_requests_total' })).getByRole('menuitem', { name: 'Open PromQL Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-prometheus',
      expect.objectContaining({
        queryTemplate: 'http_requests_total',
        preferredBuilder: undefined,
      }),
    )
  })

  it('uses InfluxDB-specific object view labels and measurement query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={influxConnection()}
        explorerNodes={[
          {
            id: 'influx:buckets',
            label: 'Buckets',
            kind: 'buckets',
            detail: 'Bucket list',
            family: 'timeseries',
            scope: 'influx:buckets',
            expandable: true,
          },
          {
            id: 'bucket:telemetry',
            label: 'telemetry',
            kind: 'bucket',
            detail: '30 d retention',
            family: 'timeseries',
            path: ['Buckets'],
            scope: 'bucket:telemetry',
            expandable: true,
          },
          {
            id: 'measurement:telemetry:cpu',
            label: 'cpu',
            kind: 'measurement',
            detail: '8,400 series',
            family: 'timeseries',
            path: ['Buckets', 'telemetry', 'Measurements'],
            scope: 'measurement:telemetry:cpu',
            queryTemplate: 'from(bucket: "telemetry")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "cpu")',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Buckets')
    expandTreeItem('telemetry')
    expandTreeItem('Measurements')
    fireEvent.contextMenu(treeItemForLabel('cpu'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for cpu' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Time-Series Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Measurement' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Measurement' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-influxdb',
      expect.objectContaining({
        id: 'measurement:telemetry:cpu',
        kind: 'measurement',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('cpu'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for cpu' })).getByRole('menuitem', { name: 'Open Time-Series Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-influxdb',
      expect.objectContaining({
        queryTemplate: expect.stringContaining('_measurement == "cpu"'),
        preferredBuilder: undefined,
      }),
    )
  })

  it('uses OpenTSDB-specific object view labels and metric query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={openTsdbConnection()}
        explorerNodes={[
          {
            id: 'opentsdb:metrics',
            label: 'Metrics',
            kind: 'metrics',
            detail: 'Metric names',
            family: 'timeseries',
            scope: 'opentsdb:metrics',
            expandable: true,
          },
          {
            id: 'metric:http.requests',
            label: 'http.requests',
            kind: 'metric',
            detail: 'high cardinality',
            family: 'timeseries',
            path: ['Metrics'],
            scope: 'metric:http.requests',
            queryTemplate: '{\n  "start": "1h-ago",\n  "queries": [{ "metric": "http.requests", "aggregator": "avg" }]\n}',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Metrics')
    fireEvent.contextMenu(treeItemForLabel('http.requests'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for http.requests' })
    expect(within(menu).getByRole('menuitem', { name: 'Open OpenTSDB Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Metric' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Metric' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-opentsdb',
      expect.objectContaining({
        id: 'metric:http.requests',
        kind: 'metric',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('http.requests'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for http.requests' })).getByRole('menuitem', { name: 'Open OpenTSDB Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-opentsdb',
      expect.objectContaining({
        queryTemplate: expect.stringContaining('"metric": "http.requests"'),
        preferredBuilder: undefined,
      }),
    )
  })

  it('uses graph-specific object view labels and Cypher query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={neo4jConnection()}
        explorerNodes={[
          {
            id: 'graph:node-labels',
            label: 'Node Labels',
            kind: 'node-labels',
            detail: 'Node categories',
            family: 'graph',
            scope: 'graph:node-labels',
            expandable: true,
          },
          {
            id: 'node-label:Account',
            label: 'Account',
            kind: 'node-label',
            detail: '2,800 nodes',
            family: 'graph',
            path: ['Node Labels'],
            scope: 'node-label:Account',
            queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
            expandable: true,
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Node Labels')
    fireEvent.contextMenu(treeItemForLabel('Account'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Account' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Cypher Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Node Label' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Node Label' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-neo4j',
      expect.objectContaining({
        id: 'node-label:Account',
        kind: 'node-label',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('Account'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for Account' })).getByRole('menuitem', { name: 'Open Cypher Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-neo4j',
      expect.objectContaining({
        queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
        preferredBuilder: undefined,
      }),
    )
  })

  it('uses warehouse-specific object view labels and SQL query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={snowflakeConnection()}
        explorerNodes={[
          {
            id: 'table:ANALYTICS:orders',
            label: 'orders',
            kind: 'table',
            detail: '12.4 M rows',
            family: 'warehouse',
            path: ['ANALYTICS'],
            scope: 'table:ANALYTICS:orders',
            queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Databases')
    expandTreeItem('ANALYTICS')
    expandTreeItem('Tables')
    fireEvent.contextMenu(treeItemForLabel('orders'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for orders' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Snowflake SQL' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Table' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Table' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-snowflake',
      expect.objectContaining({
        id: 'table:ANALYTICS:orders',
        kind: 'table',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('orders'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for orders' })).getByRole('menuitem', { name: 'Open Snowflake SQL' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-snowflake',
      expect.objectContaining({
        queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
        preferredBuilder: undefined,
      }),
    )
  })

  it('uses DuckDB-specific object view labels and local SQL query targets', () => {
    const onOpenObjectView = vi.fn()
    const onOpenScopedQuery = vi.fn()

    render(
      <ConnectionObjectTree
        connection={duckDbConnection()}
        explorerNodes={[
          {
            id: 'table:main:orders',
            label: 'orders',
            kind: 'table',
            detail: '1.2 M rows',
            family: 'embedded-olap',
            path: ['main', 'Tables'],
            scope: 'table:main:orders',
            queryTemplate: 'select * from "main"."orders" limit 100;',
          },
        ]}
        explorerStatus="ready"
        onOpenObjectView={onOpenObjectView}
        onOpenScopedQuery={onOpenScopedQuery}
      />,
    )

    expandTreeItem('Main Database')
    expandTreeItem('Schemas')
    expandTreeItem('main')
    expandTreeItem('Tables')
    fireEvent.contextMenu(treeItemForLabel('orders'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for orders' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Query' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Open Table' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Open View' })).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Table' }))
    expect(onOpenObjectView).toHaveBeenCalledWith(
      'conn-duckdb',
      expect.objectContaining({
        id: 'table:main:orders',
        kind: 'table',
      }),
    )

    fireEvent.contextMenu(treeItemForLabel('orders'), { clientX: 24, clientY: 32 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Object options for orders' })).getByRole('menuitem', { name: 'Open Query' }))
    expect(onOpenScopedQuery).toHaveBeenCalledWith(
      'conn-duckdb',
      expect.objectContaining({
        queryTemplate: 'select * from "main"."orders" limit 100;',
        preferredBuilder: undefined,
      }),
    )
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

  it('uses SQL Server-specific icons instead of the generic fallback for SSMS folders', () => {
    render(
      <ConnectionObjectTree
        connection={sqlServerConnection()}
        nodes={[
          { id: 'replication', label: 'Replication', kind: 'replication' },
          { id: 'management', label: 'Management', kind: 'management' },
          { id: 'agent', label: 'SQL Server Agent', kind: 'sql-server-agent' },
          { id: 'events', label: 'Extended Events', kind: 'extended-events' },
          { id: 'profiler', label: 'XEvent Profiler', kind: 'xevent-profiler' },
          { id: 'ssis', label: 'Integration Services Catalogs', kind: 'integration-services-catalogs' },
          { id: 'ssas', label: 'Analysis Services', kind: 'analysis-services' },
          { id: 'ssrs', label: 'Reporting Services', kind: 'reporting-services' },
        ]}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    for (const label of [
      'Replication',
      'Management',
      'SQL Server Agent',
      'Extended Events',
      'XEvent Profiler',
      'Integration Services Catalogs',
      'Analysis Services',
      'Reporting Services',
    ]) {
      expect(treeItemForLabel(label).querySelector('.tree-kind-icon--generic')).toBeNull()
    }
  })

  it('uses Oracle-specific icons instead of the generic fallback for SQL Developer folders', () => {
    render(
      <ConnectionObjectTree
        connection={oracleConnection()}
        nodes={[
          { id: 'performance', label: 'Performance', kind: 'performance' },
          { id: 'statistics', label: 'Statistics', kind: 'statistics' },
          { id: 'synonyms', label: 'Synonyms', kind: 'synonyms' },
          { id: 'sequences', label: 'Sequences', kind: 'sequences' },
          { id: 'database-links', label: 'Database Links', kind: 'database-links' },
          { id: 'json-collections', label: 'JSON Collections', kind: 'json-collections' },
          { id: 'data-guard', label: 'Data Guard', kind: 'data-guard' },
          { id: 'ddl', label: 'DDL', kind: 'ddl' },
          { id: 'dependencies', label: 'Dependencies', kind: 'dependencies' },
          { id: 'compilation-errors', label: 'Compilation Errors', kind: 'compilation-errors' },
        ]}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    for (const label of [
      'Performance',
      'Statistics',
      'Synonyms',
      'Sequences',
      'Database Links',
      'JSON Collections',
      'Data Guard',
      'DDL',
      'Dependencies',
      'Compilation Errors',
    ]) {
      expect(treeItemForLabel(label).querySelector('.tree-kind-icon--generic')).toBeNull()
    }
  })

  it('uses CockroachDB-specific icons instead of the generic fallback for cluster folders', () => {
    render(
      <ConnectionObjectTree
        connection={cockroachConnection()}
        nodes={[
          { id: 'cluster', label: 'Cluster', kind: 'cluster' },
          { id: 'nodes', label: 'Nodes', kind: 'nodes' },
          { id: 'ranges', label: 'Ranges', kind: 'ranges' },
          { id: 'regions', label: 'Regions / Localities', kind: 'regions' },
          { id: 'jobs', label: 'Jobs', kind: 'jobs' },
          { id: 'contention', label: 'Contention', kind: 'contention' },
          { id: 'transactions', label: 'Transactions', kind: 'transactions' },
          { id: 'statements', label: 'Statement Stats', kind: 'statements' },
          { id: 'cluster-settings', label: 'Cluster Settings', kind: 'cluster-settings' },
          { id: 'zone-configurations', label: 'Zone Configurations', kind: 'zone-configurations' },
        ]}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    for (const label of [
      'Cluster',
      'Nodes',
      'Ranges',
      'Regions / Localities',
      'Jobs',
      'Contention',
      'Transactions',
      'Statement Stats',
      'Cluster Settings',
      'Zone Configurations',
    ]) {
      expect(treeItemForLabel(label).querySelector('.tree-kind-icon--generic')).toBeNull()
    }
  })

  it('offers refresh on every object row and falls back to root metadata when no scope exists', () => {
    const onLoadExplorerScope = vi.fn()

    render(
      <ConnectionObjectTree
        connection={postgresConnection()}
        nodes={[
          {
            id: 'structural-root',
            label: 'Structural Root',
            kind: 'folder',
            detail: 'Manifest-only grouping',
          },
        ]}
        onLoadExplorerScope={onLoadExplorerScope}
        onOpenScopedQuery={vi.fn()}
      />,
    )

    fireEvent.contextMenu(treeItemForLabel('Structural Root'), { clientX: 24, clientY: 32 })

    const menu = screen.getByRole('menu', { name: 'Object options for Structural Root' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Refresh folder' }))

    expect(onLoadExplorerScope).toHaveBeenCalledWith('conn-postgres', undefined)
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

function cockroachConnection(): ConnectionProfile {
  return {
    id: 'conn-cockroach',
    name: 'Fixture Cockroach',
    engine: 'cockroachdb',
    family: 'sql',
    host: 'localhost',
    port: 26257,
    database: 'defaultdb',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cockroachdb',
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

function mysqlConnection(): ConnectionProfile {
  return {
    id: 'conn-mysql',
    name: 'Fixture MySQL',
    engine: 'mysql',
    family: 'sql',
    host: 'localhost',
    port: 3306,
    database: 'datapadplusplus',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mysql',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'app' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function searchConnection(): ConnectionProfile {
  return {
    id: 'conn-search',
    name: 'Fixture Elasticsearch',
    engine: 'elasticsearch',
    family: 'search',
    host: 'localhost',
    port: 9200,
    database: 'elasticsearch-local',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'elasticsearch',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'elastic' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function dynamoConnection(): ConnectionProfile {
  return {
    id: 'conn-dynamodb',
    name: 'Fixture DynamoDB',
    engine: 'dynamodb',
    family: 'widecolumn',
    host: 'localhost',
    port: 8000,
    database: 'local',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'dynamodb',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'local' },
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
        : connection.engine === 'prometheus'
          ? 'promql'
          : connection.engine === 'influxdb'
            ? 'influxql'
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

function memcachedConnection(): ConnectionProfile {
  return {
    id: 'conn-memcached',
    name: 'Fixture Memcached',
    engine: 'memcached',
    family: 'keyvalue',
    host: 'localhost',
    port: 11211,
    database: undefined,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'memcached',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function cassandraConnection(): ConnectionProfile {
  return {
    id: 'conn-cassandra',
    name: 'Fixture Cassandra',
    engine: 'cassandra',
    family: 'widecolumn',
    host: 'localhost',
    port: 9042,
    database: 'app',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cassandra',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'cassandra' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function prometheusConnection(): ConnectionProfile {
  return {
    id: 'conn-prometheus',
    name: 'Fixture Prometheus',
    engine: 'prometheus',
    family: 'timeseries',
    host: 'localhost',
    port: 9090,
    database: undefined,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'prometheus',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function influxConnection(): ConnectionProfile {
  return {
    id: 'conn-influxdb',
    name: 'Fixture InfluxDB',
    engine: 'influxdb',
    family: 'timeseries',
    host: 'localhost',
    port: 8086,
    database: 'telemetry',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'influxdb',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function openTsdbConnection(): ConnectionProfile {
  return {
    id: 'conn-opentsdb',
    name: 'Fixture OpenTSDB',
    engine: 'opentsdb',
    family: 'timeseries',
    host: 'localhost',
    port: 4242,
    database: undefined,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'opentsdb',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function neo4jConnection(): ConnectionProfile {
  return {
    id: 'conn-neo4j',
    name: 'Fixture Neo4j',
    engine: 'neo4j',
    family: 'graph',
    host: 'localhost',
    port: 7687,
    database: 'neo4j',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'neo4j',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'neo4j' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function snowflakeConnection(): ConnectionProfile {
  return {
    id: 'conn-snowflake',
    name: 'Fixture Snowflake',
    engine: 'snowflake',
    family: 'warehouse',
    host: 'account.snowflakecomputing.com',
    port: undefined,
    database: 'ANALYTICS',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'snowflake',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'analyst' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function duckDbConnection(): ConnectionProfile {
  return {
    id: 'conn-duckdb',
    name: 'Fixture DuckDB',
    engine: 'duckdb',
    family: 'embedded-olap',
    host: 'tests/fixtures/duckdb/datapad.duckdb',
    port: undefined,
    database: 'tests/fixtures/duckdb/datapad.duckdb',
    connectionString: undefined,
    connectionMode: 'local-file',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'duckdb',
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

function liteDbConnection(): ConnectionProfile {
  return {
    id: 'conn-litedb',
    name: 'Fixture LiteDB',
    engine: 'litedb',
    family: 'document',
    host: 'tests/fixtures/litedb/catalog.db',
    port: undefined,
    database: 'tests/fixtures/litedb/catalog.db',
    connectionString: undefined,
    connectionMode: 'local-file',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'litedb',
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function cosmosConnection(): ConnectionProfile {
  return {
    id: 'conn-cosmos',
    name: 'Fixture Cosmos DB',
    engine: 'cosmosdb',
    family: 'document',
    host: 'datapad-cosmos.documents.azure.com',
    port: 443,
    database: 'catalog',
    connectionString: undefined,
    connectionMode: 'connection-string',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cosmosdb',
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
