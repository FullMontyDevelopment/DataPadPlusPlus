import type { DatastoreRuntimeSlice } from '../types'
import {
  createLiteDbExplorerNodes,
  liteDbInspectPayload,
  liteDbInspectQueryTemplate,
} from './browser-litedb-explorer'
import { liteDbEditRequest } from './browser-litedb-data-edit-request'
import { liteDbOperationRequest } from './browser-litedb-operations'

export const litedbRuntimeSlice = {
  engine: 'litedb',
  explorer: {
    createNodes: createLiteDbExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => liteDbInspectQueryTemplate(nodeId),
    inspectPayload: liteDbInspectPayload,
  },
  operation: {
    buildRequest: (_connection, request) => liteDbOperationRequest(request),
  },
  dataEdit: {
    buildRequest: (_connection, request) => liteDbEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
