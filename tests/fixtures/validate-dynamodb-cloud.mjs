import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const gate = 'DATAPADPLUSPLUS_DYNAMODB_CLOUD_VALIDATE'
const checks = []
const notes = []

if (process.env[gate] !== '1') {
  console.log(`skip - DynamoDB AWS cloud validation is opt-in; set ${gate}=1 to run live AWS probes.`)
  process.exit(0)
}

const region = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REGION') ||
  envValue('AWS_REGION') ||
  envValue('AWS_DEFAULT_REGION') ||
  'us-east-1'
const tableName = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE')
const requireTable = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_TABLE')
const requireCloudWatch = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_CLOUDWATCH')
const requireIam = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_IAM')
const requireAssumeRole = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ASSUME_ROLE')
const requireWebIdentity = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_WEB_IDENTITY')
const requireEcsTask = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ECS_TASK')
const requireEc2Instance = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_EC2_INSTANCE')
const allowMetadata = envFlag('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ALLOW_METADATA')

const credentials = await resolveAwsCredentials()
let callerIdentity

await record('DynamoDB Cloud: AWS credential source, provider chain, and STS identity', async () => {
  expect(credentials.accessKeyId, 'AWS access key id was not resolved.')
  expect(credentials.secretAccessKey, 'AWS secret access key was not resolved.')
  callerIdentity = await callAwsQuery({
    service: 'sts',
    region,
    action: 'GetCallerIdentity',
    version: '2011-06-15',
    params: {},
    credentials,
  })
  expect(callerIdentity.account, 'STS GetCallerIdentity did not return an account id.')
  expect(callerIdentity.arn, 'STS GetCallerIdentity did not return a caller ARN.')
  notes.push(`DynamoDB Cloud credential source: ${credentials.source}; caller: ${redactArn(callerIdentity.arn)}`)
  if (credentials.expiration) {
    notes.push(`DynamoDB Cloud temporary credential expiration observed: ${credentials.expiration}`)
  }
})

let tableNames = []
let limits

await record('DynamoDB Cloud: ListTables and DescribeLimits read probes', async () => {
  const tables = await dynamodb('ListTables', { Limit: 100 })
  tableNames = tables.TableNames ?? []
  limits = await dynamodb('DescribeLimits', {})
  expect(Array.isArray(tableNames), 'ListTables did not return a TableNames array.')
  expect(Number.isFinite(Number(limits.AccountMaxReadCapacityUnits)), 'DescribeLimits did not return read capacity limits.')
  expect(Number.isFinite(Number(limits.AccountMaxWriteCapacityUnits)), 'DescribeLimits did not return write capacity limits.')
  if (requireTable) {
    expect(tableName, 'DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE is required when DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_TABLE=1.')
    expect(tableNames.includes(tableName), `ListTables did not include required table ${tableName}.`)
  }
})

let tableArn

await record('DynamoDB Cloud: table diagnostics and backup/export boundaries', async () => {
  if (!tableName) {
    notes.push('DynamoDB Cloud table diagnostics skipped; set DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE to validate a specific table.')
    return
  }

  const table = await dynamodb('DescribeTable', { TableName: tableName })
  tableArn = table.Table?.TableArn
  expect(table.Table?.TableStatus, `DescribeTable did not return status for ${tableName}.`)
  await dynamodb('DescribeTimeToLive', { TableName: tableName })
  await tryDynamoDbBoundary('DescribeContinuousBackups', { TableName: tableName })
  await tryDynamoDbBoundary('ListBackups', { TableName: tableName })
  notes.push('DynamoDB Cloud backup/create and export/import execution remain preview-first; this validator uses read-only backup/export preflights.')
})

await record('DynamoDB Cloud: CloudWatch table metrics request path', async () => {
  if (!tableName) {
    notes.push('CloudWatch GetMetricData skipped; set DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE to validate table metrics.')
    return
  }

  try {
    const metrics = await cloudWatchGetMetricData(tableName)
    expect(Array.isArray(metrics.MetricDataResults), 'CloudWatch GetMetricData did not return MetricDataResults.')
  } catch (error) {
    if (requireCloudWatch) {
      throw error
    }
    notes.push(`CloudWatch GetMetricData unavailable without failing optional validation: ${awsErrorSummary(error)}`)
  }
})

await record('DynamoDB Cloud: IAM policy simulation request path', async () => {
  if (!tableName || !tableArn || !callerIdentity?.arn) {
    notes.push('IAM SimulatePrincipalPolicy skipped; set DATAPADPLUSPLUS_DYNAMODB_CLOUD_TABLE and allow DescribeTable to return TableArn.')
    return
  }

  try {
    const simulation = await iamSimulatePrincipalPolicy(callerIdentity.arn, tableArn)
    expect(simulation.decisions.length > 0, 'IAM SimulatePrincipalPolicy returned no evaluation decisions.')
  } catch (error) {
    if (requireIam) {
      throw error
    }
    notes.push(`IAM SimulatePrincipalPolicy unavailable without failing optional validation: ${awsErrorSummary(error)}`)
  }
})

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`fail - ${check.name}: ${check.error.message}`)
  }
}
for (const note of notes) {
  console.log(`note - ${note}`)
}

if (checks.some((check) => !check.ok)) {
  process.exit(1)
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

async function dynamodb(operation, body) {
  return callAwsJson({
    service: 'dynamodb',
    region,
    targetPrefix: 'DynamoDB_20120810',
    operation,
    contentType: 'application/x-amz-json-1.0',
    body,
    credentials,
  })
}

async function tryDynamoDbBoundary(operation, body) {
  try {
    return await dynamodb(operation, body)
  } catch (error) {
    notes.push(`${operation} boundary unavailable on this account/table without failing optional validation: ${awsErrorSummary(error)}`)
    return undefined
  }
}

async function cloudWatchGetMetricData(table) {
  const end = new Date()
  const start = new Date(end.getTime() - 60 * 60 * 1000)
  const metricNames = [
    'ConsumedReadCapacityUnits',
    'ConsumedWriteCapacityUnits',
    'ReadThrottleEvents',
    'WriteThrottleEvents',
    'SuccessfulRequestLatency',
  ]

  return callAwsJson({
    service: 'monitoring',
    region,
    targetPrefix: 'GraniteServiceVersion20100801',
    operation: 'GetMetricData',
    contentType: 'application/x-amz-json-1.1',
    body: {
      StartTime: start.toISOString(),
      EndTime: end.toISOString(),
      MetricDataQueries: metricNames.map((name, index) => ({
        Id: `m${index}`,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/DynamoDB',
            MetricName: name,
            Dimensions: [{ Name: 'TableName', Value: table }],
          },
          Period: 300,
          Stat: name === 'SuccessfulRequestLatency' ? 'Average' : 'Sum',
        },
        ReturnData: true,
      })),
    },
    credentials,
  })
}

async function iamSimulatePrincipalPolicy(policySourceArn, resourceArn) {
  const response = await callAwsQuery({
    service: 'iam',
    region: 'us-east-1',
    action: 'SimulatePrincipalPolicy',
    version: '2010-05-08',
    params: {
      PolicySourceArn: policySourceArn,
      ResourceArns: [resourceArn],
      ActionNames: [
        'dynamodb:DescribeTable',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
      ],
    },
    credentials,
  })

  return {
    decisions: [...response.xml.matchAll(/<EvalDecision>([^<]+)<\/EvalDecision>/g)]
      .map((match) => match[1]),
  }
}

async function callAwsJson({
  service,
  region,
  targetPrefix,
  operation,
  contentType,
  body,
  credentials,
}) {
  const payload = JSON.stringify(body ?? {})
  const host = `${service}.${region}.amazonaws.com`
  const url = `https://${host}/`
  const headers = signAwsRequest({
    method: 'POST',
    url,
    service,
    region,
    headers: {
      'content-type': contentType,
      host,
      'x-amz-target': `${targetPrefix}.${operation}`,
    },
    body: payload,
    credentials,
  })
  const response = await fetch(url, { method: 'POST', headers, body: payload })
  const text = await response.text()

  if (!response.ok) {
    throw awsHttpError(operation, response.status, text)
  }

  return text ? JSON.parse(text) : {}
}

async function callAwsQuery({
  service,
  region,
  action,
  version,
  params,
  credentials,
}) {
  const host = service === 'iam' ? 'iam.amazonaws.com' : `${service}.${region}.amazonaws.com`
  const signingRegion = service === 'iam' ? 'us-east-1' : region
  const url = `https://${host}/`
  const payload = queryBody({ Action: action, Version: version, ...params })
  const headers = signAwsRequest({
    method: 'POST',
    url,
    service,
    region: signingRegion,
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      host,
    },
    body: payload,
    credentials,
  })
  const response = await fetch(url, { method: 'POST', headers, body: payload })
  const text = await response.text()

  if (!response.ok) {
    throw awsHttpError(action, response.status, text)
  }

  return {
    account: xmlValue(text, 'Account'),
    arn: xmlValue(text, 'Arn'),
    userId: xmlValue(text, 'UserId'),
    xml: text,
  }
}

async function callAwsUnsignedQuery({
  service,
  region,
  action,
  version,
  params,
}) {
  const host = `${service}.${region}.amazonaws.com`
  const payload = queryBody({ Action: action, Version: version, ...params })
  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      host,
    },
    body: payload,
  })
  const text = await response.text()

  if (!response.ok) {
    throw awsHttpError(action, response.status, text)
  }

  return { xml: text }
}

function signAwsRequest({
  method,
  url,
  service,
  region,
  headers,
  body,
  credentials,
}) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const urlValue = new URL(url)
  const signingHeaders = {
    ...headers,
    'x-amz-date': amzDate,
    ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
  }
  const lowerHeaders = Object.fromEntries(
    Object.entries(signingHeaders)
      .map(([key, value]) => [key.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')]),
  )
  const headerKeys = Object.keys(lowerHeaders).sort()
  const canonicalHeaders = headerKeys.map((key) => `${key}:${lowerHeaders[key]}\n`).join('')
  const signedHeaders = headerKeys.join(';')
  const canonicalRequest = [
    method,
    urlValue.pathname || '/',
    canonicalQueryString(urlValue),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n')
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = awsSigningKey(credentials.secretAccessKey, dateStamp, region, service)
  const signature = hmacHex(signingKey, stringToSign)

  return {
    ...signingHeaders,
    Authorization: [
      'AWS4-HMAC-SHA256',
      `Credential=${credentials.accessKeyId}/${credentialScope},`,
      `SignedHeaders=${signedHeaders},`,
      `Signature=${signature}`,
    ].join(' '),
  }
}

async function resolveAwsCredentials() {
  const provider = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER')
  const staticCredentials = resolveStaticAwsCredentials()

  if (provider && ![
    'environment',
    'profile',
    'assume-role',
    'web-identity',
    'ecs-task',
    'ec2-instance',
  ].includes(provider)) {
    throw new Error(
      'DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER must be environment, profile, assume-role, web-identity, ecs-task, or ec2-instance.',
    )
  }

  if (provider === 'assume-role' || envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ASSUME_ROLE_ARN')) {
    expect(
      staticCredentials,
      'STS AssumeRole validation requires base AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or shared-profile credentials.',
    )
    return assumeRoleCredentials(staticCredentials)
  }

  if (
    provider === 'web-identity' ||
    envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_ROLE_ARN') ||
    envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_TOKEN_FILE')
  ) {
    return webIdentityCredentials()
  }

  if (provider === 'ecs-task' || requireEcsTask) {
    return ecsTaskCredentials()
  }

  if (provider === 'ec2-instance' || requireEc2Instance) {
    return ec2InstanceCredentials()
  }

  if (requireAssumeRole) {
    throw new Error(
      'DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_ASSUME_ROLE=1 requires DATAPADPLUSPLUS_DYNAMODB_CLOUD_ASSUME_ROLE_ARN.',
    )
  }
  if (requireWebIdentity) {
    throw new Error(
      'DATAPADPLUSPLUS_DYNAMODB_CLOUD_REQUIRE_WEB_IDENTITY=1 requires DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_ROLE_ARN and DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_TOKEN_FILE.',
    )
  }

  if (staticCredentials) {
    notes.push(
      'DynamoDB Cloud temporary provider probes not requested; set DATAPADPLUSPLUS_DYNAMODB_CLOUD_CREDENTIAL_PROVIDER=assume-role, web-identity, ecs-task, or ec2-instance to validate those paths.',
    )
    return staticCredentials
  }

  throw new Error(
    'No AWS credentials resolved. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, DATAPADPLUSPLUS_AWS_PROFILE/AWS_PROFILE, or an explicit DynamoDB cloud credential provider before enabling validation.',
  )
}

function resolveStaticAwsCredentials() {
  const envCredentials = {
    accessKeyId: envValue('AWS_ACCESS_KEY_ID'),
    secretAccessKey: envValue('AWS_SECRET_ACCESS_KEY'),
    sessionToken: envValue('AWS_SESSION_TOKEN'),
  }
  if (envCredentials.accessKeyId && envCredentials.secretAccessKey) {
    return { ...envCredentials, source: 'environment' }
  }

  const profileName = envValue('DATAPADPLUSPLUS_AWS_PROFILE') || envValue('AWS_PROFILE') || 'default'
  const profileCredentials = awsProfileCredentials(profileName)
  if (profileCredentials) {
    return { ...profileCredentials, source: `profile:${profileName}` }
  }

  return undefined
}

async function assumeRoleCredentials(baseCredentials) {
  const roleArn = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ASSUME_ROLE_ARN')
  expect(roleArn, 'DATAPADPLUSPLUS_DYNAMODB_CLOUD_ASSUME_ROLE_ARN is required for assume-role validation.')

  const response = await callAwsQuery({
    service: 'sts',
    region,
    action: 'AssumeRole',
    version: '2011-06-15',
    params: {
      RoleArn: roleArn,
      RoleSessionName: envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ROLE_SESSION_NAME') ||
        'datapadplusplus-dynamodb-validation',
      DurationSeconds: durationSeconds(),
      ExternalId: envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_EXTERNAL_ID'),
    },
    credentials: baseCredentials,
  })

  notes.push(`DynamoDB Cloud STS AssumeRole provider validated for ${redactArn(roleArn)}.`)
  return credentialsFromStsXml(response.xml, `assume-role:${redactArn(roleArn)}`)
}

async function webIdentityCredentials() {
  const roleArn = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_ROLE_ARN')
  const tokenFile = envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_TOKEN_FILE')
  expect(roleArn, 'DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_ROLE_ARN is required for web identity validation.')
  expect(tokenFile, 'DATAPADPLUSPLUS_DYNAMODB_CLOUD_WEB_IDENTITY_TOKEN_FILE is required for web identity validation.')
  expect(existsSync(tokenFile), `Web identity token file does not exist: ${tokenFile}`)
  const token = readFileSync(tokenFile, 'utf8').trim()
  expect(token, 'Web identity token file was empty.')

  const response = await callAwsUnsignedQuery({
    service: 'sts',
    region,
    action: 'AssumeRoleWithWebIdentity',
    version: '2011-06-15',
    params: {
      RoleArn: roleArn,
      RoleSessionName: envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ROLE_SESSION_NAME') ||
        'datapadplusplus-dynamodb-web-identity',
      WebIdentityToken: token,
      DurationSeconds: durationSeconds(),
    },
  })

  notes.push(`DynamoDB Cloud AssumeRoleWithWebIdentity provider validated for ${redactArn(roleArn)}.`)
  return credentialsFromStsXml(response.xml, `web-identity:${redactArn(roleArn)}`)
}

async function ecsTaskCredentials() {
  expect(
    allowMetadata,
    'ECS task credential validation is disabled unless DATAPADPLUSPLUS_DYNAMODB_CLOUD_ALLOW_METADATA=1 is set.',
  )
  const relativeUri = envValue('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI')
  const fullUri = envValue('AWS_CONTAINER_CREDENTIALS_FULL_URI')
  const url = relativeUri
    ? `http://169.254.170.2${relativeUri.startsWith('/') ? relativeUri : `/${relativeUri}`}`
    : fullUri
  expect(url, 'ECS task credential validation requires AWS_CONTAINER_CREDENTIALS_RELATIVE_URI or AWS_CONTAINER_CREDENTIALS_FULL_URI.')
  expect(
    metadataUrlIsAllowed(url, ['169.254.170.2', 'localhost', '127.0.0.1']),
    `Refusing ECS credential metadata URL outside the allowed hosts: ${url}`,
  )

  const headers = metadataAuthorizationHeaders()
  const metadata = await fetchJsonWithTimeout(url, { headers })
  notes.push('DynamoDB Cloud ECS task credential provider validated through AWS_CONTAINER_CREDENTIALS_RELATIVE_URI or FULL_URI.')
  return credentialsFromMetadataJson(metadata, 'ecs-task')
}

async function ec2InstanceCredentials() {
  expect(
    allowMetadata,
    'EC2 instance metadata validation is disabled unless DATAPADPLUSPLUS_DYNAMODB_CLOUD_ALLOW_METADATA=1 is set.',
  )
  const endpoint = 'http://169.254.169.254'
  const tokenResponse = await fetchWithTimeout(`${endpoint}/latest/api/token`, {
    method: 'PUT',
    headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
  }).catch(() => undefined)
  const token = tokenResponse?.ok ? await tokenResponse.text() : ''
  const headers = token ? { 'x-aws-ec2-metadata-token': token } : {}
  const roleResponse = await fetchWithTimeout(
    `${endpoint}/latest/meta-data/iam/security-credentials/`,
    { headers },
  )
  const roleName = (await roleResponse.text()).split(/\r?\n/).map((value) => value.trim()).find(Boolean)
  expect(roleResponse.ok && roleName, 'EC2 IMDS did not return an instance-profile role name.')

  const metadata = await fetchJsonWithTimeout(
    `${endpoint}/latest/meta-data/iam/security-credentials/${encodeURIComponent(roleName)}`,
    { headers },
  )
  notes.push(`DynamoDB Cloud EC2 instance metadata provider validated for role ${roleName}.`)
  return credentialsFromMetadataJson(metadata, `ec2-instance:${roleName}`)
}

function awsProfileCredentials(profileName) {
  const home = os.homedir()
  const credentialSections = parseIniFile(path.join(home, '.aws', 'credentials'))
  const configSections = parseIniFile(path.join(home, '.aws', 'config'))
  const profileSection = {
    ...(credentialSections[profileName] ?? {}),
    ...(configSections[profileName] ?? {}),
    ...(configSections[`profile ${profileName}`] ?? {}),
  }
  const accessKeyId = profileSection.aws_access_key_id
  const secretAccessKey = profileSection.aws_secret_access_key

  if (!accessKeyId || !secretAccessKey) {
    return undefined
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: profileSection.aws_session_token,
  }
}

function credentialsFromStsXml(xml, source) {
  const credentials = {
    accessKeyId: xmlValue(xml, 'AccessKeyId'),
    secretAccessKey: xmlValue(xml, 'SecretAccessKey'),
    sessionToken: xmlValue(xml, 'SessionToken'),
    expiration: xmlValue(xml, 'Expiration'),
    source,
  }
  expect(credentials.accessKeyId, `${source} did not return AccessKeyId.`)
  expect(credentials.secretAccessKey, `${source} did not return SecretAccessKey.`)
  expect(credentials.sessionToken, `${source} did not return SessionToken.`)
  return credentials
}

function credentialsFromMetadataJson(json, source) {
  const credentials = {
    accessKeyId: json.AccessKeyId,
    secretAccessKey: json.SecretAccessKey,
    sessionToken: json.Token,
    expiration: json.Expiration,
    source,
  }
  expect(credentials.accessKeyId, `${source} metadata did not return AccessKeyId.`)
  expect(credentials.secretAccessKey, `${source} metadata did not return SecretAccessKey.`)
  expect(credentials.sessionToken, `${source} metadata did not return Token.`)
  return credentials
}

async function fetchJsonWithTimeout(url, options = {}) {
  const response = await fetchWithTimeout(url, options)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`metadata request failed with HTTP ${response.status}: ${text.slice(0, 160)}`)
  }
  return JSON.parse(text)
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), metadataTimeoutMs())
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function metadataAuthorizationHeaders() {
  const token = envValue('AWS_CONTAINER_AUTHORIZATION_TOKEN')
  const tokenFile = envValue('AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE')
  if (token) {
    return { Authorization: token }
  }
  if (tokenFile && existsSync(tokenFile)) {
    return { Authorization: readFileSync(tokenFile, 'utf8').trim() }
  }
  return {}
}

function metadataUrlIsAllowed(url, allowedHosts) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && allowedHosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

function durationSeconds() {
  const value = Number(envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_ROLE_DURATION_SECONDS') ?? 900)
  return Number.isFinite(value) && value >= 900 && value <= 43200 ? value : 900
}

function metadataTimeoutMs() {
  const value = Number(envValue('DATAPADPLUSPLUS_DYNAMODB_CLOUD_METADATA_TIMEOUT_MS') ?? 1500)
  return Number.isFinite(value) && value >= 250 && value <= 10000 ? value : 1500
}

function parseIniFile(filePath) {
  if (!existsSync(filePath)) {
    return {}
  }

  const sections = {}
  let current = undefined
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    const section = line.match(/^\[([^\]]+)\]$/)
    if (section) {
      current = section[1].trim()
      sections[current] ??= {}
      continue
    }
    const pair = line.match(/^([^=]+)=(.*)$/)
    if (pair && current) {
      sections[current][pair[1].trim()] = pair[2].trim()
    }
  }

  return sections
}

function queryBody(params) {
  const flat = []
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => flat.push([`${key}.member.${index + 1}`, item]))
    } else if (value !== undefined) {
      flat.push([key, value])
    }
  }
  flat.sort(([left], [right]) => left.localeCompare(right))
  return flat
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
}

function canonicalQueryString(url) {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function awsSigningKey(secretAccessKey, dateStamp, region, service) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmacBuffer(dateKey, region)
  const serviceKey = hmacBuffer(regionKey, service)
  return hmacBuffer(serviceKey, 'aws4_request')
}

function awsHttpError(operation, status, bodyText) {
  const code = awsErrorCode(bodyText)
  const error = new Error(`${operation} failed with HTTP ${status}${code ? ` ${code}` : ''}`)
  error.status = status
  error.bodyText = bodyText
  error.awsCode = code
  return error
}

function awsErrorCode(bodyText) {
  try {
    const json = JSON.parse(bodyText)
    return String(json.__type ?? json.code ?? json.Code ?? '').split('#').at(-1)
  } catch {
    return xmlValue(bodyText, 'Code') || ''
  }
}

function awsErrorSummary(error) {
  return `${error.awsCode ? `${error.awsCode}: ` : ''}${error.message}`.replace(/\s+/g, ' ')
}

function xmlValue(xml, tag) {
  return xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]
}

function envValue(key) {
  return process.env[key]?.trim() || undefined
}

function envFlag(key) {
  return /^(1|true|yes)$/i.test(process.env[key] ?? '')
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacBuffer(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function redactArn(arn) {
  return arn.replace(/:(\d{12}):/, ':<account>:')
}
