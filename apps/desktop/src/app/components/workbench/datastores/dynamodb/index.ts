import type { DatastoreWorkbenchSlice } from '../types'
import { DynamoObjectViewWorkspace } from './DynamoObjectViewWorkspace'

export const dynamodbWorkbenchSlice = {
  engine: 'dynamodb',
  objectViewWorkspace: DynamoObjectViewWorkspace,
} satisfies DatastoreWorkbenchSlice
