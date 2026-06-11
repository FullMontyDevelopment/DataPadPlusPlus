import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { EditorTabItem } from '../../../../../src/app/components/workbench/editor-tabs/EditorTabItem'

describe('EditorTabItem', () => {
  it('shows the query title without the legacy connection monogram', () => {
    renderEditorTabItem()

    const renderedTab = screen.getByRole('tab')

    expect(
      within(renderedTab).getByRole('img', { name: 'Primary Orders datastore icon' }),
    ).toBeInTheDocument()
    expect(within(renderedTab).getByText('Query 1')).toBeInTheDocument()
    expect(screen.queryByText('PO')).not.toBeInTheDocument()
    expect(renderedTab).toHaveAttribute(
      'title',
      expect.stringContaining('Connection: Primary Orders'),
    )
  })

  it('shows an unsaved marker for dirty saveable query tabs', () => {
    renderEditorTabItem({ tab: { ...tab, dirty: true } })

    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('tab')).toHaveAttribute(
      'title',
      expect.stringContaining('Unsaved changes'),
    )
  })

  it('prioritizes running state over the visible dirty marker', () => {
    const { unmount } = renderEditorTabItem({
      tab: { ...tab, dirty: true, status: 'running' },
    })

    expect(screen.getByRole('img', { name: 'Query running' })).toBeInTheDocument()
    expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByRole('tab')).toHaveAttribute(
      'title',
      expect.stringContaining('Unsaved changes'),
    )

    unmount()

    renderEditorTabItem({
      tab: {
        ...tab,
        id: 'tab-2',
        status: 'error',
        error: { code: 'QUERY_ERROR', message: 'Syntax error near from.' },
      },
    })

    expect(screen.getByRole('img', { name: 'Query error' })).toBeInTheDocument()
    expect(screen.getByRole('tab')).toHaveAttribute(
      'title',
      expect.stringContaining('Syntax error near from.'),
    )
  })

  it('does not show an unsaved marker for dirty unsaveable explorer tabs', () => {
    renderEditorTabItem({
      tab: {
        ...tab,
        title: 'Explore Primary Orders',
        tabKind: 'explorer',
        dirty: true,
      },
    })

    expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByRole('tab')).not.toHaveAttribute(
      'title',
      expect.stringContaining('Unsaved changes'),
    )
  })

  it('does not show an unsaved marker for dirty unsaveable metrics tabs', () => {
    renderEditorTabItem({
      tab: {
        ...tab,
        title: 'Metrics - Primary Orders',
        tabKind: 'metrics',
        dirty: true,
      },
    })

    expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByRole('tab')).not.toHaveAttribute(
      'title',
      expect.stringContaining('Unsaved changes'),
    )
  })
})

function renderEditorTabItem(overrides: Partial<Parameters<typeof EditorTabItem>[0]> = {}) {
  const props: Parameters<typeof EditorTabItem>[0] = {
    active: true,
    connection,
    draftTitle: '',
    editing: false,
    environment,
    tab,
    tabRef: vi.fn(),
    onBeginRename: vi.fn(),
    onCancelRename: vi.fn(),
    onCloseTab: vi.fn(),
    onCommitRename: vi.fn(),
    onContextMenu: vi.fn(),
    onDraftTitleChange: vi.fn(),
    onDragEnd: vi.fn(),
    onDragLeave: vi.fn(),
    onDragOver: vi.fn(),
    onDragStart: vi.fn(),
    onDrop: vi.fn(),
    onKeyDown: vi.fn(),
    onSelectTab: vi.fn(),
    ...overrides,
  }

  return render(<EditorTabItem {...props} />)
}

const tab: QueryTabState = {
  id: 'tab-1',
  title: 'Query 1.sql',
  connectionId: 'conn-1',
  environmentId: 'env-1',
  family: 'sql',
  language: 'sql',
  editorLabel: 'SQL editor',
  queryText: 'select 1;',
  status: 'idle',
  dirty: false,
  history: [],
}

const connection: ConnectionProfile = {
  id: 'conn-1',
  name: 'Primary Orders',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'orders',
  environmentIds: ['env-1'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'PO',
  auth: {},
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
}

const environment: EnvironmentProfile = {
  id: 'env-1',
  label: 'Development',
  color: '#3794ff',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: true,
  exportable: true,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
}
