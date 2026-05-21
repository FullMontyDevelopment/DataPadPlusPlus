import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../test/fixtures/seed-workspace'
import {
  evaluateGuardrails,
  migrateWorkspaceSnapshot,
  normalizeUiState,
  resolveEnvironment,
} from './helpers'

describe('resolveEnvironment', () => {
  it('resolves inherited variables for prod', () => {
    const snapshot = createSeedSnapshot()
    const resolved = resolveEnvironment(snapshot.environments, 'env-prod')

    expect(resolved.variables.DB_HOST).toBe('analytics-prod.internal')
    expect(resolved.variables.DB_NAME).toBe('datapadplusplus_dev')
    expect(resolved.inheritedChain).toEqual(['Dev', 'Prod'])
  })
})

describe('evaluateGuardrails', () => {
  it('blocks writes on read-only connections', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')
    const environment = snapshot.environments.find((item) => item.id === 'env-uat')
    const resolved = resolveEnvironment(snapshot.environments, 'env-uat')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'delete from dbo.orders where order_id = 1;',
      true,
    )

    expect(decision.status).toBe('block')
  })

  it('requires confirmation for critical production work before execution', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')
    const environment = snapshot.environments.find((item) => item.id === 'env-prod')
    const resolved = resolveEnvironment(snapshot.environments, 'env-prod')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'select * from observability.table_health;',
      true,
    )

    expect(decision.status).toBe('confirm')
    expect(decision.requiredConfirmationText).toBe('CONFIRM Prod')
  })

  it('requires confirmation for risky writes when safe mode is enabled', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')
    const environment = snapshot.environments.find((item) => item.id === 'env-dev')
    const resolved = resolveEnvironment(snapshot.environments, 'env-dev')

    expect(connection).toBeDefined()
    expect(environment).toBeDefined()

    const decision = evaluateGuardrails(
      connection!,
      environment!,
      resolved,
      'update accounts set status = "inactive" where id = 1;',
      true,
    )

    expect(decision.status).toBe('confirm')
    expect(decision.reasons).toContain(
      'Global safe mode requires confirmation for risky work.',
    )
  })
})

describe('migrateWorkspaceSnapshot', () => {
  it('maps legacy ui state into ADS workbench defaults', () => {
    const snapshot = createSeedSnapshot()
    const legacy = {
      ...snapshot,
      schemaVersion: 1,
      ui: {
        activeConnectionId: snapshot.ui.activeConnectionId,
        activeEnvironmentId: snapshot.ui.activeEnvironmentId,
        activeTabId: snapshot.ui.activeTabId,
        explorerFilter: 'orders',
        commandPaletteOpen: true,
        diagnosticsOpen: true,
      },
    } as unknown as typeof snapshot

    const migrated = migrateWorkspaceSnapshot(legacy)

    expect(migrated.schemaVersion).toBe(9)
    expect(migrated.ui.activeActivity).toBe('library')
    expect(migrated.ui.activeSidebarPane).toBe('library')
    expect(migrated.ui.sidebarWidth).toBe(280)
    expect(migrated.ui.bottomPanelVisible).toBe(false)
    expect(migrated.ui.activeBottomPanelTab).toBe('results')
    expect(migrated.ui.rightDrawer).toBe('none')
    expect(migrated.ui.rightDrawerWidth).toBe(360)
    expect(migrated.ui.explorerFilter).toBe('orders')
    expect(migrated.ui.connectionGroupMode).toBe('none')
    expect(migrated.ui.sidebarSectionStates).toEqual({})
    expect(migrated.libraryNodes.some((node) => node.id === 'library-root-tests')).toBe(false)
  })

  it('migrates legacy saved work into Library nodes and maps saved-work UI state', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      connections: [],
      environments: snapshot.environments,
      tabs: [
        {
          ...snapshot.tabs[0]!,
          id: 'tab-custom',
          savedQueryId: 'saved-query',
          saveTarget: undefined,
        },
      ],
      savedWork: [
        {
          id: 'saved-query',
          kind: 'query',
          name: 'Daily orders',
          summary: 'Orders by day',
          tags: ['orders'],
          updatedAt: '2026-05-14T00:00:00.000Z',
          folder: 'Reports/Daily',
          environmentId: 'env-prod',
          language: 'sql',
          queryText: 'select 1;',
        },
      ],
      ui: {
        ...snapshot.ui,
        activeActivity: 'saved-work',
        activeSidebarPane: 'saved-work',
      },
    } as unknown as typeof snapshot)

    expect(migrated.ui.activeActivity).toBe('library')
    expect(migrated.ui.activeSidebarPane).toBe('library')
    expect(migrated.libraryNodes.some((node) => node.name === 'Reports')).toBe(true)
    expect(migrated.libraryNodes.some((node) => node.name === 'Daily orders')).toBe(true)
    expect(migrated.tabs[0]?.saveTarget).toEqual({
      kind: 'library',
      libraryItemId: migrated.tabs[0]?.savedQueryId,
    })
  })

  it('migrates connection strings into the connection-string method', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      connections: [
        {
          ...snapshot.connections[0]!,
          id: 'conn-string-profile',
          connectionString: 'postgresql://user:${PASSWORD}@localhost:5432/app',
          connectionMode: undefined,
        },
      ],
      tabs: [],
      closedTabs: [],
    } as unknown as typeof snapshot)

    expect(migrated.connections[0]?.connectionMode).toBe('connection-string')
    expect(
      migrated.libraryNodes.some(
        (node) =>
          node.kind === 'connection' && node.connectionId === 'conn-string-profile',
      ),
    ).toBe(true)
  })

  it('preserves persisted sidebar display state when migrating workspace state', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        connectionGroupMode: 'database-type',
        sidebarSectionStates: {
          'connections:database-type:sql': false,
          'search:commands': true,
        },
      },
    })

    expect(migrated.ui.connectionGroupMode).toBe('database-type')
    expect(migrated.ui.sidebarSectionStates).toEqual({
      'connections:database-type:sql': false,
      'search:commands': true,
    })
  })

  it('unlocks legacy snapshots so the removed lock UI cannot strand the workspace', () => {
    const snapshot = createSeedSnapshot()
    const migrated = migrateWorkspaceSnapshot({
      ...snapshot,
      lockState: {
        isLocked: true,
        lockedAt: '2026-05-16T10:00:00.000Z',
      },
    })

    expect(migrated.lockState).toEqual({ isLocked: false, lockedAt: undefined })
  })

  it('strips known demo records from untouched seeded snapshots', () => {
    const migrated = migrateWorkspaceSnapshot(createSeedSnapshot())

    expect(migrated.connections).toHaveLength(0)
    expect(migrated.environments).toHaveLength(0)
    expect(migrated.tabs).toHaveLength(0)
    expect(migrated.closedTabs).toHaveLength(0)
    expect(migrated.savedWork).toHaveLength(0)
    expect(migrated.libraryNodes).toHaveLength(0)
    expect(migrated.explorerNodes).toHaveLength(0)
    expect(migrated.guardrails).toHaveLength(0)
    expect(migrated.ui.activeConnectionId).toBe('')
    expect(migrated.ui.activeEnvironmentId).toBe('')
    expect(migrated.ui.activeTabId).toBe('')
    expect(migrated.ui.bottomPanelVisible).toBe(false)
  })
})

describe('normalizeUiState', () => {
  it('clamps layout inputs and rejects unknown persisted UI values', () => {
    const snapshot = createSeedSnapshot()
    const normalized = normalizeUiState({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        activeActivity: 'invalid-activity',
        activeSidebarPane: 'invalid-pane',
        activeBottomPanelTab: 'invalid-tab',
        bottomPanelHeight: Number.NaN,
        sidebarWidth: 9999,
        rightDrawer: 'surprise-drawer',
        rightDrawerWidth: 12,
        connectionGroupMode: 'cluster-by-mood',
        sidebarSectionStates: {
          'connections:none:all': true,
          'connections:none:bad': 'open',
        },
      },
    } as unknown as typeof snapshot)

    expect(normalized.activeActivity).toBe('library')
    expect(normalized.activeSidebarPane).toBe('library')
    expect(normalized.activeBottomPanelTab).toBe('results')
    expect(normalized.bottomPanelHeight).toBe(260)
    expect(normalized.sidebarWidth).toBe(420)
    expect(normalized.rightDrawer).toBe('none')
    expect(normalized.rightDrawerWidth).toBe(320)
    expect(normalized.connectionGroupMode).toBe('none')
    expect(normalized.sidebarSectionStates).toEqual({ 'connections:none:all': true })
  })

  it('preserves query history as a first-class bottom panel tab', () => {
    const snapshot = createSeedSnapshot()
    const normalized = normalizeUiState({
      ...snapshot,
      ui: {
        ...snapshot.ui,
        activeBottomPanelTab: 'history',
        bottomPanelVisible: true,
      },
    })

    expect(normalized.activeBottomPanelTab).toBe('history')
    expect(normalized.bottomPanelVisible).toBe(true)
  })
})
