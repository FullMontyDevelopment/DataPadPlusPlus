import type { DatastoreWorkbenchSlice } from '../types'
import { MongoObjectViewWorkspace } from './MongoObjectViewWorkspace'

export const mongodbWorkbenchSlice = {
  engine: 'mongodb',
  objectViewWorkspace: MongoObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
