import { Component, lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Table2 } from 'lucide-react'
import './empty-state.css'

// Keep even the game's storage and drawing code out of the initial workbench load.
const ByteRun = lazy(() => import('./byte-run/ByteRun'))

export function ResultsEmptyState({ theme }: { theme: string }) {
  const [opened, setOpened] = useState(false)
  const activations = useRef(0)
  const label = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const close = useCallback(() => {
    activations.current = 0
    restoreFocus.current = true
    setOpened(false)
  }, [])

  useLayoutEffect(() => {
    if (!opened && restoreFocus.current) {
      restoreFocus.current = false
      label.current?.focus({ preventScroll: true })
    }
  }, [opened])

  if (opened) {
    return (
      <GameBoundary onFailure={close}>
        <Suspense fallback={<div className="results-empty-state" role="status" data-local-shortcut-keys="Enter Space Escape">
          <span>Opening…</span>
          <button type="button" className="results-empty-label" autoFocus onClick={close}
            onKeyDown={event => { if (event.key === 'Escape') close() }}>Cancel</button>
        </div>}>
          <ByteRun theme={theme} onClose={close} />
        </Suspense>
      </GameBoundary>
    )
  }

  return (
    <div className="results-empty-state" data-local-shortcut-keys="Enter Space">
      <Table2 className="results-empty-icon" aria-hidden="true" size={25} strokeWidth={1.25} />
      <button ref={label} type="button" className="results-empty-label"
        onKeyDown={event => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        }}
        onClick={() => {
          activations.current += 1
          if (activations.current === 6) setOpened(true)
        }}>No result yet.</button>
      <p>Run a query to see results here.</p>
    </div>
  )
}

class GameBoundary extends Component<{ children: ReactNode; onFailure(): void }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override componentDidCatch() { this.props.onFailure() }
  override render() { return this.state.failed ? null : this.props.children }
}
