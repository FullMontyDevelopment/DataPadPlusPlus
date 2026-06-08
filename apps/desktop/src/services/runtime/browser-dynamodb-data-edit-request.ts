import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

const SECRET_REPLACEMENT = '********'

export function dynamoDbDataEditWarnings(request: DataEditPlanRequest) {
  return isEmptyRecord(request.target.primaryKey ?? request.target.itemKey)
    ? []
    : [
        'DynamoDB item edits use consistent GetItem before/after evidence with ReturnConsumedCapacity when a complete item key is supplied.',
      ]
}

export function dynamoDbDataEditRequest(request: DataEditPlanRequest) {
  const table = request.target.table ?? '<table>'
  const key = request.target.itemKey ?? request.target.primaryKey ?? {}
  const evidenceRequests = dynamoDbEvidenceRequests(table, key)

  if (request.editKind === 'delete-item') {
    const condition = dynamoDbKeyConditionPlan(key, 'exists')

    return JSON.stringify(
      {
        Operation: 'DeleteItem',
        TableName: table,
        Key: key,
        ...dynamoDbConditionFields(condition),
        ReturnValues: 'ALL_OLD',
        ReturnConsumedCapacity: 'TOTAL',
        EvidenceRequests: evidenceRequests,
      },
      null,
      2,
    )
  }

  if (request.editKind === 'put-item') {
    const condition = dynamoDbKeyConditionPlan(key, 'not-exists')

    return JSON.stringify(
      {
        Operation: 'PutItem',
        TableName: table,
        Item: dynamoDbPutItem(request),
        ...dynamoDbConditionFields(condition),
        ReturnValues: 'ALL_OLD',
        ReturnConsumedCapacity: 'TOTAL',
        EvidenceRequests: evidenceRequests,
      },
      null,
      2,
    )
  }

  const expressionAttributeNames = {
    '#field': request.changes[0]?.field ?? '<field>',
  }
  const condition = dynamoDbKeyConditionPlan(key, 'exists', expressionAttributeNames)

  return JSON.stringify(
    {
      Operation: 'UpdateItem',
      TableName: table,
      Key: key,
      UpdateExpression: 'SET #field = :value',
      ExpressionAttributeNames: condition.expressionAttributeNames,
      ExpressionAttributeValues: {
        ':value': secretAwareJsonValue(
          request.changes[0]?.field ?? '<field>',
          request.changes[0]?.value ?? '<value>',
        ),
      },
      ...dynamoDbConditionFields(condition),
      ReturnValues: 'ALL_NEW',
      ReturnConsumedCapacity: 'TOTAL',
      EvidenceRequests: evidenceRequests,
    },
    null,
    2,
  )
}

type DynamoDbConditionMode = 'exists' | 'not-exists'

interface DynamoDbConditionPlan {
  conditionExpression?: string
  expressionAttributeNames: Record<string, string>
}

function dynamoDbKeyConditionPlan(
  key: Record<string, unknown>,
  mode: DynamoDbConditionMode,
  expressionAttributeNames: Record<string, string> = {},
): DynamoDbConditionPlan {
  const names = { ...expressionAttributeNames }
  if (isEmptyRecord(key)) {
    return { expressionAttributeNames: names }
  }

  const helper = mode === 'exists' ? 'attribute_exists' : 'attribute_not_exists'
  const expressions = Object.keys(key)
    .sort((left, right) => left.localeCompare(right))
    .map((field, index) => `${helper}(${dynamoDbNameToken(names, field, index)})`)

  return {
    conditionExpression: expressions.join(' AND '),
    expressionAttributeNames: names,
  }
}

function dynamoDbNameToken(
  expressionAttributeNames: Record<string, string>,
  field: string,
  index: number,
) {
  const existingToken = Object.entries(expressionAttributeNames).find(
    ([, value]) => value === field,
  )?.[0]
  if (existingToken) {
    return existingToken
  }

  let tokenIndex = index
  let token = `#key${tokenIndex}`
  while (Object.prototype.hasOwnProperty.call(expressionAttributeNames, token)) {
    tokenIndex += 1
    token = `#key${tokenIndex}`
  }
  expressionAttributeNames[token] = field
  return token
}

function dynamoDbConditionFields(condition: DynamoDbConditionPlan) {
  if (!condition.conditionExpression) {
    return {}
  }

  return {
    ConditionExpression: condition.conditionExpression,
    ExpressionAttributeNames: condition.expressionAttributeNames,
  }
}

function dynamoDbEvidenceRequests(table: string, key: Record<string, unknown>) {
  if (isEmptyRecord(key)) {
    return {
      UnavailableReason: 'Complete item key required for before/after GetItem evidence.',
    }
  }

  return {
    Before: {
      Operation: 'GetItem',
      TableName: table,
      Key: key,
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    },
    After: {
      Operation: 'GetItem',
      TableName: table,
      Key: key,
      ConsistentRead: true,
      ReturnConsumedCapacity: 'TOTAL',
    },
  }
}

function dynamoDbPutItem(request: DataEditPlanRequest) {
  const item: Record<string, unknown> = {
    ...(request.target.primaryKey ?? {}),
    ...(request.target.itemKey ?? {}),
  }

  for (const change of request.changes) {
    if (change.field) {
      item[change.field] = secretAwareJsonValue(
        change.field,
        change.value ?? '<value>',
      )
    } else if (isRecord(change.value)) {
      Object.assign(item, change.value)
    }
  }

  return isEmptyRecord(item) ? { '<field>': '<value>' } : item
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function secretAwareJsonValue(name: string, value: unknown) {
  return isSecretLikeName(name) ? SECRET_REPLACEMENT : value
}

function isSecretLikeName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
  return /(^|_)(password|pwd|pass|token|secret|secretkey|apikey|api_key|authtoken|auth_token|accesstoken|access_token)($|_)/.test(normalized)
}
