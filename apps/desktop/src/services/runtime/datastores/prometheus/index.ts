import type { DatastoreRuntimeSlice } from '../types'
import { timeSeriesOperationRequest } from '../common/timeseries/browser-timeseries-operations'
import {
  createPrometheusExplorerNodes,
  prometheusInspectPayload,
  prometheusInspectQueryTemplate,
} from './browser-prometheus-explorer'

export const prometheusRuntimeSlice = {
  engine: 'prometheus',
  explorer: {
    createNodes: (_connection, scope) => createPrometheusExplorerNodes(scope),
    inspectQueryTemplate: (_connection, nodeId) => prometheusInspectQueryTemplate(nodeId),
    inspectPayload: prometheusInspectPayload,
  },
  operation: {
    buildRequest: timeSeriesOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
