import type {
  AdapterDiagnostics,
  ConnectionTestResult,
  DataEditExecutionResponse,
  DataEditPlanResponse,
  ExecutionResultEnvelope,
  ExplorerInspectResponse,
  ExplorerResponse,
  OperationExecutionResponse,
  OperationPlanResponse,
  RedisKeyScanResponse,
  ResolvedEnvironment,
  ResultPageResponse,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { redactSensitiveText } from '../../app/state/security-redaction'

const SECRET_REPLACEMENT = '********'

export function redactForEnvironment<T>(value: T, environment: ResolvedEnvironment): T {
  return redactUnknown(value, secretValues(environment)) as T
}

export function redactExecutionResultForEnvironment(
  result: ExecutionResultEnvelope | undefined,
  environment: ResolvedEnvironment,
) {
  return result ? redactForEnvironment(result, environment) : undefined
}

export function redactResultPageForEnvironment(
  response: ResultPageResponse,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(response, environment)
}

export function redactConnectionTestForEnvironment(
  response: ConnectionTestResult,
  environment: ResolvedEnvironment,
  extraSecretValues: unknown[] = [],
): ConnectionTestResult {
  const secrets = normalizeSecretValues([
    ...secretValues(environment),
    ...extraSecretValues,
  ])

  return {
    ...response,
    message: redactRuntimeString(response.message, secrets),
    warnings: response.warnings.map((warning) => redactRuntimeString(warning, secrets)),
    resolvedHost: redactRuntimeString(response.resolvedHost, secrets),
    resolvedDatabase: response.resolvedDatabase
      ? redactRuntimeString(response.resolvedDatabase, secrets)
      : undefined,
  }
}

export function redactExplorerResponseForEnvironment(
  response: ExplorerResponse,
  environment: ResolvedEnvironment,
): ExplorerResponse {
  return {
    ...response,
    summary: redactTextForEnvironment(response.summary, environment),
    nodes: response.nodes.map((node) => ({
      ...node,
      label: redactTextForEnvironment(node.label, environment),
      detail: redactTextForEnvironment(node.detail, environment),
      path: node.path?.map((part) => redactTextForEnvironment(part, environment)),
      queryTemplate: node.queryTemplate
        ? redactTextForEnvironment(node.queryTemplate, environment)
        : undefined,
    })),
  }
}

export function redactExplorerInspectForEnvironment(
  response: ExplorerInspectResponse,
  environment: ResolvedEnvironment,
): ExplorerInspectResponse {
  return {
    ...response,
    summary: redactTextForEnvironment(response.summary, environment),
    queryTemplate: response.queryTemplate
      ? redactTextForEnvironment(response.queryTemplate, environment)
      : undefined,
    payload: response.payload ? redactForEnvironment(response.payload, environment) : undefined,
  }
}

export function redactStructureResponseForEnvironment(
  response: StructureResponse,
  environment: ResolvedEnvironment,
): StructureResponse {
  return {
    ...response,
    summary: redactTextForEnvironment(response.summary, environment),
    nextCursor: response.nextCursor
      ? redactTextForEnvironment(response.nextCursor, environment)
      : undefined,
    groups: response.groups.map((group) => ({
      ...group,
      label: redactTextForEnvironment(group.label, environment),
      detail: group.detail ? redactTextForEnvironment(group.detail, environment) : undefined,
    })),
    nodes: response.nodes.map((node) => ({
      ...node,
      label: redactTextForEnvironment(node.label, environment),
      detail: node.detail ? redactTextForEnvironment(node.detail, environment) : undefined,
      database: node.database ? redactTextForEnvironment(node.database, environment) : undefined,
      schema: node.schema ? redactTextForEnvironment(node.schema, environment) : undefined,
      objectName: node.objectName ? redactTextForEnvironment(node.objectName, environment) : undefined,
      qualifiedName: node.qualifiedName
        ? redactTextForEnvironment(node.qualifiedName, environment)
        : undefined,
      metrics: node.metrics?.map((metric) => redactStructureMetric(metric, environment)),
      fields: node.fields?.map((field) => ({
        ...field,
        name: redactTextForEnvironment(field.name, environment),
        dataType: redactTextForEnvironment(field.dataType, environment),
        detail: field.detail ? redactTextForEnvironment(field.detail, environment) : undefined,
      })),
      sample: node.sample ? redactForEnvironment(node.sample, environment) : undefined,
    })),
    edges: response.edges.map((edge) => ({
      ...edge,
      label: redactTextForEnvironment(edge.label, environment),
      fromField: edge.fromField ? redactTextForEnvironment(edge.fromField, environment) : undefined,
      toField: edge.toField ? redactTextForEnvironment(edge.toField, environment) : undefined,
      constraintName: edge.constraintName
        ? redactTextForEnvironment(edge.constraintName, environment)
        : undefined,
      cardinality: edge.cardinality
        ? redactTextForEnvironment(edge.cardinality, environment)
        : undefined,
      deleteRule: edge.deleteRule ? redactTextForEnvironment(edge.deleteRule, environment) : undefined,
      updateRule: edge.updateRule ? redactTextForEnvironment(edge.updateRule, environment) : undefined,
    })),
    metrics: response.metrics.map((metric) => redactStructureMetric(metric, environment)),
  }
}

export function redactRedisKeyScanForEnvironment(
  response: RedisKeyScanResponse,
  environment: ResolvedEnvironment,
): RedisKeyScanResponse {
  return {
    ...response,
    cursor: redactTextForEnvironment(response.cursor, environment),
    nextCursor: response.nextCursor
      ? redactTextForEnvironment(response.nextCursor, environment)
      : undefined,
    moduleTypes: response.moduleTypes.map((value) => redactTextForEnvironment(value, environment)),
    warnings: response.warnings.map((value) => redactTextForEnvironment(value, environment)),
    keys: response.keys.map((key) => ({
      ...key,
      key: redactTextForEnvironment(key.key, environment),
      type: redactTextForEnvironment(key.type, environment),
      ttlLabel: key.ttlLabel ? redactTextForEnvironment(key.ttlLabel, environment) : undefined,
      memoryUsageLabel: key.memoryUsageLabel
        ? redactTextForEnvironment(key.memoryUsageLabel, environment)
        : undefined,
      encoding: key.encoding ? redactTextForEnvironment(key.encoding, environment) : undefined,
    })),
  }
}

export function redactOperationPlanForEnvironment(
  response: OperationPlanResponse,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(response, environment)
}

export function redactOperationResponseForEnvironment(
  response: OperationExecutionResponse,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(response, environment)
}

export function redactDataEditPlanForEnvironment(
  response: DataEditPlanResponse,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(response, environment)
}

export function redactDataEditResponseForEnvironment(
  response: DataEditExecutionResponse,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(response, environment)
}

export function redactDiagnosticsForEnvironment(
  diagnostics: AdapterDiagnostics,
  environment: ResolvedEnvironment,
) {
  return redactForEnvironment(diagnostics, environment)
}

function secretValues(environment: ResolvedEnvironment) {
  return normalizeSecretValues(
    environment.sensitiveKeys.map((key) => environment.variables[key]),
  )
}

function normalizeSecretValues(values: unknown[]) {
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
}

function redactTextForEnvironment(value: string, environment: ResolvedEnvironment) {
  return redactRuntimeString(value, secretValues(environment))
}

function redactStructureMetric(
  metric: { label: string; value: string },
  environment: ResolvedEnvironment,
) {
  return {
    ...metric,
    label: redactTextForEnvironment(metric.label, environment),
    value: redactTextForEnvironment(metric.value, environment),
  }
}

function redactUnknown(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    return redactRuntimeString(value, secrets)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, secrets))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSecretLikePayloadKey(key)
          ? SECRET_REPLACEMENT
          : redactUnknown(child, secrets),
      ]),
    )
  }

  return value
}

function redactRuntimeString(value: string, secrets: string[]) {
  return secrets.reduce(
    (redacted, secret) =>
      secret.length >= 3 ? redacted.replaceAll(secret, SECRET_REPLACEMENT) : redacted,
    redactSensitiveText(value),
  )
}

function isSecretLikePayloadKey(value: string) {
  const normalized = value.replaceAll(/[^a-z0-9]+/gi, '').toLowerCase()
  return (
    [
      'password',
      'pwd',
      'pass',
      'token',
      'secret',
      'secretkey',
      'apikey',
      'authkey',
      'authtoken',
      'accesstoken',
    ].includes(normalized) ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('authkey')
  )
}
