import type { AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, DataEditExecutionRequest, DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse, DatastoreExperienceResponse, DatastoreTransferFileSelectionRequest, DatastoreTransferSelection, DatastoreTransferSelectionCancelRequest, ExecutionResponse, ExecutionResultEnvelope, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerRequest, ExplorerResponse, KeyValueValueReadEvent, KeyValueValueReadRequest, KeyValueValueReadResult, OperationExecutionRequest, OperationExecutionResponse, OperationManifestRequest, OperationManifestResponse, OperationPlanRequest, OperationPlanResponse, PermissionInspectionRequest, PermissionInspectionResponse, ResultRenderer, RedisKeyInspectRequest, RedisKeyScanRequest, RedisKeyScanResponse, StructureRequest, StructureResponse } from '@datapadplusplus/shared-types'
import { buildDatastoreExperiences, executeDataEditLocally, planDataEditLocally } from './browser-datastore-platform'
import { buildOperationManifestsForConnection, collectDiagnosticsLocally, executeOperationLocally, inspectPermissionsLocally, planOperationLocally } from './browser-operations'
import {
  prepareExecutionResultForWorkspace,
  prepareRedisKeyScanForWorkspace,
  redactExplorerInspectForEnvironment,
  redactExplorerResponseForEnvironment,
  redactForEnvironment,
  redactStructureResponseForEnvironment,
} from './browser-response-redaction'
import { createStructureResponseLocally } from './browser-structure'
import { buildExecutionCapabilities, findConnection, loadBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { resolveEnvironment } from '../../app/state/helpers'
import {
  validateAdapterDiagnosticsRequest,
  validateKeyValueValueReadRequest,
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

    const { createExplorerNodes, pageExplorerNodes } = await import('./browser-explorer')
    const page = pageExplorerNodes(
      connection,
      createExplorerNodes(connection, request.scope),
      request,
    )

    return redactExplorerResponseForEnvironment({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      scope: request.scope,
      summary: `Preview explorer loaded ${page.nodes.length} node(s) for ${connection.name}.`,
      capabilities: buildExecutionCapabilities(connection, snapshot),
      nodes: page.nodes,
      pageInfo: page.pageInfo,
    }, resolveEnvironment(snapshot.environments, request.environmentId))
  },

  async loadStructureMap(request: StructureRequest): Promise<StructureResponse> {
    request = validateStructureRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<StructureResponse>('load_structure_map', { request })
    }

    const snapshot = loadBrowserSnapshot()
    return redactStructureResponseForEnvironment(
      createStructureResponseLocally(snapshot, request),
      resolveEnvironment(snapshot.environments, request.environmentId),
    )
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

    return prepareRedisKeyScanForWorkspace({
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      databaseIndex: request.databaseIndex ?? 0,
      cursor: request.cursor ?? '0',
      scannedCount: sampleKeys.length,
      keys,
      usedTypeFilterFallback: false,
      moduleTypes: [],
      warnings: connection ? [] : ['Connection was not found in preview mode.'],
    }, resolveEnvironment(snapshot.environments, request.environmentId))
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
      databaseIndex: request.databaseIndex ?? 0,
      redisType: value.type,
      ttl: 'No limit',
      ttlSeconds: -1,
      memoryUsage: 'Preview',
      length: Object.keys(value.entries).length,
      value: value.value,
      metadata: { key: request.key, type: value.type, databaseIndex: request.databaseIndex ?? 0 },
      supports: { deleteKey: true, ttl: true, setValue: value.type === 'string' },
      disabledActions: {},
    }
    const rendererModes: ResultRenderer[] = ['keyvalue', 'json', 'raw']
    const result: ExecutionResultEnvelope = prepareExecutionResultForWorkspace({
      id: `result-${Date.now()}`,
      engine: connection.engine,
      summary: `Redis key \`${request.key}\` loaded as ${value.type}.`,
      defaultRenderer: 'keyvalue' as const,
      rendererModes,
      payloads: [
        payload,
        { renderer: 'json' as const, value: { key: request.key, databaseIndex: request.databaseIndex ?? 0, type: value.type, value: value.value } },
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
    }, resolveEnvironment(snapshot.environments, request.environmentId))
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

    const response: ExecutionResponse = {
      executionId: `execution-${Date.now()}`,
      tab: nextTab,
      result,
      guardrail: { status: 'allow', reasons: [], safeModeApplied: false },
      diagnostics: [],
    }
    const environment = resolveEnvironment(snapshot.environments, request.environmentId)
    const redacted = redactForEnvironment({
      ...response,
      result: undefined,
      tab: { ...response.tab, result: undefined },
    }, environment)

    return {
      ...redacted,
      tab: { ...redacted.tab, result },
      result,
    }
  },

  async readKeyValue(request: KeyValueValueReadRequest): Promise<KeyValueValueReadResult> {
    request = validateKeyValueValueReadRequest(request)
    if (isTauriRuntime()) {
      const { Channel } = await import('@tauri-apps/api/core')
      let contentKind: KeyValueValueReadResult['contentKind'] | undefined
      let byteLength: number | undefined
      const chunks: Array<{ offset: number; bytes: Uint8Array }> = []
      let completed = false
      const onEvent = new Channel<KeyValueValueReadEvent>((event) => {
        if (event.type === 'metadata') {
          contentKind = event.contentKind
          byteLength = event.byteLength
        } else if (event.type === 'chunk') {
          chunks.push({ offset: event.offset, bytes: base64ToBytes(event.dataBase64) })
        } else {
          completed = true
        }
      })
      await invokeDesktop<void>('read_key_value', { request, onEvent })
      if (!completed || contentKind === undefined || byteLength === undefined) {
        throw new Error('The full value stream ended before all metadata was received.')
      }
      chunks.sort((left, right) => left.offset - right.offset)
      const bytes = new Uint8Array(byteLength)
      let nextOffset = 0
      for (const chunk of chunks) {
        if (chunk.offset !== nextOffset || chunk.offset + chunk.bytes.length > bytes.length) {
          throw new Error('The full value stream contained an invalid or missing chunk.')
        }
        bytes.set(chunk.bytes, chunk.offset)
        nextOffset += chunk.bytes.length
      }
      if (nextOffset !== byteLength) {
        throw new Error('The full value stream was incomplete.')
      }
      return { contentKind, byteLength, dataBase64: bytesToBase64(bytes) }
    }

    const value = previewRedisValue(request.key)
    const entries: Record<string, string> = value.entries
    const rawValue = request.entryKey === undefined
      ? typeof value.value === 'string'
        ? value.value
        : JSON.stringify(value.value)
      : entries[request.entryKey] ?? ''
    const bytes = new TextEncoder().encode(rawValue)
    return {
      contentKind: 'text',
      byteLength: bytes.length,
      dataBase64: bytesToBase64(bytes),
    }
  },

  async inspectExplorer(
    request: ExplorerInspectRequest,
  ): Promise<ExplorerInspectResponse> {
    request = validateExplorerInspectRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ExplorerInspectResponse>('inspect_explorer_node', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const { inspectExplorerNodeLocally } = await import('./browser-explorer')
    return redactExplorerInspectForEnvironment(
      inspectExplorerNodeLocally(snapshot, request),
      resolveEnvironment(snapshot.environments, request.environmentId),
    )
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

  async selectDatastoreTransferFile(
    request: DatastoreTransferFileSelectionRequest,
  ): Promise<DatastoreTransferSelection | undefined> {
    if (!['import', 'export', 'backup', 'restore'].includes(request.action)) {
      throw new Error('Choose a supported datastore transfer action.')
    }
    if (!['local-file', 'local-folder'].includes(request.destinationKind)) {
      throw new Error('The desktop picker supports only local files and folders.')
    }
    if (!request.formatId.trim()) {
      throw new Error('Choose a datastore transfer format.')
    }
    if (!isTauriRuntime()) {
      return undefined
    }
    return (await invokeDesktop<DatastoreTransferSelection | null>(
      'select_datastore_transfer_file',
      { request },
    )) ?? undefined
  },

  async cancelDatastoreTransferSelection(
    request: DatastoreTransferSelectionCancelRequest,
  ): Promise<boolean> {
    if (!request.selectionId.trim()) {
      return false
    }
    if (!isTauriRuntime()) {
      return false
    }
    return invokeDesktop<boolean>('cancel_datastore_transfer_selection', { request })
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

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesToBase64(value: Uint8Array) {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}
