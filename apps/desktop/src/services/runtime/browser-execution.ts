import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse, ExecutionRequest, ExecutionResponse, ExecutionResultEnvelope, ResultPayload, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  interpolateEnvironmentVariables,
  referencedSensitiveEnvironmentVariableKeys,
} from '../../app/state/environment-variables'
import { createId, evaluateGuardrails, resolveEnvironment, simulateExecution } from '../../app/state/helpers'
import { redactExecutionResultForEnvironment, redactForEnvironment } from './browser-response-redaction'
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
  const queryTemplate =
    request.executionInputMode === 'script'
      ? request.mode === 'selection' && request.selectedText
        ? request.selectedText
        : request.scriptText || request.queryText
      : request.mode === 'selection' && request.selectedText
      ? request.selectedText
      : request.queryText

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
    tab.queryViewMode = request.executionInputMode
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
    next.guardrails = [{
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
    }]
    next.ui.bottomPanelVisible = true
    next.ui.activeBottomPanelTab = 'messages'
    next.updatedAt = new Date().toISOString()

    return {
      snapshot: next,
      response: {
        executionId,
        tab,
        result: undefined,
        guardrail: next.guardrails[0]!,
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
      tab.queryViewMode = request.executionInputMode
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
  const documentPayload = tab?.result?.payloads.find(
    (payload): payload is Extract<ResultPayload, { renderer: 'document' }> =>
      payload.renderer === 'document',
  )
  const document = documentPayload?.documents.find((item) =>
    documentIdsEqual(item._id, request.documentId),
  )

  if (!document) {
    throw new Error('Document is no longer available in the loaded result.')
  }

  const currentValue = valueAtPath(document, request.path)
  const previewLazy = isLazyMarker(currentValue)
  const value = previewLazy
    ? currentValue.type === 'array'
      ? []
      : {}
    : summarizeValueForLazyHydration(currentValue, request.path)
  return {
    tabId: request.tabId,
    documentId: request.documentId,
    path: request.path,
    value,
    notices: previewLazy
      ? ['Preview mode has only the summarized lazy field. Run against a live MongoDB connection to hydrate children.']
      : [],
  }
}

function summarizeDocumentResultForEfficiencyMode(
  result: ExecutionResultEnvelope,
): ExecutionResultEnvelope {
  const payloads = result.payloads.map((payload) => {
    if (payload.renderer !== 'document') {
      return payload
    }

    const documents = payload.documents.map((document) => summarizeDocumentTopLevel(document))
    return {
      ...payload,
      hydrationMode: 'lazy' as const,
      documents,
    }
  })

  return {
    ...result,
    payloads,
  }
}

function summarizeDocumentTopLevel(document: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      key,
      key === '_id' ? value : summarizeNestedValue(value, [key]),
    ]),
  )
}

function summarizeValueForLazyHydration(value: unknown, path: Array<string | number>): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => summarizeValueForLazyHydration(item, [...path, index]))
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        summarizeNestedValue(childValue, [...path, key]),
      ]),
    )
  }

  return value
}

function summarizeNestedValue(value: unknown, path: Array<string | number>): unknown {
  if (Array.isArray(value)) {
    return {
      __datapadLazyNode: true,
      type: 'array',
      childCount: value.length,
      path,
      loaded: false,
    }
  }

  if (isPlainRecord(value)) {
    return {
      __datapadLazyNode: true,
      type: 'object',
      childCount: Object.keys(value).length,
      path,
      loaded: false,
    }
  }

  return value
}

function valueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined
    }

    return (current as Record<string, unknown> | Array<unknown>)[key as never]
  }, value)
}

function documentIdsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isLazyMarker(value: unknown): value is { type: 'object' | 'array' } {
  return isPlainRecord(value) && value.__datapadLazyNode === true
}

function mongoExplainPreview() {
  return {
    queryPlanner: {
      namespace: 'catalog.products',
      parsedQuery: { sku: { $eq: 'luna-lamp' } },
      winningPlan: {
        stage: 'FETCH',
        filter: { 'inventory.available': { $gt: 0 } },
        inputStage: {
          stage: 'IXSCAN',
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
          isMultiKey: false,
        },
      },
      rejectedPlans: [
        {
          stage: 'FETCH',
          inputStage: {
            stage: 'IXSCAN',
            indexName: 'inventory_available_1',
            direction: 'forward',
            keyPattern: { 'inventory.available': 1 },
          },
        },
      ],
    },
    executionStats: {
      executionSuccess: true,
      nReturned: 1,
      executionTimeMillis: 3,
      totalKeysExamined: 1,
      totalDocsExamined: 1,
      executionStages: {
        stage: 'FETCH',
        nReturned: 1,
        works: 2,
        advanced: 1,
        docsExamined: 1,
        inputStage: {
          stage: 'IXSCAN',
          nReturned: 1,
          works: 2,
          advanced: 1,
          keysExamined: 1,
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
        },
      },
    },
    serverInfo: {
      host: 'browser-preview',
      version: '7.0.0-preview',
    },
    ok: 1,
  }
}
