import type { ConnectionProfile, SecretRef } from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const DYNAMODB_CONNECT_MODES = new Set([
  'local-endpoint',
  'aws-profile',
  'access-keys',
  'assume-role',
  'web-identity',
  'ecs-task',
  'ec2-instance',
  'endpoint-override',
])
const DYNAMODB_CREDENTIAL_PROVIDERS = new Set([
  'default-chain',
  'profile',
  'static-keys',
  'session-token',
  'assume-role',
  'web-identity',
  'container',
  'instance-metadata',
])
const DYNAMODB_RETRY_MODES = new Set(['standard', 'adaptive', 'legacy'])
const DYNAMODB_RETURN_CONSUMED_CAPACITY = new Set(['none', 'total', 'indexes'])

export function validateDynamoDbConnectionOptions(
  options: ConnectionProfile['dynamoDbOptions'] | null | undefined,
): ConnectionProfile['dynamoDbOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }

  if (typeof options !== 'object') {
    throw new Error('DynamoDB connection options must be an object.')
  }

  const connectMode = validateEnumOption(
    options.connectMode,
    DYNAMODB_CONNECT_MODES,
    'DynamoDB connection mode',
  )
  const credentialsProvider = validateEnumOption(
    options.credentialsProvider,
    DYNAMODB_CREDENTIAL_PROVIDERS,
    'DynamoDB credentials provider',
  )
  const retryMode = validateEnumOption(
    options.retryMode,
    DYNAMODB_RETRY_MODES,
    'DynamoDB retry mode',
  )
  const returnConsumedCapacity = validateEnumOption(
    options.returnConsumedCapacity,
    DYNAMODB_RETURN_CONSUMED_CAPACITY,
    'DynamoDB consumed-capacity setting',
  )

  return {
    connectMode: connectMode as NonNullable<ConnectionProfile['dynamoDbOptions']>['connectMode'],
    region: trimOptionalText(options.region, 'DynamoDB region', 120),
    endpointUrl: trimOptionalText(options.endpointUrl, 'DynamoDB endpoint URL', MAX_SCOPE_LENGTH),
    tablePrefix: trimOptionalText(
      options.tablePrefix,
      'DynamoDB table prefix',
      MAX_OBJECT_NAME_LENGTH,
    ),
    accountId: trimOptionalText(options.accountId, 'DynamoDB account id', 64),
    profileName: trimOptionalText(
      options.profileName,
      'DynamoDB profile name',
      MAX_OBJECT_NAME_LENGTH,
    ),
    credentialsProvider:
      credentialsProvider as NonNullable<ConnectionProfile['dynamoDbOptions']>['credentialsProvider'],
    accessKeyId: trimOptionalText(
      options.accessKeyId,
      'DynamoDB access key id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    secretAccessKeyRef: options.secretAccessKeyRef
      ? validateSecretRef(options.secretAccessKeyRef, 'DynamoDB secret access key')
      : undefined,
    sessionTokenRef: options.sessionTokenRef
      ? validateSecretRef(options.sessionTokenRef, 'DynamoDB session token')
      : undefined,
    roleArn: trimOptionalText(options.roleArn, 'DynamoDB role ARN', MAX_SCOPE_LENGTH),
    externalId: trimOptionalText(
      options.externalId,
      'DynamoDB external id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    roleSessionName: trimOptionalText(
      options.roleSessionName,
      'DynamoDB role session name',
      MAX_OBJECT_NAME_LENGTH,
    ),
    webIdentityTokenFile: trimOptionalText(
      options.webIdentityTokenFile,
      'DynamoDB web identity token file',
      MAX_SCOPE_LENGTH,
    ),
    useDualStackEndpoint: optionalBoolean(
      options.useDualStackEndpoint,
      'DynamoDB dual-stack flag',
    ),
    useFipsEndpoint: optionalBoolean(options.useFipsEndpoint, 'DynamoDB FIPS flag'),
    forcePathStyle: optionalBoolean(options.forcePathStyle, 'DynamoDB path-style flag'),
    signerRegion: trimOptionalText(options.signerRegion, 'DynamoDB signer region', 120),
    retryMode: retryMode as NonNullable<ConnectionProfile['dynamoDbOptions']>['retryMode'],
    maxAttempts: optionalInteger(options.maxAttempts, 'DynamoDB max attempts', 1, 20),
    connectTimeoutMs: optionalInteger(
      options.connectTimeoutMs,
      'DynamoDB connect timeout',
      1,
      900_000,
    ),
    requestTimeoutMs: optionalInteger(
      options.requestTimeoutMs,
      'DynamoDB request timeout',
      1,
      900_000,
    ),
    readTimeoutMs: optionalInteger(options.readTimeoutMs, 'DynamoDB read timeout', 1, 900_000),
    tcpKeepAlive: optionalBoolean(options.tcpKeepAlive, 'DynamoDB TCP keep-alive flag'),
    apiVersion: trimOptionalText(options.apiVersion, 'DynamoDB API version', 80),
    scanPageSize: optionalInteger(options.scanPageSize, 'DynamoDB scan page size', 1, 10_000),
    consistentReadDefault: optionalBoolean(
      options.consistentReadDefault,
      'DynamoDB consistent-read flag',
    ),
    returnConsumedCapacity:
      returnConsumedCapacity as NonNullable<
        ConnectionProfile['dynamoDbOptions']
      >['returnConsumedCapacity'],
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

function validateEnumOption(
  value: string | undefined,
  allowedValues: Set<string>,
  label: string,
) {
  const normalized = validateOptionalText(value, label, MAX_OBJECT_NAME_LENGTH)?.trim()

  if (normalized && !allowedValues.has(normalized)) {
    throw new Error(`Unsupported ${label}: ${normalized}.`)
  }

  return normalized || undefined
}

function trimOptionalText(value: string | undefined, label: string, maxLength: number) {
  return validateOptionalText(value, label, maxLength)?.trim() || undefined
}

function optionalBoolean(value: boolean | undefined, label: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be true or false.`)
  }

  return value
}

function optionalInteger(
  value: number | undefined,
  label: string,
  min: number,
  max: number,
) {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
  }

  return value
}
