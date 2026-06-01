export function normalizeKind(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
