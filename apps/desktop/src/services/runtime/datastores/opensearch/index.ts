import type { DatastoreRuntimeSlice } from '../types'
import {
  createSearchExplorerNodes,
  searchInspectQueryTemplate,
} from '../common/search/browser-search-explorer'
import { searchDataEditRequest } from '../common/search/browser-search-data-edit-request'
import { searchOperationRequest } from '../common/search/browser-search-operations'
import { searchInspectPayload } from '../common/search/browser-search-payloads'

export const opensearchRuntimeSlice = {
  engine: 'opensearch',
  explorer: {
    createNodes: createSearchExplorerNodes,
    inspectQueryTemplate: (_connection, nodeId) => searchInspectQueryTemplate(nodeId),
    inspectPayload: searchInspectPayload,
  },
  operation: {
    buildRequest: searchOperationRequest,
  },
  dataEdit: {
    buildRequest: (_connection, request) => searchDataEditRequest(request),
  },
} satisfies DatastoreRuntimeSlice
