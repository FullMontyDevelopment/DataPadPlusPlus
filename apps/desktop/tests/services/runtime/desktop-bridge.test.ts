import { describe, expect, it, vi } from 'vitest'
import {
  createTaskbarQueryActivityUpdater,
  setTaskbarQueryActivity,
} from '../../../src/services/runtime/desktop-bridge'

function deferred() {
  let resolve = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('taskbar query activity updater', () => {
  it('suppresses updates while overlapping queries remain active', async () => {
    const invokeUpdate = vi.fn(async () => undefined)
    const updater = createTaskbarQueryActivityUpdater(invokeUpdate)

    await updater.update(1)
    await updater.update(2)
    await updater.update(1)
    await updater.update(0)

    expect(invokeUpdate.mock.calls).toEqual([[1], [0]])
  })

  it('serializes a final idle update behind an in-flight active update', async () => {
    const activeUpdate = deferred()
    const invokeUpdate = vi.fn(async (runningCount: number) => {
      if (runningCount > 0) {
        await activeUpdate.promise
      }
    })
    const updater = createTaskbarQueryActivityUpdater(invokeUpdate)

    const firstUpdate = updater.update(1)
    const finalUpdate = updater.update(0)
    expect(invokeUpdate.mock.calls).toEqual([[1]])

    activeUpdate.resolve()
    await Promise.all([firstUpdate, finalUpdate])

    expect(invokeUpdate.mock.calls).toEqual([[1], [0]])
  })

  it('keeps OS update failures non-fatal', async () => {
    const onError = vi.fn()
    const updater = createTaskbarQueryActivityUpdater(
      vi.fn().mockRejectedValue(new Error('OS integration unavailable')),
      onError,
    )

    await expect(updater.update(1)).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('is a no-op outside the Tauri runtime', async () => {
    delete window.__TAURI_INTERNALS__

    await expect(setTaskbarQueryActivity(1)).resolves.toBeUndefined()
  })
})
