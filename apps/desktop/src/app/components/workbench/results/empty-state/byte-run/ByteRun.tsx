import { useEffect, useId, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { createController } from './controller'
import type { GameView } from './controller'
import './byte-run.css'

export default function ByteRun({ theme, onClose }: { theme: string; onClose(): void }) {
  const playfield = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scoreLabel = useRef<HTMLOutputElement>(null)
  const bestLabel = useRef<HTMLOutputElement>(null)
  const controller = useRef<ReturnType<typeof createController> | null>(null)
  const [view, setView] = useState<GameView>({ phase: 'ready', tooSmall: true, score: 0, collected: 0 })
  const hintId = useId()

  useEffect(() => {
    if (!canvas.current || !playfield.current || !scoreLabel.current || !bestLabel.current) return
    const game = createController({ canvas: canvas.current, playfield: playfield.current,
      scoreLabel: scoreLabel.current, bestLabel: bestLabel.current, onView: setView, onFailure: onClose })
    controller.current = game
    playfield.current.focus({ preventScroll: true })
    return () => { controller.current = null; game.destroy() }
  }, [onClose])

  useEffect(() => { controller.current?.refreshAppearance() }, [theme])

  const focusPlayfield = () => playfield.current?.focus({ preventScroll: true })
  const status = view.tooSmall ? 'Enlarge the results panel to play'
    : view.phase === 'ready' ? 'Click or press Space to start'
    : view.phase === 'paused' ? 'Paused'
    : view.phase === 'over' ? `${view.fell ? 'Fell off the world · ' : ''}Score ${view.score} · ${view.collected} ${view.collected === 1 ? 'byte' : 'bytes'} collected` : ''

  return (
    <section className="byte-run" aria-label="Byte Run" data-local-shortcut-keys="Space ArrowUp Enter Escape" onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }}>
      <header className="byte-run-header">
        <span className="byte-run-effects" role="status">{view.effects ?? ''}</span>
        <div className="byte-run-scores">
          <span>Score <output ref={scoreLabel} aria-label="Score" aria-live="off">00000</output></span>
          <span>Best <output ref={bestLabel} aria-label="Personal best" aria-live="off">00000</output></span>
        </div>
        <button type="button" className="byte-run-icon" disabled={view.tooSmall || !['running', 'paused'].includes(view.phase)}
          aria-label={view.phase === 'paused' ? 'Resume game' : 'Pause game'}
          title={view.phase === 'paused' ? 'Resume game' : 'Pause game'}
          onPointerDown={event => event.preventDefault()}
          onClick={() => {
            if (view.phase === 'paused') { focusPlayfield(); controller.current?.resume() }
            else controller.current?.pause()
          }}>
          {view.phase === 'paused' ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
        <button type="button" className="byte-run-icon" aria-label="Close game" title="Close game (Escape)" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div ref={playfield} className="byte-run-playfield" tabIndex={0} role="group"
        aria-label="Byte Run playfield" aria-describedby={hintId}
        onBlur={() => controller.current?.pause()}
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as Element).closest('button')) return
          // Starting removes the overlay under the pointer. Keep the browser's
          // subsequent default focus action from moving focus back to <body>.
          event.preventDefault()
          focusPlayfield()
          controller.current?.jump()
        }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
          if (event.key === ' ' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) controller.current?.jump()
          }
        }}>
        <canvas ref={canvas} aria-hidden="true" />
        {status ? <div className="byte-run-overlay">
          <span role="status">{status}</span>
          {view.phase === 'ready' && !view.tooSmall ? <small>Collect bytes. Special pickups reverse, boost, or raise barriers.</small> : null}
          {!view.tooSmall && view.phase === 'over' ? <button type="button" onClick={() => {
            focusPlayfield(); controller.current?.jump()
          }}>Play again</button> : null}
          {!view.tooSmall && view.phase === 'paused' ? <button type="button" onClick={() => {
            focusPlayfield(); controller.current?.resume()
          }}>Resume</button> : null}
        </div> : null}
      </div>
      <p id={hintId} className="byte-run-hint"><kbd>Space</kbd> / <kbd>↑</kbd> / tap to jump <span>· Escape to close</span></p>
    </section>
  )
}
