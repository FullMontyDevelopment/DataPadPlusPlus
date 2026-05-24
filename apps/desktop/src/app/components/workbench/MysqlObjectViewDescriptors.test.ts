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
    expect(mysqlObjectViewMenuLabel('table')).not.toBe('Open View')
  })

  it('normalizes supported object kinds', () => {
    expect(isMysqlObjectViewKind('foreign keys')).toBe(true)
    expect(isMysqlObjectViewKind('system_schemas')).toBe(true)
    expect(isMysqlObjectViewKind('stored-procedure')).toBe(false)
  })

  it('falls back safely for unknown objects', () => {
    const descriptor = getMysqlObjectViewDescriptor('unknown-feature')
    expect(descriptor.menuLabel).toBe('Inspect MySQL Object')
    expect(descriptor.purpose).toContain('MySQL or MariaDB metadata')
  })
})
