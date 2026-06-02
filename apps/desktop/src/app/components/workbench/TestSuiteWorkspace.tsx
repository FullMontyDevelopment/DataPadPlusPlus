import { useMemo } from 'react'
import type {
  ConnectionProfile,
  DatastoreTestAssertion,
  DatastoreTestCaseDefinition,
  DatastoreTestPhase,
  DatastoreTestStep,
  DatastoreTestSuiteDefinition,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { DesktopCodeEditor } from './DesktopCodeEditor'
import { ColumnIcon, JsonIcon, PlayIcon, StopIcon, TableIcon } from './icons'

type TestWindowMode = 'both' | 'builder' | 'raw'

interface TestSuiteWorkspaceProps {
  tab: QueryTabState
  connection: ConnectionProfile
  resolvedTheme: string
  testWindowMode: TestWindowMode
  executionStatus: 'idle' | 'loading' | 'ready'
  onModeChange(mode: TestWindowMode): void
  onRunSuite(): void
  onCancelRun(): void
  onUpdateSuite(suite: DatastoreTestSuiteDefinition): void
  onUpdateRaw(rawText: string): void
}

export function TestSuiteWorkspace({
  tab,
  connection,
  resolvedTheme,
  testWindowMode,
  executionStatus,
  onModeChange,
  onRunSuite,
  onCancelRun,
  onUpdateSuite,
  onUpdateRaw,
}: TestSuiteWorkspaceProps) {
  const suite = useMemo(
    () => tab.testSuite ?? parseSuite(tab.queryText) ?? emptySuite(tab, connection),
    [connection, tab],
  )
  const firstCase = suite.cases[0]
  const showVisual = testWindowMode !== 'raw'
  const showRaw = testWindowMode !== 'builder'

  const updateSuite = (nextSuite: DatastoreTestSuiteDefinition) => {
    onUpdateSuite(nextSuite)
  }

  const updateFirstCase = (nextCase: DatastoreTestCaseDefinition) => {
    updateSuite({
      ...suite,
      cases: suite.cases.map((candidate, index) =>
        index === 0 ? nextCase : candidate,
      ),
    })
  }

  return (
    <>
      <div className="test-toolbar" aria-label="Test suite toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-action toolbar-action--run"
            disabled={executionStatus === 'loading'}
            onClick={onRunSuite}
          >
            <PlayIcon className="toolbar-icon" />
            <span>{executionStatus === 'loading' ? 'Running' : 'Run Suite'}</span>
          </button>
          <button
            type="button"
            className="toolbar-icon-action"
            aria-label="Cancel test run"
            title="Cancel the active test run."
            disabled={executionStatus !== 'loading'}
            onClick={onCancelRun}
          >
            <StopIcon className="toolbar-icon" />
          </button>
        </div>

        <div className="toolbar-group toolbar-group--query-layout" aria-label="Test editor mode">
          {[
            { mode: 'both', label: 'Show visual tests and raw JSON', icon: ColumnIcon },
            { mode: 'builder', label: 'Show visual tests only', icon: JsonIcon },
            { mode: 'raw', label: 'Show raw test JSON only', icon: TableIcon },
          ].map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              className={`toolbar-icon-action${
                testWindowMode === mode ? ' is-active' : ''
              }`}
              aria-label={label}
              title={label}
              aria-pressed={testWindowMode === mode}
              onClick={() => onModeChange(mode as TestWindowMode)}
            >
              <Icon className="toolbar-icon" />
            </button>
          ))}
        </div>
      </div>

      <div className="editor-surface">
        <div className="editor-surface-meta">
          <span>
            {connection.name} / Test suite
          </span>
        </div>
        <div className={`editor-query-layout query-layout--${testWindowMode}`}>
          {showVisual ? (
            <div className="test-suite-visual">
              <label className="test-field test-field--wide">
                <span>Suite name</span>
                <input
                  value={suite.name}
                  onChange={(event) =>
                    updateSuite({ ...suite, name: event.target.value })
                  }
                />
              </label>

              {firstCase ? (
                <TestCaseEditor testCase={firstCase} onChange={updateFirstCase} />
              ) : (
                <button
                  type="button"
                  className="drawer-button"
                  onClick={() =>
                    updateSuite({
                      ...suite,
                      cases: [emptyCase(connection)],
                    })
                  }
                >
                  Add test case
                </button>
              )}
            </div>
          ) : null}

          {showRaw ? (
            <DesktopCodeEditor
              value={tab.queryText}
              language="json"
              theme={resolvedTheme}
              onChange={onUpdateRaw}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

function TestCaseEditor({
  testCase,
  onChange,
}: {
  testCase: DatastoreTestCaseDefinition
  onChange(testCase: DatastoreTestCaseDefinition): void
}) {
  return (
    <div className="test-case-editor">
      <label className="test-field test-field--wide">
        <span>Case name</span>
        <input
          value={testCase.name}
          onChange={(event) => onChange({ ...testCase, name: event.target.value })}
        />
      </label>

      {(['setup', 'execute', 'teardown'] as const).map((phase) => (
        <TestPhasePanel
          key={phase}
          phase={phase}
          steps={testCase[phase]}
          onChange={(steps) => onChange({ ...testCase, [phase]: steps })}
        />
      ))}

      <AssertionsPanel
        assertions={testCase.assertions}
        onChange={(assertions) => onChange({ ...testCase, assertions })}
      />
    </div>
  )
}

function TestPhasePanel({
  phase,
  steps,
  onChange,
}: {
  phase: DatastoreTestPhase
  steps: DatastoreTestStep[]
  onChange(steps: DatastoreTestStep[]): void
}) {
  return (
    <section className="test-phase-panel">
      <div className="test-phase-header">
        <strong>{phaseLabel(phase)}</strong>
        <button
          type="button"
          className="drawer-button drawer-button--compact"
          onClick={() => onChange([...steps, emptyStep(phase)])}
        >
          Add Step
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="sidebar-empty">No {phaseLabel(phase).toLowerCase()} steps.</p>
      ) : (
        steps.map((step, index) => (
          <div key={step.id} className="test-step-row">
            <label>
              <span>Label</span>
              <input
                value={step.label}
                onChange={(event) =>
                  onChange(replaceAt(steps, index, { ...step, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Query or request</span>
              <textarea
                value={step.queryText ?? ''}
                onChange={(event) =>
                  onChange(
                    replaceAt(steps, index, { ...step, queryText: event.target.value }),
                  )
                }
              />
            </label>
          </div>
        ))
      )}
    </section>
  )
}

function AssertionsPanel({
  assertions,
  onChange,
}: {
  assertions: DatastoreTestAssertion[]
  onChange(assertions: DatastoreTestAssertion[]): void
}) {
  return (
    <section className="test-phase-panel">
      <div className="test-phase-header">
        <strong>Assertions</strong>
        <button
          type="button"
          className="drawer-button drawer-button--compact"
          onClick={() => onChange([...assertions, emptyAssertion()])}
        >
          Add Assertion
        </button>
      </div>
      {assertions.map((assertion, index) => (
        <div key={assertion.id} className="test-assertion-row">
          <select
            value={assertion.kind}
            onChange={(event) =>
              onChange(
                replaceAt(assertions, index, {
                  ...assertion,
                  kind: event.target.value as DatastoreTestAssertion['kind'],
                }),
              )
            }
          >
            <option value="row-count">Row count</option>
            <option value="document-count">Document count</option>
            <option value="key-exists">Key exists</option>
            <option value="key-type">Key type</option>
            <option value="search-hit-count">Search hit count</option>
            <option value="json-path">JSON path</option>
            <option value="no-error">No error</option>
            <option value="duration-under">Duration under</option>
          </select>
          <input
            value={String(assertion.expected ?? '')}
            placeholder="Expected"
            onChange={(event) =>
              onChange(
                replaceAt(assertions, index, {
                  ...assertion,
                  expected: parseExpectedValue(event.target.value),
                }),
              )
            }
          />
        </div>
      ))}
    </section>
  )
}

function emptySuite(
  tab: QueryTabState,
  connection: ConnectionProfile,
): DatastoreTestSuiteDefinition {
  return {
    id: tab.id,
    name: tab.title.replace(/\.datapad-test\.json$/i, ''),
    engine: connection.engine,
    family: connection.family,
    connectionId: connection.id,
    environmentId: tab.environmentId,
    variables: {},
    cases: [emptyCase(connection)],
  }
}

function emptyCase(connection: ConnectionProfile): DatastoreTestCaseDefinition {
  return {
    id: `case-${Date.now()}`,
    name: 'new test case',
    enabled: true,
    setup: [],
    execute: [emptyStep('execute', connection)],
    assertions: [emptyAssertion()],
    teardown: [],
  }
}

function emptyStep(
  phase: DatastoreTestPhase,
  connection?: ConnectionProfile,
): DatastoreTestStep {
  return {
    id: `step-${phase}-${Date.now()}`,
    label: `${phaseLabel(phase)} step`,
    phase,
    kind: 'query',
    enabled: true,
    language: connection?.engine === 'mongodb' ? 'mongodb' : 'sql',
    queryText: connection?.engine === 'mongodb'
      ? '{\n  "collection": "",\n  "filter": {},\n  "limit": 1\n}'
      : 'select 1;',
  }
}

function emptyAssertion(): DatastoreTestAssertion {
  return {
    id: `assertion-${Date.now()}`,
    label: 'No execution errors',
    kind: 'no-error',
    enabled: true,
    expected: true,
  }
}

function parseSuite(value: string): DatastoreTestSuiteDefinition | undefined {
  try {
    return JSON.parse(value) as DatastoreTestSuiteDefinition
  } catch {
    return undefined
  }
}

function phaseLabel(phase: DatastoreTestPhase) {
  switch (phase) {
    case 'setup':
      return 'Setup'
    case 'execute':
      return 'Execute'
    case 'teardown':
      return 'Tear Down'
  }
}

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item))
}

function parseExpectedValue(value: string) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return value
}
