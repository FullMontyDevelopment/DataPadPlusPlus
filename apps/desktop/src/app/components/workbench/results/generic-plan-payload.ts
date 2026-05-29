export interface PlanTable {
  columns: string[]
  rows: string[][]
}

export interface GenericPlanModel {
  lines: string[]
  table?: PlanTable
  raw?: unknown
  warnings: string[]
}

export function normalizeGenericPlanPayload(value: unknown): GenericPlanModel {
  const table = tableFromPlanValue(value)
  const lines = planLinesFromValue(value, table)
  return {
    lines,
    table,
    raw: shouldExposeStructuredPayload(value, table, lines) ? value : undefined,
    warnings: planWarnings(lines, table),
  }
}

function planLinesFromValue(value: unknown, table?: PlanTable): string[] {
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.map(planLineFromEntry).filter(nonEmptyString)
  }
  if (isRecord(value)) {
    const plan = value.plan
    if (Array.isArray(plan)) {
      return plan.map(planLineFromEntry).filter(nonEmptyString)
    }
    if (table?.columns.length === 1) {
      return table.rows.map((row) => row[0]).filter(nonEmptyString)
    }
    if (table?.columns.some((column) => /plan|detail|operator/i.test(column))) {
      const index = table.columns.findIndex((column) => /plan|detail|operator/i.test(column))
      return table.rows.map((row) => row[index]).filter(nonEmptyString)
    }
  }
  return []
}

function tableFromPlanValue(value: unknown): PlanTable | undefined {
  if (isRecord(value) && Array.isArray(value.columns) && Array.isArray(value.rows)) {
    return {
      columns: value.columns.map((column) => String(column)),
      rows: value.rows
        .filter(Array.isArray)
        .map((row) => row.map((cell) => String(cell ?? ''))),
    }
  }
  if (Array.isArray(value) && value.every(Array.isArray)) {
    const maxColumns = Math.max(...value.map((row) => row.length), 0)
    return {
      columns: Array.from({ length: maxColumns }, (_, index) => `Column ${index + 1}`),
      rows: value.map((row) => row.map((cell) => String(cell ?? ''))),
    }
  }
  return undefined
}

function planLineFromEntry(entry: unknown) {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) return entry.map((cell) => String(cell ?? '')).join('  ')
  if (isRecord(entry)) {
    return Object.entries(entry)
      .map(([key, value]) => `${humanize(key)}: ${displayPlanValue(value)}`)
      .join(' | ')
  }
  return entry == null ? '' : String(entry)
}

function nonEmptyString(value: string | undefined): value is string {
  return Boolean(value)
}

function planWarnings(lines: string[], table?: PlanTable) {
  const text = [...lines, ...(table?.rows.flat() ?? [])].join(' ').toLowerCase()
  const warnings: string[] = []
  if (/(seq[_ ]scan|table[_ ]scan|full[_ ]scan|collscan|\bscan\b)/i.test(text) && !/(index|seek)/i.test(text)) {
    warnings.push('Plan includes a broad scan without an obvious index signal.')
  }
  if (/(external|csv|parquet|remote|s3|gcs|azure)/i.test(text)) {
    warnings.push('Plan may read external or file-backed data.')
  }
  if (/(sort|hash[_ ]join|nested[_ ]loop|aggregate)/i.test(text)) {
    warnings.push('Plan includes memory-sensitive operators.')
  }
  return warnings
}

function shouldExposeStructuredPayload(value: unknown, table: PlanTable | undefined, lines: string[]) {
  return isRecord(value) && (Boolean(table) || lines.length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function displayPlanValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item(s)`
  if (isRecord(value)) return `${Object.keys(value).length} field(s)`
  return String(value ?? '')
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
