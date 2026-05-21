import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
} from '@datapadplusplus/shared-types'

export type ExecuteDataEdit = (
  request: DataEditExecutionRequest,
) => Promise<DataEditExecutionResponse | undefined>

interface ExecuteDataEditOptions {
  actionLabel?: string
  confirmationTitle?: string
}

export async function executeDataEditWithConfirmation(
  executeDataEdit: ExecuteDataEdit,
  request: DataEditExecutionRequest,
  options: ExecuteDataEditOptions = {},
) {
  const response = await executeDataEdit(request)
  const confirmationText = response?.plan.confirmationText

  if (
    response?.executed ||
    !confirmationText ||
    request.confirmationText === confirmationText ||
    response.executionSupport !== 'live'
  ) {
    return response ? withoutTypedConfirmationWarnings(response) : response
  }

  const confirmed = window.confirm(dataEditConfirmationMessage(response, options))
  if (!confirmed) {
    return {
      ...withoutTypedConfirmationWarnings(response),
      warnings: [
        ...withoutTypedConfirmationWarnings(response).warnings,
        'Data edit canceled before execution.',
      ],
    }
  }

  const confirmedResponse = await executeDataEdit({
    ...request,
    confirmationText,
  })

  return confirmedResponse
    ? withoutTypedConfirmationWarnings(confirmedResponse)
    : confirmedResponse
}

export function dataEditStatusMessage(
  response: DataEditExecutionResponse | undefined,
  fallback: string,
) {
  const cleanResponse = response ? withoutTypedConfirmationWarnings(response) : undefined
  return (
    cleanResponse?.messages.at(-1) ??
    cleanResponse?.warnings.at(-1) ??
    fallback
  )
}

function dataEditConfirmationMessage(
  response: DataEditExecutionResponse,
  options: ExecuteDataEditOptions,
) {
  const cleanResponse = withoutTypedConfirmationWarnings(response)
  const reasons = [...cleanResponse.plan.warnings, ...cleanResponse.warnings]
    .filter((warning) => !/guarded operation plans/i.test(warning))
    .filter((warning, index, warnings) => warnings.indexOf(warning) === index)
    .slice(0, 4)
  const title = options.confirmationTitle ?? 'Apply this data edit?'
  const action = options.actionLabel ?? cleanResponse.plan.summary
  const detailLines = [
    title,
    '',
    action,
    ...(
      reasons.length > 0
        ? ['', 'Guardrails:', ...reasons.map((reason) => `- ${reason}`)]
        : []
    ),
  ]

  return detailLines.join('\n')
}

function withoutTypedConfirmationWarnings(response: DataEditExecutionResponse) {
  const confirmationText = response.plan.confirmationText
  if (!confirmationText) {
    return response
  }

  return {
    ...response,
    warnings: response.warnings.filter(
      (warning) =>
        !warning.includes(`Type \`${confirmationText}\``) &&
        !warning.includes(confirmationText),
    ),
  }
}
