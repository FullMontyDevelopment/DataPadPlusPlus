import { useState } from 'react'
import type { OperationPlan } from '@datapadplusplus/shared-types'
import { WarningIcon } from './icons'

export type ObjectViewFeedback = {
  title: string
  plan?: OperationPlan
  executed?: boolean
  messages: string[]
  warnings: string[]
  metadata?: unknown
}

export function ObjectViewFeedbackPanel({ feedback }: { feedback?: ObjectViewFeedback }) {
  const [showGeneratedRequest, setShowGeneratedRequest] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)

  if (!feedback) {
    return null
  }

  return (
    <div className="object-view-plan">
      <div className="object-view-section-heading">
        <WarningIcon className="panel-inline-icon" />
        <strong>{feedback.title}</strong>
        {feedback.executed !== undefined ? <span>{feedback.executed ? 'applied' : 'not applied'}</span> : null}
      </div>
      {feedback.messages.length ? (
        <ul className="object-view-message-list">
          {feedback.messages.map((message) => <li key={message}>{message}</li>)}
        </ul>
      ) : null}
      {feedback.warnings.length ? <FeedbackWarningList warnings={feedback.warnings} /> : null}
      {feedback.plan ? (
        <>
          <p>{feedback.plan.summary}</p>
          <div className="object-view-card-grid">
            <div className="object-view-card">
              <span>Status</span>
              <strong>{feedback.executed === true ? 'Applied' : 'Prepared'}</strong>
            </div>
            <div className="object-view-card">
              <span>Approval</span>
              <strong>{feedback.plan.confirmationText ? 'Guarded' : 'Open'}</strong>
            </div>
            <div className="object-view-card">
              <span>Permissions</span>
              <strong>{feedback.plan.requiredPermissions.length || 'None'}</strong>
            </div>
            <div className="object-view-card">
              <span>Impact</span>
              <strong>{feedback.plan.estimatedScanImpact ?? feedback.plan.estimatedCost ?? 'Scoped'}</strong>
            </div>
          </div>
          <div className="object-view-disclosure">
            <button
              type="button"
              className="drawer-button"
              onClick={() => setShowGeneratedRequest((current) => !current)}
            >
              {showGeneratedRequest ? 'Hide Request' : 'Show Request'}
            </button>
            {showGeneratedRequest ? (
              <pre className="object-view-code">{feedback.plan.generatedRequest}</pre>
            ) : null}
          </div>
        </>
      ) : null}
      {feedback.metadata ? (
        <div className="object-view-disclosure">
          <button
            type="button"
            className="drawer-button"
            onClick={() => setShowMetadata((current) => !current)}
          >
            {showMetadata ? 'Hide Details' : 'Result Details'}
          </button>
          {showMetadata ? (
            <pre className="object-view-code">{prettyJson(feedback.metadata)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function FeedbackWarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div className="object-view-warning" key={warning}>
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
