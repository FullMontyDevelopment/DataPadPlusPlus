import type { DatastoreRuntimeSlice } from '../types'
import { mongoDataEditRequest } from './browser-mongo-data-edit-request'
import { createMongoExplorerNodes } from './browser-mongo-explorer'
import { mongoOperationRequest } from './browser-mongo-operations'
import { mongoInspectPayload } from './browser-mongo-payloads'
import { mongoInspectQueryTemplate } from './browser-mongo-query-templates'

export const mongodbRuntimeSlice = {
  engine: 'mongodb',
  explorer: {
    createNodes: createMongoExplorerNodes,
    inspectQueryTemplate: mongoInspectQueryTemplate,
    inspectPayload: mongoInspectPayload,
  },
  operation: {
    buildRequest: (_connection, request) => mongoOperationRequest(request),
  },
  dataEdit: {
    buildRequest: (_connection, request) => mongoDataEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
