import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function cosmosOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const database = stringParameter(parameters, 'database') || '<database>'
  const container = stringParameter(parameters, 'container') || stringParameter(parameters, 'collection') || '<container>'
  const objectKind = stringParameter(parameters, 'objectKind') || 'container'
  const objectName = request.objectName || `${database}/${container}`

  if (request.operationId.endsWith('query.profile')) {
    return JSON.stringify({
      method: 'POST',
      path: `/dbs/${database}/colls/${container}/docs`,
      headers: {
        'x-ms-documentdb-isquery': true,
        'x-ms-documentdb-populatequerymetrics': true,
      },
      body: {
        query: stringParameter(parameters, 'query') || 'select * from c where c.id != null',
        parameters: [],
      },
    }, null, 2)
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return JSON.stringify({
      operation: 'AzureMonitor.ListMetrics',
      scope: objectName,
      metrics: [
        'TotalRequestUnits',
        'NormalizedRUConsumption',
        'ThrottledRequests',
        'ServerSideLatency',
        'DataUsage',
      ],
      granularity: 'PT5M',
    }, null, 2)
  }

  if (request.operationId.endsWith('security.inspect')) {
    return JSON.stringify({
      operation: 'CosmosDB.ReadAccessModel',
      scope: objectName,
      checks: [
        'sqlRoleDefinitions',
        'sqlRoleAssignments',
        'networkAclBypass',
        'publicNetworkAccess',
      ],
    }, null, 2)
  }

  if (request.operationId.endsWith('index.create')) {
    return JSON.stringify({
      method: 'PATCH',
      path: `/dbs/${database}/colls/${container}`,
      body: {
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [{ path: stringParameter(parameters, 'path') || '/*' }],
          excludedPaths: [{ path: '/"_etag"/?' }],
        },
        validation: 'replace-policy-after-diff-preview',
      },
    }, null, 2)
  }

  if (request.operationId.endsWith('throughput.update')) {
    const mode = stringParameter(parameters, 'mode') || 'autoscale'
    return JSON.stringify({
      operation: 'CosmosDB.ReplaceOffer',
      scope: objectKind === 'database' ? `/dbs/${database}` : `/dbs/${database}/colls/${container}`,
      throughputParameters: mode === 'autoscale'
        ? {
            autoscaleSettings: {
              maxThroughput: numberParameter(parameters, 'maxRuPerSecond') || 4000,
            },
          }
        : {
            throughput: numberParameter(parameters, 'ruPerSecond') || 1000,
          },
      preflight: ['ReadOffer', 'EstimateMonthlyCost', 'CheckThrottledRequests'],
    }, null, 2)
  }

  if (request.operationId.endsWith('consistency.update')) {
    return JSON.stringify({
      operation: 'CosmosDB.UpdateAccountConsistency',
      account: stringParameter(parameters, 'account') || '<account>',
      consistencyPolicy: {
        defaultConsistencyLevel: stringParameter(parameters, 'consistencyLevel') || 'Session',
      },
      preflight: ['ReadAccount', 'CheckMultiRegionWrites'],
    }, null, 2)
  }

  if (request.operationId.endsWith('regions.failover')) {
    return JSON.stringify({
      operation: 'CosmosDB.FailoverPriorityChange',
      account: stringParameter(parameters, 'account') || '<account>',
      writeRegion: stringParameter(parameters, 'writeRegion') || '<write-region>',
      failoverPolicies: [
        { locationName: stringParameter(parameters, 'writeRegion') || '<write-region>', failoverPriority: 0 },
      ],
      preflight: ['ReadAccount', 'CheckRegionalAvailability', 'ConfirmApplicationImpact'],
    }, null, 2)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return JSON.stringify({
      operation: 'CosmosDB.ExportItems',
      database,
      container,
      format: stringParameter(parameters, 'format') || 'json',
      mode: stringParameter(parameters, 'mode') || 'export',
      partitionKey: stringParameter(parameters, 'partitionKey') || '<all-partitions>',
      consistency: 'session',
    }, null, 2)
  }

  if (request.operationId.endsWith('object.drop')) {
    return JSON.stringify({
      method: 'DELETE',
      path: cosmosDropPath(objectKind, database, container),
      preflight: ['read-throughput', 'check-change-feed-lag', 'verify-rbac-scope'],
    }, null, 2)
  }

  return JSON.stringify({ operation: request.operationId, database, container, parameters }, null, 2)
}

function cosmosDropPath(objectKind: string, database: string, container: string) {
  if (objectKind === 'database') {
    return `/dbs/${database}`
  }

  if (['stored-procedures', 'triggers', 'udfs'].includes(objectKind)) {
    return `/dbs/${database}/colls/${container}/${objectKind}/<script-id>`
  }

  return `/dbs/${database}/colls/${container}`
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}
