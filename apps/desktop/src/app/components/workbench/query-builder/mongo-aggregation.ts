import type {
  MongoAggregationBuilderState,
  MongoAggregationStageRow,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'

interface MongoQueryTextContext {
  database?: string
}

export function createDefaultMongoAggregationBuilderState(
  collection: string,
  limit = 20,
): MongoAggregationBuilderState {
  const state: MongoAggregationBuilderState = {
    kind: 'mongo-aggregation',
    collection,
    stages: [
      { id: 'stage-match', enabled: true, stage: '$match', body: '{}' },
    ],
    limit,
  }

  return {
    ...state,
    lastAppliedQueryText: buildMongoAggregationQueryText(state),
  }
}

export function isMongoAggregationBuilderState(
  state: QueryBuilderState | undefined,
): state is MongoAggregationBuilderState {
  return state?.kind === 'mongo-aggregation'
}

export function buildMongoAggregationQueryText(
  state: MongoAggregationBuilderState,
  context: MongoQueryTextContext = {},
): string {
  const database = context.database?.trim()
  const pipeline = state.stages
    .filter((stage) => stage.enabled ?? true)
    .map(stageToPipelineItem)
    .filter((stage): stage is Record<string, unknown> => Boolean(stage))

  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection: state.collection.trim(),
      operation: 'aggregate',
      pipeline,
      ...(state.limit && state.limit > 0 ? { limit: Math.floor(state.limit) } : {}),
    },
    null,
    2,
  )
}

export function parseMongoAggregationQueryText(
  queryText: string,
): MongoAggregationBuilderState | undefined {
  try {
    const parsed = JSON.parse(queryText) as {
      collection?: unknown
      pipeline?: unknown
      limit?: unknown
    }

    if (typeof parsed.collection !== 'string' || !Array.isArray(parsed.pipeline)) {
      return undefined
    }

    let pipelineLimit: number | undefined
    const stages = parsed.pipeline.flatMap((stage, index) => {
      if (!isPlainObject(stage)) {
        return []
      }

      const [name, value] = Object.entries(stage)[0] ?? []
      if (!name) {
        return []
      }

      if (name === '$limit' && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        pipelineLimit = Math.floor(value)
        return []
      }

      return [{
        id: `stage-${index + 1}`,
        enabled: true,
        stage: name,
        body: formatStageBody(value),
      }]
    })

    const limit =
      typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) && parsed.limit > 0
        ? Math.floor(parsed.limit)
        : pipelineLimit
    const state: MongoAggregationBuilderState = {
      kind: 'mongo-aggregation',
      collection: parsed.collection,
      stages,
      limit,
    }

    return {
      ...state,
      lastAppliedQueryText: buildMongoAggregationQueryText(state),
    }
  } catch {
    return undefined
  }
}

function stageToPipelineItem(stage: MongoAggregationStageRow) {
  const name = normalizeStageName(stage.stage)

  if (!name) {
    return undefined
  }

  return { [name]: parseStageBody(stage.body) }
}

function normalizeStageName(stage: string) {
  const trimmed = stage.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
}

function parseStageBody(body: string): unknown {
  const trimmed = body.trim()

  if (!trimmed) {
    return {}
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const numeric = Number(trimmed)
    return Number.isFinite(numeric) ? numeric : trimmed
  }
}

function formatStageBody(value: unknown) {
  return typeof value === 'number' || typeof value === 'boolean' || value === null
    ? String(value)
    : JSON.stringify(value ?? {}, null, 2)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
