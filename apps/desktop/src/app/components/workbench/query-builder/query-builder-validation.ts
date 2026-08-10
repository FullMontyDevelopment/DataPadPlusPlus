import type {
  QueryBuilderState,
  SearchDslBuilderState,
} from '@datapadplusplus/shared-types'
import { isCqlPartitionBuilderState } from './cql-partition'
import { isCosmosSqlBuilderState } from './cosmos-sql'
import { isDynamoDbKeyConditionBuilderState } from './dynamodb-key-condition'
import { isMongoFindBuilderState } from './mongo-find'
import { isSearchDslBuilderState } from './search-dsl'
import { isSqlSelectBuilderState } from './sql-select'
import {
  parseQueryBuilderValue,
  queryBuilderOperatorArity,
  type QueryBuilderValueType,
} from './query-value-codec'

export interface QueryBuilderValidationError {
  message: string
  rowId?: string
  field?: string
}

export function validateQueryBuilderState(state: QueryBuilderState): QueryBuilderValidationError[] {
  const errors: QueryBuilderValidationError[] = []
  if (isMongoFindBuilderState(state)) {
    const disabledGroups = new Set(
      (state.filterGroups ?? []).filter((group) => group.enabled === false).map((group) => group.id),
    )
    for (const row of state.filters) {
      if (row.enabled === false || row.groupId && disabledGroups.has(row.groupId) || !row.field.trim()) continue
      if (row.operator === 'type' || row.operator === 'not-type') {
        if (!row.value.trim()) addError(errors, row.id, row.field, 'Enter a BSON type name or numeric BSON type code.')
        continue
      }
      validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
    }
  } else if (isCosmosSqlBuilderState(state)) {
    for (const row of state.filters) {
      if (row.enabled === false || !row.field.trim()) continue
      validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
    }
    if (state.partitionKeyEnabled) {
      validateValue(
        errors,
        'cosmos-partition-key',
        'Partition key',
        state.partitionKeyValue ?? '',
        state.partitionKeyValueType ?? 'string',
        'eq',
      )
    }
  } else if (isSqlSelectBuilderState(state)) {
    for (const row of state.filters) {
      if (row.enabled === false || !row.field.trim()) continue
      validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
    }
  } else if (isDynamoDbKeyConditionBuilderState(state)) {
    for (const row of [state.partitionKey, state.sortKey, ...state.filters]) {
      if (!row || row.enabled === false || !row.field.trim()) continue
      validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
      if (row.operator === 'between') {
        validateValue(errors, row.id, row.field, row.secondValue ?? '', row.valueType, 'eq', 'Second value')
      }
    }
  } else if (isCqlPartitionBuilderState(state)) {
    for (const row of [...state.partitionKeys, ...state.clusteringKeys, ...state.filters]) {
      if (row.enabled === false || !row.field.trim()) continue
      validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
    }
  } else if (isSearchDslBuilderState(state)) {
    validateSearchState(errors, state)
  }
  return errors
}

function validateSearchState(errors: QueryBuilderValidationError[], state: SearchDslBuilderState) {
  if (state.queryMode !== 'match-all' && state.queryMode !== 'query-string' && state.field.trim()) {
    validateValue(errors, 'search-main-query', state.field, state.value, state.valueType, 'eq')
  }
  for (const row of state.filters) {
    if (row.enabled === false || !row.field.trim()) continue
    validateValue(errors, row.id, row.field, row.value, row.valueType, row.operator)
  }
}

function validateValue(
  errors: QueryBuilderValidationError[],
  rowId: string,
  field: string,
  value: string,
  valueType: QueryBuilderValueType,
  operator: string,
  prefix?: string,
) {
  if (queryBuilderOperatorArity(operator) === 'none') return
  try {
    parseQueryBuilderValue(value, valueType, { operator, allowEnvironmentToken: true })
  } catch (error) {
    addError(
      errors,
      rowId,
      field,
      `${prefix ? `${prefix}: ` : ''}${error instanceof Error ? error.message : 'Enter a valid value.'}`,
    )
  }
}

function addError(
  errors: QueryBuilderValidationError[],
  rowId: string,
  field: string,
  message: string,
) {
  errors.push({ rowId, field, message })
}
