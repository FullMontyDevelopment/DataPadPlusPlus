import type { ConnectionProfile } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export function dynamoAuthEvidence(connection: ConnectionProfile) {
  const options = asRecord(connection.dynamoDbOptions)
  const connectMode = stringValue(options.connectMode) || inferredDynamoConnectMode(connection)
  const credentialsProvider = stringValue(options.credentialsProvider) ||
    dynamoCredentialsProvider(connectMode)
  const signingRegion = stringValue(options.signerRegion) ||
    stringValue(options.region) ||
    (connection.database && connection.database !== 'local' ? connection.database : '') ||
    'us-east-1'

  return {
    scheme: 'AWS4-HMAC-SHA256',
    service: 'dynamodb',
    connectMode,
    credentialsProvider,
    signingRegion,
    endpointMode: dynamoEndpointMode(connection, connectMode),
    signedJsonHttp: true,
    liveCloudRuntime: false,
    signedHeaders: ['content-type', 'host', 'x-amz-date', 'x-amz-target'],
    credentialScope: `20260101/${signingRegion}/dynamodb/aws4_request`,
    accessKeyId: redactedDynamoAccessKeyId(stringValue(options.accessKeyId) || connection.auth?.username),
    credentialMaterial:
      'Secret access keys, session tokens, web identity tokens, and role credentials stay in the desktop secret/profile resolver.',
  }
}

export function dynamoCloudDisabledReasons(connection: ConnectionProfile) {
  const options = asRecord(connection.dynamoDbOptions)
  const connectMode = stringValue(options.connectMode) || inferredDynamoConnectMode(connection)
  const reasons = [
    'CloudWatch account/table metrics, IAM policy simulation, S3 export/import, and cloud backup validation stay preview-first without optional AWS credentials.',
  ]

  if (!dynamoEndpointIsLocal(connection, connectMode)) {
    reasons.unshift(
      'AWS profile, STS AssumeRole, web identity, ECS task, EC2 metadata, and static secret-key resolution are contract-mode in default CI.',
    )
  }

  return reasons
}

function inferredDynamoConnectMode(connection: ConnectionProfile) {
  if (connection.connectionString || stringValue(asRecord(connection.dynamoDbOptions).endpointUrl)) {
    return 'endpoint-override'
  }

  return dynamoEndpointHostIsLocal(connection.host) ? 'local-endpoint' : 'endpoint-override'
}

function dynamoCredentialsProvider(connectMode: string) {
  switch (connectMode) {
    case 'aws-profile':
      return 'profile'
    case 'access-keys':
      return 'static-keys'
    case 'assume-role':
      return 'assume-role'
    case 'web-identity':
      return 'web-identity'
    case 'ecs-task':
      return 'container'
    case 'ec2-instance':
      return 'instance-metadata'
    default:
      return 'local'
  }
}

function dynamoEndpointMode(connection: ConnectionProfile, connectMode: string) {
  if (dynamoEndpointIsLocal(connection, connectMode)) {
    return 'local-http'
  }

  if (connectMode === 'endpoint-override') {
    return 'endpoint-override-http'
  }

  return 'aws-cloud-contract'
}

function dynamoEndpointIsLocal(connection: ConnectionProfile, connectMode: string) {
  const options = asRecord(connection.dynamoDbOptions)
  const endpoint = [
    stringValue(options.endpointUrl),
    connection.connectionString,
    connection.host,
  ].filter(Boolean).join(' ')

  return connectMode === 'local-endpoint' || /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/i.test(endpoint)
}

function redactedDynamoAccessKeyId(value: unknown) {
  const text = stringValue(value)
  if (!text) {
    return 'profile/default-chain'
  }
  if (text === 'local' || text.length <= 8) {
    return text
  }

  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function dynamoEndpointHostIsLocal(host: string) {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(host.trim())
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
