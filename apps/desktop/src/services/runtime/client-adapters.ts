import type { AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, DataEditExecutionRequest, DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse, DatastoreExperienceResponse, ExecutionResponse, ExecutionResultEnvelope, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerRequest, ExplorerResponse, OperationExecutionRequest, OperationExecutionResponse, OperationManifestRequest, OperationManifestResponse, OperationPlanRequest, OperationPlanResponse, PermissionInspectionRequest, PermissionInspectionResponse, ResultRenderer, RedisKeyInspectRequest, RedisKeyScanRequest, RedisKeyScanResponse, StructureRequest, StructureResponse } from '@datapadplusplus/shared-types'
import { buildDatastoreExperiences, executeDataEditLocally, planDataEditLocally } from './browser-datastore-platform'
import { buildOperationManifestsForConnection, collectDiagnosticsLocally, executeOperationLocally, inspectPermissionsLocally, planOperationLocally } from './browser-operations'
import { redactExecutionResultForEnvironment, redactForEnvironment } from './browser-response-redaction'
import { createStructureResponseLocally } from './browser-structure'
import { buildExecutionCapabilities, findConnection, loadBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { resolveEnvironment } from '../../app/state/helpers'
import {
  validateAdapterDiagnosticsRequest,
  validateDataEditExecutionRequest,
  validateDataEditPlanRequest,
  validateExplorerInspectRequest,
  validateExplorerRequest,
  validateOperationExecutionRequest,
  validateOperationManifestRequest,
  validateOperationPlanRequest,
  validatePermissionInspectionRequest,
  validateRedisKeyInspectRequest,
  validateRedisKeyScanRequest,
  validateStructureRequest,
} from './request-validation'

export const clientAdapters = {
  async loadExplorer(request: ExplorerRequest): Promise<ExplorerResponse> {
    request = validateExplorerRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExplorerResponse>('list_explorer_nodes', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const connection = findConnection(snapshot, request.connectionId)

    if (!connection) {
      throw new Error('Connection was not found.')
    }

    const { createExplorerNodes } = await import('./browser-explorer')
    const nodes = createExplorerNodes(connection, request.scope).slice(
      0,
      request.limit ?? 50,
    )

    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      scope: request.scope,
      summary: `Preview explorer loaded ${nodes.length} node(s) for ${connection.name}.`,
      capabilities: buildExecutionCapabilities(connection, snapshot),
      nodes,
    }
  },

  async loadStructureMap(request: StructureRequest): Promise<StructureResponse> {
    request = validateStructureRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<StructureResponse>('load_structure_map', { request })
    }

    return createStructureResponseLocally(loadBrowserSnapshot(), request)
  },

  async scanRedisKeys(request: RedisKeyScanRequest): Promise<RedisKeyScanResponse> {
    request = validateRedisKeyScanRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<RedisKeyScanResponse>('scan_redis_keys', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const connection = findConnection(snapshot, request.connectionId)
    const sampleKeys = [
      { key: 'account:1', type: 'string', ttlLabel: 'No limit', memoryUsageLabel: '96 B', length: 62 },
      { key: 'orders:recent', type: 'list', ttlLabel: 'No limit', memoryUsageLabel: '224 B', length: 3 },
      { key: 'product:luna-lamp', type: 'hash', ttlLabel: 'No limit', memoryUsageLabel: '288 B', length: 4 },
      { key: 'products:inventory', type: 'zset', ttlLabel: 'No limit', memoryUsageLabel: '120 B', length: 2 },
      { key: 'stream:orders', type: 'stream', ttlLabel: 'No limit', memoryUsageLabel: '512 B', length: 2 },
    ]
    const pattern = request.pattern?.replaceAll('*', '').trim().toLowerCase() ?? ''
    const typeFilter = request.typeFilter ?? 'all'
    const keys = sampleKeys
      .filter((item) => !pattern || item.key.toLowerCase().includes(pattern))
      .filter((item) => typeFilter === 'all' || item.type === typeFilter)

    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      databaseIndex: request.databaseIndex ?? 0,
      cursor: request.cursor ?? '0',
      scannedCount: sampleKeys.length,
      keys,
      usedTypeFilterFallback: false,
      moduleTypes: [],
      warnings: connection ? [] : ['Connection was not found in preview mode.'],
    }
  },

  async inspectRedisKey(request: RedisKeyInspectRequest): Promise<ExecutionResponse> {
    request = validateRedisKeyInspectRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExecutionResponse>('inspect_redis_key', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === request.tabId)
    const connection = findConnection(snapshot, request.connectionId)

    if (!tab || !connection) {
      throw new Error('Redis key inspection needs an open tab and connection.')
    }

    const value = previewRedisValue(request.key)
    const payload = {
      renderer: 'keyvalue' as const,
      entries: value.entries,
      key: request.key,
      redisType: value.type,
      ttl: 'No limit',
      ttlSeconds: -1,
      memoryUsage: 'Preview',
      length: Object.keys(value.entries).length,
      value: value.value,
      metadata: { key: request.key, type: value.type },
      supports: { deleteKey: true, ttl: true, setValue: value.type === 'string' },
      disabledActions: {},
    }
    const rendererModes: ResultRenderer[] = ['keyvalue', 'json', 'raw']
    const result: ExecutionResultEnvelope = redactExecutionResultForEnvironment({
      id: `result-${Date.now()}`,
      engine: connection.engine,
      summary: `Redis key \`${request.key}\` loaded as ${value.type}.`,
      defaultRenderer: 'keyvalue' as const,
      rendererModes,
      payloads: [
        payload,
        { renderer: 'json' as const, value: { key: request.key, type: value.type, value: value.value } },
        { renderer: 'raw' as const, text: `INSPECT ${request.key}` },
      ],
      notices: [],
      executedAt: new Date().toISOString(),
      durationMs: 1,
      truncated: false,
      rowLimit: request.sampleSize ?? 200,
      pageInfo: {
        pageSize: request.sampleSize ?? 200,
        pageIndex: 0,
        bufferedRows: Object.keys(value.entries).length,
        hasMore: false,
      },
    }, resolveEnvironment(snapshot.environments, request.environmentId))!
    const nextTab = {
      ...tab,
      status: 'success' as const,
      result,
      lastRunAt: result.executedAt,
      history: [
        {
          id: `history-${Date.now()}`,
          queryText: `INSPECT ${request.key}`,
          executedAt: result.executedAt,
          status: 'success' as const,
        },
        ...tab.history,
      ],
    }

    return redactForEnvironment({
      executionId: `execution-${Date.now()}`,
      tab: nextTab,
      result,
      guardrail: { status: 'allow', reasons: [], safeModeApplied: false },
      diagnostics: [],
    }, resolveEnvironment(snapshot.environments, request.environmentId))
  },

  async inspectExplorer(
    request: ExplorerInspectRequest,
  ): Promise<ExplorerInspectResponse> {
    request = validateExplorerInspectRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExplorerInspectResponse>('inspect_explorer_node', { request })
    }

    const { inspectExplorerNodeLocally } = await import('./browser-explorer')
    return inspectExplorerNodeLocally(loadBrowserSnapshot(), request)
  },

  async listDatastoreExperiences(): Promise<DatastoreExperienceResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreExperienceResponse>('list_datastore_experiences')
    }

    return { experiences: buildDatastoreExperiences() }
  },

  async listDatastoreOperations(
    request: OperationManifestRequest,
  ): Promise<OperationManifestResponse> {
    request = validateOperationManifestRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<OperationManifestResponse>('list_datastore_operations', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const connection = findConnection(snapshot, request.connectionId)

    if (!connection) {
      throw new Error('Connection was not found.')
    }

    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      engine: connection.engine,
      operations: buildOperationManifestsForConnection(connection),
    }
  },

  async planDatastoreOperation(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse> {
    request = validateOperationPlanRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<OperationPlanResponse>('plan_datastore_operation', { request })
    }

    return planOperationLocally(loadBrowserSnapshot(), request)
  },

  async executeDatastoreOperation(
    request: OperationExecutionRequest,
  ): Promise<OperationExecutionResponse> {
    request = validateOperationExecutionRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<OperationExecutionResponse>('execute_datastore_operation', {
        request,
      })
    }

    return executeOperationLocally(loadBrowserSnapshot(), request)
  },

  async planDataEdit(request: DataEditPlanRequest): Promise<DataEditPlanResponse> {
    request = validateDataEditPlanRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<DataEditPlanResponse>('plan_data_edit', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const connection = findConnection(snapshot, request.connectionId)

    if (!connection) {
      throw new Error('Connection was not found.')
    }

    return planDataEditLocally(connection, request, snapshot)
  },

  async executeDataEdit(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse> {
    request = validateDataEditExecutionRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<DataEditExecutionResponse>('execute_data_edit', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const connection = findConnection(snapshot, request.connectionId)

    if (!connection) {
      throw new Error('Connection was not found.')
    }

    return executeDataEditLocally(connection, request, snapshot)
  },

  async inspectConnectionPermissions(
    request: PermissionInspectionRequest,
  ): Promise<PermissionInspectionResponse> {
    request = validatePermissionInspectionRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<PermissionInspectionResponse>(
        'inspect_connection_permissions',
        { request },
      )
    }

    const snapshot = loadBrowserSnapshot()
    return redactForEnvironment(
      inspectPermissionsLocally(snapshot, request),
      resolveEnvironment(snapshot.environments, request.environmentId),
    )
  },

  async collectAdapterDiagnostics(
    request: AdapterDiagnosticsRequest,
  ): Promise<AdapterDiagnosticsResponse> {
    request = validateAdapterDiagnosticsRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<AdapterDiagnosticsResponse>('collect_adapter_diagnostics', { request })
    }

    const snapshot = loadBrowserSnapshot()
    return redactForEnvironment(
      collectDiagnosticsLocally(snapshot, request),
      resolveEnvironment(snapshot.environments, request.environmentId),
    )
  },
}

function previewRedisValue(key: string) {
  if (key.includes('product:')) {
    const value = { sku: key.split(':').pop() ?? key, name: 'Preview product', inventory: '18' }
    return {
      type: 'hash',
      entries: value,
      value,
    }
  }

  if (key.includes('orders')) {
    const value = ['order-1001', 'order-1002', 'order-1003']
    return {
      type: 'list',
      entries: Object.fromEntries(value.map((item, index) => [String(index), item])),
      value,
    }
  }

  return {
    type: 'string',
    entries: { [key]: JSON.stringify({ preview: true, key }) },
    value: { preview: true, key },
  }
}
