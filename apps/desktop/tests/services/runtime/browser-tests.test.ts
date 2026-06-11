import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../../fixtures/seed-workspace'
import {
  cancelTestRunLocally,
  createTestSuiteTabInSnapshot,
  executeTestSuiteLocally,
  updateTestSuiteTabInSnapshot,
} from '../../../src/services/runtime/browser-tests'

describe('browser test-suite runtime', () => {
  it('creates one Library-saveable test tab per connection/template', () => {
    const snapshot = createSeedSnapshot()
    const opened = createTestSuiteTabInSnapshot(snapshot, {
      connectionId: 'conn-catalog',
      templateId: 'mongodb-smoke-suite',
    })
    const testTab = opened.tabs.find((tab) => tab.tabKind === 'test-suite')

    expect(testTab).toMatchObject({
      connectionId: 'conn-catalog',
      dirty: true,
      editorLabel: 'Catalog Mongo tests',
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
      templateId: 'mongodb-smoke-suite',
    })

    expect(reopened.tabs.filter((tab) => tab.tabKind === 'test-suite')).toHaveLength(1)
    expect(reopened.ui.activeTabId).toBe(testTab?.id)
  })

  it('keeps visual suite state when raw JSON is invalid', () => {
    const opened = createTestSuiteTabInSnapshot(createSeedSnapshot(), {
      connectionId: 'conn-catalog',
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

  it('does not invent a document collection name for custom test suites', () => {
    const opened = createTestSuiteTabInSnapshot(createSeedSnapshot(), {
      connectionId: 'conn-catalog',
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')
    const executeText = tab?.testSuite?.cases[0]?.execute[0]?.queryText

    expect(executeText).toContain('"collection": ""')
    expect(executeText).not.toContain('"collection": "products"')
  })

  it('runs setup, execute, assertions, and teardown into a test result', () => {
    const opened = createTestSuiteTabInSnapshot(createSeedSnapshot(), {
      connectionId: 'conn-analytics',
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')

    expect(tab).toBeDefined()

    const { snapshot, response } = executeTestSuiteLocally(opened, { tabId: tab!.id })
    const executedTab = snapshot.tabs.find((item) => item.id === tab!.id)

    expect(response.run.status).toBe('passed')
    expect(response.run.cases[0]?.steps.length).toBeGreaterThan(0)
    expect(response.run.cases[0]?.assertions[0]?.status).toBe('passed')
    expect(executedTab?.testRun?.id).toBe(response.run.id)
    expect(snapshot.ui.activeBottomPanelTab).toBe('results')
  })

  it('marks an active test run as canceled without removing results', () => {
    const opened = createTestSuiteTabInSnapshot(createSeedSnapshot(), {
      connectionId: 'conn-analytics',
    })
    const tab = opened.tabs.find((item) => item.tabKind === 'test-suite')!
    const executed = executeTestSuiteLocally(opened, { tabId: tab.id })
    const canceled = cancelTestRunLocally(executed.snapshot, {
      tabId: tab.id,
      runId: executed.response.run.id,
    })
    const canceledTab = canceled.snapshot.tabs.find((item) => item.id === tab.id)

    expect(canceled.ok).toBe(true)
    expect(canceledTab?.testRun?.status).toBe('canceled')
    expect(canceledTab?.status).toBe('blocked')
  })
})
