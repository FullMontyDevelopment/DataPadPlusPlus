import { describe, expect, it } from 'vitest'
import {
  getOracleObjectViewDescriptor,
  isOracleObjectViewKind,
  oracleObjectViewMenuLabel,
} from '../../../../../../src/app/components/workbench/datastores/oracle/OracleObjectViewDescriptors'

describe('OracleObjectViewDescriptors', () => {
  it('uses workflow-specific labels instead of generic view labels', () => {
    expect(oracleObjectViewMenuLabel('table')).toBe('Open Table')
    expect(oracleObjectViewMenuLabel('package')).toBe('Manage Package')
    expect(oracleObjectViewMenuLabel('sessions')).toBe('Review Sessions')
    expect(oracleObjectViewMenuLabel('tablespaces')).toBe('Open Tablespace Usage')
    expect(oracleObjectViewMenuLabel('execution-plan')).toBe('Open Execution Plan')
    expect(oracleObjectViewMenuLabel('view')).not.toBe('Open View')
  })

  it('recognizes implemented Oracle native object surfaces', () => {
    expect(isOracleObjectViewKind('table')).toBe(true)
    expect(isOracleObjectViewKind('package')).toBe(true)
    expect(isOracleObjectViewKind('security')).toBe(true)
    expect(isOracleObjectViewKind('sql_monitor')).toBe(true)
    expect([
      'materialized-view',
      'sequence',
      'synonym',
      'json-collections',
      'json-collection',
      'external-tables',
      'external-table',
      'database-links',
      'database-link',
    ].every(isOracleObjectViewKind)).toBe(true)
    expect(isOracleObjectViewKind('data-guard')).toBe(false)
  })

  it('provides page purpose and empty states for Oracle views', () => {
    const descriptor = getOracleObjectViewDescriptor('storage')

    expect(descriptor.title).toBe('Oracle Storage')
    expect(descriptor.purpose).toMatch(/tablespaces/i)
    expect(descriptor.emptyDescription).toMatch(/storage/i)
  })
})
