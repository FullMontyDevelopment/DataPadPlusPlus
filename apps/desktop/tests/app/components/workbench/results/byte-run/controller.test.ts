import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createController } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/controller'
import { BEST_SCORE_KEY, readBestScore } from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/best-score'
import * as engine from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/engine'
import * as drawing from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/draw'
import * as seeds from '../../../../../../src/app/components/workbench/results/empty-state/byte-run/random-seed'

let frames: Map<number, FrameRequestCallback>
let frameId: number
let resize: ResizeObserverCallback
let disconnect: ReturnType<typeof vi.fn>
let motionChange: () => void
let motionRemove: ReturnType<typeof vi.fn>
const canvasMethods = ['setTransform', 'clearRect', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'fillRect', 'ellipse', 'fill', 'fillText']

beforeEach(() => {
  frames = new Map(); frameId = 0
  disconnect = vi.fn(); motionRemove = vi.fn()
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true,
    addEventListener: vi.fn((_type, callback) => { motionChange = callback }), removeEventListener: motionRemove })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    Object.fromEntries(canvasMethods.map(name => [name, vi.fn()])) as unknown as CanvasRenderingContext2D,
  )
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mount() {
  const canvas = document.createElement('canvas')
  const playfield = document.createElement('div')
  const scoreLabel = document.createElement('output')
  const bestLabel = document.createElement('output')
  const rect = vi.spyOn(playfield, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 720, height: 220 } as DOMRect)
  const onView = vi.fn(); const onFailure = vi.fn()
  const controller = createController({ canvas, playfield, scoreLabel, bestLabel, onView, onFailure })
  return { controller, canvas, playfield, rect, scoreLabel, bestLabel, onView, onFailure }
}
function frame(time: number) {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach(callback => callback(time))
}

describe('Byte Run resource lifecycle', () => {
  it('keeps a narrow dock and pointer tracking steady when boost is collected, renewed and expires', () => {
    const draw = vi.spyOn(drawing, 'drawRun')
    const { controller, canvas, playfield, rect, onFailure } = mount()
    const context = canvas.getContext('2d')!
    let current: engine.Run | undefined
    const actualAdvance = engine.advance
    vi.spyOn(engine, 'advance').mockImplementation((run, elapsed) => {
      current = run
      run.nextObstacle = run.nextByteAt = run.nextPowerAt = Infinity
      actualAdvance(run, elapsed)
    })
    rect.mockReturnValue({ left: 0, top: 0, width: 360, height: 700 } as DOMRect)
    resize([], {} as ResizeObserver)
    const pointer = new MouseEvent('pointermove', { clientX: 200, clientY: 320 })
    Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
    playfield.dispatchEvent(pointer)
    controller.jump(); frame(0); frame(16)
    current!.distance = 100_000
    const capture = (time: number) => {
      vi.mocked(context.scale).mockClear()
      vi.mocked(context.translate).mockClear()
      frame(time)
      return {
        scales: vi.mocked(context.scale).mock.calls.slice(),
        positions: vi.mocked(context.translate).mock.calls.slice(),
        gaze: draw.mock.lastCall?.[7],
      }
    }
    const before = capture(32)
    const baseSpeed = current!.speed
    engine.applyPowerup(current!, 'boost')
    expect(capture(48)).toEqual(before)
    expect(current!.speed).toBeGreaterThan(baseSpeed)
    engine.applyPowerup(current!, 'boost')
    expect(capture(64)).toEqual(before)
    current!.boostRemaining = engine.STEP_SECONDS
    expect(capture(80)).toEqual(before)
    expect(current!.speed).toBe(baseSpeed)
    expect(current!.boostRemaining).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
    controller.destroy()
    expect(frames.size).toBe(0)
  })

  it('pauses effect timers, announces only effect changes, and retains the peak before lost points', () => {
    const { controller, onView, bestLabel } = mount()
    let current: engine.Run | undefined
    const actualAdvance = engine.advance
    vi.spyOn(engine, 'advance').mockImplementation((run, elapsed) => {
      current = run
      run.nextObstacle = Infinity; run.nextByteAt = Infinity; run.nextPowerAt = Infinity
      actualAdvance(run, elapsed)
    })
    controller.jump(); frame(0); frame(16)
    current!.distance = (readBestScore() + 1000) * 10
    const peak = engine.score(current!)
    engine.applyPowerup(current!, 'reverse')
    engine.applyPowerup(current!, 'boost')
    engine.applyPowerup(current!, 'barriers')
    frame(32)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ effects: 'Reverse · Speed boost · Tall barriers' }))
    const published = onView.mock.calls.length
    frame(48); frame(64)
    expect(onView).toHaveBeenCalledTimes(published)
    controller.pause()
    const remaining = current!.boostRemaining
    frame(100_000)
    expect(current!.boostRemaining).toBe(remaining)
    expect(Number(bestLabel.textContent)).toBeGreaterThanOrEqual(peak)
    controller.resume(); frame(100_016); frame(100_032)
    expect(current!.boostRemaining).toBeLessThan(remaining)
    controller.destroy()
    expect(frames.size).toBe(0)
  })
  it('starts and retries with fresh seeds but keeps the same run when paused or resized', () => {
    const seed = vi.spyOn(seeds, 'newRunSeed').mockReturnValueOnce(917).mockReturnValueOnce(831)
    const create = vi.spyOn(engine, 'createRun')
    const { controller } = mount()
    expect(seed).not.toHaveBeenCalled()
    controller.jump()
    expect(create).toHaveBeenLastCalledWith(917)
    controller.pause(); controller.resume()
    resize([], {} as ResizeObserver)
    controller.jump()
    expect(seed).toHaveBeenCalledTimes(1)
    vi.spyOn(engine, 'advance').mockImplementation(run => { run.over = true })
    frame(0); frame(16)
    controller.jump()
    expect(seed).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenLastCalledWith(831)
    controller.destroy()
  })

  it('includes bonuses in the score without rerendering every frame and resets on restart', () => {
    const { controller, onView, scoreLabel } = mount()
    const advance = vi.spyOn(engine, 'advance').mockImplementation(run => { run.distance += 100 })
    controller.jump()
    const initialCalls = onView.mock.calls.length
    for (let time = 0; time <= 160; time += 16) frame(time)
    expect(scoreLabel.textContent).toBe('00100')
    expect(onView).toHaveBeenCalledTimes(initialCalls)
    advance.mockImplementation(run => { run.distance = 3000; run.bonus = 30; run.collected = 2 })
    frame(176)
    expect(onView).toHaveBeenCalledTimes(initialCalls)
    expect(scoreLabel.textContent).toBe('00330')
    advance.mockImplementation(run => { run.distance = 22_000 })
    frame(192)
    expect(onView).toHaveBeenCalledTimes(initialCalls)
    advance.mockImplementation(run => { run.over = true })
    frame(208)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'over', collected: 2, score: 2230 }))
    controller.jump()
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ collected: 0, score: 0 }))
    expect(scoreLabel.textContent).toBe('00000')
    controller.destroy()
  })

  it('tracks the local pointer without idle frames, ignores touch, and removes listeners on exit', () => {
    const draw = vi.spyOn(drawing, 'drawRun')
    const { controller, playfield, onView } = mount()
    const move = (x: number, y: number, pointerType = 'mouse') => {
      const event = new MouseEvent('pointermove', { clientX: x, clientY: y })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      playfield.dispatchEvent(event)
    }
    const renders = onView.mock.calls.length
    move(20, 60)
    expect(draw.mock.lastCall?.[7]).toEqual({ x: 20, y: 40 })
    expect(frames.size).toBe(0)
    expect(onView).toHaveBeenCalledTimes(renders)
    const drawings = draw.mock.calls.length
    move(600, 70, 'touch')
    expect(draw).toHaveBeenCalledTimes(drawings)
    playfield.dispatchEvent(new Event('pointerleave'))
    expect(draw.mock.lastCall?.[7]).toBeNull()
    controller.jump()
    const beforeMove = draw.mock.calls.length
    move(600, 60)
    expect(draw).toHaveBeenCalledTimes(beforeMove)
    expect(frames.size).toBe(1)
    frame(0)
    expect(draw.mock.lastCall?.[7]).toEqual({ x: 600, y: 40 })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    const beforeHiddenMove = draw.mock.calls.length
    move(200, 60)
    expect(draw).toHaveBeenCalledTimes(beforeHiddenMove)
    expect(frames.size).toBe(0)
    hidden.mockRestore()
    controller.destroy()
    move(30, 50)
    playfield.dispatchEvent(new Event('pointerleave'))
    expect(draw).toHaveBeenCalledTimes(beforeHiddenMove)
  })

  it('has no idle animation, pauses on blur, explicitly resumes, and cleans up', () => {
    const { controller, onView, scoreLabel } = mount()
    expect(frames.size).toBe(0)
    controller.jump()
    expect(frames.size).toBe(1)
    frame(0); frame(100)
    expect(scoreLabel.textContent).not.toBe('00000')
    window.dispatchEvent(new Event('blur'))
    expect(frames.size).toBe(0)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'paused' }))
    window.dispatchEvent(new Event('focus'))
    expect(frames.size).toBe(0)
    controller.resume()
    expect(frames.size).toBe(1)
    controller.destroy()
    expect(frames.size).toBe(0)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(motionRemove).toHaveBeenCalledOnce()
    const calls = onView.mock.calls.length
    controller.jump(); resize([], {} as ResizeObserver); motionChange()
    window.dispatchEvent(new Event('blur'))
    expect(onView).toHaveBeenCalledTimes(calls)
    expect(frames.size).toBe(0)
  })

  it('pauses in hidden documents and when the available size is too small', () => {
    const { controller, onView, rect } = mount()
    controller.jump()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    controller.resume()
    expect(frames.size).toBe(0)
    hidden.mockRestore()
    controller.resume()
    rect.mockReturnValue({ width: 250, height: 90 } as DOMRect)
    resize([], {} as ResizeObserver)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ tooSmall: true, phase: 'paused' }))
    expect(frames.size).toBe(0)
    controller.jump()
    expect(frames.size).toBe(0)
    rect.mockReturnValue({ width: 720, height: 220 } as DOMRect)
    resize([], {} as ResizeObserver)
    expect(frames.size).toBe(0)
    controller.destroy()
  })

  it('contains animation and canvas failures', () => {
    const { controller, canvas, onFailure } = mount()
    const context = canvas.getContext('2d')!
    vi.mocked(context.clearRect).mockImplementation(() => { throw new Error('drawing failed') })
    controller.jump(); frame(0)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    controller.destroy()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    const failed = mount()
    expect(failed.onFailure).toHaveBeenCalledOnce()
    failed.controller.destroy()
  })

  it('reflects a best from another window and bounds canvas allocation', () => {
    vi.stubGlobal('devicePixelRatio', 5)
    const { controller, bestLabel, canvas, rect } = mount()
    const newBest = String(readBestScore() + 999)
    localStorage.setItem(BEST_SCORE_KEY, newBest)
    window.dispatchEvent(new StorageEvent('storage', { key: BEST_SCORE_KEY, newValue: newBest }))
    expect(bestLabel.textContent).toBe(newBest.padStart(5, '0'))
    rect.mockReturnValue({ width: 6000, height: 4000 } as DOMRect)
    resize([], {} as ResizeObserver)
    expect(canvas.width).toBeLessThanOrEqual(3200)
    expect(canvas.height).toBeLessThanOrEqual(1200)
    expect(frames.size).toBe(0)
    controller.destroy()
  })

  it('ends, saves and restarts without accumulating animation loops', () => {
    const { controller, onView } = mount()
    controller.jump()
    for (let time = 0; time < 8000; time += 16) frame(time)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'over' }))
    expect(frames.size).toBe(0)
    controller.jump(); controller.jump()
    expect(frames.size).toBe(1)
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'running', score: 0 }))
    controller.destroy()
  })
})
