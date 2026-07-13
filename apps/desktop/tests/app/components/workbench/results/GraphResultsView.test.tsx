import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphResultsView } from '../../../../../src/app/components/workbench/results/GraphResultsView'

vi.mock('sigma', () => ({
  default: class SigmaMock {
    on() {
      return this
    }

    kill() {}
  },
}))

vi.mock('graphology', () => ({
  default: class GraphologyMock {
    private nodes = new Set<string>()
    private edges = new Map<string, [string, string]>()

    addNode(id: string) {
      this.nodes.add(id)
    }

    addDirectedEdgeWithKey(id: string, from: string, to: string) {
      this.edges.set(id, [from, to])
    }

    hasNode(id: string) {
      return this.nodes.has(id)
    }

    hasEdge(id: string) {
      return this.edges.has(id)
    }

    extremities(id: string) {
      return this.edges.get(id) ?? []
    }

    areNeighbors(from: string, to: string) {
      return Array.from(this.edges.values()).some(
        ([source, target]) =>
          (source === from && target === to) || (source === to && target === from),
      )
    }

    setNodeAttribute() {}
  },
}))

vi.mock('graphology-layout', () => ({
  circular: {
    assign: vi.fn(),
  },
}))

describe('GraphResultsView', () => {
  it('renders graph counts, bounded sample notice, and normalized object rows', async () => {
    render(
      <GraphResultsView
        payload={{
          renderer: 'graph',
          nodes: [
            {
              id: 'n1',
              label: 'Alice',
              kind: 'person',
              properties: { name: 'Alice' },
            },
            {
              id: 'n2',
              label: 'Orders',
              kind: 'account',
              properties: { status: 'active' },
            },
          ],
          edges: [
            {
              id: 'e1',
              from: 'n1',
              to: 'n2',
              label: 'USES',
              kind: 'relationship',
              properties: { since: 2026 },
            },
          ],
          nodeCount: 2,
          edgeCount: 1,
          visualNodeCap: 1,
          visualEdgeCap: 1,
          truncated: true,
          warnings: ['Visual sample capped at 1 node.'],
        }}
      />,
    )

    expect(screen.getByText('2 nodes')).toBeInTheDocument()
    expect(screen.getByText('1 edges')).toBeInTheDocument()
    expect(screen.getByText('sample capped')).toBeInTheDocument()
    expect(screen.getByText('Visual sample capped at 1 node.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Objects' }))
    const list = screen.getByRole('listbox', { name: 'Graph objects' })
    expect(within(list).getByText('Alice')).toBeInTheDocument()
    expect(within(list).getByText('person / n1')).toBeInTheDocument()
    expect(within(list).getByText('USES')).toBeInTheDocument()
    expect(within(list).getByText('n1 -> n2')).toBeInTheDocument()

    fireEvent.click(within(list).getByText('USES'))
    fireEvent.click(screen.getByRole('button', { name: 'Expand edge' }))
    await waitFor(() => expect(screen.getByText('"e1"')).toBeInTheDocument())
    expect(screen.getByText('"relationship"')).toBeInTheDocument()
  })

  it('filters the object list without mounting the whole graph as raw JSON', () => {
    render(
      <GraphResultsView
        payload={{
          renderer: 'graph',
          nodes: [
            { id: 'n1', label: 'Customer', kind: 'person', properties: {} },
            { id: 'n2', label: 'Invoice', kind: 'document', properties: {} },
          ],
          edges: [],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Objects' }))
    fireEvent.change(screen.getByLabelText('Filter graph objects'), {
      target: { value: 'invoice' },
    })

    const list = screen.getByRole('listbox', { name: 'Graph objects' })
    expect(within(list).getByText('Invoice')).toBeInTheDocument()
    expect(within(list).queryByText('Customer')).not.toBeInTheDocument()
  })
})
