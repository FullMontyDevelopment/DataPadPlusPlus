import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiServerCreateWizard } from '../../../../src/app/components/workbench/ApiServerCreateWizard'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(index: number): number }) => {
    const sizes = Array.from({ length: count }, (_, index) => estimateSize(index))
    return {
      getTotalSize: () => sizes.reduce((total, size) => total + size, 0),
      getVirtualItems: () => {
        let start = 0
        return sizes.map((size, index) => {
          const item = { index, key: index, size, start }
          start += size
          return item
        })
      },
    }
  },
}))

const usersResource = {
  id: 'api-resource-users',
  kind: 'table' as const,
  label: 'users',
  nodeId: 'table:public:users',
  path: ['analytics', 'public', 'Tables', 'users'],
  scope: 'table:public:users',
  endpointSlug: 'users',
  enabled: true,
}

describe('ApiServerCreateWizard', () => {
  it('persists only after review and includes the selected datastore context and resources', async () => {
    const snapshot = createSeedSnapshot()
    const onFinish = vi.fn().mockResolvedValue(true)
    const onDiscover = vi.fn().mockResolvedValue({ resources: [usersResource], warnings: [] })

    render(
      <ApiServerCreateWizard
        connections={snapshot.connections}
        environments={snapshot.environments}
        libraryNodes={snapshot.libraryNodes}
        initial={{}}
        onCancel={vi.fn()}
        onDiscover={onDiscover}
        onFinish={onFinish}
      />,
    )

    expect(onFinish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('radio', { name: /Analytics Postgres/i }))
    expect(screen.getByRole('combobox', { name: 'Environment' })).toHaveValue('env-dev')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(onDiscover).toHaveBeenCalledWith({
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      limit: 500,
    }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /users/i }))
    expect(onFinish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Analytics Postgres')).toBeInTheDocument()
    expect(screen.getByText('Dev')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Datastore API',
      protocol: 'rest',
      port: 17640,
      requestTimeoutMs: 0,
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      resources: [usersResource],
    }))
  })

  it('cancels without creating and keeps rejected creation visible with an inline error', async () => {
    const snapshot = createSeedSnapshot()
    const onCancel = vi.fn()
    const onFinish = vi.fn().mockResolvedValue(false)
    const { rerender } = render(
      <ApiServerCreateWizard
        connections={snapshot.connections}
        environments={snapshot.environments}
        libraryNodes={snapshot.libraryNodes}
        initial={{ connectionId: 'conn-analytics', environmentId: 'env-dev' }}
        onCancel={onCancel}
        onDiscover={vi.fn()}
        onFinish={onFinish}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()

    rerender(
      <ApiServerCreateWizard
        connections={snapshot.connections}
        environments={snapshot.environments}
        libraryNodes={snapshot.libraryNodes}
        initial={{ connectionId: 'conn-analytics', environmentId: 'env-dev' }}
        onCancel={onCancel}
        onDiscover={vi.fn()}
        onFinish={onFinish}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('region', { name: 'Available Resources' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be created/i)
    expect(screen.getByRole('dialog', { name: 'Create API Server' })).toBeInTheDocument()
  })
})
