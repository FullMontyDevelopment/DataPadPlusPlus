import { describe, expect, it } from 'vitest'
import { TabMutationCoordinator } from '../../../src/app/state/tab-mutation-coordinator'

describe('tab mutation coordinator', () => {
  it('prevents a delayed pre-close update from reapplying a closed tab', () => {
    const coordinator = new TabMutationCoordinator()
    const update = coordinator.beginMutation('tab-a')

    expect(update).toBeDefined()
    expect(coordinator.beginClose(['tab-a'])).toEqual(['tab-a'])
    coordinator.acceptClosed(['tab-a'])
    coordinator.finishClose(['tab-a'])

    expect(coordinator.canApply(update!)).toBe(false)
  })

  it('releases successful, skipped, and failed close attempts', () => {
    const coordinator = new TabMutationCoordinator()
    const firstAttempt = coordinator.beginClose(['closed', 'locked', 'failed'])

    expect(coordinator.beginClose(['closed', 'locked', 'failed'])).toEqual([])
    coordinator.acceptClosed(['closed'])
    coordinator.finishClose(firstAttempt)

    expect(coordinator.beginClose(['closed', 'locked', 'failed'])).toEqual([
      'closed',
      'locked',
      'failed',
    ])
  })

  it('keeps a surviving tab mutable and closeable after a skipped attempt', () => {
    const coordinator = new TabMutationCoordinator()
    const firstAttempt = coordinator.beginClose(['tab-running'])
    coordinator.finishClose(firstAttempt)

    const update = coordinator.beginMutation('tab-running')
    expect(update).toBeDefined()
    expect(coordinator.canApply(update!)).toBe(true)
    expect(coordinator.beginClose(['tab-running'])).toEqual(['tab-running'])
  })
})
