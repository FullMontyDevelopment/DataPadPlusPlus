import type {
  ConnectionProfile,
  KeyValuePayload,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import { redisKeyOperationPlanRequest } from './keyvalue-results-helpers'

type PlanOperation = NonNullable<{
  onPlanOperation?: (
    request: ReturnType<typeof redisKeyOperationPlanRequest> & {},
  ) => Promise<OperationPlanResponse | undefined>
}['onPlanOperation']>

interface UseRedisKeyFileOperationsOptions {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  onPlanOperation?: PlanOperation
  payload?: KeyValuePayload
  selectedKey?: string
  setStatusMessage(value: string): void
}

export function useRedisKeyFileOperations({
  connection,
  editContext,
  onPlanOperation,
  payload,
  selectedKey,
  setStatusMessage,
}: UseRedisKeyFileOperationsOptions) {
  const canPlanKeyOperation = Boolean(onPlanOperation && selectedKey && connection && editContext)

  const planKeyOperation = async (operation: 'export' | 'import') => {
    const request = redisKeyOperationPlanRequest({
      connection,
      editContext,
      payload,
      operation,
    })
    if (!onPlanOperation || !selectedKey || !request) {
      return
    }

    const response = await onPlanOperation(request)
    setStatusMessage(
      response?.plan
        ? `${operationLabel(operation)} plan ready for ${selectedKey}.`
        : `Unable to prepare ${operation} for ${selectedKey}.`,
    )
  }

  return {
    canPlanKeyOperation,
    planKeyExport: () => planKeyOperation('export'),
    planKeyImport: () => planKeyOperation('import'),
  }
}

function operationLabel(operation: 'export' | 'import') {
  return operation === 'export' ? 'Export' : 'Import'
}
