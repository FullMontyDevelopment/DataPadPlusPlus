import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../app/state/helpers'

export function searchOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const index = encodeSearchPathSegment(String(request.objectName ?? parameters.index ?? '<index>'))

  if (request.operationId.endsWith('query.explain')) {
    return searchRequest('POST', `/${index}/_search`, {
      explain: true,
      query: parameters.query ?? { match_all: {} },
      size: parameters.size ?? 20,
    })
  }

  if (request.operationId.endsWith('query.profile')) {
    return searchRequest('POST', `/${index}/_search`, {
      profile: true,
      query: parameters.query ?? { match_all: {} },
      size: parameters.size ?? 20,
    })
  }

  if (request.operationId.endsWith('index.create')) {
    return searchRequest('PUT', `/${index}`, {
      settings: parameters.settings ?? { number_of_shards: 1, number_of_replicas: 1 },
      mappings: parameters.mappings ?? { properties: {} },
    })
  }

  if (request.operationId.endsWith('index.refresh')) {
    return searchRequest('POST', `/${index}/_refresh`, undefined)
  }

  if (request.operationId.endsWith('index.force-merge')) {
    return searchRequest('POST', `/${index}/_forcemerge`, {
      max_num_segments: parameters.maxNumSegments ?? 1,
      only_expunge_deletes: parameters.onlyExpungeDeletes ?? false,
    })
  }

  if (request.operationId.endsWith('index.clear-cache')) {
    return searchRequest('POST', `/${index}/_cache/clear`, {
      query: parameters.queryCache ?? true,
      request: parameters.requestCache ?? true,
      fielddata: parameters.fielddataCache ?? false,
    })
  }

  if (request.operationId.endsWith('index.reindex')) {
    return searchRequest('POST', '/_reindex', {
      source: {
        index: String(request.objectName ?? parameters.index ?? '<index>'),
        query: parameters.query ?? { match_all: {} },
      },
      dest: {
        index: String(parameters.destinationIndex ?? `${request.objectName ?? '<index>'}-reindexed`),
      },
      conflicts: parameters.conflicts ?? 'proceed',
    })
  }

  if (request.operationId.endsWith('index.close')) {
    return searchRequest('POST', `/${index}/_close`, undefined)
  }

  if (request.operationId.endsWith('index.open')) {
    return searchRequest('POST', `/${index}/_open`, undefined)
  }

  if (request.operationId.endsWith('index.put-mapping')) {
    return searchRequest('PUT', `/${index}/_mapping`, parameters.mappings ?? {
      properties: {
        new_field: { type: 'keyword' },
      },
    })
  }

  if (request.operationId.endsWith('index.update-settings')) {
    return searchRequest('PUT', `/${index}/_settings`, parameters.settings ?? {
      index: {
        refresh_interval: '1s',
      },
    })
  }

  if (request.operationId.endsWith('index.drop')) {
    return searchRequest('DELETE', `/${index}`, undefined)
  }

  if (request.operationId.endsWith('alias.put')) {
    const alias = String(parameters.alias ?? `${request.objectName ?? '<index>'}-read`)
    return searchRequest('POST', '/_aliases', {
      actions: [
        {
          add: {
            index: String(request.objectName ?? parameters.index ?? '<index>'),
            alias,
          },
        },
      ],
    })
  }

  if (request.operationId.endsWith('alias.delete')) {
    const alias = String(parameters.alias ?? request.objectName ?? '<alias>')
    return searchRequest('POST', '/_aliases', {
      actions: [
        {
          remove: {
            index: String(parameters.index ?? '*'),
            alias,
          },
        },
      ],
    })
  }

  if (request.operationId.endsWith('lifecycle.explain')) {
    return connection.engine === 'opensearch'
      ? searchRequest('GET', `/_plugins/_ism/explain/${index}`, undefined)
      : searchRequest('GET', `/${index}/_ilm/explain`, undefined)
  }

  if (request.operationId.endsWith('data-stream.rollover')) {
    return searchRequest('POST', `/${index}/_rollover`, parameters.conditions ?? {
      conditions: {
        max_age: '30d',
        max_primary_shard_size: '50gb',
      },
    })
  }

  if (request.operationId.endsWith('template.create')) {
    const templateName = String(request.objectName ?? parameters.templateName ?? '<template>')
    const objectKind = String(parameters.objectKind ?? '')
    const path = objectKind === 'component-template' || parameters.templateType === 'component'
      ? `/_component_template/${encodeSearchPathSegment(templateName)}`
      : `/_index_template/${encodeSearchPathSegment(templateName)}`
    return searchRequest('PUT', path, {
      index_patterns: parameters.indexPatterns ?? [`${templateName}-*`],
      template: parameters.template ?? {
        settings: { number_of_shards: 1 },
        mappings: { properties: {} },
      },
      priority: parameters.priority ?? 100,
    })
  }

  if (request.operationId.endsWith('template.delete')) {
    const templateName = String(request.objectName ?? parameters.templateName ?? '<template>')
    const objectKind = String(parameters.objectKind ?? '')
    const path = objectKind === 'component-template' || parameters.templateType === 'component'
      ? `/_component_template/${encodeSearchPathSegment(templateName)}`
      : `/_index_template/${encodeSearchPathSegment(templateName)}`
    return searchRequest('DELETE', path, undefined)
  }

  if (request.operationId.endsWith('pipeline.put')) {
    return searchRequest('PUT', `/_ingest/pipeline/${index}`, {
      description: parameters.description ?? 'DataPad++ pipeline preview',
      processors: parameters.processors ?? [{ set: { field: 'processed_at', value: '{{_ingest.timestamp}}' } }],
      on_failure: parameters.onFailure ?? [],
    })
  }

  if (request.operationId.endsWith('pipeline.simulate')) {
    return searchRequest('POST', `/_ingest/pipeline/${index}/_simulate`, {
      docs: parameters.documents ?? [],
    })
  }

  if (request.operationId.endsWith('lifecycle.put')) {
    const policyName = String(request.objectName ?? parameters.policyName ?? '<policy>')
    return connection.engine === 'opensearch'
      ? searchRequest('PUT', `/_plugins/_ism/policies/${encodeSearchPathSegment(policyName)}`, parameters.policy ?? {
        policy: { description: 'DataPad++ preview policy', states: [] },
      })
      : searchRequest('PUT', `/_ilm/policy/${encodeSearchPathSegment(policyName)}`, parameters.policy ?? {
        policy: { phases: { hot: { actions: {} } } },
      })
  }

  if (request.operationId.endsWith('task.cancel')) {
    const taskId = encodeSearchPathSegment(String(parameters.taskId ?? request.objectName ?? '<task-id>'))
    return searchRequest('POST', `/_tasks/${taskId}/_cancel`, undefined)
  }

  if (request.operationId.endsWith('snapshot.restore')) {
    const repository = encodeSearchPathSegment(String(parameters.repository ?? '<repository>'))
    const snapshot = encodeSearchPathSegment(String(parameters.snapshot ?? request.objectName ?? '<snapshot>'))
    return searchRequest('POST', `/_snapshot/${repository}/${snapshot}/_restore`, {
      indices: parameters.indices ?? '*',
      include_global_state: parameters.includeGlobalState ?? false,
      rename_pattern: parameters.renamePattern ?? undefined,
      rename_replacement: parameters.renameReplacement ?? undefined,
    })
  }

  if (request.operationId.endsWith('security.inspect')) {
    return connection.engine === 'opensearch'
      ? searchRequest('GET', '/_plugins/_security/api/roles', undefined)
      : searchRequest('GET', '/_security/role', undefined)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return searchRequest('POST', `/${index}/_search`, {
      query: parameters.query ?? { match_all: {} },
      size: 1000,
      sort: ['_doc'],
      format: parameters.format ?? 'ndjson',
    })
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    return searchRequest('PUT', '/_snapshot/<repository>/<snapshot>', {
      indices: request.objectName ?? '*',
      include_global_state: false,
    })
  }

  if (request.objectName) {
    return searchRequest('POST', `/${index}/_search`, {
      query: { match_all: {} },
      size: 20,
    })
  }

  return defaultQueryTextForConnection(connection)
}

function searchRequest(method: string, path: string, body: unknown) {
  return JSON.stringify({
    method,
    path,
    ...(body === undefined ? {} : { body }),
  }, null, 2)
}

function encodeSearchPathSegment(value: string) {
  if (value.startsWith('<') && value.endsWith('>')) {
    return value
  }

  return encodeURIComponent(value).replace(/%2A/gi, '*')
}
