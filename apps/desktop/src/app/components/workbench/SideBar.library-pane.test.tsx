import { fireEvent, render, screen } from '@testing-library/react'
import type {
  ClosedQueryTabSnapshot,
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  LibraryNode,
} from '@datapadplusplus/shared-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryPane } from './SideBar.library-pane'
import { sidebarSectionId } from './SideBar.helpers'

const nodes: LibraryNode[] = [
  folder('library-root-queries', 'Queries'),
  folder('folder-alpha', 'Alpha'),
  folder('folder-beta', 'Beta'),
  folder('folder-reports', 'Reports', 'folder-alpha'),
  item('item-orders', 'Orders query', 'folder-alpha'),
]

describe('LibraryPane', () => {
  beforeEach(() => {
    window.localStorage.removeItem('datapadplusplus.library.recentsHeight')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('moves files and folders to folders or back to root with drag and drop', () => {
    const onMoveNode = vi.fn()
    renderLibraryPane(onMoveNode)

    pointerMoveNode('Orders query', 'Beta')
    expect(onMoveNode).toHaveBeenCalledWith('item-orders', 'folder-beta')

    onMoveNode.mockClear()
    pointerMoveNode('Reports', 'Move library item to root')
    expect(onMoveNode).toHaveBeenCalledWith('folder-reports', undefined)
  })

  it('shows saved query items with a query icon instead of the generic dot', () => {
    renderLibraryPane(vi.fn())

    const queryRow = treeRowForLabel('Orders query')

    expect(queryRow.querySelector('.library-node-icon--query svg')).toBeInTheDocument()
  })

  it('creates folders with an in-app dialog instead of a browser prompt', () => {
    const onCreateFolder = vi.fn()
    const promptSpy = vi.spyOn(window, 'prompt')

    renderLibraryPane(vi.fn(), { onCreateFolder })

    fireEvent.click(screen.getByLabelText('New library folder'))
    fireEvent.change(screen.getByLabelText('Folder name'), {
      target: { value: 'Projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Folder' }))

    expect(onCreateFolder).toHaveBeenCalledWith(undefined, 'Projects')
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('renames library nodes with an in-app dialog', () => {
    const onRenameNode = vi.fn()
    const promptSpy = vi.spyOn(window, 'prompt')

    renderLibraryPane(vi.fn(), { onRenameNode })

    fireEvent.contextMenu(treeItemForLabel('Orders query'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Orders cleanup' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(onRenameNode).toHaveBeenCalledWith('item-orders', 'Orders cleanup')
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('moves library nodes by folder path with an in-app dialog', () => {
    const onMoveNode = vi.fn()
    const promptSpy = vi.spyOn(window, 'prompt')

    renderLibraryPane(onMoveNode)

    fireEvent.contextMenu(treeItemForLabel('Orders query'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Folder' }))
    fireEvent.change(screen.getByLabelText('Folder path'), {
      target: { value: 'Beta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMoveNode).toHaveBeenCalledWith('item-orders', 'folder-beta')
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('shows a compact loading indicator on the active connection while metadata loads', () => {
    renderLibraryPane(vi.fn(), {
      activeConnectionId: 'connection-postgres',
      connections: [connection()],
      explorerStatus: 'loading',
      libraryNodes: [connectionNode('library-connection-postgres', 'Fixture PostgreSQL', 'connection-postgres')],
    })

    expect(
      screen.getByRole('status', { name: 'Loading metadata for Fixture PostgreSQL' }),
    ).toBeInTheDocument()
  })

  it('indents live connection metadata under nested connection rows', () => {
    renderLibraryPane(vi.fn(), {
      activeConnectionId: 'connection-mongo',
      activeEnvironmentId: 'env-dev',
      connections: [mongoConnection()],
      connectionExplorerItems: [
        {
          id: 'database:catalog',
          label: 'catalog',
          kind: 'database',
          detail: '',
          family: 'document',
          scope: 'database:catalog',
        },
      ],
      explorerStatus: 'ready',
      libraryNodes: [
        folder('folder-qa', 'QA'),
        folder('folder-mongodb', 'MongoDB', 'folder-qa'),
        connectionNode('library-connection-mongo', 'MongoDB', 'connection-mongo', 'folder-mongodb'),
      ],
      sectionStates: {
        [sidebarSectionId('library', 'node', 'folder-qa')]: true,
        [sidebarSectionId('library', 'node', 'folder-mongodb')]: true,
        [sidebarSectionId('library', 'node', 'library-connection-mongo')]: true,
      },
    })

    const catalogRow = screen.getByText('catalog').closest('[role="treeitem"]')

    expect(catalogRow).toHaveStyle({ '--tree-depth': '3' })
  })

  it('renders live metadata for expanded connections even when another connection is active', () => {
    renderLibraryPane(vi.fn(), {
      activeConnectionId: 'connection-postgres',
      activeEnvironmentId: 'env-dev',
      connections: [connection(), mongoConnection()],
      getConnectionExplorerItems: (connectionId) =>
        connectionId === 'connection-mongo'
          ? [
              {
                id: 'database:catalog',
                label: 'catalog',
                kind: 'database',
                detail: '',
                family: 'document',
                scope: 'database:catalog',
              },
            ]
          : undefined,
      getConnectionExplorerStatus: (connectionId) =>
        connectionId === 'connection-mongo' ? 'ready' : 'idle',
      libraryNodes: [
        connectionNode('library-connection-postgres', 'Fixture PostgreSQL', 'connection-postgres'),
        connectionNode('library-connection-mongo', 'MongoDB', 'connection-mongo'),
      ],
      sectionStates: {
        [sidebarSectionId('library', 'node', 'library-connection-mongo')]: true,
      },
    })

    expect(screen.getByText('catalog')).toBeInTheDocument()
  })

  it('loads expanded connection metadata with the inherited environment without selecting it', () => {
    const onLoadExplorerScope = vi.fn()
    const onSelectConnection = vi.fn()

    renderLibraryPane(vi.fn(), {
      activeConnectionId: 'connection-postgres',
      activeEnvironmentId: 'env-dev',
      connections: [connection(), mongoConnection()],
      environments,
      libraryNodes: [
        folder('folder-prod', 'Prod Folder', undefined, 'env-prod'),
        connectionNode('library-connection-mongo', 'MongoDB', 'connection-mongo', 'folder-prod'),
      ],
      onLoadExplorerScope,
      onSelectConnection,
      sectionStates: {
        [sidebarSectionId('library', 'node', 'folder-prod')]: true,
      },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand connection MongoDB' }),
    )

    expect(onLoadExplorerScope).toHaveBeenCalledWith(
      'connection-mongo',
      undefined,
      'env-prod',
    )
    expect(onSelectConnection).not.toHaveBeenCalled()
  })

  it('refreshes connection metadata from the connection context menu', () => {
    const onLoadExplorerScope = vi.fn()

    renderLibraryPane(vi.fn(), {
      activeEnvironmentId: 'env-dev',
      connections: [mongoConnection()],
      environments,
      libraryNodes: [
        folder('folder-prod', 'Prod Folder', undefined, 'env-prod'),
        connectionNode('library-connection-mongo', 'MongoDB', 'connection-mongo', 'folder-prod'),
      ],
      onLoadExplorerScope,
      sectionStates: {
        [sidebarSectionId('library', 'node', 'folder-prod')]: true,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for MongoDB' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh metadata for MongoDB' }))

    expect(onLoadExplorerScope).toHaveBeenCalledWith(
      'connection-mongo',
      undefined,
      'env-prod',
    )
  })

  it('moves items to root when dropped on empty library tree space', () => {
    const onMoveNode = vi.fn()
    renderLibraryPane(onMoveNode)

    pointerMoveNode('Orders query', 'Library tree')

    expect(onMoveNode).toHaveBeenCalledWith('item-orders', undefined)
  })

  it('marks folder and root drop targets while pointer dragging', () => {
    const onMoveNode = vi.fn()
    renderLibraryPane(onMoveNode)

    const source = labelButtonForLabel('Orders query')
    let restoreElementFromPoint = mockElementFromPoint(treeRowForLabel('Beta'))

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(source, { button: 0, pointerId: 1, clientX: 20, clientY: 20 })

    expect(treeItemForLabel('Beta')).toHaveClass('is-folder-drop-target')

    restoreElementFromPoint()
    restoreElementFromPoint = mockElementFromPoint(screen.getByRole('tree', { name: 'Library tree' }))
    fireEvent.pointerMove(source, { button: 0, pointerId: 1, clientX: 30, clientY: 30 })

    expect(
      screen.getByRole('button', { name: 'Move library item to root' }).closest('.library-main-scroll'),
    ).toHaveClass('is-library-root-drag-over')

    fireEvent.pointerUp(source, { button: 0, pointerId: 1, clientX: 30, clientY: 30 })
    restoreElementFromPoint()
  })

  it('blocks moving a folder into one of its descendants', () => {
    const onMoveNode = vi.fn()
    renderLibraryPane(onMoveNode)

    pointerMoveNode('Alpha', 'Reports')

    expect(onMoveNode).not.toHaveBeenCalled()
  })

  it('shows recent library files and closed tabs in a resizable bottom Recents panel', () => {
    renderLibraryPane(vi.fn(), {
      closedTabs: [closedTab('closed-tab-1', 'Closed scratch')],
      libraryNodes: [
        ...nodes,
        {
          ...item('item-recent', 'Recent report', 'folder-beta'),
          lastOpenedAt: '2026-05-14T10:00:00.000Z',
        },
      ],
    })

    expect(screen.getByRole('button', { name: /Collapse Recents section/i })).toBeInTheDocument()
    expect(screen.getAllByText('Recent report').length).toBeGreaterThan(0)
    expect(screen.getByText('Closed scratch')).toBeInTheDocument()

    const resizeHandle = screen.getByRole('separator', { name: 'Resize Recents' })
    const body = document.querySelector('#library-recents-body')

    fireEvent.pointerDown(resizeHandle, { pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(resizeHandle, { pointerId: 1, clientY: 70 })
    fireEvent.pointerUp(resizeHandle, { pointerId: 1, clientY: 70 })

    expect(body).toHaveStyle({ height: '210px' })
  })

  it('uses the closest assigned Library environment and styles inherited rows', () => {
    renderLibraryPane(vi.fn(), {
      environments,
      libraryNodes: [
        folder('folder-top', 'Top', undefined, 'env-dev'),
        folder('folder-child', 'Child', 'folder-top', 'env-prod'),
        item('item-child', 'Child query', 'folder-child'),
        item('item-top', 'Top query', 'folder-top'),
      ],
      sectionStates: { 'library:node:folder-child': true },
    })

    const childRow = treeRowForLabel('Child query')
    const topRow = treeRowForLabel('Top query')
    const childFolderRow = treeRowForLabel('Child')

    expect(childRow).toHaveClass('has-library-env')
    expect(childRow).toHaveClass('is-library-env-inherited')
    expect(childRow).toHaveStyle({ '--library-env-color': '#e06c75' })
    expect(childRow.querySelector('.library-tree-meta .library-env-badge')).toBeNull()
    expect(childFolderRow.querySelector('.library-tree-meta .library-env-badge')).toHaveTextContent(
      'Prod',
    )
    expect(topRow).toHaveStyle({ '--library-env-color': '#2dbf9b' })
    expect(topRow.querySelector('.library-tree-meta .library-env-badge')).toBeNull()
  })

  it('keeps environment badges and ellipsis actions in the right aligned lane', () => {
    renderLibraryPane(vi.fn(), {
      environments,
      libraryNodes: [
        folder('folder-top', 'Top', undefined, 'env-dev'),
        item('item-top', 'Top query', 'folder-top'),
      ],
    })

    const topRow = treeRowForLabel('Top')
    const queryRow = treeRowForLabel('Top query')

    expect(topRow.querySelector('.library-tree-meta .library-env-badge')).toHaveTextContent('Dev')
    expect(topRow.querySelector('.library-tree-meta .library-row-menu-button')).toBeInTheDocument()
    expect(queryRow.querySelector('.library-tree-meta .library-env-badge')).toBeNull()
    expect(queryRow.querySelector('.library-tree-meta .library-row-menu-button')).toBeInTheDocument()
    expect(queryRow.querySelector('.saved-work-actions')).not.toBeInTheDocument()
  })

  it('assigns and clears environments from the context menu', () => {
    const onSetEnvironment = vi.fn()
    renderLibraryPane(vi.fn(), {
      environments,
      onSetEnvironment,
    })

    fireEvent.contextMenu(treeItemForLabel('Orders query'))
    fireEvent.click(
      screen.getByRole('menuitem', {
        name: 'Assign environment Prod to Orders query',
      }),
    )
    expect(onSetEnvironment).toHaveBeenCalledWith('item-orders', 'env-prod')

    onSetEnvironment.mockClear()
    fireEvent.contextMenu(treeItemForLabel('Orders query'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inherit from parent' }))

    expect(onSetEnvironment).toHaveBeenCalledWith('item-orders', undefined)
  })

  it('manages environments from the row actions menu', () => {
    const onSelectEnvironment = vi.fn()
    const onEditEnvironment = vi.fn()
    const onCloneEnvironment = vi.fn()
    const onDeleteEnvironment = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderLibraryPane(vi.fn(), {
      environments,
      onCloneEnvironment,
      onDeleteEnvironment,
      onEditEnvironment,
      onSelectEnvironment,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Environment actions for Prod' }))
    expect(screen.queryByRole('menuitem', { name: 'Use environment Prod' })).not.toBeInTheDocument()
    expect(screen.queryByText('Use Environment')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit environment Prod' }))
    expect(onEditEnvironment).toHaveBeenCalledWith('env-prod')

    fireEvent.click(screen.getByRole('button', { name: 'Environment actions for Prod' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clone environment Prod' }))
    expect(onCloneEnvironment).toHaveBeenCalledWith('env-prod')

    fireEvent.click(screen.getByRole('button', { name: 'Environment actions for Prod' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete environment Prod' }))
    expect(onDeleteEnvironment).toHaveBeenCalledWith('env-prod')
  })

  it('keeps the Library toolbar focused on navigation and creation actions', () => {
    const onCreateConnection = vi.fn()

    renderLibraryPane(vi.fn(), {
      onCreateConnection,
    })

    expect(screen.queryByLabelText('Activity bar')).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Library actions' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Library' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('New library folder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Save current query to library')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open settings')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Toggle theme')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('New datastore connection'))

    expect(onCreateConnection).toHaveBeenCalledTimes(1)
  })
})

function renderLibraryPane(
  onMoveNode: (nodeId: string, parentId?: string) => void,
  overrides: Partial<{
    closedTabs: ClosedQueryTabSnapshot[]
    activeConnectionId: string
    activeEnvironmentId: string
    connectionExplorerItems: ExplorerNode[]
    connections: ConnectionProfile[]
    environments: EnvironmentProfile[]
    explorerStatus: 'idle' | 'loading' | 'ready'
    getConnectionExplorerItems: (connectionId: string, environmentId?: string) => ExplorerNode[] | undefined
    getConnectionExplorerStatus: (connectionId: string, environmentId?: string) => 'idle' | 'loading' | 'ready'
    libraryNodes: LibraryNode[]
    onCreateConnection: () => void
    onCreateFolder: (parentId: string | undefined, name: string) => void
    onCloneEnvironment: (environmentId: string) => void
    onDeleteEnvironment: (environmentId: string) => void
    onEditEnvironment: (environmentId: string) => void
    onLoadExplorerScope: (connectionId: string, scope?: string, environmentId?: string) => void
    onRenameNode: (nodeId: string, name: string) => void
    onSelectEnvironment: (environmentId: string) => void
    onSelectConnection: (connectionId: string) => void
    onSetEnvironment: (nodeId: string, environmentId?: string) => void
    sectionStates: Record<string, boolean>
  }> = {},
) {
  return render(
    <LibraryPane
      activeConnectionId={overrides.activeConnectionId ?? ''}
      activeEnvironmentId={overrides.activeEnvironmentId ?? ''}
      closedTabs={overrides.closedTabs ?? []}
      getConnectionExplorerItems={
        overrides.getConnectionExplorerItems ??
        (() => overrides.connectionExplorerItems)
      }
      getConnectionExplorerStatus={
        overrides.getConnectionExplorerStatus ??
        (() => overrides.explorerStatus ?? 'idle')
      }
      connections={overrides.connections ?? []}
      environments={overrides.environments ?? []}
      explorerStatus={overrides.explorerStatus ?? 'idle'}
      libraryFilter=""
      libraryNodes={overrides.libraryNodes ?? nodes}
      sectionStates={overrides.sectionStates ?? {}}
      onCreateConnection={overrides.onCreateConnection ?? vi.fn()}
      onCloneEnvironment={overrides.onCloneEnvironment ?? vi.fn()}
      onCreateFolder={overrides.onCreateFolder ?? vi.fn()}
      onDeleteEnvironment={overrides.onDeleteEnvironment ?? vi.fn()}
      onDeleteNode={vi.fn()}
      onEditEnvironment={overrides.onEditEnvironment ?? vi.fn()}
      onLibraryFilterChange={vi.fn()}
      onLoadExplorerScope={overrides.onLoadExplorerScope ?? vi.fn()}
      onMoveNode={onMoveNode}
      onOpenLibraryItem={vi.fn()}
      onRenameNode={overrides.onRenameNode ?? vi.fn()}
      onReopenClosedTab={vi.fn()}
      onSelectConnection={overrides.onSelectConnection ?? vi.fn()}
      onSelectEnvironment={overrides.onSelectEnvironment ?? vi.fn()}
      onSetNodeEnvironment={overrides.onSetEnvironment ?? vi.fn()}
      onSidebarSectionExpandedChange={vi.fn()}
    />,
  )
}

function pointerMoveNode(sourceName: string, targetName: string) {
  const source = labelButtonForLabel(sourceName)
  const target =
    targetName === 'Move library item to root'
      ? screen.getByRole('button', { name: targetName })
      : targetName === 'Library tree'
        ? screen.getByRole('tree', { name: targetName })
        : treeRowForLabel(targetName)
  const restoreElementFromPoint = mockElementFromPoint(target)

  try {
    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(source, { button: 0, pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(source, { button: 0, pointerId: 1, clientX: 20, clientY: 20 })
  } finally {
    restoreElementFromPoint()
  }
}

function labelButtonForLabel(label: string) {
  return screen.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(label)}$`, 'i'),
  })
}

function treeRowForLabel(label: string) {
  const labelButton = labelButtonForLabel(label)
  const row = labelButton.closest('.library-tree-row')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Tree row not found for ${label}.`)
  }

  return row
}

function treeItemForLabel(label: string) {
  const labelButton = labelButtonForLabel(label)
  const treeItem = labelButton.closest('[role="treeitem"]')

  if (!(treeItem instanceof HTMLElement)) {
    throw new Error(`Tree item not found for ${label}.`)
  }

  return treeItem
}

function mockElementFromPoint(target: Element) {
  const originalElementFromPoint = document.elementFromPoint
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  })

  return () => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    })
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function folder(
  id: string,
  name: string,
  parentId?: string,
  environmentId?: string,
): LibraryNode {
  return {
    id,
    kind: 'folder',
    parentId,
    name,
    environmentId,
    tags: [],
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
}

const environments: EnvironmentProfile[] = [
  {
    id: 'env-dev',
    label: 'Dev',
    color: '#2dbf9b',
    risk: 'low',
    variables: {},
    sensitiveKeys: [],
    requiresConfirmation: false,
    safeMode: false,
    exportable: true,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
  {
    id: 'env-prod',
    label: 'Prod',
    color: '#e06c75',
    risk: 'high',
    variables: {},
    sensitiveKeys: [],
    requiresConfirmation: true,
    safeMode: true,
    exportable: false,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  },
]

function item(id: string, name: string, parentId?: string): LibraryNode {
  return {
    id,
    kind: 'query',
    parentId,
    name,
    tags: [],
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    queryText: 'select 1;',
    language: 'sql',
  }
}

function connectionNode(
  id: string,
  name: string,
  connectionId: string,
  parentId?: string,
): LibraryNode {
  return {
    id,
    kind: 'connection',
    parentId,
    name,
    connectionId,
    tags: [],
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
}

function mongoConnection(): ConnectionProfile {
  return {
    id: 'connection-mongo',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    port: 27017,
    database: 'catalog',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
}

function connection(): ConnectionProfile {
  return {
    id: 'connection-postgres',
    name: 'Fixture PostgreSQL',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'datapadplusplus',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'postgresql',
    auth: {},
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  }
}

function closedTab(id: string, title: string): ClosedQueryTabSnapshot {
  return {
    id,
    title,
    connectionId: 'connection-1',
    environmentId: 'environment-1',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL',
    queryText: 'select 1;',
    status: 'idle',
    dirty: false,
    history: [],
    closedAt: '2026-05-14T11:00:00.000Z',
    closeReason: 'user',
  }
}
