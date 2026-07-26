import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { DuckDbObjectViewInsights } from './DuckDbObjectViewInsights'
import { getDuckDbObjectViewDescriptor } from './DuckDbObjectViewDescriptors'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  EMBEDDED_ANALYTICS_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const duckdbWorkbenchSlice = {
  engine: 'duckdb',
  explorer: createDatastoreExplorerProvider({
    engine: 'duckdb',
    family: 'embedded-olap',
    label: 'DuckDB',
    inspectionKinds: EMBEDDED_ANALYTICS_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-schemas', 'temporary-schema'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('duckdb', RelationalObjectViewWorkspace),
  relationalDescriptor: getDuckDbObjectViewDescriptor,
  relationalInsights: DuckDbObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
