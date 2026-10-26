import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ResultsEmptyState } from '../../../../../src/app/components/workbench/results/empty-state/ResultsEmptyState'

const pending = vi.hoisted(() => {
  let resolve!: () => void
  return { ready: new Promise<void>(done => { resolve = done }), resolve: () => resolve(), mounted: vi.fn() }
})
vi.mock('../../../../../src/app/components/workbench/results/empty-state/byte-run/ByteRun', async () => {
  await pending.ready
  return { default: () => { pending.mounted(); return <div>Game loaded</div> } }
})

it('does not mount a late-loading game after the results view is replaced', async () => {
  const { rerender } = render(<ResultsEmptyState theme="dark" />)
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'No result yet.' }))
  expect(screen.getByText('Opening…')).toBeVisible()
  rerender(<div>Query results</div>)
  await act(async () => { pending.resolve(); await pending.ready })
  expect(screen.queryByText('Game loaded')).not.toBeInTheDocument()
  expect(pending.mounted).not.toHaveBeenCalled()
})
