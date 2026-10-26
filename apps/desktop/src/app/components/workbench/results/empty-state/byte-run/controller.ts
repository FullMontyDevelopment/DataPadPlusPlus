import { advance, createRun, jump, score } from './engine'
import { drawRun } from './draw'
import type { Palette } from './draw'
import { pointerInWorld } from './presentation'
import type { Point } from './presentation'
import { newRunSeed } from './random-seed'
import { activeEffects } from './effects'
import { BEST_SCORE_KEY, readBestScore, saveBestScore } from './best-score'

export interface GameView {
  phase: 'ready' | 'running' | 'paused' | 'over'
  tooSmall: boolean
  score: number
  collected: number
  effects?: string
  fell?: boolean
}

interface Options {
  canvas: HTMLCanvasElement
  playfield: HTMLElement
  scoreLabel: HTMLElement
  bestLabel: HTMLElement
  onView(view: GameView): void
  onFailure(): void
}

export function createController({ canvas, playfield, scoreLabel, bestLabel, onView, onFailure }: Options) {
  const run = createRun()
  let phase: GameView['phase'] = 'ready'
  let tooSmall = true
  let disposed = false
  let frame: number | undefined
  let previousTime: number | undefined
  let width = 0
  let height = 0
  let density = 1
  let lastScore = -1
  let lastEffects = ''
  let pointer: Point | null = null
  let context: CanvasRenderingContext2D | null = null
  let observer: ResizeObserver | undefined
  let motion: MediaQueryList | undefined
  let palette: Palette

  function stopFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    previousTime = undefined
  }
  function updateScore() {
    const current = score(run)
    if (lastScore !== current) {
      scoreLabel.textContent = String(current).padStart(5, '0')
      lastScore = current
    }
  }
  function remember() { bestLabel.textContent = String(saveBestScore(Math.max(run.peakScore, score(run)))).padStart(5, '0') }
  function publish() {
    lastEffects = activeEffects(run)
    onView({ phase, tooSmall, score: score(run), collected: run.collected, effects: lastEffects, fell: run.falling })
  }
  function paint() {
    if (context && width > 0 && height > 0) {
      const reduced = motion?.matches ?? true
      const shift = reduced ? (run.direction === -1 ? 1 : 0) : run.screenShift
      const gaze = pointer ? pointerInWorld(pointer, width, height, run.direction, shift) : null
      drawRun(context, run, width, height, density, palette, motion?.matches ?? true, gaze)
    }
  }
  function safely(action: () => void) {
    if (disposed) return
    try { action() } catch {
      stopFrame()
      disposed = true
      onFailure()
    }
  }
  function pause() {
    if (phase !== 'running') return
    phase = 'paused'
    stopFrame()
    remember()
    publish()
  }
  function tick(time: number) {
    frame = undefined
    safely(() => {
      if (phase !== 'running') return
      if (document.hidden) { pause(); return }
      if (previousTime !== undefined) advance(run, (time - previousTime) / 1000)
      previousTime = time
      updateScore()
      if (activeEffects(run) !== lastEffects) publish()
      paint()
      if (run.over) {
        phase = 'over'
        stopFrame()
        remember()
        publish()
      } else frame = requestAnimationFrame(tick)
    })
  }
  function play() {
    if (tooSmall || document.hidden) return
    if (phase === 'ready' || phase === 'over') {
      Object.assign(run, createRun(newRunSeed()))
      updateScore()
    }
    if (phase !== 'running') {
      phase = 'running'
      publish()
      frame = requestAnimationFrame(tick)
    }
    jump(run)
  }
  function resize() {
    const rect = playfield.getBoundingClientRect()
    width = Math.max(0, rect.width)
    height = Math.max(0, rect.height)
    // Cap backing pixels without changing the logical aspect ratio when docked
    // in an unusually tall or wide panel.
    density = Math.min(2, window.devicePixelRatio || 1, 3200 / Math.max(1, width), 1200 / Math.max(1, height))
    canvas.width = Math.round(width * density)
    canvas.height = Math.round(height * density)
    const wasSmall = tooSmall
    tooSmall = rect.width < 280 || rect.height < 120
    if (tooSmall) { pointer = null; pause() }
    if (wasSmall !== tooSmall) publish()
    paint()
  }
  function refreshAppearance() {
    const style = getComputedStyle(playfield)
    palette = {
      text: style.getPropertyValue('--text').trim() || '#dddddd',
      muted: style.getPropertyValue('--muted').trim() || '#888888',
      accent: style.getPropertyValue('--accent').trim() || '#619de8',
      background: style.getPropertyValue('--panel-bg').trim() || '#202020',
    }
    resize()
  }
  const onBlur = () => safely(() => { pointer = null; pause(); if (!document.hidden) paint() })
  const onVisibility = () => { if (document.hidden) safely(() => { pointer = null; pause() }) }
  const onPointer = (event: PointerEvent) => safely(() => {
    if (tooSmall || document.hidden || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return
    const rect = playfield.getBoundingClientRect()
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    // Pointer-driven redraw only while idle/paused; never start an idle loop or
    // update React for eye movement. Running play uses its existing frame.
    if (phase !== 'running') paint()
  })
  const onPointerLeave = () => safely(() => {
    pointer = null
    if (phase !== 'running' && !document.hidden) paint()
  })
  const onStorage = (event: StorageEvent) => {
    if (event.key === BEST_SCORE_KEY || event.key === null) {
      safely(() => { bestLabel.textContent = String(readBestScore()).padStart(5, '0') })
    }
  }
  const onResize = () => safely(resize)
  const onMotion = () => safely(paint)
  const destroy = () => {
    disposed = true
    stopFrame()
    remember()
    observer?.disconnect()
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onVisibility)
    playfield.removeEventListener('pointermove', onPointer)
    playfield.removeEventListener('pointerleave', onPointerLeave)
    playfield.removeEventListener('pointercancel', onPointerLeave)
    motion?.removeEventListener('change', onMotion)
  }

  safely(() => {
    context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    motion.addEventListener('change', onMotion)
    observer = new ResizeObserver(onResize)
    observer.observe(playfield)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)
    playfield.addEventListener('pointermove', onPointer, { passive: true })
    playfield.addEventListener('pointerleave', onPointerLeave)
    playfield.addEventListener('pointercancel', onPointerLeave)
    bestLabel.textContent = String(readBestScore()).padStart(5, '0')
    updateScore()
    refreshAppearance()
    publish()
  })

  return {
    jump: () => safely(play),
    pause: () => safely(pause),
    resume: () => safely(() => {
      if (phase === 'paused' && !tooSmall && !document.hidden) {
        phase = 'running'
        publish()
        frame = requestAnimationFrame(tick)
      }
    }),
    refreshAppearance: () => safely(refreshAppearance),
    destroy,
  }
}
