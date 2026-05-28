import { useCallback, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import {
  ObjectDatabaseIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
} from './icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from './ObjectViewFeedbackPanel'

export type WideColumnOperationIconName = 'database' | 'table' | 'index' | 'security' | 'job'

export type WideColumnOperationAction = {
  label: string
  title: string
  icon: WideColumnOperationIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

interface WideColumnOperationStripProps {
  actions: WideColumnOperationAction[]
  connection: ConnectionProfile
  environment: EnvironmentProfile
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function WideColumnOperationStrip({
  actions,
  connection,
  environment,
  onPlanOperation,
}: WideColumnOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()

  const planAction = useCallback(async (action: WideColumnOperationAction) => {
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
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded wide-column operation previews">
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
              <WideColumnOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function WideColumnOperationIcon({ icon }: { icon: WideColumnOperationIconName }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : icon === 'database'
            ? ObjectDatabaseIcon
            : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
}
