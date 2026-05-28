import { useCallback, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import {
  ObjectBucketIcon,
  ObjectCollectionIcon,
  ObjectDatabaseIcon,
  ObjectDocumentIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectMemoryIcon,
  ObjectMetricIcon,
  ObjectSecurityIcon,
  ObjectStageIcon,
  TrashIcon,
} from './icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from './ObjectViewFeedbackPanel'

export type ObjectViewOperationIconName =
  | 'account'
  | 'bucket'
  | 'collection'
  | 'database'
  | 'document'
  | 'file'
  | 'index'
  | 'job'
  | 'memory'
  | 'metrics'
  | 'security'
  | 'storage'
  | 'delete'

export type ObjectViewOperationAction = {
  label: string
  title: string
  icon: ObjectViewOperationIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

interface ObjectViewOperationStripProps {
  actions: ObjectViewOperationAction[]
  ariaLabel: string
  connection: ConnectionProfile
  environment: EnvironmentProfile
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function ObjectViewOperationStrip({
  actions,
  ariaLabel,
  connection,
  environment,
  onPlanOperation,
}: ObjectViewOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()

  const planAction = useCallback(async (action: ObjectViewOperationAction) => {
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
      <section className="object-view-section object-view-workflow-section" aria-label={ariaLabel}>
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
              <ObjectViewOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function ObjectViewOperationIcon({ icon }: { icon: ObjectViewOperationIconName }) {
  const Icon =
    icon === 'bucket'
      ? ObjectBucketIcon
      : icon === 'collection'
        ? ObjectCollectionIcon
        : icon === 'database' || icon === 'account'
          ? ObjectDatabaseIcon
          : icon === 'document'
            ? ObjectDocumentIcon
            : icon === 'index'
              ? ObjectIndexIcon
              : icon === 'job'
                ? ObjectJobIcon
                : icon === 'memory'
                  ? ObjectMemoryIcon
                  : icon === 'security'
                    ? ObjectSecurityIcon
                    : icon === 'storage' || icon === 'file'
                      ? ObjectStageIcon
                      : icon === 'delete'
                        ? TrashIcon
                        : ObjectMetricIcon

  return <Icon className="panel-inline-icon" />
}
