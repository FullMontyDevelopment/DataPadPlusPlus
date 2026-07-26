import type { DatastoreWorkbenchSlice } from '../types'
import { getPostgresObjectViewDescriptor } from '../common/sql/PostgresObjectViewDescriptors'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { TimescaleObjectViewInsights } from './TimescaleObjectViewInsights'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
  TIME_SERIES_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const timescaledbWorkbenchSlice = {
  engine: 'timescaledb',
  explorer: createDatastoreExplorerProvider({
    engine: 'timescaledb',
    family: 'timeseries',
    label: 'TimescaleDB',
    inspectionKinds: [
      ...RELATIONAL_EXPLORER_INSPECTION_KINDS,
      ...TIME_SERIES_EXPLORER_INSPECTION_KINDS,
      'hypertable',
      'chunk',
      'continuous-aggregate',
      'compression-policy',
    ],
    systemKinds: ['system-schemas'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('timescaledb', RelationalObjectViewWorkspace),
  relationalDescriptor: getPostgresObjectViewDescriptor,
  relationalInsights: TimescaleObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
