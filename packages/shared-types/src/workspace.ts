import type { DatastoreEngine, DatastoreFamily } from './connection'
import type { AdapterDiagnostics } from './runtime'

export const RESULT_RENDERERS = [
  'table',
  'json',
  'document',
  'graph',
  'chart',
  'keyvalue',
  'raw',
  'schema',
  'diff',
  'plan',
  'metrics',
  'series',
  'searchHits',
  'profile',
  'costEstimate',
] as const

export type ResultRenderer = (typeof RESULT_RENDERERS)[number]

export const QUERY_LANGUAGES = [
  'sql',
  'mongodb',
  'redis',
  'cypher',
  'flux',
  'text',
  'json',
  'cql',
  'aql',
  'gremlin',
  'sparql',
  'promql',
  'influxql',
  'opentsdb',
  'query-dsl',
  'esql',
  'google-sql',
  'snowflake-sql',
  'clickhouse-sql',
] as const

export type QueryLanguage = (typeof QUERY_LANGUAGES)[number]

export type QueryExecutionState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'blocked'

export type QueryViewMode = 'builder' | 'raw' | 'script'

export type SavedWorkItemKind =
  | 'query'
  | 'script'
  | 'test-suite'
  | 'template'
  | 'snippet'
  | 'snapshot'
  | 'investigation-pack'
  | 'bookmark'
  | 'note'

export type LibraryItemKind = SavedWorkItemKind
export type LibraryNodeKind = 'folder' | 'connection' | LibraryItemKind

export type QuerySaveTarget =
  | { kind: 'library'; libraryItemId: string }
  | { kind: 'local-file'; path: string }

export interface QueryTabDefinition {
  id: string
  title: string
  tabKind?: 'query' | 'explorer' | 'test-suite' | 'metrics' | 'object-view' | 'environment'
  connectionId: string
  environmentId: string
  family: DatastoreFamily
  language: QueryLanguage
  pinned?: boolean
  saveTarget?: QuerySaveTarget
  savedQueryId?: string
}

export interface MetricsTabState {
  connectionId: string
  environmentId: string
  lastRefreshedAt?: string
  diagnostics?: AdapterDiagnostics
  warnings: string[]
}

export interface ObjectViewTabState {
  connectionId: string
  environmentId: string
  nodeId: string
  label: string
  kind: string
  path?: string[]
  summary?: string
  queryTemplate?: string
  payload?: unknown
  lastRefreshedAt?: string
  warnings: string[]
}

export interface CreateObjectViewTabRequest {
  connectionId: string
  environmentId?: string
  nodeId: string
  label: string
  kind: string
  path?: string[]
}

export type QueryBuilderKind =
  | 'mongo-find'
  | 'mongo-aggregation'
  | 'redis-key-browser'
  | 'sql-select'
  | 'dynamodb-key-condition'
  | 'cql-partition'
  | 'search-dsl'

export interface ScopedQueryTarget {
  kind: string
  label: string
  path?: string[]
  scope?: string
  queryTemplate?: string
  preferredBuilder?: QueryBuilderKind
}

export type MongoFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'regex'
  | 'exists'
  | 'in'

export type MongoBuilderValueType = 'string' | 'number' | 'boolean' | 'null' | 'json'

export interface MongoFindFilterRow {
  id: string
  enabled?: boolean
  field: string
  groupId?: string
  operator: MongoFilterOperator
  value: string
  valueType: MongoBuilderValueType
}

export interface MongoFindFilterGroup {
  id: string
  label: string
  logic: 'and' | 'or'
}

export interface MongoFindProjectionField {
  id: string
  field: string
}

export interface MongoFindSortRow {
  id: string
  field: string
  direction: 'asc' | 'desc'
}

export interface MongoFindBuilderState {
  kind: 'mongo-find'
  collection: string
  filters: MongoFindFilterRow[]
  filterGroups?: MongoFindFilterGroup[]
  projectionMode: 'all' | 'include' | 'exclude'
  projectionFields: MongoFindProjectionField[]
  sort: MongoFindSortRow[]
  skip?: number
  limit?: number
  lastAppliedQueryText?: string
}

export interface MongoAggregationStageRow {
  id: string
  enabled?: boolean
  stage: string
  body: string
}

export interface MongoAggregationBuilderState {
  kind: 'mongo-aggregation'
  collection: string
  stages: MongoAggregationStageRow[]
  limit?: number
  lastAppliedQueryText?: string
}

export type SqlSelectFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'like'
  | 'in'
  | 'is-null'
  | 'is-not-null'

export type SqlBuilderValueType = 'string' | 'number' | 'boolean' | 'null'

export interface SqlSelectProjectionField {
  id: string
  field: string
}

export interface SqlSelectFilterRow {
  id: string
  enabled?: boolean
  field: string
  operator: SqlSelectFilterOperator
  value: string
  valueType: SqlBuilderValueType
}

export interface SqlSelectSortRow {
  id: string
  field: string
  direction: 'asc' | 'desc'
}

export interface SqlSelectBuilderState {
  kind: 'sql-select'
  schema?: string
  table: string
  projectionFields: SqlSelectProjectionField[]
  filters: SqlSelectFilterRow[]
  filterLogic: 'and' | 'or'
  sort: SqlSelectSortRow[]
  limit?: number
  lastAppliedQueryText?: string
}

export type DynamoDbConditionOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'begins-with'
  | 'contains'
  | 'exists'

export type DynamoDbBuilderValueType = 'string' | 'number' | 'boolean' | 'null' | 'json'

export interface DynamoDbConditionRow {
  id: string
  enabled?: boolean
  field: string
  operator: DynamoDbConditionOperator
  value: string
  secondValue?: string
  valueType: DynamoDbBuilderValueType
}

export interface DynamoDbProjectionField {
  id: string
  field: string
}

export interface DynamoDbKeyConditionBuilderState {
  kind: 'dynamodb-key-condition'
  table: string
  indexName?: string
  partitionKey: DynamoDbConditionRow
  sortKey?: DynamoDbConditionRow
  filters: DynamoDbConditionRow[]
  projectionFields: DynamoDbProjectionField[]
  consistentRead?: boolean
  limit?: number
  lastAppliedQueryText?: string
}

export type CqlConditionOperator =
  | 'eq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'

export type CqlBuilderValueType = 'string' | 'number' | 'boolean' | 'null'

export interface CqlProjectionField {
  id: string
  field: string
}

export interface CqlConditionRow {
  id: string
  enabled?: boolean
  field: string
  operator: CqlConditionOperator
  value: string
  valueType: CqlBuilderValueType
}

export interface CqlPartitionBuilderState {
  kind: 'cql-partition'
  keyspace?: string
  table: string
  projectionFields: CqlProjectionField[]
  partitionKeys: CqlConditionRow[]
  clusteringKeys: CqlConditionRow[]
  filters: CqlConditionRow[]
  allowFiltering?: boolean
  limit?: number
  lastAppliedQueryText?: string
}

export type SearchDslQueryMode =
  | 'match-all'
  | 'match'
  | 'term'
  | 'range'
  | 'query-string'

export type SearchDslFilterOperator =
  | 'term'
  | 'match'
  | 'exists'
  | 'range-gte'
  | 'range-lte'

export type SearchDslValueType = 'string' | 'number' | 'boolean'

export interface SearchDslFilterRow {
  id: string
  enabled?: boolean
  field: string
  operator: SearchDslFilterOperator
  value: string
  valueType: SearchDslValueType
}

export interface SearchDslSortRow {
  id: string
  field: string
  direction: 'asc' | 'desc'
}

export interface SearchDslAggregationRow {
  id: string
  field: string
  name?: string
  size?: number
}

export interface SearchDslSourceField {
  id: string
  field: string
}

export interface SearchDslBuilderState {
  kind: 'search-dsl'
  index: string
  queryMode: SearchDslQueryMode
  field: string
  value: string
  valueType: SearchDslValueType
  filters: SearchDslFilterRow[]
  sourceFields: SearchDslSourceField[]
  sort: SearchDslSortRow[]
  aggregations: SearchDslAggregationRow[]
  size?: number
  lastAppliedQueryText?: string
}

export type RedisKeyTypeFilter =
  | 'all'
  | 'string'
  | 'hash'
  | 'list'
  | 'set'
  | 'zset'
  | 'stream'
  | 'json'
  | 'timeseries'
  | 'search-index'
  | 'bloom'
  | 'cuckoo'
  | 'cms'
  | 'topk'
  | 'tdigest'
  | 'vectorset'
  | 'module'
  | 'unknown'

export interface RedisKeyBrowserState {
  kind: 'redis-key-browser'
  pattern: string
  typeFilter: RedisKeyTypeFilter
  databaseIndex?: number
  delimiter?: string
  cursor?: string
  scanCount?: number
  pageSize?: number
  scannedCount?: number
  scanCursorByDb?: Record<string, string>
  filters?: {
    ttl?: 'all' | 'expiring' | 'persistent'
    minBytes?: number
    maxBytes?: number
  }
  selectedKey?: string
  expandedPrefixes?: string[]
  visibleColumns?: string[]
  viewMode?: 'tree' | 'list'
  pipelineMode?: boolean
  consoleHistory?: string[]
  lastRefreshAt?: string
  lastAppliedQueryText?: string
}

export type QueryBuilderState =
  | MongoFindBuilderState
  | MongoAggregationBuilderState
  | RedisKeyBrowserState
  | SqlSelectBuilderState
  | DynamoDbKeyConditionBuilderState
  | CqlPartitionBuilderState
  | SearchDslBuilderState

export type DatastoreTestPhase = 'setup' | 'execute' | 'teardown'
export type DatastoreTestStepKind = 'query' | 'builder' | 'data-edit' | 'operation'
export type DatastoreTestStatus =
  | 'idle'
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'error'
  | 'canceled'

export type DatastoreTestAssertionKind =
  | 'row-count'
  | 'cell-value'
  | 'json-path'
  | 'document-count'
  | 'key-exists'
  | 'key-type'
  | 'key-ttl'
  | 'search-hit-count'
  | 'schema-exists'
  | 'no-error'
  | 'duration-under'

export type DatastoreTestComparison =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'less-than-or-equal'
  | 'exists'

export interface DatastoreTestStep {
  id: string
  label: string
  phase: DatastoreTestPhase
  kind: DatastoreTestStepKind
  enabled?: boolean
  language?: QueryLanguage
  queryText?: string
  builderState?: QueryBuilderState
  operationId?: string
  editKind?: string
  parameters?: Record<string, unknown>
  timeoutMs?: number
}

export interface DatastoreTestAssertion {
  id: string
  label: string
  kind: DatastoreTestAssertionKind
  enabled?: boolean
  comparison?: DatastoreTestComparison
  path?: string
  field?: string
  expected?: unknown
  timeoutMs?: number
}

export interface DatastoreTestCaseDefinition {
  id: string
  name: string
  enabled?: boolean
  timeoutMs?: number
  scopedTarget?: ScopedQueryTarget
  setup: DatastoreTestStep[]
  execute: DatastoreTestStep[]
  assertions: DatastoreTestAssertion[]
  teardown: DatastoreTestStep[]
}

export interface DatastoreTestSuiteDefinition {
  id: string
  name: string
  description?: string
  engine?: DatastoreEngine
  family?: DatastoreFamily
  connectionId?: string
  environmentId?: string
  variables?: Record<string, string>
  cases: DatastoreTestCaseDefinition[]
}

export interface DatastoreTestStepRunResult {
  id: string
  label: string
  phase: DatastoreTestPhase
  status: DatastoreTestStatus
  durationMs: number
  messages: string[]
  warnings: string[]
  payloadSummary?: string
}

export interface DatastoreTestAssertionRunResult {
  id: string
  label: string
  kind: DatastoreTestAssertionKind
  status: DatastoreTestStatus
  expected?: unknown
  actual?: unknown
  message: string
}

export interface DatastoreTestCaseRunResult {
  id: string
  name: string
  status: DatastoreTestStatus
  durationMs: number
  steps: DatastoreTestStepRunResult[]
  assertions: DatastoreTestAssertionRunResult[]
}

export interface DatastoreTestRunResult {
  id: string
  suiteId: string
  status: DatastoreTestStatus
  startedAt: string
  finishedAt?: string
  durationMs: number
  passed: number
  failed: number
  blocked: number
  warnings: string[]
  cases: DatastoreTestCaseRunResult[]
}

export interface DatastoreTestTemplate {
  id: string
  label: string
  description: string
  engine?: DatastoreEngine
  family: DatastoreFamily
  suite: DatastoreTestSuiteDefinition
}

export interface QueryExecutionNotice {
  code: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface TabularPayload {
  renderer: 'table'
  columns: string[]
  rows: string[][]
}

export interface JsonPayload {
  renderer: 'json'
  value: unknown
}

export interface DocumentPayload {
  renderer: 'document'
  documents: Array<Record<string, unknown>>
}

export interface KeyValuePayload {
  renderer: 'keyvalue'
  entries: Record<string, string>
  ttl?: string
  memoryUsage?: string
  key?: string
  redisType?: string
  ttlSeconds?: number
  ttlMs?: number
  memoryUsageBytes?: number
  encoding?: string
  length?: number
  value?: unknown
  members?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
  supports?: Record<string, boolean>
  disabledActions?: Record<string, string>
  binaryValueBase64?: string
  hexValue?: string
  streamGroups?: Array<Record<string, unknown>>
  zsetRanks?: Array<Record<string, unknown>>
  moduleMetadata?: Record<string, unknown>
  commandSupport?: Record<string, boolean>
}

export interface RawPayload {
  renderer: 'raw'
  text: string
}

export interface SchemaPayload {
  renderer: 'schema'
  items: Array<{ label: string; detail: string }>
}

export interface GraphPayload {
  renderer: 'graph'
  nodes: Array<{
    id: string
    label: string
    kind?: string
    properties?: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    from: string
    to: string
    label?: string
    kind?: string
    properties?: Record<string, unknown>
  }>
}

export interface ChartPayload {
  renderer: 'chart'
  chartType: 'line' | 'bar' | 'area' | 'scatter'
  xAxis?: string
  yAxis?: string
  series: Array<{
    name: string
    points: Array<{ x: string | number; y: number }>
  }>
}

export interface DiffPayload {
  renderer: 'diff'
  before: unknown
  after: unknown
  summary?: string
}

export interface PlanPayload {
  renderer: 'plan'
  format: 'json' | 'text' | 'graph'
  value: unknown
  summary?: string
}

export interface MetricsPayload {
  renderer: 'metrics'
  metrics: Array<{
    name: string
    value: number
    unit?: string
    labels?: Record<string, string>
  }>
}

export interface SeriesPayload {
  renderer: 'series'
  series: Array<{
    name: string
    unit?: string
    points: Array<{
      timestamp: string
      value: number
      labels?: Record<string, string>
    }>
  }>
}

export interface SearchHitsPayload {
  renderer: 'searchHits'
  total?: number
  hits: Array<{
    id?: string
    score?: number
    source: Record<string, unknown>
    highlights?: Record<string, string[]>
  }>
  aggregations?: Record<string, unknown>
}

export interface ProfilePayload {
  renderer: 'profile'
  summary?: string
  stages: Array<{
    name: string
    durationMs?: number
    rows?: number
    details?: Record<string, unknown>
  }>
}

export interface CostEstimatePayload {
  renderer: 'costEstimate'
  currency?: string
  estimatedBytes?: number
  estimatedCredits?: number
  estimatedCost?: number
  details?: Record<string, unknown>
}

export type ResultPayload =
  | TabularPayload
  | JsonPayload
  | DocumentPayload
  | KeyValuePayload
  | RawPayload
  | SchemaPayload
  | GraphPayload
  | ChartPayload
  | DiffPayload
  | PlanPayload
  | MetricsPayload
  | SeriesPayload
  | SearchHitsPayload
  | ProfilePayload
  | CostEstimatePayload

export interface ResultPageInfo {
  pageSize: number
  pageIndex: number
  bufferedRows: number
  hasMore: boolean
  nextCursor?: string
  totalRowsKnown?: number
}

export interface ExecutionResultEnvelope {
  id: string
  engine: DatastoreEngine
  summary: string
  defaultRenderer: ResultRenderer
  rendererModes: ResultRenderer[]
  payloads: ResultPayload[]
  notices: QueryExecutionNotice[]
  executedAt: string
  durationMs: number
  truncated?: boolean
  rowLimit?: number
  continuationToken?: string
  pageInfo?: ResultPageInfo
  explainPayload?: ResultPayload
}

export interface QueryHistoryEntry {
  id: string
  queryText: string
  executedAt: string
  status: QueryExecutionState
}

export interface UserFacingError {
  code: string
  message: string
}

export interface QueryTabState extends QueryTabDefinition {
  editorLabel: string
  queryText: string
  queryViewMode?: QueryViewMode
  scriptText?: string
  scopedTarget?: ScopedQueryTarget
  builderState?: QueryBuilderState
  metricsState?: MetricsTabState
  objectViewState?: ObjectViewTabState
  testSuite?: DatastoreTestSuiteDefinition
  testRun?: DatastoreTestRunResult
  status: QueryExecutionState
  dirty: boolean
  lastRunAt?: string
  result?: ExecutionResultEnvelope
  history: QueryHistoryEntry[]
  error?: UserFacingError
}

export type ClosedQueryTabReason = 'user' | 'connection-deleted' | 'replaced'

export interface ClosedQueryTabSnapshot extends QueryTabState {
  closedAt: string
  closeReason: ClosedQueryTabReason
}

export interface SavedWorkItem {
  id: string
  kind: SavedWorkItemKind
  name: string
  summary: string
  tags: string[]
  updatedAt: string
  folder?: string
  favorite?: boolean
  connectionId?: string
  environmentId?: string
  language?: QueryLanguage
  queryText?: string
  snapshotResultId?: string
}

export interface LibraryNode {
  id: string
  kind: LibraryNodeKind
  parentId?: string
  name: string
  summary?: string
  tags: string[]
  favorite?: boolean
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
  connectionId?: string
  environmentId?: string
  language?: QueryLanguage
  queryText?: string
  queryViewMode?: QueryViewMode
  builderState?: QueryBuilderState
  scriptText?: string
  testSuite?: DatastoreTestSuiteDefinition
  snapshotResultId?: string
}

export interface LibraryCreateFolderRequest {
  parentId?: string
  name: string
  environmentId?: string
}

export interface LibraryRenameNodeRequest {
  nodeId: string
  name: string
}

export interface LibraryDeleteNodeRequest {
  nodeId: string
}

export interface LibraryMoveNodeRequest {
  nodeId: string
  parentId?: string
}

export interface LibrarySetEnvironmentRequest {
  nodeId: string
  environmentId?: string
}

export interface SaveQueryTabToLibraryRequest {
  tabId: string
  itemId?: string
  folderId?: string
  name: string
  kind?: LibraryItemKind
  environmentId?: string
  tags?: string[]
}

export interface SaveQueryTabToLocalFileRequest {
  tabId: string
  path?: string
}

export interface ExplorerNode {
  id: string
  family: DatastoreFamily | 'shared'
  label: string
  kind: string
  detail: string
  scope?: string
  path?: string[]
  queryTemplate?: string
  expandable?: boolean
}

export interface StructureMetric {
  label: string
  value: string
}

export interface StructureField {
  name: string
  dataType: string
  detail?: string
  nullable?: boolean
  primary?: boolean
}

export interface StructureGroup {
  id: string
  label: string
  kind: string
  detail?: string
  color?: string
}

export interface StructureNode {
  id: string
  family: DatastoreFamily | 'shared'
  label: string
  kind: string
  groupId?: string
  detail?: string
  metrics?: StructureMetric[]
  fields?: StructureField[]
  sample?: unknown
}

export interface StructureEdge {
  id: string
  from: string
  to: string
  label: string
  kind: string
  inferred?: boolean
}

export interface DiagnosticsReport {
  createdAt: string
  runtime: string
  platform: string
  appVersion: string
  counts: {
    connections: number
    environments: number
    tabs: number
    savedWork: number
    library: number
  }
  warnings: string[]
}

export type SavedArtifact = SavedWorkItem
export type SavedArtifactKind = SavedWorkItemKind
export type LibraryArtifact = LibraryNode
export type LibraryArtifactKind = LibraryNodeKind
