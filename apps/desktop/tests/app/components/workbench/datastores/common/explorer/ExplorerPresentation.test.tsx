import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ConnectionProfile, EnvironmentProfile, ExplorerNode, ExplorerResponse } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { workbenchSlices } from '../../../../../../../src/app/components/workbench/datastores/registry'
import { DatastoreExplorerActions, DatastoreExplorerDetails } from '../../../../../../../src/app/components/workbench/datastores/common/explorer/DatastoreExplorerDetails'
import { ExplorerSelectionHeader } from '../../../../../../../src/app/components/workbench/datastores/common/explorer/ExplorerChrome'

const connection = { id: 'fixture', name: 'Example connection', engine: 'sqlite', family: 'sql' } as ConnectionProfile
const environment = { id: 'qa', label: 'QA', color: '#4388d4' } as EnvironmentProfile
const node: ExplorerNode = { id: 'database:main', family: 'sql', label: 'Main Database', kind: 'database', detail: 'SQLite main database file', scope: 'database:main', path: ['Example connection'] }
const provider = { kind: 'database', label: 'Database', mode: 'scope-inspection' as const, category: 'overview' as const }

describe('Explorer presentation', () => {
  it.each(workbenchSlices)('uses consistent, native-aware navigation for $engine', (slice) => {
    const Explorer = slice.explorer.Workspace
    const onLoadScope = vi.fn()
    const view = render(<Explorer
      connection={{ ...connection, engine: slice.engine, family: slice.explorer.family }}
      environment={environment} status="ready" scopes={{ __root__: { connectionId: 'fixture', environmentId: 'qa', nodes: [], summary: '', capabilities: {} } as ExplorerResponse }}
      isScopeLoading={() => false} getScopeError={() => undefined} onLoadScope={onLoadScope} onInspectNode={vi.fn()} onOpenQuery={vi.fn()} onOpenObjectView={vi.fn()}
    />)
    const header = view.container.querySelector('.explorer-workspace-header') as HTMLElement
    expect(within(header).getByRole('heading', { name: 'Example connection', level: 1 })).toBeInTheDocument()
    expect(within(header).getByText('QA')).toBeInTheDocument()
    expect(within(header).getByText(`${slice.explorer.label} Explorer`)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Filter loaded objects')).toHaveAttribute('title', expect.stringContaining('already loaded'))
    expect(Boolean(screen.queryByRole('button', { name: 'Relationship map' }))).toBe(slice.explorer.supportsRelationshipMap)
    onLoadScope.mockClear()
    fireEvent.click(within(header).getByRole('button', { name: /Refresh/ }))
    expect(onLoadScope).toHaveBeenCalledOnce()
  })

  it('keeps the selected object, native type, location and actions together', () => {
    const onOpenQuery = vi.fn()
    const onOpenObjectView = vi.fn()
    const selected = { ...node, queryTemplate: 'select 1', path: ['Example connection', 'Main Database'] }
    render(<ExplorerSelectionHeader connection={connection} node={selected} description={node.detail}
      actions={<DatastoreExplorerActions node={selected} provider={provider} onOpenQuery={onOpenQuery} onOpenObjectView={onOpenObjectView} />} />)
    expect(screen.getByRole('heading', { name: 'Main Database', level: 2 })).toBeInTheDocument()
    expect(screen.getByLabelText('Object location')).toHaveTextContent('Example connection')
    expect(screen.getByLabelText('Object location')).not.toHaveTextContent('Main Database')
    fireEvent.click(screen.getByRole('button', { name: 'Open query' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }))
    expect(onOpenQuery).toHaveBeenCalledOnce()
    expect(onOpenObjectView).toHaveBeenCalledOnce()
  })

  it('puts internal identifiers in a collapsed disclosure without exposing sensitive metadata', () => {
    render(<DatastoreExplorerDetails connection={connection} node={node} provider={provider} loading={false}
      inspection={{ nodeId: node.id, summary: '', payload: { nodeId: node.id, engine: 'sqlite', owner: 'Example owner', password: 'not-for-display' } }}
      onLoadMore={vi.fn()} onSelectNode={vi.fn()} onOpenQuery={vi.fn()} onOpenObjectView={vi.fn()} />)
    expect(screen.getByText('Example owner')).toBeVisible()
    const disclosure = screen.getByText('Technical details').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    expect(within(disclosure).getByText('Node ID')).toBeInTheDocument()
    expect(within(disclosure).getByText('sqlite')).toBeInTheDocument()
    expect(screen.queryByText('not-for-display')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('keeps paged native objects selectable and blocks repeated Load more while loading', () => {
    const onSelectNode = vi.fn()
    const onLoadMore = vi.fn()
    const child = { ...node, id: 'tables', label: 'Tables', kind: 'tables', detail: 'Tables in this database' }
    const response = { nodes: [child], pageInfo: { hasMore: true, nextCursor: 'page-2', knownTotal: 40 } } as ExplorerResponse
    const props = { connection, node, provider, scopeResponse: response, inspection: { nodeId: node.id, summary: 'Metadata', payload: { nodeId: node.id, engine: 'sqlite' } }, onLoadMore, onSelectNode, onOpenQuery: vi.fn(), onOpenObjectView: vi.fn() }
    const view = render(<DatastoreExplorerDetails {...props} loading={false} />)
    expect(screen.getByText('1 of 40 loaded')).toBeInTheDocument()
    expect(screen.queryByText('No additional metadata returned')).not.toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Tables/ })
    expect(within(row).getAllByText('Tables', { exact: true })).toHaveLength(1)
    fireEvent.click(row)
    expect(onSelectNode).toHaveBeenCalledWith(child)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledWith('page-2')
    view.rerender(<DatastoreExplorerDetails {...props} loading />)
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Tables/ })).toBeInTheDocument()
  })

  it('does not offer actions for unavailable native surfaces', () => {
    render(<DatastoreExplorerActions node={{ ...node, kind: 'unavailable' }} provider={{ ...provider, mode: 'state' }} onOpenQuery={vi.fn()} onOpenObjectView={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
