import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'

const WORKSPACE_BUNDLE_HASH_ALGORITHM = 'sha256'
const WORKSPACE_BUNDLE_HASH_SCOPE = 'workspace-bundle-payload-v1'

interface BrowserWorkspaceBundlePayload {
  snapshot: WorkspaceSnapshot
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
) {
  const payload: BrowserWorkspaceBundlePayload = {
    snapshot,
    secrets: [],
  }
  payload.integrity = await createWorkspaceBundleIntegrity(payload)
  return JSON.stringify(payload)
}

export async function parseBrowserWorkspacePayload(value: string) {
  const parsed = JSON.parse(value) as WorkspaceSnapshot | BrowserWorkspaceBundlePayload

  if (
    parsed &&
    typeof parsed === 'object' &&
    'snapshot' in parsed &&
    (parsed as BrowserWorkspaceBundlePayload).snapshot
  ) {
    const payload = parsed as BrowserWorkspaceBundlePayload
    await validateWorkspaceBundleIntegrity(payload)
    return payload.snapshot
  }

  return parsed as WorkspaceSnapshot
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

  if ((await workspaceBundleDigest(payload)) !== integrity.digest.toLowerCase()) {
    throw new Error(
      'Workspace bundle integrity check failed. The file may be corrupt or modified.',
    )
  }
}

async function workspaceBundleDigest(payload: BrowserWorkspaceBundlePayload) {
  const canonical = canonicalJson({
    snapshot: payload.snapshot,
    secrets: payload.secrets ?? [],
  })
  const digest = await browserCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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
