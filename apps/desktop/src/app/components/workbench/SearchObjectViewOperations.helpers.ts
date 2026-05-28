import type {
  ConnectionProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { SearchWorkflowIconName } from './SearchObjectViewWorkflows'

type JsonRecord = Record<string, unknown>

export type SearchOperationAction = {
  label: string
  title: string
  icon: SearchWorkflowIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

export function searchOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): SearchOperationAction[] {
  const supported = supportedSearchOperations(connection)
  const objectName = searchOperationObjectName(tab, payload)
  const actions: SearchOperationAction[] = []

  if (!objectName) {
    return actions
  }

  const queryable = ['index', 'indices', 'documents', 'data-stream', 'data-streams', 'alias'].includes(kind)
  const indexLike = ['index', 'indices', 'mappings', 'settings', 'aliases', 'alias', 'templates', 'index-template', 'component-template'].includes(kind)
  const securityLike = ['security', 'users', 'roles', 'api-keys'].includes(kind)
  const backupLike = ['cluster', 'diagnostics', 'snapshots'].includes(kind)
  const templateLike = ['templates', 'index-template', 'component-template'].includes(kind)
  const pipelineLike = ['pipelines', 'pipeline'].includes(kind)
  const lifecycleLike = ['index', 'indices', 'data-stream', 'data-streams', 'diagnostics', 'lifecycle-policies'].includes(kind)
  const baseParameters = searchOperationParameters(tab, payload, objectName)

  if (queryable && supported.has('explain')) {
    actions.push(action(connection, 'query.explain', 'Explain', 'Preview search explanation', 'job', objectName, baseParameters))
  }

  if (queryable && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Profile Query DSL execution', 'job', objectName, baseParameters))
  }

  if (indexLike && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Create Index', 'Prepare an index creation plan', 'index', objectName, {
      ...baseParameters,
      settings: { number_of_shards: 1, number_of_replicas: 1 },
      mappings: { properties: {} },
    }))
  }

  if (['index', 'indices'].includes(kind) && supported.has('index')) {
    actions.push(action(connection, 'index.refresh', 'Refresh Index', 'Prepare a refresh request for this index', 'index', objectName, baseParameters))
    actions.push(action(connection, 'index.put-mapping', 'Update Mapping', 'Prepare a guarded mapping update', 'search', objectName, {
      ...baseParameters,
      mappings: { properties: { new_field: { type: 'keyword' } } },
    }))
    actions.push(action(connection, 'index.update-settings', 'Update Settings', 'Prepare a guarded settings update', 'job', objectName, {
      ...baseParameters,
      settings: { index: { refresh_interval: '1s' } },
    }))
    actions.push(action(connection, 'index.drop', 'Delete Index', 'Prepare a guarded index deletion plan', 'index', objectName, baseParameters))
  }

  if (['mappings', 'mapping'].includes(kind) && supported.has('index')) {
    actions.push(action(connection, 'index.put-mapping', 'Update Mapping', 'Prepare a guarded mapping update', 'search', objectName, {
      ...baseParameters,
      mappings: { properties: { new_field: { type: 'keyword' } } },
    }))
  }

  if (kind === 'settings' && supported.has('index')) {
    actions.push(action(connection, 'index.update-settings', 'Update Settings', 'Prepare a guarded settings update', 'job', objectName, {
      ...baseParameters,
      settings: { index: { refresh_interval: '1s' } },
    }))
  }

  if (['aliases', 'alias', 'index', 'indices'].includes(kind) && supported.has('index')) {
    actions.push(action(connection, 'alias.put', 'Add Alias', 'Prepare an alias add/update request', 'search', objectName, {
      ...baseParameters,
      alias: payload.alias ?? `${objectName}-read`,
    }))
    if (kind === 'alias') {
      actions.push(action(connection, 'alias.delete', 'Remove Alias', 'Prepare a guarded alias removal request', 'search', objectName, {
        ...baseParameters,
        alias: payload.alias ?? objectName,
      }))
    }
  }

  if (lifecycleLike && supported.has('profile')) {
    actions.push(action(connection, 'lifecycle.explain', 'Lifecycle', 'Review lifecycle or state-management status', 'job', objectName, baseParameters))
  }

  if (kind === 'data-stream' && supported.has('index')) {
    actions.push(action(connection, 'data-stream.rollover', 'Rollover', 'Prepare a guarded data stream rollover', 'index', objectName, baseParameters))
  }

  if (securityLike && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Security', 'Review users, roles, and privileges', 'security', objectName, baseParameters))
  }

  if (templateLike && supported.has('index')) {
    actions.push(action(connection, 'template.create', 'Create Template', 'Prepare an index or component template update', 'index', objectName, {
      ...baseParameters,
      indexPatterns: [`${objectName}-*`],
      template: { settings: { number_of_shards: 1 }, mappings: { properties: {} } },
    }))
  }

  if (pipelineLike && supported.has('index')) {
    actions.push(action(connection, 'pipeline.simulate', 'Simulate', 'Prepare an ingest pipeline simulation', 'job', objectName, {
      ...baseParameters,
      documents: [{ _source: { message: 'sample' } }],
    }))
  }

  if ((queryable || indexLike) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Bulk', 'Prepare bulk import or export', 'search', objectName, {
      ...baseParameters,
      mode: 'export',
      format: 'ndjson',
    }))
  }

  if (backupLike && supported.has('backupRestore')) {
    actions.push(action(connection, 'data.backup-restore', 'Snapshot', 'Prepare snapshot or restore workflow', 'job', objectName, {
      ...baseParameters,
      mode: 'snapshot',
    }))
  }

  return dedupeActions(actions).slice(0, 10)
}

export function searchOperationObjectName(tab: QueryTabState, payload: JsonRecord) {
  return stringValue(
    payload.index ??
      payload.objectName ??
      payload.name ??
      payload.alias ??
      payload.dataStream ??
      payload.template ??
      tab.objectViewState?.label,
  )
}

function supportedSearchOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_explain_plan')) {
    supported.add('explain')
  }
  if (capabilities.has('supports_query_profile')) {
    supported.add('profile')
  }
  if (capabilities.has('supports_index_management')) {
    supported.add('index')
  }
  if (capabilities.has('supports_permission_inspection')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }
  if (capabilities.has('supports_backup_restore')) {
    supported.add('backupRestore')
  }

  return supported
}

function searchOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  objectName: string,
) {
  return {
    index: objectName,
    objectKind: tab.objectViewState?.kind,
    query: payload.query ?? { match_all: {} },
    size: payload.size ?? 20,
  }
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: SearchWorkflowIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): SearchOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeActions(actions: SearchOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
