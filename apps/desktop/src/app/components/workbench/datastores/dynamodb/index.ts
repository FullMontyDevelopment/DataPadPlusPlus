import type { DatastoreWorkbenchSlice } from '../types'
import { DynamoObjectViewWorkspace } from './DynamoObjectViewWorkspace'
import {
  createDatastoreExplorerProvider,
  createDatastoreObjectViewProvider,
  WIDE_COLUMN_EXPLORER_INSPECTION_KINDS,
} from '../common/explorer'

export const dynamodbWorkbenchSlice = {
  engine: 'dynamodb',
  explorer: createDatastoreExplorerProvider({
    engine: 'dynamodb',
    family: 'widecolumn',
    label: 'DynamoDB',
    inspectionKinds: WIDE_COLUMN_EXPLORER_INSPECTION_KINDS,
    launchKinds: ['items'],
  }),
  objectView: createDatastoreObjectViewProvider('dynamodb', DynamoObjectViewWorkspace),
} satisfies DatastoreWorkbenchSlice
