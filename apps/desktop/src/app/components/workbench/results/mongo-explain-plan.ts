export interface MongoExplainMetric {
  label: string
  value: string
}

export interface MongoExplainPlanNode {
  id: string
  stage: string
  indexName?: string
  collection?: string
  direction?: string
  filter?: unknown
  keyPattern?: unknown
  indexBounds?: unknown
  metrics: MongoExplainMetric[]
  warnings: string[]
  children: MongoExplainPlanNode[]
  raw: unknown
}

export interface MongoExplainIndexDetail {
  name: string
  stage: string
  keyPattern?: unknown
  bounds?: unknown
  direction?: string
  multikey?: boolean
  sparse?: boolean
  partial?: boolean
}

export interface MongoExplainSummary {
  namespace?: string
  verbosity: 'queryPlanner' | 'executionStats' | 'allPlansExecution'
  winningStage?: string
  indexName?: string
  executionTimeMs?: number
  returned?: number
  docsExamined?: number
  keysExamined?: number
  docsPerReturned?: number
  keysPerReturned?: number
  rejectedPlanCount: number
  hasExecutionStats: boolean
  isSharded: boolean
  shardCount: number
}

export interface MongoExplainPlanModel {
  summary: MongoExplainSummary
  warnings: string[]
  winningPlan?: MongoExplainPlanNode
  indexDetails: MongoExplainIndexDetail[]
  rejectedPlans: MongoExplainPlanNode[]
  raw: unknown
  fallbackReason?: string
}

interface ExplainSection {
  label: string
  planner?: JsonRecord
  stats?: JsonRecord
}

type JsonRecord = Record<string, unknown>

const MAX_PLAN_NODES = 80
const WARNING_SCAN_RATIO = 20

export function normalizeMongoExplainPlan(value: unknown): MongoExplainPlanModel {
  const root = asRecord(value)
  if (!root) {
    return fallbackModel(value, 'MongoDB explain returned a non-object payload.')
  }

  const sections = collectExplainSections(root)
  const primary = sections[0]
  if (!primary) {
    return fallbackModel(value, 'No MongoDB queryPlanner or executionStats section was found.')
  }

  const planSource =
    asRecord(primary.stats?.executionStages) ??
    asRecord(primary.planner?.winningPlan)
  const winningPlan = planSource
    ? normalizePlanNode(planSource, primary.label || 'winning', new NodeBudget())
    : undefined
  const rejectedPlanValues = collectRejectedPlans(primary)
  const rejectedPlans = rejectedPlanValues
    .slice(0, 8)
    .map((plan, index) => normalizePlanNode(plan, `rejected-${index + 1}`, new NodeBudget()))
  const indexDetails = winningPlan ? collectIndexDetails(winningPlan) : []
  const summary = buildSummary(primary, winningPlan, indexDetails, rejectedPlanValues.length, sections)
  const warnings = buildWarnings(summary, winningPlan, rejectedPlanValues.length)

  if (!winningPlan) {
    warnings.push('No winning plan tree was available in the explain payload.')
  }

  return {
    summary,
    warnings,
    winningPlan,
    indexDetails,
    rejectedPlans,
    raw: value,
    fallbackReason: winningPlan ? undefined : 'The payload did not contain a renderable winning plan.',
  }
}

function collectExplainSections(root: JsonRecord): ExplainSection[] {
  const sections: ExplainSection[] = []

  if (asRecord(root.queryPlanner) || asRecord(root.executionStats)) {
    sections.push({
      label: stringValue(asRecord(root.queryPlanner)?.namespace) ?? 'query',
      planner: asRecord(root.queryPlanner),
      stats: asRecord(root.executionStats),
    })
  }

  for (const [index, stage] of arrayValue(root.stages).entries()) {
    const cursor = asRecord(asRecord(stage)?.$cursor)
    if (!cursor) {
      continue
    }
    sections.push({
      label: stringValue(asRecord(cursor.queryPlanner)?.namespace) ?? `aggregation-cursor-${index + 1}`,
      planner: asRecord(cursor.queryPlanner),
      stats: asRecord(cursor.executionStats),
    })
  }

  const shards = asRecord(root.shards)
  if (shards) {
    for (const [shardName, shard] of Object.entries(shards)) {
      const shardRecord = asRecord(shard)
      if (!shardRecord) {
        continue
      }
      sections.push({
        label: shardName,
        planner: asRecord(shardRecord.queryPlanner),
        stats: asRecord(shardRecord.executionStats),
      })
    }
  }

  return sections.filter((section) => section.planner || section.stats)
}

function buildSummary(
  section: ExplainSection,
  winningPlan: MongoExplainPlanNode | undefined,
  indexes: MongoExplainIndexDetail[],
  rejectedPlanCount: number,
  sections: ExplainSection[],
): MongoExplainSummary {
  const stats = section.stats
  const returned = numberValue(stats?.nReturned)
  const docsExamined = numberValue(stats?.totalDocsExamined)
  const keysExamined = numberValue(stats?.totalKeysExamined)
  const hasAllPlans = Boolean(asRecord(section.stats)?.allPlansExecution)
  const namespace = stringValue(section.planner?.namespace) ?? section.label

  return {
    namespace,
    verbosity: hasAllPlans ? 'allPlansExecution' : stats ? 'executionStats' : 'queryPlanner',
    winningStage: winningPlan?.stage,
    indexName: indexes[0]?.name,
    executionTimeMs: numberValue(stats?.executionTimeMillis),
    returned,
    docsExamined,
    keysExamined,
    docsPerReturned: ratio(docsExamined, returned),
    keysPerReturned: ratio(keysExamined, returned),
    rejectedPlanCount,
    hasExecutionStats: Boolean(stats),
    isSharded: sections.length > 1,
    shardCount: sections.length,
  }
}

function buildWarnings(
  summary: MongoExplainSummary,
  winningPlan: MongoExplainPlanNode | undefined,
  rejectedPlanCount: number,
) {
  const warnings: string[] = []
  const stages = winningPlan ? collectStages(winningPlan) : new Set<string>()

  if (stages.has('COLLSCAN')) {
    warnings.push('Collection scan: MongoDB scanned collection documents without using an index.')
  }
  if (stages.has('SORT')) {
    warnings.push('Blocking sort: MongoDB may need to sort in memory unless an index supports this order.')
  }
  if (!summary.indexName && !stages.has('IDHACK')) {
    warnings.push('No index was reported for the winning plan.')
  }
  if (!summary.hasExecutionStats) {
    warnings.push('Execution statistics are not present; run with executionStats for rows examined and timing.')
  }
  if (rejectedPlanCount > 0) {
    warnings.push(`${rejectedPlanCount} rejected plan(s) were returned by the optimizer.`)
  }
  if (
    summary.docsPerReturned !== undefined &&
    summary.docsPerReturned >= WARNING_SCAN_RATIO &&
    (summary.returned ?? 0) > 0
  ) {
    warnings.push(`High scan ratio: ${formatNumber(summary.docsPerReturned)} documents examined per returned document.`)
  }

  return warnings
}

function normalizePlanNode(raw: JsonRecord, id: string, budget: NodeBudget): MongoExplainPlanNode {
  if (!budget.take()) {
    return {
      id,
      stage: 'TRUNCATED',
      metrics: [{ label: 'Limit', value: `${MAX_PLAN_NODES} rendered plan nodes` }],
      warnings: ['Plan tree is larger than the bounded renderer limit.'],
      children: [],
      raw,
    }
  }

  const stage = stringValue(raw.stage) ?? stringValue(raw.queryPlan && asRecord(raw.queryPlan)?.stage) ?? 'UNKNOWN'
  const children = childPlanRecords(raw).map((child, index) =>
    normalizePlanNode(child, `${id}-${index + 1}`, budget),
  )
  const node: MongoExplainPlanNode = {
    id,
    stage,
    indexName: stringValue(raw.indexName),
    collection: stringValue(raw.collection),
    direction: stringValue(raw.direction),
    filter: raw.filter,
    keyPattern: raw.keyPattern,
    indexBounds: raw.indexBounds,
    metrics: planMetrics(raw),
    warnings: stageWarnings(stage),
    children,
    raw,
  }

  return node
}

function childPlanRecords(raw: JsonRecord): JsonRecord[] {
  const candidates: unknown[] = [
    raw.inputStage,
    raw.outerStage,
    raw.innerStage,
    raw.thenStage,
    raw.elseStage,
    raw.queryPlan,
    ...arrayValue(raw.inputStages),
  ]

  for (const shard of arrayValue(raw.shards)) {
    const shardRecord = asRecord(shard)
    candidates.push(
      asRecord(shardRecord?.winningPlan),
      asRecord(shardRecord?.executionStages),
    )
  }

  return candidates.flatMap((item) => {
    const record = asRecord(item)
    return record ? [record] : []
  })
}

function planMetrics(raw: JsonRecord): MongoExplainMetric[] {
  return [
    metric('Returned', raw.nReturned),
    metric('Keys', raw.keysExamined),
    metric('Docs', raw.docsExamined),
    metric('Works', raw.works),
    metric('Advanced', raw.advanced),
    metric('Need time', raw.needTime),
    metric('Time', raw.executionTimeMillisEstimate, 'ms'),
  ].filter((item): item is MongoExplainMetric => Boolean(item))
}

function metric(label: string, value: unknown, suffix = '') {
  const numeric = numberValue(value)
  if (numeric === undefined) {
    return undefined
  }
  return { label, value: `${formatNumber(numeric)}${suffix}` }
}

function stageWarnings(stage: string) {
  if (stage === 'COLLSCAN') {
    return ['Collection scan']
  }
  if (stage === 'SORT') {
    return ['Blocking sort']
  }
  return []
}

function collectRejectedPlans(section: ExplainSection): JsonRecord[] {
  const plannerPlans = arrayValue(section.planner?.rejectedPlans).flatMap((item) => {
    const record = asRecord(item)
    return record ? [record] : []
  })
  const statsPlans = arrayValue(section.stats?.allPlansExecution).flatMap((item) => {
    const record = asRecord(item)
    return record ? [record] : []
  })
  return [...plannerPlans, ...statsPlans]
}

function collectIndexDetails(plan: MongoExplainPlanNode): MongoExplainIndexDetail[] {
  const details = new Map<string, MongoExplainIndexDetail>()
  walkPlan(plan, (node) => {
    if (!node.indexName) {
      return
    }
    details.set(`${node.stage}:${node.indexName}`, {
      name: node.indexName,
      stage: node.stage,
      keyPattern: node.keyPattern,
      bounds: node.indexBounds,
      direction: node.direction,
      multikey: booleanValue(asRecord(node.raw)?.isMultiKey),
      sparse: booleanValue(asRecord(node.raw)?.isSparse),
      partial: Boolean(asRecord(node.raw)?.isPartial),
    })
  })
  return Array.from(details.values())
}

function collectStages(plan: MongoExplainPlanNode) {
  const stages = new Set<string>()
  walkPlan(plan, (node) => stages.add(node.stage))
  return stages
}

function walkPlan(plan: MongoExplainPlanNode, visit: (node: MongoExplainPlanNode) => void) {
  visit(plan)
  for (const child of plan.children) {
    walkPlan(child, visit)
  }
}

function fallbackModel(value: unknown, reason: string): MongoExplainPlanModel {
  return {
    summary: {
      verbosity: 'queryPlanner',
      rejectedPlanCount: 0,
      hasExecutionStats: false,
      isSharded: false,
      shardCount: 0,
    },
    warnings: [reason],
    indexDetails: [],
    rejectedPlans: [],
    raw: value,
    fallbackReason: reason,
  }
}

function ratio(numerator: number | undefined, denominator: number | undefined) {
  if (numerator === undefined || denominator === undefined || denominator <= 0) {
    return undefined
  }
  return numerator / denominator
}

export function formatNumber(value: number) {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

class NodeBudget {
  private remaining = MAX_PLAN_NODES

  take() {
    this.remaining -= 1
    return this.remaining >= 0
  }
}
