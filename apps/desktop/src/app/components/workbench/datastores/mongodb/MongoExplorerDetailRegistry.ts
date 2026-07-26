import {
  MongoCollectionDetail,
  MongoDatabaseDetail,
  MongoGridFsDetail,
  MongoIndexDetail,
  MongoLaunchDetail,
  MongoPermissionsDetail,
  MongoSchemaDetail,
  MongoScopeDetail,
  MongoScriptsDetail,
  MongoStateDetail,
  MongoStatisticsDetail,
  MongoUnknownDetail,
  MongoValidationDetail,
  MongoViewDetail,
} from './MongoExplorerDetails'
import type {
  MongoExplorerDetailAction,
  MongoExplorerDetailProvider,
} from './MongoExplorerDetail.types'

const OPEN_OVERVIEW = {
  id: 'open-overview',
  label: 'Open full view',
} as const satisfies MongoExplorerDetailAction

const COLLECTION_ACTIONS = [
  { id: 'open-query', label: 'Open documents', primary: true },
  { id: 'open-aggregation', label: 'Aggregation builder' },
  { id: 'open-schema', label: 'Schema preview' },
  { id: 'open-indexes', label: 'Indexes' },
  { id: 'open-validation', label: 'Validation' },
  OPEN_OVERVIEW,
] as const satisfies readonly MongoExplorerDetailAction[]

const VIEW_ACTIONS = [
  { id: 'open-query', label: 'Open results', primary: true },
  { id: 'open-pipeline', label: 'View pipeline' },
  OPEN_OVERVIEW,
] as const satisfies readonly MongoExplorerDetailAction[]

const PROVIDERS: readonly MongoExplorerDetailProvider[] = [
  { kind: 'databases', mode: 'scope', component: MongoScopeDetail },
  { kind: 'system-databases', mode: 'scope', component: MongoScopeDetail },
  { kind: 'database', mode: 'inspection', component: MongoDatabaseDetail, actions: [
    { id: 'open-statistics', label: 'Database statistics', primary: true },
    OPEN_OVERVIEW,
  ] },
  { kind: 'collections', mode: 'scope', component: MongoScopeDetail },
  { kind: 'views', mode: 'scope', component: MongoScopeDetail },
  { kind: 'time-series-collections', mode: 'scope', component: MongoScopeDetail },
  { kind: 'capped-collections', mode: 'scope', component: MongoScopeDetail },
  { kind: 'gridfs', mode: 'scope', component: MongoScopeDetail, actions: [OPEN_OVERVIEW] },
  { kind: 'search-indexes', mode: 'scope', component: MongoScopeDetail },
  { kind: 'vector-indexes', mode: 'scope', component: MongoScopeDetail },
  { kind: 'users', mode: 'scope', component: MongoScopeDetail, actions: [OPEN_OVERVIEW] },
  { kind: 'roles', mode: 'scope', component: MongoScopeDetail, actions: [OPEN_OVERVIEW] },
  {
    kind: 'database-statistics',
    mode: 'inspection',
    component: MongoStatisticsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'collection',
    mode: 'inspection',
    component: MongoCollectionDetail,
    actions: COLLECTION_ACTIONS,
  },
  { kind: 'view', mode: 'inspection', component: MongoViewDetail, actions: VIEW_ACTIONS },
  {
    kind: 'documents',
    mode: 'launch',
    component: MongoLaunchDetail,
    actions: [{ id: 'open-query', label: 'Open documents', primary: true }],
  },
  {
    kind: 'schema-preview',
    mode: 'inspection',
    component: MongoSchemaDetail,
    actions: [OPEN_OVERVIEW],
  },
  { kind: 'indexes', mode: 'scope', component: MongoScopeDetail, actions: [OPEN_OVERVIEW] },
  {
    kind: 'index',
    mode: 'inspection',
    component: MongoIndexDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'validation-rules',
    mode: 'inspection',
    component: MongoValidationDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'aggregations',
    mode: 'launch',
    component: MongoLaunchDetail,
    actions: [{ id: 'open-aggregation', label: 'Open aggregation builder', primary: true }],
  },
  {
    kind: 'collection-statistics',
    mode: 'inspection',
    component: MongoStatisticsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'permissions',
    mode: 'inspection',
    component: MongoPermissionsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'scripts',
    mode: 'inspection',
    component: MongoScriptsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'pipeline',
    mode: 'inspection',
    component: MongoViewDetail,
    actions: [{ id: 'open-query', label: 'Open results', primary: true }, OPEN_OVERVIEW],
  },
  {
    kind: 'sample-results',
    mode: 'launch',
    component: MongoLaunchDetail,
    actions: [{ id: 'open-query', label: 'Open results', primary: true }],
  },
  {
    kind: 'view-results',
    mode: 'launch',
    component: MongoLaunchDetail,
    actions: [{ id: 'open-query', label: 'Open results', primary: true }],
  },
  { kind: 'gridfs-buckets', mode: 'scope', component: MongoScopeDetail },
  {
    kind: 'gridfs-bucket',
    mode: 'inspection',
    component: MongoGridFsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'gridfs-files',
    mode: 'inspection',
    component: MongoGridFsDetail,
    actions: [{ id: 'open-query', label: 'Open files metadata', primary: true }, OPEN_OVERVIEW],
  },
  {
    kind: 'gridfs-chunks',
    mode: 'inspection',
    component: MongoGridFsDetail,
    actions: [{ id: 'open-query', label: 'Open chunk metadata', primary: true }, OPEN_OVERVIEW],
  },
  {
    kind: 'gridfs-collection',
    mode: 'inspection',
    component: MongoGridFsDetail,
    actions: [{ id: 'open-query', label: 'Open metadata', primary: true }, OPEN_OVERVIEW],
  },
  {
    kind: 'user',
    mode: 'inspection',
    component: MongoPermissionsDetail,
    actions: [OPEN_OVERVIEW],
  },
  {
    kind: 'role',
    mode: 'inspection',
    component: MongoPermissionsDetail,
    actions: [OPEN_OVERVIEW],
  },
  { kind: 'permission', mode: 'state', component: MongoStateDetail },
  { kind: 'unavailable', mode: 'state', component: MongoStateDetail },
  { kind: 'database-name-fallback', mode: 'state', component: MongoStateDetail },
] as const

const PROVIDER_LOOKUP = new Map(PROVIDERS.map((provider) => [provider.kind, provider]))

export const MONGO_EXPLORER_DETAIL_KINDS = PROVIDERS.map((provider) => provider.kind)

export function mongoExplorerDetailProvider(kind: string): MongoExplorerDetailProvider {
  return PROVIDER_LOOKUP.get(kind) ?? {
    kind,
    mode: 'state',
    component: MongoUnknownDetail,
  }
}
