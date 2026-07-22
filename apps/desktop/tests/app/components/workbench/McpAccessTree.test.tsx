import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  LibraryNode,
} from '@datapadplusplus/shared-types'
import { McpAccessTree } from '../../../../src/app/components/workbench/McpAccessTree'
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

describe('McpAccessTree', () => {
  it('keeps duplicated datastore rows synchronized across selected environments', () => {
    const { connections, environments } = accessFixture()
    render(<AccessHarness connections={connections} environments={environments} />)

    expect(screen.getByText(/select at least one environment/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /^Dev low$/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Prod critical safe mode$/i }))

    const sharedRows = screen.getAllByRole('checkbox', { name: /Shared datastore/i })
    expect(sharedRows).toHaveLength(2)
    expect(screen.getAllByText('2 environments')).toHaveLength(2)

    fireEvent.click(sharedRows[0]!)
    expect(screen.getAllByRole('checkbox', { name: /Shared datastore/i }).every(
      (checkbox) => (checkbox as HTMLInputElement).checked,
    )).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /^Dev low$/i }))
    expect(screen.getByRole('checkbox', { name: /Shared datastore/i })).toBeChecked()
    expect(screen.queryByText(/effective access/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
  })

  it('includes a connection assigned through its Library folder', () => {
    const { connections, environments } = accessFixture()
    const prod = environments.find((environment) => environment.id === 'env-prod')!
    const inheritedConnection = {
      ...connections[0]!,
      id: 'conn-inherited',
      name: 'MongoDB 1',
      environmentIds: [],
    }
    const now = new Date().toISOString()
    const libraryNodes: LibraryNode[] = [
      {
        id: 'folder-prod',
        kind: 'folder',
        name: 'PROD',
        environmentId: prod.id,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'node-mongodb-1',
        kind: 'connection',
        parentId: 'folder-prod',
        connectionId: inheritedConnection.id,
        name: inheritedConnection.name,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    ]

    render(
      <AccessHarness
        connections={[inheritedConnection]}
        environments={environments}
        libraryNodes={libraryNodes}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /^Prod critical safe mode$/i }))
    expect(screen.getByRole('checkbox', { name: /MongoDB 1/i })).toBeInTheDocument()
  })
})

function AccessHarness({
  connections,
  environments,
  libraryNodes = [],
}: {
  connections: ConnectionProfile[]
  environments: EnvironmentProfile[]
  libraryNodes?: LibraryNode[]
}) {
  const [selection, setSelection] = useState({
    environmentIds: [] as string[],
    connectionIds: [] as string[],
    allowNoEnvironment: false,
  })

  return (
    <McpAccessTree
      connections={connections}
      environments={environments}
      libraryNodes={libraryNodes}
      {...selection}
      onChange={setSelection}
    />
  )
}

function accessFixture() {
  const snapshot = createSeedSnapshot()
  const baseConnection = snapshot.connections[0]!
  const dev = snapshot.environments.find((environment) => environment.id === 'env-dev')!
  const prod = snapshot.environments.find((environment) => environment.id === 'env-prod')!
  const connections: ConnectionProfile[] = [
    {
      ...baseConnection,
      id: 'conn-shared',
      name: 'Shared datastore',
      environmentIds: [dev.id, prod.id],
    },
    {
      ...baseConnection,
      id: 'conn-dev',
      name: 'Dev only datastore',
      environmentIds: [dev.id],
    },
  ]

  return { connections, environments: [dev, prod] }
}
