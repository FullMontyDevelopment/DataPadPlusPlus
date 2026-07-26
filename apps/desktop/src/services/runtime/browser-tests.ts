import type {
  CancelTestRunRequest,
  ConnectionProfile,
  CreateTestSuiteTabRequest,
  DatastoreTestAssertion,
  DatastoreTestRunPlanRequest,
  DatastoreTestRunPlanResponse,
  DatastoreTestStep,
  DatastoreTestSuiteDefinition,
  DatastoreTestSuiteTemplateDefinition,
  ExecuteTestSuiteRequest,
  ExecuteTestSuiteResponse,
  OpenTestSuiteCaseRequest,
  OpenTestSuiteTemplateRequest,
  QueryTabState,
  ScopedQueryTarget,
  UpdateTestSuiteTabRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { datastoreTestTemplatesForEngine } from '@datapadplusplus/shared-types'
import {
  createId,
  languageForConnection,
} from '../../app/state/helpers'
import { datastoreTestStarterQuery } from './datastore-test-target-providers'
import { cloneSnapshot, findConnection, findTab } from './browser-store'
import { effectiveConnectionEnvironmentId } from './library-connection-helpers'
import { openLibraryItem } from './browser-library'

export function createTestSuiteTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: CreateTestSuiteTabRequest,
): WorkspaceSnapshot {
  ensureDatastoreTestsEnabled(snapshot)
  const next = cloneSnapshot(snapshot)
  const connection = findConnection(next, request.connectionId)

  if (!connection) {
    return next
  }
  if (
    !request.environmentId ||
    !connection.environmentIds.includes(request.environmentId) ||
    !next.environments.some(
      (environment) => environment.id === request.environmentId,
    )
  ) {
    throw new Error(
      'datastore-test-environment-invalid: Choose an environment assigned to the selected datastore connection.',
    )
  }
  if (!request.scopedTarget?.kind?.trim() || !request.scopedTarget.label?.trim()) {
    throw new Error('datastore-test-target-required')
  }

  const environmentId = effectiveConnectionEnvironmentId(
    next,
    connection,
    request.environmentId,
  )
  if (request.suite) {
    assertSuiteCreationBinding(
      request.suite,
      connection,
      environmentId,
      request.scopedTarget,
    )
  }
  const suite = normalizeSuite(
    request.suite ?? (
      request.templateId
        ? templateSuiteForConnection(connection, request.scopedTarget, request.templateId)
        : emptySuite(connection, request.scopedTarget)
    ),
    connection,
    environmentId,
    request.scopedTarget,
  )
  const existingTab = next.tabs.find(
    (tab) =>
      tab.tabKind === 'test-suite' &&
      tab.testSuite?.id === suite.id &&
      tab.connectionId === connection.id &&
      tab.environmentId === environmentId &&
      JSON.stringify(tab.scopedTarget) === JSON.stringify(request.scopedTarget),
  )

  if (existingTab) {
    next.ui.activeTabId = existingTab.id
    next.ui.activeConnectionId = existingTab.connectionId
    next.ui.activeEnvironmentId = existingTab.environmentId
    return next
  }

  const boundSuite = {
    ...suite,
    connectionId: connection.id,
    environmentId,
    engine: connection.engine,
    family: connection.family,
    scopedTarget: structuredClone(request.scopedTarget),
  }
  const tab: QueryTabState = {
    id: createId('test-tab'),
    title: uniqueTestTabTitle(next, suite.name),
    tabKind: 'test-suite',
    connectionId: connection.id,
    environmentId,
    family: connection.family,
    language: 'json',
    editorLabel: `${connection.name} · ${request.scopedTarget.label} tests`,
    queryText: JSON.stringify(boundSuite, null, 2),
    scopedTarget: structuredClone(request.scopedTarget),
    testSuite: boundSuite,
    status: 'idle',
    dirty: true,
    history: [],
  }

  next.tabs.push(tab)
  next.ui.activeTabId = tab.id
  next.ui.activeConnectionId = tab.connectionId
  next.ui.activeEnvironmentId = tab.environmentId
  next.ui.activeActivity = 'library'
  next.ui.activeSidebarPane = 'library'
  next.ui.rightDrawer = 'none'
  next.updatedAt = new Date().toISOString()
  return next
}

export function openTestSuiteTemplateInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: OpenTestSuiteTemplateRequest,
): WorkspaceSnapshot {
  return createTestSuiteTabInSnapshot(snapshot, request)
}

export function openTestSuiteCaseInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: OpenTestSuiteCaseRequest,
): WorkspaceSnapshot {
  ensureDatastoreTestsEnabled(snapshot)
  const item = snapshot.libraryNodes.find(
    (node) => node.id === request.libraryItemId && node.kind === 'test-suite',
  )
  if (!item?.testSuite?.cases.some((testCase) => testCase.id === request.caseId)) {
    throw new Error('The selected test case does not belong to this suite.')
  }
  const next = openLibraryItem(snapshot, request.libraryItemId)
  const tab = findTab(next, next.ui.activeTabId)
  if (!tab || tab.tabKind !== 'test-suite') {
    throw new Error('Test suite tab was not found.')
  }
  tab.activeTestCaseId = request.caseId
  next.updatedAt = new Date().toISOString()
  return next
}

export function updateTestSuiteTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: UpdateTestSuiteTabRequest,
): WorkspaceSnapshot {
  ensureDatastoreTestsEnabled(snapshot)
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, request.tabId)

  if (!tab || tab.tabKind !== 'test-suite') {
    return next
  }

  let contentChanged = false
  if (request.suite) {
    const connection = findConnection(next, tab.connectionId)
    assertRequestedSuiteBinding(tab, request.suite)
    const suite = normalizeSuite(
      request.suite,
      connection,
      tab.environmentId,
      tab.scopedTarget,
    )
    assertImmutableSuiteBinding(tab, suite)
    tab.testSuite = suite
    tab.queryText = JSON.stringify(suite, null, 2)
    tab.error = undefined
    contentChanged = true
  } else if (request.rawText !== undefined) {
    tab.queryText = request.rawText
    contentChanged = true
    try {
      const parsedSuite = JSON.parse(request.rawText)
      assertRequestedSuiteBinding(tab, parsedSuite)
      const suite = normalizeSuite(
        parsedSuite,
        findConnection(next, tab.connectionId),
        tab.environmentId,
        tab.scopedTarget,
      )
      assertImmutableSuiteBinding(tab, suite)
      tab.testSuite = suite
      tab.error = undefined
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('datastore-test-binding-immutable')
      ) {
        throw error
      }
      tab.error = {
        code: 'test-suite-json-invalid',
        message: 'The raw test suite JSON is invalid. The visual suite was not overwritten.',
      }
    }
  }

  if (request.activeTestCaseId !== undefined) {
    if (!tab.testSuite?.cases.some((testCase) => testCase.id === request.activeTestCaseId)) {
      throw new Error('The selected test case does not belong to this suite.')
    }
    tab.activeTestCaseId = request.activeTestCaseId
  }

  if (contentChanged) {
    tab.dirty = true
    tab.status = 'idle'
  }
  next.updatedAt = new Date().toISOString()
  return next
}

export function executeTestSuiteLocally(
  snapshot: WorkspaceSnapshot,
  request: ExecuteTestSuiteRequest,
): { snapshot: WorkspaceSnapshot; response: ExecuteTestSuiteResponse } {
  void request
  ensureDatastoreTestsEnabled(snapshot)
  throw new Error(
    'Datastore test execution requires the desktop app; browser preview supports editing only.',
  )
}

export function planTestSuiteRunLocally(
  snapshot: WorkspaceSnapshot,
  request: DatastoreTestRunPlanRequest,
): DatastoreTestRunPlanResponse {
  ensureDatastoreTestsEnabled(snapshot)
  const tab = findTab(snapshot, request.tabId)
  if (!tab) {
    throw new Error('Test suite tab was not found.')
  }
  const connection = findConnection(snapshot, tab.connectionId)
  if (!connection || !tab.scopedTarget) {
    throw new Error('datastore-test-target-required')
  }
  return {
    planId: createId('test-plan'),
    suiteRevision: 'browser-preview',
    connectionId: connection.id,
    environmentId: tab.environmentId,
    scopedTarget: structuredClone(tab.scopedTarget),
    inferredLanguage: languageForConnection(connection),
    status: 'blocked',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    steps: [],
    blockers: [
      'Datastore test execution requires the desktop app; browser preview supports editing only.',
    ],
    warnings: [],
  }
}

export function cancelTestRunLocally(
  snapshot: WorkspaceSnapshot,
  request: CancelTestRunRequest,
): { snapshot: WorkspaceSnapshot; ok: boolean; supported: boolean; message: string } {
  const next = cloneSnapshot(snapshot)
  const tab = request.tabId ? findTab(next, request.tabId) : undefined

  if (tab?.testRun?.id === request.runId) {
    tab.testRun = { ...tab.testRun, status: 'canceled' }
    tab.status = 'blocked'
    next.updatedAt = new Date().toISOString()
  }

  return {
    snapshot: next,
    ok: true,
    supported: true,
    message: 'Test run cancellation requested.',
  }
}

function templateSuiteForConnection(
  connection: ConnectionProfile,
  scopedTarget: ScopedQueryTarget,
  templateId?: string,
): DatastoreTestSuiteDefinition | DatastoreTestSuiteTemplateDefinition {
  const templates = datastoreTestTemplatesForEngine(connection.engine, connection.family)
  const template = templateId
    ? templates.find((item) => item.id === templateId)
    : undefined
  const targetAwareSuite = emptySuite(connection, scopedTarget)
  if (!template) {
    return targetAwareSuite
  }

  return {
    ...targetAwareSuite,
    id: template.suite.id,
    name: template.suite.name,
    description: `${template.suite.description ?? template.description} The generated request is bound to the selected datastore target.`,
  }
}

function emptySuite(
  connection: ConnectionProfile,
  scopedTarget: ScopedQueryTarget,
): DatastoreTestSuiteTemplateDefinition {
  return {
    id: `${connection.engine}-custom-suite`,
    name: `${connection.name} test suite`,
    description: 'Custom datastore test suite.',
    engine: connection.engine,
    family: connection.family,
    connectionId: connection.id,
    scopedTarget: structuredClone(scopedTarget),
    inferredLanguage: languageForConnection(connection),
    variables: {},
    cases: [
      {
        id: createId('test-case'),
        name: 'new test case',
        enabled: true,
        setup: [],
        execute: [
          {
            id: createId('test-step'),
            label: 'Execute query',
            phase: 'execute',
            kind: 'query',
            enabled: true,
            language: languageForConnection(connection),
            queryText: datastoreTestStarterQuery(connection, scopedTarget),
          },
        ],
        assertions: [
          {
            id: createId('test-assertion'),
            label: 'No execution errors',
            kind: 'no-error',
            enabled: true,
            expected: true,
          },
        ],
        teardown: [],
      },
    ],
  }
}

function normalizeSuite(
  suite: DatastoreTestSuiteDefinition | DatastoreTestSuiteTemplateDefinition,
  connection?: ConnectionProfile,
  environmentId?: string,
  scopedTarget?: ScopedQueryTarget,
): DatastoreTestSuiteDefinition {
  if (!connection || !environmentId || !scopedTarget) {
    throw new Error('datastore-test-target-required')
  }
  const inferredLanguage = languageForConnection(connection)
  return {
    id: suite.id || createId('test-suite'),
    name: suite.name?.trim() || `${connection?.name ?? 'Datastore'} test suite`,
    description: suite.description,
    engine: suite.engine ?? connection.engine,
    family: suite.family ?? connection.family,
    connectionId: suite.connectionId ?? connection.id,
    environmentId: suite.environmentId ?? environmentId,
    scopedTarget: structuredClone(suite.scopedTarget ?? scopedTarget),
    inferredLanguage,
    variables: suite.variables ?? {},
    cases: (suite.cases ?? []).map((testCase) => ({
      ...testCase,
      id: testCase.id || createId('test-case'),
      name: testCase.name?.trim() || 'test case',
      enabled: testCase.enabled !== false,
      setup: normalizeSteps(testCase.setup, 'setup', inferredLanguage),
      execute: normalizeSteps(testCase.execute, 'execute', inferredLanguage),
      assertions: normalizeAssertions(testCase.assertions),
      teardown: normalizeSteps(testCase.teardown, 'teardown', inferredLanguage),
    })),
  }
}

function normalizeSteps(
  steps: DatastoreTestStep[],
  phase: DatastoreTestStep['phase'],
  inferredLanguage: QueryTabState['language'],
) {
  return (steps ?? []).map((step) => ({
    ...step,
    id: step.id || createId('test-step'),
    label: step.label?.trim() || `${phase} step`,
    phase,
    kind: step.kind ?? 'query',
    enabled: step.enabled !== false,
    language: inferredLanguage,
  }))
}

function normalizeAssertions(assertions: DatastoreTestAssertion[]) {
  return (assertions ?? []).map((assertion) => ({
    ...assertion,
    id: assertion.id || createId('test-assertion'),
    label: assertion.label?.trim() || assertion.kind,
    enabled: assertion.enabled !== false,
  }))
}

function uniqueTestTabTitle(snapshot: WorkspaceSnapshot, name: string) {
  const candidate = `${name}.datapad-test.json`
  if (!snapshot.tabs.some((tab) => tab.title === candidate)) {
    return candidate
  }

  let index = 2
  let title = `${name} ${index}.datapad-test.json`
  while (snapshot.tabs.some((tab) => tab.title === title)) {
    index += 1
    title = `${name} ${index}.datapad-test.json`
  }
  return title
}

function assertImmutableSuiteBinding(
  tab: QueryTabState,
  suite: DatastoreTestSuiteDefinition,
) {
  const current = tab.testSuite
  if (
    !current ||
    suite.connectionId !== current.connectionId ||
    suite.environmentId !== current.environmentId ||
    suite.engine !== current.engine ||
    suite.family !== current.family ||
    JSON.stringify(suite.scopedTarget) !== JSON.stringify(current.scopedTarget)
  ) {
    throw new Error(
      'datastore-test-binding-immutable: Test suite connection, environment, and target cannot be changed.',
    )
  }
}

function assertRequestedSuiteBinding(
  tab: QueryTabState,
  suite: DatastoreTestSuiteDefinition,
) {
  const current = tab.testSuite
  if (
    !current ||
    suite.connectionId !== current.connectionId ||
    suite.environmentId !== current.environmentId ||
    suite.engine !== current.engine ||
    suite.family !== current.family ||
    JSON.stringify(suite.scopedTarget) !== JSON.stringify(current.scopedTarget)
  ) {
    throw new Error(
      'datastore-test-binding-immutable: Test suite connection, environment, and target cannot be changed.',
    )
  }
}

function assertSuiteCreationBinding(
  suite: DatastoreTestSuiteDefinition,
  connection: ConnectionProfile,
  environmentId: string,
  scopedTarget: ScopedQueryTarget,
) {
  if (
    !suite.connectionId ||
    !suite.environmentId ||
    !suite.scopedTarget
  ) {
    throw new Error('datastore-test-target-required')
  }
  if (
    suite.connectionId !== connection.id ||
    suite.environmentId !== environmentId ||
    suite.engine !== connection.engine ||
    suite.family !== connection.family ||
    JSON.stringify(suite.scopedTarget) !== JSON.stringify(scopedTarget)
  ) {
    throw new Error(
      'datastore-test-binding-immutable: Test suite connection, environment, and target cannot be changed.',
    )
  }
}

function ensureDatastoreTestsEnabled(snapshot: WorkspaceSnapshot) {
  if (!snapshot.preferences.datastoreTests?.enabled) {
    throw new Error(
      'Enable the experimental Datastore Tests plugin in Settings before working with test suites.',
    )
  }
}
