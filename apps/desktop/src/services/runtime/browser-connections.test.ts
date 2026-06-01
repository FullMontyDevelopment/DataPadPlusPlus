import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../test/fixtures/seed-workspace'
import {
  deleteConnection,
  deleteEnvironment,
  setActiveConnection,
  upsertConnection,
} from './browser-connections'

describe('browser connection runtime', () => {
  it('selects a connection without creating a query tab when none exists', () => {
    const snapshot = createSeedSnapshot()
    snapshot.tabs = snapshot.tabs.filter((tab) => tab.connectionId !== 'conn-analytics')
    snapshot.ui.activeConnectionId = 'conn-orders'
    snapshot.ui.activeEnvironmentId = 'env-uat'
    snapshot.ui.activeTabId = 'tab-orders-audit'

    const tabCount = snapshot.tabs.length
    const next = setActiveConnection(snapshot, 'conn-analytics')

    expect(next.tabs).toHaveLength(tabCount)
    expect(next.ui.activeConnectionId).toBe('conn-analytics')
    expect(next.ui.activeEnvironmentId).toBe('env-dev')
    expect(next.ui.activeTabId).toBe('')
  })

  it('ignores stale connection selection instead of falling back to another connection', () => {
    const snapshot = createSeedSnapshot()
    snapshot.ui.activeConnectionId = 'conn-orders'
    snapshot.ui.activeEnvironmentId = 'env-uat'
    snapshot.ui.activeTabId = 'tab-orders-audit'

    const next = setActiveConnection(snapshot, 'missing-connection')

    expect(next.ui.activeConnectionId).toBe('conn-orders')
    expect(next.ui.activeEnvironmentId).toBe('env-uat')
    expect(next.ui.activeTabId).toBe('tab-orders-audit')
  })

  it('ignores stale connection deletion without changing active workspace state', () => {
    const snapshot = createSeedSnapshot()
    snapshot.ui.activeConnectionId = 'conn-orders'
    snapshot.ui.activeEnvironmentId = 'env-uat'
    snapshot.ui.activeTabId = 'tab-orders-audit'

    const next = deleteConnection(snapshot, 'missing-connection')

    expect(next.connections).toHaveLength(snapshot.connections.length)
    expect(next.tabs).toHaveLength(snapshot.tabs.length)
    expect(next.ui.activeConnectionId).toBe('conn-orders')
    expect(next.ui.activeEnvironmentId).toBe('env-uat')
    expect(next.ui.activeTabId).toBe('tab-orders-audit')
  })

  it('does not keep a dangling connection-string mode after stripping plaintext secrets', () => {
    const snapshot = createSeedSnapshot()
    const sourceConnection = snapshot.connections[0]
    expect(sourceConnection).toBeDefined()

    const next = upsertConnection(snapshot, {
      ...sourceConnection!,
      id: 'conn-unsafe-string',
      name: 'Unsafe string',
      connectionMode: 'connection-string',
      connectionString: 'mongodb://user:plain-secret@localhost/catalog',
    })

    const storedConnection = next.connections.find((item) => item.id === 'conn-unsafe-string')
    expect(storedConnection?.connectionString).toBeUndefined()
    expect(storedConnection?.connectionMode).toBe('native')
  })

  it('deletes an environment and moves references to a fallback environment', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')

    snapshot.ui.activeEnvironmentId = 'env-prod'
    snapshot.libraryNodes = [
      {
        id: 'library-query-orders-audit',
        kind: 'query',
        name: 'Orders audit',
        tags: [],
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        environmentId: 'env-prod',
        language: 'sql',
        queryText: 'select 1;',
      },
    ]
    if (connection) {
      connection.environmentIds = ['env-prod']
    }
    const firstTab = snapshot.tabs[0]
    expect(firstTab).toBeDefined()
    firstTab!.environmentId = 'env-prod'

    const next = deleteEnvironment(snapshot, 'env-prod')

    expect(next.environments.some((environment) => environment.id === 'env-prod')).toBe(false)
    expect(next.ui.activeEnvironmentId).not.toBe('env-prod')
    expect(next.connections.find((item) => item.id === 'conn-orders')?.environmentIds).not.toContain(
      'env-prod',
    )
    expect(next.tabs[0]?.environmentId).not.toBe('env-prod')
    expect(next.libraryNodes.find((item) => item.id === 'library-query-orders-audit')?.environmentId).toBeUndefined()
  })

  it('keeps at least one environment', () => {
    const snapshot = createSeedSnapshot()
    const firstEnvironment = snapshot.environments[0]
    expect(firstEnvironment).toBeDefined()
    snapshot.environments = [firstEnvironment!]

    expect(() => deleteEnvironment(snapshot, firstEnvironment!.id)).toThrow(
      'At least one environment is required.',
    )
  })
})
