import type { DatastoreRuntimeSlice } from '../types'
import {
  createMemcachedExplorerNodes,
  memcachedInspectPayload,
  memcachedInspectQueryTemplate,
} from './browser-memcached-explorer'
import { memcachedOperationRequest } from './browser-memcached-operations'

export const memcachedRuntimeSlice = {
  engine: 'memcached',
  explorer: {
    createNodes: createMemcachedExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => memcachedInspectQueryTemplate(nodeId),
    inspectPayload: memcachedInspectPayload,
  },
  operation: {
    buildRequest: (_connection, request) => memcachedOperationRequest(request),
  },
} satisfies DatastoreRuntimeSlice
