import type { DatastoreWorkbenchSlice } from '../types'
import { OpenTsdbObjectViewWorkspace } from './OpenTsdbObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  TIME_SERIES_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const opentsdbWorkbenchSlice = {
  engine: 'opentsdb',
  explorer: createDatastoreExplorerProvider({
    engine: 'opentsdb',
    family: 'timeseries',
    label: 'OpenTSDB',
    inspectionKinds: TIME_SERIES_EXPLORER_INSPECTION_KINDS,
  }),
  objectView: createDatastoreObjectViewProvider('opentsdb', OpenTsdbObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
