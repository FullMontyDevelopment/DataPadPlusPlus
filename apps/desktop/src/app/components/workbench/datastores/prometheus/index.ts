import type { DatastoreWorkbenchSlice } from '../types'
import { PrometheusObjectViewWorkspace } from './PrometheusObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  TIME_SERIES_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const prometheusWorkbenchSlice = {
  engine: 'prometheus',
  explorer: createDatastoreExplorerProvider({
    engine: 'prometheus',
    family: 'timeseries',
    label: 'Prometheus',
    inspectionKinds: TIME_SERIES_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('prometheus', PrometheusObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
