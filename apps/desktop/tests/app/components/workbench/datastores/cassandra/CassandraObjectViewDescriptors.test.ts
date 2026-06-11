import { describe, expect, it } from 'vitest'
import {
  cassandraObjectViewMenuLabel,
  getCassandraObjectViewDescriptor,
  isCassandraObjectViewKind,
} from '../../../../../../src/app/components/workbench/datastores/cassandra/CassandraObjectViewDescriptors'

describe('CassandraObjectViewDescriptors', () => {
  it('uses native workflow labels instead of generic view text', () => {
    expect(cassandraObjectViewMenuLabel('table')).toBe('Open Table')
    expect(cassandraObjectViewMenuLabel('data')).toBe('Query Rows')
    expect(cassandraObjectViewMenuLabel('indexes')).toBe('Manage Indexes')
    expect(cassandraObjectViewMenuLabel('security')).toBe('Review Security')
    expect(cassandraObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes underscore and mixed-case kinds', () => {
    expect(getCassandraObjectViewDescriptor('PRIMARY_KEY').title).toBe('Cassandra Primary Key')
    expect(getCassandraObjectViewDescriptor('Materialized_View').title).toBe('Cassandra Materialized View')
  })

  it('identifies implemented object-view kinds only', () => {
    expect(isCassandraObjectViewKind('compaction')).toBe(true)
    expect(isCassandraObjectViewKind('repairs')).toBe(true)
    expect(isCassandraObjectViewKind('sample-data')).toBe(false)
  })
})
