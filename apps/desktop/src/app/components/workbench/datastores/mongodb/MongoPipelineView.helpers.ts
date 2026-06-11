type JsonRecord = Record<string, unknown>

export function mongoPipelineStageRows(pipeline: unknown[]) {
  return pipeline.map((stage) => {
    const stageRecord = asRecord(stage)
    const [operator = 'stage', value = stage] = Object.entries(stageRecord)[0] ?? []
    return {
      operator,
      value,
      summary: mongoPipelineStageSummary(operator),
      details: mongoPipelineStageDetails(value),
    }
  })
}

function mongoPipelineStageSummary(operator: string) {
  switch (operator) {
    case '$match':
      return 'Filters documents before later stages run.'
    case '$project':
      return 'Shapes the fields returned by the view.'
    case '$sort':
      return 'Orders documents before they are returned.'
    case '$group':
      return 'Groups documents and computes aggregate values.'
    case '$lookup':
      return 'Joins related documents from another collection.'
    case '$unwind':
      return 'Expands array values into individual pipeline rows.'
    case '$limit':
      return 'Caps how many documents continue through the pipeline.'
    case '$skip':
      return 'Skips documents before later stages run.'
    case '$addFields':
    case '$set':
      return 'Adds or replaces computed fields.'
    default:
      return 'Runs a MongoDB aggregation stage.'
  }
}

function mongoPipelineStageDetails(value: unknown) {
  if (Array.isArray(value)) {
    return [`${value.length} item(s)`]
  }

  const record = asRecord(value)
  const keys = Object.keys(record)
  if (keys.length > 0) {
    return [
      `${keys.length} setting(s)`,
      ...keys.slice(0, 3),
    ]
  }

  const scalar = stringValue(value)
  return scalar ? [scalar] : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}
