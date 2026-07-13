import { describe, expect, it } from 'vitest'
import {
  bytesText,
  cardRowsFromPayload,
  normalizeOracleObjectKind,
  objectUnit,
  oracleObjectRows,
  oraclePerformanceRows,
  oracleQueryTargetFromObjectView,
  oracleSecurityRows,
  oracleSourceOutline,
  sourceLinesFromPayload,
} from '../../../../../../src/app/components/workbench/datastores/oracle/OracleObjectViewWorkspace.helpers'
import type { QueryTabState } from '@datapadplusplus/shared-types'

describe('OracleObjectViewWorkspace helpers', () => {
  it('normalizes table and object rows into user-facing columns', () => {
    const rows = oracleObjectRows('tables', {
      tables: [{
        owner: 'APP',
        tableName: 'ACCOUNTS',
        status: 'VALID',
        tablespaceName: 'USERS',
      }],
    })

    expect(rows.columns).toEqual(['Owner', 'Table', 'Status', 'Tablespace'])
    expect(rows.rows).toEqual([['APP', 'ACCOUNTS', 'VALID', 'USERS']])
  })

  it('keeps Oracle category columns aligned with their metadata fields', () => {
    expect(oracleObjectRows('synonyms', {
      synonyms: [{ owner: 'APP', name: 'CUSTOMERS', targetOwner: 'CRM', targetObject: 'ACCOUNTS' }],
    }).rows).toEqual([['APP', 'CUSTOMERS', 'CRM', 'ACCOUNTS']])
    expect(oracleObjectRows('sequences', {
      sequences: [{ owner: 'APP', name: 'ORDERS_SEQ', increment: 1, cache: 50 }],
    }).rows).toEqual([['APP', 'ORDERS_SEQ', '1', '50']])
    expect(oracleObjectRows('database-links', {
      databaseLinks: [{ owner: 'APP', name: 'REPORTING_DB', username: 'REPORTING', host: 'reporting.internal' }],
    }).rows).toEqual([['APP', 'REPORTING_DB', 'REPORTING', 'reporting.internal']])
  })

  it('normalizes security, storage, and performance rows without raw payload dumps', () => {
    expect(oracleSecurityRows('roles', {
      roles: [{ role: 'APP_READ', source: 'DBA_ROLE_PRIVS', defaultRole: 'YES', adminOption: 'NO' }],
    }).rows).toEqual([['APP_READ', 'DBA_ROLE_PRIVS', 'YES', 'NO']])

    expect(oraclePerformanceRows('sql-monitor', {
      topSql: [{
        sqlId: 'abc123',
        status: 'DONE',
        elapsedMs: 42,
        sqlText: 'select * from accounts where account_id = :id',
      }],
    }).rows).toEqual([['abc123', 'DONE', '42', 'SELECT statement: select * from accounts where account_id = :id']])
  })

  it('builds a compact PL/SQL outline from source lines', () => {
    const lines = sourceLinesFromPayload({
      sourceLines: [
        'CREATE OR REPLACE PACKAGE BODY account_api AS',
        { line: 12, text: '  PROCEDURE sync_accounts IS' },
        { line: 25, source: '  FUNCTION account_count RETURN NUMBER IS' },
      ],
    })

    expect(oracleSourceOutline(lines)).toEqual([
      ['1', 'Package Body: account_api'],
      ['12', 'Procedure: sync_accounts'],
      ['25', 'Function: account_count'],
    ])
  })

  it('derives query targets and display labels safely', () => {
    const tab = {
      id: 'tab-oracle-table',
      title: 'Accounts',
      tabKind: 'object-view',
      connectionId: 'conn-oracle',
      objectViewState: {
        connectionId: 'conn-oracle',
        nodeId: 'oracle-table:APP:ACCOUNTS',
        kind: 'table',
        label: 'ACCOUNTS',
        path: ['APP', 'Tables', 'ACCOUNTS'],
        queryTemplate: 'select * from "APP"."ACCOUNTS"',
      },
    } as QueryTabState

    expect(oracleQueryTargetFromObjectView(tab)).toMatchObject({
      kind: 'table',
      label: 'ACCOUNTS',
      preferredBuilder: 'sql-select',
    })
    expect(normalizeOracleObjectKind('SQL Monitor')).toBe('sql-monitor')
    expect(objectUnit('table', { objectName: 'ACCOUNTS' }, 0)).toBe('ACCOUNTS')
    expect(cardRowsFromPayload({ activeSessions: 3, empty: '' }, ['activeSessions', 'empty'])).toEqual([
      ['Active Sessions', '3'],
    ])
    expect(bytesText(1536)).toBe('1.5 KB')
  })
})
