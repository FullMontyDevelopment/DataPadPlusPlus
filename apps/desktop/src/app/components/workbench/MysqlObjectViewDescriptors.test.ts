import { describe, expect, it } from 'vitest'
import {
  getMysqlObjectViewDescriptor,
  isMysqlObjectViewKind,
  mysqlObjectViewMenuLabel,
} from './MysqlObjectViewDescriptors'

describe('MysqlObjectViewDescriptors', () => {
  it('uses MySQL and MariaDB specific operation labels', () => {
    expect(mysqlObjectViewMenuLabel('table')).toBe('Open Table')
    expect(mysqlObjectViewMenuLabel('events')).toBe('Open Events')
    expect(mysqlObjectViewMenuLabel('security')).toBe('Review Users / Privileges')
    expect(mysqlObjectViewMenuLabel('slow queries')).toBe('Review Slow Queries')
    expect(mysqlObjectViewMenuLabel('performance schema')).toBe('Review Performance Schema')
    expect(mysqlObjectViewMenuLabel('metadata_locks')).toBe('Review Metadata Locks')
    expect(mysqlObjectViewMenuLabel('optimizer trace')).toBe('Review Optimizer Trace')
    expect(mysqlObjectViewMenuLabel('role mappings')).toBe('Review Role Mappings')
    expect(mysqlObjectViewMenuLabel('server variables')).toBe('Review Server Variables')
    expect(mysqlObjectViewMenuLabel('analyze profile')).toBe('Review ANALYZE Profile')
    expect(mysqlObjectViewMenuLabel('innodb_status')).toBe('Review InnoDB Status')
    expect(mysqlObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes supported object kinds', () => {
    expect(isMysqlObjectViewKind('foreign keys')).toBe(true)
    expect(isMysqlObjectViewKind('system_schemas')).toBe(true)
    expect(isMysqlObjectViewKind('statistics')).toBe(true)
    expect(isMysqlObjectViewKind('status counters')).toBe(true)
    expect(isMysqlObjectViewKind('role mappings')).toBe(true)
    expect(isMysqlObjectViewKind('server_variables')).toBe(true)
    expect(isMysqlObjectViewKind('storage engines')).toBe(true)
    expect(isMysqlObjectViewKind('analyze_profile')).toBe(true)
    expect(isMysqlObjectViewKind('stored-procedure')).toBe(false)
  })

  it('uses MariaDB-native descriptor titles when the engine is MariaDB', () => {
    expect(getMysqlObjectViewDescriptor('security', 'mariadb').title).toBe('MariaDB Users / Privileges')
    expect(getMysqlObjectViewDescriptor('server variables', 'mariadb')).toMatchObject({
      title: 'MariaDB Server Variables',
      menuLabel: 'Review Server Variables',
    })
    expect(getMysqlObjectViewDescriptor('analyze profile', 'mariadb').purpose).toContain('ANALYZE FORMAT=JSON')
    expect(getMysqlObjectViewDescriptor('table', 'mariadb').title).toBe('MariaDB Table')
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getMysqlObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect MySQL Object')
    expect(descriptor.purpose).toContain('MySQL or MariaDB metadata')
  })
})
