import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExplorerNode, ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { CreateTestSuiteDialog } from '../../../../src/app/components/workbench/CreateTestSuiteDialog'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'

describe('CreateTestSuiteDialog', () => {
  it('requires a valid immutable binding and supports a database-wide target', () => {
    const snapshot = createSeedSnapshot()
    const onCreate = vi.fn()

    render(
      <CreateTestSuiteDialog
        connections={snapshot.connections}
        environments={snapshot.environments}
        getExplorerNodes={() => []}
        getExplorerStatus={() => 'ready'}
        initialRequest={{
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
        }}
        isExplorerScopeLoaded={() => true}
        isExplorerScopeLoading={() => false}
        onCancel={vi.fn()}
        onCreate={onCreate}
        onLoadExplorerScope={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create Test Suite' })).toBeDisabled()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'SPAN' &&
          element.textContent?.includes('Analytics Postgres · Dev · sql') === true,
      ),
    ).toBeVisible()
    expect(
      screen.queryByText(/immutable execution context/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Test suite connection' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Test suite environment' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Test suite template' }),
    ).toBeVisible()
    expect(screen.queryByRole('combobox', { name: /language/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Use database scope/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Test Suite' }))

    expect(onCreate).toHaveBeenCalledWith({
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      scopedTarget: expect.objectContaining({
        kind: 'database',
        label: '${DB_NAME}',
      }),
      templateId: undefined,
    })
  })

  it('retains an Explorer-prefilled object target', () => {
    const snapshot = createSeedSnapshot()
    const onCreate = vi.fn()
    const target = {
      kind: 'table',
      label: 'orders',
      path: ['public'],
      scope: 'table:public.orders',
    }

    render(
      <CreateTestSuiteDialog
        connections={snapshot.connections}
        environments={snapshot.environments}
        getExplorerNodes={() => [{
          id: 'orders',
          family: 'sql',
          kind: 'table',
          label: 'orders',
          path: ['public'],
          scope: 'table:public.orders',
        }]}
        getExplorerStatus={() => 'ready'}
        initialRequest={{
          connectionId: 'conn-analytics',
          environmentId: 'env-dev',
          scopedTarget: target,
        }}
        isExplorerScopeLoaded={() => true}
        isExplorerScopeLoading={() => false}
        onCancel={vi.fn()}
        onCreate={onCreate}
        onLoadExplorerScope={vi.fn()}
      />,
    )

    expect(screen.getByText('public / orders')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Create Test Suite' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      scopedTarget: target,
    }))
  })

  it('shows an explicit blocker for unsupported datastore providers', () => {
    const snapshot = createSeedSnapshot()

    render(
      <CreateTestSuiteDialog
        connections={snapshot.connections}
        environments={snapshot.environments}
        getExplorerNodes={() => []}
        getExplorerStatus={() => 'ready'}
        initialRequest={{
          connectionId: 'conn-orders',
          environmentId: 'env-uat',
        }}
        isExplorerScopeLoaded={() => true}
        isExplorerScopeLoading={() => false}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
        onLoadExplorerScope={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/does not expose a validated datastore test target/i),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create Test Suite' })).toBeDisabled()
  })

  it('loads MongoDB collection scopes and returns discovered collections', async () => {
    const snapshot = createSeedSnapshot()
    const onCreate = vi.fn()
    const onLoadExplorerScope = vi.fn()
    const loadedScopes = new Set<string | undefined>([undefined, 'databases'])
    const databaseTarget: ScopedQueryTarget = {
      kind: 'database',
      label: 'catalog',
      path: ['Databases'],
      scope: 'database:catalog',
    }
    let nodes: ExplorerNode[] = [
      {
        id: 'database:catalog',
        family: 'document',
        label: 'catalog',
        kind: 'database',
        detail: 'MongoDB database',
        scope: 'database:catalog',
        path: ['Databases'],
        expandable: true,
      },
    ]

    const dialog = () => (
      <CreateTestSuiteDialog
        connections={snapshot.connections}
        environments={snapshot.environments}
        getExplorerNodes={() => nodes}
        getExplorerStatus={() => 'ready'}
        initialRequest={{
          connectionId: 'conn-catalog',
          environmentId: 'env-dev',
          scopedTarget: databaseTarget,
        }}
        isExplorerScopeLoaded={(_connectionId, _environmentId, scope) =>
          loadedScopes.has(scope)
        }
        isExplorerScopeLoading={() => false}
        onCancel={vi.fn()}
        onCreate={onCreate}
        onLoadExplorerScope={onLoadExplorerScope}
      />
    )
    const { rerender } = render(dialog())

    fireEvent.click(screen.getByRole('button', { name: 'Change Collection' }))
    expect(
      screen.getByRole('listbox', { name: 'Collection' })
        .closest('.query-target-menu')?.parentElement,
    ).toBe(document.body)
    await waitFor(() =>
      expect(onLoadExplorerScope).toHaveBeenCalledWith(
        'conn-catalog',
        'env-dev',
        'database:catalog',
      ),
    )

    loadedScopes.add('database:catalog')
    nodes = [
      ...nodes,
      {
        id: 'catalog:collections',
        family: 'document',
        label: 'Collections',
        kind: 'collections',
        detail: 'Document collections',
        scope: 'collections:catalog',
        path: ['catalog'],
        expandable: true,
      },
    ]
    rerender(dialog())

    await waitFor(() =>
      expect(onLoadExplorerScope).toHaveBeenCalledWith(
        'conn-catalog',
        'env-dev',
        'collections:catalog',
      ),
    )

    loadedScopes.add('collections:catalog')
    nodes = [
      ...nodes,
      {
        id: 'collection:catalog:products',
        family: 'document',
        label: 'products',
        kind: 'collection',
        detail: 'MongoDB collection',
        scope: 'collection:catalog:products',
        path: ['catalog', 'Collections'],
        expandable: true,
      },
    ]
    rerender(dialog())

    fireEvent.click(screen.getByRole('option', { name: 'products' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Test Suite' }))

    expect(onCreate).toHaveBeenCalledWith({
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: expect.objectContaining({
        kind: 'collection',
        label: 'products',
        scope: 'collection:catalog:products',
      }),
      templateId: undefined,
    })
  })
})
