import type { OperationPlan, OperationPlanResponse } from '@datapadplusplus/shared-types'
import type { Actions } from '../state/app-state-types'

export function operationReviewReasons(plan: OperationPlan) {
  const reasons = [
    ...plan.warnings.filter((warning) => !mentionsConfirmationText(warning, plan.confirmationText)),
    plan.destructive ? 'This operation can make destructive changes.' : undefined,
    plan.estimatedScanImpact,
    plan.estimatedCost,
    plan.requiredPermissions.length
      ? `Required permissions: ${plan.requiredPermissions.join(', ')}`
      : undefined,
  ]

  return uniqueStrings(reasons.filter((reason): reason is string => Boolean(reason))).slice(0, 4)
}

export function operationExecutionPlanResponse(
  fallback: OperationPlanResponse,
  execution: Awaited<ReturnType<Actions['executeDatastoreOperation']>>,
) {
  if (!execution) {
    return operationPlanWithWarning(fallback, 'Operation execution did not return a response.')
  }

  const warnings = execution.warnings.filter(
    (warning) => !mentionsConfirmationText(warning, execution.plan.confirmationText),
  )
  const summary = execution.executed
    ? execution.messages.at(-1) ?? 'Operation executed successfully.'
    : warnings.at(-1) ?? execution.messages.at(-1) ?? 'Operation was not applied.'

  return {
    connectionId: execution.connectionId,
    environmentId: execution.environmentId,
    plan: {
      ...execution.plan,
      summary,
      warnings: uniqueStrings([
        ...execution.plan.warnings.filter(
          (warning) => !mentionsConfirmationText(warning, execution.plan.confirmationText),
        ),
        ...warnings,
      ]),
    },
  }
}

export function uniqueStrings(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function operationPlanWithWarning(response: OperationPlanResponse, warning: string) {
  return {
    ...response,
    plan: {
      ...response.plan,
      warnings: uniqueStrings([
        ...response.plan.warnings.filter(
          (item) => !mentionsConfirmationText(item, response.plan.confirmationText),
        ),
        warning,
      ]),
    },
  }
}

function mentionsConfirmationText(message: string, confirmationText?: string) {
  return Boolean(
    confirmationText &&
      (message.includes(`Type \`${confirmationText}\``) || message.includes(confirmationText)),
  )
}
