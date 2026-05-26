import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
} from '@datapadplusplus/shared-types'

export type ExecuteDataEdit = (
  request: DataEditExecutionRequest,
) => Promise<DataEditExecutionResponse | undefined>

export type DataEditConfirmationHandler = (
  response: DataEditExecutionResponse,
  options: ExecuteDataEditOptions,
) => boolean | Promise<boolean>

export interface ExecuteDataEditOptions {
  actionLabel?: string
  confirm?: DataEditConfirmationHandler
  confirmationTitle?: string
}

export interface DataEditConfirmationDetails {
  action: string
  reasons: string[]
  title: string
}

export async function executeDataEditWithConfirmation(
  executeDataEdit: ExecuteDataEdit,
  request: DataEditExecutionRequest,
  options: ExecuteDataEditOptions = {},
) {
  const response = await executeDataEdit(request)
  const confirmationText = response?.plan?.confirmationText

  if (
    response?.executed ||
    !confirmationText ||
    request.confirmationText === confirmationText ||
    response.executionSupport !== 'live'
  ) {
    return response ? withoutTypedConfirmationWarnings(response) : response
  }

  if (!options.confirm) {
    return {
      ...withoutTypedConfirmationWarnings(response),
      warnings: [
        ...withoutTypedConfirmationWarnings(response).warnings,
        'Data edit canceled because confirmation UI is unavailable.',
      ],
    }
  }

  const confirmed = await options.confirm(withoutTypedConfirmationWarnings(response), options)
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

export function dataEditConfirmationDetails(
  response: DataEditExecutionResponse,
  options: ExecuteDataEditOptions,
) {
  const cleanResponse = withoutTypedConfirmationWarnings(response)
  const reasons = [...(cleanResponse.plan?.warnings ?? []), ...cleanResponse.warnings]
    .filter((warning) => !/guarded operation plans/i.test(warning))
    .filter((warning, index, warnings) => warnings.indexOf(warning) === index)
    .slice(0, 4)
  const title = options.confirmationTitle ?? 'Apply this data edit?'
  const action = options.actionLabel ?? cleanResponse.plan?.summary ?? 'Apply this data edit.'

  return { action, reasons, title }
}

function withoutTypedConfirmationWarnings(response: DataEditExecutionResponse) {
  const confirmationText = response.plan?.confirmationText
  if (!confirmationText) {
    return response
  }

  return {
    ...response,
    plan: {
      ...response.plan,
      warnings: response.plan.warnings.filter(
        (warning) => !isTypedConfirmationWarning(warning, confirmationText),
      ),
    },
    messages: response.messages.filter(
      (message) => !isTypedConfirmationWarning(message, confirmationText),
    ),
    warnings: response.warnings.filter(
      (warning) => !isTypedConfirmationWarning(warning, confirmationText),
    ),
  }
}

function isTypedConfirmationWarning(message: string, confirmationText: string) {
  return (
    message.includes(`Type \`${confirmationText}\``) ||
    message.includes(confirmationText)
  )
}
