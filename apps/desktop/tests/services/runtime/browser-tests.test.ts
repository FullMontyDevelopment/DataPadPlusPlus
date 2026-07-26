import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import {
  cancelTestRunLocally,
  createTestSuiteTabInSnapshot,
  executeTestSuiteLocally,
  openTestSuiteCaseInSnapshot,
  planTestSuiteRunLocally,
  updateTestSuiteTabInSnapshot,
} from '../../../src/services/runtime/browser-tests'

describe('browser test-suite runtime', () => {
  it('rejects test-suite entry points while the plugin is disabled', () => {
    expect(() =>
      createTestSuiteTabInSnapshot(createSeedSnapshot(), {
        connectionId: 'conn-catalog',
      }),
    ).toThrow(/Enable the experimental Datastore Tests plugin/)
  })

  it('creates one Library-saveable test tab per connection/template', () => {
    const snapshot = enabledSnapshot()
    const opened = createTestSuiteTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
      templateId: 'mongodb-smoke-suite',
    })
    const testTab = opened.tabs.find((tab) => tab.tabKind === 'test-suite')

    expect(testTab).toMatchObject({
      connectionId: 'conn-catalog',
      dirty: true,
      editorLabel: 'Catalog Mongo · products tests',
      language: 'json',
      status: 'idle',
    })
    expect(testTab?.title).toMatch(/\.datapad-test\.json$/)
    expect(testTab?.testSuite?.engine).toBe('mongodb')
    expect(opened.ui.activeActivity).toBe('library')
    expect(opened.ui.activeSidebarPane).toBe('library')
    expect(opened.ui.rightDrawer).toBe('none')

    const reopened = createTestSuiteTabInSnapshot(opened, {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
      templateId: 'mongodb-smoke-suite',
    })

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'test-suite')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(testTab?.id)
  })

  it('keeps visual suite state when raw JSON is invalid', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')

    expect(tab).toBeDefined()

    const updated = updateTestSuiteTabInSnapshot(opened, {
      tabId: tab!.id,
      rawText: '{ invalid json',
    })
    const updatedTab = updated.tabs.find((item) => item.id === tab!.id)

    expect(updatedTab?.queryText).toBe('{ invalid json')
    expect(updatedTab?.testSuite).toEqual(tab?.testSuite)
    expect(updatedTab?.error?.code).toBe('test-suite-json-invalid')
  })

  it('changes the active case without marking unchanged suite content dirty', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')!
    const secondCase = {
      ...structuredClone(tab.testSuite!.cases[0]!),
      id: 'case-second',
      name: 'second case',
    }
    tab.testSuite!.cases.push(secondCase)
    tab.dirty = false

    const updated = updateTestSuiteTabInSnapshot(opened, {
      tabId: tab.id,
      activeTestCaseId: secondCase.id,
    })
    const updatedTab = updated.tabs.find((item) => item.id === tab.id)

    expect(updatedTab?.activeTestCaseId).toBe(secondCase.id)
    expect(updatedTab?.dirty).toBe(false)
  })

  it('opens a suite-owned case atomically and rejects unrelated case ids', () => {
    const snapshot = enabledSnapshot()
    const suite = {
      id: 'suite-library',
      name: 'Library suite',
      engine: 'mongodb' as const,
      family: 'document' as const,
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
      cases: [{
        id: 'case-owned',
        name: 'owned case',
        enabled: true,
        setup: [],
        execute: [],
        assertions: [],
        teardown: [],
      }],
    }
    snapshot.libraryNodes.push({
      id: 'library-suite',
      kind: 'test-suite',
      name: suite.name,
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
      language: 'mongodb',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      testSuite: suite,
    })

    const opened = openTestSuiteCaseInSnapshot(snapshot, {
      libraryItemId: 'library-suite',
      caseId: 'case-owned',
    })

    expect(opened.tabs.find((tab) => tab.tabKind === 'test-suite')?.activeTestCaseId)
      .toBe('case-owned')
    expect(() => openTestSuiteCaseInSnapshot(snapshot, {
      libraryItemId: 'library-suite',
      caseId: 'case-other',
    })).toThrow(/does not belong/)
  })

  it('generates a starter request for the selected collection', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')
    const executeText = tab?.testSuite?.cases[0]?.execute[0]?.queryText

    expect(executeText).toContain('"collection": "products"')
    expect(executeText).toContain('"database": "catalog"')
  })

  it('blocks execution in browser preview instead of simulating a passing run', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      scopedTarget: postgresTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')

    expect(tab).toBeDefined()

    expect(() => executeTestSuiteLocally(opened, { tabId: tab!.id })).toThrow(
      /requires the desktop app/,
    )
  })

  it('marks an active test run as canceled without removing results', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      scopedTarget: postgresTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')!
    tab.testRun = {
      id: 'test-run-active',
      suiteId: tab.testSuite!.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      warnings: [],
      cases: [],
    }
    const canceled = cancelTestRunLocally(opened, {
      tabId: tab.id,
      runId: 'test-run-active',
    })
    const canceledTab = canceled.snapshot.tabs.find((item) => item.id === tab.id)

    expect(canceled.ok).toBe(true)
    expect(canceledTab?.testRun?.status).toBe('canceled')
    expect(canceledTab?.status).toBe('blocked')
  })

  it('rejects immutable binding edits and normalizes serialized languages', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-analytics',
      environmentId: 'env-dev',
      scopedTarget: postgresTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')!
    const conflictingLanguage = structuredClone(tab.testSuite!)
    conflictingLanguage.cases[0]!.execute[0]!.language = 'mongodb'

    const normalized = updateTestSuiteTabInSnapshot(opened, {
      tabId: tab.id,
      suite: conflictingLanguage,
    })
    expect(
      normalized.tabs.find((item) => item.id === tab.id)
        ?.testSuite?.cases[0]?.execute[0]?.language,
    ).toBe('sql')

    expect(() =>
      updateTestSuiteTabInSnapshot(opened, {
        tabId: tab.id,
        suite: {
          ...structuredClone(tab.testSuite!),
          scopedTarget: mongoTarget,
        },
      }),
    ).toThrow(/datastore-test-binding-immutable/)
  })

  it('includes the immutable binding in browser preflight responses', () => {
    const opened = createTestSuiteTabInSnapshot(enabledSnapshot(), {
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')!
    const plan = planTestSuiteRunLocally(opened, { tabId: tab.id })

    expect(plan).toMatchObject({
      connectionId: 'conn-catalog',
      environmentId: 'env-dev',
      scopedTarget: mongoTarget,
      inferredLanguage: 'mongodb',
      status: 'blocked',
    })
  })
})

const mongoTarget = {
  kind: 'collection',
  label: 'products',
  path: ['catalog'],
  scope: 'database:catalog:collection:products',
}

const postgresTarget = {
  kind: 'table',
  label: 'orders',
  path: ['public'],
  scope: 'table:public.orders',
}

function enabledSnapshot() {
  const snapshot = createSeedSnapshot()
  snapshot.preferences.datastoreTests = { enabled: true }
  return snapshot
}
