import { describe, expect, it } from 'vitest'
import {
  applyDataGridRowPatches,
  createDataGridRowPatchUpdater,
  dataGridRowsVersion,
  diffDataGridRows,
} from '../../../../../src/app/components/workbench/results/data-grid-row-patches'

describe('data-grid row patches', () => {
  it('versions rows by incoming result identity and column layout', () => {
    const rows = [['1', 'active']]

    expect(dataGridRowsVersion(rows, ['id', 'status'])).toBe(dataGridRowsVersion(rows, ['id', 'status']))
    expect(dataGridRowsVersion([['1', 'active']], ['id', 'status']))
      .not.toBe(dataGridRowsVersion(rows, ['id', 'status']))
    expect(dataGridRowsVersion(rows, ['status', 'id']))
      .not.toBe(dataGridRowsVersion(rows, ['id', 'status']))
  })

  it('applies row edit, insert, and delete patches without mutating base rows', () => {
    const baseRows = [
      ['1', 'active'],
      ['2', 'paused'],
    ]
    const nextRows = applyDataGridRowPatches(baseRows, {
      0: ['1', 'closed'],
      1: undefined,
      2: ['3', 'queued'],
    })

    expect(nextRows).toEqual([
      ['1', 'closed'],
      ['3', 'queued'],
    ])
    expect(baseRows).toEqual([
      ['1', 'active'],
      ['2', 'paused'],
    ])
  })

  it('diffs shifted rows after delete and appended rows after insert', () => {
    const baseRows = [
      ['1', 'active'],
      ['2', 'paused'],
      ['3', 'queued'],
    ]

    expect(diffDataGridRows(baseRows, [
      ['1', 'active'],
      ['3', 'queued'],
    ])).toEqual({
      1: ['3', 'queued'],
      2: undefined,
    })

    expect(diffDataGridRows(baseRows, [
      ['1', 'active'],
      ['2', 'paused'],
      ['3', 'queued'],
      ['4', 'new'],
    ])).toEqual({
      3: ['4', 'new'],
    })
  })

  it('creates patches from React-style setter actions', () => {
    expect(createDataGridRowPatchUpdater({
      baseRows: [['1', 'active']],
      currentPatches: {},
      action: (current) => current.map((row) => row[0] === '1' ? ['1', 'closed'] : row),
    })).toEqual({
      0: ['1', 'closed'],
    })
  })
})
