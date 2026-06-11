import type { DatastoreRuntimeSlice } from '../types'
import {
  createRedisExplorerNodes,
  redisInspectQueryTemplate,
} from '../common/keyvalue/browser-redis-explorer'
import { keyValueEditRequest } from '../common/keyvalue/browser-keyvalue-edit-request'
import { redisOperationRequest } from '../common/keyvalue/browser-redis-operations'
import { redisInspectPayload } from '../common/keyvalue/browser-redis-payloads'

export const valkeyRuntimeSlice = {
  engine: 'valkey',
  explorer: {
    createNodes: createRedisExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => redisInspectQueryTemplate(nodeId),
    inspectPayload: (_connection, nodeId) => redisInspectPayload(nodeId),
  },
  operation: {
    buildRequest: (_connection, request) => redisOperationRequest(request),
  },
  dataEdit: {
    buildRequest: (_connection, request) => keyValueEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
