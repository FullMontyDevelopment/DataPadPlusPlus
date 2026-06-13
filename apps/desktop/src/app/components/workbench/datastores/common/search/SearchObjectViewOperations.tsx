import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { ObjectIndexIcon, ObjectJobIcon, ObjectSearchIcon, ObjectSecurityIcon } from '../../../icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from '../../../ObjectViewFeedbackPanel'
import type { SearchWorkflowIconName } from './SearchObjectViewWorkflows'
import {
  searchOperationActions,
  type SearchOperationAction,
} from './SearchObjectViewOperations.helpers'

type JsonRecord = Record<string, unknown>

interface SearchOperationStripProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  kind: string
  payload: JsonRecord
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function SearchOperationStrip({
  connection,
  environment,
  tab,
  kind,
  payload,
  onPlanOperation,
}: SearchOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()
  const actions = useMemo(
    () => searchOperationActions(connection, tab, kind, payload),
    [connection, kind, payload, tab],
  )

  const planAction = useCallback(async (action: SearchOperationAction) => {
    if (!onPlanOperation || planningOperationId) {
      return
    }

    setFeedback(undefined)
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
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded search operations">
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
              <SearchOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Running...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function SearchOperationIcon({ icon }: { icon: SearchWorkflowIconName }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectSearchIcon

  return <Icon className="panel-inline-icon" />
}
