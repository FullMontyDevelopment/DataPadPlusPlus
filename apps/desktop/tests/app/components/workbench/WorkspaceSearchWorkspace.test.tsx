import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import { WorkspaceSearchWorkspace } from '../../../../src/app/components/workbench/WorkspaceSearchWorkspace'

function renderWorkspaceSearch(snapshot: WorkspaceSnapshot = searchSnapshot()) {
  const props = {
    snapshot,
    enabled: true,
    onOpenExperimentalSettings: vi.fn(),
    onOpenConnection: vi.fn(),
    onOpenLibraryItem: vi.fn(),
    onSelectTab: vi.fn(),
    onReopenClosedTab: vi.fn(),
  }

  render(<WorkspaceSearchWorkspace {...props} />)
  return props
}

describe('WorkspaceSearchWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders grouped results and opens a Library result', () => {
    const props = renderWorkspaceSearch()

    fireEvent.change(screen.getByLabelText('Search workspace'), {
      target: { value: 'needle' },
    })

    expect(screen.getByText('Needle query')).toBeInTheDocument()
    expect(screen.getByText(/matches in 1 item/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Needle query' }))

    expect(props.onOpenLibraryItem).toHaveBeenCalledWith('item-needle')
  })

  it('applies case-sensitive and whole-word toggles', () => {
    renderWorkspaceSearch()
    const input = screen.getByLabelText('Search workspace')

    fireEvent.change(input, { target: { value: 'needle' } })
    expect(screen.getByText('Needle query')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Match case'))
    expect(screen.getByText('No results')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Needle' } })
    expect(screen.getByText('Needle query')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Match whole word'))
    expect(within(screen.getByRole('button', { name: 'Open Needle query' })).getByText('2')).toBeInTheDocument()
  })

  it('filters included result types', () => {
    renderWorkspaceSearch(multiTypeSnapshot())
    const input = screen.getByLabelText('Search workspace')

    fireEvent.change(input, { target: { value: 'needle' } })

    expect(screen.getByRole('button', { name: 'Open Needle connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Needle folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Needle query' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Include Connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Include Folders' }))

    expect(screen.queryByRole('button', { name: 'Open Needle connection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Needle folder' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Needle query' })).toBeInTheDocument()
  })

  it('shows recent searches when the query is empty and reuses them', async () => {
    renderWorkspaceSearch()
    const input = screen.getByLabelText('Search workspace')

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '' } })

    expect(await screen.findByRole('region', { name: 'Recent workspace searches' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search workspace for needle' }))

    expect(input).toHaveValue('needle')
    expect(await screen.findByRole('button', { name: 'Open Needle query' })).toBeInTheDocument()
  })

  it('persists, deduplicates, caps, and clears recent searches', async () => {
    const { unmount } = render(<WorkspaceSearchWorkspace {...workspaceSearchProps(searchSnapshot())} />)
    const input = screen.getByLabelText('Search workspace')

    for (const term of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'BETA']) {
      fireEvent.change(input, { target: { value: term } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }

    unmount()
    render(<WorkspaceSearchWorkspace {...workspaceSearchProps(searchSnapshot())} />)

    expect(await screen.findByRole('button', { name: 'Search workspace for BETA' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search workspace for beta' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search workspace for alpha' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent workspace searches' }))

    expect(screen.queryByRole('region', { name: 'Recent workspace searches' })).not.toBeInTheDocument()
  })

  it('shows an enablement prompt when the feature is disabled', () => {
    const snapshot = searchSnapshot()
    const onOpenExperimentalSettings = vi.fn()

    render(
      <WorkspaceSearchWorkspace
        snapshot={snapshot}
        enabled={false}
        onOpenExperimentalSettings={onOpenExperimentalSettings}
        onOpenConnection={vi.fn()}
        onOpenLibraryItem={vi.fn()}
        onSelectTab={vi.fn()}
        onReopenClosedTab={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Plugins Settings' }))

    expect(onOpenExperimentalSettings).toHaveBeenCalled()
  })
})

function workspaceSearchProps(snapshot: WorkspaceSnapshot) {
  return {
    snapshot,
    enabled: true,
    onOpenExperimentalSettings: vi.fn(),
    onOpenConnection: vi.fn(),
    onOpenLibraryItem: vi.fn(),
    onSelectTab: vi.fn(),
    onReopenClosedTab: vi.fn(),
  }
}

function searchSnapshot(): WorkspaceSnapshot {
  const base = createSeedSnapshot()

  return {
    ...base,
    preferences: {
      ...base.preferences,
      workspaceSearch: { enabled: true },
    },
    connections: [],
    tabs: [],
    closedTabs: [],
    libraryNodes: [
      {
        id: 'item-needle',
        kind: 'query',
        name: 'Needle query',
        tags: [],
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        queryText: 'select Needle from haystack;\nselect Needlework from crafts;',
        language: 'sql',
      },
    ],
  }
}

function multiTypeSnapshot(): WorkspaceSnapshot {
  const base = searchSnapshot()

  return {
    ...base,
    connections: [
      {
        id: 'conn-needle',
        name: 'Needle connection',
        engine: 'postgresql',
        family: 'sql',
        host: 'localhost',
        port: 5432,
        database: 'needle',
        environmentIds: [],
        tags: [],
        favorite: false,
        readOnly: false,
        icon: 'PG',
        auth: {},
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    libraryNodes: [
      {
        id: 'folder-needle',
        kind: 'folder',
        name: 'Needle folder',
        tags: [],
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      ...base.libraryNodes,
    ],
  }
}
