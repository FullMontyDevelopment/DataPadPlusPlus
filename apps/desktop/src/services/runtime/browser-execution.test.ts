import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../test/fixtures/seed-workspace'
import { applyExecutionRequestLocally } from './browser-execution'

describe('browser execution runtime', () => {
  it('keeps dirty query tabs dirty after execution', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-sql-ops')

    if (!tab) {
      throw new Error('Expected seed query tab.')
    }

    tab.dirty = true

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: tab.queryText,
    })

    expect(executed.tabs.find((item) => item.id === tab.id)?.dirty).toBe(true)
  })

  it('keeps saved query tabs clean when execution does not change them', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-sql-ops')

    if (!tab) {
      throw new Error('Expected seed query tab.')
    }

    tab.dirty = false

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: tab.queryText,
    })

    expect(executed.tabs.find((item) => item.id === tab.id)?.dirty).toBe(false)
  })

  it('returns deterministic MongoDB explain plan payloads in browser preview', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-mongo-catalog')

    if (!tab) {
      throw new Error('Expected seed MongoDB query tab.')
    }

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: tab.queryText,
      mode: 'explain',
    })
    const result = executed.tabs.find((item) => item.id === tab.id)?.result

    expect(result?.defaultRenderer).toBe('plan')
    expect(result?.rendererModes).toEqual(['plan', 'json', 'raw'])
    expect(result?.payloads[0]).toMatchObject({
      renderer: 'plan',
      format: 'json',
      summary: 'MongoDB execution plan',
    })
    expect(result?.explainPayload).toMatchObject({ renderer: 'plan' })
  })
})
