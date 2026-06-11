import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import {
  activeConnectionForSnapshot,
  activeEnvironmentForSnapshot,
  findConnection,
  findEnvironment,
} from '../../../src/app/state/app-state-selectors'

describe('app-state selectors', () => {
  it('keeps exact lookup separate from active fallback selection', () => {
    const snapshot = createSeedSnapshot()
    snapshot.ui.activeConnectionId = 'missing-connection'
    snapshot.ui.activeEnvironmentId = 'missing-environment'

    expect(findConnection(snapshot, 'missing-connection')).toBeUndefined()
    expect(findEnvironment(snapshot, 'missing-environment')).toBeUndefined()
    expect(activeConnectionForSnapshot(snapshot)?.id).toBe(snapshot.connections[0]?.id)
    expect(activeEnvironmentForSnapshot(snapshot)?.id).toBe(snapshot.environments[0]?.id)
  })
})
