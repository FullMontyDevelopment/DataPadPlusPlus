import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  ObjectConstraintIcon,
  ObjectGraphIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  TrashIcon,
} from '../../../icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from '../../../ObjectViewFeedbackPanel'
import {
  graphOperationActions,
  type GraphOperationAction,
  type GraphOperationIconName,
} from './GraphObjectViewOperations.helpers'

type JsonRecord = Record<string, unknown>

interface GraphOperationStripProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  kind: string
  payload: JsonRecord
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function GraphOperationStrip({
  connection,
  environment,
  tab,
  kind,
  payload,
  onPlanOperation,
}: GraphOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()
  const actions = useMemo(
    () => graphOperationActions(connection, tab, kind, payload),
    [connection, kind, payload, tab],
  )

  const planAction = useCallback(async (action: GraphOperationAction) => {
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
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded graph operation previews">
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
              <GraphOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function GraphOperationIcon({ icon }: { icon: GraphOperationIconName }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'constraint'
        ? ObjectConstraintIcon
        : icon === 'security'
          ? ObjectSecurityIcon
          : icon === 'diagnostics'
            ? ObjectJobIcon
            : icon === 'delete'
              ? TrashIcon
              : ObjectGraphIcon

  return <Icon className="panel-inline-icon" />
}
