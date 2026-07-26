import type { DatastoreWorkbenchSlice } from '../types'
import { InfluxObjectViewWorkspace } from './InfluxObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  TIME_SERIES_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const influxdbWorkbenchSlice = {
  engine: 'influxdb',
  explorer: createDatastoreExplorerProvider({
    engine: 'influxdb',
    family: 'timeseries',
    label: 'InfluxDB',
    inspectionKinds: TIME_SERIES_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('influxdb', InfluxObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
