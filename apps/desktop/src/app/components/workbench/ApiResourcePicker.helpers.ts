import type { DatastoreApiServerResourceConfig } from '@datapadplusplus/shared-types'

export function resourceGroup(resource: DatastoreApiServerResourceConfig) {
  const path = (resource.path ?? [])
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (path.at(-1)?.localeCompare(resource.label.trim(), undefined, { sensitivity: 'accent' }) === 0) {
    path.pop()
  }
  if (path.length > 0) return path.join(' / ')
  return 'Other'
}
