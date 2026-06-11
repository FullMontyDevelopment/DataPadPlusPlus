import type { DatastoreWorkbenchSlice } from '../types'
import { RelationalObjectViewWorkspace } from '../common/sql/RelationalObjectViewWorkspace'
import { CockroachObjectViewInsights } from './CockroachObjectViewInsights'
import { getCockroachObjectViewDescriptor } from './CockroachObjectViewDescriptors'

export const cockroachdbWorkbenchSlice = {
  engine: 'cockroachdb',
  objectViewWorkspace: RelationalObjectViewWorkspace,
  relationalDescriptor: getCockroachObjectViewDescriptor,
  relationalInsights: CockroachObjectViewInsights,
} satisfies DatastoreWorkbenchSlice
