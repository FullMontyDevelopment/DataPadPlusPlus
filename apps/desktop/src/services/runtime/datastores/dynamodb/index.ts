import type { DatastoreRuntimeSlice } from '../types'
import { wideColumnOperationRequest } from '../common/widecolumn/browser-widecolumn-operations'
import {
  dynamoDbDataEditRequest,
  dynamoDbDataEditWarnings,
} from './browser-dynamodb-data-edit-request'
import {
  createDynamoExplorerNodes,
  dynamoInspectPayload,
  dynamoInspectQueryTemplate,
} from './browser-dynamo-explorer'

export const dynamodbRuntimeSlice = {
  engine: 'dynamodb',
  explorer: {
    createNodes: createDynamoExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => dynamoInspectQueryTemplate(nodeId),
    inspectPayload: dynamoInspectPayload,
  },
  operation: {
    buildRequest: wideColumnOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => dynamoDbDataEditRequest(request),
    warnings: (_connection, request) => dynamoDbDataEditWarnings(request),
  },
} satisfies DatastoreRuntimeSlice
