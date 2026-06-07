import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse, ExecutionRequest, ExecutionResponse, GuardrailDecision, ResultPayload, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  interpolateEnvironmentVariables,
  referencedSensitiveEnvironmentVariableKeys,
} from '../../app/state/environment-variables'
import { createId, evaluateGuardrails, resolveEnvironment, simulateExecution } from '../../app/state/helpers'
import { redactExecutionResultForEnvironment, redactForEnvironment } from './browser-response-redaction'
import {
  fetchDocumentNodeChildrenFromResult,
  summarizeDocumentResultForEfficiencyMode,
} from './browser-document-efficiency'
import { mongoExplainPreview } from './browser-mongo-explain-preview'
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
  const selectedText = request.selectedText?.trim() ? request.selectedText : undefined
  const queryTemplate =
    request.executionInputMode === 'script'
      ? selectedText
        ? selectedText
        : request.scriptText || request.queryText
      : selectedText ?? request.queryText

  const referencedSecrets = referencedSensitiveEnvironmentVariableKeys(
    queryTemplate,
    resolvedEnvironment.sensitiveKeys,
  )
  if (referencedSecrets.length > 0) {
    const executionId = request.executionId ?? createId('execution')
    tab.queryText = request.queryText
    if (request.executionInputMode === 'script') {
      tab.scriptText = request.scriptText
    }
    if (request.executionInputMode) {
      tab.queryViewMode = request.executionInputMode
    }
    tab.status = 'blocked'
    tab.lastRunAt = new Date().toISOString()
    tab.history.unshift({
      id: createId('history'),
      queryText: queryTemplate,
      executedAt: tab.lastRunAt,
      status: tab.status,
    })
    tab.error = {
      code: 'secret-variable-preview-blocked',
      message:
        'Secret environment variables are resolved only by the desktop secret store. Browser preview will not substitute masked values into executable text.',
    }
    tab.result = undefined
    const guardrail: GuardrailDecision = {
      id: confirmationGuardrailId(
        connection.id,
        environment.id,
        request.mode ?? 'full',
        queryTemplate,
      ),
      reasons: [
        `Secret variable ${referencedSecrets[0]} cannot be resolved in browser preview.`,
      ],
      safeModeApplied: next.preferences.safeModeEnabled || environment.safeMode,
      status: 'block',
    }
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
        diagnostics: [
          'Secret environment variables are not substituted in browser preview.',
        ],
      },
    }
  }

  const queryText = interpolateEnvironmentVariables(
    queryTemplate,
    resolvedEnvironment.variables,
  )
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
      if (request.executionInputMode) {
        tab.queryViewMode = request.executionInputMode
      }
      tab.status = 'blocked'
      tab.lastRunAt = new Date().toISOString()
      tab.history.unshift({
        id: createId('history'),
        queryText: queryTemplate,
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
  if (result && request.documentEfficiencyMode && connection.family === 'document') {
    result = summarizeDocumentResultForEfficiencyMode(result)
  }
  const diagnostics: string[] = []

  if (request.mode === 'explain' && result && connection.engine === 'mongodb') {
    const explain = mongoExplainPreview()
    const planPayload: ResultPayload = {
      renderer: 'plan',
      format: 'json',
      value: explain,
      summary: 'MongoDB execution plan',
    }
    result = {
      ...result,
      id: createId('result'),
      summary: `MongoDB explain plan prepared for ${connection.name}.`,
      defaultRenderer: 'plan',
      rendererModes: ['plan', 'json', 'raw'],
      payloads: [
        planPayload,
        { renderer: 'json', value: explain },
        { renderer: 'raw', text: JSON.stringify(explain, null, 2) },
      ],
      explainPayload: planPayload,
    }
  } else if (request.mode === 'explain' && result) {
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
  } else if (request.mode === 'profile' && result) {
    const profilePayload: ResultPayload = {
      renderer: 'profile',
      summary: `${connection.engine} profile preview`,
      stages: [
        {
          name: 'browser-preview',
          durationMs: result.durationMs ?? 0,
          rows: result.pageInfo?.bufferedRows ?? 0,
          details: {
            engine: connection.engine,
            mode: 'profile',
            query: queryText,
          },
        },
      ],
    }

    result = {
      ...result,
      id: createId('result'),
      summary: `Profile preview prepared for ${connection.name}.`,
      defaultRenderer: 'profile',
      rendererModes: [
        'profile',
        ...result.rendererModes.filter((mode) => mode !== 'profile'),
      ],
      payloads: [
        profilePayload,
        ...result.payloads.filter((payload) => payload.renderer !== 'profile'),
      ],
    }
  }

  if (guardrail.status === 'confirm') {
    diagnostics.push(guardrail.reasons[0] ?? 'Confirmation required for this query.')
  }

  result = redactExecutionResultForEnvironment(result, resolvedEnvironment)
  const redactedDiagnostics = redactForEnvironment(diagnostics, resolvedEnvironment)

  tab.queryText = request.queryText
  if (request.executionInputMode === 'script') {
    tab.scriptText = request.scriptText
  }
  if (request.executionInputMode) {
    tab.queryViewMode = request.executionInputMode
  }
  tab.status =
    guardrail.status === 'block'
      ? 'blocked'
      : result
        ? 'success'
        : 'error'
  tab.lastRunAt = new Date().toISOString()
    tab.history.unshift({
      id: createId('history'),
      queryText: queryTemplate,
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
      diagnostics: redactedDiagnostics,
    },
  }
}

export function fetchDocumentNodeChildrenLocally(
  snapshot: WorkspaceSnapshot,
  request: DocumentNodeChildrenRequest,
): DocumentNodeChildrenResponse {
  const tab = findTab(snapshot, request.tabId)
  return fetchDocumentNodeChildrenFromResult(tab?.result, request)
}
