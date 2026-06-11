import type { DatastoreRuntimeSlice } from '../types'
import { timeSeriesOperationRequest } from '../common/timeseries/browser-timeseries-operations'
import {
  createInfluxExplorerNodes,
  influxInspectPayload,
  influxInspectQueryTemplate,
} from './browser-influx-explorer'

export const influxdbRuntimeSlice = {
  engine: 'influxdb',
  explorer: {
    createNodes: createInfluxExplorerNodes,
    inspectQueryTemplate: influxInspectQueryTemplate,
    inspectPayload: influxInspectPayload,
  },
  operation: {
    buildRequest: timeSeriesOperationRequest,
  },
} satisfies DatastoreRuntimeSlice
