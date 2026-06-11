import type { DatastoreRuntimeSlice } from '../types'
import { timeSeriesOperationRequest } from '../common/timeseries/browser-timeseries-operations'
import {
  createOpenTsdbExplorerNodes,
  openTsdbInspectPayload,
  openTsdbInspectQueryTemplate,
} from './browser-opentsdb-explorer'

export const opentsdbRuntimeSlice = {
  engine: 'opentsdb',
  explorer: {
    createNodes: (_connection, scope) => createOpenTsdbExplorerNodes(scope),
    inspectQueryTemplate: (_connection, nodeId) => openTsdbInspectQueryTemplate(nodeId),
    inspectPayload: (_connection, nodeId) => openTsdbInspectPayload(nodeId),
  },
  operation: {
    buildRequest: timeSeriesOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
