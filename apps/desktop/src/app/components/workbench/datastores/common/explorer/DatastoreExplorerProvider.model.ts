import type {
  ConnectionProfile,
  DatastoreTreeNodeManifest,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { explorerScopeKey } from '../../../../../state/app-state-reducer-helpers'
import type {
  CreateDatastoreExplorerProviderOptions,
  DatastoreExplorerDetailCategory,
  DatastoreExplorerDetailMode,
  DatastoreExplorerDetailProvider,
} from './DatastoreExplorerProvider.types'

export interface DatastoreExplorerTreeItem {
  id: string
  label: string
  kind: string
  detail?: string
  node?: ExplorerNode
  path: string[]
  children: DatastoreExplorerTreeItem[]
  synthetic: boolean
}

const DEFAULT_SCOPE_KINDS = new Set([
  'account',
  'buckets',
  'catalogs',
  'cluster',
  'collections',
  'containers',
  'databases',
  'datasets',
  'diagnostics',
  'graphs',
  'indexes',
  'indices',
  'keyspaces',
  'keys',
  'maintenance',
  'measurements',
  'metrics',
  'nodes',
  'roles',
  'schemas',
  'security',
  'server',
  'system-databases',
  'system-keyspaces',
  'system-schemas',
  'tables',
  'targets',
  'users',
  'views',
])

const DEFAULT_LAUNCH_KINDS = new Set([
  'aggregation',
  'aggregations',
  'console',
  'documents',
  'items',
  'known-key',
  'query',
  'sample-results',
  'search',
  'view-results',
])

const DEFAULT_STATE_KINDS = new Set([
  'permission',
  'unavailable',
  'unsupported',
])

const INSPECTABLE_SCOPE_KINDS = new Set([
  'account',
  'bucket',
  'catalog',
  'collection',
  'container',
  'database',
  'dataset',
  'graph',
  'index',
  'keyspace',
  'measurement',
  'metric',
  'schema',
  'server',
  'table',
  'view',
])

export function detailProvidersFromTree(
  roots: readonly DatastoreTreeNodeManifest[],
  options: CreateDatastoreExplorerProviderOptions,
) {
  const providers = new Map<string, DatastoreExplorerDetailProvider>()
  const scopeKinds = new Set([...DEFAULT_SCOPE_KINDS, ...(options.scopeKinds ?? [])])
  const launchKinds = new Set([...DEFAULT_LAUNCH_KINDS, ...(options.launchKinds ?? [])])
  const stateKinds = new Set([...DEFAULT_STATE_KINDS, ...(options.stateKinds ?? [])])

  const visit = (node: DatastoreTreeNodeManifest) => {
    if (!providers.has(node.kind)) {
      providers.set(node.kind, {
        kind: node.kind,
        label: node.label,
        description: node.detail,
        mode: detailMode(node.kind, Boolean(node.children?.length), scopeKinds, launchKinds, stateKinds),
        category: detailCategory(node.kind),
      })
    }
    node.children?.forEach(visit)
  }
  roots.forEach(visit)

  registerExplicitKinds(providers, options.inspectionKinds, 'inspection')
  registerExplicitKinds(providers, options.scopeKinds, 'scope')
  registerExplicitKinds(providers, options.launchKinds, 'launch')
  registerExplicitKinds(providers, options.stateKinds, 'state')

  return Array.from(providers.values())
}

function registerExplicitKinds(
  providers: Map<string, DatastoreExplorerDetailProvider>,
  kinds: readonly string[] | undefined,
  mode: DatastoreExplorerDetailMode,
) {
  for (const kind of kinds ?? []) {
    if (providers.has(kind)) continue
    providers.set(kind, {
      kind,
      label: humanize(kind),
      description: detailDescription(kind),
      mode,
      category: detailCategory(kind),
    })
  }
}

function detailDescription(kind: string) {
  const category = detailCategory(kind)
  if (category === 'security') return 'Effective access and security metadata for the selected object.'
  if (category === 'health') return 'Operational health and diagnostic metadata for the selected object.'
  if (category === 'administration') return 'Administration metadata for the selected object.'
  if (category === 'schema') return 'Structure and access-path metadata for the selected object.'
  if (category === 'data') return 'Bounded datastore-native content for the selected object.'
  return `Datastore-native ${humanize(kind).toLowerCase()} metadata.`
}

export function unsupportedDetailProvider(
  node: ExplorerNode,
): DatastoreExplorerDetailProvider {
  return {
    kind: node.kind,
    label: 'Unsupported detail',
    description: `No detail provider is registered for ${humanize(node.kind)}.`,
    mode: 'state',
    category: 'overview',
  }
}

export function detailProviderForRuntimeNode(
  declared: DatastoreExplorerDetailProvider | undefined,
  node: ExplorerNode,
) {
  const provider = declared ?? unsupportedDetailProvider(node)
  if (
    provider.mode === 'scope'
    && node.scope
    && INSPECTABLE_SCOPE_KINDS.has(node.kind)
  ) {
    return { ...provider, mode: 'scope-inspection' as const }
  }
  if (
    provider.mode === 'scope'
    && (!node.scope || node.expandable === false)
  ) {
    return { ...provider, mode: 'inspection' as const }
  }
  return provider
}

function detailMode(
  kind: string,
  hasChildren: boolean,
  scopeKinds: ReadonlySet<string>,
  launchKinds: ReadonlySet<string>,
  stateKinds: ReadonlySet<string>,
): DatastoreExplorerDetailMode {
  if (stateKinds.has(kind)) return 'state'
  if (launchKinds.has(kind)) return 'launch'
  if (scopeKinds.has(kind) || hasChildren) return 'scope'
  return 'inspection'
}

export function detailCategory(kind: string): DatastoreExplorerDetailCategory {
  const normalized = kind.toLowerCase()
  if (/(permission|security|role|user|grant|acl|policy|certificate|credential)/.test(normalized)) {
    return 'security'
  }
  if (/(diagnostic|health|stat|metric|capacity|alarm|wait|session|lock|trace|task)/.test(normalized)) {
    return 'health'
  }
  if (/(maintenance|backup|restore|job|schedule|replication|cluster|admin|setting|pragma)/.test(normalized)) {
    return 'administration'
  }
  if (/(schema|column|field|index|constraint|key|type|mapping|validator|pipeline)/.test(normalized)) {
    return 'schema'
  }
  if (/(document|item|row|record|sample|query|aggregation|search|console)/.test(normalized)) {
    return 'data'
  }
  return 'overview'
}

export function buildExplorerTree(
  connection: ConnectionProfile,
  scopes: Record<string, ExplorerResponse>,
): DatastoreExplorerTreeItem[] {
  const responses = orderedScopeResponses(scopes)
  const nodes = new Map<string, ExplorerNode>()
  for (const response of responses) {
    for (const node of response.nodes) {
      nodes.set(node.id, node)
    }
  }

  const roots: DatastoreExplorerTreeItem[] = []
  const itemsByPath = new Map<string, DatastoreExplorerTreeItem>()

  for (const node of nodes.values()) {
    const parentSegments = normalizeExplorerPath(connection, node.path)
    let siblings = roots
    const consumed: string[] = []

    for (const segment of parentSegments) {
      consumed.push(segment)
      const key = treePathKey(consumed)
      let item = itemsByPath.get(key)
      if (!item) {
        item = {
          id: `explorer-group:${connection.engine}:${key}`,
          label: segment,
          kind: syntheticKind(segment),
          path: consumed.slice(0, -1),
          children: [],
          synthetic: true,
        }
        siblings.push(item)
        itemsByPath.set(key, item)
      }
      siblings = item.children
    }

    const nodePath = [...parentSegments, node.label]
    const nodeKey = treePathKey(nodePath)
    const existing = itemsByPath.get(nodeKey)
    if (existing?.synthetic) {
      existing.id = node.id
      existing.kind = node.kind
      existing.detail = node.detail
      existing.node = node
      existing.synthetic = false
      continue
    }

    const item: DatastoreExplorerTreeItem = {
      id: node.id,
      label: node.label,
      kind: node.kind,
      detail: node.detail,
      node,
      path: parentSegments,
      children: [],
      synthetic: false,
    }
    siblings.push(item)
    itemsByPath.set(nodeKey, item)
  }

  return roots
}

function orderedScopeResponses(scopes: Record<string, ExplorerResponse>) {
  const root = scopes[explorerScopeKey(undefined)]
  return [
    ...(root ? [root] : []),
    ...Object.entries(scopes)
      .filter(([key]) => key !== explorerScopeKey(undefined))
      .map(([, response]) => response),
  ]
}

function normalizeExplorerPath(connection: ConnectionProfile, path?: string[]) {
  const segments = (path ?? [])
    .map((segment) => segment.trim())
    .filter(Boolean)
  while (
    segments.length
    && (
      segments[0]!.toLowerCase() === connection.name.toLowerCase()
      || segments[0]!.toLowerCase() === connection.engine.toLowerCase()
    )
  ) {
    segments.shift()
  }
  return segments.filter((segment, index) => index === 0 || segment !== segments[index - 1])
}

function treePathKey(path: readonly string[]) {
  return path.join('\u001f')
}

function syntheticKind(label: string) {
  const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return value || 'group'
}

export function filterExplorerTree(
  items: readonly DatastoreExplorerTreeItem[],
  filter: string,
): DatastoreExplorerTreeItem[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return items.slice()

  return items.flatMap((item) => {
    const children = filterExplorerTree(item.children, filter)
    const matches = `${item.label} ${item.kind} ${item.detail ?? ''}`.toLowerCase().includes(needle)
    if (!matches && children.length === 0) return []
    return [{ ...item, children }]
  })
}

export function explorerScopeResponse(
  scopes: Record<string, ExplorerResponse>,
  scope?: string,
) {
  return scopes[explorerScopeKey(scope)]
}

export function humanize(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function isSensitiveMetadataKey(key: string) {
  return /(password|passwd|secret|token|credential|private.?key|access.?key|connection.?string)/i.test(key)
}
