import { describe, expect, it } from 'vitest'
import {
  getSqlServerObjectViewDescriptor,
  isSqlServerObjectViewKind,
  sqlServerObjectViewMenuLabel,
} from './SqlServerObjectViewDescriptors'

describe('SqlServerObjectViewDescriptors', () => {
  it('uses SQL Server specific operation labels', () => {
    expect(sqlServerObjectViewMenuLabel('table')).toBe('Open Table')
    expect(sqlServerObjectViewMenuLabel('query-store')).toBe('Open Query Store')
    expect(sqlServerObjectViewMenuLabel('performance')).toBe('Open Performance')
    expect(sqlServerObjectViewMenuLabel('missing-indexes')).toBe('Review Missing Indexes')
    expect(sqlServerObjectViewMenuLabel('security')).toBe('Review Security')
    expect(sqlServerObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('covers SQL Server and Azure SQL object kinds', () => {
    expect(isSqlServerObjectViewKind('stored procedures')).toBe(true)
    expect(isSqlServerObjectViewKind('sql-server-agent')).toBe(true)
    expect(isSqlServerObjectViewKind('query-store')).toBe(true)
    expect(isSqlServerObjectViewKind('performance')).toBe(true)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getSqlServerObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect SQL Server Object')
    expect(descriptor.purpose).toContain('SQL Server catalog metadata')
  })
})
