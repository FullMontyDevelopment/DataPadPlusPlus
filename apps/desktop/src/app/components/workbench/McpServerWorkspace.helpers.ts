import {
  DATASTORE_MCP_SERVER_SCOPES,
  type DatastoreMcpServerScope,
} from '@datapadplusplus/shared-types'

export const DEFAULT_MCP_PORT = 17641

export function isMcpServerScope(value: string): value is DatastoreMcpServerScope {
  return DATASTORE_MCP_SERVER_SCOPES.includes(value as DatastoreMcpServerScope)
}

export function toggleValue(values: string[], value: string, enabled: boolean) {
  const current = new Set(values)
  if (enabled) current.add(value)
  else current.delete(value)
  return Array.from(current)
}

export function normalizeLines(value: string) {
  return uniqueStrings(value.split(/\r?\n/g))
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function defaultMcpServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === DEFAULT_MCP_PORT ? 'MCP Server' : `MCP Server ${safePort}`
}

export function formatAllowlistCount(connectionCount: number, environmentCount: number) {
  return `${formatNumber(connectionCount)} datastores / ${formatNumber(environmentCount)} environments`
}

export function formatTokenCount(count: number) {
  return count === 1 ? '1 auth token' : `${formatNumber(count)} auth tokens`
}

export function clampPort(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MCP_PORT
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function formatDuration(value: number | undefined) {
  return value === undefined ? 'None' : `${Math.round(value * 100) / 100} ms`
}

export function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}

export function formatDateTime(value: string | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
