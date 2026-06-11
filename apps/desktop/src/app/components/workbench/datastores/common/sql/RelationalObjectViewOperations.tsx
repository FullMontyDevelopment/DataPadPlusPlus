import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { ObjectIndexIcon, ObjectJobIcon, ObjectSecurityIcon, ObjectTableIcon } from '../../../icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from '../../../ObjectViewFeedbackPanel'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'
import type { RelationalSectionIcon } from './RelationalObjectViewSections'
import {
  relationalOperationActions,
  type RelationalOperationAction,
} from './RelationalObjectViewOperations.helpers'

interface RelationalOperationStripProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  kind: string
  payload: JsonRecord
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function RelationalOperationStrip({
  connection,
  environment,
  tab,
  kind,
  payload,
  onPlanOperation,
}: RelationalOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()
  const actions = useMemo(
    () => relationalOperationActions(connection, tab, kind, payload),
    [connection, kind, payload, tab],
  )

  const planAction = useCallback(async (action: RelationalOperationAction) => {
    if (!onPlanOperation || planningOperationId) {
      return
    }

    setPlanningOperationId(action.operationId)
    try {
      const response = await onPlanOperation({
        connectionId: connection.id,
        environmentId: environment.id,
        operationId: action.operationId,
        objectName: action.objectName,
        parameters: action.parameters,
      })
      if (response?.plan) {
        setFeedback({
          title: action.title,
          plan: response.plan,
          messages: [],
          warnings: response.plan.warnings,
        })
      }
    } finally {
      setPlanningOperationId(undefined)
    }
  }, [connection.id, environment.id, onPlanOperation, planningOperationId])

  if (!onPlanOperation || !actions.length) {
    return null
  }

  return (
    <>
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded operation previews">
        <div className="object-view-action-chips">
          {actions.map((action) => (
            <button
              key={action.operationId}
              type="button"
              className="object-view-action-chip object-view-action-chip--button"
              title={action.title}
              onClick={() => void planAction(action)}
              disabled={Boolean(planningOperationId)}
            >
              <OperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function OperationIcon({ icon }: { icon: RelationalSectionIcon }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
}
