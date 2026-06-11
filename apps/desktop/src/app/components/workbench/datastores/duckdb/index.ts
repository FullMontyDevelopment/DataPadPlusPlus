import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { DuckDbObjectViewInsights } from './DuckDbObjectViewInsights'
import { getDuckDbObjectViewDescriptor } from './DuckDbObjectViewDescriptors'

export const duckdbWorkbenchSlice = {
  engine: 'duckdb',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getDuckDbObjectViewDescriptor,
  relationalInsights: DuckDbObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
