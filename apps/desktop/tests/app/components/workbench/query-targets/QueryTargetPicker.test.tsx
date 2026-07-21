import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ExplorerNode } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { createSeedSnapshot } from '../../../../fixtures/seed-workspace'
import { QueryTargetPicker } from '../../../../../src/app/components/workbench/query-targets/QueryTargetPicker'
import { createDefaultRedisKeyBrowserState } from '../../../../../src/app/components/workbench/query-builder/redis-key-browser'

describe('QueryTargetPicker', () => {
  it('searches cascading live metadata and selects only discovered targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    if (!connection) throw new Error('MongoDB fixture connection is missing.')
    const onChange = vi.fn()
    const nodes: ExplorerNode[] = [
      node('database', 'catalog', ['Databases'], 'database:catalog', true),
      node('collection', 'products', ['catalog', 'Collections'], 'collection:catalog:products'),
      node('collection', 'orders', ['catalog', 'Collections'], 'collection:catalog:orders'),
    ]

    render(
      <QueryTargetPicker
        connection={connection}
        nodes={nodes}
        scopedTarget={{
          kind: 'collection',
          label: 'products',
          path: ['catalog', 'Collections'],
          scope: 'collection:catalog:products',
          preferredBuilder: 'mongo-find',
        }}
        builderState={undefined}
        isScopeLoaded={() => true}
        isScopeLoading={() => false}
        onChange={onChange}
        onLoadScope={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change Collection' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Collection' }), {
      target: { value: 'ord' },
    })
    const listbox = screen.getByRole('listbox', { name: 'Collection' })
    expect(within(listbox).queryByRole('option', { name: 'products' })).not.toBeInTheDocument()
    fireEvent.click(within(listbox).getByRole('option', { name: 'orders' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      label: 'orders',
      scope: 'collection:catalog:orders',
    }))
  })

  it('loads root metadata when a picker first opens', async () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    if (!connection) throw new Error('MongoDB fixture connection is missing.')
    const onLoadScope = vi.fn()

    render(
      <QueryTargetPicker
        connection={connection}
        nodes={[]}
        builderState={undefined}
        isScopeLoaded={() => false}
        isScopeLoading={() => false}
        onChange={vi.fn()}
        onLoadScope={onLoadScope}
        onRefresh={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change Database' }))
    await waitFor(() => expect(onLoadScope).toHaveBeenCalledWith())
    expect(screen.getByText('catalog (unavailable)')).toBeInTheDocument()
  })

  it('closes without dispatching when the selected Redis database is chosen again', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')
    if (!connection) throw new Error('Redis fixture connection is missing.')
    const onChange = vi.fn()

    render(
      <QueryTargetPicker
        connection={connection}
        nodes={[node('database', 'DB 0', ['Databases'], 'db:0', true)]}
        builderState={createDefaultRedisKeyBrowserState()}
        isScopeLoaded={() => true}
        isScopeLoading={() => false}
        onChange={onChange}
        onLoadScope={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change Logical database' }))
    fireEvent.click(screen.getByRole('option', { name: 'DB 0' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox', { name: 'Logical database' })).not.toBeInTheDocument()
  })
})

function node(
  kind: string,
  label: string,
  path: string[],
  scope: string,
  expandable = false,
): ExplorerNode {
  return {
    id: `${kind}:${label}`,
    family: 'document',
    kind,
    label,
    detail: '',
    path,
    scope,
    expandable,
    queryTemplate: kind === 'collection' ? `{ "collection": "${label}" }` : undefined,
  }
}
