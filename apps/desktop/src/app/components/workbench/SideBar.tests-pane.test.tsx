import { fireEvent, render, screen } from '@testing-library/react'
import type { LibraryNode } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { createSeedSnapshot } from '../../../test/fixtures/seed-workspace'
import { TestsPane } from './SideBar.tests-pane'

describe('TestsPane', () => {
  it('creates suites for the active connection and opens engine templates', () => {
    const snapshot = createSeedSnapshot()
    const onCreateTestSuite = vi.fn()
    const onOpenTemplate = vi.fn()

    render(
      <TestsPane
        activeConnectionId="conn-catalog"
        connections={snapshot.connections}
        environments={snapshot.environments}
        libraryNodes={testLibraryNodes()}
        onCreateTestSuite={onCreateTestSuite}
        onOpenLibraryItem={vi.fn()}
        onOpenTemplate={onOpenTemplate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create test suite' }))
    expect(onCreateTestSuite).toHaveBeenCalledWith('conn-catalog')

    fireEvent.click(screen.getByRole('button', { name: /MongoDB document test/i }))
    expect(onOpenTemplate).toHaveBeenCalledWith('conn-catalog', 'mongodb-smoke-suite')
  })

  it('lists saved test suites from the Library and opens them once selected', () => {
    const snapshot = createSeedSnapshot()
    const onOpenLibraryItem = vi.fn()

    render(
      <TestsPane
        activeConnectionId="conn-catalog"
        connections={snapshot.connections}
        environments={snapshot.environments}
        libraryNodes={testLibraryNodes()}
        onCreateTestSuite={vi.fn()}
        onOpenLibraryItem={onOpenLibraryItem}
        onOpenTemplate={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Catalog smoke/i }))

    expect(onOpenLibraryItem).toHaveBeenCalledWith('suite-catalog')
  })
})

function testLibraryNodes(): LibraryNode[] {
  return [
    {
      id: 'library-root-tests',
      kind: 'folder',
      name: 'Tests',
      parentId: undefined,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
      tags: [],
      favorite: false,
    },
    {
      id: 'suite-catalog',
      kind: 'test-suite',
      name: 'Catalog smoke',
      parentId: 'library-root-tests',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
      tags: [],
      favorite: false,
      summary: 'MongoDB test suite',
    },
  ]
}
