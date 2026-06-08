import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const container = 'datapadplusplus-dynamodb'
const transientTable = 'fixture_dynamodb_contract'
const checks = []
const notes = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function generatedEnvValue(key) {
  const generatedEnvPath = path.join(process.cwd(), 'tests', 'fixtures', '.generated.env')
  if (!existsSync(generatedEnvPath)) {
    return undefined
  }

  const line = readFileSync(generatedEnvPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${key}=`))

  return line?.slice(key.length + 1).trim()
}

function fixturePort(key, fallback) {
  const value = process.env[key] ?? generatedEnvValue(key) ?? String(fallback)
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${key} must be a positive integer port, got ${JSON.stringify(value)}`)
  }
  return port
}

const endpoint = `http://127.0.0.1:${fixturePort('DATAPADPLUSPLUS_DYNAMODB_PORT', 8001)}`
const endpointHost = endpoint.replace(/^https?:\/\//, '')

function dynamodbLocalAuthHeaders() {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  return {
    authorization: [
      'AWS4-HMAC-SHA256',
      `Credential=local/${dateStamp}/us-east-1/dynamodb/aws4_request,`,
      'SignedHeaders=content-type;host;x-amz-date;x-amz-target,',
      'Signature=0000000000000000000000000000000000000000000000000000000000000000',
    ].join(' '),
    host: endpointHost,
    'x-amz-date': amzDate,
  }
}

async function dynamodb(target, body = {}) {
  const response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: {
      ...dynamodbLocalAuthHeaders(),
      'content-type': 'application/x-amz-json-1.0',
      'x-amz-target': `DynamoDB_20120810.${target}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    const error = new Error(`${target} failed: ${response.status} ${text}`)
    error.bodyText = text
    error.target = target
    throw error
  }

  return text ? JSON.parse(text) : {}
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function expectAtLeast(value, expected, label) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < expected) {
    throw new Error(`${label} expected at least ${expected}, got ${JSON.stringify(value)}`)
  }
}

function expectIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} expected to include ${JSON.stringify(expected)}, got ${JSON.stringify(values)}`)
  }
}

function dynamodbErrorCode(error) {
  try {
    const parsed = JSON.parse(error.bodyText ?? '{}')
    const rawCode = parsed.__type ?? parsed.code ?? parsed.Code ?? ''
    return String(rawCode).split('#').at(-1) ?? String(rawCode)
  } catch {
    return ''
  }
}

async function expectDynamoDbFailure(label, target, body, codePattern) {
  try {
    await dynamodb(target, body)
  } catch (error) {
    const code = dynamodbErrorCode(error)
    if (codePattern.test(`${code} ${error.message}`)) {
      return { code, message: error.message }
    }
    throw new Error(`${label} failed with unexpected DynamoDB error ${code}: ${error.message}`)
  }

  throw new Error(`${label} unexpectedly succeeded`)
}

async function waitForDynamoDb() {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await dynamodb('ListTables', {})
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  throw new Error(`Timed out waiting for DynamoDB Local at ${endpoint}: ${lastError?.message ?? 'unknown error'}`)
}

async function waitForTableStatus(tableName, expectedStatus) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = await dynamodb('DescribeTable', { TableName: tableName })
      if (result.Table?.TableStatus === expectedStatus) {
        return result.Table
      }
    } catch (error) {
      if (expectedStatus === 'DELETED' && /ResourceNotFoundException/.test(dynamodbErrorCode(error))) {
        return undefined
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`DynamoDB fixture table ${tableName} did not reach ${expectedStatus}`)
}

async function deleteTableIfExists(tableName) {
  try {
    await dynamodb('DeleteTable', { TableName: tableName })
    await waitForTableStatus(tableName, 'DELETED')
  } catch (error) {
    if (!/ResourceNotFoundException/.test(dynamodbErrorCode(error))) {
      throw error
    }
  }
}

async function scanCount(tableName) {
  let total = 0
  let exclusiveStartKey

  do {
    const result = await dynamodb('Scan', {
      TableName: tableName,
      Select: 'COUNT',
      Limit: 1000,
      ReturnConsumedCapacity: 'TOTAL',
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    })
    total += result.Count ?? 0
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)

  return total
}

async function createTransientTable() {
  await deleteTableIfExists(transientTable)
  await dynamodb('CreateTable', {
    TableName: transientTable,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'gsi_pk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'fixture_gsi',
      KeySchema: [
        { AttributeName: 'gsi_pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    }],
    BillingMode: 'PAY_PER_REQUEST',
  })
  await waitForTableStatus(transientTable, 'ACTIVE')
}

if (!containerRunning(container)) {
  throw new Error(
    'DynamoDB Local fixture is not running. Run `npm run fixtures:up:profile -- cloud-contract && npm run fixtures:seed:all` first.',
  )
}

await waitForDynamoDb()
await deleteTableIfExists(transientTable)

try {
  await record('DynamoDB Local: seeded table volume and consumed-capacity payloads', async () => {
    const tables = await dynamodb('ListTables', {})
    for (const table of ['accounts', 'products', 'orders', 'order_events']) {
      expectIncludes(tables.TableNames, table, 'DynamoDB Local table list')
    }

    expectAtLeast(await scanCount('accounts'), 500, 'DynamoDB accounts items')
    expectAtLeast(await scanCount('products'), 1000, 'DynamoDB products items')
    expectAtLeast(await scanCount('orders'), 5000, 'DynamoDB orders items')
    expectAtLeast(await scanCount('order_events'), 10000, 'DynamoDB order_events items')

    const scan = await dynamodb('Scan', {
      TableName: 'products',
      Limit: 25,
      ReturnConsumedCapacity: 'TOTAL',
    })

    expectAtLeast(scan.Count, 1, 'DynamoDB products scan count')
    expect(scan.LastEvaluatedKey, 'DynamoDB products scan did not expose pagination metadata')
    expect(scan.ConsumedCapacity?.TableName === 'products', 'DynamoDB scan consumed-capacity table name missing')
    expectAtLeast(scan.ConsumedCapacity?.CapacityUnits, 0, 'DynamoDB scan consumed-capacity units')
  })

  await record('DynamoDB Local: table, key, GSI, and TTL metadata surfaces', async () => {
    await createTransientTable()
    const description = await dynamodb('DescribeTable', { TableName: transientTable })
    const table = description.Table

    expect(table?.TableStatus === 'ACTIVE', 'DynamoDB transient table did not become active')
    expectIncludes(table?.KeySchema?.map((key) => key.AttributeName), 'pk', 'DynamoDB transient key schema')
    expectIncludes(table?.KeySchema?.map((key) => key.AttributeName), 'sk', 'DynamoDB transient key schema')
    expectIncludes(table?.GlobalSecondaryIndexes?.map((index) => index.IndexName), 'fixture_gsi', 'DynamoDB transient GSI list')

    try {
      await dynamodb('UpdateTimeToLive', {
        TableName: transientTable,
        TimeToLiveSpecification: {
          AttributeName: 'expires_at',
          Enabled: true,
        },
      })
      const ttl = await dynamodb('DescribeTimeToLive', { TableName: transientTable })
      expect(ttl.TimeToLiveDescription?.AttributeName === 'expires_at', 'DynamoDB TTL attribute was not reflected')
    } catch (error) {
      const code = dynamodbErrorCode(error)
      expect(
        /UnknownOperationException|ValidationException|UnsupportedOperationException/.test(`${code} ${error.message}`),
        `DynamoDB TTL check failed with unexpected error ${code}: ${error.message}`,
      )
      notes.push('DynamoDB Local did not expose TTL mutation in this image; TTL live-cloud verification remains outside default CI.')
    }
  })

  await record('DynamoDB Local: Query, GetItem, and PartiQL read evidence', async () => {
    const query = await dynamodb('Query', {
      TableName: 'order_events',
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#sk': 'sk',
      },
      ExpressionAttributeValues: {
        ':pk': { S: 'ACCOUNT#1' },
        ':prefix': { S: 'ORDER#' },
      },
      Limit: 5,
      ReturnConsumedCapacity: 'TOTAL',
    })

    expectAtLeast(query.Count, 1, 'DynamoDB order_events query count')
    expect(query.LastEvaluatedKey, 'DynamoDB query did not expose pagination metadata')
    expect(query.ConsumedCapacity?.TableName === 'order_events', 'DynamoDB query consumed-capacity table name missing')

    const item = await dynamodb('GetItem', {
      TableName: 'products',
      Key: { sku: { S: 'luna-lamp' } },
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    })

    expect(item.Item?.name?.S === 'Luna Lamp', 'DynamoDB GetItem did not return seeded product')
    expect(item.ConsumedCapacity?.TableName === 'products', 'DynamoDB GetItem consumed-capacity table name missing')

    const partiql = await dynamodb('ExecuteStatement', {
      Statement: 'SELECT * FROM "orders" WHERE "order_id" = ?',
      Parameters: [{ S: '101' }],
      ReturnConsumedCapacity: 'TOTAL',
    })

    expectAtLeast(partiql.Items?.length ?? 0, 1, 'DynamoDB PartiQL seeded order result')
    if (partiql.ConsumedCapacity) {
      expectAtLeast(partiql.ConsumedCapacity.CapacityUnits, 0, 'DynamoDB PartiQL consumed-capacity units')
    } else {
      notes.push('DynamoDB Local omitted ExecuteStatement consumed capacity even though ReturnConsumedCapacity was requested; Scan, Query, and GetItem capacity payloads remain covered.')
    }
  })

  await record('DynamoDB Local: conditional item edit before/after evidence', async () => {
    const key = { order_id: { S: 'fixture-edit-1' } }
    await dynamodb('DeleteItem', { TableName: 'orders', Key: key }).catch(() => undefined)

    const before = await dynamodb('GetItem', {
      TableName: 'orders',
      Key: key,
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    })
    expect(!before.Item, 'DynamoDB fixture edit item should not exist before create-only put')

    await dynamodb('PutItem', {
      TableName: 'orders',
      Item: {
        order_id: { S: 'fixture-edit-1' },
        account_id: { S: 'fixture-account' },
        status: { S: 'created' },
        total_amount: { N: '42.50' },
      },
      ConditionExpression: 'attribute_not_exists(#key0)',
      ExpressionAttributeNames: { '#key0': 'order_id' },
      ReturnValues: 'ALL_OLD',
      ReturnConsumedCapacity: 'TOTAL',
    })

    const afterPut = await dynamodb('GetItem', {
      TableName: 'orders',
      Key: key,
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    })
    expect(afterPut.Item?.status?.S === 'created', 'DynamoDB put-item after evidence is missing')

    await expectDynamoDbFailure(
      'DynamoDB duplicate create-only put',
      'PutItem',
      {
        TableName: 'orders',
        Item: afterPut.Item,
        ConditionExpression: 'attribute_not_exists(#key0)',
        ExpressionAttributeNames: { '#key0': 'order_id' },
      },
      /ConditionalCheckFailedException/,
    )

    const update = await dynamodb('UpdateItem', {
      TableName: 'orders',
      Key: key,
      UpdateExpression: 'SET #status = :status',
      ConditionExpression: 'attribute_exists(#key0)',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#key0': 'order_id',
      },
      ExpressionAttributeValues: {
        ':status': { S: 'fulfilled' },
      },
      ReturnValues: 'ALL_NEW',
      ReturnConsumedCapacity: 'TOTAL',
    })
    expect(update.Attributes?.status?.S === 'fulfilled', 'DynamoDB update returned attributes are missing')

    const deleted = await dynamodb('DeleteItem', {
      TableName: 'orders',
      Key: key,
      ConditionExpression: 'attribute_exists(#key0)',
      ExpressionAttributeNames: { '#key0': 'order_id' },
      ReturnValues: 'ALL_OLD',
      ReturnConsumedCapacity: 'TOTAL',
    })
    expect(deleted.Attributes?.status?.S === 'fulfilled', 'DynamoDB delete returned old attributes are missing')

    const afterDelete = await dynamodb('GetItem', {
      TableName: 'orders',
      Key: key,
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    })
    expect(!afterDelete.Item, 'DynamoDB delete after evidence still found fixture item')

    await expectDynamoDbFailure(
      'DynamoDB delete missing item condition',
      'DeleteItem',
      {
        TableName: 'orders',
        Key: key,
        ConditionExpression: 'attribute_exists(#key0)',
        ExpressionAttributeNames: { '#key0': 'order_id' },
      },
      /ConditionalCheckFailedException/,
    )
  })

  await record('DynamoDB Local: backup and import/export boundary evidence', async () => {
    const table = await waitForTableStatus(transientTable, 'ACTIVE')
    const backupName = 'fixture-dynamodb-contract-backup'
    const backup = await dynamodb('CreateBackup', {
      TableName: transientTable,
      BackupName: backupName,
    }).catch((error) => {
      const code = dynamodbErrorCode(error)
      expect(
        /UnknownOperationException|ValidationException|UnsupportedOperationException/.test(`${code} ${error.message}`),
        `DynamoDB CreateBackup failed with unexpected error ${code}: ${error.message}`,
      )
      notes.push('DynamoDB Local did not support CreateBackup in this image; backup execution remains a cloud/fixture variant outside default CI.')
      return undefined
    })

    if (backup?.BackupDetails?.BackupArn) {
      expect(backup.BackupDetails.BackupName === backupName, 'DynamoDB backup name was not reflected')
      await dynamodb('DeleteBackup', { BackupArn: backup.BackupDetails.BackupArn }).catch((error) => {
        notes.push(`DynamoDB Local backup cleanup reported ${dynamodbErrorCode(error) || error.message}.`)
      })
    }

    await expectDynamoDbFailure(
      'DynamoDB Local export-to-S3 boundary',
      'ExportTableToPointInTime',
      {
        TableArn: table.TableArn,
        S3Bucket: 'fixture-dynamodb-export',
        S3Prefix: 'datapadplusplus-fixture/',
      },
      /UnknownOperationException|ValidationException|UnsupportedOperationException|ResourceNotFoundException/,
    )
    notes.push('DynamoDB Local export/import validation records the local API boundary; cloud S3 import/export execution stays preview-first.')
  })
} finally {
  await deleteTableIfExists(transientTable).catch((error) => {
    notes.push(`DynamoDB transient fixture cleanup failed: ${error.message}`)
  })
}

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error.message)
  }
}

for (const note of notes) {
  console.log(`note - ${note}`)
}

if (failures.length > 0) {
  process.exitCode = 1
}
