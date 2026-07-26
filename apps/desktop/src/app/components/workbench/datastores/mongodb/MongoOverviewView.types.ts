import type { MongoCollectionCreatePlanner } from './MongoCollectionCreatePanel'

export type MongoOverviewPayload = Record<string, unknown>
export type MongoOperationPlanner = MongoCollectionCreatePlanner
export type MongoOverviewToolKind = 'insert-document' | 'create-index'
