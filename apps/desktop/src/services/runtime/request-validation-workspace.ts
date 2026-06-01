import type {
  CancelTestRunRequest,
  ConnectionProfile,
  ConnectionTestRequest,
  CreateScopedQueryTabRequest,
  CreateTestSuiteTabRequest,
  EnvironmentProfile,
  ExecuteTestSuiteRequest,
  OpenTestSuiteTemplateRequest,
  QueryTabReorderRequest,
  QueryViewMode,
  SecretRef,
  ScopedQueryTarget,
  UpdateQueryBuilderStateRequest,
  UpdateTestSuiteTabRequest,
} from '@datapadplusplus/shared-types'
import {
  isValidVariableName,
  normalizeVariableName,
} from '../../app/state/environment-variables'
import { connectionStringContainsPlainSecret } from '../../app/state/security-redaction'
import {
  assertJsonSize,
  MAX_ID_LENGTH,
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalId,
  validateOptionalText,
  validatePath,
  validateQueryText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'
import { validateCassandraConnectionOptions } from './request-validation-cassandra'
import { validateCosmosDbConnectionOptions } from './request-validation-cosmosdb'
import { validateDynamoDbConnectionOptions } from './request-validation-dynamodb'
import { validateGraphConnectionOptions } from './request-validation-graph'
import { validateSearchConnectionOptions } from './request-validation-search'
import { validateTimeSeriesConnectionOptions } from './request-validation-timeseries'
import { validateWarehouseConnectionOptions } from './request-validation-warehouse'

const MAX_TAGS = 32
const MAX_TAG_LENGTH = 80
const MAX_ENVIRONMENT_VARIABLES = 256
const MAX_TAB_REORDER_ITEMS = 200
const QUERY_VIEW_MODES = new Set<QueryViewMode>(['builder', 'raw', 'script'])
const ENVIRONMENT_RISKS = new Set(['low', 'medium', 'high', 'critical'])

export function validateConnectionProfile(profile: ConnectionProfile): ConnectionProfile {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Connection profile is required.')
  }
  validateRequiredId(profile.id, 'Connection id')
  validateRequiredText(profile.name, 'Connection name', MAX_OBJECT_NAME_LENGTH)
  validateRequiredId(profile.engine, 'Datastore engine')
  validateRequiredId(profile.family, 'Datastore family')
  const host = validateOptionalText(profile.host, 'Connection host', MAX_SCOPE_LENGTH)
  const database = validateOptionalText(
    profile.database,
    'Connection database',
    MAX_OBJECT_NAME_LENGTH,
  )
  const connectionMode = validateOptionalText(
    profile.connectionMode,
    'Connection mode',
    MAX_OBJECT_NAME_LENGTH,
  )
  const group = validateOptionalText(profile.group, 'Connection group', MAX_OBJECT_NAME_LENGTH)
  const notes = validateOptionalText(profile.notes, 'Connection notes', MAX_SCOPE_LENGTH)
  const icon = validateOptionalText(profile.icon, 'Connection icon', 80)
  const color = validateOptionalText(profile.color, 'Connection color', 80)
  validatePort(profile.port)

  const connectionString = validateOptionalText(
    profile.connectionString,
    'Connection string',
    MAX_SCOPE_LENGTH,
  )?.trim()
  if (connectionString) {
    if (connectionStringContainsPlainSecret(connectionString)) {
      throw new Error(
        'Connection strings with embedded passwords, tokens, or keys are not saved. Use credential fields or environment secret variables.',
      )
    }
  }

  const auth = validateConnectionAuth(profile.auth)
  return {
    ...profile,
    name: profile.name.trim(),
    host: host?.trim() ?? '',
    database: database?.trim() || undefined,
    connectionMode: connectionMode?.trim() as ConnectionProfile['connectionMode'],
    group: group?.trim() || undefined,
    notes: notes?.trim() || undefined,
    icon: icon?.trim() || 'database',
    color: color?.trim() || undefined,
    auth,
    dynamoDbOptions: validateDynamoDbConnectionOptions(profile.dynamoDbOptions),
    cassandraOptions: validateCassandraConnectionOptions(profile.cassandraOptions),
    cosmosDbOptions: validateCosmosDbConnectionOptions(profile.cosmosDbOptions),
    searchOptions: validateSearchConnectionOptions(profile.searchOptions),
    timeSeriesOptions: validateTimeSeriesConnectionOptions(profile.timeSeriesOptions),
    graphOptions: validateGraphConnectionOptions(profile.graphOptions),
    warehouseOptions: validateWarehouseConnectionOptions(profile.warehouseOptions),
    connectionString,
    environmentIds: normalizeIds(profile.environmentIds, 'Connection environment id'),
    tags: normalizeTags(profile.tags),
  }
}

export function validateConnectionTestRequest(
  request: ConnectionTestRequest,
): ConnectionTestRequest {
  validateRequiredId(request.environmentId, 'Environment id')
  const profile = validateConnectionProfile(request.profile)
  if (request.secret !== undefined && request.secret !== null) {
    validateQueryText(request.secret, 'Connection secret')
  }
  return { ...request, profile, secret: request.secret ?? undefined }
}

export function validateEnvironmentProfile(profile: EnvironmentProfile): EnvironmentProfile {
  validateRequiredId(profile.id, 'Environment id')
  validateRequiredText(profile.label, 'Environment label', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(profile.color, 'Environment color', 80)
  validateOptionalId(profile.inheritsFrom, 'Parent environment id')
  if (!ENVIRONMENT_RISKS.has(profile.risk)) {
    throw new Error(`Unsupported environment risk: ${profile.risk || '(empty)'}.`)
  }

  const variableDefinitions = profile.variableDefinitions ?? []
  if (variableDefinitions.length > MAX_ENVIRONMENT_VARIABLES) {
    throw new Error(`Environments may include at most ${MAX_ENVIRONMENT_VARIABLES} variables.`)
  }

  const seen = new Set<string>()
  const normalizedDefinitions = variableDefinitions.map((definition) => {
    const key = normalizeVariableName(definition.key)
    if (!isValidVariableName(key)) {
      throw new Error(`Environment variable name is invalid: ${definition.key || '(empty)'}.`)
    }
    if (seen.has(key)) {
      throw new Error(`Environment variable is duplicated: ${key}.`)
    }
    seen.add(key)

    if (definition.kind !== 'text' && definition.kind !== 'secret') {
      throw new Error(`Unsupported environment variable type for ${key}: ${definition.kind}.`)
    }

    if (definition.kind === 'secret') {
      if (definition.value) {
        throw new Error(`Secret environment variable ${key} cannot store plaintext values.`)
      }
      return {
        ...definition,
        key,
        value: undefined,
        secretRef: definition.secretRef
          ? validateSecretRef(definition.secretRef, `Secret variable ${key}`)
          : definition.secretRef,
      }
    }

    validateOptionalText(definition.value, `Environment variable ${key}`, MAX_SCOPE_LENGTH)
    return { ...definition, key, kind: 'text' as const }
  })

  return {
    ...profile,
    label: profile.label.trim(),
    variableDefinitions: normalizedDefinitions,
  }
}

export function validateCreateScopedQueryTabRequest(
  request: CreateScopedQueryTabRequest,
): CreateScopedQueryTabRequest {
  validateRequiredId(request.connectionId, 'Connection id')
  validateOptionalId(request.environmentId, 'Environment id')
  return { ...request, target: validateScopedQueryTarget(request.target) }
}

export function validateQueryTabReorderRequest(
  request: QueryTabReorderRequest,
): QueryTabReorderRequest {
  if (request.orderedTabIds.length > MAX_TAB_REORDER_ITEMS) {
    throw new Error(`Tab reorder requests may include at most ${MAX_TAB_REORDER_ITEMS} tabs.`)
  }
  const seen = new Set<string>()
  for (const tabId of request.orderedTabIds) {
    validateRequiredId(tabId, 'Tab id')
    if (seen.has(tabId)) {
      throw new Error(`Tab reorder request contains duplicate tab id: ${tabId}.`)
    }
    seen.add(tabId)
  }
  return request
}

export function validateUpdateQueryTabRequest(
  request: { tabId: string; queryText: string; queryViewMode?: QueryViewMode },
) {
  validateRequiredId(request.tabId, 'Tab id')
  validateQueryText(request.queryText, 'Query text')
  validateQueryViewMode(request.queryViewMode)
  return request
}

export function validateUpdateQueryBuilderStateRequest(
  request: UpdateQueryBuilderStateRequest,
): UpdateQueryBuilderStateRequest {
  validateRequiredId(request.tabId, 'Tab id')
  assertJsonSize(request.builderState, 'Query builder state')
  if (request.queryText !== undefined) {
    validateQueryText(request.queryText, 'Query text')
  }
  validateQueryViewMode(request.queryViewMode)
  return request
}

export function validateCreateTestSuiteTabRequest(
  request: CreateTestSuiteTabRequest,
): CreateTestSuiteTabRequest {
  validateOptionalId(request.connectionId, 'Connection id')
  validateOptionalId(request.environmentId, 'Environment id')
  validateOptionalText(request.templateId, 'Test template id', MAX_ID_LENGTH)
  assertJsonSize(request.suite, 'Test suite definition')
  return request
}

export function validateOpenTestSuiteTemplateRequest(
  request: OpenTestSuiteTemplateRequest,
): OpenTestSuiteTemplateRequest {
  validateOptionalId(request.connectionId, 'Connection id')
  validateOptionalId(request.environmentId, 'Environment id')
  validateRequiredId(request.templateId, 'Test template id')
  return request
}

export function validateUpdateTestSuiteTabRequest(
  request: UpdateTestSuiteTabRequest,
): UpdateTestSuiteTabRequest {
  validateRequiredId(request.tabId, 'Tab id')
  assertJsonSize(request.suite, 'Test suite definition')
  if (request.rawText !== undefined) {
    validateQueryText(request.rawText, 'Test suite JSON')
  }
  return request
}

export function validateExecuteTestSuiteRequest(
  request: ExecuteTestSuiteRequest,
): ExecuteTestSuiteRequest {
  validateRequiredId(request.tabId, 'Tab id')
  validateOptionalId(request.caseId, 'Test case id')
  validateOptionalId(request.confirmedGuardrailId, 'Guardrail confirmation id')
  return request
}

export function validateCancelTestRunRequest(
  request: CancelTestRunRequest,
): CancelTestRunRequest {
  validateRequiredId(request.runId, 'Test run id')
  validateOptionalId(request.tabId, 'Tab id')
  return request
}

function validateScopedQueryTarget(target: ScopedQueryTarget): ScopedQueryTarget {
  validateRequiredText(target.kind, 'Scoped query target kind', 80)
  validateRequiredText(target.label, 'Scoped query target label', MAX_OBJECT_NAME_LENGTH)
  const path = (target as { path?: string[] | null }).path ?? []
  validatePath(path, 'Scoped query target path')
  validateOptionalText(target.scope, 'Scoped query target scope', MAX_SCOPE_LENGTH)
  validateOptionalText(target.preferredBuilder, 'Scoped query target builder', 80)
  if (target.queryTemplate !== undefined) {
    validateQueryText(target.queryTemplate, 'Scoped query template')
  }
  return {
    ...target,
    kind: target.kind.trim(),
    label: target.label.trim(),
    path,
  }
}

function validateQueryViewMode(mode: QueryViewMode | undefined) {
  if (mode !== undefined && !QUERY_VIEW_MODES.has(mode)) {
    throw new Error(`Unsupported query view mode: ${mode}.`)
  }
}

function validateConnectionAuth(
  auth: ConnectionProfile['auth'] | null | undefined,
): ConnectionProfile['auth'] {
  const username = validateOptionalText(
    auth?.username,
    'Connection username',
    MAX_OBJECT_NAME_LENGTH,
  )?.trim()
  const authMechanism = validateOptionalText(
    auth?.authMechanism,
    'Connection auth mechanism',
    MAX_OBJECT_NAME_LENGTH,
  )?.trim()
  const sslMode = validateOptionalText(auth?.sslMode, 'Connection SSL mode', 80)?.trim()
  const cloudProvider = validateOptionalText(
    auth?.cloudProvider,
    'Connection cloud provider',
    80,
  )?.trim()
  const principal = validateOptionalText(
    auth?.principal,
    'Connection principal',
    MAX_OBJECT_NAME_LENGTH,
  )?.trim()
  const secretRef = auth?.secretRef
    ? validateSecretRef(auth.secretRef, 'Connection secret')
    : undefined

  return {
    username: username || undefined,
    authMechanism: authMechanism || undefined,
    sslMode: (sslMode || undefined) as ConnectionProfile['auth']['sslMode'],
    cloudProvider: (cloudProvider || undefined) as ConnectionProfile['auth']['cloudProvider'],
    principal: principal || undefined,
    secretRef,
  }
}

function validateSecretRef(secretRef: SecretRef, label: string): SecretRef {
  if (!secretRef || typeof secretRef !== 'object') {
    throw new Error(`${label} must be a stored credential reference.`)
  }
  validateRequiredId(secretRef.id, `${label} id`)
  validateRequiredText(secretRef.provider, `${label} provider`, 80)
  validateRequiredText(secretRef.service, `${label} service`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.account, `${label} account`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.label, `${label} label`, MAX_OBJECT_NAME_LENGTH)
  return secretRef
}

function validatePort(port: number | null | undefined) {
  if (port === undefined || port === null) {
    return
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Connection port must be an integer between 0 and 65535.')
  }
}

function normalizeIds(values: string[] | null | undefined, label: string) {
  if (values === undefined || values === null) {
    return []
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} list must be an array.`)
  }
  const seen = new Set<string>()
  return values.map((value) => {
    if (typeof value !== 'string') {
      throw new Error(`${label} must be text.`)
    }
    const id = value.trim()
    validateRequiredId(id, label)
    if (seen.has(id)) {
      throw new Error(`${label} is duplicated: ${id}.`)
    }
    seen.add(id)
    return id
  })
}

function normalizeTags(tags: string[] | null | undefined) {
  if (tags === undefined || tags === null) {
    return []
  }
  if (!Array.isArray(tags)) {
    throw new Error('Profile tags must be an array.')
  }
  if (tags.length > MAX_TAGS) {
    throw new Error(`Profiles may include at most ${MAX_TAGS} tags.`)
  }
  return tags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new Error('Profile tag must be text.')
    }
    const normalized = tag.trim()
    validateOptionalText(normalized, 'Profile tag', MAX_TAG_LENGTH)
    return normalized
  }).filter(Boolean)
}
