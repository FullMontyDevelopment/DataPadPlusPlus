import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  ObjectDatabaseIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectStageIcon,
  ObjectTableIcon,
  ObjectWarehouseIcon,
  TrashIcon,
} from './icons'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from './ObjectViewFeedbackPanel'
import {
  type WarehouseOperationAction,
  type WarehouseOperationIconName,
  warehouseOperationActions,
} from './WarehouseObjectViewOperations.helpers'

type JsonRecord = Record<string, unknown>

interface WarehouseOperationStripProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  kind: string
  payload: JsonRecord
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function WarehouseOperationStrip({
  connection,
  environment,
  tab,
  kind,
  payload,
  onPlanOperation,
}: WarehouseOperationStripProps) {
  const [planningOperationId, setPlanningOperationId] = useState<string>()
  const [feedback, setFeedback] = useState<ObjectViewFeedback>()
  const actions = useMemo(
    () => warehouseOperationActions(connection, tab, kind, payload),
    [connection, kind, payload, tab],
  )

  const planAction = useCallback(async (action: WarehouseOperationAction) => {
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
      <section className="object-view-section object-view-workflow-section" aria-label="Guarded warehouse operation previews">
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
              <WarehouseOperationIcon icon={action.icon} />
              <span>{planningOperationId === action.operationId ? 'Planning...' : action.label}</span>
            </button>
          ))}
        </div>
      </section>
      <ObjectViewFeedbackPanel feedback={feedback} />
    </>
  )
}

function WarehouseOperationIcon({ icon }: { icon: WarehouseOperationIconName }) {
  const Icon =
    icon === 'database'
      ? ObjectDatabaseIcon
      : icon === 'table'
        ? ObjectTableIcon
        : icon === 'stage'
          ? ObjectStageIcon
          : icon === 'job'
            ? ObjectJobIcon
            : icon === 'security'
              ? ObjectSecurityIcon
              : icon === 'delete'
                ? TrashIcon
                : ObjectWarehouseIcon

  return <Icon className="panel-inline-icon" />
}
