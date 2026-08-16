import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { oracleStructureScope } from '../../src/app/components/workbench/query-targets/oracle-query-target'

describe('Oracle completion scope', () => {
  const connection = { engine: 'oracle' } as ConnectionProfile

  it('uses the query tab SQL schema before its scoped Explorer target', () => {
    const tab = {
      sqlScope: { schema: 'Sales:Ops' },
      scopedTarget: {
        kind: 'table',
        label: 'ACCOUNTS',
        scope: 'oracle:object:table:schema:APP:ACCOUNTS',
      },
    } as QueryTabState

    expect(oracleStructureScope(connection, tab)).toBe('schema:Sales%3AOps')
  })

  it('normalizes a database-origin object scope to its exact encoded schema', () => {
    const tab = {
      scopedTarget: {
        kind: 'table',
        label: 'Quarterly#Report$',
        scope: 'oracle:object:table:database:FREEPDB1:%E8%B2%A9%E5%A3%B2:Quarterly%23Report%24',
      },
    } as QueryTabState

    expect(oracleStructureScope(connection, tab)).toBe(
      'schema:%E8%B2%A9%E5%A3%B2',
    )
  })

  it.each([
    ['oracle:category:schema:Sales%3AOps:tables', 'schema:Sales%3AOps'],
    ['oracle:schema:Mixed%20Case', 'schema:Mixed%20Case'],
    ['schema:Legacy%23Schema', 'schema:Legacy%23Schema'],
  ])('normalizes current and legacy schema scope %s', (scope, expected) => {
    const tab = {
      scopedTarget: {
        kind: 'schema',
        label: 'fallback',
        scope,
      },
    } as QueryTabState

    expect(oracleStructureScope(connection, tab)).toBe(expected)
  })
})
