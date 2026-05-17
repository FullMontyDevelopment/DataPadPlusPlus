import type {
  CancelTestRunRequest,
  ConnectionProfile,
  CreateTestSuiteTabRequest,
  DatastoreTestAssertion,
  DatastoreTestCaseDefinition,
  DatastoreTestRunResult,
  DatastoreTestStatus,
  DatastoreTestStep,
  DatastoreTestSuiteDefinition,
  ExecuteTestSuiteRequest,
  ExecuteTestSuiteResponse,
  OpenTestSuiteTemplateRequest,
  QueryTabState,
  UpdateTestSuiteTabRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { datastoreTestTemplatesForEngine } from '@datapadplusplus/shared-types'
import {
  createId,
  editorLabelForConnection,
  languageForConnection,
} from '../../app/state/helpers'
import { cloneSnapshot, findConnection, findEnvironment, findTab } from './browser-store'

export function createTestSuiteTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: CreateTestSuiteTabRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection = request.connectionId
    ? findConnection(next, request.connectionId)
    : findConnection(next, next.ui.activeConnectionId)

  if (!connection) {
    return next
  }

  const suite = normalizeSuite(
    request.suite ?? templateSuiteForConnection(connection, request.templateId),
    connection,
  )
  const existingTab = next.tabs.find(
    (tab) =>
      tab.tabKind === 'test-suite' &&
      tab.testSuite?.id === suite.id &&
      tab.connectionId === connection.id,
  )

  if (existingTab) {
    next.ui.activeTabId = existingTab.id
    next.ui.activeConnectionId = existingTab.connectionId
    next.ui.activeEnvironmentId = existingTab.environmentId
    return next
  }

  const environmentId =
    request.environmentId ??
    suite.environmentId ??
    connection.environmentIds[0] ??
    next.environments[0]?.id ??
    next.ui.activeEnvironmentId
  const tab: QueryTabState = {
    id: createId('test-tab'),
    title: uniqueTestTabTitle(next, suite.name),
    tabKind: 'test-suite',
    connectionId: connection.id,
    environmentId,
    family: connection.family,
    language: 'json',
    editorLabel: `${connection.name} tests`,
    queryText: JSON.stringify({ ...suite, connectionId: connection.id, environmentId }, null, 2),
    testSuite: { ...suite, connectionId: connection.id, environmentId },
    status: 'idle',
    dirty: true,
    history: [],
  }

  next.tabs.push(tab)
  next.ui.activeTabId = tab.id
  next.ui.activeConnectionId = tab.connectionId
  next.ui.activeEnvironmentId = tab.environmentId
  next.ui.activeActivity = 'tests'
  next.ui.activeSidebarPane = 'tests'
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

export function updateTestSuiteTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: UpdateTestSuiteTabRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, request.tabId)

  if (!tab || tab.tabKind !== 'test-suite') {
    return next
  }

  if (request.suite) {
    const suite = normalizeSuite(request.suite, findConnection(next, tab.connectionId))
    tab.testSuite = suite
    tab.queryText = JSON.stringify(suite, null, 2)
    tab.error = undefined
  } else if (request.rawText !== undefined) {
    tab.queryText = request.rawText
    try {
      tab.testSuite = normalizeSuite(JSON.parse(request.rawText), findConnection(next, tab.connectionId))
      tab.error = undefined
    } catch {
      tab.error = {
        code: 'test-suite-json-invalid',
        message: 'The raw test suite JSON is invalid. The visual suite was not overwritten.',
      }
    }
  }

  tab.dirty = true
  tab.status = 'idle'
  next.updatedAt = new Date().toISOString()
  return next
}

export function executeTestSuiteLocally(
  snapshot: WorkspaceSnapshot,
  request: ExecuteTestSuiteRequest,
): { snapshot: WorkspaceSnapshot; response: ExecuteTestSuiteResponse } {
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, request.tabId)

  if (!tab || tab.tabKind !== 'test-suite') {
    throw new Error('Test suite tab was not found.')
  }

  const connection = findConnection(next, tab.connectionId)
  const suite = normalizeSuite(tab.testSuite ?? JSON.parse(tab.queryText), connection)
  const run = buildRunResult(suite, request.caseId, connection, next)

  tab.testSuite = suite
  tab.testRun = run
  tab.status = run.status === 'passed' ? 'success' : run.status === 'blocked' ? 'blocked' : 'error'
  tab.lastRunAt = run.finishedAt
  tab.error =
    run.status === 'passed'
      ? undefined
      : { code: `test-suite-${run.status}`, message: `${run.failed} assertion(s) failed.` }
  tab.history.unshift({
    id: createId('history'),
    queryText: `Run test suite: ${suite.name}`,
    executedAt: run.startedAt,
    status: tab.status,
  })
  next.ui.activeTabId = tab.id
  next.ui.activeConnectionId = tab.connectionId
  next.ui.activeEnvironmentId = tab.environmentId
  next.ui.bottomPanelVisible = true
  next.ui.activeBottomPanelTab = 'results'
  next.updatedAt = new Date().toISOString()

  return {
    snapshot: next,
    response: {
      tab,
      run,
      diagnostics: run.warnings,
    },
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
  templateId?: string,
): DatastoreTestSuiteDefinition {
  const templates = datastoreTestTemplatesForEngine(connection.engine, connection.family)
  const template =
    templates.find((item) => item.id === templateId) ??
    templates[0]

  return template?.suite ?? emptySuite(connection)
}

function emptySuite(connection: ConnectionProfile): DatastoreTestSuiteDefinition {
  return {
    id: `${connection.engine}-custom-suite`,
    name: `${connection.name} test suite`,
    description: 'Custom datastore test suite.',
    engine: connection.engine,
    family: connection.family,
    connectionId: connection.id,
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
            queryText: defaultTestQuery(connection),
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
  suite: DatastoreTestSuiteDefinition,
  connection?: ConnectionProfile,
): DatastoreTestSuiteDefinition {
  return {
    id: suite.id || createId('test-suite'),
    name: suite.name?.trim() || `${connection?.name ?? 'Datastore'} test suite`,
    description: suite.description,
    engine: suite.engine ?? connection?.engine,
    family: suite.family ?? connection?.family,
    connectionId: suite.connectionId ?? connection?.id,
    environmentId: suite.environmentId,
    variables: suite.variables ?? {},
    cases: (suite.cases ?? []).map((testCase) => ({
      ...testCase,
      id: testCase.id || createId('test-case'),
      name: testCase.name?.trim() || 'test case',
      enabled: testCase.enabled !== false,
      setup: normalizeSteps(testCase.setup, 'setup'),
      execute: normalizeSteps(testCase.execute, 'execute'),
      assertions: normalizeAssertions(testCase.assertions),
      teardown: normalizeSteps(testCase.teardown, 'teardown'),
    })),
  }
}

function normalizeSteps(steps: DatastoreTestStep[], phase: DatastoreTestStep['phase']) {
  return (steps ?? []).map((step) => ({
    ...step,
    id: step.id || createId('test-step'),
    label: step.label?.trim() || `${phase} step`,
    phase,
    kind: step.kind ?? 'query',
    enabled: step.enabled !== false,
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

function buildRunResult(
  suite: DatastoreTestSuiteDefinition,
  caseId: string | undefined,
  connection: ConnectionProfile | undefined,
  snapshot: WorkspaceSnapshot,
): DatastoreTestRunResult {
  const startedAt = new Date().toISOString()
  const cases = suite.cases
    .filter((testCase) => testCase.enabled !== false)
    .filter((testCase) => !caseId || testCase.id === caseId)
    .map((testCase) => runCase(testCase))
  const failed = cases.reduce(
    (count, testCase) =>
      count + testCase.assertions.filter((assertion) => assertion.status !== 'passed').length,
    0,
  )
  const status: DatastoreTestStatus = failed > 0 ? 'failed' : 'passed'
  const durationMs = cases.reduce((total, testCase) => total + testCase.durationMs, 0)

  return {
    id: createId('test-run'),
    suiteId: suite.id,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs,
    passed: cases.reduce(
      (count, testCase) =>
        count + testCase.assertions.filter((assertion) => assertion.status === 'passed').length,
      0,
    ),
    failed,
    blocked: 0,
    warnings: guardrailWarnings(connection, snapshot),
    cases,
  }
}

function runCase(testCase: DatastoreTestCaseDefinition) {
  const steps = [
    ...testCase.setup,
    ...testCase.execute,
    ...testCase.teardown,
  ]
    .filter((step) => step.enabled !== false)
    .map((step) => ({
      id: step.id,
      label: step.label,
      phase: step.phase,
      status: 'passed' as const,
      durationMs: 5,
      messages: [`${step.label} completed in preview mode.`],
      warnings: [],
      payloadSummary: step.queryText ? firstLine(step.queryText) : step.kind,
    }))
  const assertions = testCase.assertions
    .filter((assertion) => assertion.enabled !== false)
    .map((assertion) => ({
      id: assertion.id,
      label: assertion.label,
      kind: assertion.kind,
      status: assertion.expected === false ? 'failed' as const : 'passed' as const,
      expected: assertion.expected,
      actual: assertion.expected ?? true,
      message:
        assertion.expected === false
          ? `${assertion.label} failed in preview mode.`
          : `${assertion.label} passed.`,
    }))
  const failed = assertions.some((assertion) => assertion.status !== 'passed')

  return {
    id: testCase.id,
    name: testCase.name,
    status: failed ? 'failed' as const : 'passed' as const,
    durationMs: steps.reduce((total, step) => total + step.durationMs, 0),
    steps,
    assertions,
  }
}

function guardrailWarnings(
  connection: ConnectionProfile | undefined,
  snapshot: WorkspaceSnapshot,
) {
  const environment = findEnvironment(snapshot, snapshot.ui.activeEnvironmentId)
  const warnings: string[] = []

  if (connection?.readOnly) {
    warnings.push('Read-only connection: setup and teardown writes require guardrail approval in the desktop runtime.')
  }

  if (environment?.safeMode || snapshot.preferences.safeModeEnabled) {
    warnings.push('Safe mode is enabled; destructive setup and teardown steps remain confirmation-gated.')
  }

  return warnings
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

function defaultTestQuery(connection: ConnectionProfile) {
  switch (editorLabelForConnection(connection)) {
    case 'Redis console':
    case 'Valkey console':
      return 'PING'
    case 'Document query':
      return JSON.stringify({ collection: 'products', filter: {}, limit: 1 }, null, 2)
    default:
      return 'select 1;'
  }
}

function firstLine(value: string) {
  return value.trim().split(/\r?\n/)[0] ?? ''
}
