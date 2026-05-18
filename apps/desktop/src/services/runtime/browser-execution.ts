import type { ExecutionRequest, ExecutionResponse, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId, evaluateGuardrails, resolveEnvironment, simulateExecution } from '../../app/state/helpers'
import { cloneSnapshot, confirmationGuardrailId, findConnection, findEnvironment, findTab } from './browser-store'

export function applyExecutionRequestLocally(
  snapshot: WorkspaceSnapshot,
  request: ExecutionRequest,
): { snapshot: WorkspaceSnapshot; response: ExecutionResponse }
{
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, request.tabId)
  const connection = findConnection(next, request.connectionId)
  const environment = findEnvironment(next, request.environmentId)

  if (!tab || !connection || !environment) {
    throw new Error('Unable to resolve the active execution context.')
  }

  const resolvedEnvironment = resolveEnvironment(next.environments, request.environmentId)
  const queryText =
    request.executionInputMode === 'script'
      ? request.mode === 'selection' && request.selectedText
        ? request.selectedText
        : request.scriptText || request.queryText
      : request.mode === 'selection' && request.selectedText
      ? request.selectedText
      : request.queryText
  const guardrail = evaluateGuardrails(
    connection,
    environment,
    resolvedEnvironment,
    queryText,
    next.preferences.safeModeEnabled,
  )
  if (guardrail.status === 'confirm') {
    const guardrailId = confirmationGuardrailId(
      connection.id,
      environment.id,
      request.mode ?? 'full',
      queryText,
    )
    guardrail.id = guardrailId
    guardrail.requiredConfirmationText = `CONFIRM ${environment.label}`

    if (request.confirmedGuardrailId !== guardrailId) {
      const executionId = request.executionId ?? createId('execution')
      tab.queryText = request.queryText
      if (request.executionInputMode === 'script') {
        tab.scriptText = request.scriptText
      }
      tab.queryViewMode = request.executionInputMode
      tab.status = 'blocked'
      tab.lastRunAt = new Date().toISOString()
      tab.history.unshift({
        id: createId('history'),
        queryText,
        executedAt: tab.lastRunAt,
        status: tab.status,
      })
      tab.error = {
        code: 'guardrail-confirmation-required',
        message: guardrail.reasons.join(' '),
      }
      tab.result = undefined
      next.guardrails = [guardrail]
      next.ui.bottomPanelVisible = true
      next.ui.activeBottomPanelTab = 'messages'
      next.updatedAt = new Date().toISOString()

      return {
        snapshot: next,
        response: {
          executionId,
          tab,
          result: undefined,
          guardrail,
          diagnostics: ['Execution requires explicit confirmation before running.'],
        },
      }
    }
  }

  const executionId = request.executionId ?? createId('execution')
  const simulated = simulateExecution(connection, environment, resolvedEnvironment, {
    ...tab,
    queryText,
    queryViewMode: request.executionInputMode ?? tab.queryViewMode,
    scriptText: request.scriptText ?? tab.scriptText,
  })

  let result = guardrail.status === 'block' ? undefined : simulated.result
  const diagnostics: string[] = []

  if (request.mode === 'explain' && result) {
    const explainText =
      connection.family === 'sql'
        ? `Explain plan preview for ${connection.engine}\n\n${queryText}`
        : `Execution plan preview is not supported for ${connection.engine}.`

    result = {
      ...result,
      id: createId('result'),
      summary: `Explain plan prepared for ${connection.name}.`,
      defaultRenderer: 'raw',
      rendererModes: ['raw', ...result.rendererModes.filter((mode) => mode !== 'raw')],
      payloads: [
        { renderer: 'raw', text: explainText },
        ...result.payloads.filter((payload) => payload.renderer !== 'raw'),
      ],
      explainPayload: { renderer: 'raw', text: explainText },
    }
  }

  if (guardrail.status === 'confirm') {
    diagnostics.push(guardrail.reasons[0] ?? 'Confirmation required for this query.')
  }

  tab.queryText = request.queryText
  if (request.executionInputMode === 'script') {
    tab.scriptText = request.scriptText
  }
  tab.queryViewMode = request.executionInputMode
  tab.status =
    guardrail.status === 'block'
      ? 'blocked'
      : result
        ? 'success'
        : 'error'
  tab.lastRunAt = new Date().toISOString()
  tab.history.unshift({
    id: createId('history'),
    queryText,
    executedAt: tab.lastRunAt,
    status: tab.status,
  })
  tab.error =
    guardrail.status === 'block'
      ? {
          code: 'guardrail-blocked',
          message: guardrail.reasons.join(' '),
        }
      : undefined
  tab.result = result

  next.guardrails = [guardrail]
  next.ui.bottomPanelVisible = true
  next.ui.activeBottomPanelTab = 'results'
  next.updatedAt = new Date().toISOString()

  return {
    snapshot: next,
    response: {
      executionId,
      tab,
      result,
      guardrail,
      diagnostics,
    },
  }
}
