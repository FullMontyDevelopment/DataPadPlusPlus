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

const MAX_TAGS = 32
const MAX_TAG_LENGTH = 80
const MAX_ENVIRONMENT_VARIABLES = 256
const MAX_TAB_REORDER_ITEMS = 200
const QUERY_VIEW_MODES = new Set<QueryViewMode>(['builder', 'raw', 'script'])
const ENVIRONMENT_RISKS = new Set(['low', 'medium', 'high', 'critical'])

export function validateConnectionProfile(profile: ConnectionProfile): ConnectionProfile {
  validateRequiredId(profile.id, 'Connection id')
  validateRequiredText(profile.name, 'Connection name', MAX_OBJECT_NAME_LENGTH)
  validateRequiredId(profile.engine, 'Datastore engine')
  validateRequiredId(profile.family, 'Datastore family')
  validateOptionalText(profile.host, 'Connection host', MAX_SCOPE_LENGTH)
  validateOptionalText(profile.database, 'Connection database', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(profile.connectionMode, 'Connection mode', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(profile.group, 'Connection group', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(profile.notes, 'Connection notes', MAX_SCOPE_LENGTH)
  validateOptionalText(profile.icon, 'Connection icon', 80)
  validateOptionalText(profile.color, 'Connection color', 80)
  validatePort(profile.port)

  const connectionString = profile.connectionString?.trim()
  if (connectionString) {
    validateOptionalText(connectionString, 'Connection string', MAX_SCOPE_LENGTH)
    if (connectionStringContainsPlainSecret(connectionString)) {
      throw new Error(
        'Connection strings with embedded passwords, tokens, or keys are not saved. Use credential fields or environment secret variables.',
      )
    }
  }

  validateConnectionAuth(profile.auth)
  return {
    ...profile,
    name: profile.name.trim(),
    host: profile.host.trim(),
    database: profile.database?.trim() || undefined,
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
  if (request.secret !== undefined) {
    validateQueryText(request.secret, 'Connection secret')
  }
  return { ...request, profile }
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
  validatePath(target.path ?? [], 'Scoped query target path')
  validateOptionalText(target.scope, 'Scoped query target scope', MAX_SCOPE_LENGTH)
  validateOptionalText(target.preferredBuilder, 'Scoped query target builder', 80)
  if (target.queryTemplate !== undefined) {
    validateQueryText(target.queryTemplate, 'Scoped query template')
  }
  return {
    ...target,
    kind: target.kind.trim(),
    label: target.label.trim(),
  }
}

function validateQueryViewMode(mode: QueryViewMode | undefined) {
  if (mode !== undefined && !QUERY_VIEW_MODES.has(mode)) {
    throw new Error(`Unsupported query view mode: ${mode}.`)
  }
}

function validateConnectionAuth(auth: ConnectionProfile['auth']) {
  validateOptionalText(auth?.username, 'Connection username', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(auth?.authMechanism, 'Connection auth mechanism', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(auth?.sslMode, 'Connection SSL mode', 80)
  validateOptionalText(auth?.cloudProvider, 'Connection cloud provider', 80)
  validateOptionalText(auth?.principal, 'Connection principal', MAX_OBJECT_NAME_LENGTH)
  if (auth?.secretRef) {
    validateSecretRef(auth.secretRef, 'Connection secret')
  }
}

function validateSecretRef(secretRef: SecretRef, label: string): SecretRef {
  validateRequiredId(secretRef.id, `${label} id`)
  validateRequiredText(secretRef.provider, `${label} provider`, 80)
  validateRequiredText(secretRef.service, `${label} service`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.account, `${label} account`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.label, `${label} label`, MAX_OBJECT_NAME_LENGTH)
  return secretRef
}

function validatePort(port: number | undefined) {
  if (port === undefined) {
    return
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Connection port must be an integer between 0 and 65535.')
  }
}

function normalizeIds(values: string[], label: string) {
  const seen = new Set<string>()
  return values.map((value) => {
    const id = value.trim()
    validateRequiredId(id, label)
    if (seen.has(id)) {
      throw new Error(`${label} is duplicated: ${id}.`)
    }
    seen.add(id)
    return id
  })
}

function normalizeTags(tags: string[]) {
  if (tags.length > MAX_TAGS) {
    throw new Error(`Profiles may include at most ${MAX_TAGS} tags.`)
  }
  return tags.map((tag) => {
    const normalized = tag.trim()
    validateOptionalText(normalized, 'Profile tag', MAX_TAG_LENGTH)
    return normalized
  }).filter(Boolean)
}
