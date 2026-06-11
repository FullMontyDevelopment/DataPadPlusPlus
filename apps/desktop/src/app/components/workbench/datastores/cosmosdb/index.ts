import type { DatastoreWorkbenchSlice } from '../types'
import { CosmosObjectViewWorkspace } from './CosmosObjectViewWorkspace'

export const cosmosdbWorkbenchSlice = {
  engine: 'cosmosdb',
  objectViewWorkspace: CosmosObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
