import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  DatastoreTestAssertion,
  DatastoreTestAssertionKind,
  DatastoreTestCaseDefinition,
  DatastoreTestComparison,
  DatastoreTestPhase,
  DatastoreTestStep,
  DatastoreTestStepKind,
  DatastoreTestSuiteDefinition,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { builderStateForTab } from '../../workspace-helpers'
import { DatastoreIcon } from './DatastoreIcon'
import { QueryBuilderPanel } from './query-builder/QueryBuilderPanel'
import {
  datastoreTestStarterQuery,
  datastoreTestTargetBreadcrumb,
  inferredDatastoreTestLanguage,
  validateDatastoreTestTarget,
} from './query-targets/test-suite-target-registry'
import {
  CloseIcon,
  CopyIcon,
  MoveFirstIcon,
  MoveLastIcon,
  PanelRightIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TestCaseIcon,
  TestSuiteIcon,
  TrashIcon,
} from './icons'

interface TestSuiteWorkspaceProps {
  tab: QueryTabState
  connection: ConnectionProfile
  environment?: EnvironmentProfile
  enabled: boolean
  executionStatus: 'idle' | 'loading' | 'ready'
  onEnablePlugin(): void
  onRunSuite(caseId?: string): void
  onCancelRun(): void
  onUpdateSuite(suite: DatastoreTestSuiteDefinition, activeTestCaseId?: string): void
  theme: string
}

export function TestSuiteWorkspace({
  tab,
  connection,
  environment,
  enabled,
  executionStatus,
  onEnablePlugin,
  onRunSuite,
  onCancelRun,
  onUpdateSuite,
  theme,
}: TestSuiteWorkspaceProps) {
  const suite = useMemo(
    () => ensureCases(tab.testSuite ?? parseSuite(tab.queryText) ?? emptySuite(tab, connection), connection),
    [connection, tab],
  )
  const inferredLanguage = inferredDatastoreTestLanguage(connection)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsToggleRef = useRef<HTMLButtonElement>(null)
  const detailsPanelId = `test-suite-details-${tab.id}`

  useEffect(() => {
    if (!detailsOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      setDetailsOpen(false)
      detailsToggleRef.current?.focus()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [detailsOpen])

  if (!enabled) {
    return (
      <section className="test-plugin-disabled" aria-label="Datastore Tests plugin disabled">
        <TestSuiteIcon className="test-plugin-disabled-icon" />
        <h2>Datastore Tests is disabled</h2>
        <p>
          This suite is preserved. Enable the experimental workspace plugin to edit or run it.
        </p>
        <button type="button" className="drawer-button drawer-button--primary" onClick={onEnablePlugin}>
          Enable Datastore Tests
        </button>
      </section>
    )
  }

  const bindingError = testSuiteBindingError(suite, tab, connection)
  if (bindingError) {
    return (
      <section className="test-plugin-disabled" aria-label="Datastore test suite binding required">
        <TestSuiteIcon className="test-plugin-disabled-icon" />
        <h2>Test suite target required</h2>
        <p>{bindingError}</p>
        <p>
          This suite has been preserved, but it cannot be edited or run. Close this tab and create
          a new Test Suite with a connection, environment, and datastore target.
        </p>
      </section>
    )
  }

  const selectedCase =
    suite.cases.find((testCase) => testCase.id === tab.activeTestCaseId) ?? suite.cases[0]!

  const updateSuite = (
    nextSuite: DatastoreTestSuiteDefinition,
    activeTestCaseId = selectedCase.id,
  ) => onUpdateSuite(ensureCases(nextSuite, connection), activeTestCaseId)

  const updateCase = (nextCase: DatastoreTestCaseDefinition) => {
    updateSuite({
      ...suite,
      cases: suite.cases.map((testCase) =>
        testCase.id === selectedCase.id ? nextCase : testCase,
      ),
    })
  }

  const addCase = () => {
    const testCase = emptyCase(connection, suite.scopedTarget)
    updateSuite({ ...suite, cases: [...suite.cases, testCase] }, testCase.id)
  }

  const duplicateCase = (testCase: DatastoreTestCaseDefinition) => {
    const duplicate = cloneCase(testCase)
    const index = suite.cases.findIndex((candidate) => candidate.id === testCase.id)
    const cases = [...suite.cases]
    cases.splice(index + 1, 0, duplicate)
    updateSuite({ ...suite, cases }, duplicate.id)
  }

  const moveCase = (testCase: DatastoreTestCaseDefinition, offset: -1 | 1) => {
    const index = suite.cases.findIndex((candidate) => candidate.id === testCase.id)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= suite.cases.length) {
      return
    }
    const cases = [...suite.cases]
    ;[cases[index], cases[nextIndex]] = [cases[nextIndex]!, cases[index]!]
    updateSuite({ ...suite, cases }, testCase.id)
  }

  const removeCase = (testCase: DatastoreTestCaseDefinition) => {
    if (suite.cases.length === 1) {
      return
    }
    const index = suite.cases.findIndex((candidate) => candidate.id === testCase.id)
    const cases = suite.cases.filter((candidate) => candidate.id !== testCase.id)
    const nextSelected = cases[Math.min(index, cases.length - 1)]!
    updateSuite({ ...suite, cases }, nextSelected.id)
  }

  return (
    <section className="test-suite-workspace" aria-label="Datastore test suite">
      <div className="test-toolbar" aria-label="Test suite toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-action toolbar-action--run"
            disabled={executionStatus === 'loading'}
            onClick={() => onRunSuite()}
          >
            <PlayIcon className="toolbar-icon" />
            <span>{executionStatus === 'loading' ? 'Running Suite' : 'Run Suite'}</span>
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
        <div className="test-toolbar-end">
          <span className="test-toolbar-context">{connection.name}</span>
          <button
            ref={detailsToggleRef}
            type="button"
            className={`toolbar-action${detailsOpen ? ' is-active' : ''}`}
            aria-controls={detailsPanelId}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <PanelRightIcon className="toolbar-icon" />
            Suite Details
          </button>
        </div>
      </div>

      <div className={`test-suite-layout${detailsOpen ? ' is-details-open' : ''}`}>
        <aside className="test-suite-navigator" aria-label="Test cases">
          <header className="test-suite-heading">
            <TestSuiteIcon />
            <div>
              <span>Test Suite</span>
              <strong>{suite.name || 'Untitled suite'}</strong>
            </div>
          </header>
          <div className="test-case-list-header">
            <strong>Test Cases</strong>
            <button type="button" className="drawer-button drawer-button--compact" onClick={addCase}>
              <PlusIcon /> Add Case
            </button>
          </div>
          <div className="test-case-list" role="list">
            {suite.cases.map((testCase, index) => (
              <div
                key={testCase.id}
                className={`test-case-list-item${selectedCase.id === testCase.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="test-case-select"
                  aria-label={`Open test case ${testCase.name}`}
                  onClick={() => onUpdateSuite(suite, testCase.id)}
                >
                  <TestCaseIcon />
                  <span>
                    <strong>{testCase.name || 'Untitled case'}</strong>
                    <small>{testCase.enabled === false ? 'Disabled' : `${testCase.execute.length} execute step(s)`}</small>
                  </span>
                </button>
                <div className="test-case-actions">
                  <button type="button" aria-label={`Duplicate ${testCase.name}`} onClick={() => duplicateCase(testCase)}>
                    <CopyIcon />
                  </button>
                  <button type="button" aria-label={`Move ${testCase.name} up`} disabled={index === 0} onClick={() => moveCase(testCase, -1)}>
                    <MoveFirstIcon />
                  </button>
                  <button type="button" aria-label={`Move ${testCase.name} down`} disabled={index === suite.cases.length - 1} onClick={() => moveCase(testCase, 1)}>
                    <MoveLastIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${testCase.name}`}
                    disabled={suite.cases.length === 1}
                    title={suite.cases.length === 1 ? 'A suite must contain at least one case.' : 'Remove case'}
                    onClick={() => removeCase(testCase)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="test-case-editor">
          <header className="test-case-editor-header">
            <div>
              <span className="sidebar-eyebrow">Test Case</span>
              <h2>{selectedCase.name || 'Untitled case'}</h2>
            </div>
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={executionStatus === 'loading' || selectedCase.enabled === false}
              onClick={() => onRunSuite(selectedCase.id)}
            >
              <PlayIcon /> Run Case
            </button>
          </header>

          <div className="test-case-settings">
            <label className="test-field test-field--wide">
              <span>Case name</span>
              <input value={selectedCase.name} onChange={(event) => updateCase({ ...selectedCase, name: event.target.value })} />
            </label>
            <label className="test-check-field">
              <input
                type="checkbox"
                checked={selectedCase.enabled !== false}
                onChange={(event) => updateCase({ ...selectedCase, enabled: event.target.checked })}
              />
              Enabled
            </label>
            <label className="test-field">
              <span>Case timeout (ms)</span>
              <input
                type="number"
                min={1}
                value={selectedCase.timeoutMs ?? 30000}
                onChange={(event) => updateCase({ ...selectedCase, timeoutMs: positiveNumber(event.target.value, 30000) })}
              />
            </label>
          </div>

          {(['setup', 'execute', 'teardown'] as const).map((phase) => (
            <TestPhasePanel
              key={phase}
              phase={phase}
              steps={selectedCase[phase]}
              connection={connection}
              tab={tab}
              theme={theme}
              onChange={(steps) => updateCase({ ...selectedCase, [phase]: steps })}
            />
          ))}

          <AssertionsPanel
            assertions={selectedCase.assertions}
            sourceSteps={[...selectedCase.setup, ...selectedCase.execute, ...selectedCase.teardown]}
            onChange={(assertions) => updateCase({ ...selectedCase, assertions })}
          />
        </main>

        {detailsOpen ? (
          <aside
            id={detailsPanelId}
            className="test-suite-details"
            aria-label="Suite details"
          >
            <header className="test-suite-details-header">
              <div>
                <TestSuiteIcon />
                <strong>Suite Details</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close suite details"
                title="Close suite details"
                onClick={() => {
                  setDetailsOpen(false)
                  detailsToggleRef.current?.focus()
                }}
              >
                <CloseIcon />
              </button>
            </header>

            <section className="test-suite-details-section">
              <strong>Test Suite</strong>
              <label className="test-field">
                <span>Suite name</span>
                <input
                  value={suite.name}
                  onChange={(event) =>
                    updateSuite({ ...suite, name: event.target.value })
                  }
                />
              </label>
              <label className="test-field">
                <span>Description</span>
                <textarea
                  value={suite.description ?? ''}
                  onChange={(event) =>
                    updateSuite({ ...suite, description: event.target.value })
                  }
                />
              </label>
            </section>

            <VariablesEditor
              variables={suite.variables ?? {}}
              onChange={(variables) => updateSuite({ ...suite, variables })}
            />

            <section
              className="test-suite-details-section test-suite-binding-details"
              aria-label="Datastore binding details"
            >
              <div className="test-suite-binding-heading">
                <DatastoreIcon decorative engine={connection.engine} />
                <div>
                  <strong>Datastore Target</strong>
                  <span>{connection.name}</span>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Connection</dt>
                  <dd>{connection.name}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{environment?.label ?? tab.environmentId}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{datastoreTestTargetBreadcrumb(suite.scopedTarget)}</dd>
                </div>
                <div>
                  <dt>Target kind</dt>
                  <dd>{suite.scopedTarget.kind}</dd>
                </div>
                <div>
                  <dt>Language</dt>
                  <dd>{inferredLanguage}</dd>
                </div>
              </dl>
            </section>
          </aside>
        ) : null}
      </div>
    </section>
  )
}

function VariablesEditor({
  variables,
  onChange,
}: {
  variables: Record<string, string>
  onChange(variables: Record<string, string>): void
}) {
  const entries = Object.entries(variables)
  return (
    <section className="test-variables">
      <div className="test-case-list-header">
        <strong>Variables</strong>
        <button
          type="button"
          className="drawer-button drawer-button--compact"
          onClick={() => onChange({ ...variables, [`VARIABLE_${entries.length + 1}`]: '' })}
        >
          <PlusIcon /> Add
        </button>
      </div>
      {entries.length === 0 ? <p className="sidebar-empty">No suite variables.</p> : null}
      {entries.map(([key, value], index) => (
        <div className="test-variable-row" key={`${key}-${index}`}>
          <input
            aria-label={`Variable ${index + 1} name`}
            value={key}
            onChange={(event) => onChange(renameRecordKey(variables, key, event.target.value))}
          />
          <input
            aria-label={`Variable ${key} value`}
            value={value}
            onChange={(event) => onChange({ ...variables, [key]: event.target.value })}
          />
          <button type="button" aria-label={`Remove variable ${key}`} onClick={() => onChange(removeRecordKey(variables, key))}>
            <TrashIcon />
          </button>
        </div>
      ))}
    </section>
  )
}

function TestPhasePanel({
  phase,
  steps,
  connection,
  tab,
  theme,
  onChange,
}: {
  phase: DatastoreTestPhase
  steps: DatastoreTestStep[]
  connection: ConnectionProfile
  tab: QueryTabState
  theme: string
  onChange(steps: DatastoreTestStep[]): void
}) {
  return (
    <section className="test-phase-panel">
      <div className="test-phase-header">
        <div>
          <strong>{phaseLabel(phase)}</strong>
          <small>{phaseDescription(phase)}</small>
        </div>
        <button type="button" className="drawer-button drawer-button--compact" onClick={() => onChange([...steps, emptyStep(phase, connection, tab.scopedTarget)])}>
          <PlusIcon /> Add Step
        </button>
      </div>
      {steps.length === 0 ? <p className="sidebar-empty">No {phaseLabel(phase).toLowerCase()} steps.</p> : null}
      {steps.map((step, index) => (
        <StepEditor
          key={step.id}
          step={step}
          connection={connection}
          tab={tab}
          theme={theme}
          onChange={(nextStep) => onChange(replaceAt(steps, index, nextStep))}
          onRemove={() => onChange(steps.filter((candidate) => candidate.id !== step.id))}
        />
      ))}
    </section>
  )
}

function StepEditor({
  step,
  connection,
  tab,
  theme,
  onChange,
  onRemove,
}: {
  step: DatastoreTestStep
  connection: ConnectionProfile
  tab: QueryTabState
  theme: string
  onChange(step: DatastoreTestStep): void
  onRemove(): void
}) {
  const builderState =
    step.builderState ??
    builderStateForTab(
      { ...tab, id: `${tab.id}-${step.id}`, queryText: step.queryText ?? '', builderState: undefined },
      connection,
      {},
    )
  return (
    <article className="test-step-row">
      <header className="test-step-header">
        <label className="test-check-field">
          <input type="checkbox" checked={step.enabled !== false} onChange={(event) => onChange({ ...step, enabled: event.target.checked })} />
          Enabled
        </label>
        <button type="button" className="test-remove-button" aria-label={`Remove step ${step.label}`} onClick={onRemove}>
          <TrashIcon /> Remove Step
        </button>
      </header>
      <div className="test-step-grid">
        <label className="test-field">
          <span>Label</span>
          <input value={step.label} onChange={(event) => onChange({ ...step, label: event.target.value })} />
        </label>
        <label className="test-field">
          <span>Step kind</span>
          <select value={step.kind} onChange={(event) => onChange(changeStepKind(step, event.target.value as DatastoreTestStepKind, connection, tab))}>
            <option value="query">Query</option>
            <option value="builder">Builder</option>
            <option value="data-edit">Data edit</option>
            <option value="operation">Operation</option>
          </select>
        </label>
        <label className="test-field">
          <span>Step timeout (ms)</span>
          <input type="number" min={1} value={step.timeoutMs ?? 30000} onChange={(event) => onChange({ ...step, timeoutMs: positiveNumber(event.target.value, 30000) })} />
        </label>
      </div>

      {step.kind === 'query' ? (
        <>
          <div className="test-inferred-language" aria-label="Inferred query language">
            <span>Language</span>
            <strong>{inferredDatastoreTestLanguage(connection)}</strong>
            <small>Inferred from {connection.name}</small>
          </div>
          <label className="test-field">
            <span>Query or request</span>
            <textarea className="test-code-input" value={step.queryText ?? ''} onChange={(event) => onChange({ ...step, queryText: event.target.value })} />
          </label>
        </>
      ) : null}

      {step.kind === 'builder' ? (
        builderState ? (
          <div className="test-builder-editor">
            <QueryBuilderPanel
              connection={connection}
              tab={{ ...tab, id: `${tab.id}-${step.id}`, builderState, queryText: step.queryText ?? builderState.lastAppliedQueryText ?? '' }}
              builderState={builderState}
              theme={theme}
              onBuilderStateChange={(_tabId, nextBuilderState) =>
                onChange({
                  ...step,
                  builderState: nextBuilderState,
                  queryText: nextBuilderState.lastAppliedQueryText ?? step.queryText,
                })
              }
            />
            <label className="test-field">
              <span>Generated request</span>
              <textarea className="test-code-input" readOnly value={builderState.lastAppliedQueryText ?? step.queryText ?? ''} />
            </label>
          </div>
        ) : (
          <p className="test-step-blocker">
            This datastore does not expose a visual builder for the current target. Choose Query or configure an applicable target first.
          </p>
        )
      ) : null}

      {step.kind === 'data-edit' ? (
        <DataEditStepEditor step={step} onChange={onChange} />
      ) : null}

      {step.kind === 'operation' ? (
        <OperationStepEditor step={step} onChange={onChange} />
      ) : null}
    </article>
  )
}

function DataEditStepEditor({ step, onChange }: { step: DatastoreTestStep; onChange(step: DatastoreTestStep): void }) {
  const firstChange = step.changes?.[0] ?? { field: '', value: '' }
  return (
    <div className="test-kind-editor">
      <div className="test-step-grid">
        <label className="test-field">
          <span>Edit kind</span>
          <select value={step.editKind ?? 'update'} onChange={(event) => onChange({ ...step, editKind: event.target.value })}>
            <option value="insert">Insert</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
        </label>
        <label className="test-field">
          <span>Object kind</span>
          <input readOnly value={step.target?.objectKind ?? 'table'} />
        </label>
        <label className="test-field">
          <span>Target path</span>
          <input readOnly value={step.target?.path.join('.') ?? ''} placeholder="Suite target" />
        </label>
        <label className="test-field">
          <span>Field</span>
          <input value={firstChange.field ?? firstChange.path?.join('.') ?? ''} onChange={(event) => onChange({ ...step, changes: [{ ...firstChange, field: event.target.value }] })} />
        </label>
        <label className="test-field">
          <span>Value</span>
          <input value={String(firstChange.value ?? '')} onChange={(event) => onChange({ ...step, changes: [{ ...firstChange, value: parseExpectedValue(event.target.value) }] })} />
        </label>
      </div>
      <div className="test-plan-preview">
        <strong>Plan preview</strong>
        <span>{step.editKind ?? 'update'} {step.target?.path.join('.') || 'unconfigured target'} using bound values</span>
      </div>
    </div>
  )
}

function OperationStepEditor({ step, onChange }: { step: DatastoreTestStep; onChange(step: DatastoreTestStep): void }) {
  return (
    <div className="test-kind-editor">
      <div className="test-step-grid">
        <label className="test-field">
          <span>Adapter operation</span>
          <input value={step.operationId ?? ''} placeholder="operation id" onChange={(event) => onChange({ ...step, operationId: event.target.value })} />
        </label>
        <label className="test-field">
          <span>Object name</span>
          <input readOnly value={step.objectName ?? ''} />
        </label>
        <label className="test-field">
          <span>Parameters</span>
          <textarea
            className="test-code-input"
            value={JSON.stringify(step.parameters ?? {}, null, 2)}
            onChange={(event) => {
              const parameters = parseObject(event.target.value)
              if (parameters) onChange({ ...step, parameters })
            }}
          />
        </label>
      </div>
      <div className="test-plan-preview">
        <strong>Plan preview</strong>
        <span>{step.operationId || 'Choose an adapter operation'}{step.objectName ? ` on ${step.objectName}` : ''}</span>
      </div>
    </div>
  )
}

function AssertionsPanel({
  assertions,
  sourceSteps,
  onChange,
}: {
  assertions: DatastoreTestAssertion[]
  sourceSteps: DatastoreTestStep[]
  onChange(assertions: DatastoreTestAssertion[]): void
}) {
  return (
    <section className="test-phase-panel test-assertions-panel">
      <div className="test-phase-header">
        <div>
          <strong>Assertions</strong>
          <small>Choose the step observation each assertion evaluates.</small>
        </div>
        <button type="button" className="drawer-button drawer-button--compact" onClick={() => onChange([...assertions, emptyAssertion()])}>
          <PlusIcon /> Add Assertion
        </button>
      </div>
      {assertions.length === 0 ? <p className="sidebar-empty">No assertions.</p> : null}
      {assertions.map((assertion, index) => (
        <article key={assertion.id} className="test-assertion-row">
          <header className="test-step-header">
            <label className="test-check-field">
              <input type="checkbox" checked={assertion.enabled !== false} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button type="button" className="test-remove-button" aria-label={`Remove assertion ${assertion.label}`} onClick={() => onChange(assertions.filter((candidate) => candidate.id !== assertion.id))}>
              <TrashIcon /> Remove
            </button>
          </header>
          <div className="test-step-grid">
            <label className="test-field">
              <span>Label</span>
              <input value={assertion.label} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, label: event.target.value }))} />
            </label>
            <label className="test-field">
              <span>Source step</span>
              <select value={assertion.sourceStepId ?? ''} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, sourceStepId: event.target.value || undefined }))}>
                <option value="">Last enabled Execute step</option>
                {sourceSteps.map((step) => <option key={step.id} value={step.id}>{phaseLabel(step.phase)} / {step.label}</option>)}
              </select>
            </label>
            <label className="test-field">
              <span>Assertion kind</span>
              <select value={assertion.kind} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, kind: event.target.value as DatastoreTestAssertionKind }))}>
                {assertionKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label className="test-field">
              <span>Comparison</span>
              <select value={assertion.comparison ?? 'equals'} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, comparison: event.target.value as DatastoreTestComparison }))}>
                {comparisons.map((comparison) => <option key={comparison} value={comparison}>{comparison}</option>)}
              </select>
            </label>
            <label className="test-field">
              <span>Field / JSON path</span>
              <input value={assertion.path ?? assertion.field ?? ''} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, path: event.target.value }))} />
            </label>
            <label className="test-field">
              <span>Expected value</span>
              <input value={displayExpected(assertion.expected)} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, expected: parseExpectedValue(event.target.value) }))} />
            </label>
            <label className="test-field">
              <span>Timeout (ms)</span>
              <input type="number" min={1} value={assertion.timeoutMs ?? 5000} onChange={(event) => onChange(replaceAt(assertions, index, { ...assertion, timeoutMs: positiveNumber(event.target.value, 5000) }))} />
            </label>
          </div>
        </article>
      ))}
    </section>
  )
}

const assertionKinds: DatastoreTestAssertionKind[] = ['row-count', 'cell-value', 'json-path', 'document-count', 'key-exists', 'key-type', 'key-ttl', 'search-hit-count', 'schema-exists', 'no-error', 'duration-under']
const comparisons: DatastoreTestComparison[] = ['equals', 'not-equals', 'contains', 'greater-than', 'greater-than-or-equal', 'less-than', 'less-than-or-equal', 'exists']

function emptySuite(tab: QueryTabState, connection: ConnectionProfile): DatastoreTestSuiteDefinition {
  return {
    id: tab.id,
    name: tab.title.replace(/\.datapad-test\.json$/i, ''),
    engine: connection.engine,
    family: connection.family,
    connectionId: connection.id,
    environmentId: tab.environmentId,
    scopedTarget: tab.scopedTarget ?? {
      kind: 'invalid',
      label: 'Target required',
    },
    inferredLanguage: inferredDatastoreTestLanguage(connection),
    variables: {},
    cases: [emptyCase(connection, tab.scopedTarget)],
  }
}

function ensureCases(
  suite: DatastoreTestSuiteDefinition,
  connection: ConnectionProfile,
): DatastoreTestSuiteDefinition {
  const cases = Array.isArray(suite.cases) ? suite.cases : []
  return cases.length > 0
    ? suite
    : { ...suite, cases: [emptyCase(connection, suite.scopedTarget)] }
}

function testSuiteBindingError(
  suite: DatastoreTestSuiteDefinition,
  tab: QueryTabState,
  connection: ConnectionProfile,
) {
  const scopedTarget = suite.scopedTarget as ScopedQueryTarget | undefined
  if (
    !suite.connectionId?.trim() ||
    !suite.environmentId?.trim() ||
    !scopedTarget?.kind?.trim() ||
    !scopedTarget.label?.trim()
  ) {
    return 'This restored suite predates required datastore targeting and has no complete binding.'
  }

  if (
    suite.connectionId !== connection.id ||
    suite.connectionId !== tab.connectionId ||
    suite.environmentId !== tab.environmentId ||
    !tab.scopedTarget ||
    JSON.stringify(scopedTarget) !== JSON.stringify(tab.scopedTarget)
  ) {
    return 'The suite binding no longer matches its connection, environment, or tab target.'
  }

  return validateDatastoreTestTarget(connection, scopedTarget)
}

function emptyCase(
  connection: ConnectionProfile,
  scopedTarget?: ScopedQueryTarget,
): DatastoreTestCaseDefinition {
  return {
    id: createTestId('case'),
    name: 'New test case',
    enabled: true,
    timeoutMs: 30000,
    setup: [],
    execute: [emptyStep('execute', connection, scopedTarget)],
    assertions: [emptyAssertion()],
    teardown: [],
  }
}

function cloneCase(testCase: DatastoreTestCaseDefinition): DatastoreTestCaseDefinition {
  const stepIds = new Map<string, string>()
  const cloneSteps = (steps: DatastoreTestStep[]) =>
    steps.map((step) => {
      const id = createTestId('step')
      stepIds.set(step.id, id)
      return { ...structuredClone(step), id }
    })
  const setup = cloneSteps(testCase.setup)
  const execute = cloneSteps(testCase.execute)
  const teardown = cloneSteps(testCase.teardown)

  return {
    ...structuredClone(testCase),
    id: createTestId('case'),
    name: `${testCase.name} copy`,
    setup,
    execute,
    teardown,
    assertions: testCase.assertions.map((assertion) => ({
      ...structuredClone(assertion),
      id: createTestId('assertion'),
      sourceStepId: assertion.sourceStepId
        ? stepIds.get(assertion.sourceStepId)
        : undefined,
    })),
  }
}

function emptyStep(
  phase: DatastoreTestPhase,
  connection?: ConnectionProfile,
  scopedTarget?: ScopedQueryTarget,
): DatastoreTestStep {
  return {
    id: createTestId('step'),
    label: `${phaseLabel(phase)} step`,
    phase,
    kind: 'query',
    enabled: true,
    language: connection ? inferredDatastoreTestLanguage(connection) : 'text',
    queryText:
      connection && scopedTarget
        ? datastoreTestStarterQuery(connection, scopedTarget)
        : '',
    timeoutMs: 30000,
  }
}

function changeStepKind(
  step: DatastoreTestStep,
  kind: DatastoreTestStepKind,
  connection: ConnectionProfile,
  tab: QueryTabState,
) {
  const next = { ...step, kind }
  if (kind === 'builder' && !next.builderState) {
    next.builderState = builderStateForTab(
      { ...tab, id: `${tab.id}-${step.id}`, queryText: step.queryText ?? '', builderState: undefined },
      connection,
      {},
    )
  }
  if (kind === 'data-edit' && !next.target && tab.scopedTarget) {
    next.target = {
      objectKind: tab.scopedTarget.kind,
      path: [...(tab.scopedTarget.path ?? []), tab.scopedTarget.label]
        .filter((part, index, parts) => part && parts.indexOf(part) === index),
    }
  }
  if (kind === 'operation' && !next.objectName && tab.scopedTarget) {
    next.objectName = tab.scopedTarget.label
  }
  return next
}

function emptyAssertion(): DatastoreTestAssertion {
  return {
    id: createTestId('assertion'),
    label: 'No execution errors',
    kind: 'no-error',
    enabled: true,
    comparison: 'equals',
    expected: true,
    timeoutMs: 5000,
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
  return phase === 'setup' ? 'Setup' : phase === 'execute' ? 'Execute' : 'Teardown'
}

function phaseDescription(phase: DatastoreTestPhase) {
  return phase === 'setup'
    ? 'Prepare this case. A failure stops Execute, but Teardown still runs.'
    : phase === 'execute'
      ? 'Run the behavior under test in order.'
      : 'Cleanup is attempted after success, failure, timeout, or cancellation.'
}

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item))
}

function parseExpectedValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  const object = parseObject(value)
  return object ?? value
}

function displayExpected(value: unknown) {
  return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function positiveNumber(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function createTestId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function removeRecordKey(record: Record<string, string>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key))
}

function renameRecordKey(record: Record<string, string>, previousKey: string, nextKey: string) {
  const entries = Object.entries(record).map(([key, value]) => [key === previousKey ? nextKey : key, value])
  return Object.fromEntries(entries)
}
