import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import ByteRun from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/ByteRun'
import type { GameView } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/controller'

const game = vi.hoisted(() => ({ jump: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), refreshAppearance: vi.fn() }))
const view = vi.hoisted(() => ({ update: undefined as ((view: GameView) => void) | undefined }))
vi.mock('../../../../../../src/app/components/workbench/results/empty-state/byte-run/controller', () => ({
  createController: ({ onView }: { onView(view: GameView): void }) => { view.update = onView; return game },
}))
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

it('limits keys to the focused playfield, skips repeats/modifiers and leaves application shortcuts alone', () => {
  const onClose = vi.fn()
  render(<ByteRun theme="dark" onClose={onClose} />)
  const playfield = screen.getByRole('group', { name: 'Byte Run playfield' })
  expect(playfield).toHaveFocus()
  fireEvent.keyDown(playfield, { key: ' ' })
  fireEvent.keyDown(playfield, { key: 'ArrowUp' })
  expect(game.jump).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(playfield, { key: ' ', repeat: true })
  fireEvent.keyDown(playfield, { key: 'ArrowUp', ctrlKey: true })
  fireEvent.keyDown(playfield, { key: 'Enter', ctrlKey: true })
  fireEvent.keyDown(window, { key: ' ' })
  expect(game.jump).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close game' }), { key: ' ' })
  expect(game.jump).toHaveBeenCalledTimes(2)
  fireEvent.blur(playfield)
  expect(game.pause).toHaveBeenCalledOnce()
  fireEvent.keyDown(playfield, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

it('cleans up StrictMode effects and unmounting, and responds to theme changes', () => {
  const close = vi.fn()
  const { rerender, unmount } = render(<StrictMode><ByteRun theme="dark" onClose={close} /></StrictMode>)
  expect(game.destroy).toHaveBeenCalledOnce()
  rerender(<StrictMode><ByteRun theme="light" onClose={close} /></StrictMode>)
  expect(game.refreshAppearance).toHaveBeenCalledTimes(3)
  unmount()
  expect(game.destroy).toHaveBeenCalledTimes(2)
})

it('keeps pointer focus on the playfield when the ready overlay disappears', () => {
  render(<ByteRun theme="dark" onClose={vi.fn()} />)
  const playfield = screen.getByRole('group', { name: 'Byte Run playfield' })
  expect(fireEvent(playfield, new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))).toBe(false)
  expect(playfield).toHaveFocus()
  expect(game.jump).toHaveBeenCalledOnce()
})

it('keeps the interface minimal and reports collected bytes only at the end', () => {
  render(<ByteRun theme="dark" onClose={vi.fn()} />)
  act(() => view.update?.({ phase: 'ready', tooSmall: false, score: 0, collected: 0 }))
  expect(screen.getByText('Click or press Space to start')).toBeVisible()
  expect(screen.queryByText('Byte Run')).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  act(() => view.update?.({ phase: 'running', tooSmall: false, score: 760, collected: 8 }))
  expect(screen.queryByText(/Stage|Max pace|faster stages|bytes collected/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Score')).toBeVisible()
  expect(screen.getByLabelText('Personal best')).toBeVisible()
  act(() => view.update?.({ phase: 'over', tooSmall: false, score: 2400, collected: 12 }))
  expect(screen.getByText('Score 2400 · 12 bytes collected')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
  expect(game.jump).toHaveBeenCalledOnce()
})

it('announces active effects and gives a clear fall-off outcome without extra controls', () => {
  render(<ByteRun theme="dark" onClose={vi.fn()} />)
  act(() => view.update?.({ phase: 'running', tooSmall: false, score: 100, collected: 0, effects: 'Reverse · Speed boost' }))
  expect(screen.getByText('Reverse · Speed boost')).toHaveAttribute('role', 'status')
  expect(screen.getAllByRole('button')).toHaveLength(2)
  act(() => view.update?.({ phase: 'over', tooSmall: false, score: 0, collected: 1, fell: true, effects: '' }))
  expect(screen.getByText('Fell off the world · Score 0 · 1 byte collected')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Play again' })).toBeVisible()
})
