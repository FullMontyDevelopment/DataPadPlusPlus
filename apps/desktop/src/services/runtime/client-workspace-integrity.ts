import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'

const WORKSPACE_BUNDLE_HASH_ALGORITHM = 'sha256'
const WORKSPACE_BUNDLE_HASH_SCOPE = 'workspace-bundle-payload-v1'

interface BrowserWorkspaceBundlePayload {
  snapshot: WorkspaceSnapshot
  sourceWorkspaceName?: string
  historyQueryTexts?: string[]
  secrets?: unknown[]
  integrity?: WorkspaceBundleIntegrity
}

interface WorkspaceBundleIntegrity {
  algorithm: string
  scope: string
  digest: string
}

export async function createBrowserWorkspaceBundlePayloadText(
  snapshot: WorkspaceSnapshot,
  sourceWorkspaceName?: string,
) {
  const interned = internWorkspaceHistoryQueries(snapshot)
  const payload: BrowserWorkspaceBundlePayload = {
    snapshot: interned.snapshot,
    sourceWorkspaceName: sourceWorkspaceName?.trim() || undefined,
    historyQueryTexts: interned.historyQueryTexts,
    secrets: [],
  }
  payload.integrity = await createWorkspaceBundleIntegrity(payload)
  return JSON.stringify(payload)
}

export async function parseBrowserWorkspacePayload(value: string) {
  return (await parseBrowserWorkspacePayloadWithMetadata(value)).snapshot
}

export async function parseBrowserWorkspacePayloadWithMetadata(value: string) {
  const parsed = JSON.parse(value) as WorkspaceSnapshot | BrowserWorkspaceBundlePayload

  if (
    parsed &&
    typeof parsed === 'object' &&
    'snapshot' in parsed &&
    (parsed as BrowserWorkspaceBundlePayload).snapshot
  ) {
    const payload = parsed as BrowserWorkspaceBundlePayload
    await validateWorkspaceBundleIntegrity(payload)
    return {
      snapshot: restoreWorkspaceHistoryQueries(payload),
      sourceWorkspaceName: payload.sourceWorkspaceName,
    }
  }

  return { snapshot: parsed as WorkspaceSnapshot }
}

async function createWorkspaceBundleIntegrity(payload: BrowserWorkspaceBundlePayload) {
  return {
    algorithm: WORKSPACE_BUNDLE_HASH_ALGORITHM,
    scope: WORKSPACE_BUNDLE_HASH_SCOPE,
    digest: await workspaceBundleDigest(payload),
  }
}

async function validateWorkspaceBundleIntegrity(payload: BrowserWorkspaceBundlePayload) {
  const integrity = payload.integrity

  if (!integrity) {
    return
  }

  if (
    integrity.algorithm !== WORKSPACE_BUNDLE_HASH_ALGORITHM ||
    integrity.scope !== WORKSPACE_BUNDLE_HASH_SCOPE ||
    !/^[a-fA-F0-9]{64}$/.test(integrity.digest)
  ) {
    throw new Error('Workspace bundle integrity metadata is unsupported.')
  }

  const digest = integrity.digest.toLowerCase()
  const validCurrentDigest = (await workspaceBundleDigest(payload)) === digest
  const validLegacyDigest = payload.historyQueryTexts === undefined
    && (await workspaceBundleDigest(payload, true)) === digest
  if (!validCurrentDigest && !validLegacyDigest) {
    throw new Error(
      'Workspace bundle integrity check failed. The file may be corrupt or modified.',
    )
  }
}

async function workspaceBundleDigest(
  payload: BrowserWorkspaceBundlePayload,
  legacy = false,
) {
  const digestPayload: Record<string, unknown> = {
    snapshot: payload.snapshot,
    secrets: payload.secrets ?? [],
  }
  if (!legacy) {
    digestPayload.historyQueryTexts = payload.historyQueryTexts ?? []
    if (payload.sourceWorkspaceName) {
      digestPayload.sourceWorkspaceName = payload.sourceWorkspaceName
    }
  }
  const canonical = canonicalJson(digestPayload)
  const digest = await browserCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function internWorkspaceHistoryQueries(snapshot: WorkspaceSnapshot) {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot
  const historyQueryTexts: string[] = []
  const indexes = new Map<string, number>()

  for (const tab of [...cloned.tabs, ...cloned.closedTabs]) {
    for (const entry of tab.history) {
      let index = indexes.get(entry.queryText)
      if (index === undefined) {
        index = historyQueryTexts.length
        indexes.set(entry.queryText, index)
        historyQueryTexts.push(entry.queryText)
      }
      entry.queryText = `@q:${index}`
    }
  }

  return { snapshot: cloned, historyQueryTexts }
}

function restoreWorkspaceHistoryQueries(payload: BrowserWorkspaceBundlePayload) {
  const historyQueryTexts = payload.historyQueryTexts ?? []
  if (historyQueryTexts.length === 0) return payload.snapshot

  for (const tab of [...payload.snapshot.tabs, ...payload.snapshot.closedTabs]) {
    for (const entry of tab.history) {
      const match = /^@q:(\d+)$/.exec(entry.queryText)
      if (!match) continue
      const queryText = historyQueryTexts[Number(match[1])]
      if (queryText === undefined) {
        throw new Error('Workspace bundle history string table is invalid.')
      }
      entry.queryText = queryText
    }
  }

  return payload.snapshot
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)

    return `{${entries.join(',')}}`
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return 'null'
  }

  return JSON.stringify(value) ?? 'null'
}

function browserCrypto() {
  const crypto = globalThis.crypto

  if (!crypto?.subtle) {
    throw new Error('This browser cannot encrypt workspace bundles.')
  }

  return crypto
}
