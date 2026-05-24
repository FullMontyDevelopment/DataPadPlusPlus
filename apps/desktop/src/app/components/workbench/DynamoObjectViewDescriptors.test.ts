import { describe, expect, it } from 'vitest'
import {
  dynamoObjectViewMenuLabel,
  getDynamoObjectViewDescriptor,
  isDynamoObjectViewKind,
} from './DynamoObjectViewDescriptors'

describe('DynamoObjectViewDescriptors', () => {
  it('uses native DynamoDB workflow labels instead of generic view labels', () => {
    expect(dynamoObjectViewMenuLabel('table')).toBe('Open Table')
    expect(dynamoObjectViewMenuLabel('items')).toBe('Query Items')
    expect(dynamoObjectViewMenuLabel('global-secondary-indexes')).toBe('Open GSIs')
    expect(dynamoObjectViewMenuLabel('diagnostics')).toBe('Open Diagnostics')
    expect(dynamoObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes common kind spellings', () => {
    expect(getDynamoObjectViewDescriptor('GLOBAL_SECONDARY_INDEXES').title).toBe('Global Secondary Indexes')
    expect(getDynamoObjectViewDescriptor('hot partitions').title).toBe('Hot Partitions')
  })

  it('identifies implemented DynamoDB object kinds only', () => {
    expect(isDynamoObjectViewKind('ttl')).toBe(true)
    expect(isDynamoObjectViewKind('unknown')).toBe(false)
  })
})
