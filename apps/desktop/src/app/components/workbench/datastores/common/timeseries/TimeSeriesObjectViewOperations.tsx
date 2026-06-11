import { useCallback, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import {
  ObjectBucketIcon,
  ObjectJobIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectSeriesIcon,
  ObjectStageIcon,
  TrashIcon,
} from '../../../icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from '../../../ObjectViewFeedbackPanel'

export type TimeSeriesOperationIconName =
  | 'bucket'
  | 'metric'
  | 'series'
  | 'job'
  | 'security'
  | 'storage'
  | 'delete'

export type TimeSeriesOperationAction = {
  label: string
  title: string
  icon: TimeSeriesOperationIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

interface TimeSeriesOperationStripProps {
  actions: TimeSeriesOperationAction[]
  connection: ConnectionProfile
  environment: EnvironmentProfile
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function TimeSeriesOperationStrip({
  actions,
  connection,
  environment,
  onPlanOperation,
}: TimeSeriesOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()

  const planAction = useCallback(async (action: TimeSeriesOperationAction) => {
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
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded time-series operation previews">
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
              <TimeSeriesOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function TimeSeriesOperationIcon({ icon }: { icon: TimeSeriesOperationIconName }) {
  const Icon =
    icon === 'bucket'
      ? ObjectBucketIcon
      : icon === 'series'
        ? ObjectSeriesIcon
        : icon === 'job'
          ? ObjectJobIcon
          : icon === 'security'
            ? ObjectSecurityIcon
            : icon === 'storage'
              ? ObjectStageIcon
              : icon === 'delete'
                ? TrashIcon
                : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}
