import type { DocumentNodeChildrenRequest, DocumentNodeChildrenResponse, ExecutionRequest, ExecutionResponse, ExecutionResultEnvelope, GuardrailDecision, QueryBuilderState, ResultPayload, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
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
import { mongoExplainPreview } from './datastores/mongodb/browser-mongo-explain-preview'
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
    if (request.documentEfficiencyMode !== undefined) {
      tab.documentEfficiencyMode = request.documentEfficiencyMode
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
      safeModeApplied: false,
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
      if (request.documentEfficiencyMode !== undefined) {
        tab.documentEfficiencyMode = request.documentEfficiencyMode
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
      next.updatedAt = new Date().toISOString()

      return {
        snapshot: next,
        response: {
          executionId,
          tab,
          result: undefined,
          guardrail,
          diagnostics: [],
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
  if (
    result &&
    request.executionInputMode === 'script' &&
    connection.engine === 'mongodb'
  ) {
    result = browserMongoScriptPreview(result, queryText, connection.name)
  }
  if (result && request.documentEfficiencyMode && connection.family === 'document') {
    result = summarizeDocumentResultForEfficiencyMode(result)
  }
  if (result && request.mode === 'count') {
    result = browserCountPreview(result, request, queryText)
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

  result = redactExecutionResultForEnvironment(result, resolvedEnvironment)
  const redactedDiagnostics = redactForEnvironment(diagnostics, resolvedEnvironment)

  tab.queryText = request.queryText
  if (request.executionInputMode === 'script') {
    tab.scriptText = request.scriptText
  }
  if (request.executionInputMode) {
    tab.queryViewMode = request.executionInputMode
  }
  if (request.documentEfficiencyMode !== undefined) {
    tab.documentEfficiencyMode = request.documentEfficiencyMode
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

function browserMongoScriptPreview(
  result: ExecutionResultEnvelope,
  script: string,
  connectionName: string,
): ExecutionResultEnvelope {
  const metadata = {
    preview: true,
    executed: false,
    engine: 'mongodb',
    connection: connectionName,
    script,
    message: 'Browser preview validated the script shape but did not contact MongoDB.',
  }
  return {
    ...result,
    id: createId('result'),
    summary: 'MongoDB script preview prepared locally; no remote operation was executed.',
    defaultRenderer: 'json',
    rendererModes: ['json', 'raw'],
    payloads: [
      { renderer: 'json', value: metadata },
      { renderer: 'raw', text: JSON.stringify(metadata, null, 2) },
    ],
    notices: [
      ...(result.notices ?? []),
      {
        code: 'mongodb-script-browser-preview',
        level: 'info',
        message: 'Live MongoDB scripting requires the DataPad++ desktop runtime.',
      },
    ],
    truncated: false,
    rowLimit: undefined,
    pageInfo: {
      pageSize: 0,
      pageIndex: 0,
      bufferedRows: 0,
      hasMore: false,
    },
  }
}

function browserCountPreview(
  result: ExecutionResultEnvelope,
  request: ExecutionRequest,
  queryText: string,
): ExecutionResultEnvelope {
  const count = String(result.pageInfo?.bufferedRows ?? 0)
  const builderKind = request.builderState?.kind ?? 'unknown'
  const target = browserBuilderTarget(request.builderState)
  return {
    ...result,
    summary: `Preview Count matched ${count} synthetic record(s) in ${target}.`,
    defaultRenderer: 'table',
    rendererModes: ['table', 'json', 'raw'],
    payloads: [
      { renderer: 'table', columns: ['count'], rows: [[count]] },
      {
        renderer: 'json',
        value: {
          count,
          exact: true,
          preview: true,
          builderKind,
          target,
          durationMs: result.durationMs ?? 0,
        },
      },
      { renderer: 'raw', text: queryText },
    ],
    notices: [
      ...result.notices,
      {
        code: 'query-builder-count-preview',
        level: 'info',
        message: 'Browser preview Count uses deterministic synthetic data, not a remote datastore.',
      },
    ],
    truncated: false,
    rowLimit: undefined,
    pageInfo: {
      pageSize: 1,
      pageIndex: 0,
      bufferedRows: 1,
      hasMore: false,
      totalRowsKnown: 1,
    },
  }
}

function browserBuilderTarget(state: QueryBuilderState | undefined) {
  if (!state) {
    return 'preview data'
  }
  switch (state.kind) {
    case 'mongo-find':
    case 'mongo-aggregation':
      return [state.database, state.collection].filter(Boolean).join('.') || 'collection'
    case 'sql-select':
      return [state.schema, state.table].filter(Boolean).join('.') || 'table'
    case 'cql-partition':
      return [state.keyspace, state.table].filter(Boolean).join('.') || 'table'
    case 'dynamodb-key-condition':
      return [state.table, state.indexName].filter(Boolean).join('.') || 'table'
    case 'cosmos-sql':
      return [state.database, state.container].filter(Boolean).join('.') || 'container'
    case 'search-dsl':
      return state.index || '_all'
    case 'redis-key-browser':
      return `database ${state.databaseIndex ?? 0} (${state.pattern || '*'})`
  }
}

export function fetchDocumentNodeChildrenLocally(
  snapshot: WorkspaceSnapshot,
  request: DocumentNodeChildrenRequest,
): DocumentNodeChildrenResponse {
  const tab = findTab(snapshot, request.tabId)
  return fetchDocumentNodeChildrenFromResult(tab?.result, request)
}
