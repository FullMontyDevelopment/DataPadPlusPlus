import { describe, expect, it } from 'vitest'
import { formatResultCellValue } from './result-cell-format'

describe('formatResultCellValue', () => {
  it('renders extended JSON dates as native table values', () => {
    expect(formatResultCellValue({ $date: '2026-05-16T11:29:08.356405Z' })).toBe(
      '2026-05-16 11:29:08.356405 +00:00',
    )
    expect(formatResultCellValue({ $date: { $numberLong: '1778930948356' } })).toBe(
      '2026-05-16 11:29:08.356 +00:00',
    )
  })

  it('keeps ordinary strings untouched and stringifies structured values safely', () => {
    expect(formatResultCellValue('DateTime2 { date: ... }')).toBe('DateTime2 { date: ... }')
    expect(formatResultCellValue({ value: 1 })).toBe('{"value":1}')
  })
})
