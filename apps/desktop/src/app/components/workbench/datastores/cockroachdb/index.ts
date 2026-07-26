import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { CockroachObjectViewInsights } from './CockroachObjectViewInsights'
import { getCockroachObjectViewDescriptor } from './CockroachObjectViewDescriptors'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  RELATIONAL_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const cockroachdbWorkbenchSlice = {
  engine: 'cockroachdb',
  explorer: createDatastoreExplorerProvider({
    engine: 'cockroachdb',
    family: 'sql',
    label: 'CockroachDB',
    inspectionKinds: RELATIONAL_EXPLORER_INSPECTION_KINDS,
    systemKinds: ['system-databases', 'system-schemas'],
    supportsRelationshipMap: true,
  }),
  objectView: createDatastoreObjectViewProvider('cockroachdb', RelationalObjectViewWorkspace),
  relationalDescriptor: getCockroachObjectViewDescriptor,
  relationalInsights: CockroachObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
