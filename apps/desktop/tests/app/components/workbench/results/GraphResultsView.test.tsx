import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphResultsView } from '../../../../../src/app/components/workbench/results/GraphResultsView'

const sigmaRendererMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  resize: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('sigma', () => ({
  default: class SigmaMock {
    on() {
      return this
    }

    refresh() {
      sigmaRendererMocks.refresh()
      return this
    }

    resize() {
      sigmaRendererMocks.resize()
      return this
    }

    getCamera() {
      return {
        animatedZoom: sigmaRendererMocks.zoomIn,
        animatedUnzoom: sigmaRendererMocks.zoomOut,
        animatedReset: sigmaRendererMocks.reset,
      }
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

afterEach(() => {
  sigmaRendererMocks.refresh.mockClear()
  sigmaRendererMocks.resize.mockClear()
  sigmaRendererMocks.zoomIn.mockClear()
  sigmaRendererMocks.zoomOut.mockClear()
  sigmaRendererMocks.reset.mockClear()
  vi.unstubAllGlobals()
})

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
    expect(screen.getByText('1 edge')).toBeInTheDocument()
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

    expect(screen.getByText('No relationships were returned by this query.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Objects' }))
    fireEvent.change(screen.getByLabelText('Filter graph objects'), {
      target: { value: 'invoice' },
    })

    const list = screen.getByRole('listbox', { name: 'Graph objects' })
    expect(within(list).getByText('Invoice')).toBeInTheDocument()
    expect(within(list).queryByText('Customer')).not.toBeInTheDocument()
  })

  it('keeps the detail panel optional and exposes graph camera controls', async () => {
    render(
      <GraphResultsView
        payload={{
          renderer: 'graph',
          nodes: [{ id: 'n1', label: 'Customer', kind: 'person', properties: {} }],
          edges: [],
        }}
      />,
    )

    await screen.findByLabelText('Graph visualization')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom graph in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom graph out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit graph to view' }))

    expect(sigmaRendererMocks.zoomIn).toHaveBeenCalledWith({ duration: 180 })
    expect(sigmaRendererMocks.zoomOut).toHaveBeenCalledWith({ duration: 180 })
    expect(sigmaRendererMocks.reset).toHaveBeenCalledWith({ duration: 220 })

    fireEvent.click(screen.getByRole('button', { name: 'Hide graph details' }))
    expect(screen.queryByLabelText('Graph result detail')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show graph details' })).toBeInTheDocument()
  })

  it('resizes the WebGL renderer when the result panel dimensions change', async () => {
    let resizeCallback: ResizeObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()

    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = observe
      disconnect = disconnect
      unobserve() {}
    })

    const { unmount } = render(
      <GraphResultsView
        payload={{
          renderer: 'graph',
          nodes: [{ id: 'n1', label: 'Customer', kind: 'person', properties: {} }],
          edges: [],
        }}
      />,
    )

    const canvas = await screen.findByLabelText('Graph visualization')
    await waitFor(() => expect(observe).toHaveBeenCalledWith(canvas))
    resizeCallback?.([], {} as ResizeObserver)

    expect(sigmaRendererMocks.resize).toHaveBeenCalledTimes(1)
    expect(sigmaRendererMocks.refresh).toHaveBeenCalled()

    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
