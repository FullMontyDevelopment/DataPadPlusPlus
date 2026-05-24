import type {
  AdapterDiagnostics,
  DataEditExecutionResponse,
  DataEditPlanResponse,
  ExecutionResultEnvelope,
  OperationExecutionResponse,
  OperationPlanResponse,
  ResolvedEnvironment,
  ResultPageResponse,
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
  return environment.sensitiveKeys
    .map((key) => environment.variables[key])
    .filter((value): value is string => Boolean(value?.trim()))
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
