import type { DatastoreTestRunResult } from '@datapadplusplus/shared-types'
import { ClockIcon } from '../icons'
import { formatDurationClock } from './result-runtime'

interface TestRunResultsViewProps {
  run?: DatastoreTestRunResult
}

export function TestRunResultsView({ run }: TestRunResultsViewProps) {
  if (!run) {
    return (
      <div className="test-run-empty">
        <strong>No test run yet.</strong>
        <span>Run the suite to see step output, assertion results, and timings here.</span>
      </div>
    )
  }

  const totalAssertions = run.cases.reduce(
    (total, testCase) => total + testCase.assertions.length,
    0,
  )
  const passedAssertions = run.cases.reduce(
    (total, testCase) =>
      total +
      testCase.assertions.filter((assertion) => assertion.status === 'passed').length,
    0,
  )

  return (
    <div className="test-run-results">
      <div className="test-run-summary">
        <span className={`test-status-badge test-status-badge--${run.status}`}>
          {run.status}
        </span>
        <strong>
          {passedAssertions} of {totalAssertions} assertion(s) passed
        </strong>
        <span className="test-run-runtime">
          <ClockIcon className="panel-inline-icon" />
          {formatDurationClock(run.durationMs)}
        </span>
      </div>

      {run.warnings.length > 0 ? (
        <div className="test-run-warning-list">
          {run.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      <div className="test-run-case-list">
        {run.cases.map((testCase) => (
          <section key={testCase.id} className="test-run-case">
            <div className="test-run-case-header">
              <span className={`test-status-dot test-status-dot--${testCase.status}`} />
              <strong>{testCase.name}</strong>
              <span>{formatDurationClock(testCase.durationMs)}</span>
            </div>

            <div className="test-run-grid" role="table" aria-label={`${testCase.name} results`}>
              <div className="test-run-grid-row test-run-grid-row--head" role="row">
                <span role="columnheader">Phase</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Details</span>
                <span role="columnheader">Time</span>
              </div>

              {testCase.steps.map((step) => (
                <div key={step.id} className="test-run-grid-row" role="row">
                  <span role="cell">{step.phase}</span>
                  <span role="cell">{step.label}</span>
                  <span role="cell">
                    <span className={`test-status-badge test-status-badge--${step.status}`}>
                      {step.status}
                    </span>
                  </span>
                  <span role="cell">
                    {step.messages[0] ?? step.payloadSummary ?? ''}
                  </span>
                  <span role="cell">{formatDurationClock(step.durationMs)}</span>
                </div>
              ))}

              {testCase.assertions.map((assertion) => (
                <div key={assertion.id} className="test-run-grid-row" role="row">
                  <span role="cell">assert</span>
                  <span role="cell">{assertion.label}</span>
                  <span role="cell">
                    <span
                      className={`test-status-badge test-status-badge--${assertion.status}`}
                    >
                      {assertion.status}
                    </span>
                  </span>
                  <span role="cell">
                    {assertion.message ??
                      `expected ${String(assertion.expected)} / actual ${String(
                        assertion.actual,
                      )}`}
                  </span>
                  <span role="cell" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
