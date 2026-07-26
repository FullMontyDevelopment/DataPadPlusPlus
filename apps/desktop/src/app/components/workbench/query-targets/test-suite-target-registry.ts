import type {
  ConnectionProfile,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  datastoreTestTargetProviderForConnection,
} from '../../../../services/runtime/datastore-test-target-providers'

export {
  DATASTORE_TEST_TARGET_PROVIDERS,
  datastoreTestStarterQuery,
  datastoreTestTargetProviderForConnection,
  inferredDatastoreTestLanguage,
  validateDatastoreTestTarget,
} from '../../../../services/runtime/datastore-test-target-providers'
export type {
  DatastoreTestTargetProvider,
} from '../../../../services/runtime/datastore-test-target-providers'

export function datastoreTestTargetNodes(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
) {
  const connectionTarget =
    datastoreTestTargetProviderForConnection(connection)?.connectionTarget?.(connection)
  if (
    !connectionTarget ||
    nodes.some((node) => {
      const scopeMatches =
        connectionTarget.scope && node.scope === connectionTarget.scope
      return scopeMatches || (
        normalizeKind(node.kind) === normalizeKind(connectionTarget.kind) &&
        node.label.trim() === connectionTarget.label
      )
    })
  ) {
    return nodes
  }

  return [
    {
      id: `datastore-test-target:${connection.id}:${connectionTarget.scope}`,
      family: connection.family,
      label: connectionTarget.label,
      kind: connectionTarget.kind,
      detail: 'Connection database',
      scope: connectionTarget.scope,
      path: connectionTarget.path,
    },
    ...nodes,
  ]
}

export function datastoreTestTargetBreadcrumb(target?: ScopedQueryTarget) {
  if (!target) {
    return 'Target required'
  }

  return [...(target.path ?? []), target.label]
    .map((part) => part.trim())
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(' / ')
}

function normalizeKind(value: string) {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
}
