export function parseSearchHitSourceJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

export function stringifySearchHitSource(value: unknown, space?: number) {
  try {
    return JSON.stringify(value, jsonValueReplacer, space) ?? 'null'
  } catch {
    return String(value)
  }
}

function jsonValueReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
