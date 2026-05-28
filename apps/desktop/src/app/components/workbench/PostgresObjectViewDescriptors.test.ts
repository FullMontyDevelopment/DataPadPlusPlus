import { describe, expect, it } from 'vitest'
import {
  getPostgresObjectViewDescriptor,
  isPostgresObjectViewKind,
  postgresObjectViewMenuLabel,
} from './PostgresObjectViewDescriptors'

describe('PostgresObjectViewDescriptors', () => {
  it('uses workflow-specific menu labels', () => {
    expect(postgresObjectViewMenuLabel('table')).toBe('Open Table')
    expect(postgresObjectViewMenuLabel('indexes')).toBe('Manage Indexes')
    expect(postgresObjectViewMenuLabel('sessions')).toBe('Review Sessions')
    expect(postgresObjectViewMenuLabel('waits')).toBe('Review Wait Events')
    expect(postgresObjectViewMenuLabel('index-health')).toBe('Review Index Health')
    expect(postgresObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes supported object kinds', () => {
    expect(isPostgresObjectViewKind('materialized view')).toBe(true)
    expect(isPostgresObjectViewKind('stored-procedure')).toBe(false)
    expect(isPostgresObjectViewKind('statement stats')).toBe(true)
    expect(isPostgresObjectViewKind('security')).toBe(true)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getPostgresObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect PostgreSQL Object')
    expect(descriptor.purpose).toContain('PostgreSQL catalog metadata')
  })
})
