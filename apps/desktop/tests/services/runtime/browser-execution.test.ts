import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import { applyExecutionRequestLocally } from '../../../src/services/runtime/browser-execution'

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

  it('preserves a tab query view mode when execution omits an input mode', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-mongo-catalog')

    if (!tab) {
      throw new Error('Expected seed MongoDB query tab.')
    }

    tab.queryViewMode = 'builder'

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: tab.queryText,
    })

    expect(executed.tabs.find((item) => item.id === tab.id)?.queryViewMode).toBe('builder')
  })

  it('updates a tab query view mode when execution declares the active input mode', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-mongo-catalog')

    if (!tab) {
      throw new Error('Expected seed MongoDB query tab.')
    }

    tab.queryViewMode = 'builder'

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      executionInputMode: 'raw',
      language: tab.language,
      queryText: tab.queryText,
    })

    expect(executed.tabs.find((item) => item.id === tab.id)?.queryViewMode).toBe('raw')
  })

  it('rejects stale execution ids instead of falling back to the first tab or connection', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-sql-ops')

    if (!tab) {
      throw new Error('Expected seed query tab.')
    }

    expect(() =>
      applyExecutionRequestLocally(snapshot, {
        tabId: 'missing-tab',
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        language: tab.language,
        queryText: tab.queryText,
      }),
    ).toThrow('Unable to resolve the active execution context.')

    expect(() =>
      applyExecutionRequestLocally(snapshot, {
        tabId: tab.id,
        connectionId: 'missing-connection',
        environmentId: tab.environmentId,
        language: tab.language,
        queryText: tab.queryText,
      }),
    ).toThrow('Unable to resolve the active execution context.')
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

  it('returns deterministic profile payloads in browser preview', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-commerce-mysql')

    if (!tab) {
      throw new Error('Expected seed SQL query tab.')
    }

    const { snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      language: tab.language,
      queryText: 'select sku from inventory_items limit 10',
      mode: 'profile',
    })
    const result = executed.tabs.find((item) => item.id === tab.id)?.result

    expect(result?.defaultRenderer).toBe('profile')
    expect(result?.rendererModes[0]).toBe('profile')
    expect(result?.payloads[0]).toMatchObject({
      renderer: 'profile',
      summary: expect.stringContaining('profile preview'),
    })
  })

  it('blocks browser preview execution that references secret environment variables', () => {
    const snapshot = createSeedSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === 'tab-sql-ops')

    if (!tab) {
      throw new Error('Expected seed query tab.')
    }

    snapshot.environments = [{
      id: 'env-secret',
      label: 'Secret preview',
      color: '#2dbf9b',
      risk: 'low',
      variables: {},
      sensitiveKeys: ['API_TOKEN'],
      variableDefinitions: [{
        key: 'API_TOKEN',
        kind: 'secret',
        secretRef: {
          id: 'secret-env-secret-api-token',
          provider: 'os-keyring',
          service: 'DataPad++',
          account: 'environment:env-secret:API_TOKEN',
          label: 'API token',
        },
      }],
      requiresConfirmation: false,
      safeMode: false,
      exportable: true,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    }]

    const { response, snapshot: executed } = applyExecutionRequestLocally(snapshot, {
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: 'env-secret',
      language: tab.language,
      queryText: "select '{{API_TOKEN}}'",
    })

    expect(response.guardrail.status).toBe('block')
    expect(response.diagnostics).toEqual([
      'Secret environment variables are not substituted in browser preview.',
    ])
    expect(executed.tabs.find((item) => item.id === tab.id)?.status).toBe('blocked')
    expect(JSON.stringify(response)).not.toContain('********')
  })
})
