import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopClient } from '../services/runtime/client'
import { App } from './App'

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange(value: string | undefined): void
  }) => (
    <textarea
      aria-label="Query editor"
      className="editor-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

async function openConnectionDraft() {
  await screen.findByLabelText('library sidebar')
  fireEvent.click(screen.getByLabelText('New datastore connection'))

  const drawer = await screen.findByLabelText('connection drawer')

  await waitFor(() => {
    expect(within(drawer).getByLabelText('Name')).toHaveValue('PostgreSQL connection')
  })

  return drawer
}

async function saveConnectionDraft(drawer: HTMLElement, options = { createQueryTab: true }) {
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Connection' }))

  await waitFor(() => {
    expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
  })

  if (options.createQueryTab) {
    await openNewQueryFromConnection('PostgreSQL connection', /Query 1/i)
  }
}

async function openNewQueryFromConnection(
  connectionName = 'PostgreSQL connection',
  expectedTabName: RegExp = /Query \d+/i,
) {
  fireEvent.contextMenu(getConnectionRow(connectionName))
  fireEvent.click(
    await screen.findByRole('menuitem', {
      name: `New Query for ${connectionName}`,
    }),
  )

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: expectedTabName })).toBeInTheDocument()
  })
}

async function createFirstConnection() {
  const drawer = await openConnectionDraft()
  await saveConnectionDraft(drawer)
}

async function runPreviewQuery() {
  await createFirstConnection()
  fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

  await waitFor(() => {
    expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
  })
}

function getConnectionRow(connectionName: string) {
  const label = within(screen.getByLabelText('library sidebar')).getByText(connectionName)
  const row = label.closest('[role="treeitem"]')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Connection row was not found for ${connectionName}.`)
  }

  return row
}

function getObjectTreeItem(root: HTMLElement, label: string) {
  const row = within(root).getByText(label).closest('[role="treeitem"]')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Object tree row was not found for ${label}.`)
  }

  return row
}

function expandObjectTreeItem(root: HTMLElement, label: string) {
  const treeItem = getObjectTreeItem(root, label)
  const expandButton = within(root).queryByLabelText(`Expand ${label}`)

  if (expandButton) {
    fireEvent.keyDown(treeItem, { key: 'Enter' })
    return
  }

  if (treeItem.getAttribute('aria-expanded') === 'false') {
    fireEvent.keyDown(treeItem, { key: 'Enter' })
    return
  }

  fireEvent.click(treeItem)
}

function getConnectionObjectTree(connectionName: string) {
  return screen.getByRole('tree', { name: `${connectionName} objects` })
}

async function expandConnectionObjects(connectionName: string) {
  const sidebar = screen.getByLabelText('library sidebar')
  const connectionRow = getConnectionRow(connectionName)
  fireEvent.click(within(connectionRow).getByText(connectionName))
  await waitFor(() => {
    expect(
      within(sidebar).queryByLabelText(`Loading metadata for ${connectionName}`),
    ).not.toBeInTheDocument()
  })

  const tree = within(sidebar).queryByRole('tree', { name: `${connectionName} objects` })

  if (tree) {
    return tree
  }

  fireEvent.click(within(sidebar).getByLabelText(`Expand connection ${connectionName}`))
  await waitFor(() => {
    expect(
      within(sidebar).queryByLabelText(`Loading metadata for ${connectionName}`),
    ).not.toBeInTheDocument()
  })

  return await within(sidebar).findByRole('tree', { name: `${connectionName} objects` })
}

function getEditorTabNames() {
  const tablist = screen.getByRole('tablist', { name: 'Editor tabs' })
  return within(tablist)
    .getAllByRole('tab')
    .map((tab) => tab.textContent ?? '')
}

function chooseDatabaseType(drawer: HTMLElement, datastoreLabel: string) {
  fireEvent.click(within(drawer).getByLabelText('Database type'))
  fireEvent.click(within(drawer).getByRole('option', { name: datastoreLabel }))
}

function setConnectionDatabase(drawer: HTMLElement, database: string) {
  fireEvent.change(within(drawer).getByLabelText('Database'), {
    target: { value: database },
  })
}

function pointerDropFieldIntoBuilder(
  source: HTMLElement,
  builder: HTMLElement,
  target: HTMLElement,
) {
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
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn().mockReturnValue(target),
  })

  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 600, pointerId: 11 })
  fireEvent.pointerMove(window, { clientX: 18, clientY: 590, pointerId: 11 })
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 11 })
  fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 11 })

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

async function openExplorerFromConnection(connectionName = 'PostgreSQL connection') {
  fireEvent.contextMenu(getConnectionRow(connectionName))
  fireEvent.click(
    await screen.findByRole('menuitem', {
      name: `Open Explorer for ${connectionName}`,
    }),
  )
}

async function createCatalogMongoWithBuilderTab() {
  await createFirstConnection()

  const mongoDrawer = await openConnectionDraft()
  fireEvent.change(within(mongoDrawer).getByLabelText('Name'), {
    target: { value: 'Catalog Mongo' },
  })
  chooseDatabaseType(mongoDrawer, 'MongoDB')
  setConnectionDatabase(mongoDrawer, 'catalog')
  fireEvent.click(within(mongoDrawer).getByRole('button', { name: 'Save Connection' }))

  await waitFor(() => {
    expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
  })

  let mongoTree = await expandConnectionObjects('Catalog Mongo')
  await waitFor(() => {
    expect(within(getConnectionObjectTree('Catalog Mongo')).getByText('catalog')).toBeInTheDocument()
  })
  await waitFor(() => {
    expect(
      within(getConnectionObjectTree('Catalog Mongo')).queryByText('Loading live metadata...'),
    ).not.toBeInTheDocument()
  })
  mongoTree = getConnectionObjectTree('Catalog Mongo')
  expandObjectTreeItem(mongoTree, 'catalog')
  await waitFor(() => {
    expect(
      within(getConnectionObjectTree('Catalog Mongo')).getByLabelText('Expand Collections'),
    ).toBeInTheDocument()
  })
  mongoTree = getConnectionObjectTree('Catalog Mongo')
  expandObjectTreeItem(mongoTree, 'Collections')
  await waitFor(() => {
    expect(within(mongoTree).getByRole('treeitem', { name: /products/i })).toBeInTheDocument()
  })

  const productsCollection = within(mongoTree).getByRole('treeitem', { name: /products/i })
  fireEvent.dblClick(productsCollection)

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: /products\.find/i })).toBeInTheDocument()
  })
}

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders a blank desktop workbench with first-run onboarding', async () => {
    render(<App />)

    expect(await screen.findByLabelText('library sidebar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Activity bar')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Bottom panel')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Status bar')).toBeInTheDocument()
    expect(screen.getByLabelText('First run onboarding')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Library' })).not.toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'Library tree' })).toBeInTheDocument()
    expect(screen.queryByText('Queries')).not.toBeInTheDocument()
    expect(screen.queryByText('Tests')).not.toBeInTheDocument()
    expect(screen.getByText('Start your workspace')).toBeInTheDocument()
    expect(screen.getByText(/add your first datastore connection/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Folder' })).toBeInTheDocument()
    expect(screen.queryByText('Analytics Postgres')).not.toBeInTheDocument()
    expect(screen.queryByText('Ops dashboard')).not.toBeInTheDocument()
  })

  it('keeps icon controls accessible and disables tab-only actions until a connection exists', async () => {
    render(<App />)

    expect(await screen.findByLabelText('library sidebar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Activity bar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Library view')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Connections view')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Environments view')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tests view')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Explorer view')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Connection' })).toBeInTheDocument()
    expect(screen.getByLabelText('New datastore connection')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create query tab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run query' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel query' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explain query' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Toggle theme')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Open settings')).toBeInTheDocument()
    expect(screen.queryByLabelText('Save current query to library')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Lock workspace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Unlock workspace')).not.toBeInTheDocument()

    await createFirstConnection()

    expect(screen.getByRole('button', { name: 'Run query' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel query' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain query' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show results panel')).toBeInTheDocument()
  })

  it('keeps new connections as drafts until they are saved', async () => {
    render(<App />)

    const drawer = await openConnectionDraft()

    expect(within(drawer).getByLabelText('Name')).toHaveValue('PostgreSQL connection')
    fireEvent.click(within(drawer).getByLabelText('Database type'))
    const mongoOption = within(drawer).getByRole('option', { name: 'MongoDB' })
    expect(mongoOption.querySelector('.datastore-icon')).not.toBeNull()
    fireEvent.click(within(drawer).getByLabelText('Database type'))
    expect(
      within(screen.getByLabelText('library sidebar')).queryByText('PostgreSQL connection'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Query 1/i })).not.toBeInTheDocument()

    fireEvent.click(within(drawer).getByLabelText('Close drawer'))

    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })
    expect(
      within(screen.getByLabelText('library sidebar')).queryByText('PostgreSQL connection'),
    ).not.toBeInTheDocument()
  })

  it('saves a connection draft without creating default Library folders', async () => {
    render(<App />)

    await createFirstConnection()
    const drawer = await openConnectionDraft()

    fireEvent.change(within(drawer).getByLabelText('Name'), {
      target: { value: 'Folder PostgreSQL' },
    })
    await saveConnectionDraft(drawer, { createQueryTab: false })

    const librarySidebar = screen.getByLabelText('library sidebar')
    expect(within(librarySidebar).queryByText('Queries')).not.toBeInTheDocument()
    expect(within(librarySidebar).getByText('Folder PostgreSQL')).toBeInTheDocument()
    expect(screen.queryByText('Library item was not found.')).not.toBeInTheDocument()
  })

  it('shows connection test failures inside the unsaved connection drawer', async () => {
    render(<App />)

    const drawer = await openConnectionDraft()
    chooseDatabaseType(drawer, 'MongoDB')
    fireEvent.change(within(drawer).getByLabelText('Password / Secret'), {
      target: { value: 'datapadplusplus' },
    })
    const testConnectionSpy = vi.spyOn(desktopClient, 'testConnection').mockRejectedValueOnce(
      new Error('connection refused'),
    )

    fireEvent.click(within(drawer).getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(within(drawer).getByText('Connection issue')).toBeInTheDocument()
    })
    expect(within(drawer).getByText(/connection refused/i)).toBeInTheDocument()
    expect(
      within(drawer).getByText(
        'DataPad++ Docker fixtures expose MongoDB on localhost:27018.',
      ),
    ).toBeInTheDocument()
    expect(testConnectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'datapadplusplus' }),
    )
    expect(
      within(screen.getByLabelText('library sidebar')).queryByText('MongoDB connection'),
    ).not.toBeInTheDocument()
  })

  it('lets connection-string capable datastores switch connection methods', async () => {
    const testConnectionSpy = vi.spyOn(desktopClient, 'testConnection').mockResolvedValueOnce({
      ok: true,
      engine: 'postgresql',
      message: 'Connection string accepted.',
      warnings: [],
      resolvedHost: '',
      resolvedDatabase: undefined,
      durationMs: 1,
    })
    render(<App />)

    const drawer = await openConnectionDraft()
    const methods = within(drawer).getByRole('tablist', { name: 'Connection methods' })

    expect(within(methods).getByRole('tab', { name: /Fields/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(methods).getByRole('tab', { name: /Connection String/i })).toBeInTheDocument()

    fireEvent.click(within(methods).getByRole('tab', { name: /Connection String/i }))

    expect(within(drawer).getByLabelText('Connection string')).toBeInTheDocument()
    expect(within(drawer).queryByLabelText('Server')).not.toBeInTheDocument()

    fireEvent.change(within(drawer).getByLabelText('Connection string'), {
      target: {
        value:
          'postgresql://datapadplusplus:${DB_PASSWORD}@localhost:54329/datapadplusplus',
      },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(testConnectionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            connectionMode: 'connection-string',
            connectionString:
              'postgresql://datapadplusplus:${DB_PASSWORD}@localhost:54329/datapadplusplus',
            host: '',
            port: undefined,
          }),
        }),
      )
    })
  })

  it('shows local-file and cloud-specific connection method tabs where supported', async () => {
    render(<App />)

    const drawer = await openConnectionDraft()
    chooseDatabaseType(drawer, 'SQLite')

    let methods = within(drawer).getByRole('tablist', { name: 'Connection methods' })
    expect(within(methods).getByRole('tab', { name: /Local File/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(methods).getByRole('tab', { name: /Connection String/i })).toBeInTheDocument()

    fireEvent.click(within(methods).getByRole('tab', { name: /Connection String/i }))
    expect(within(drawer).getByLabelText('Connection string')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Open Existing' })).not.toBeInTheDocument()

    chooseDatabaseType(drawer, 'DynamoDB')
    methods = within(drawer).getByRole('tablist', { name: 'Connection methods' })
    expect(within(methods).getByRole('tab', { name: /Cloud IAM/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(methods).getByRole('tab', { name: /Cloud SDK/i })).toBeInTheDocument()
    expect(within(methods).queryByRole('tab', { name: /Fields/i })).not.toBeInTheDocument()

    fireEvent.click(within(methods).getByRole('tab', { name: /Cloud SDK/i }))
    expect(within(drawer).getByLabelText('SDK endpoint / host')).toBeInTheDocument()
    expect(within(drawer).getByLabelText('SDK profile / principal')).toBeInTheDocument()
  })

  it('opens diagnostics from the status bar without losing the active editor tab', async () => {
    render(<App />)

    await createFirstConnection()

    await openExplorerFromConnection()

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /Explorer - PostgreSQL connection/i }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'PostgreSQL connection' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Visual database structure' })).toBeInTheDocument()

    expect(screen.queryByLabelText('Activity bar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Open settings'))
    expect(await screen.findByLabelText('settings drawer')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Close drawer'))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Explorer - PostgreSQL connection/i })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
  })

  it('opens Explorer from a connection context menu', async () => {
    render(<App />)

    await createFirstConnection()

    fireEvent.contextMenu(getConnectionRow('PostgreSQL connection'))

    const menu = await screen.findByRole('menu', {
      name: 'Connection options for PostgreSQL connection',
    })
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('New Query')
    expect(
      screen.queryByRole('button', {
        name: 'Delete connection PostgreSQL connection',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', {
        name: 'Open Explorer for PostgreSQL connection',
      }),
    ).toBeInTheDocument()

    fireEvent.click(
      within(menu).getByRole('menuitem', {
        name: 'Open Explorer for PostgreSQL connection',
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /Explorer - PostgreSQL connection/i }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('region', { name: 'Visual database structure' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', {
        name: 'Save tab Explorer - PostgreSQL connection',
      }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('PostgreSQL connection').length).toBeGreaterThan(0)
  })

  it('opens Explorer when a connection row is double-clicked', async () => {
    render(<App />)

    await createFirstConnection()

    fireEvent.doubleClick(getConnectionRow('PostgreSQL connection'))

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /Explorer - PostgreSQL connection/i }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('region', { name: 'Visual database structure' })).toBeInTheDocument()
  })

  it('inspects Explorer objects in the bottom Details panel without opening the right drawer', async () => {
    render(<App />)

    await createFirstConnection()
    await openExplorerFromConnection()

    const inspectButton = await screen.findByRole('button', { name: 'Inspect accounts' })

    fireEvent.click(inspectButton)

    await waitFor(() => {
      expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'details' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(
        screen.getByText('Inspection ready for public.accounts on PostgreSQL connection.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('inspection drawer')).not.toBeInTheDocument()
  })

  it('treats empty Explorer metadata as loaded instead of reloading forever', async () => {
    const loadStructureSpy = vi
      .spyOn(desktopClient, 'loadStructureMap')
      .mockImplementation(async (request) => ({
        connectionId: request.connectionId,
        environmentId: request.environmentId,
        engine: 'postgresql',
        summary: 'Loaded 0 structure node(s).',
        groups: [],
        nodes: [],
        edges: [],
        metrics: [],
      }))

    render(<App />)

    await createFirstConnection()
    await openExplorerFromConnection()

    await waitFor(() => {
      expect(screen.getByText('No structure objects found')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText('Loading structure...')).not.toBeInTheDocument()
      expect(loadStructureSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('opens the connection drawer for editing from a connection context menu', async () => {
    render(<App />)

    await createFirstConnection()

    fireEvent.contextMenu(getConnectionRow('PostgreSQL connection'))

    const menu = await screen.findByRole('menu', {
      name: 'Connection options for PostgreSQL connection',
    })
    fireEvent.click(
      within(menu).getByRole('menuitem', {
        name: 'Edit connection PostgreSQL connection',
      }),
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Connection' })).toBeInTheDocument()
    })
    expect(
      within(screen.getByLabelText('connection drawer')).getByRole('button', {
        name: 'Save Connection',
      }),
    ).toBeInTheDocument()
  })

  it('creates a query from the connection context menu without opening connection details', async () => {
    render(<App />)

    await createFirstConnection()
    fireEvent.click(screen.getByRole('button', { name: 'Change connection' }))

    await waitFor(() => {
      expect(screen.getByLabelText('connection drawer')).toBeInTheDocument()
    })

    fireEvent.contextMenu(getConnectionRow('PostgreSQL connection'))
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'New Query for PostgreSQL connection',
      }),
    )

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Query 2/i })).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    expect(
      within(screen.getByLabelText('library sidebar')).queryByText(
        'Copy of PostgreSQL connection',
      ),
    ).not.toBeInTheDocument()
  })

  it('does not show the old scratch-query button in the editor tab strip', async () => {
    render(<App />)

    await createFirstConnection()

    expect(screen.queryByRole('button', { name: 'Create query tab' })).not.toBeInTheDocument()
  })

  it('does not expose dead operations from the connection context menu', async () => {
    render(<App />)

    await createFirstConnection()

    fireEvent.contextMenu(getConnectionRow('PostgreSQL connection'))

    const menu = await screen.findByRole('menu', {
      name: 'Connection options for PostgreSQL connection',
    })
    expect(within(menu).queryByText('Operations')).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', {
        name: 'Open operations for PostgreSQL connection',
      }),
    ).not.toBeInTheDocument()
  })

  it('does not create a new query tab when selecting a connection that has no active tab', async () => {
    render(<App />)

    await createFirstConnection()

    fireEvent.click(
      screen.getByRole('button', {
        name: /Close tab Query 1/i,
      }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('tab', { name: /Query 1/i }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(within(getConnectionRow('PostgreSQL connection')).getByText('PostgreSQL connection'))

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Query 1/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'New query tab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create query tab' })).not.toBeInTheDocument()
  })

  it('opens the connection drawer for editing from the toolbar', async () => {
    render(<App />)

    await createFirstConnection()
    fireEvent.click(screen.getByRole('button', { name: 'Change connection' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Connection' })).toBeInTheDocument()
    })

    const drawer = screen.getByRole('button', { name: 'Save Connection' }).closest('aside')
    expect(drawer).not.toBeNull()
    expect(within(drawer!).getByRole('button', { name: 'Save Connection' })).toBeInTheDocument()
    expect(within(drawer!).getByLabelText('Environment')).toBeInTheDocument()
    expect(within(drawer!).getByLabelText('Database type')).toBeInTheDocument()
    expect(within(drawer!).getByText('Connection options')).toBeInTheDocument()
    expect(within(drawer!).getByRole('button', { name: 'Favorite' })).toBeInTheDocument()
    expect(within(drawer!).getByRole('button', { name: 'Read-only' })).toBeInTheDocument()
    expect(within(drawer!).queryByText('Variables')).not.toBeInTheDocument()
    expect(within(drawer!).queryByText('No environment selected')).not.toBeInTheDocument()
    expect(within(drawer!).queryByRole('button', { name: 'Save Environment' })).not.toBeInTheDocument()

    fireEvent.click(within(drawer!).getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })
  })

  it('filters the unified Library and keeps environments visible beside saved work', async () => {
    render(<App />)

    await createFirstConnection()
    const sidebar = screen.getByLabelText('library sidebar')
    const searchInput = within(sidebar).getByPlaceholderText('Search')

    expect(within(sidebar).getByText('PostgreSQL connection')).toBeInTheDocument()
    expect(
      within(sidebar).getByRole('button', { name: 'Collapse Environments section (1)' }),
    ).toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: 'postgres' } })
    await waitFor(() => {
      expect(within(sidebar).getByText('PostgreSQL connection')).toBeInTheDocument()
      expect(within(sidebar).queryByText('Scripts')).not.toBeInTheDocument()
    })
  })

  it('opens an environment tab when an environment is selected', async () => {
    render(<App />)

    await createFirstConnection()
    const sidebar = screen.getByLabelText('library sidebar')

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Open environment Local' }))

    const workspace = await screen.findByLabelText('Environment workspace')
    expect(screen.getByRole('tab', { name: /Environment - Local/ })).toBeInTheDocument()
    expect(within(workspace).getByRole('heading', { level: 1, name: 'Local' })).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Open environment Local' }))

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /Environment - Local/ })).toHaveLength(1)
    })
  })

  it('collapses Library side-panel sections and persists the section state', async () => {
    render(<App />)

    await createFirstConnection()
    const updateUiStateSpy = vi.spyOn(desktopClient, 'updateUiState')
    const sidebar = screen.getByLabelText('library sidebar')
    const environmentsSection = within(sidebar).getByRole('button', {
      name: 'Collapse Environments section (1)',
    })

    expect(environmentsSection).toHaveAttribute('aria-expanded', 'true')
    expect(within(sidebar).getByText('Local')).toBeInTheDocument()

    fireEvent.click(environmentsSection)

    await waitFor(() => {
      expect(updateUiStateSpy).toHaveBeenCalledWith({
        sidebarSectionStates: {
          'library:environments': false,
        },
      })
    })
    await waitFor(() => {
      expect(within(sidebar).queryByText('Local')).not.toBeInTheDocument()
    })
    expect(
      within(sidebar).getByRole('button', { name: 'Expand Environments section (1)' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders datastore-specific object trees under connections', async () => {
    render(<App />)

    await createFirstConnection()

    const sqlTree = await expandConnectionObjects('PostgreSQL connection')
    expect(
      getConnectionRow('PostgreSQL connection').querySelector('.datastore-icon--brand'),
    ).not.toBeNull()

    expect(sqlTree).toBeInTheDocument()
    expect(within(sqlTree).getByText('User Schemas')).toBeInTheDocument()
    expect(within(sqlTree).queryByText('Tables')).not.toBeInTheDocument()

    fireEvent.click(within(sqlTree).getByLabelText('Expand User Schemas'))
    await waitFor(() => {
      expect(within(sqlTree).getByText('public')).toBeInTheDocument()
    })

    fireEvent.click(within(sqlTree).getByLabelText('Expand public'))

    await waitFor(() => {
      expect(within(sqlTree).getByText('Tables')).toBeInTheDocument()
    })

    expect(within(sqlTree).queryByText('accounts')).not.toBeInTheDocument()
    fireEvent.click(within(sqlTree).getByLabelText('Expand Tables'))

    await waitFor(() => {
      expect(within(sqlTree).getByText('accounts')).toBeInTheDocument()
      expect(within(sqlTree).getByText('transactions')).toBeInTheDocument()
    })

    fireEvent.click(within(sqlTree).getByLabelText('Collapse Tables'))
    expect(within(sqlTree).queryByText('accounts')).not.toBeInTheDocument()

    const mongoDrawer = await openConnectionDraft()
    fireEvent.change(within(mongoDrawer).getByLabelText('Name'), {
      target: { value: 'Catalog Mongo' },
    })
    chooseDatabaseType(mongoDrawer, 'MongoDB')
    setConnectionDatabase(mongoDrawer, 'catalog')
    fireEvent.click(within(mongoDrawer).getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })

    let mongoTree = await expandConnectionObjects('Catalog Mongo')
    expect(mongoTree).toBeInTheDocument()
    await waitFor(() => {
      expect(within(getConnectionObjectTree('Catalog Mongo')).getByText('catalog')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(
        within(getConnectionObjectTree('Catalog Mongo')).queryByText('Loading live metadata...'),
      ).not.toBeInTheDocument()
    })
    mongoTree = getConnectionObjectTree('Catalog Mongo')
    expandObjectTreeItem(mongoTree, 'catalog')
    await waitFor(() => {
      expect(
        within(getConnectionObjectTree('Catalog Mongo')).getByLabelText('Expand Collections'),
      ).toBeInTheDocument()
    })
    mongoTree = getConnectionObjectTree('Catalog Mongo')
    expandObjectTreeItem(mongoTree, 'Collections')

    await waitFor(() => {
      expect(within(mongoTree).getByText('products')).toBeInTheDocument()
      expect(within(mongoTree).getByText('orders')).toBeInTheDocument()
    })
    expect(within(mongoTree).getByText('Collections')).toBeInTheDocument()
    expect(within(mongoTree).queryByText('Sample documents')).not.toBeInTheDocument()
  })

  it('edits environments separately with color picking and secret variables', async () => {
    render(<App />)

    await createFirstConnection()
    const sidebar = screen.getByLabelText('library sidebar')
    expect(
      within(sidebar).getByRole('button', { name: 'Environment actions for Local' }),
    ).toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Environment actions for Local' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit environment Local' }))

    const workspace = await screen.findByLabelText('Environment workspace')
    expect(screen.getByRole('tab', { name: /Environment - Local/ })).toBeInTheDocument()
    expect(within(workspace).getByRole('heading', { level: 1, name: 'Local' })).toBeInTheDocument()
    expect(within(workspace).queryByRole('button', { name: 'New Environment' })).not.toBeInTheDocument()
    expect(within(workspace).getByRole('button', { name: 'Clone' })).toBeInTheDocument()
    expect(within(workspace).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    fireEvent.change(within(workspace).getByLabelText('Environment color'), {
      target: { value: '#ff8800' },
    })
    expect(within(workspace).getByLabelText('Environment color')).toHaveValue('#ff8800')
    expect(within(workspace).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Environment - Local/ })).toHaveTextContent('Environment - Local')

    fireEvent.change(within(workspace).getByLabelText('New variable key'), {
      target: { value: 'API_TOKEN' },
    })
    fireEvent.change(within(workspace).getByLabelText('New variable value'), {
      target: { value: 'token-value' },
    })
    fireEvent.click(within(workspace).getByRole('button', { name: 'Mark new variable as secret' }))
    fireEvent.click(within(workspace).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(
        within(workspace).getByLabelText('Environment variable value API_TOKEN'),
      ).toHaveValue('token-value')
    })
    expect(within(workspace).getAllByText('********').length).toBeGreaterThan(0)

    fireEvent.click(within(workspace).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Environment workspace')).getByLabelText(
          'Environment variable value API_TOKEN',
        ),
      ).toHaveValue('token-value')
    })
    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Environment workspace')).queryByRole('button', {
          name: 'Save',
        }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(
      within(screen.getByLabelText('Environment workspace')).getByRole('button', {
        name: 'Clone',
      }),
    )

    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Environment workspace')).getByRole('heading', {
          level: 1,
          name: 'Copy of Local',
        }),
      ).toBeInTheDocument()
    })
    expect(
      within(screen.getByLabelText('library sidebar')).getByText('Copy of Local'),
    ).toBeInTheDocument()
  })

  it('shows SQLite local database actions and creates a starter database path', async () => {
    const createLocalDatabaseSpy = vi.spyOn(desktopClient, 'createLocalDatabase')
    render(<App />)

    const drawer = await openConnectionDraft()
    chooseDatabaseType(drawer, 'SQLite')

    await waitFor(() => {
      expect(within(drawer).getByRole('button', { name: 'Open Existing' })).toBeInTheDocument()
    })
    expect(within(drawer).getByRole('button', { name: 'Create New' })).toBeInTheDocument()
    expect(within(drawer).queryByLabelText('Server')).not.toBeInTheDocument()
    expect(within(drawer).queryByLabelText('Password / Secret')).not.toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Create New' }))

    await waitFor(() => {
      expect(within(drawer).getByRole('dialog', { name: 'Create SQLite database' })).toBeInTheDocument()
    })

    expect(within(drawer).getByLabelText('Folder')).toHaveValue('C:\\Users\\gmont\\DataPad++')
    fireEvent.change(within(drawer).getByLabelText('Database name'), {
      target: { value: 'starter-catalog' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Starter schema' }))

    await waitFor(() => {
      expect(createLocalDatabaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: 'sqlite',
          mode: 'starter',
          path: 'C:\\Users\\gmont\\DataPad++\\starter-catalog.sqlite',
        }),
      )
    })
    await waitFor(() => {
      expect(
        (within(drawer).getByLabelText('Database file') as HTMLInputElement).value,
      ).toContain('starter-catalog.sqlite')
    })

    fireEvent.click(within(drawer).getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Editor toolbar')).not.toBeInTheDocument()
  })

  it('offers local database creation for LiteDB and DuckDB manifests', async () => {
    render(<App />)

    const drawer = await openConnectionDraft()
    chooseDatabaseType(drawer, 'LiteDB')

    await waitFor(() => {
      expect(within(drawer).getByRole('button', { name: 'Open Existing' })).toBeInTheDocument()
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create New' }))

    await waitFor(() => {
      expect(within(drawer).getByRole('dialog', { name: 'Create LiteDB database' })).toBeInTheDocument()
    })
    expect(within(drawer).getByRole('button', { name: 'Empty database' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Starter schema' })).not.toBeInTheDocument()

    chooseDatabaseType(drawer, 'DuckDB')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create New' }))

    await waitFor(() => {
      expect(within(drawer).getByRole('dialog', { name: 'Create DuckDB database' })).toBeInTheDocument()
    })
    expect(within(drawer).getByRole('button', { name: 'Starter schema' })).toBeInTheDocument()
  })

  it('persists keyboard resizing for sidebar, right drawer, and bottom panel', async () => {
    render(<App />)

    await createFirstConnection()
    const workbench = document.querySelector('.ads-workbench') as HTMLElement

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sidebar' }), { key: 'ArrowRight' })
    await waitFor(() => {
      expect(workbench.style.getPropertyValue('--sidebar-width')).toBe('296px')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Change connection' }))

    await waitFor(() => {
      expect(screen.getByLabelText('connection drawer')).toBeInTheDocument()
    })

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize right drawer' }), { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(workbench.style.getPropertyValue('--drawer-width')).toBe('376px')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))
    const bottomPanel = await screen.findByLabelText('Bottom panel')
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize bottom panel' }), { key: 'ArrowUp' })

    await waitFor(() => {
      expect(bottomPanel).toHaveStyle({ height: '284px' })
    })
  })

  it('creates, stores a secret for, duplicates, and deletes connections', async () => {
    const storeSecretSpy = vi.spyOn(desktopClient, 'storeSecret')
    render(<App />)

    const drawer = await openConnectionDraft()

    fireEvent.change(within(drawer).getByLabelText('Password / Secret'), {
      target: { value: 'local-secret' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(storeSecretSpy).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })

    expect(
      screen.queryByRole('button', { name: 'Duplicate connection PostgreSQL connection' }),
    ).not.toBeInTheDocument()

    fireEvent.contextMenu(getConnectionRow('PostgreSQL connection'))
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'Duplicate connection PostgreSQL connection',
      }),
    )

    await waitFor(() => {
      expect(
        within(screen.getByLabelText('connection drawer')).getByLabelText('Name'),
      ).toHaveValue('Copy of PostgreSQL connection')
    })

    fireEvent.contextMenu(getConnectionRow('Copy of PostgreSQL connection'))
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'Delete connection Copy of PostgreSQL connection',
      }),
    )

    const deleteDialog = await screen.findByRole('dialog', {
      name: 'Remove Copy of PostgreSQL connection?',
    })
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete Connection' }))

    await waitFor(() => {
      expect(
        within(screen.getByLabelText('library sidebar')).queryByText(
          'Copy of PostgreSQL connection',
        ),
      ).not.toBeInTheDocument()
    })
  })

  it('does not render the removed search command palette entry points', async () => {
    render(<App />)

    await screen.findByLabelText('library sidebar')
    expect(screen.queryByLabelText('Search view')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('keeps the Library sidebar available without the old activity rail', async () => {
    render(<App />)

    await screen.findByLabelText('library sidebar')
    const workbench = document.querySelector('.ads-workbench')
    expect(workbench).not.toHaveClass('is-sidebar-collapsed')
    expect(screen.queryByLabelText('Activity bar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Library' }))

    await waitFor(() => {
      expect(workbench).toHaveClass('is-sidebar-collapsed')
    })
    expect(screen.getByLabelText('Collapsed Library')).toContainElement(
      screen.getByRole('button', { name: 'Show Library' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Library' }))

    await waitFor(() => {
      expect(workbench).not.toHaveClass('is-sidebar-collapsed')
    })
    expect(workbench).not.toHaveClass('is-sidebar-collapsed')
  })

  it('supports workbench keyboard shortcuts once a tab exists', async () => {
    const executeSpy = vi.spyOn(desktopClient, 'executeQuery')
    render(<App />)

    await createFirstConnection()

    const panelStartsVisible = Boolean(screen.queryByLabelText('Bottom panel'))

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    await waitFor(() => {
      if (panelStartsVisible) {
        expect(screen.queryByLabelText('Bottom panel')).not.toBeInTheDocument()
      } else {
        expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
      }
    })

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    await waitFor(() => {
      if (panelStartsVisible) {
        expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
      } else {
        expect(screen.queryByLabelText('Bottom panel')).not.toBeInTheDocument()
      }
    })

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.getByLabelText('library sidebar')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('3 rows returned from SQL adapter preview.')).toBeInTheDocument()
    })

    executeSpy.mockClear()
    const f5Event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'F5',
    })
    window.dispatchEvent(f5Event)

    expect(f5Event.defaultPrevented).toBe(true)
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalled()
    })
  })

  it('prevents the browser context menu so the workbench feels native', async () => {
    render(<App />)

    await screen.findByLabelText('library sidebar')

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(contextMenuEvent)

    expect(contextMenuEvent.defaultPrevented).toBe(true)
  })

  it('shows keyboard shortcut help in settings without a connection', async () => {
    render(<App />)

    await screen.findByLabelText('library sidebar')
    fireEvent.click(screen.getByLabelText('Open settings'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument()
    })
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.queryByText('Ctrl K')).not.toBeInTheDocument()
  })

  it('guides workspace backup and restore from Settings', async () => {
    render(<App />)

    await screen.findByLabelText('library sidebar')
    fireEvent.click(screen.getByLabelText('Open settings'))
    const drawer = await screen.findByLabelText('settings drawer')
    const createBackup = within(drawer).getByRole('button', {
      name: 'Create Backup Bundle',
    })

    expect(within(drawer).getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument()
    expect(createBackup).toBeDisabled()

    fireEvent.change(within(drawer).getByLabelText('Backup passphrase'), {
      target: { value: 'strong-backup-passphrase' },
    })
    expect(createBackup).toBeEnabled()
    fireEvent.click(createBackup)

    await waitFor(() => {
      expect(within(drawer).getByText('Backup bundle ready')).toBeInTheDocument()
    })
    const bundleText = within(drawer).getByText(/"format": "datapadplusplus-bundle"/).textContent
      ?? ''

    fireEvent.change(within(drawer).getByLabelText('Workspace bundle'), {
      target: { value: bundleText },
    })

    expect(within(drawer).getByText('Bundle format looks valid.')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Restore Workspace' })).toBeEnabled()
  })

  it('saves, opens, and deletes library query work from a real tab', async () => {
    render(<App />)

    await createFirstConnection()

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Library tree' })).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    const librarySidebar = screen.getByLabelText('library sidebar')
    await waitFor(() => {
      expect(within(librarySidebar).queryByText('Queries')).not.toBeInTheDocument()
      expect(within(librarySidebar).getByText('Query 1')).toBeInTheDocument()
    })

    fireEvent.click(within(librarySidebar).getByRole('button', { name: /^Query 1$/i }))

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /Query 1/i })).toHaveLength(1)
    })

    fireEvent.click(
      within(librarySidebar).getByRole('button', { name: 'Open actions for Query 1' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Query 1' }))

    const deleteDialog = await screen.findByRole('dialog', {
      name: 'Delete Query 1?',
    })
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete Query' }))

    await waitFor(() => {
      expect(
        within(librarySidebar).queryByRole('button', { name: /^Query 1$/i }),
      ).not.toBeInTheDocument()
    })
  })

  it('renames query tabs and saves the renamed title into the library', async () => {
    render(<App />)

    await createFirstConnection()
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Query 1/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename tab Query 1/i }))

    const titleInput = screen.getByLabelText(/Rename tab Query 1/i)
    fireEvent.change(titleInput, { target: { value: 'Customer lookup' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Customer lookup/i })).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByRole('tab', { name: /Customer lookup/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Save tab Customer lookup/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Customer lookup')).toBeInTheDocument()
    })
  })

  it('opens the save flow with Ctrl+S for the active query tab', async () => {
    render(<App />)

    await createFirstConnection()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /Save Query 1/i }),
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Local File' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Environment override/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Type/i)).not.toBeInTheDocument()
  })

  it('keeps query tab headers clean, scrollable, and reorderable', async () => {
    render(<App />)

    await createFirstConnection()
    const tablist = screen.getByRole('tablist', { name: 'Editor tabs' })

    expect(screen.getByRole('button', { name: 'Scroll tabs left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scroll tabs right' })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: /Query 1/i })).toBeInTheDocument()
    expect(within(tablist).queryByText('Local')).not.toBeInTheDocument()

    await openNewQueryFromConnection('PostgreSQL connection', /Query 2/i)

    fireEvent.contextMenu(within(tablist).getByRole('tab', { name: /Query 1/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Move tab Query 1.* right/i }))

    await waitFor(() => {
      expect(getEditorTabNames()[0]).toContain('Query 2')
    })
  })

  it('supports VS Code-style tab close actions from the context menu', async () => {
    render(<App />)

    await createFirstConnection()
    await openNewQueryFromConnection('PostgreSQL connection', /Query 2/i)
    await openNewQueryFromConnection('PostgreSQL connection', /Query 3/i)

    const tablist = screen.getByRole('tablist', { name: 'Editor tabs' })

    await waitFor(() => {
      expect(within(tablist).getAllByRole('tab')).toHaveLength(3)
    })

    fireEvent.contextMenu(within(tablist).getByRole('tab', { name: /Query 1/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Close other tabs except Query 1/i }),
    )

    await waitFor(() => {
      expect(within(tablist).getAllByRole('tab')).toHaveLength(1)
    })
    expect(within(tablist).getByRole('tab', { name: /Query 1/i })).toBeInTheDocument()

    fireEvent.contextMenu(within(tablist).getByRole('tab', { name: /Query 1/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))

    await waitFor(() => {
      expect(within(tablist).queryByRole('tab')).not.toBeInTheDocument()
    })
  })

  it('closes ephemeral tabs and keeps a recoverable closed-tab history', async () => {
    render(<App />)

    await createFirstConnection()
    fireEvent.click(
      screen.getByRole('button', {
        name: /Close tab Query 1/i,
      }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('tab', { name: /Query 1/i }),
      ).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('Recents')).toBeInTheDocument()
    })
    const expandClosedTabs = screen.queryByRole('button', {
      name: /Expand Recents section/i,
    })
    if (expandClosedTabs) {
      fireEvent.click(expandClosedTabs)
    }

    fireEvent.click(
      await screen.findByRole('button', {
        name: /Reopen closed tab Query 1/i,
      }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /Query 1/i }),
      ).toBeInTheDocument()
    })
  })

  it('asks before closing a dirty library query tab', async () => {
    const { container } = render(<App />)

    await createFirstConnection()

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Library tree' })).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    const librarySidebar = screen.getByLabelText('library sidebar')
    await waitFor(() => {
      expect(within(librarySidebar).queryByText('Queries')).not.toBeInTheDocument()
      expect(within(librarySidebar).getByText('Query 1')).toBeInTheDocument()
    })

    fireEvent.click(within(librarySidebar).getByRole('button', { name: /^Query 1$/i }))

    await waitFor(() => {
      expect(
        screen.getAllByRole('tab', { name: /Query 1/i }),
      ).toHaveLength(1)
    })

    const editor = await screen.findByLabelText('Query editor')
    fireEvent.change(editor, { target: { value: 'select 2;' } })

    await waitFor(() => {
      expect(container.querySelectorAll('.editor-tab-dirty').length).toBeGreaterThan(0)
    })

    const closeButtons = screen.getAllByRole('button', {
      name: /Close tab Query 1/i,
    })
    const dirtySavedCloseButton = closeButtons.at(-1)

    if (!dirtySavedCloseButton) {
      throw new Error('Expected a close button for the dirty saved tab.')
    }

    fireEvent.click(dirtySavedCloseButton)

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Save changes before closing?' }),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Save changes before closing?' }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(
      screen.getAllByRole('button', {
        name: /Close tab Query 1/i,
      }).at(-1)!,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save and Close' }))

    await waitFor(() => {
      expect(screen.getByText('Recents')).toBeInTheDocument()
    })
  })

  it('does not expose workspace locking in the workbench shell', async () => {
    render(<App />)

    await createFirstConnection()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run query' })).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Lock workspace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Unlock workspace')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock Workspace' })).not.toBeInTheDocument()
  })

  it('shows raw editor controls only for non-builder tabs', async () => {
    render(<App />)

    await createFirstConnection()

    expect(screen.queryByRole('button', { name: 'Show builder and raw' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Query Builder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Raw' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scripting' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Query editor')).toBeInTheDocument()
  })

  it('shows builder controls for MongoDB scratch query tabs', async () => {
    render(<App />)

    await createFirstConnection()

    const mongoDrawer = await openConnectionDraft()
    fireEvent.change(within(mongoDrawer).getByLabelText('Name'), {
      target: { value: 'Catalog Mongo' },
    })
    chooseDatabaseType(mongoDrawer, 'MongoDB')
    fireEvent.click(within(mongoDrawer).getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
    })

    fireEvent.contextMenu(getConnectionRow('Catalog Mongo'))
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'New Query for Catalog Mongo',
      }),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Query Builder' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Show builder and raw' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Query Builder' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scripting' })).toBeInTheDocument()
    expect(screen.getByLabelText('MongoDB query builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Query editor')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('connection drawer')).not.toBeInTheDocument()
  })

  it('starts builder queries in builder mode and toggles builder/raw/script panels', async () => {
    render(<App />)

    await createCatalogMongoWithBuilderTab()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Query Builder' }),
      ).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Show builder and raw' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scripting' })).toBeInTheDocument()

    expect(screen.getByLabelText('MongoDB query builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Query editor')).not.toBeInTheDocument()
    expect(screen.getByLabelText('MongoDB query scope')).toHaveTextContent('Databasecatalog')
    expect(screen.getByLabelText('MongoDB query scope')).toHaveTextContent('Collectionproducts')

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(screen.queryByLabelText('MongoDB query builder')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Query editor')).toBeInTheDocument()
    expect(screen.getByLabelText('MongoDB query scope')).toHaveTextContent('Databasecatalog')
    expect(screen.getByLabelText('MongoDB query scope')).toHaveTextContent('Collectionproducts')

    fireEvent.click(screen.getByRole('button', { name: 'Scripting' }))
    expect(screen.queryByLabelText('MongoDB query builder')).not.toBeInTheDocument()
    expect(screen.getByLabelText('MongoDB script editor')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Query Builder' }))
    expect(screen.getByLabelText('MongoDB query builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Query editor')).not.toBeInTheDocument()
  })

  it('opens scoped SQL queries with builder and raw modes', async () => {
    render(<App />)

    await createFirstConnection()

    const sqlTree = await expandConnectionObjects('PostgreSQL connection')
    fireEvent.click(within(sqlTree).getByLabelText('Expand User Schemas'))
    await waitFor(() => {
      expect(within(sqlTree).getByText('public')).toBeInTheDocument()
    })
    fireEvent.click(within(sqlTree).getByLabelText('Expand public'))
    await waitFor(() => {
      expect(within(sqlTree).getByText('Tables')).toBeInTheDocument()
    })
    fireEvent.click(within(sqlTree).getByLabelText('Expand Tables'))
    await waitFor(() => {
      expect(within(sqlTree).getByRole('treeitem', { name: /accounts/i })).toBeInTheDocument()
    })
    fireEvent.dblClick(within(sqlTree).getByRole('treeitem', { name: /accounts/i }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /accounts/i })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Show builder and raw' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Query Builder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scripting' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raw' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('region', { name: 'SQL SELECT builder' })).not.toBeInTheDocument()

    expect(screen.getByLabelText('Query editor')).toHaveValue(
      'select * from public.accounts limit 100;',
    )
  })

  it('applies generated Mongo builder query before execution', async () => {
    const updateBuilderSpy = vi.spyOn(desktopClient, 'updateQueryBuilderState')
    const executeSpy = vi.spyOn(desktopClient, 'executeQuery')

    render(<App />)

    await createCatalogMongoWithBuilderTab()

    const builder = screen.getByLabelText('MongoDB query builder')
    const addFilterButton = within(builder).getAllByRole('button', { name: 'Add Filter' })[0] as HTMLElement

    fireEvent.click(addFilterButton)

    const filterField = within(builder).getByLabelText('Filter field')
    const filterOperator = within(builder).getByLabelText('Filter operator')
    const filterValue = within(builder).getByLabelText('Filter value')

    fireEvent.change(filterField, { target: { value: 'status' } })
    fireEvent.change(filterOperator, { target: { value: 'eq' } })
    fireEvent.change(filterValue, { target: { value: 'open' } })

    await waitFor(() => {
      const latestRequest = updateBuilderSpy.mock.calls.at(-1)?.[0]
      expect(latestRequest?.queryText).toContain('"status"')
      expect(latestRequest?.queryText).toContain('"open"')
    })
    updateBuilderSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    await waitFor(() => {
      const latestExecution = executeSpy.mock.calls.at(-1)?.[0]
      expect(latestExecution?.queryText).toContain('"status"')
      expect(latestExecution?.queryText).toContain('"open"')
    })
    expect(updateBuilderSpy).not.toHaveBeenCalled()
  })

  it('keeps the last result visible while editing a Mongo builder query', async () => {
    render(<App />)

    await createCatalogMongoWithBuilderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    await waitFor(() => {
      expect(screen.getByText('2 document(s) loaded')).toBeInTheDocument()
    })

    const builder = screen.getByLabelText('MongoDB query builder')
    fireEvent.click(within(builder).getAllByRole('button', { name: 'Add Filter' })[0] as HTMLElement)
    fireEvent.change(within(builder).getByLabelText('Filter field'), {
      target: { value: 'inventory.available' },
    })

    expect(screen.getByText('2 document(s) loaded')).toBeInTheDocument()
    expect(screen.getByRole('treegrid', { name: 'Document result table' })).toBeInTheDocument()
  })

  it('drops document result field values into the Mongo query builder', async () => {
    render(<App />)

    await createCatalogMongoWithBuilderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    await waitFor(() => {
      expect(screen.getByText('2 document(s) loaded')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand itm-2048' }))

    const source = screen.getByTitle('Drag sku with value luna-lamp to the query builder')
    const builder = screen.getByLabelText('MongoDB query builder')
    const filtersSection = within(builder)
      .getByRole('heading', { name: 'Filters' })
      .closest('section') as HTMLElement

    pointerDropFieldIntoBuilder(source, builder, filtersSection)

    expect(within(builder).getByLabelText('Filter field')).toHaveValue('sku')
    expect(within(builder).getByLabelText('Value type')).toHaveValue('string')
    expect(within(builder).getByLabelText('Filter value')).toHaveValue('luna-lamp')

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    await waitFor(() => {
      const queryEditor = screen.getByLabelText('Query editor') as HTMLTextAreaElement
      expect(queryEditor.value).toContain('"sku"')
      expect(queryEditor.value).toContain('"luna-lamp"')
    })
  })

  it('runs the raw editor text when query view is raw-only', async () => {
    const executeSpy = vi.spyOn(desktopClient, 'executeQuery')

    render(<App />)

    await createCatalogMongoWithBuilderTab()

    const rawQuery = '{ "collection": "accounts", "filter": { "status": "open" }, "limit": 10 }'

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('MongoDB query builder')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Raw' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    const rawEditor = screen.getByLabelText('Query editor')
    fireEvent.change(rawEditor, { target: { value: rawQuery } })
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    await waitFor(() => {
      const latestExecution = executeSpy.mock.calls.at(-1)?.[0]
      expect(latestExecution?.queryText).toBe(rawQuery)
    })
  })

  it('routes command failures into the Messages panel until cleared', async () => {
    vi.spyOn(desktopClient, 'setTheme').mockRejectedValueOnce(
      new Error('Theme switch exploded'),
    )

    render(<App />)

    await screen.findByLabelText('library sidebar')
    fireEvent.click(screen.getByLabelText('Open settings'))
    const drawer = await screen.findByLabelText('settings drawer')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Switch theme' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
    })
    expect(screen.getByText('Theme switch exploded')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Hide results panel'))
    await waitFor(() => {
      expect(screen.queryByLabelText('Bottom panel')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 workbench message' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear message Theme switch exploded' }),
    )
    await waitFor(() => {
      expect(screen.queryByText('Theme switch exploded')).not.toBeInTheDocument()
    })
    expect(screen.getByText('No messages.')).toBeInTheDocument()
  })

  it('can clear all workbench messages from the Messages panel', async () => {
    vi.spyOn(desktopClient, 'setTheme').mockRejectedValueOnce(
      new Error('Theme switch exploded'),
    )

    render(<App />)

    await screen.findByLabelText('library sidebar')
    fireEvent.click(screen.getByLabelText('Open settings'))
    const drawer = await screen.findByLabelText('settings drawer')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Switch theme' }))

    await waitFor(() => {
      expect(screen.getByText('Theme switch exploded')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear all workbench messages' }))

    await waitFor(() => {
      expect(screen.queryByText('Theme switch exploded')).not.toBeInTheDocument()
    })
  })

  it('switches bottom panel views and can hide the panel', async () => {
    render(<App />)

    await runPreviewQuery()
    fireEvent.click(screen.getByRole('tab', { name: 'messages' }))

    await waitFor(() => {
      expect(
        screen.getByText('Command errors, runtime notices, and query diagnostics.'),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Hide results panel'))
    await waitFor(() => {
      expect(screen.queryByLabelText('Bottom panel')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Show results panel'))
    await waitFor(() => {
      expect(screen.getByLabelText('Bottom panel')).toBeInTheDocument()
    })
  })

  it('copies, exports, and restores executed result history', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const createObjectUrl = vi.fn(() => 'blob:datapadplusplus-result')
    const revokeObjectUrl = vi.fn()
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    })

    render(<App />)

    await runPreviewQuery()
    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('table_name'))
    })
    expect(screen.getByText(/Result copied to clipboard\./)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export result' }))

    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalled()
    })
    expect(anchorClick).toHaveBeenCalled()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:datapadplusplus-result')
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}\.\d{3}/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Query editor'), {
      target: { value: 'select 2;' },
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Query editor')).toHaveValue('select 2;')
    })

    fireEvent.click(screen.getByRole('tab', { name: 'history' }))

    await waitFor(() => {
      expect(screen.getByText('Query History')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Restore history query success/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('Query editor')).toHaveValue('select 1;')
    })
  })

  it('keeps explorer load failures local to the explorer pane', async () => {
    vi.spyOn(desktopClient, 'loadStructureMap').mockRejectedValueOnce(
      new Error('Explorer fixture unavailable'),
    )

    render(<App />)

    await createFirstConnection()

    await openExplorerFromConnection()

    await waitFor(() => {
      expect(screen.getByText('Explorer fixture unavailable')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

