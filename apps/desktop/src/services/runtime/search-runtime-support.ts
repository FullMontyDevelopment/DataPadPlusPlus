import type { ConnectionProfile } from '@datapadplusplus/shared-types'

type SearchRuntimeConnection = Pick<ConnectionProfile, 'connectionString' | 'host' | 'searchOptions'>

export interface SearchRuntimeSupport {
  live: boolean
  evidence: 'live' | 'plan-only'
  disabledReason?: string
}

export const SEARCH_PLAIN_HTTP_RUNTIME_REASON =
  'The current desktop search runtime executes only plain HTTP endpoints with none/basic auth; HTTPS, cloud, token, API-key, and SigV4 profiles are stored and planned but not live-executed yet.'

const SEARCH_PREVIEW_EXECUTION_REASON =
  'Search admin/import/export execution remains preview-first until permission, shard-impact, snapshot repository, and rollback boundaries are live-validated.'

export function searchRuntimeSupport(connection: SearchRuntimeConnection): SearchRuntimeSupport {
  const disabledReason = searchRuntimeDisabledReason(connection)
  if (disabledReason) {
    return {
      live: false,
      evidence: 'plan-only',
      disabledReason,
    }
  }

  return {
    live: true,
    evidence: 'live',
  }
}

export function searchRuntimeDisabledReason(connection: SearchRuntimeConnection): string | undefined {
  const options = connection.searchOptions
  const connectMode = normalized(options?.connectMode)

  if (connectMode === 'elastic-cloud') {
    return 'Elastic Cloud search profiles are contract-planned; live execution waits for cloud-id resolution, HTTPS transport, and scoped credential validation.'
  }
  if (connectMode === 'opensearch-managed') {
    return 'Managed OpenSearch profiles are contract-planned; live execution waits for provider endpoint, TLS, and credential validation.'
  }
  if (connectMode === 'aws-sigv4') {
    return 'AWS SigV4 search profiles are contract-planned; live execution waits for request signing, region/service validation, and credential resolution.'
  }

  if (hasText(options?.cloudId)) {
    return 'Search cloud ids are stored for profile fidelity, but live cloud-id resolution and HTTPS execution are not enabled yet.'
  }

  const authMode = normalized(options?.authMode)
  if (authMode && authMode !== 'none' && authMode !== 'basic') {
    return `${authModeLabel(authMode)} search auth is contract-planned; the live runtime currently executes only none/basic auth over plain HTTP.`
  }

  if (options?.useTls === true) {
    return 'Search TLS profiles are contract-planned; the current live runtime executes plain HTTP endpoints only.'
  }

  if (
    hasText(options?.caCertificatePath)
    || hasText(options?.clientCertificatePath)
    || hasText(options?.clientKeyPath)
  ) {
    return 'Search certificate material is stored for profile fidelity, but live TLS/client-certificate execution is not enabled yet.'
  }

  const endpoint = firstText(options?.endpointUrl, connection.connectionString, connection.host)
  if (endpoint?.toLowerCase().startsWith('https://')) {
    return 'Search HTTPS endpoints are contract-planned; the current live runtime executes plain HTTP endpoints only.'
  }

  return undefined
}

export function searchPreviewExecutionGate(
  connection: SearchRuntimeConnection,
  boundary: string,
) {
  const runtime = searchRuntimeSupport(connection)
  return {
    defaultSupport: 'plan-only' as const,
    evidence: 'plan-only' as const,
    boundary,
    runtimeEvidence: runtime.evidence,
    disabledReasons: [
      SEARCH_PREVIEW_EXECUTION_REASON,
      runtime.disabledReason ?? SEARCH_PLAIN_HTTP_RUNTIME_REASON,
    ],
  }
}

export function searchPreviewDisabledReason(
  connection: SearchRuntimeConnection,
  label: string,
) {
  const runtime = searchRuntimeSupport(connection)
  return `${label} is preview-first. ${SEARCH_PREVIEW_EXECUTION_REASON} Current profile boundary: ${runtime.disabledReason ?? SEARCH_PLAIN_HTTP_RUNTIME_REASON}`
}

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase()
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim())
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => hasText(value))?.trim()
}

function authModeLabel(authMode: string) {
  switch (authMode) {
    case 'api-key':
      return 'API key'
    case 'bearer-token':
      return 'Bearer token'
    case 'service-token':
      return 'Service token'
    case 'aws-sigv4':
      return 'AWS SigV4'
    default:
      return authMode
  }
}
