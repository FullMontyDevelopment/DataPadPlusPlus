import { describe, expect, it } from 'vitest'
import {
  autoFitColumnWidth,
  buildVisibleGridRows,
  gridTextForMode,
  isSelected,
} from '../../../../../src/app/components/workbench/results/data-grid-model'

describe('data-grid-model', () => {
  const columns = ['id', 'name', 'status']
  const rows = [
    ['2', 'Beta', 'active'],
    ['10', 'Alpha', 'disabled'],
    ['1', 'Gamma', 'active'],
  ]

  it('filters buffered rows case-insensitively while preserving source row index', () => {
    expect(buildVisibleGridRows(rows, 'ACT', undefined)).toEqual([
      { row: rows[0], sourceIndex: 0 },
      { row: rows[2], sourceIndex: 2 },
    ])
  })

  it('sorts with numeric-aware locale comparison', () => {
    const sorted = buildVisibleGridRows(rows, '', { column: 0, direction: 'asc' })

    expect(sorted.map((item) => item.row[0])).toEqual(['1', '2', '10'])
  })

  it('serializes selections, rows, and full grids as tab-separated text', () => {
    const selection = { startRow: 0, startColumn: 1, endRow: 1, endColumn: 2 }

    expect(gridTextForMode('selection', columns, rows, selection)).toBe(
      'Beta\tactive\nAlpha\tdisabled',
    )
    expect(gridTextForMode('row', columns, rows, selection)).toBe('10\tAlpha\tdisabled')
    expect(gridTextForMode('all', columns, rows, undefined)).toContain('id\tname\tstatus')
  })

  it('detects selected cells regardless of drag direction', () => {
    const selection = { startRow: 2, startColumn: 2, endRow: 1, endColumn: 1 }

    expect(isSelected(1, 1, selection)).toBe(true)
    expect(isSelected(2, 2, selection)).toBe(true)
    expect(isSelected(0, 1, selection)).toBe(false)
  })

  it('bounds auto-fit widths for readable grid columns', () => {
    expect(autoFitColumnWidth(0, columns, buildVisibleGridRows(rows, '', undefined))).toBeGreaterThan(
      80,
    )
    expect(
      autoFitColumnWidth(0, columns, [
        { row: ['x'.repeat(200)], sourceIndex: 0 },
      ]),
    ).toBe(420)
  })
})
