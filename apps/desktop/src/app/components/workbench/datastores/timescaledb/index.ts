import type { DatastoreWorkbenchSlice } from '../types'
import { getPostgresObjectViewDescriptor } from '../common/sql/PostgresObjectViewDescriptors'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { TimescaleObjectViewInsights } from './TimescaleObjectViewInsights'

export const timescaledbWorkbenchSlice = {
  engine: 'timescaledb',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getPostgresObjectViewDescriptor,
  relationalInsights: TimescaleObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
