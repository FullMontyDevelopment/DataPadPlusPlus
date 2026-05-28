type JsonRecord = Record<string, unknown>

const SOURCE_KINDS = new Set([
  'ddl',
  'definition',
  'function',
  'functions',
  'materialized-view',
  'procedure',
  'procedures',
  'routine',
  'routines',
  'stored-procedure',
  'stored-procedures',
  'trigger',
  'triggers',
  'view',
  'views',
])

export function relationalSourceText(kind: string, payload: JsonRecord) {
  if (!SOURCE_KINDS.has(kind)) {
    return ''
  }

  return [
    scalarSource(payload.definition),
    scalarSource(payload.source),
    scalarSource(payload.sourceText),
    scalarSource(payload.sql),
    scalarSource(payload.query),
    scalarSource(payload.body),
    scalarSource(payload.ddl),
    sourceLines(payload.sourceLines),
    nestedSource(payload.routines),
    nestedSource(payload.procedures),
    nestedSource(payload.functions),
    nestedSource(payload.views),
  ].find(Boolean) ?? ''
}

function nestedSource(value: unknown) {
  const records = Array.isArray(value) ? value.filter(isRecord) : []
  for (const record of records) {
    const source = [
      scalarSource(record.definition),
      scalarSource(record.source),
      scalarSource(record.sourceText),
      scalarSource(record.sql),
      scalarSource(record.body),
    ].find(Boolean)
    if (source) {
      return source
    }
  }
  return ''
}

function sourceLines(value: unknown) {
  if (!Array.isArray(value)) {
    return ''
  }

  const lines = value.map((line) => {
    if (typeof line === 'string') {
      return line
    }

    if (isRecord(line)) {
      return scalarSource(line.text ?? line.source ?? line.line)
    }

    return ''
  })

  return lines.filter(Boolean).join('\n')
}

function scalarSource(value: unknown) {
  return typeof value === 'string' && value.trim().length ? value : ''
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
