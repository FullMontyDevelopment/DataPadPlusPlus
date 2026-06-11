import type { DatastoreWorkbenchSlice } from '../types'
import { PostgresObjectViewInsights } from './PostgresObjectViewInsights'
import { getPostgresObjectViewDescriptor } from '../common/sql/PostgresObjectViewDescriptors'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'

export const postgresqlWorkbenchSlice = {
  engine: 'postgresql',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getPostgresObjectViewDescriptor,
  relationalInsights: PostgresObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
